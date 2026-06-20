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
import threading
import time
from collections import deque
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Final
from urllib.parse import parse_qs, unquote, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO_ROOT: Final = Path(__file__).resolve().parents[2]
LAUNCHER_DIST: Final = REPO_ROOT / "src" / "launcher" / "dist"
LOG_DIR: Final = Path.home() / ".cache" / "mango"
LOG_SCRIPT: Final = REPO_ROOT / "scripts" / "lib" / "mango-log.sh"
CATALOG_UPSTREAM: Final = os.environ.get("MANGO_CATALOG_UPSTREAM", "http://127.0.0.1:3020")
CATALOG_PROXY_TIMEOUT_SEC: Final = 60

LAUNCH_SCRIPTS: Final = {
    "/api/launch/stremio": REPO_ROOT / "scripts" / "launch-stremio.sh",
    "/api/launch/kodi": REPO_ROOT / "scripts" / "launch-kodi.sh",
    "/api/launch/launcher": REPO_ROOT / "scripts" / "launch-launcher.sh",
}
LAUNCH_DEBOUNCE_SEC: Final = 2.0
_last_launch_at: dict[str, float] = {}

_voice_lock: Final = threading.Lock()
_voice_command_seq: int = 0
_voice_commands: Final = deque[dict[str, object]](maxlen=64)
VOICE_COMMAND_TTL_SEC: Final = 45.0


def run_check(cmd: list[str]) -> bool:
    try:
        return subprocess.run(cmd, capture_output=True, check=False).returncode == 0
    except OSError:
        return False


def mango_log(event: str, **fields: str) -> None:
    if not LOG_SCRIPT.is_file():
        return
    args = [str(LOG_SCRIPT), event]
    args.extend(f"{key}={value}" for key, value in fields.items())
    subprocess.run(args, check=False, capture_output=True)


def _client_is_local(handler: BaseHTTPRequestHandler) -> bool:
    host = handler.client_address[0]
    return host in {"127.0.0.1", "::1", "localhost"}


def enqueue_voice_command(command: dict[str, object]) -> int:
    global _voice_command_seq
    with _voice_lock:
        _voice_command_seq += 1
        seq = _voice_command_seq
        entry = {"seq": seq, "issued_at": time.time(), **command}
        _voice_commands.append(entry)
    mango_log("voice_command", seq=str(seq), action=str(command.get("action", "")))
    return seq


def _prune_expired_voice_commands(now: float | None = None) -> None:
    cutoff = (now or time.time()) - VOICE_COMMAND_TTL_SEC
    fresh = deque(
        (
            entry
            for entry in _voice_commands
            if float(entry.get("issued_at", 0)) >= cutoff
        ),
        maxlen=_voice_commands.maxlen,
    )
    _voice_commands.clear()
    _voice_commands.extend(fresh)


def drain_voice_commands(after: int) -> tuple[list[dict[str, object]], int]:
    """Return pending commands once — never replay on later polls."""
    now = time.time()
    with _voice_lock:
        _prune_expired_voice_commands(now)
        pending = [
            entry
            for entry in list(_voice_commands)
            if int(entry.get("seq", 0)) > after
        ]
        pending_seqs = {int(entry.get("seq", 0)) for entry in pending}
        kept = deque(
            (
                entry
                for entry in _voice_commands
                if int(entry.get("seq", 0)) not in pending_seqs
            ),
            maxlen=_voice_commands.maxlen,
        )
        _voice_commands.clear()
        _voice_commands.extend(kept)
        return pending, _voice_command_seq


def latest_voice_command_seq() -> int:
    with _voice_lock:
        return _voice_command_seq


def collect_health(port: int) -> dict[str, object]:
    launcher_ok = (LAUNCHER_DIST / "index.html").is_file()
    chromium_ok = run_check(
        ["pgrep", "-f", f"chromium.*mango-launcher.*127.0.0.1:{port}/"]
    )
    tv_pad = run_check(["pgrep", "-f", "mango-tv-pad.py"])
    remapper = "unknown"
    if tv_pad:
        remapper = "tv_pad"
    elif run_check(["systemctl", "is-active", "--quiet", "input-remapper"]):
        remapper = "active"
    elif run_check(["systemctl", "is-active", "input-remapper"]):
        remapper = "inactive"
    openbox = "active" if run_check(["pgrep", "-x", "openbox"]) else "inactive"
    kodi = "down"
    kodi_ping = REPO_ROOT / "scripts" / "phase0" / "lib" / "kodi-rpc.sh"
    if kodi_ping.is_file():
        try:
            result = subprocess.run(
                ["bash", "-c", f'source "{kodi_ping}" && kodi_rpc JSONRPC.Ping'],
                capture_output=True,
                text=True,
                timeout=2,
                check=False,
            )
            if result.returncode == 0 and '"result"' in result.stdout:
                kodi = "up"
        except (OSError, subprocess.TimeoutExpired):
            kodi = "down"

    input_ok = remapper in ("active", "tv_pad")
    checks = {
        "launcher_dist": launcher_ok,
        "chromium": chromium_ok,
        "input_remapper": remapper,
        "tv_pad": tv_pad,
        "openbox": openbox,
        "kodi_rpc": kodi,
    }
    ok = launcher_ok and chromium_ok and input_ok and openbox == "active"
    return {"ok": ok, "checks": checks}


class MangoUiHandler(BaseHTTPRequestHandler):
    server_version = "mango-ui-server/0.1"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/catalog/"):
            self._proxy_catalog("GET")
            return
        if path == "/api/info":
            self._write_json(
                {
                    "hostname": socket.gethostname(),
                    "ip": detect_ip_address(),
                    "launcher_port": self.server.server_port,
                    "companion_port": 3001,
                    "fallback_stremio": env_enabled("MANGO_FALLBACK_STREMIO"),
                    "legacy_youtube": env_enabled("MANGO_LEGACY_YOUTUBE"),
                }
            )
            return
        if path == "/api/health":
            self._write_json(collect_health(self.server.server_port))
            return
        if path == "/api/voice/commands":
            parsed = urlparse(self.path)
            after_values = parse_qs(parsed.query).get("after", ["0"])
            try:
                after = max(0, int(after_values[0]))
            except (ValueError, IndexError):
                after = 0
            commands, latest_seq = drain_voice_commands(after)
            self._write_json({"ok": True, "latest_seq": latest_seq, "commands": commands})
            return
        if path == "/api/voice/state":
            self._write_json({"ok": True, "latest_seq": latest_voice_command_seq()})
            return
        if path.startswith("/overlay/"):
            self._write_json(
                {"ok": False, "error": "overlay deprecated; use launcher HUD"},
                HTTPStatus.GONE,
            )
            return
        self._serve_static(LAUNCHER_DIST, path.removeprefix("/"), "index.html")

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/voice/command":
            if not _client_is_local(self):
                self._write_json(
                    {"ok": False, "error": "voice commands are localhost-only"},
                    HTTPStatus.FORBIDDEN,
                )
                return
            length = int(self.headers.get("content-length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                command = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._write_json(
                    {"ok": False, "error": "invalid json"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            if not isinstance(command, dict) or command.get("type") != "launcher_command":
                self._write_json(
                    {"ok": False, "error": "expected launcher_command payload"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            seq = enqueue_voice_command(command)
            self._write_json({"ok": True, "seq": seq})
            return
        if path.startswith("/api/catalog/"):
            self._proxy_catalog("POST")
            return

        script = LAUNCH_SCRIPTS.get(path)
        if script is None:
            self._write_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)
            return
        if not script.is_file():
            self._write_json({"ok": False, "error": f"missing script: {script}"}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        action = path.removeprefix("/api/launch/")
        now = time.monotonic()
        last = _last_launch_at.get(action, 0.0)
        # Media apps may already be running — always allow refocus from the launcher.
        if action not in ("stremio", "kodi") and now - last < LAUNCH_DEBOUNCE_SEC:
            mango_log("api_launch", path=action, status="debounced")
            self._write_json({"ok": True, "debounced": True})
            return
        _last_launch_at[action] = now

        LOG_DIR.mkdir(parents=True, exist_ok=True)
        log_path = LOG_DIR / "mango-ui-launch.log"
        env = os.environ.copy()
        home = str(Path.home())
        env.update(
            {
                "DISPLAY": env.get("DISPLAY", ":0"),
                "XAUTHORITY": env.get("XAUTHORITY", f"{home}/.Xauthority"),
                "HOME": home,
            }
        )
        mango_log("api_launch", path=path.removeprefix("/api/launch/"), status="queued")
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

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/catalog/"):
            self._proxy_catalog("DELETE")
            return
        self._write_json({"ok": False, "error": "not found"}, HTTPStatus.NOT_FOUND)

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

    def _proxy_catalog(self, method: str) -> None:
        parsed = urlparse(self.path)
        upstream_path = parsed.path.removeprefix("/api/catalog")
        if not upstream_path.startswith("/"):
            upstream_path = f"/{upstream_path}"
        upstream_url = f"{CATALOG_UPSTREAM.rstrip('/')}{upstream_path}"
        if parsed.query:
            upstream_url = f"{upstream_url}?{parsed.query}"

        body = None
        headers = {"accept": "application/json"}
        if method == "POST":
            length = int(self.headers.get("content-length") or "0")
            body = self.rfile.read(length) if length > 0 else b"{}"
            headers["content-type"] = self.headers.get("content-type", "application/json")

        request = Request(upstream_url, data=body, method=method, headers=headers)
        try:
            with urlopen(request, timeout=CATALOG_PROXY_TIMEOUT_SEC) as response:
                data = response.read()
                status = response.status
        except HTTPError as error:
            data = error.read() or json.dumps({"error": str(error)}).encode("utf-8")
            status = error.code
        except URLError as error:
            self._write_json(
                {"ok": False, "error": f"catalog-service unavailable: {error.reason}"},
                HTTPStatus.BAD_GATEWAY,
            )
            return
        except TimeoutError:
            self._write_json(
                {"ok": False, "error": "catalog-service timeout"},
                HTTPStatus.GATEWAY_TIMEOUT,
            )
            return

        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
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


def env_enabled(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve mango Phase 1 UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    mango_log("server_start", host=args.host, port=str(args.port))
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
