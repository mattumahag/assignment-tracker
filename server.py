#!/usr/bin/env python3
"""Assignment Tracker server: accounts, hashed passwords, per-user tasks."""

from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
USERS_FILE = DATA_DIR / "users.json"
SESSIONS_FILE = DATA_DIR / "sessions.json"

PORT = 8765
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")
PASSWORD_MIN, PASSWORD_MAX = 8, 128
PBKDF2_ITERATIONS = 600_000
SESSION_SECONDS = 7 * 24 * 60 * 60
MAX_BODY = 1_000_000

# Only these files are served; server.py and data/ are never exposed.
STATIC_FILES = {
    "/": "/index.html",
    "/index.html": "/index.html",
    "/styles.css": "/styles.css",
    "/script.js": "/script.js",
}

lock = threading.Lock()  # guards users.json
sessions_lock = threading.Lock()  # guards sessions.json


def write_json(path, data):
    """Write atomically so a crash can't leave a half-written file."""
    fd, tmp = tempfile.mkstemp(dir=DATA_DIR, suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def load_users():
    if not USERS_FILE.exists():
        return {}
    try:
        data = json.loads(USERS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def save_users(users):
    write_json(USERS_FILE, users)


def token_id(token):
    """Sessions are stored by hash, so the file alone can't be used to log in."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def load_sessions():
    try:
        data = json.loads(SESSIONS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    now = time.time()
    return {
        tid: entry
        for tid, entry in data.items()
        if isinstance(entry, dict) and entry.get("expires", 0) > now
    }


sessions = load_sessions()  # token hash -> {"user": key, "expires": timestamp}


def hash_password(password, salt):
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )


def sort_items(items):
    return sorted(items, key=lambda i: (i.get("dueDate") or "", i.get("title") or ""))


def clean_items(items):
    cleaned = []
    for item in items:
        if not isinstance(item, dict):
            continue
        completed_at = item.get("completedAt")
        if isinstance(completed_at, bool) or not isinstance(completed_at, (int, float)):
            completed_at = None
        cleaned.append(
            {
                "id": str(item.get("id") or ""),
                "title": str(item.get("title") or "").strip()[:200],
                "className": str(item.get("className") or "").strip()[:100],
                "type": str(item.get("type") or "").strip(),
                "dueDate": str(item.get("dueDate") or "").strip(),
                "complete": bool(item.get("complete")),
                "completedAt": int(completed_at) if completed_at is not None else None,
            }
        )
    return sort_items(cleaned)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))

    # ---------- helpers ----------

    def send_json(self, payload, status=200, cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length > MAX_BODY:
            return None
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def session_token(self):
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        return cookie["session"].value if "session" in cookie else None

    def current_user_key(self):
        token = self.session_token()
        if not token:
            return None
        tid = token_id(token)
        with sessions_lock:
            entry = sessions.get(tid)
            if not entry:
                return None
            if entry["expires"] < time.time():
                del sessions[tid]
                write_json(SESSIONS_FILE, sessions)
                return None
            return entry["user"]

    def start_session(self, key):
        token = secrets.token_urlsafe(32)
        with sessions_lock:
            sessions[token_id(token)] = {
                "user": key,
                "expires": time.time() + SESSION_SECONDS,
            }
            write_json(SESSIONS_FILE, sessions)
        return (
            f"session={token}; HttpOnly; SameSite=Strict; Path=/; "
            f"Max-Age={SESSION_SECONDS}"
        )

    # ---------- routes ----------

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/me":
            key = self.current_user_key()
            if not key:
                self.send_json({"error": "Not signed in."}, 401)
                return
            with lock:
                user = load_users().get(key)
            if not user:
                self.send_json({"error": "Not signed in."}, 401)
                return
            self.send_json(
                {"username": user["username"], "items": sort_items(user["items"])}
            )
            return

        if path in STATIC_FILES:
            self.path = STATIC_FILES[path]
            super().do_GET()
            return

        self.send_error(404, "Not found")

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path == "/api/logout":
            token = self.session_token()
            if token:
                with sessions_lock:
                    if sessions.pop(token_id(token), None):
                        write_json(SESSIONS_FILE, sessions)
            self.send_json(
                {"ok": True},
                cookie="session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
            )
            return

        if path not in ("/api/signup", "/api/login"):
            self.send_error(404, "Not found")
            return

        payload = self.read_json()
        if payload is None:
            self.send_json({"error": "Invalid data."}, 400)
            return

        username = str(payload.get("username") or "").strip()
        password = str(payload.get("password") or "")
        key = username.lower()

        if path == "/api/signup":
            self.handle_signup(username, key, password)
        else:
            self.handle_login(username, key, password)

    def handle_signup(self, username, key, password):
        if not USERNAME_RE.match(username):
            self.send_json(
                {"error": "Username must be 3-30 characters: letters, numbers, . _ -"},
                400,
            )
            return
        if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
            self.send_json(
                {"error": f"Password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters."},
                400,
            )
            return

        salt = os.urandom(16)
        pw_hash = hash_password(password, salt)

        with lock:
            users = load_users()
            if key in users:  # usernames are unique, case-insensitively
                self.send_json({"error": "That username is already taken."}, 409)
                return
            users[key] = {
                "username": username,
                "salt": salt.hex(),
                "hash": pw_hash.hex(),
                "items": [],
            }
            save_users(users)

        self.send_json(
            {"username": username, "items": []}, 201, self.start_session(key)
        )

    def handle_login(self, username, key, password):
        with lock:
            user = load_users().get(key)

        if not user:
            self.send_json({"error": "no_account"}, 404)
            return

        expected = bytes.fromhex(user["hash"])
        actual = hash_password(password, bytes.fromhex(user["salt"]))
        if not hmac.compare_digest(expected, actual):
            self.send_json({"error": "Incorrect password."}, 401)
            return

        self.send_json(
            {"username": user["username"], "items": sort_items(user["items"])},
            200,
            self.start_session(key),
        )

    def do_PUT(self):
        if self.path.split("?", 1)[0] != "/api/items":
            self.send_error(404, "Not found")
            return

        key = self.current_user_key()
        if not key:
            self.send_json({"error": "Not signed in."}, 401)
            return

        payload = self.read_json()
        items = payload.get("items") if payload else None
        if not isinstance(items, list):
            self.send_json({"error": "Tasks must be a list."}, 400)
            return

        cleaned = clean_items(items)
        with lock:
            users = load_users()
            if key not in users:
                self.send_json({"error": "Not signed in."}, 401)
                return
            users[key]["items"] = cleaned
            save_users(users)
        self.send_json({"items": cleaned})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Assignment Tracker is running at http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
    