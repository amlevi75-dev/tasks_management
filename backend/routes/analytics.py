from fastapi import APIRouter, Depends, Query, Request
from typing import Optional
from database import get_db
from database import _ConnWrapper as DbConn
from auth_helper import get_current_user
from routes.projects import check_project_access, get_project_role
from datetime import date

router = APIRouter()


@router.get("/{project_id}/analytics")
def project_analytics(
    request: Request,
    project_id: int,
    category_id: Optional[int] = None,
    date_from:   Optional[str] = None,   # YYYY-MM-DD, filters on created_at
    date_to:     Optional[str] = None,
    fv:          Optional[list[str]] = Query(None),  # custom field filter: "<field_id>:<value>"
    user=Depends(get_current_user),
    db: DbConn = Depends(get_db),
):
    check_project_access(db, project_id, user["user_id"])
    today = date.today().isoformat()
    # NOTE on the two GROUP BY clauses below that list extra columns
    # (u.display_name; c.name, c.color): SQLite silently allows selecting a
    # non-grouped, non-aggregated column and just picks a value from one row
    # of the group. Postgres enforces the SQL standard and rejects it with
    # GroupingError. Caught by running this endpoint against real Postgres
    # data during the migration, not by reading the SQL — worth checking any
    # other GROUP BY added later for the same pattern.

    # Same field_<id>=value convention as GET /tasks, so a filter chosen once
    # means the same thing whether it is applied to the task list or the
    # analytics dashboard.
    field_filters = {
        int(k[6:]): v
        for k, v in request.query_params.multi_items()
        if k.startswith("field_") and k[6:].isdigit() and v != ""
    }

    # A light member's dashboard covers only their own tasks
    role = get_project_role(db, project_id, user["user_id"])
    own_sql, own_params = "", []
    if role == "light_member":
        own_sql = " AND t.assignee_id = %s"
        own_params = [user["user_id"]]

    # Combined filter fragment + bound params (properly parameterised).
    # Named cat_sql/cat_params for continuity; now covers category AND date range.
    # Custom field filters. One EXISTS per field so multiple filters AND
    # together rather than fighting over a single join.
    fv_sql, fv_params = "", []
    for item in (fv or []):
        if ":" not in item:
            continue
        fid, _, want = item.partition(":")
        if not fid.strip().isdigit() or not want:
            continue
        fv_sql += (" AND EXISTS (SELECT 1 FROM task_field_values v"
                   " WHERE v.task_id = t.id AND v.field_id = %s AND v.value = %s)")
        fv_params += [int(fid), want]

    cat_sql    = own_sql + fv_sql
    cat_params = list(own_params) + list(fv_params)
    if category_id:
        cat_sql    += " AND t.category_id = %s"
        cat_params.append(category_id)
    if date_from:
        # date(t.created_at) -> t.created_at::date ; date(?) -> ?::date
        cat_sql    += " AND t.created_at::date >= %s::date"
        cat_params.append(date_from)
    if date_to:
        cat_sql    += " AND t.created_at::date <= %s::date"
        cat_params.append(date_to)
    for field_id, value in field_filters.items():
        cat_sql += """ AND EXISTS (
            SELECT 1 FROM task_field_values fv
            WHERE fv.task_id = t.id AND fv.field_id = %s AND fv.value = %s
        )"""
        cat_params.extend([field_id, value])

    # ── By status ─────────────────────────────────────────────────────────────
    by_status = db.execute(f"""
        SELECT t.status AS status, COUNT(*) AS count
        FROM tasks t
        WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.parent_task_id IS NULL{cat_sql}
        GROUP BY t.status
    """, [project_id, *cat_params]).fetchall()

    # ── By priority ───────────────────────────────────────────────────────────
    by_priority = db.execute(f"""
        SELECT t.priority AS priority, COUNT(*) AS count
        FROM tasks t
        WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.parent_task_id IS NULL{cat_sql}
        GROUP BY t.priority
    """, [project_id, *cat_params]).fetchall()

    # ── By assignee ───────────────────────────────────────────────────────────
    by_assignee = db.execute(f"""
        SELECT COALESCE(u.display_name, 'Unassigned') AS assignee,
               COUNT(*) AS total,
               SUM(CASE WHEN t.status  = 'done' THEN 1 ELSE 0 END) AS done,
               SUM(CASE WHEN t.status != 'done' THEN 1 ELSE 0 END) AS open
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.parent_task_id IS NULL{cat_sql}
        GROUP BY t.assignee_id, u.display_name
        ORDER BY total DESC
    """, [project_id, *cat_params]).fetchall()

    # ── By category (always unfiltered so the split stays visible) ────────────
    date_sql    = own_sql + fv_sql
    date_params = list(own_params) + list(fv_params)
    if date_from:
        date_sql += " AND t.created_at::date >= %s::date"; date_params.append(date_from)
    if date_to:
        date_sql += " AND t.created_at::date <= %s::date"; date_params.append(date_to)

    by_category = db.execute(f"""
        SELECT COALESCE(c.name,  'Uncategorized') AS category,
               COALESCE(c.color, '#64748b')       AS color,
               COUNT(*) AS count
        FROM tasks t
        LEFT JOIN project_categories c ON c.id = t.category_id
        WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.parent_task_id IS NULL{date_sql}
        GROUP BY t.category_id, c.name, c.color
        ORDER BY count DESC
    """, [project_id, *date_params]).fetchall()

    # ── Backlog ───────────────────────────────────────────────────────────────
    backlog = db.execute(f"""
        SELECT t.id, t.title, t.priority, t.due_date, t.created_at,
               COALESCE(u.display_name, 'Unassigned') AS assignee
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id = %s AND t.deleted_at IS NULL
              AND t.status IN ('new','open') AND t.parent_task_id IS NULL{cat_sql}
        ORDER BY t.created_at ASC
    """, [project_id, *cat_params]).fetchall()

    # ── Delayed ───────────────────────────────────────────────────────────────
    # julianday(a) - julianday(b) -> a::date - b::date, verified to return
    # the identical integer day-count in both engines (including for a
    # future due_date, which yields a negative number in both).
    delayed = db.execute(f"""
        SELECT t.id, t.title, t.priority, t.status, t.due_date,
               COALESCE(u.display_name, 'Unassigned') AS assignee,
               (%s::date - t.due_date::date) AS days_overdue
        FROM tasks t
        LEFT JOIN users u ON u.id = t.assignee_id
        WHERE t.project_id = %s AND t.deleted_at IS NULL
              AND t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < %s
              AND t.parent_task_id IS NULL{cat_sql}
        ORDER BY t.due_date ASC
    """, [today, project_id, today, *cat_params]).fetchall()

    # ── Weekly trend ──────────────────────────────────────────────────────────
    # strftime('%Y-W%W', ...) has no Postgres equivalent that means the same
    # thing — to_char(..., 'IYYY-"W"IW') is the ISO week and disagrees with
    # SQLite's %W by a full week on ordinary dates and by MORE at year
    # boundaries (verified: 2026-12-31 is W52 under SQLite's definition but
    # W53 under ISO). The expression below reproduces SQLite's exact
    # semantics — floor((day_of_year0 + 6 - isodow_of_jan1_0) / 7), Monday
    # start, week 00 for the partial first week — checked against SQLite's
    # own output across a full year including both boundaries.
    weekly = db.execute(f"""
        SELECT
            to_char(t.created_at, 'YYYY') || '-W' || lpad(
                floor(
                    (EXTRACT(doy FROM t.created_at)::int - 1 + 6
                     - (EXTRACT(isodow FROM date_trunc('year', t.created_at))::int - 1)) / 7
                )::text, 2, '0'
            ) AS week,
            COUNT(*) AS created,
            SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed
        FROM tasks t
        WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.parent_task_id IS NULL
              AND t.created_at >= (now() - interval '56 days'){cat_sql}
        GROUP BY week
        ORDER BY week
    """, [project_id, *cat_params]).fetchall()

    # ── Totals ────────────────────────────────────────────────────────────────
    totals = db.execute(f"""
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN t.status  = 'done'        THEN 1 ELSE 0 END) AS done,
               SUM(CASE WHEN t.status  = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
               SUM(CASE WHEN t.status IN ('new','open') THEN 1 ELSE 0 END) AS open,
               SUM(CASE WHEN t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < %s
                        THEN 1 ELSE 0 END) AS overdue
        FROM tasks t
        WHERE t.project_id = %s AND t.deleted_at IS NULL AND t.parent_task_id IS NULL{cat_sql}
    """, [today, project_id, *cat_params]).fetchone()

    def num(v):
        return v if v is not None else 0

    t = dict(totals) if totals else {}
    return {
        "totals": {
            "total":       num(t.get("total")),
            "done":        num(t.get("done")),
            "in_progress": num(t.get("in_progress")),
            "open":        num(t.get("open")),
            "overdue":     num(t.get("overdue")),
        },
        "range":       {"date_from": date_from, "date_to": date_to},
        "by_status":   [dict(r) for r in by_status],
        "by_priority": [dict(r) for r in by_priority],
        "by_assignee": [dict(r) for r in by_assignee],
        "by_category": [dict(r) for r in by_category],
        "backlog":     [dict(r) for r in backlog],
        "delayed":     [dict(r) for r in delayed],
        "weekly":      [dict(r) for r in weekly],
    }
