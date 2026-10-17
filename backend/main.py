from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from contextlib import asynccontextmanager
from pathlib import Path
import json, logging, sys, uvicorn

# Log to stderr, line-buffered. print() goes to block-buffered stdout, which
# under NSSM means messages can sit in a buffer and never reach the log file —
# that is why mail failures were invisible.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    stream=sys.stderr,
    force=True,
)

from database import init_db
from routes import auth, projects, tasks, users, fields, analytics, categories, sso, views
from config import settings


class UTF8JSONResponse(JSONResponse):
    """Return JSON with real Unicode chars instead of \\uXXXX escapes."""
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    init_db()
    yield
    # Shutdown: release pooled Postgres connections cleanly rather than
    # letting the process exit out from under them.
    from database import _pool
    _pool.closeall()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    default_response_class=UTF8JSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,        prefix="/api/auth",     tags=["auth"])
app.include_router(sso.router,         prefix="/api/auth",     tags=["sso"])
app.include_router(views.router,       prefix="/api/projects",  tags=["views"])
app.include_router(projects.router,    prefix="/api/projects", tags=["projects"])
app.include_router(tasks.router,       prefix="/api/tasks",    tags=["tasks"])
app.include_router(users.router,       prefix="/api/users",    tags=["users"])
app.include_router(fields.router,      prefix="/api/projects", tags=["fields"])
app.include_router(analytics.router,   prefix="/api/projects", tags=["analytics"])
app.include_router(categories.router,  prefix="/api/projects", tags=["categories"])


# ── Public endpoints (no auth) ─────────────────────────────────────────────────
@app.get("/api/branding")
def get_branding():
    return {
        "app_name":      settings.APP_NAME,
        "logo_letter":   settings.LOGO_LETTER,
        "primary_color": settings.PRIMARY_COLOR,
        "logo_svg":      getattr(settings, "LOGO_SVG", None),
    }

@app.get("/api/health")
def health():
    return {"status": "ok", "app": settings.APP_NAME}


# ── Serve React frontend ───────────────────────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"

if STATIC_DIR.exists():
    assets_dir = STATIC_DIR / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # Serve logo SVG directly if requested
        requested = STATIC_DIR / full_path
        if requested.exists() and requested.is_file():
            return FileResponse(str(requested))
        return FileResponse(str(STATIC_DIR / "index.html"))
else:
    @app.get("/")
    def no_frontend():
        return {"detail": "Frontend not built yet. Run: cd frontend && npm run build"}


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
