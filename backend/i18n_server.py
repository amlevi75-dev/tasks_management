"""
Server-side translations for emails and in-app (bell) notifications.

Each recipient gets text in THEIR language (users.language, 'en' or 'he'),
not the language of whoever triggered the event.  Anything missing from the
table falls back to English, so an unknown phrase never breaks a message.
"""

SUPPORTED = ("en", "he")

HE = {
    # email chrome
    "Open Task →": "פתיחת המשימה ←",
    "You received this from {app}. Reply on the task to keep the conversation in one place.":
        "הודעה זו נשלחה מ־{app}. הגב במשימה כדי לשמור את השיחה במקום אחד.",
    # field labels
    "Task": "משימה", "Project": "פרויקט", "Priority": "עדיפות", "Assigned by": "הוקצתה על ידי",
    "Due": "יעד", "Updated by": "עודכן על ידי", "Change": "שינוי", "Added by": "נוסף על ידי",
    "System": "המערכת",
    # assigned
    "Task Assigned to You": "הוקצתה לך משימה",
    "You have been assigned a task": "הוקצתה לך משימה",
    "Task assigned: {title}": "משימה הוקצתה: {title}",
    "You were assigned: {title}": "הוקצתה לך משימה: {title}",
    # updated
    "Task Updated": "משימה עודכנה",
    "Task updated": "משימה עודכנה",
    "Task updated: {title}": "משימה עודכנה: {title}",
    "Status → {status}": "סטטוס ← {status}",
    "New comment by {name}: {preview}": "תגובה חדשה מאת {name}: {preview}",
    # collaborator
    "Added as Collaborator": "נוספת כמשתף פעולה",
    "You were added as a collaborator": "נוספת כמשתף פעולה",
    "Added as collaborator: {title}": "נוספת כמשתף פעולה: {title}",
    "You were added as a collaborator: {title}": "נוספת כמשתף פעולה: {title}",
    # mention
    "You Were Mentioned": "הוזכרת",
    "{name} mentioned you": "{name} הזכיר אותך",
    "{name} mentioned you in: {title}": "{name} הזכיר אותך ב: {title}",
    "On task <strong>{title}</strong> in <strong>{project}</strong>:":
        "במשימה <strong>{title}</strong> בפרויקט <strong>{project}</strong>:",
    # test mail
    "Test email": "הודעת בדיקה",
    "If you are reading this, Kairos can send mail.": "אם אתה קורא הודעה זו, Kairos יכולה לשלוח דואר.",
}

STATUS_HE = {"new": "חדשה", "open": "פתוחה", "in_progress": "בעבודה", "done": "הושלמה"}
PRIO_HE   = {"low": "נמוכה", "medium": "בינונית", "high": "גבוהה", "critical": "קריטית"}


def norm(lang):
    return lang if lang in SUPPORTED else "en"


def tx(lang, text, **params):
    s = HE.get(text, text) if lang == "he" else text
    return s.format(**params) if params else s


def status_label(lang, status):
    if lang == "he":
        return STATUS_HE.get(status, status)
    return (status or "").replace("_", " ").title()


def prio_label(lang, prio):
    if lang == "he":
        return PRIO_HE.get(prio, prio)
    return (prio or "").upper()


def direction(lang):
    return "rtl" if lang == "he" else "ltr"
