# Kairos

Kairos is an internal task and project management application, built for
on-premises deployment with Active Directory authentication and a full
Hebrew/English bilingual interface.

## Features

- **Projects & tasks** — kanban board, list view, and Gantt chart per project
- **Subtasks, dependencies & collaborators** — break work down, link blocking
  relationships between tasks, and add collaborators alongside a task's
  single assignee
- **Comments with @mentions** — per-task discussion thread with user mentions
  and notification on mention
- **File attachments** — upload and download files on a task (20 MB limit)
- **Custom fields & categories** — per-project custom fields and task
  categories
- **Project roles** — owner, member, viewer, and light member (a light
  member only sees tasks assigned to them)
- **Analytics** — per-project dashboard (status/priority breakdown, overdue
  tasks, completion trend)
- **Trash** — soft-deleted tasks can be restored
- **Bilingual UI (English/Hebrew)** — full right-to-left mirror layout for
  Hebrew, including translated bell notifications and emails sent in each
  recipient's own saved language preference
- **Active Directory authentication** — ADFS (OpenID Connect) single
  sign-on, with a local username/password fallback
- **Node-RED integration** *(optional, evaluation)* — task creation/update
  events can be POSTed to a Node-RED flow

## Tech stack

| Layer      | Technology                                   |
|------------|-----------------------------------------------|
| Backend    | FastAPI (Python)                              |
| Frontend   | React + Vite                                  |
| Database   | PostgreSQL                                    |
| Auth       | Active Directory via ADFS (OIDC), local login |
| Deployment | Docker (Linux); NSSM Windows service (Windows)|

## Repository layout

```
backend/     FastAPI application, routes, database access
frontend/    React/Vite single-page app
config.yaml  Runtime configuration (branding, AD, SMTP, SSO, DB, API key)
```

## Running with Docker

Kairos ships as a multi-stage Docker build: the frontend is built with
`npm`/`vite`, then served by the FastAPI backend as static files. PostgreSQL
is **not** bundled in the container — it must be reachable from the Docker
host (either on the same host or elsewhere on the network).

```bash
# from the repository root
docker compose up -d --build
```

Configuration is supplied via a YAML file bind-mounted into the container
at `/app/config.yaml`. See `config.yaml` in this repository for every
available setting, including:

- `db:` — PostgreSQL connection details
- `ad:` / `sso:` — Active Directory bind account and ADFS OIDC settings
- `email:` — SMTP relay for task-assignment/mention/update notifications
- `nodered:` — optional outbound event notifications
- `api_key:` — optional API key for external integrations

After the first start, confirm the container reports healthy:

```bash
docker compose ps
docker compose logs -f kairos
```

## Running on Windows (NSSM)

Kairos also runs as a native Windows service via [NSSM](https://nssm.cc/),
pointing at the backend's Python environment and serving the built frontend
as static files from the same process. See the deployment notes in this
repository for the exact service setup.

## Language support

Users can switch the interface between English and Hebrew from the top bar.
The choice is stored in the browser and on the user's account, so emails and
in-app notifications are generated in the recipient's own language
regardless of who triggered the event. Hebrew uses a full mirrored
(right-to-left) layout; the Gantt chart timeline intentionally stays
left-to-right.

## License

Internal use only. Not licensed for external distribution.
