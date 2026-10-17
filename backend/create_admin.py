#!/usr/bin/env python3
"""
Create the first local admin user.

Needed once per fresh deployment — a brand-new Postgres database (via
init_db()) has no users at all, and AD/SSO auth only ever creates a user
record on that person's first successful login, so nobody can promote
themselves to admin without one already existing.

Replaces the --create-admin flag that used to live in
migrate_local_users.py (an ALTER TABLE script for adding auth columns to an
existing SQLite users table — no longer needed, since init_db() creates
those columns directly in the current schema).

Usage:
    python create_admin.py
"""
import getpass
import bcrypt

from config import settings
from database import get_db


def create_admin():
    username     = input("Admin username: ").strip()
    display_name = input("Display name: ").strip()
    email        = input("Email: ").strip()
    password     = getpass.getpass("Password: ")
    confirm      = getpass.getpass("Confirm password: ")

    if not username or not display_name or not email:
        print("Username, display name, and email are all required.")
        return
    if password != confirm:
        print("Passwords do not match.")
        return
    if len(password) < 8:
        print("Password must be at least 8 characters.")
        return

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

    gen = get_db()
    db = next(gen)
    try:
        existing = db.execute("SELECT id FROM users WHERE username=%s", (username,)).fetchone()
        if existing:
            print(f"User '{username}' already exists.")
            return
        db.execute(
            "INSERT INTO users (username, display_name, email, auth_source, password_hash, is_admin, is_active) "
            "VALUES (%s,%s,%s,'local',%s,1,1)",
            (username, display_name, email, hashed)
        )
        db.commit()
        print(f"Admin user '{username}' created.")
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


if __name__ == "__main__":
    create_admin()
