from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user

router = APIRouter()

class ProjectCreate(BaseModel):
    name:        str
    description: Optional[str] = None
    color:       Optional[str] = "#3B82F6"

class ProjectUpdate(BaseModel):
    name:        Optional[str] = None
    description: Optional[str] = None
    color:       Optional[str] = None
    archived:    Optional[int] = None

class MemberAdd(BaseModel):
    user_id: int
    role:    str

# Role hierarchy (lowest to highest privilege).
#   light_member — sees ONLY tasks assigned to them; may edit/comment on those
#   viewer       — sees all tasks, read-only
#   member       — sees and edits all tasks
#   owner        — full control incl. settings, categories, fields, archive
ROLES_ORDER = ["light_member", "viewer", "member", "owner"]


def get_project_role(db, project_id, user_id):
    """Return the user's role in the project, or None if not a member."""
    row = db.execute(
        "SELECT role FROM project_members WHERE project_id=%s AND user_id=%s",
        (project_id, user_id)
    ).fetchone()
    return row["role"] if row else None


def check_project_access(db, project_id, user_id, min_role="viewer"):
    roles_order = ROLES_ORDER
    row = db.execute(
        "SELECT role FROM project_members WHERE project_id=%s AND user_id=%s",
        (project_id, user_id)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=403, detail="No access to project")
    if roles_order.index(row["role"]) < roles_order.index(min_role):
        raise HTTPException(status_code=403, detail=f"Requires {min_role} role")
    return row["role"]

# ── IMPORTANT: all fixed-string routes BEFORE /{project_id} wildcard ──────────

@router.get("")
def list_projects(user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    rows = db.execute("""
        SELECT p.*, pm.role, u.display_name as owner_name
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = %s
        JOIN users u ON u.id = p.owner_id
        WHERE p.archived = 0
        ORDER BY p.created_at DESC
    """, (user["user_id"],)).fetchall()
    return [dict(r) for r in rows]

@router.post("")
def create_project(body: ProjectCreate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    row = db.execute(
        "INSERT INTO projects (name, description, color, owner_id) VALUES (%s,%s,%s,%s) RETURNING id",
        (body.name, body.description, body.color, user["user_id"])
    ).fetchone()
    project_id = row["id"]
    db.execute(
        "INSERT INTO project_members (project_id, user_id, role) VALUES (%s,%s,%s)",
        (project_id, user["user_id"], "owner")
    )
    db.commit()
    result = db.execute("""
        SELECT p.*, pm.role, u.display_name as owner_name
        FROM projects p
        JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=%s
        JOIN users u ON u.id=p.owner_id
        WHERE p.id=%s
    """, (user["user_id"], project_id)).fetchone()
    return dict(result)

# Fixed string routes — MUST be before /{project_id} ──────────────────────────

@router.get("/archived-list")
def list_archived(user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    rows = db.execute("""
        SELECT p.*, pm.role, u.display_name as owner_name
        FROM projects p
        JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = %s
        JOIN users u ON u.id = p.owner_id
        WHERE p.archived = 1
        ORDER BY p.created_at DESC
    """, (user["user_id"],)).fetchall()
    return [dict(r) for r in rows]

# ── Wildcard project routes ────────────────────────────────────────────────────

@router.get("/{project_id}")
def get_project(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    my_role = check_project_access(db, project_id, user["user_id"])
    row = db.execute("""
        SELECT p.*, u.display_name as owner_name
        FROM projects p JOIN users u ON u.id = p.owner_id
        WHERE p.id=%s
    """, (project_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    members = db.execute("""
        SELECT u.id, u.username, u.display_name, u.email, pm.role
        FROM project_members pm JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id=%s
        ORDER BY pm.role DESC, u.display_name
    """, (project_id,)).fetchall()
    result         = dict(row)
    result["role"] = my_role
    result["members"] = [dict(m) for m in members]
    return result

@router.patch("/{project_id}")
def update_project(project_id: int, body: ProjectUpdate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    # exclude_unset (not the old dict()+filter-None) so a field explicitly
    # cleared to null actually clears — same class of bug fixed in tasks.py
    # and fields.py; body.dict() with "if v is not None" silently ignored it.
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    set_clause = ", ".join(f"{k}=%s" for k in updates)
    db.execute(f"UPDATE projects SET {set_clause} WHERE id=%s", (*updates.values(), project_id))
    db.commit()
    return dict(db.execute("SELECT * FROM projects WHERE id=%s", (project_id,)).fetchone())

@router.delete("/{project_id}")
def delete_project(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    db.execute("DELETE FROM projects WHERE id=%s", (project_id,))
    db.commit()
    return {"ok": True}

# Sub-resource routes — /{project_id}/xxx ─────────────────────────────────────

@router.post("/{project_id}/archive")
def archive_project(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    db.execute("UPDATE projects SET archived=1 WHERE id=%s", (project_id,))
    db.commit()
    return {"ok": True}

@router.post("/{project_id}/unarchive")
def unarchive_project(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    db.execute("UPDATE projects SET archived=0 WHERE id=%s", (project_id,))
    db.commit()
    return {"ok": True}

@router.post("/{project_id}/members")
def add_member(project_id: int, body: MemberAdd, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    if body.role not in ("owner", "member", "viewer", "light_member"):
        raise HTTPException(status_code=400, detail="Invalid role")
    db.execute(
        "INSERT INTO project_members (project_id, user_id, role) VALUES (%s,%s,%s) "
        "ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role",
        (project_id, body.user_id, body.role)
    )
    db.commit()
    return {"ok": True}

@router.delete("/{project_id}/members/{target_user_id}")
def remove_member(project_id: int, target_user_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    db.execute("DELETE FROM project_members WHERE project_id=%s AND user_id=%s", (project_id, target_user_id))
    db.commit()
    return {"ok": True}
