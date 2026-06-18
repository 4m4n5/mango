#!/usr/bin/env python3
"""Phase 1 mango launcher server.

Stdlib-only static server plus fixed launch endpoints.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import socket
import subprocess
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final
from urllib.parse import unquote, urlparse

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
LAUNCHER_DIST: Final = REPO_ROOT / "src" / "launcher" / "dist"
OVERLAY_DIST: Final = REPO_ROOT / "src" / "overlay" / "dist"
LOG_DIR: Final = Path.home() / ".cache" / "mango"

LAUNCH_SCRIPTS: Final = {
    "/api/launch/stremio": REPO_ROOT / "scripts" / "launch-stremio.sh",
    "/api/launch/kodi": REPO_ROOT / "scripts" / "launch-kodi.sh",
    "/api/launch/launcher": REPO_ROOT / "scripts" / "launch-launcher.sh",
}


class MangoUiHandler(BaseHTTPRequestHandler):
    server_version = "mango-ui-server/0.1"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/info":
            self._write_json(
                {
                    "hostname": socket.gethostname(),
                    "ip": detect_ip_address(),
                    "launcher_port": self.server.server_port,
                    "companion_port": 3001,
                }
            )
            return
        if path.startswith("/overlay/"):
            self._serve_static(OVERLAY_DIST, path.removeprefix("/overlay/"), "index.html")
            return
        self._serve_static(LAUNCHER_DIST, path.removeprefix("/"), "index.html")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        script = LAUNCH_SCRIPTS.get(path)
        if script is None:
            self._write_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        if not script.is_file():
            self._write_json({"ok": False, "error": f"missing script: {script}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOG_DIR / "mango-ui-launch.log"
        env = os.environ.copy()
        env.update(
            {
                "DISPLAY": ":0",
                "XAUTHORITY": "/home/aman/.Xauthority",
                "HOME": "/home/aman",
            }
        )
        with log_path.open("ab") as log_file:
            subprocess.Popen(
                ["bash", str(script)],
                cwd=REPO_ROOT,
                env=env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self._write_json({"ok": True})

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}", file=sys.stderr)

    def _serve_static(self, root: Path, request_path: str, default_file: str) -> None:
        if request_path in ("", "/"):
            request_path = default_file
        request_path = unquote(request_path)
        target = (root / request_path).resolve()
        try:
            target.relative_to(root.resolve())
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if not target.is_file():
            self.send_error(HTTPStatus.NOT_FOUND, f"Missing build artifact: {target}")
            return
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _write_json(self, payload: dict[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def detect_ip_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("10.255.255.255", 1))
            return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve mango Phase 1 UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), MangoUiHandler)
    print(f"mango UI server listening on http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nmango UI server stopped")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
