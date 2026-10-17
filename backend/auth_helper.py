import secrets
import bcrypt
from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, Cookie, Header
from ldap3 import Server, Connection, ALL
from database import get_db
from database import _ConnWrapper as DbConn
from config import settings

SESSION_TTL_HOURS = 72

# ── Local user auth ────────────────────────────────────────────────────────────

def authenticate_local(db: DbConn, username: str, password: str) -> dict | None:
    """Check if username exists as a local user and verify password."""
    row = db.execute(
        "SELECT id, username, display_name, email, password_hash, is_active, is_admin "
        "FROM users WHERE username=%s AND auth_source='local'",
        (username,)
    ).fetchone()
    if not row:
        return None
    if not row["is_active"]:
        raise HTTPException(status_code=403, detail="Account is disabled")
    if not bcrypt.checkpw(password.encode(), row["password_hash"].encode()):
        return None
    return dict(row)

# ── AD auth ────────────────────────────────────────────────────────────────────

def authenticate_ad(username: str, password: str) -> dict | None:
    """Authenticate user against Active Directory. Returns user info dict or None."""
    if not getattr(settings, "AD_ENABLED", True):
        return None
    try:
        server = Server(settings.AD_SERVER, get_info=ALL)
        user_upn = f"{username}@{settings.AD_DOMAIN}"
        conn = Connection(server, user=user_upn, password=password, authentication="SIMPLE")
        if not conn.bind():
            return None
        conn.search(
            settings.AD_BASE_DN,
            f"(sAMAccountName={username})",
            attributes=["displayName", "mail", "sAMAccountName"]
        )
        if not conn.entries:
            return None
        entry = conn.entries[0]

        def ad_str(val, fallback=""):
            """Safely decode AD attribute to Unicode string."""
            s = str(val) if val else fallback
            if isinstance(s, bytes):
                s = s.decode("utf-8", errors="replace")
            return s or fallback

        return {
            "username":     ad_str(entry.sAMAccountName, username),
            "display_name": ad_str(entry.displayName, username),
            "email":        ad_str(entry.mail, f"{username}@{settings.AD_DOMAIN}"),
        }
    except Exception:
        return None

def lookup_ad_user(username: str) -> dict | None:
    """
    Look up a user in AD by sAMAccountName using the service bind account —
    no user password needed.

    Used by SSO: ADFS does not always emit a display-name claim, and the
    directory is the authoritative source for it anyway (correct spelling,
    correct Hebrew).
    """
    if not getattr(settings, "AD_ENABLED", True):
        return None
    if not settings.AD_BIND_USER or not settings.AD_BIND_PASS:
        return None
    try:
        server = Server(settings.AD_SERVER, get_info=ALL)
        conn = Connection(
            server,
            user=settings.AD_BIND_USER,
            password=settings.AD_BIND_PASS,
            authentication="SIMPLE",
        )
        if not conn.bind():
            return None
        conn.search(
            settings.AD_BASE_DN,
            f"(sAMAccountName={username})",
            attributes=["displayName", "mail", "sAMAccountName"],
        )
        if not conn.entries:
            return None
        entry = conn.entries[0]

        def ad_str(val, fallback=""):
            s = str(val) if val else fallback
            if isinstance(s, bytes):
                s = s.decode("utf-8", errors="replace")
            return s or fallback

        return {
            "username":     ad_str(entry.sAMAccountName, username),
            "display_name": ad_str(entry.displayName, username),
            "email":        ad_str(entry.mail, f"{username}@{settings.AD_DOMAIN}"),
        }
    except Exception:
        return None


def upsert_ad_user(db: DbConn, user_info: dict) -> int:
    """Insert or update an AD-sourced user record, return user id."""
    row = db.execute(
        "SELECT id FROM users WHERE username=%s AND auth_source='ad'",
        (user_info["username"],)
    ).fetchone()
    if row:
        db.execute(
            "UPDATE users SET display_name=%s, email=%s WHERE username=%s AND auth_source='ad'",
            (user_info["display_name"], user_info["email"], user_info["username"])
        )
        db.commit()
        return row["id"]
    new_row = db.execute(
        "INSERT INTO users (username, display_name, email, auth_source, is_active) VALUES (%s,%s,%s,'ad',1) RETURNING id",
        (user_info["username"], user_info["display_name"], user_info["email"])
    ).fetchone()
    db.commit()
    return new_row["id"]

# ── Unified login ──────────────────────────────────────────────────────────────

def authenticate(db: DbConn, username: str, password: str) -> int:
    """
    Try local auth first, then AD.
    Returns user_id on success, raises HTTPException on failure.
    """
    # 1. Local user?
    local = authenticate_local(db, username, password)
    if local is not None:
        return local["id"]

    # 2. AD user?
    ad_info = authenticate_ad(username, password)
    if ad_info:
        return upsert_ad_user(db, ad_info)

    raise HTTPException(status_code=401, detail="Invalid username or password")

# ── Session ────────────────────────────────────────────────────────────────────

def create_session(db: DbConn, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    # sessions.expires_at is a native TIMESTAMP column in Postgres (it was
    # TEXT in SQLite, storing an isoformat() string). Pass a real datetime
    # object rather than pre-formatting it — psycopg2 adapts it correctly,
    # and get_current_user below reads it back as a datetime too, so the
    # isoformat()/fromisoformat() round-trip that SQLite needed is gone
    # entirely rather than ported.
    expires = datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)
    db.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (%s,%s,%s)",
        (token, user_id, expires)
    )
    db.commit()
    return token

def get_current_user(
    session_token: str | None = Cookie(default=None),
    db: DbConn = Depends(get_db)
):
    if not session_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    row = db.execute(
        """SELECT s.user_id, s.expires_at, u.username, u.display_name,
                  u.email, COALESCE(u.is_admin, 0) as is_admin, u.auth_source,
                  COALESCE(u.language, 'en') as language
           FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE s.token = %s""",
        (session_token,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Invalid session")

    # expires_at comes back as a native (naive, UTC) datetime from Postgres —
    # no fromisoformat() parsing needed. Attach UTC so it compares safely
    # against an aware "now", regardless of how the driver hands it back.
    expires_at = row["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        db.execute("DELETE FROM sessions WHERE token=%s", (session_token,))
        db.commit()
        raise HTTPException(status_code=401, detail="Session expired")
    return dict(row)

def require_admin(user=Depends(get_current_user)):
    if not user["is_admin"]:
        raise HTTPException(status_code=403, detail="Admin required")
    return user

# ── Inbound integration auth (e.g. Node-RED) ────────────────────────────────────
#
# Server-to-server callers (Node-RED posting a comment back onto a task,
# for example) have no browser and no session cookie. Rather than opening
# an unauthenticated hole, a shared API key maps onto one real, ordinary
# user account — settings.API_KEY_USERNAME — so every downstream RBAC
# check (require_task_access, get_project_role, etc.) runs completely
# unmodified: the integration is just "logged in" as that user for the
# duration of the request. Give that user only the project access you
# want the integration to have (e.g. add it as a member of the one
# project Node-RED writes into) rather than making it an admin.

def get_current_user_or_api_key(
    session_token: str | None = Cookie(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    db: DbConn = Depends(get_db),
):
    # Prefer the normal browser session when both are present.
    if session_token:
        return get_current_user(session_token=session_token, db=db)

    if x_api_key:
        if not settings.API_KEY:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if not secrets.compare_digest(x_api_key, settings.API_KEY):
            raise HTTPException(status_code=401, detail="Invalid API key")
        row = db.execute(
            "SELECT id as user_id, username, display_name, email, "
            "COALESCE(is_admin, 0) as is_admin, auth_source, COALESCE(language, 'en') as language "
            "FROM users WHERE username=%s AND is_active=1",
            (settings.API_KEY_USERNAME,)
        ).fetchone()
        if not row:
            log_msg = f"API key accepted but API_KEY_USERNAME '{settings.API_KEY_USERNAME}' has no active user row"
            raise HTTPException(status_code=500, detail=log_msg)
        return dict(row)

    raise HTTPException(status_code=401, detail="Not authenticated")

# ── Local user management (admin only) ────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()
