#!/usr/bin/env python3
"""Local app server. Serves the tracker and saves each user's tasks in data/."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)
USER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,62}$")
PORT = 8765


def safe_username(name):
    name = unquote(name or "").strip()
    if not USER_NAME.match(name):
        return None
    if ".." in name or "/" in name or "\\" in name:
        return None
    return name


def user_path(name):
    return DATA_DIR / f"{name}.json"


def sort_items(items):
    return sorted(
        items,
        key=lambda item: (item.get("dueDate") or "", item.get("title") or ""),
    )


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None

    def do_GET(self):
        if self.path.split("?", 1)[0].startswith("/data"):
            self.send_error(403, "Forbidden")
            return

        if self.path == "/api/users":
            users = sorted(path.stem for path in DATA_DIR.glob("*.json"))
            self.send_json({"users": users})
            return

        if self.path.startswith("/api/users/"):
            name = safe_username(self.path[len("/api/users/") :].strip("/"))
            if not name:
                self.send_json({"error": "Enter a valid name."}, 400)
                return
            path = user_path(name)
            if not path.exists():
                self.send_json({"name": name, "items": []})
                return
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                self.send_json({"error": "Could not read saved tasks."}, 500)
                return
            items = saved.get("items", []) if isinstance(saved, dict) else []
            if not isinstance(items, list):
                items = []
            self.send_json({"name": name, "items": sort_items(items)})
            return

        super().do_GET()

    def do_PUT(self):
        if not self.path.startswith("/api/users/"):
            self.send_error(404, "Not found")
            return

        name = safe_username(self.path[len("/api/users/") :].strip("/"))
        if not name:
            self.send_json({"error": "Enter a valid name."}, 400)
            return

        payload = self.read_json()
        if payload is None:
            self.send_json({"error": "Invalid data."}, 400)
            return

        items = payload.get("items", [])
        if not isinstance(items, list):
            self.send_json({"error": "Tasks must be a list."}, 400)
            return

        cleaned = []
        for item in items:
            if not isinstance(item, dict):
                continue
            cleaned.append(
                {
                    "id": str(item.get("id") or ""),
                    "title": str(item.get("title") or "").strip(),
                    "className": str(item.get("className") or "").strip(),
                    "type": str(item.get("type") or "").strip(),
                    "dueDate": str(item.get("dueDate") or "").strip(),
                    "complete": bool(item.get("complete")),
                }
            )

        cleaned = sort_items(cleaned)
        user_path(name).write_text(
            json.dumps({"name": name, "items": cleaned}, indent=2) + "\n",
            encoding="utf-8",
        )
        self.send_json({"name": name, "items": cleaned})


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Assignment Tracker is running at http://127.0.0.1:{PORT}")
    print("Saved tasks go in the data folder, one JSON file per user.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
