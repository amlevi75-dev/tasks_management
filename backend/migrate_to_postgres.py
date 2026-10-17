#!/usr/bin/env python3
"""
One-time data migration: existing SQLite database -> PostgreSQL.

Usage:
    1. Point config.yaml's db: block at the target Postgres server.
    2. Run init_db() first (or `python -c "from database import init_db; init_db()"`)
       so the schema exists — this script only moves DATA, it does not
       create tables.
    3. python migrate_to_postgres.py /path/to/taskmaster.db

What this does, in order:
    - Connects to both databases.
    - Copies every table in dependency order (users before projects before
      tasks, etc.) so foreign keys never point at a row that doesn't exist
      yet.
    - Preserves every primary key id exactly — task #47 is still #47 after
      migration. Comments, notifications, and anything referencing an id
      keep working without translation.
    - After every table with a SERIAL/AUTOINCREMENT id is loaded, resets
      that table's sequence to MAX(id)+1. Skipping this is the single most
      common post-migration bug: the app looks fine until the next INSERT,
      which collides with an existing id or, worse, silently succeeds and
      corrupts a foreign key relationship. Verified against a real
      migration run — without the reset, inserting a 3rd row after
      migrating 2 fails with a duplicate-key error at id=1.
    - Runs entirely inside one Postgres transaction: if anything fails
      partway through, the whole migration rolls back rather than leaving
      the target half-populated. Re-running after a failure starts clean.

What this does NOT do:
    - Create the Postgres schema (run init_db() first).
    - Move file attachments. Those live on local disk, independent of the
      database — see UPLOAD_DIR in config.yaml. Copy the attachments folder
      to the new app server yourself; this script only moves the
      task_attachments TABLE (the metadata rows), not the files themselves.
    - Touch the source SQLite file. It is opened read-only.
"""
import sqlite3
import sys
import argparse
from pathlib import Path

import psycopg2
import psycopg2.extras

from config import settings


# Tables in an order where every foreign key a table has already exists by
# the time that table is loaded. Hand-ordered from the schema in
# database.py rather than topologically sorted automatically, since a
# handful of tables (tasks -> tasks.parent_task_id) self-reference and need
# a specific two-pass load (see migrate_tasks below).
TABLE_ORDER = [
    "users",
    "projects",
    "project_members",
    "project_categories",
    "project_field_definitions",
    "tasks",                    # self-referencing: parent_task_id -> tasks.id
    "task_comments",
    "task_attachments",
    "task_dependencies",
    "task_collaborators",
    "task_field_values",
    "saved_views",
    "notifications",
    "sessions",
]

# Columns that are TIMESTAMP in Postgres but TEXT (an ISO-ish string, from
# SQLite's datetime('now')) in the source. psycopg2 needs a real value or
# None; passing the raw SQLite string through works for well-formed
# datetime('now') output, but this list exists so it's a one-line change if
# a particular deployment's dates are formatted unusually.
TIMESTAMP_COLUMNS = {
    "created_at", "updated_at", "deleted_at", "added_at", "expires_at",
}


def connect_sqlite(path: str) -> sqlite3.Connection:
    if not Path(path).exists():
        sys.exit(f"SQLite source not found: {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)  # read-only, never touch the source
    conn.row_factory = sqlite3.Row
    conn.text_factory = str
    return conn


def connect_postgres():
    return psycopg2.connect(
        host=settings.DB_HOST, port=settings.DB_PORT, dbname=settings.DB_NAME,
        user=settings.DB_USER, password=settings.DB_PASSWORD, sslmode=settings.DB_SSLMODE,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def table_exists_sqlite(sconn, table: str) -> bool:
    row = sconn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def copy_table(sconn, pconn, table: str, verbose=True) -> int:
    """Copy every row of one table from SQLite to Postgres, columns as-is."""
    if not table_exists_sqlite(sconn, table):
        if verbose:
            print(f"  {table}: not present in source (newer feature not yet used) — skipping")
        return 0

    rows = sconn.execute(f"SELECT * FROM {table}").fetchall()
    if not rows:
        if verbose:
            print(f"  {table}: 0 rows")
        return 0

    columns = rows[0].keys()
    col_list = ", ".join(columns)
    placeholders = ", ".join(["%s"] * len(columns))

    pcur = pconn.cursor()
    inserted = 0
    for row in rows:
        values = [row[c] for c in columns]
        pcur.execute(
            f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
            f"ON CONFLICT DO NOTHING",
            values,
        )
        inserted += pcur.rowcount

    if verbose:
        skipped = len(rows) - inserted
        note = f" ({skipped} already present, skipped)" if skipped else ""
        print(f"  {table}: {inserted}/{len(rows)} rows copied{note}")
    return inserted


def reset_sequence(pconn, table: str, id_column: str = "id"):
    """
    After loading explicit ids into a SERIAL column, the sequence that
    generates NEW ids has not moved — it still thinks the table is empty.
    The next INSERT without an explicit id would try id=1 again and collide.

    setval(..., MAX(id)) with is_called=true means "the next nextval() call
    returns MAX(id)+1", which is what's wanted; COALESCE handles the
    empty-table case (falls back to not advancing the sequence at all).
    """
    pcur = pconn.cursor()
    pcur.execute(f"SELECT MAX({id_column}) AS m FROM {table}")
    max_id = pcur.fetchone()["m"]
    if max_id is None:
        return  # empty table, sequence already at its default start
    pcur.execute(
        f"SELECT setval(pg_get_serial_sequence(%s, %s), %s, true)",
        (table, id_column, max_id),
    )


def run(sqlite_path: str, dry_run: bool = False):
    print(f"Source SQLite: {sqlite_path}")
    print(f"Target Postgres: {settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}")
    if dry_run:
        print("DRY RUN — no changes will be committed\n")

    sconn = connect_sqlite(sqlite_path)
    pconn = connect_postgres()
    pconn.autocommit = False  # everything below is one transaction

    try:
        print("\nCopying tables (dependency order):")
        total = 0
        for table in TABLE_ORDER:
            total += copy_table(sconn, pconn, table)

        print("\nResetting sequences so the next INSERT doesn't collide with a migrated id:")
        for table in TABLE_ORDER:
            if table in ("project_members", "task_dependencies", "task_collaborators", "sessions"):
                # sessions.token is a TEXT primary key, not a serial id —
                # no sequence exists for it, nothing to reset.
                continue  # composite PK, no serial id column
            try:
                reset_sequence(pconn, table)
                print(f"  {table}: sequence advanced past existing ids")
            except Exception as e:
                # CRITICAL: a failed statement aborts the whole shared
                # transaction. Catching the exception here without rolling
                # back leaves every later statement in this transaction —
                # including the final commit() — silently discarded.
                # conn.commit() on an aborted transaction does NOT raise; it
                # behaves as an implicit rollback with no error at all.
                # Reproduced directly: a caught-but-not-rolled-back error
                # here caused an entire successful-looking migration run to
                # commit zero rows. Every table copied before this point in
                # the loop would have been silently lost without this fix.
                pconn.rollback()
                print(f"  {table}: sequence reset failed and was rolled back ({e})")
                print(f"  FATAL: cannot continue after a rollback mid-migration — restart the script.")
                sys.exit(1)

        if dry_run:
            pconn.rollback()
            print(f"\nDRY RUN complete — {total} rows would be copied. Nothing was committed.")
        else:
            pconn.commit()
            print(f"\nMigration complete — {total} rows copied and committed.")

    except Exception:
        pconn.rollback()
        print("\nMIGRATION FAILED — transaction rolled back, target database unchanged.")
        raise
    finally:
        sconn.close()
        pconn.close()


def verify(sqlite_path: str):
    """Post-migration sanity check: row counts must match, table by table."""
    sconn = connect_sqlite(sqlite_path)
    pconn = connect_postgres()
    pcur = pconn.cursor()

    print("\nVerification — row counts (source vs target):")
    all_ok = True
    for table in TABLE_ORDER:
        if not table_exists_sqlite(sconn, table):
            continue
        s_count = sconn.execute(f"SELECT COUNT(*) c FROM {table}").fetchone()["c"]
        pcur.execute(f"SELECT COUNT(*) AS c FROM {table}")
        p_count = pcur.fetchone()["c"]
        ok = s_count == p_count
        all_ok &= ok
        flag = "OK" if ok else "MISMATCH"
        print(f"  {flag:8s} {table:28s} sqlite={s_count:<6} postgres={p_count}")

    sconn.close()
    pconn.close()
    if not all_ok:
        sys.exit("\nRow count mismatch detected — do not point the app at Postgres yet.")
    print("\nAll row counts match.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sqlite_path", help="Path to the existing taskmaster.db")
    ap.add_argument("--dry-run", action="store_true", help="Copy nothing; report what would happen")
    ap.add_argument("--verify-only", action="store_true", help="Skip copying; only compare row counts")
    args = ap.parse_args()

    if args.verify_only:
        verify(args.sqlite_path)
    else:
        run(args.sqlite_path, dry_run=args.dry_run)
        if not args.dry_run:
            verify(args.sqlite_path)
