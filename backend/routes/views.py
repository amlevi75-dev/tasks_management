"""
Saved filter-view presets for the task list. Personal, not shared — each
user keeps their own set per project. Backend stores whatever JSON blob the
frontend sends; it does not interpret the filter shape, so adding a new
filter type client-side needs no backend change here.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
import psycopg2.errors
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user
from routes.projects import check_project_access

router = APIRouter()


class ViewCreate(BaseModel):
    name:     str
    filters:  dict
    position: Optional[int] = 0


class ViewUpdate(BaseModel):
    name:     Optional[str] = None
    filters:  Optional[dict] = None
    position: Optional[int] = None


@router.get("/{project_id}/views")
def list_views(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"])
    rows = db.execute(
        "SELECT * FROM saved_views WHERE project_id=%s AND user_id=%s ORDER BY position, id",
        (project_id, user["user_id"])
    ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["filters"] = json.loads(d["filters"])
        except (TypeError, ValueError):
            d["filters"] = {}
        out.append(d)
    return out


@router.post("/{project_id}/views")
def create_view(project_id: int, body: ViewCreate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"])
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    try:
        row = db.execute(
            "INSERT INTO saved_views (project_id, user_id, name, filters, position) VALUES (%s,%s,%s,%s,%s) RETURNING id",
            (project_id, user["user_id"], name, json.dumps(body.filters), body.position or 0)
        ).fetchone()
        db.commit()
    except psycopg2.errors.UniqueViolation:
        # A failed statement leaves the connection's transaction aborted
        # until rolled back — without this, every subsequent query on this
        # pooled connection would fail with "current transaction is aborted",
        # not just this request. Confirmed by reproducing it directly
        # against Postgres during this migration.
        db.rollback()
        raise HTTPException(status_code=409, detail="You already have a saved view with that name")
    result = db.execute("SELECT * FROM saved_views WHERE id=%s", (row["id"],)).fetchone()
    d = dict(result); d["filters"] = json.loads(d["filters"])
    return d


@router.patch("/{project_id}/views/{view_id}")
def update_view(project_id: int, view_id: int, body: ViewUpdate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"])
    existing = db.execute(
        "SELECT id FROM saved_views WHERE id=%s AND project_id=%s AND user_id=%s",
        (view_id, project_id, user["user_id"])
    ).fetchone()
    if not existing:
        raise HTTPException(status_code=404, detail="View not found")

    updates = body.model_dump(exclude_unset=True)
    if "filters" in updates and updates["filters"] is not None:
        updates["filters"] = json.dumps(updates["filters"])
    if not updates:
        row = db.execute("SELECT * FROM saved_views WHERE id=%s", (view_id,)).fetchone()
        d = dict(row); d["filters"] = json.loads(d["filters"])
        return d

    set_clause = ", ".join(f"{k}=%s" for k in updates)
    try:
        db.execute(f"UPDATE saved_views SET {set_clause} WHERE id=%s", (*updates.values(), view_id))
        db.commit()
    except psycopg2.errors.UniqueViolation:
        db.rollback()
        raise HTTPException(status_code=409, detail="You already have a saved view with that name")

    row = db.execute("SELECT * FROM saved_views WHERE id=%s", (view_id,)).fetchone()
    d = dict(row); d["filters"] = json.loads(d["filters"])
    return d


@router.delete("/{project_id}/views/{view_id}")
def delete_view(project_id: int, view_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"])
    db.execute(
        "DELETE FROM saved_views WHERE id=%s AND project_id=%s AND user_id=%s",
        (view_id, project_id, user["user_id"])
    )
    db.commit()
    return {"ok": True}
