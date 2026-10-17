from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import os, uuid, re as _re, logging, threading
from pathlib import Path
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user, get_current_user_or_api_key
from routes.projects import check_project_access, get_project_role
from notifier import notify_task_assigned, notify_task_updated, notify_mention, notify_collaborator_added, notify_nodered
from config import settings

log = logging.getLogger("kairos.tasks")

def _notify_nodered_async(task: dict, event: str) -> None:
    """
    Run notify_nodered() on a background thread so a slow or hanging
    Node-RED flow never adds latency to the create/update request itself.
    notify_nodered() already never raises (see notifier.py), but it was
    previously called inline/synchronously, so the request still blocked
    for up to NODERED_TIMEOUT seconds waiting on the HTTP round-trip.
    daemon=True so a thread stuck past its own timeout can't block process
    shutdown.
    """
    threading.Thread(target=notify_nodered, args=(task, event), daemon=True).start()

router = APIRouter()

VALID_STATUSES   = ("new", "open", "in_progress", "done")
VALID_PRIORITIES = ("low", "medium", "high", "critical")

# Attachments live on local disk, independent of the database connection —
# moving the DB to a remote Postgres server does not move these files.
# settings.UPLOAD_DIR is its own config key for exactly this reason.
UPLOAD_DIR = Path(settings.UPLOAD_DIR)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

class TaskCreate(BaseModel):
    project_id:     int
    title:          str
    description:    Optional[str] = None
    status:         Optional[str] = "new"
    priority:       Optional[str] = "medium"
    assignee_id:    Optional[int] = None
    requester_id:   Optional[int] = None
    request_text:   Optional[str] = None      # free text request description
    start_date:     Optional[str] = None
    due_date:       Optional[str] = None
    parent_task_id: Optional[int] = None
    category_id:    Optional[int] = None

class TaskUpdate(BaseModel):
    title:          Optional[str] = None
    description:    Optional[str] = None
    status:         Optional[str] = None
    priority:       Optional[str] = None
    assignee_id:    Optional[int] = None
    requester_id:   Optional[int] = None
    request_text:   Optional[str] = None      # free text request description
    start_date:     Optional[str] = None
    due_date:       Optional[str] = None
    position:       Optional[int] = None
    parent_task_id: Optional[int] = None
    category_id:    Optional[int] = None

class CommentCreate(BaseModel):
    body: str

class MoveTask(BaseModel):
    status:   str
    position: int

def task_row(db, task_id):
    return db.execute("""
        SELECT t.*,
               a.display_name  as assignee_name,
               a.email         as assignee_email,
               r.display_name  as reporter_name,
               req.display_name as requester_name,
               t.request_text,
               cat.name        as category_name,
               cat.color       as category_color,
               p.name          as project_name,
               (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id=t.id AND s.deleted_at IS NULL) as subtask_count,
               (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id=t.id AND s.status='done'  AND s.deleted_at IS NULL) as subtask_done,
               (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id=t.id AND s.status!='done' AND s.deleted_at IS NULL) as subtask_open
        FROM tasks t
        LEFT JOIN users a   ON a.id   = t.assignee_id
        LEFT JOIN users r   ON r.id   = t.reporter_id
        LEFT JOIN users req ON req.id = t.requester_id
        JOIN  projects p    ON p.id   = t.project_id
        LEFT JOIN project_categories cat ON cat.id = t.category_id
        WHERE t.id = %s AND t.deleted_at IS NULL
    """, (task_id,)).fetchone()

def ensure_project_member(db, project_id, user_id, role="member"):
    existing = db.execute(
        "SELECT role FROM project_members WHERE project_id=%s AND user_id=%s",
        (project_id, user_id)
    ).fetchone()
    if not existing:
        db.execute(
            "INSERT INTO project_members (project_id, user_id, role) VALUES (%s,%s,%s)",
            (project_id, user_id, role)
        )

def is_task_collaborator(db, task_id, user_id):
    return db.execute(
        "SELECT 1 FROM task_collaborators WHERE task_id=%s AND user_id=%s",
        (task_id, user_id)
    ).fetchone() is not None


def require_task_access(db, task, user_id, write=False):
    """
    Authorise access to a single task, honouring the light_member role.

    light_member : may read AND write tasks they are ASSIGNED to or a
                   COLLABORATOR on. Every other task is invisible (404) —
                   being a project member alone is not enough.
    viewer       : may read every task; writes rejected.
    member/owner : unchanged behaviour.

    `task` is a row (or dict) carrying project_id, id/task_id and assignee_id.
    """
    project_id = task["project_id"]
    role = get_project_role(db, project_id, user_id)
    if not role:
        raise HTTPException(status_code=403, detail="No access to project")

    if role == "light_member":
        task_id = task.get("id") or task.get("task_id")
        is_mine = task["assignee_id"] == user_id
        is_collab = task_id is not None and is_task_collaborator(db, task_id, user_id)
        if not (is_mine or is_collab):
            # 404 not 403 — a light member must not learn the task exists
            raise HTTPException(status_code=404, detail="Task not found")
        return role

    if write and role == "viewer":
        raise HTTPException(status_code=403, detail="Requires member role")
    return role


# ── Fixed routes BEFORE wildcard /{task_id} ───────────────────────────────────

@router.get("/my/assigned")
def my_tasks(user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    """
    Tasks for "My Tasks": assigned to the user, or ones they collaborate on.
    is_collaborator distinguishes the two in the response so the frontend can
    label them differently if it wants to.
    """
    rows = db.execute("""
        SELECT t.*, p.name as project_name, r.display_name as reporter_name,
               req.display_name as requester_name,
               (t.assignee_id IS DISTINCT FROM %s) as is_collaborator
        FROM tasks t
        JOIN  projects p    ON p.id  = t.project_id
        LEFT JOIN users r   ON r.id  = t.reporter_id
        LEFT JOIN users req ON req.id= t.requester_id
        WHERE (
            t.assignee_id = %s
            OR EXISTS (SELECT 1 FROM task_collaborators tc
                       WHERE tc.task_id = t.id AND tc.user_id = %s)
        )
        AND t.status != 'done'
        AND t.parent_task_id IS NULL AND t.deleted_at IS NULL
        ORDER BY t.due_date ASC, t.created_at DESC
    """, (user["user_id"], user["user_id"], user["user_id"])).fetchall()
    return [dict(r) for r in rows]

@router.get("/trash")
def list_trash(project_id: Optional[int] = None, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    query = """
        SELECT t.*, a.display_name as assignee_name, r.display_name as reporter_name, p.name as project_name
        FROM tasks t
        JOIN  projects p  ON p.id = t.project_id
        JOIN  project_members pm ON pm.project_id = p.id AND pm.user_id = %s
        LEFT JOIN users a ON a.id = t.assignee_id
        LEFT JOIN users r ON r.id = t.reporter_id
        WHERE t.deleted_at IS NOT NULL
    """
    params = [user["user_id"]]
    # light_member sees tasks they are assigned to OR collaborating on —
    # never merely because they belong to the project.
    query += """ AND (pm.role != 'light_member' OR t.assignee_id = %s
                        OR EXISTS (SELECT 1 FROM task_collaborators tc
                                   WHERE tc.task_id = t.id AND tc.user_id = %s))"""
    params.append(user["user_id"])
    params.append(user["user_id"])
    if project_id:
        query += " AND t.project_id = %s"; params.append(project_id)
    query += " ORDER BY t.deleted_at DESC"
    return [dict(r) for r in db.execute(query, params).fetchall()]

@router.post("/trash/{task_id}/restore")
def restore_task(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = db.execute("SELECT * FROM tasks WHERE id=%s", (task_id,)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    db.execute("UPDATE tasks SET deleted_at=NULL WHERE id=%s", (task_id,))
    db.commit()
    return {"ok": True}

@router.delete("/trash/{task_id}/permanent")
def permanent_delete(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = db.execute("SELECT * FROM tasks WHERE id=%s", (task_id,)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    check_project_access(db, row["project_id"], user["user_id"], min_role="owner")
    db.execute("DELETE FROM tasks WHERE id=%s", (task_id,))
    db.commit()
    return {"ok": True}

@router.get("/field-values/bulk")
def bulk_field_values(
    project_id: int,
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db),
):
    """
    All custom field values for every visible task in a project, in one call.

    Avoids the N+1 pattern of asking per task when the list view renders
    custom fields as columns. Returns {task_id: {field_id: value}}.
    """
    check_project_access(db, project_id, user["user_id"])
    role = get_project_role(db, project_id, user["user_id"])

    own_sql, own_params = "", []
    if role == "light_member":
        own_sql = " AND t.assignee_id = %s"
        own_params = [user["user_id"]]

    rows = db.execute(f"""
        SELECT v.task_id, v.field_id, v.value
        FROM task_field_values v
        JOIN tasks t ON t.id = v.task_id
        WHERE t.project_id = %s AND t.deleted_at IS NULL{own_sql}
    """, [project_id, *own_params]).fetchall()

    out = {}
    for r in rows:
        out.setdefault(str(r["task_id"]), {})[str(r["field_id"])] = r["value"]
    return out


@router.get("")
def list_tasks(
    request: Request,
    project_id:  Optional[int]  = None,
    status:      Optional[str]  = None,
    assignee_id: Optional[int]  = None,
    parent_only:  Optional[bool] = True,
    category_id:  Optional[int]  = None,
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db)
):
    # Custom field filters arrive as field_<id>=value, one per filterable
    # field the caller chose to filter on. Not fixed parameters because the
    # field set is defined per project and changes as owners add fields.
    field_filters = {
        int(k[6:]): v
        for k, v in request.query_params.multi_items()
        if k.startswith("field_") and k[6:].isdigit() and v != ""
    }
    query = """
        SELECT t.*, a.display_name as assignee_name, r.display_name as reporter_name,
               req.display_name as requester_name, p.name as project_name,
               (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id=t.id AND s.deleted_at IS NULL) as subtask_count,
               (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id=t.id AND s.status='done' AND s.deleted_at IS NULL) as subtask_done,
               cat.name as category_name, cat.color as category_color,
               (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id=t.id) as comment_count
        FROM tasks t
        JOIN  projects p    ON p.id  = t.project_id
        JOIN  project_members pm ON pm.project_id = p.id AND pm.user_id = %s
        LEFT JOIN users a   ON a.id  = t.assignee_id
        LEFT JOIN users r   ON r.id  = t.reporter_id
        LEFT JOIN users req ON req.id= t.requester_id
        LEFT JOIN project_categories cat ON cat.id = t.category_id
        WHERE t.deleted_at IS NULL
    """
    params = [user["user_id"]]
    # light_member sees only tasks assigned to them
    # light_member sees tasks they are assigned to OR collaborating on —
    # never merely because they belong to the project.
    query += """ AND (pm.role != 'light_member' OR t.assignee_id = %s
                        OR EXISTS (SELECT 1 FROM task_collaborators tc
                                   WHERE tc.task_id = t.id AND tc.user_id = %s))"""
    params.append(user["user_id"])
    params.append(user["user_id"])
    if project_id:   query += " AND t.project_id = %s";   params.append(project_id)
    if status:       query += " AND t.status = %s";        params.append(status)
    if assignee_id:  query += " AND t.assignee_id = %s";   params.append(assignee_id)
    if category_id:  query += " AND t.category_id = %s"; params.append(category_id)
    for field_id, value in field_filters.items():
        query += """ AND EXISTS (
            SELECT 1 FROM task_field_values fv
            WHERE fv.task_id = t.id AND fv.field_id = %s AND fv.value = %s
        )"""
        params.extend([field_id, value])
    if parent_only:  query += " AND t.parent_task_id IS NULL"
    query += " ORDER BY t.position ASC, t.created_at DESC"
    return [dict(r) for r in db.execute(query, params).fetchall()]

@router.post("")
def create_task(body: TaskCreate, user=Depends(get_current_user_or_api_key), db: DbConn = Depends(get_db)):
    role = get_project_role(db, body.project_id, user["user_id"])
    if not role:
        raise HTTPException(status_code=403, detail="No access to project")
    if role == "viewer":
        raise HTTPException(status_code=403, detail="Requires member role")
    if role == "light_member" and body.assignee_id != user["user_id"]:
        raise HTTPException(status_code=403, detail="Light members may only create tasks assigned to themselves")
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if body.priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail="Invalid priority")
    if body.parent_task_id:
        parent = db.execute("SELECT project_id FROM tasks WHERE id=%s AND deleted_at IS NULL", (body.parent_task_id,)).fetchone()
        if not parent or parent["project_id"] != body.project_id:
            raise HTTPException(status_code=400, detail="Invalid parent task")
    new_row = db.execute(
        """INSERT INTO tasks (project_id, title, description, status, priority,
               assignee_id, reporter_id, requester_id, request_text, start_date, due_date, parent_task_id, category_id)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
        (body.project_id, body.title, body.description, body.status, body.priority,
         body.assignee_id, user["user_id"], body.requester_id, body.request_text,
         body.start_date, body.due_date, body.parent_task_id, body.category_id)
    ).fetchone()
    task_id = new_row["id"]
    if body.assignee_id:
        ensure_project_member(db, body.project_id, body.assignee_id, "member")
    if body.requester_id:
        ensure_project_member(db, body.project_id, body.requester_id, "viewer")
    db.commit()
    if body.assignee_id:
        notify_task_assigned(db, task_id)
    result = dict(task_row(db, task_id))
    _notify_nodered_async(result, "task.created")
    return result

@router.post("/{task_id}/move")
def move_task(task_id: int, body: MoveTask, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    db.execute("UPDATE tasks SET status=%s, position=%s, updated_at=now() WHERE id=%s",
               (body.status, body.position, task_id))
    db.commit()
    return {"ok": True}

@router.get("/{task_id}/comments")
def list_comments(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    """Comments for one task. Used by the list-view popover so it does not
    have to pull the entire task (subtasks, attachments, dependencies)."""
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"])
    rows = db.execute("""
        SELECT c.*, u.display_name
        FROM task_comments c
        LEFT JOIN users u ON u.id = c.user_id
        WHERE c.task_id = %s
        ORDER BY c.created_at
    """, (task_id,)).fetchall()
    return [dict(r) for r in rows]


@router.post("/{task_id}/comments")
def add_comment(task_id: int, body: CommentCreate, user=Depends(get_current_user_or_api_key), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"])
    db.execute("INSERT INTO task_comments (task_id, user_id, body) VALUES (%s,%s,%s)",
               (task_id, user["user_id"], body.body))
    db.commit()

    # The assignee's "task updated" email should show the comment itself, not
    # just "New comment by X" with no content. Preview length matches the
    # mention email for consistency.
    preview = body.body[:300] + ("…" if len(body.body) > 300 else "")
    notify_task_updated(
        db, task_id, user["display_name"],
        f"New comment by {user['display_name']}: {preview}",
        change={"kind": "comment", "by": user["display_name"], "preview": preview},
    )

    # Mention detection is deliberately independent of assignment — anyone
    # named with @username in a comment gets emailed, whether or not they
    # are the task's assignee. Logged explicitly at each decision point so a
    # "why didn't X get an email" report can be answered from the log
    # instead of re-reading this code.
    mentioned_usernames = set(_re.findall(r"@([\w.]+)", body.body))
    mention_report = []   # returned in the response so this is verifiable
                           # without depending on log files ever reaching disk

    # @all expands to every active member of the task's project, not a real
    # username — handled separately so it never hits the per-username
    # lookup below (which would just report it as "no_account").
    if "all" in mentioned_usernames:
        mentioned_usernames.discard("all")
        members = db.execute("""
            SELECT u.id, u.email, u.display_name
            FROM project_members pm JOIN users u ON u.id = pm.user_id
            WHERE pm.project_id = %s AND u.is_active = 1
        """, (row["project_id"],)).fetchall()
        log.info("Task %s comment @all: notifying %d project member(s)", task_id, len(members))
        for m in members:
            if m["id"] == user["user_id"]:
                mention_report.append({"username": "all", "result": "self_mention_skipped",
                                        "display_name": m["display_name"]})
                continue
            if not m["email"]:
                log.warning("@all: user '%s' has no email address on file", m["display_name"])
                mention_report.append({"username": "all", "result": "no_email_on_file",
                                        "display_name": m["display_name"]})
                continue
            sent = notify_mention(db, task_id, m["id"], user["display_name"], body.body)
            mention_report.append({
                "username": "all", "result": "notified" if sent else "email_send_failed",
                "display_name": m["display_name"], "email": m["email"],
            })

    if mentioned_usernames:
        log.info("Task %s comment mentions: %s", task_id, sorted(mentioned_usernames))
    for username in mentioned_usernames:
        mentioned = db.execute("SELECT id, email, display_name FROM users WHERE username=%s AND is_active=1", (username,)).fetchone()
        if not mentioned:
            log.warning("Mentioned username '%s' has no active user account — "
                        "they must sign in to Kairos at least once before they "
                        "can be mentioned or added to a project", username)
            mention_report.append({"username": username, "result": "no_account"})
            continue
        if mentioned["id"] == user["user_id"]:
            log.debug("Skipping self-mention for '%s'", username)
            mention_report.append({"username": username, "result": "self_mention_skipped"})
            continue
        if not mentioned["email"]:
            log.warning("Mentioned user '%s' has no email address on file", mentioned["display_name"])
            mention_report.append({"username": username, "result": "no_email_on_file",
                                    "display_name": mentioned["display_name"]})
            continue
        # notify_mention is intentionally unconditional on assignment/role —
        # anyone @mentioned gets emailed. Its return value is the true SMTP
        # outcome, not just "the code path ran" — reported back so this is
        # provable per-request rather than depending on a log line.
        sent = notify_mention(db, task_id, mentioned["id"], user["display_name"], body.body)
        mention_report.append({
            "username": username,
            "result": "notified" if sent else "email_send_failed",
            "display_name": mentioned["display_name"], "email": mentioned["email"],
        })
    return {"ok": True, "mentions": mention_report}

# ── Attachment upload ─────────────────────────────────────────────────────────

@router.post("/{task_id}/attachments")
async def upload_attachment(
    task_id: int,
    file: UploadFile = File(...),
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db)
):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)

    # Limit 20 MB
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 20 MB)")

    stored_name = f"{task_id}_{uuid.uuid4().hex}_{file.filename}"
    (UPLOAD_DIR / stored_name).write_bytes(data)

    new_row = db.execute(
        "INSERT INTO task_attachments (task_id, filename, stored_name, size, uploaded_by) VALUES (%s,%s,%s,%s,%s) RETURNING id",
        (task_id, file.filename, stored_name, len(data), user["user_id"])
    ).fetchone()
    db.commit()
    return {"id": new_row["id"], "filename": file.filename, "size": len(data)}

@router.get("/{task_id}/attachments/{att_id}/download")
def download_attachment(
    task_id: int, att_id: int,
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db)
):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"])
    att = db.execute("SELECT * FROM task_attachments WHERE id=%s AND task_id=%s", (att_id, task_id)).fetchone()
    if not att: raise HTTPException(status_code=404, detail="Attachment not found")
    path = UPLOAD_DIR / att["stored_name"]
    if not path.exists(): raise HTTPException(status_code=404, detail="File missing on server")
    return FileResponse(str(path), filename=att["filename"])

@router.delete("/{task_id}/attachments/{att_id}")
def delete_attachment(
    task_id: int, att_id: int,
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db)
):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    att = db.execute("SELECT * FROM task_attachments WHERE id=%s AND task_id=%s", (att_id, task_id)).fetchone()
    if not att: raise HTTPException(status_code=404, detail="Attachment not found")
    try: (UPLOAD_DIR / att["stored_name"]).unlink()
    except: pass
    db.execute("DELETE FROM task_attachments WHERE id=%s", (att_id,))
    db.commit()
    return {"ok": True}

# ── Dependency endpoints ──────────────────────────────────────────────────────

class DepCreate(BaseModel):
    depends_on_id: int
    dep_type:      Optional[str] = "finish_to_start"

# ── Collaborators ─────────────────────────────────────────────────────────────
# A second, unlimited set of people on a task, distinct from the single
# required assignee. They can see, comment on, and edit the task the same as
# the assignee (subject to their project role), and are notified the same way.

class CollaboratorAdd(BaseModel):
    user_id: int


@router.get("/{task_id}/collaborators")
def list_collaborators(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"])
    rows = db.execute("""
        SELECT u.id, u.username, u.display_name, u.email, tc.added_at
        FROM task_collaborators tc
        JOIN users u ON u.id = tc.user_id
        WHERE tc.task_id = %s
        ORDER BY u.display_name
    """, (task_id,)).fetchall()
    return [dict(r) for r in rows]


@router.post("/{task_id}/collaborators")
def add_collaborator(task_id: int, body: CollaboratorAdd, user=Depends(get_current_user_or_api_key), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)

    # Must be a member of the same project — collaboration does not itself
    # grant project access, it only extends what a light_member can see once
    # they already have some standing in the project.
    target_role = get_project_role(db, row["project_id"], body.user_id)
    if not target_role:
        raise HTTPException(status_code=400, detail="User is not a member of this project")

    if body.user_id == row["assignee_id"]:
        raise HTTPException(status_code=400, detail="User is already the assignee")

    db.execute("""
        INSERT INTO task_collaborators (task_id, user_id, added_by)
        VALUES (%s,%s,%s)
        ON CONFLICT(task_id, user_id) DO NOTHING
    """, (task_id, body.user_id, user["user_id"]))
    db.commit()

    notify_collaborator_added(db, task_id, body.user_id, user["display_name"])
    return {"ok": True}


@router.delete("/{task_id}/collaborators/{collab_user_id}")
def remove_collaborator(task_id: int, collab_user_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    db.execute("DELETE FROM task_collaborators WHERE task_id=%s AND user_id=%s", (task_id, collab_user_id))
    db.commit()
    return {"ok": True}


@router.get("/{task_id}/dependencies")
def get_dependencies(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"])
    # Tasks this task depends on (blockers)
    blockers = db.execute("""
        SELECT d.id as dep_id, d.dep_type, t.id, t.title, t.status, t.priority
        FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
        WHERE d.task_id = %s AND t.deleted_at IS NULL
    """, (task_id,)).fetchall()
    # Tasks blocked by this task
    blocking = db.execute("""
        SELECT d.id as dep_id, d.dep_type, t.id, t.title, t.status, t.priority
        FROM task_dependencies d JOIN tasks t ON t.id = d.task_id
        WHERE d.depends_on_id = %s AND t.deleted_at IS NULL
    """, (task_id,)).fetchall()
    return {"blockers": [dict(r) for r in blockers], "blocking": [dict(r) for r in blocking]}

@router.post("/{task_id}/dependencies")
def add_dependency(task_id: int, body: DepCreate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    if body.depends_on_id == task_id:
        raise HTTPException(status_code=400, detail="A task cannot depend on itself")
    # Prevent circular: check if depends_on_id already depends on task_id
    circular = db.execute(
        "SELECT 1 FROM task_dependencies WHERE task_id=%s AND depends_on_id=%s",
        (body.depends_on_id, task_id)
    ).fetchone()
    if circular:
        raise HTTPException(status_code=400, detail="Circular dependency detected")
    try:
        db.execute(
            "INSERT INTO task_dependencies (task_id, depends_on_id, dep_type) VALUES (%s,%s,%s)",
            (task_id, body.depends_on_id, body.dep_type)
        )
        db.commit()
    except Exception:
        # A failed INSERT leaves the connection's transaction aborted until
        # rolled back — without this, the next query on this pooled
        # connection fails with "current transaction is aborted", not just
        # this one. Reproduced directly against Postgres during migration
        # testing; same fix applied everywhere else an INSERT is caught.
        db.rollback()
        raise HTTPException(status_code=409, detail="Dependency already exists")
    return {"ok": True}

@router.delete("/{task_id}/dependencies/{dep_id}")
def remove_dependency(task_id: int, dep_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    db.execute("DELETE FROM task_dependencies WHERE id=%s AND task_id=%s", (dep_id, task_id))
    db.commit()
    return {"ok": True}

# ── Wildcard routes LAST ───────────────────────────────────────────────────────

@router.get("/{task_id}")
def get_task(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    role = require_task_access(db, row, user["user_id"])
    comments = db.execute("""
        SELECT c.*, u.display_name FROM task_comments c
        LEFT JOIN users u ON u.id = c.user_id WHERE c.task_id=%s ORDER BY c.created_at
    """, (task_id,)).fetchall()
    subtasks = db.execute("""
        SELECT t.*, a.display_name as assignee_name, r.display_name as reporter_name,
               req.display_name as requester_name
        FROM tasks t
        LEFT JOIN users a   ON a.id   = t.assignee_id
        LEFT JOIN users r   ON r.id   = t.reporter_id
        LEFT JOIN users req ON req.id = t.requester_id
        WHERE t.parent_task_id=%s AND t.deleted_at IS NULL ORDER BY t.created_at ASC
    """, (task_id,)).fetchall()
    attachments = db.execute("""
        SELECT a.id, a.filename, a.size, a.created_at, u.display_name as uploader
        FROM task_attachments a
        LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE a.task_id=%s ORDER BY a.created_at
    """, (task_id,)).fetchall()
    result = dict(row)
    deps = db.execute("""
        SELECT d.id as dep_id, d.dep_type, t.id, t.title, t.status, t.priority
        FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_id
        WHERE d.task_id = %s AND t.deleted_at IS NULL
    """, (task_id,)).fetchall()
    collaborators = db.execute("""
        SELECT u.id, u.username, u.display_name, u.email
        FROM task_collaborators tc JOIN users u ON u.id = tc.user_id
        WHERE tc.task_id = %s ORDER BY u.display_name
    """, (task_id,)).fetchall()

    result["comments"]     = [dict(c) for c in comments]
    # A light member only sees subtasks assigned to them
    if role == "light_member":
        subtasks = [s for s in subtasks if s["assignee_id"] == user["user_id"]]
    result["subtasks"]       = [dict(s) for s in subtasks]
    result["attachments"]    = [dict(a) for a in attachments]
    result["dependencies"]   = [dict(d) for d in deps]
    result["collaborators"]  = [dict(cb) for cb in collaborators]
    return result

@router.patch("/{task_id}")
def update_task(task_id: int, body: TaskUpdate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)

    # Only fields the client actually sent. Using exclude_unset (rather than
    # dropping None) is what lets a field be explicitly cleared: "assignee_id":
    # null must unassign, not be silently ignored. Inline editing in the list
    # view relies on this.
    updates = body.model_dump(exclude_unset=True)
    # Fields that must never be NULL, even if sent as null
    for k in ("title", "status", "priority"):
        if k in updates and updates[k] is None:
            del updates[k]
    if not updates: return dict(row)

    if "status" in updates:
        if updates["status"] not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        # Block closing task if open subtasks exist
        if updates["status"] == "done" and row["subtask_open"] > 0:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot close task — {row['subtask_open']} subtask(s) still open"
            )
        # Block closing task if blocking dependencies are not done
        if updates["status"] == "done":
            blocking = db.execute("""
                SELECT t.title FROM task_dependencies d
                JOIN tasks t ON t.id = d.depends_on_id
                WHERE d.task_id = %s AND t.status != 'done' AND t.deleted_at IS NULL
            """, (task_id,)).fetchall()
            if blocking:
                titles = ", ".join(f'"{r["title"]}"' for r in blocking[:3])
                raise HTTPException(
                    status_code=400,
                    detail=f"Cannot close task — blocked by: {titles}"
                )

    new_assignee  = updates.get("assignee_id")
    new_requester = updates.get("requester_id")
    if new_assignee and new_assignee != row["assignee_id"]:
        ensure_project_member(db, row["project_id"], new_assignee, "member")
    if new_requester:
        ensure_project_member(db, row["project_id"], new_requester, "viewer")

    set_clause = ", ".join(f"{k}=%s" for k in updates) + ", updated_at=now()"
    db.execute(f"UPDATE tasks SET {set_clause} WHERE id=%s", (*updates.values(), task_id))
    db.commit()

    if new_assignee and new_assignee != row["assignee_id"]:
        notify_task_assigned(db, task_id)
    elif updates.get("status"):
        notify_task_updated(db, task_id, user["display_name"], f"Status → {updates['status'].replace('_',' ').title()}",
                            change={"kind": "status", "status": updates["status"]})
    result = dict(task_row(db, task_id))
    _notify_nodered_async(result, "task.updated")
    return result

@router.delete("/{task_id}")
def delete_task(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = task_row(db, task_id)
    if not row: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, row, user["user_id"], write=True)
    db.execute("UPDATE tasks SET deleted_at=now() WHERE id=%s OR parent_task_id=%s", (task_id, task_id))
    db.commit()
    return {"ok": True}


# ── Custom field values ────────────────────────────────────────────────────────
# Mounted under /api/tasks so URLs are /api/tasks/{task_id}/field-values

class FieldValueSet(BaseModel):
    field_id: int
    value:    Optional[str] = None

@router.get("/{task_id}/field-values")
def get_field_values(task_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    task = db.execute("SELECT id, project_id, assignee_id FROM tasks WHERE id=%s AND deleted_at IS NULL", (task_id,)).fetchone()
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, task, user["user_id"])
    rows = db.execute("""
        SELECT f.id as field_id, f.label, f.field_type, f.options, f.required, f.position,
               v.value, v.id as value_id
        FROM project_field_definitions f
        LEFT JOIN task_field_values v ON v.field_id = f.id AND v.task_id = %s
        WHERE f.project_id = %s
        ORDER BY f.position, f.id
    """, (task_id, task["project_id"])).fetchall()
    return [dict(r) for r in rows]

@router.post("/{task_id}/field-values")
def set_field_value(task_id: int, body: FieldValueSet, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    task = db.execute("SELECT id, project_id, assignee_id FROM tasks WHERE id=%s AND deleted_at IS NULL", (task_id,)).fetchone()
    if not task: raise HTTPException(status_code=404, detail="Task not found")
    require_task_access(db, task, user["user_id"], write=True)
    field = db.execute(
        "SELECT id FROM project_field_definitions WHERE id=%s AND project_id=%s",
        (body.field_id, task["project_id"])
    ).fetchone()
    if not field: raise HTTPException(status_code=404, detail="Field not found")
    db.execute("""
        INSERT INTO task_field_values (task_id, field_id, value, updated_at)
        VALUES (%s,%s,%s,now())
        ON CONFLICT(task_id, field_id) DO UPDATE
        SET value=excluded.value, updated_at=excluded.updated_at
    """, (task_id, body.field_id, body.value))
    db.commit()
    return {"ok": True}
