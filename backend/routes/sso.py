"""
ADFS single sign-on (OpenID Connect, authorization-code flow with PKCE).

Only the *identity* step changes: ADFS tells us who the user is, then the
existing upsert_ad_user() / create_session() path runs exactly as it does for
a password login. Roles, sessions and every downstream check are untouched.

Implemented directly on httpx + PyJWT rather than a framework integration, so
there is no session middleware to interact with the existing cookie auth, and
failures produce messages you can actually diagnose on an air-gapped box.

The login transaction (state / nonce / PKCE verifier) is carried in a short
signed cookie rather than server memory, so a service restart mid-login does
not strand the user.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
from database import _ConnWrapper as DbConn
import time
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from jwt import PyJWKClient

from auth_helper import create_session, lookup_ad_user, upsert_ad_user, SESSION_TTL_HOURS
from config import settings
from database import get_db

router = APIRouter()

TX_COOKIE = "kairos_sso_tx"
TX_TTL    = 900          # seconds a login attempt stays valid (typing credentials takes longer than silent SSO)

# Discovery document is fetched once and reused
_discovery = {"data": None, "at": 0}
_DISCOVERY_TTL = 3600


# ── helpers ───────────────────────────────────────────────────────────────────

def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _sign(payload: dict) -> str:
    """Compact signed token: base64(json).base64(hmac)."""
    body = _b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig  = hmac.new(settings.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest()
    return f"{body}.{_b64u(sig)}"


def _unsign(token: str) -> dict | None:
    try:
        body, sig = token.split(".", 1)
    except ValueError:
        return None
    expect = _b64u(hmac.new(settings.SECRET_KEY.encode(), body.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expect):
        return None
    pad = "=" * (-len(body) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode(body + pad))
    except Exception:
        return None
    if data.get("exp", 0) < time.time():
        return None
    return data


def _discover() -> dict:
    """Fetch and cache the ADFS OpenID configuration."""
    now = time.time()
    if _discovery["data"] and now - _discovery["at"] < _DISCOVERY_TTL:
        return _discovery["data"]
    url = settings.SSO_DISCOVERY_URL
    try:
        with httpx.Client(verify=settings.SSO_VERIFY_SSL, timeout=10) as c:
            r = c.get(url)
            r.raise_for_status()
            doc = r.json()
    except Exception as e:
        raise HTTPException(502, f"Cannot reach ADFS discovery endpoint {url}: {e}")
    _discovery["data"] = doc
    _discovery["at"] = now
    return doc


def _require_sso():
    if not settings.SSO_ENABLED:
        raise HTTPException(404, "SSO is not enabled")


def _redirect_uri() -> str:
    return f"{settings.APP_URL}/api/auth/sso/callback"


def _pick_username(claims: dict) -> str:
    """
    ADFS can be configured to emit the account name under several claim names.
    Take the first that is present, then strip any domain decoration so the
    value matches what LDAP login already stores.
    """
    for key in (settings.SSO_USERNAME_CLAIM, "upn", "unique_name", "winaccountname", "sub"):
        val = claims.get(key)
        if val:
            v = str(val)
            if "\\" in v:      # DOMAIN\amit
                v = v.split("\\")[-1]
            if "@" in v:       # amit@company.local
                v = v.split("@")[0]
            return v
    raise HTTPException(400, f"No username claim in ADFS token. Claims present: {sorted(claims)}")


def _claim_display_name(claims: dict) -> str | None:
    """
    ADFS emits the display name under any of several claim names depending on
    how the issuance rules were written, including full WS-* URIs.
    """
    keys = (
        "name",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
        "displayname", "display_name",
        "http://schemas.microsoft.com/identity/claims/displayname",
        "commonname", "cn",
    )
    for k in keys:
        v = claims.get(k)
        if v and str(v).strip():
            return str(v).strip()
    # Fall back to composing from given/family name if present
    given  = (claims.get("given_name") or claims.get("givenname") or "").strip()
    family = (claims.get("family_name") or claims.get("surname") or "").strip()
    full = f"{given} {family}".strip()
    return full or None


# ── routes ────────────────────────────────────────────────────────────────────

def _canonical_host() -> str:
    from urllib.parse import urlparse
    return (urlparse(settings.APP_URL).netloc or "").lower()


@router.get("/sso/login")
def sso_login(request: Request):
    """Kick off the OIDC flow: redirect the browser to ADFS."""
    _require_sso()

    # ADFS always returns to the redirect_uri built from app_url. If the user
    # arrived on a different host (an IP, a short name), the transaction cookie
    # would be set on that origin and never sent to the callback — the login
    # would fail with "cookie missing". Send them to the canonical host first
    # so the cookie and the callback share an origin.
    here = (request.headers.get("host") or "").lower()
    want = _canonical_host()
    if want and here and here != want:
        return RedirectResponse(f"{settings.APP_URL}/api/auth/sso/login", status_code=302)

    doc = _discover()

    state    = secrets.token_urlsafe(24)
    nonce    = secrets.token_urlsafe(24)
    verifier = _b64u(os.urandom(40))
    challenge = _b64u(hashlib.sha256(verifier.encode()).digest())

    params = {
        "client_id":             settings.SSO_CLIENT_ID,
        "response_type":         "code",
        "scope":                 settings.SSO_SCOPE,
        "redirect_uri":          _redirect_uri(),
        "state":                 state,
        "nonce":                 nonce,
        "code_challenge":        challenge,
        "code_challenge_method": "S256",
    }
    if settings.SSO_RESOURCE:                 # ADFS 2016 often wants this
        params["resource"] = settings.SSO_RESOURCE

    resp = RedirectResponse(f"{doc['authorization_endpoint']}?{urlencode(params)}", status_code=302)
    resp.set_cookie(
        TX_COOKIE,
        _sign({"state": state, "nonce": nonce, "verifier": verifier, "exp": time.time() + TX_TTL}),
        httponly=True, samesite="lax", max_age=TX_TTL,
        secure=settings.APP_URL.startswith("https"), path="/",
    )
    return resp


@router.get("/sso/callback")
def sso_callback(request: Request, db: DbConn = Depends(get_db)):
    """ADFS redirects back here with an authorization code."""
    _require_sso()

    err = request.query_params.get("error")
    if err:
        desc = request.query_params.get("error_description", "")
        raise HTTPException(401, f"ADFS returned an error: {err} {desc}")

    code  = request.query_params.get("code")
    state = request.query_params.get("state")
    if not code or not state:
        raise HTTPException(400, "Missing code or state in callback")

    raw_tx = request.cookies.get(TX_COOKIE, "")
    tx = _unsign(raw_tx)
    if not tx:
        here = (request.headers.get("host") or "?").lower()
        want = _canonical_host()
        if not raw_tx and want and here != want:
            detail = (f"Login cookie was set for '{want}' but the callback arrived on "
                      f"'{here}'. Open the app at {settings.APP_URL} and try again.")
        elif not raw_tx:
            detail = ("No login cookie was returned by the browser. Start the sign-in "
                      f"again from {settings.APP_URL}.")
        else:
            detail = "Login request expired — please sign in again."
        raise HTTPException(400, detail)
    if not hmac.compare_digest(tx["state"], state):
        raise HTTPException(400, "State mismatch — possible CSRF, login rejected")

    doc = _discover()

    # ── exchange the code for tokens ──────────────────────────────────────────
    data = {
        "grant_type":    "authorization_code",
        "code":          code,
        "redirect_uri":  _redirect_uri(),
        "client_id":     settings.SSO_CLIENT_ID,
        "code_verifier": tx["verifier"],
    }
    if settings.SSO_CLIENT_SECRET:
        data["client_secret"] = settings.SSO_CLIENT_SECRET

    try:
        with httpx.Client(verify=settings.SSO_VERIFY_SSL, timeout=15) as c:
            r = c.post(doc["token_endpoint"], data=data,
                       headers={"Content-Type": "application/x-www-form-urlencoded"})
        if r.status_code != 200:
            raise HTTPException(401, f"ADFS token exchange failed ({r.status_code}): {r.text[:300]}")
        tokens = r.json()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Cannot reach ADFS token endpoint: {e}")

    id_token = tokens.get("id_token")
    if not id_token:
        raise HTTPException(401, "ADFS response contained no id_token")

    # ── validate the ID token ─────────────────────────────────────────────────
    try:
        jwks = PyJWKClient(doc["jwks_uri"], cache_keys=True)
        key  = jwks.get_signing_key_from_jwt(id_token).key
        claims = jwt.decode(
            id_token, key,
            algorithms=["RS256"],
            audience=settings.SSO_CLIENT_ID,
            issuer=doc["issuer"],
            options={"verify_aud": settings.SSO_VERIFY_AUDIENCE},
        )
    except Exception as e:
        raise HTTPException(401, f"ID token validation failed: {e}")

    if claims.get("nonce") and not hmac.compare_digest(str(claims["nonce"]), tx["nonce"]):
        raise HTTPException(401, "Nonce mismatch — token replay rejected")

    # ── map to a Kairos user (same path as password login) ────────────────────
    username = _pick_username(claims)

    # Display name, best source first:
    #   1. AD itself via the service bind account — authoritative, and correct
    #      for non-Latin names. ADFS often does not emit a name claim at all.
    #   2. Whatever name-ish claim the token carries.
    #   3. The username, so a directory outage still lets people in.
    info = lookup_ad_user(username) if settings.SSO_LOOKUP_AD else None

    display_name = (info or {}).get("display_name") or _claim_display_name(claims) or username
    email        = (info or {}).get("email") \
                   or claims.get("email") or claims.get("upn") \
                   or f"{username}@{settings.AD_DOMAIN}"

    user_id = upsert_ad_user(db, {
        "username":     username,
        "display_name": display_name,
        "email":        email,
    })

    token = create_session(db, user_id)
    resp = RedirectResponse("/", status_code=302)
    # Must match exactly what POST /api/auth/login sets and what
    # get_current_user() reads — the cookie name is "session_token".
    resp.set_cookie(
        key="session_token", value=token,
        # Shared with auth.py's password-login cookie and the DB-side
        # session row via SESSION_TTL_HOURS — was hardcoded separately here,
        # which is exactly the kind of drift that made "extend the session"
        # a two-file, easy-to-half-do change.
        httponly=True, samesite="lax", max_age=SESSION_TTL_HOURS * 3600,
        secure=settings.APP_URL.startswith("https"), path="/",
    )
    resp.delete_cookie(TX_COOKIE, path="/")
    return resp


@router.get("/sso/status")
def sso_status():
    """Lets the login page decide whether to show the SSO button."""
    return {
        "enabled":          bool(settings.SSO_ENABLED),
        "button_label":     settings.SSO_BUTTON_LABEL,
        "allow_local":      bool(settings.SSO_ALLOW_LOCAL),
    }
