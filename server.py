#!/usr/bin/env python3
"""Localhost HTTP server wrapping the pomodoro CLI.

Endpoints:
  GET  /status            -> JSON from `pomodoro status --json`
  POST /toggle            -> run `pomodoro toggle` (optional body {task_id|task_text})
  POST /stop              -> run `pomodoro stop`
  POST /skip              -> run `pomodoro skip`
  POST /reset             -> run `pomodoro reset`
  POST /set-task          -> body {task_id|task_text|clear:true}
  GET  /tasks[?all=1]     -> list pending tasks (or all)
  POST /tasks             -> body {title, due_at?, scheduled_at?, notes?}
  POST /tasks/<id>/update -> body with fields to merge
  POST /tasks/<id>/complete
  POST /tasks/<id>/uncomplete
  POST /tasks/<id>/delete
  GET  /learnings[?today=1] -> list learnings (or today's summary)
  GET  /learnings/recall    -> one past learning to resurface today (or {})
  POST /learnings           -> body {text}
  GET  /motd                -> today's message of the day (or {} if none)
  GET  /review[?start=&end=] -> week-in-review report JSON (last Sun-Sat week)

Binds to 127.0.0.1 only. Port defaults to 17234, override with POMODORO_PORT.
CORS is open (*) — safe because we only listen on the loopback interface.
"""

import json
import os
import re
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

CLI = Path(__file__).resolve().parent / "pomodoro"
PORT = int(os.environ.get("POMODORO_PORT", "17234"))
HOST = "127.0.0.1"


def run_cli(*args: str, stdin: str | None = None, timeout: float = 10) -> dict:
    proc = subprocess.run(
        [str(CLI), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        input=stdin if stdin is not None else "",
    )
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip()
        try:
            return json.loads(err) if err.startswith("{") else {"error": err or f"exit {proc.returncode}"}
        except json.JSONDecodeError:
            return {"error": err or f"exit {proc.returncode}"}
    out = proc.stdout.strip()
    if not out:
        return {}
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"raw": out}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self._send(204, {})

    def _read_body(self) -> str:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return ""
        return self.rfile.read(length).decode("utf-8", errors="replace")

    def do_GET(self) -> None:
        if self.path == "/status":
            self._send(200, run_cli("status", "--json"))
            return
        if self.path == "/tasks" or self.path.startswith("/tasks?"):
            args = ["tasks", "list"]
            if "all=1" in self.path or "all=true" in self.path:
                args.append("--all")
            self._send(200, run_cli(*args))
            return
        if self.path == "/learnings/recall":
            self._send(200, run_cli("learning", "recall"))
            return
        if self.path == "/learnings" or self.path.startswith("/learnings?"):
            if "today=1" in self.path or "today=true" in self.path:
                self._send(200, run_cli("learning", "today"))
            else:
                self._send(200, run_cli("learning", "list"))
            return
        if self.path == "/motd":
            self._send(200, run_cli("motd", "current", "--json"))
            return
        if self.path == "/review" or self.path.startswith("/review?"):
            # Scans git repos across the filesystem — give it room beyond the default.
            q = parse_qs(urlsplit(self.path).query)
            args = ["review", "--json"]
            if q.get("start"):
                args += ["--start", q["start"][0]]
            if q.get("end"):
                args += ["--end", q["end"][0]]
            self._send(200, run_cli(*args, timeout=60))
            return
        self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        simple = {"/toggle": "toggle", "/stop": "stop", "/skip": "skip", "/reset": "reset"}
        if self.path in simple:
            body = self._read_body() if self.path == "/toggle" else ""
            run_cli(simple[self.path], stdin=body)
            self._send(200, run_cli("status", "--json"))
            return
        if self.path == "/set-task":
            body = self._read_body()
            result = run_cli("set-task", stdin=body)
            if "error" in result:
                self._send(400, result)
                return
            self._send(200, run_cli("status", "--json"))
            return
        if self.path == "/tasks":
            body = self._read_body()
            result = run_cli("tasks", "add", stdin=body)
            self._send(400 if "error" in result else 200, result)
            return
        if self.path == "/learnings":
            body = self._read_body()
            result = run_cli("learning", "add", stdin=body)
            self._send(400 if "error" in result else 200, result)
            return
        m = re.fullmatch(r"/tasks/(\d+)/(update|complete|uncomplete|delete)", self.path)
        if m:
            tid, op = m.group(1), m.group(2)
            body = self._read_body() if op == "update" else ""
            result = run_cli("tasks", op, tid, stdin=body)
            self._send(404 if result.get("error") == "not found" else (400 if "error" in result else 200), result)
            return
        self._send(404, {"error": "not found"})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write(f"[pomodoro-server] {self.address_string()} {fmt % args}\n")


def main() -> None:
    if not CLI.exists():
        sys.exit(f"CLI not found at {CLI}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[pomodoro-server] listening on http://{HOST}:{PORT}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
