from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user
from routes.projects import check_project_access

router = APIRouter()

VALID_TYPES = ("text", "number", "date", "list")

class FieldCreate(BaseModel):
    label:      str
    field_type: str = "text"
    options:    Optional[str] = None   # JSON string for list type
    required:   Optional[int] = 0
    position:   Optional[int] = 0
    filterable: Optional[int] = 1      # shown as a filter in list view + analytics

class FieldUpdate(BaseModel):
    label:      Optional[str] = None
    options:    Optional[str] = None
    required:   Optional[int] = None
    position:   Optional[int] = None
    filterable: Optional[int] = None

class FieldValueSet(BaseModel):
    field_id: int
    value:    Optional[str] = None

# ── Field definitions (project-scoped) ────────────────────────────────────────

@router.get("/{project_id}/fields")
def list_fields(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"])
    rows = db.execute(
        "SELECT * FROM project_field_definitions WHERE project_id=%s ORDER BY position, id",
        (project_id,)
    ).fetchall()
    return [dict(r) for r in rows]

@router.post("/{project_id}/fields")
def create_field(project_id: int, body: FieldCreate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    if body.field_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid field_type. Must be one of: {VALID_TYPES}")
    if body.field_type == "list" and body.options:
        try: json.loads(body.options)
        except: raise HTTPException(status_code=400, detail="options must be valid JSON array")
    row = db.execute(
        "INSERT INTO project_field_definitions (project_id, label, field_type, options, required, position, filterable) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (project_id, body.label.strip(), body.field_type, body.options, body.required or 0, body.position or 0,
         1 if body.filterable is None else body.filterable)
    ).fetchone()
    db.commit()
    return dict(db.execute("SELECT * FROM project_field_definitions WHERE id=%s", (row["id"],)).fetchone())

@router.patch("/{project_id}/fields/{field_id}")
def update_field(project_id: int, field_id: int, body: FieldUpdate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    row = db.execute("SELECT * FROM project_field_definitions WHERE id=%s AND project_id=%s", (field_id, project_id)).fetchone()
    if not row: raise HTTPException(status_code=404, detail="Field not found")
    # exclude_unset (not "drop None") — a field explicitly set to null/0
    # must actually apply. dict()+filter-None silently ignores clearing a
    # value, e.g. turning filterable off, the same bug fixed in tasks.py.
    updates = body.model_dump(exclude_unset=True)
    if not updates: return dict(row)
    if "options" in updates and updates["options"]:
        try: json.loads(updates["options"])
        except: raise HTTPException(status_code=400, detail="options must be valid JSON array")
    set_clause = ", ".join(f"{k}=%s" for k in updates)
    db.execute(f"UPDATE project_field_definitions SET {set_clause} WHERE id=%s", (*updates.values(), field_id))
    db.commit()
    return dict(db.execute("SELECT * FROM project_field_definitions WHERE id=%s", (field_id,)).fetchone())

@router.delete("/{project_id}/fields/{field_id}")
def delete_field(project_id: int, field_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    db.execute("DELETE FROM project_field_definitions WHERE id=%s AND project_id=%s", (field_id, project_id))
    db.commit()
    return {"ok": True}

@router.post("/{project_id}/fields/reorder")
def reorder_fields(project_id: int, order: list[int], user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    for pos, field_id in enumerate(order):
        db.execute("UPDATE project_field_definitions SET position=%s WHERE id=%s AND project_id=%s", (pos, field_id, project_id))
    db.commit()
    return {"ok": True}
