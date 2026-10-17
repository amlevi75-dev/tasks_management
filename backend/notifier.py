import logging
import smtplib

log = logging.getLogger("kairos.notifier")
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
from config import settings
from database import _ConnWrapper as DbConn

# ── Shared email helpers ───────────────────────────────────────────────────────

def send_email(to: str, subject: str, html_body: str) -> bool:
    """
    Send one HTML email. Returns True on success.

    Every outcome is logged: mail problems are otherwise invisible, because
    notifications are fire-and-forget from the request path.
    """
    if not to:
        log.warning("Skipping email '%s': no recipient address", subject)
        return False
    if not settings.SMTP_HOST:
        log.warning("Skipping email '%s': smtp_host is not configured", subject)
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = settings.SMTP_FROM
        msg["To"]      = to
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        # Without a timeout an unreachable relay blocks the worker thread
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as s:
            if settings.SMTP_USER:
                s.starttls()
                s.login(settings.SMTP_USER, settings.SMTP_PASS)
            s.sendmail(settings.SMTP_FROM, [to], msg.as_string())

        log.info("Email sent to %s: %s", to, subject)
        return True
    except Exception as e:
        log.error("Email to %s failed (%s:%s): %s: %s",
                  to, settings.SMTP_HOST, settings.SMTP_PORT, type(e).__name__, e)
        return False

def task_deep_link(task_id: int, project_id: int) -> str:
    """Build a deep-link URL that opens the app on the right project and task."""
    return f"{settings.APP_URL}/#/project/{project_id}/task/{task_id}"

def _email_header(accent_color: str, title: str) -> str:
    return f"""
    <div style="background:{accent_color};padding:22px 28px;border-radius:8px 8px 0 0">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:36px;height:36px;border-radius:8px;background:rgba(255,255,255,0.2);
                    display:flex;align-items:center;justify-content:center;
                    font-weight:800;font-size:18px;color:#fff">{settings.LOGO_LETTER}</div>
        <div>
          <div style="color:rgba(255,255,255,0.7);font-size:11px;text-transform:uppercase;letter-spacing:1px">{settings.APP_NAME}</div>
          <div style="color:#fff;font-size:16px;font-weight:700;margin-top:2px">{title}</div>
        </div>
      </div>
    </div>"""

def _email_footer(task_url: str) -> str:
    return f"""
        <div style="margin-top:20px">
          <a href="{task_url}" style="display:inline-block;padding:10px 20px;
             background:{settings.PRIMARY_COLOR};color:#fff;text-decoration:none;
             border-radius:6px;font-weight:600;font-size:13px">Open Task →</a>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin-top:16px">
          You received this from {settings.APP_NAME}. Reply on the task to keep the conversation in one place.
        </p>"""

def _wrap(header: str, body: str, task_url: str) -> str:
    return f"""
    <div style="font-family:Segoe UI,system-ui,sans-serif;max-width:600px;margin:auto;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">
      {header}
      <div style="padding:24px 28px;background:#ffffff;border-radius:0 0 8px 8px">
        {body}
        {_email_footer(task_url)}
      </div>
    </div>"""

# ── Notification functions ─────────────────────────────────────────────────────

def notify_task_assigned(db: DbConn, task_id: int):
    row = db.execute("""
        SELECT t.title, t.status, t.priority, t.due_date, t.project_id,
               p.name  as project_name,
               u.email as assignee_email, u.display_name as assignee_name,
               r.display_name as reporter_name
        FROM tasks t
        JOIN  projects p ON p.id = t.project_id
        LEFT JOIN users u ON u.id = t.assignee_id
        LEFT JOIN users r ON r.id = t.reporter_id
        WHERE t.id = %s
    """, (task_id,)).fetchone()
    if not row:
        log.warning("notify_task_assigned: task %s not found", task_id)
        return
    if not row["assignee_email"]:
        log.warning("notify_task_assigned: task %s assignee '%s' has no email address on file",
                    task_id, row["assignee_name"] or "%s")
        return

    url  = task_deep_link(task_id, row["project_id"])
    body = f"""
        <h3 style="margin:0 0 16px;color:#0f172a">You have been assigned a task</h3>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:100px">Task</td>
              <td style="padding:6px 0;font-size:13px;font-weight:600">{row['title']}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Project</td>
              <td style="padding:6px 0;font-size:13px">{row['project_name']}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Priority</td>
              <td style="padding:6px 0;font-size:13px">{row['priority'].upper()}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Assigned by</td>
              <td style="padding:6px 0;font-size:13px">{row['reporter_name'] or 'System'}</td></tr>
          {"<tr><td style='padding:6px 0;color:#64748b;font-size:13px'>Due</td><td style='padding:6px 0;font-size:13px'>" + row['due_date'] + "</td></tr>" if row['due_date'] else ""}
        </table>"""

    html = _wrap(_email_header(settings.PRIMARY_COLOR, "Task Assigned to You"), body, url)
    send_email(row["assignee_email"], f"[{settings.APP_NAME}] Task assigned: {row['title']}", html)

    db.execute(
        "INSERT INTO notifications (user_id, task_id, message) SELECT assignee_id, id, %s FROM tasks WHERE id=%s",
        (f"You were assigned: {row['title']}", task_id)
    )
    db.commit()

def notify_task_updated(db: DbConn, task_id: int, changed_by_name: str, changes: str):
    """
    Notify the assignee AND every collaborator that a task changed —
    including comments (add_comment routes through this too). Each gets both
    an email and an in-app notification row; previously only the assignee
    got an email and nobody got the in-app entry from this function.
    """
    task = db.execute("""
        SELECT t.title, t.project_id, p.name as project_name, t.assignee_id
        FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.id = %s
    """, (task_id,)).fetchone()
    if not task:
        log.warning("notify_task_updated: task %s not found", task_id)
        return

    recipients = []  # [(user_id, email, display_name)]
    if task["assignee_id"]:
        u = db.execute("SELECT id, email, display_name FROM users WHERE id=%s", (task["assignee_id"],)).fetchone()
        if u:
            recipients.append((u["id"], u["email"], u["display_name"]))

    collabs = db.execute("""
        SELECT u.id, u.email, u.display_name
        FROM task_collaborators tc JOIN users u ON u.id = tc.user_id
        WHERE tc.task_id = %s
    """, (task_id,)).fetchall()
    recipients += [(r["id"], r["email"], r["display_name"]) for r in collabs]

    if not recipients:
        log.warning("notify_task_updated: task %s has no assignee or collaborators to notify", task_id)
        return

    url  = task_deep_link(task_id, task["project_id"])
    body = f"""
        <h3 style="margin:0 0 16px;color:#0f172a">Task updated</h3>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:100px">Task</td>
              <td style="padding:6px 0;font-size:13px;font-weight:600">{task['title']}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Project</td>
              <td style="padding:6px 0;font-size:13px">{task['project_name']}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Updated by</td>
              <td style="padding:6px 0;font-size:13px">{changed_by_name}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Change</td>
              <td style="padding:6px 0;font-size:13px">{changes}</td></tr>
        </table>"""
    html = _wrap(_email_header("#0f766e", "Task Updated"), body, url)
    subject = f"[{settings.APP_NAME}] Task updated: {task['title']}"

    seen = set()
    for user_id, email, display_name in recipients:
        if user_id in seen:
            continue
        seen.add(user_id)
        if email:
            send_email(email, subject, html)
        else:
            log.warning("notify_task_updated: user '%s' has no email address on file", display_name)
        db.execute(
            "INSERT INTO notifications (user_id, task_id, message) VALUES (%s,%s,%s)",
            (user_id, task_id, f"{task['title']}: {changes}")
        )
    db.commit()

def notify_collaborator_added(db: DbConn, task_id: int, collaborator_user_id: int, added_by_name: str):
    row = db.execute("""
        SELECT t.title, t.priority, t.due_date, t.project_id,
               p.name  as project_name,
               u.email as collab_email, u.display_name as collab_name
        FROM tasks t
        JOIN  projects p ON p.id = t.project_id
        JOIN  users u    ON u.id = %s
        WHERE t.id = %s
    """, (collaborator_user_id, task_id)).fetchone()
    if not row:
        log.warning("notify_collaborator_added: task %s or user %s not found", task_id, collaborator_user_id)
        return
    if not row["collab_email"]:
        log.warning("notify_collaborator_added: user '%s' has no email address on file", row["collab_name"])
        return

    url  = task_deep_link(task_id, row["project_id"])
    body = f"""
        <h3 style="margin:0 0 16px;color:#0f172a">You were added as a collaborator</h3>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:100px">Task</td>
              <td style="padding:6px 0;font-size:13px;font-weight:600">{row['title']}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Project</td>
              <td style="padding:6px 0;font-size:13px">{row['project_name']}</td></tr>
          <tr><td style="padding:6px 0;color:#64748b;font-size:13px">Added by</td>
              <td style="padding:6px 0;font-size:13px">{added_by_name}</td></tr>
          {"<tr><td style='padding:6px 0;color:#64748b;font-size:13px'>Due</td><td style='padding:6px 0;font-size:13px'>" + row['due_date'] + "</td></tr>" if row['due_date'] else ""}
        </table>"""

    html = _wrap(_email_header(settings.PRIMARY_COLOR, "Added as Collaborator"), body, url)
    send_email(row["collab_email"], f"[{settings.APP_NAME}] Added as collaborator: {row['title']}", html)

    db.execute(
        "INSERT INTO notifications (user_id, task_id, message) VALUES (%s,%s,%s)",
        (collaborator_user_id, task_id, f"You were added as a collaborator: {row['title']}")
    )
    db.commit()


def notify_mention(db: DbConn, task_id: int, mentioned_user_id: int,
                   mentioned_by_name: str, comment_body: str) -> bool:
    """
    Email + in-app notify a @mentioned user. Deliberately unconditional on
    assignment, role, or project membership beyond having access to the task
    at all — anyone named with @username is notified. Returns whether the
    email genuinely sent, so callers can report the real outcome instead of
    just "we attempted it".
    """
    row = db.execute("""
        SELECT t.title, t.project_id, p.name as project_name,
               u.email, u.display_name
        FROM tasks t
        JOIN  projects p ON p.id = t.project_id
        JOIN  users u    ON u.id = %s
        WHERE t.id = %s
    """, (mentioned_user_id, task_id)).fetchone()
    if not row:
        log.warning("notify_mention: task %s or user %s not found", task_id, mentioned_user_id)
        return False
    if not row["email"]:
        log.warning("notify_mention: user '%s' has no email address on file", row["display_name"])
        return False

    url     = task_deep_link(task_id, row["project_id"])
    preview = comment_body[:300] + ("…" if len(comment_body) > 300 else "")
    body    = f"""
        <h3 style="margin:0 0 16px;color:#0f172a">{mentioned_by_name} mentioned you</h3>
        <p style="font-size:13px;color:#475569;margin-bottom:12px">
          On task <strong>{row['title']}</strong> in <strong>{row['project_name']}</strong>:
        </p>
        <blockquote style="margin:0 0 16px;padding:12px 16px;background:#f8fafc;
                           border-left:4px solid #7c3aed;border-radius:4px;
                           color:#374151;font-size:13px;font-style:italic">
          {preview}
        </blockquote>"""

    html = _wrap(_email_header("#7c3aed", "You Were Mentioned"), body, url)
    sent = send_email(row["email"], f"[{settings.APP_NAME}] {mentioned_by_name} mentioned you in: {row['title']}", html)

    # In-app notification is written even if the email itself failed — the
    # mention still happened and should show up in-product regardless of
    # mail delivery.
    db.execute(
        "INSERT INTO notifications (user_id, task_id, message) VALUES (%s,%s,%s)",
        (mentioned_user_id, task_id, f"{mentioned_by_name} mentioned you in: {row['title']}")
    )
    db.commit()
    return sent


# ── Node-RED integration (evaluation) ───────────────────────────────────────────

def notify_nodered(task: dict, event: str) -> bool:
    """
    POST a task event to Node-RED. Fire-and-forget: task creation/update
    must never fail, block, or slow down because Node-RED is unreachable,
    slow, or misconfigured — same principle as send_email above, and the
    same reasoning: this is a side effect of the request, not something the
    request's success should depend on.

    `task` is the dict returned by task_row() (already what create_task/
    update_task return to their own caller) — passed through as-is rather
    than re-fetched, so this costs no extra query.

    `event` is a short string identifying what happened, e.g.
    "task.created", "task.updated" — sent through so one Node-RED flow can
    branch on it instead of needing a separate endpoint per event type.

    Returns True if Node-RED accepted the event (2xx), False otherwise —
    callers can use this to log or make it visible in a diagnostics
    endpoint later (send_email's return value is used the same way, see
    routes/tasks.py's mention-report), but nothing in this codebase should
    ever raise on a False return.
    """
    if not settings.NODERED_ENABLED:
        return False
    if not settings.NODERED_URL:
        log.warning("notify_nodered: nodered.enabled is true but no url is configured")
        return False

    payload = {
        "event":        event,
        "task_id":      task.get("id"),
        "task_name":    task.get("title"),   # Kairos calls this "title", not "name"
        "project_id":   task.get("project_id"),
        "project_name": task.get("project_name"),
        "status":       task.get("status"),
        "priority":     task.get("priority"),
        "assignee_id":  task.get("assignee_id"),
        "assignee_name":task.get("assignee_name"),
        "due_date":     task.get("due_date"),
    }
    headers = {"Content-Type": "application/json"}
    if settings.NODERED_TOKEN:
        headers["Authorization"] = f"Bearer {settings.NODERED_TOKEN}"

    try:
        resp = requests.post(
            settings.NODERED_URL,
            json=payload,
            headers=headers,
            timeout=settings.NODERED_TIMEOUT,
        )
        if resp.ok:
            log.info("Node-RED notified: %s task %s (%s)", event, payload["task_id"], resp.status_code)
            return True
        log.warning("Node-RED rejected %s for task %s: HTTP %s: %s",
                    event, payload["task_id"], resp.status_code, resp.text[:300])
        return False
    except requests.exceptions.Timeout:
        log.warning("Node-RED timed out (%ss) for %s, task %s — %s",
                    settings.NODERED_TIMEOUT, event, payload["task_id"], settings.NODERED_URL)
        return False
    except requests.exceptions.ConnectionError as e:
        log.warning("Node-RED unreachable for %s, task %s (%s): %s",
                    event, payload["task_id"], settings.NODERED_URL, e)
        return False
    except Exception as e:
        log.error("Node-RED call failed for %s, task %s: %s: %s",
                   event, payload["task_id"], type(e).__name__, e)
        return False
