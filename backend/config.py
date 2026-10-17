import yaml
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / "config.yaml"

class Settings:
    def __init__(self):
        with open(CONFIG_PATH, encoding="utf-8") as f:
            data = yaml.safe_load(f)

        b = data.get("branding", {})
        self.APP_NAME       = b.get("app_name",      "TaskMaster")
        self.APP_URL        = b.get("app_url",        "http://localhost:8000").rstrip("/")
        self.LOGO_LETTER    = b.get("logo_letter",    self.APP_NAME[0].upper())
        self.PRIMARY_COLOR  = b.get("primary_color",  "#3b82f6")
        self.LOGO_SVG       = b.get("logo_svg",        None)

        self.AD_ENABLED     = data["ad"].get("enabled", True)
        self.AD_SERVER      = data["ad"]["server"]
        self.AD_DOMAIN      = data["ad"]["domain"]
        self.AD_BASE_DN     = data["ad"]["base_dn"]
        self.AD_BIND_USER   = data["ad"]["bind_user"]
        self.AD_BIND_PASS   = data["ad"]["bind_pass"]

        # .get("email", {}) rather than data["email"]: a missing or
        # partially edited email: block must not crash the whole app at
        # import time — that failure happens before logging is configured,
        # so under a service manager it produces no diagnosable log at all,
        # and every route (not just email) goes down with it.
        e = data.get("email", {}) or {}
        self.SMTP_HOST      = e.get("smtp_host", "")
        self.SMTP_PORT      = e.get("smtp_port", 25)
        self.SMTP_USER      = e.get("smtp_user", "")
        self.SMTP_PASS      = e.get("smtp_pass", "")
        self.SMTP_FROM      = e.get("from_address", "")
        # Incoming-mail (IMAP -> task creation) was removed as an unused
        # feature. Outgoing notification mail (SMTP) above is unaffected.

        s = data.get("sso", {}) or {}
        self.SSO_ENABLED        = s.get("enabled", False)
        self.SSO_DISCOVERY_URL  = s.get("discovery_url", "")
        self.SSO_CLIENT_ID      = s.get("client_id", "")
        self.SSO_CLIENT_SECRET  = s.get("client_secret", "")
        self.SSO_SCOPE          = s.get("scope", "openid profile email")
        self.SSO_RESOURCE       = s.get("resource", "")
        self.SSO_USERNAME_CLAIM = s.get("username_claim", "upn")
        self.SSO_VERIFY_SSL     = s.get("verify_ssl", True)
        self.SSO_VERIFY_AUDIENCE= s.get("verify_audience", True)
        self.SSO_ALLOW_LOCAL    = s.get("allow_local_login", True)
        self.SSO_LOOKUP_AD      = s.get("lookup_ad_display_name", True)
        self.SSO_BUTTON_LABEL   = s.get("button_label", "Sign in with company account")

        self.SECRET_KEY     = data["app"]["secret_key"]
        self.CORS_ORIGINS   = data["app"].get("cors_origins", ["http://localhost:3000"])
        # Task attachments are stored on local disk, not in the database —
        # moving the DB to a separate Postgres server does not move these
        # files. This directory is independent of the DB connection and
        # must be set explicitly; it previously defaulted to "next to the
        # sqlite file", which has no equivalent once the DB is remote.
        self.UPLOAD_DIR     = data["app"].get("upload_dir", "attachments")

        # PostgreSQL connection. The db: block is required — there is no
        # SQLite fallback in this build. host/port/dbname/user/password map
        # directly onto psycopg2.connect() kwargs; sslmode is exposed
        # separately since it is the one setting worth tuning per
        # environment (a remote DB server on the same trusted network
        # segment vs. one reached over a link where you want TLS enforced).
        db = data.get("db", {}) or {}
        self.DB_HOST     = db.get("host", "localhost")
        self.DB_PORT     = db.get("port", 5432)
        self.DB_NAME     = db.get("name", "kairos")
        self.DB_USER     = db.get("user", "kairos")
        self.DB_PASSWORD = db.get("password", "")
        self.DB_SSLMODE  = db.get("sslmode", "prefer")
        # Connection pool size — see database.py. Modest defaults; raise
        # DB_POOL_MAX if you see "connection pool exhausted" under load.
        self.DB_POOL_MIN = db.get("pool_min", 2)
        self.DB_POOL_MAX = db.get("pool_max", 10)

        # Node-RED integration (evaluation). Off by default — task
        # create/update should never depend on Node-RED being reachable,
        # so this is opt-in and every call is fire-and-forget from the
        # request path, same as outgoing email above.
        nr = data.get("nodered", {}) or {}
        self.NODERED_ENABLED = nr.get("enabled", False)
        self.NODERED_URL     = nr.get("url", "http://localhost:1880/api/tasks").rstrip("/")
        self.NODERED_TIMEOUT = nr.get("timeout_seconds", 5)
        self.NODERED_TOKEN   = nr.get("auth_token", "")   # optional bearer token, sent if set

        # Inbound integration auth — lets a server-to-server caller (e.g. a
        # Node-RED flow) authenticate without a browser session cookie.
        # Sent as header "X-API-Key: <api_key.key>". The key authenticates
        # AS api_key.username, an ordinary local/AD user — give that user
        # only the project membership you want the integration to have.
        # Leave key blank to keep inbound API-key auth disabled entirely.
        ik = data.get("api_key", {}) or {}
        self.API_KEY          = ik.get("key", "")
        self.API_KEY_USERNAME = ik.get("username", "")

settings = Settings()
