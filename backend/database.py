"""
PostgreSQL connection layer.

Design goals for this rewrite:
  - Every route currently does row["column_name"] on query results (SQLite's
    sqlite3.Row behaviour). psycopg2's RealDictCursor returns plain dicts
    that support the same ["column_name"] access, so route code is
    unaffected by this file's rewrite.
  - FastAPI serves requests concurrently; a single shared connection (as
    SQLite used, with check_same_thread=False as a workaround) is not safe
    or performant against Postgres. A connection pool replaces it.
  - get_db() keeps its exact shape (a generator yielding one connection,
    used via FastAPI's Depends) so route signatures do not change.
"""
import psycopg2
import psycopg2.pool
import psycopg2.extras
from config import settings

_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=settings.DB_POOL_MIN,
    maxconn=settings.DB_POOL_MAX,
    host=settings.DB_HOST,
    port=settings.DB_PORT,
    dbname=settings.DB_NAME,
    user=settings.DB_USER,
    password=settings.DB_PASSWORD,
    sslmode=settings.DB_SSLMODE,
    cursor_factory=psycopg2.extras.RealDictCursor,
)


class _ConnWrapper:
    """
    Thin wrapper so route code's db.execute(sql, params).fetchone()/.fetchall()
    calling convention — copied from sqlite3.Connection.execute(), which
    returns a cursor directly — keeps working unchanged against psycopg2,
    where conn.execute() does not exist and a cursor must be created first.

    This is the one piece of "shim" in this file. Everything else is a
    straight rewrite; this exists purely to avoid touching the ~150
    db.execute(...) call sites across 11 route files for a calling-convention
    difference that has nothing to do with SQL dialect.
    """
    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=None):
        cur = self._conn.cursor()
        cur.execute(sql, params or ())
        return cur

    def commit(self):
        self._conn.commit()

    def rollback(self):
        self._conn.rollback()

    def close(self):
        self._conn.close()

    # Rarely used directly, but keep the escape hatch available.
    @property
    def raw(self):
        return self._conn


def get_db():
    conn = _pool.getconn()
    try:
        yield _ConnWrapper(conn)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)


def init_db():
    """
    Creates the schema if it does not already exist. Run once against a
    fresh database; safe to re-run (every statement is IF NOT EXISTS).

    This replaces both the original SQLite init_db() AND the eleven
    migrate_v1_*.py scripts that accumulated on top of it — this is the
    schema as it stands today, not a replay of its SQLite history. See
    migrate_to_postgres.py for moving existing data into this schema.
    """
    conn = _pool.getconn()
    try:
        cur = conn.cursor()
        cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            SERIAL PRIMARY KEY,
            username      TEXT UNIQUE NOT NULL,
            display_name  TEXT NOT NULL,
            email         TEXT NOT NULL,
            is_admin      INTEGER DEFAULT 0,
            is_active     INTEGER DEFAULT 1,
            auth_source   TEXT DEFAULT 'ad',
            password_hash TEXT,
            created_at    TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS projects (
            id          SERIAL PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT,
            owner_id    INTEGER NOT NULL REFERENCES users(id),
            color       TEXT DEFAULT '#3B82F6',
            archived    INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS project_members (
            project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role        TEXT NOT NULL CHECK(role IN ('owner','member','viewer','light_member')),
            PRIMARY KEY (project_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS project_categories (
            id         SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            color      TEXT DEFAULT '#64748b',
            position   INTEGER DEFAULT 0,
            UNIQUE(project_id, name)
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id            SERIAL PRIMARY KEY,
            project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title         TEXT NOT NULL,
            description   TEXT,
            status        TEXT NOT NULL DEFAULT 'new'
                          CHECK(status IN ('new','open','in_progress','done')),
            priority      TEXT DEFAULT 'medium'
                          CHECK(priority IN ('low','medium','high','critical')),
            assignee_id   INTEGER REFERENCES users(id),
            reporter_id   INTEGER REFERENCES users(id),
            requester_id  INTEGER REFERENCES users(id),
            request_text  TEXT,
            start_date    TEXT,
            due_date      TEXT,
            position      INTEGER DEFAULT 0,
            source        TEXT DEFAULT 'web',
            parent_task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
            category_id   INTEGER REFERENCES project_categories(id) ON DELETE SET NULL,
            deleted_at    TIMESTAMP,
            created_at    TIMESTAMP DEFAULT now(),
            updated_at    TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS task_comments (
            id          SERIAL PRIMARY KEY,
            task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id     INTEGER REFERENCES users(id),
            body        TEXT NOT NULL,
            created_at  TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS task_attachments (
            id          SERIAL PRIMARY KEY,
            task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            filename    TEXT NOT NULL,
            stored_name TEXT NOT NULL,
            size        INTEGER NOT NULL,
            uploaded_by INTEGER REFERENCES users(id),
            created_at  TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS task_dependencies (
            id            SERIAL PRIMARY KEY,
            task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            dep_type      TEXT NOT NULL DEFAULT 'finish_to_start',
            created_at    TIMESTAMP DEFAULT now(),
            UNIQUE(task_id, depends_on_id)
        );

        CREATE TABLE IF NOT EXISTS task_collaborators (
            task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            added_by   INTEGER REFERENCES users(id),
            added_at   TIMESTAMP DEFAULT now(),
            PRIMARY KEY (task_id, user_id)
        );

        CREATE TABLE IF NOT EXISTS project_field_definitions (
            id         SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            label      TEXT NOT NULL,
            field_type TEXT NOT NULL DEFAULT 'text'
                       CHECK(field_type IN ('text','number','date','list')),
            options    TEXT,
            required   INTEGER DEFAULT 0,
            position   INTEGER DEFAULT 0,
            filterable INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS task_field_values (
            id         SERIAL PRIMARY KEY,
            task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            field_id   INTEGER NOT NULL REFERENCES project_field_definitions(id) ON DELETE CASCADE,
            value      TEXT,
            updated_at TIMESTAMP DEFAULT now(),
            UNIQUE(task_id, field_id)
        );

        CREATE TABLE IF NOT EXISTS saved_views (
            id         SERIAL PRIMARY KEY,
            project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
            name       TEXT NOT NULL,
            filters    TEXT NOT NULL,
            position   INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT now(),
            UNIQUE(project_id, user_id, name)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            message     TEXT NOT NULL,
            read        INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token       TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            expires_at  TIMESTAMP NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_tasks_project      ON tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee     ON tasks(assignee_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_parent       ON tasks(parent_task_id);
        CREATE INDEX IF NOT EXISTS idx_task_collab_user   ON task_collaborators(user_id);
        CREATE INDEX IF NOT EXISTS idx_saved_views_lookup ON saved_views(project_id, user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_user      ON sessions(user_id);
        """)
        conn.commit()
    finally:
        _pool.putconn(conn)
