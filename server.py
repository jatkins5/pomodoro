#!/usr/bin/env python3
"""Localhost HTTP server wrapping the pomodoro CLI.

Endpoints:
  GET  /status   -> JSON from `pomodoro status --json`
  POST /toggle   -> run `pomodoro toggle`, return new status
  POST /stop     -> run `pomodoro stop`,   return new status
  POST /skip     -> run `pomodoro skip`,   return new status
  POST /reset    -> run `pomodoro reset`,  return new status

Binds to 127.0.0.1 only. Port defaults to 17234, override with POMODORO_PORT.
CORS is open (*) — safe because we only listen on the loopback interface.
"""

import json
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

CLI = Path(__file__).resolve().parent / "pomodoro"
PORT = int(os.environ.get("POMODORO_PORT", "17234"))
HOST = "127.0.0.1"


def run_cli(*args: str) -> dict:
    proc = subprocess.run(
        [str(CLI), *args],
        capture_output=True,
        text=True,
        timeout=10,
    )
    if proc.returncode != 0:
        return {"error": proc.stderr.strip() or f"exit {proc.returncode}"}
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

    def do_GET(self) -> None:
        if self.path == "/status":
            self._send(200, run_cli("status", "--json"))
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        actions = {"/toggle": "toggle", "/stop": "stop", "/skip": "skip", "/reset": "reset"}
        action = actions.get(self.path)
        if action is None:
            self._send(404, {"error": "not found"})
            return
        run_cli(action)
        self._send(200, run_cli("status", "--json"))

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
