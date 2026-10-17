from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user, require_admin
from config import settings

router = APIRouter()

@router.get("")
def list_users(
    project_id: Optional[int] = None,
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db)
):
    if project_id:
        rows = db.execute("""
            SELECT u.id, u.username, u.display_name, u.email, pm.role
            FROM project_members pm
            JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = %s
            ORDER BY u.display_name
        """, (project_id,)).fetchall()
    else:
        rows = db.execute(
            "SELECT id, username, display_name, email FROM users WHERE is_active=1 ORDER BY display_name"
        ).fetchall()
    return [dict(r) for r in rows]

class LanguageBody(BaseModel):
    language: str


@router.put("/me/language")
def set_my_language(body: LanguageBody, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    """Store the caller's UI language; emails and bell messages follow it."""
    if body.language not in ("en", "he"):
        raise HTTPException(400, "Unsupported language")
    db.execute("UPDATE users SET language=%s WHERE id=%s", (body.language, user["user_id"]))
    db.commit()
    return {"ok": True, "language": body.language}


@router.get("/notifications")
def get_notifications(user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    rows = db.execute("""
        SELECT n.id, n.user_id, n.task_id, n.message, n.read, n.created_at,
               t.title  as task_title,
               t.project_id                        -- needed for deep-link navigation
        FROM notifications n
        LEFT JOIN tasks t ON t.id = n.task_id
        WHERE n.user_id = %s
        ORDER BY n.created_at DESC
        LIMIT 50
    """, (user["user_id"],)).fetchall()
    return [dict(r) for r in rows]

@router.post("/notifications/read")
def mark_notifications_read(user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    db.execute("UPDATE notifications SET read=1 WHERE user_id=%s", (user["user_id"],))
    db.commit()
    return {"ok": True}

@router.post("/notifications/{notif_id}/read")
def mark_one_read(notif_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    db.execute("UPDATE notifications SET read=1 WHERE id=%s AND user_id=%s", (notif_id, user["user_id"]))
    db.commit()
    return {"ok": True}


# ── Mail diagnostics ──────────────────────────────────────────────────────────

@router.get("/email/diagnose")
def email_diagnose(user=Depends(require_admin), db: DbConn = Depends(get_db)):
    """
    Admin-only: report the mail configuration and which users cannot be
    emailed. Notifications are skipped silently for users with no address,
    which is the usual reason mail 'does not work' for some people.
    """
    from config import settings as _s
    missing = db.execute("""
        SELECT username, display_name, auth_source
        FROM users
        WHERE is_active = 1 AND (email IS NULL OR TRIM(email) = '')
        ORDER BY username
    """).fetchall()
    total = db.execute("SELECT COUNT(*) c FROM users WHERE is_active=1").fetchone()["c"]
    return {
        "smtp_host":   _s.SMTP_HOST,
        "smtp_port":   _s.SMTP_PORT,
        "smtp_auth":   bool(_s.SMTP_USER),
        "from_address": _s.SMTP_FROM,
        "active_users": total,
        "users_without_email": [dict(r) for r in missing],
    }


@router.post("/email/test")
def email_test(to: str, user=Depends(require_admin)):
    """Admin-only: send one test email and report exactly what happened."""
    from notifier import send_email
    ok = send_email(
        to,
        f"[{settings.APP_NAME}] Test email",
        "<p>If you are reading this, Kairos can send mail.</p>",
    )
    if not ok:
        raise HTTPException(500, "Send failed — see the service log for the reason")
    return {"ok": True, "sent_to": to}
