from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from pydantic import BaseModel
from typing import Optional
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import authenticate, create_session, get_current_user, require_admin, hash_password, SESSION_TTL_HOURS

router = APIRouter()

class LoginRequest(BaseModel):
    username: str
    password: str

class LocalUserCreate(BaseModel):
    username:     str
    display_name: str
    email:        str
    password:     str
    is_admin:     Optional[bool] = False

class LocalUserUpdate(BaseModel):
    display_name: Optional[str] = None
    email:        Optional[str] = None
    password:     Optional[str] = None
    is_admin:     Optional[bool] = None
    is_active:    Optional[bool] = None

# ── Login / logout / me ────────────────────────────────────────────────────────

@router.post("/login")
def login(body: LoginRequest, response: Response, db: DbConn = Depends(get_db)):
    user_id = authenticate(db, body.username, body.password)   # raises 401 on failure
    token = create_session(db, user_id)
    response.set_cookie(
        key="session_token", value=token,
        httponly=True, samesite="lax", max_age=SESSION_TTL_HOURS * 3600
    )
    user = db.execute(
        "SELECT id, username, display_name, email, is_admin, auth_source, COALESCE(language, 'en') AS language FROM users WHERE id=%s",
        (user_id,)
    ).fetchone()
    return {"user": dict(user)}

@router.post("/logout")
def logout(response: Response, session_token: str | None = Cookie(default=None), db: DbConn = Depends(get_db)):
    if session_token:
        db.execute("DELETE FROM sessions WHERE token=%s", (session_token,))
        db.commit()
    response.delete_cookie("session_token")
    return {"ok": True}

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"user": user}

# ── Local user management (admin only) ────────────────────────────────────────

@router.get("/local-users")
def list_local_users(admin=Depends(require_admin), db: DbConn = Depends(get_db)):
    rows = db.execute(
        "SELECT id, username, display_name, email, is_admin, is_active, auth_source, created_at "
        "FROM users ORDER BY auth_source, display_name"
    ).fetchall()
    return [dict(r) for r in rows]

@router.post("/local-users")
def create_local_user(body: LocalUserCreate, admin=Depends(require_admin), db: DbConn = Depends(get_db)):
    existing = db.execute("SELECT id FROM users WHERE username=%s", (body.username,)).fetchone()
    if existing:
        raise HTTPException(status_code=409, detail="Username already exists")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    hashed = hash_password(body.password)
    row = db.execute(
        "INSERT INTO users (username, display_name, email, auth_source, password_hash, is_admin, is_active) "
        "VALUES (%s,%s,%s,'local',%s,%s,1) RETURNING id",
        (body.username, body.display_name, body.email, hashed, int(body.is_admin))
    ).fetchone()
    db.commit()
    result = db.execute("SELECT id, username, display_name, email, is_admin, is_active, auth_source FROM users WHERE id=%s", (row["id"],)).fetchone()
    return dict(result)

@router.patch("/local-users/{user_id}")
def update_local_user(user_id: int, body: LocalUserUpdate, admin=Depends(require_admin), db: DbConn = Depends(get_db)):
    row = db.execute("SELECT id, auth_source FROM users WHERE id=%s", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if row["auth_source"] != "local":
        raise HTTPException(status_code=400, detail="Cannot edit AD users — managed by Active Directory")
    updates = {}
    if body.display_name is not None: updates["display_name"] = body.display_name
    if body.email        is not None: updates["email"]        = body.email
    if body.is_admin     is not None: updates["is_admin"]     = int(body.is_admin)
    if body.is_active    is not None: updates["is_active"]    = int(body.is_active)
    if body.password     is not None:
        if len(body.password) < 8:
            raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
        updates["password_hash"] = hash_password(body.password)
    if updates:
        set_clause = ", ".join(f"{k}=%s" for k in updates)
        db.execute(f"UPDATE users SET {set_clause} WHERE id=%s", (*updates.values(), user_id))
        db.commit()
    row = db.execute("SELECT id, username, display_name, email, is_admin, is_active, auth_source FROM users WHERE id=%s", (user_id,)).fetchone()
    return dict(row)

@router.delete("/local-users/{user_id}")
def delete_local_user(user_id: int, admin=Depends(require_admin), db: DbConn = Depends(get_db)):
    row = db.execute("SELECT auth_source FROM users WHERE id=%s", (user_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    if row["auth_source"] != "local":
        raise HTTPException(status_code=400, detail="Cannot delete AD users from here")
    db.execute("DELETE FROM users WHERE id=%s", (user_id,))
    db.commit()
    return {"ok": True}
