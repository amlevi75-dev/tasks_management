# Kairos — Linux container image
#
# Build context = the kairos/ project folder (the one that contains backend/ and
# frontend/ side by side, same folder deploy.sh runs from):
#
#     docker build -t kairos:1.0.0 .
#
# Two stages, so the final image carries no Node.js, no node_modules and no
# build tools — only Python and the compiled frontend.

ARG NODE_VERSION=20
ARG PYTHON_VERSION=3.12


# ── Stage 1: build the React frontend ─────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /build/frontend

# Manifests first: this layer (and the slow npm install) is reused until
# package.json / package-lock.json change. The "*" makes the lock file optional.
COPY frontend/package.json frontend/package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi

COPY frontend/ ./
# Same command deploy.sh uses. --outDir overrides the relative path in
# vite.config.js, so the result does not depend on where the build runs.
RUN npx vite build --outDir /build/static --emptyOutDir


# ── Stage 2: Python runtime ───────────────────────────────────────────────────
# Debian-based "slim", not alpine: psycopg2-binary, bcrypt and cryptography ship
# glibc wheels, so no compiler or system libraries are needed.
FROM python:${PYTHON_VERSION}-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Unprivileged user with a fixed uid/gid, so ownership of the data volume is
# predictable (it matters if you later switch the volume to a bind mount).
RUN groupadd --system --gid 10001 kairos \
 && useradd  --system --uid 10001 --gid 10001 --no-create-home \
             --shell /usr/sbin/nologin kairos

WORKDIR /app

# Python requirements — installed BEFORE the code is copied, so editing a .py
# file does not trigger a reinstall; only a change to requirements.txt does.
COPY backend/requirements.txt ./
RUN pip install -r requirements.txt

# Application code. config.yaml is NOT in the image (see .dockerignore): it holds
# passwords, so it is mounted at run time as /app/config.yaml.
COPY backend/ ./

# The compiled frontend, at the exact spot main.py serves it from
# (Path(__file__).parent / "static").
COPY --from=frontend /build/static ./static

# Attachments live on a volume mounted at /data. Creating the folder here, owned
# by the app user, lets a brand-new named volume inherit that ownership.
RUN mkdir -p /data/attachments && chown -R kairos:kairos /data

# Numeric on purpose: orchestrators that enforce "must not run as root" cannot
# resolve a user *name* to check it.
USER 10001:10001
EXPOSE 8000

# /api/health answers without touching the database, so this reports "the web
# process is up". A database outage shows as a crash/restart loop in the logs
# instead (the connection pool is opened when the app starts).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"]

# Exec form, so uvicorn is PID 1 and receives SIGTERM directly: "docker stop"
# triggers a graceful shutdown that closes the Postgres pool. No --reload (that
# flag is only in main.py's __main__ block, which the container does not use).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
