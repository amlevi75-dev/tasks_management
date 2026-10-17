KAIROS - HEBREW / ENGLISH LANGUAGE SWITCH
=========================================
Only changed files are in this zip. Same folder layout as your project:
  frontend/src/...   (copy over your frontend/src)
  backend/...        (copy over your backend)

NEW files:  frontend/src/i18n.js, frontend/src/i18n.he.js, backend/i18n_server.py
Changed:    all other files listed in the zip (see the tree).

APPLY (use cp, back up first)
  cd <your kairos folder>
  cp -a backend backend.bak.$(date +%F) && cp -a frontend/src frontend/src.bak.$(date +%F)
  unzip -o kairos_hebrew_i18n.zip -d /tmp/kairos_he
  cp -a /tmp/kairos_he/backend/.  backend/
  cp -a /tmp/kairos_he/frontend/. frontend/
  # rebuild frontend (Docker: docker compose up -d --build ; or npm run build as usual)
  # restart backend. The users.language column is created automatically at start-up
  # (ALTER TABLE ... ADD COLUMN IF NOT EXISTS) - no manual SQL.

HOW IT WORKS
  * Button "עברית / English" in the top bar (and on the login page).
  * Choice is kept in the browser AND saved on the user (users.language) so emails
    and bell notifications arrive in each RECIPIENT's own language.
  * Hebrew = full RTL mirror (<html dir="rtl">). Gantt timeline stays left-to-right.
  * First login on a new browser: the saved server language is applied.
  * To change/add a Hebrew word: frontend/src/i18n.he.js (UI) and backend/i18n_server.py (mail/bell).
    Anything missing simply shows in English.

TEST CHECKLIST
  1. Login page: switch to עברית - page flips right-to-left.
  2. Log in, switch language, press F5 - language is kept.
  3. Log in from another browser - same language comes from the server.
  4. Dashboard, project list/board/Gantt, task modal, members, analytics, admin users, trash - all Hebrew.
  5. Assign a task to a Hebrew user - bell message and email in Hebrew (email body RTL).
  6. Same for an English user - unchanged English.
  7. Server error text (e.g. wrong password) shows in Hebrew.

NOTES
  * Notifications already stored in the database stay in the language they were created in.
  * Dates in the date pickers follow the browser/OS locale (not controlled by the app).
  * Project/task names, comments, categories you type are never translated.
  * Dynamic server messages like "Cannot close task - N subtask(s) still open" remain English
    (not in the dictionary yet) - tell me and I will add them.
