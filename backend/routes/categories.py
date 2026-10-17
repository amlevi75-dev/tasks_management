from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user
from routes.projects import check_project_access

router = APIRouter()

class CategoryCreate(BaseModel):
    name:     str
    color:    Optional[str] = "#64748b"
    position: Optional[int] = 0

class CategoryUpdate(BaseModel):
    name:     Optional[str] = None
    color:    Optional[str] = None
    position: Optional[int] = None

@router.get("/{project_id}/categories")
def list_categories(project_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"])
    rows = db.execute(
        "SELECT * FROM project_categories WHERE project_id=%s ORDER BY position, name",
        (project_id,)
    ).fetchall()
    return [dict(r) for r in rows]

@router.post("/{project_id}/categories")
def create_category(project_id: int, body: CategoryCreate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    try:
        row = db.execute(
            "INSERT INTO project_categories (project_id, name, color, position) VALUES (%s,%s,%s,%s) RETURNING id",
            (project_id, body.name.strip(), body.color, body.position)
        ).fetchone()
        db.commit()
        return dict(db.execute("SELECT * FROM project_categories WHERE id=%s", (row["id"],)).fetchone())
    except HTTPException:
        raise
    except Exception:
        db.rollback()
        raise HTTPException(status_code=409, detail="Category name already exists")

@router.patch("/{project_id}/categories/{cat_id}")
def update_category(project_id: int, cat_id: int, body: CategoryUpdate, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    updates = body.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="Nothing to update")
    set_clause = ", ".join(f"{k}=%s" for k in updates)
    db.execute(f"UPDATE project_categories SET {set_clause} WHERE id=%s AND project_id=%s", (*updates.values(), cat_id, project_id))
    db.commit()
    return dict(db.execute("SELECT * FROM project_categories WHERE id=%s", (cat_id,)).fetchone())

@router.delete("/{project_id}/categories/{cat_id}")
def delete_category(project_id: int, cat_id: int, user=Depends(get_current_user), db: DbConn = Depends(get_db)):
    check_project_access(db, project_id, user["user_id"], min_role="owner")
    db.execute("DELETE FROM project_categories WHERE id=%s AND project_id=%s", (cat_id, project_id))
    db.commit()
    return {"ok": True}
