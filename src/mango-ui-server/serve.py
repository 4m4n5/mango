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
PAD_HEALTH_SCRIPT: Final = REPO_ROOT / "scripts" / "m1-foundation" / "pad" / "pad-health.sh"
ACTIVITY_STATE: Final = Path(os.environ.get("MANGO_COUCH_ACTIVITY_STATE", str(LOG_DIR / "couch-activity.json")))
PERF_LOG: Final = LOG_DIR / "launcher-perf.jsonl"
CATALOG_UPSTREAM: Final = os.environ.get("MANGO_CATALOG_UPSTREAM", "http://127.0.0.1:3020")
CATALOG_PROXY_TIMEOUT_SEC: Final = 60

LAUNCH_SCRIPTS: Final = {
    "/api/launch/launcher": REPO_ROOT / "scripts" / "launch-launcher.sh",
}
MPV_STOP_SCRIPT: Final = REPO_ROOT / "scripts" / "m2-catalog" / "service" / "mpv-stop.sh"
LAUNCH_DEBOUNCE_SEC: Final = 2.0
_last_launch_at: dict[str, float] = {}

_voice_lock: Final = threading.Lock()
_voice_commands: Final = deque[dict[str, object]](maxlen=64)
VOICE_COMMAND_TTL_SEC: Final = 45.0
VOICE_SEQ_FILE: Final = LOG_DIR / "voice-command-seq"


def _load_persisted_voice_seq() -> int:
    try:
        return max(0, int(VOICE_SEQ_FILE.read_text(encoding="utf-8").strip()))
    except (OSError, ValueError):
        return 0


def _persist_voice_seq(seq: int) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    VOICE_SEQ_FILE.write_text(f"{seq}\n", encoding="utf-8")


_voice_command_seq: int = _load_persisted_voice_seq()


def run_check(cmd: list[str]) -> bool:
    try:
        return subprocess.run(cmd, capture_output=True, check=False).returncode == 0
    except OSError:
        return False


def run_json(cmd: list[str], timeout: float = 2.0) -> dict[str, object]:
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if result.returncode != 0 and not result.stdout.strip():
        return {}
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def mango_log(event: str, **fields: str) -> None:
    if not LOG_SCRIPT.is_file():
        return
    args = [str(LOG_SCRIPT), event]
    args.extend(f"{key}={value}" for key, value in fields.items())
    subprocess.run(args, check=False, capture_output=True)


def _safe_field(value: object, limit: int = 96) -> str:
    return str(value or "")[:limit]


def touch_couch_activity(source: str, hint: str = "") -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ACTIVITY_STATE.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": int(time.time() * 1000),
        "source": _safe_field(source, 64),
        "hint": _safe_field(hint, 96),
        "pid": os.getpid(),
    }
    tmp = ACTIVITY_STATE.with_suffix(ACTIVITY_STATE.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp.replace(ACTIVITY_STATE)


def append_perf_event(payload: dict[str, object]) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    row = {
        "server_ts": int(time.time() * 1000),
        "event": _safe_field(payload.get("event"), 64),
        "tab": _safe_field(payload.get("tab"), 32),
        "key": _safe_field(payload.get("key"), 160),
        "state": _safe_field(payload.get("state"), 32),
        "duration_ms": payload.get("duration_ms"),
        "rows": payload.get("rows"),
        "rails": payload.get("rails"),
        "items": payload.get("items"),
        "reshuffle": payload.get("reshuffle"),
    }
    with PERF_LOG.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, separators=(",", ":")) + "\n")


def _client_is_local(handler: BaseHTTPRequestHandler) -> bool:
    host = handler.client_address[0]
    return host in {"127.0.0.1", "::1", "localhost"}


def enqueue_voice_command(command: dict[str, object]) -> int:
    global _voice_command_seq, _last_voice_ack
    action = str(command.get("action", ""))
    with _voice_lock:
        _voice_command_seq += 1
        seq = _voice_command_seq
        entry = {"seq": seq, "issued_at": time.time(), **command}
        _voice_commands.append(entry)
    with _voice_ack_lock:
        _last_voice_ack = {
            "ok": False,
            "seq": seq,
            "action": action,
            "reason": "pending",
            "at": time.time(),
        }
    _persist_voice_seq(seq)
    mango_log("voice_command", seq=str(seq), action=action)
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


_voice_ack_lock: Final = threading.Lock()
_last_voice_ack: dict[str, object] = {
    "ok": False,
    "seq": 0,
    "action": "",
    "reason": "",
    "at": 0.0,
}


def latest_voice_command_seq() -> int:
    with _voice_lock:
        return _voice_command_seq


def read_voice_ack() -> dict[str, object]:
    with _voice_ack_lock:
        return dict(_last_voice_ack)


def record_voice_ack(payload: dict[str, object]) -> dict[str, object]:
    global _last_voice_ack
    with _voice_ack_lock:
        _last_voice_ack = {
            "ok": bool(payload.get("ok")),
            "seq": max(0, int(payload.get("seq", 0) or 0)),
            "action": str(payload.get("action", "")),
            "reason": str(payload.get("reason", "")),
            "at": time.time(),
        }
        mango_log(
            "voice_ack",
            seq=str(_last_voice_ack["seq"]),
            action=str(_last_voice_ack["action"]),
            ok="1" if _last_voice_ack["ok"] else "0",
            reason=str(_last_voice_ack["reason"]),
        )
        return dict(_last_voice_ack)


def collect_health(port: int) -> dict[str, object]:
    launcher_ok = (LAUNCHER_DIST / "index.html").is_file()
    chromium_ok = run_check(
        ["pgrep", "-f", f"chromium.*mango-launcher.*127.0.0.1:{port}/"]
    )
    firefox_ok = run_check(["pgrep", "-f", f"firefox.*127.0.0.1:{port}/"])
    browser_ok = chromium_ok or firefox_ok
    pad_health = (
        run_json(["bash", str(PAD_HEALTH_SCRIPT), "--json", "--quiet"], timeout=3.0)
        if PAD_HEALTH_SCRIPT.is_file()
        else {}
    )
    tv_pad = bool(pad_health.get("ok")) or run_check(["pgrep", "-f", "mango-tv-pad.py"])
    tv_pad_ready = bool(pad_health.get("ok")) if pad_health else tv_pad
    remapper = "unknown"
    if tv_pad_ready:
        remapper = "tv_pad"
    elif run_check(["systemctl", "is-active", "--quiet", "input-remapper"]):
        remapper = "active"
    elif run_check(["systemctl", "is-active", "input-remapper"]):
        remapper = "inactive"
    openbox = "active" if run_check(["pgrep", "-x", "openbox"]) else "inactive"
    catalog_expected = os.environ.get("MANGO_CATALOG", "1").strip() != "0"
    catalog_health = collect_catalog_health() if catalog_expected else {"ok": True}

    input_ok = remapper in ("active", "tv_pad")
    checks = {
        "launcher_dist": launcher_ok,
        "launcher_browser": browser_ok,
        "chromium": browser_ok,
        "firefox": firefox_ok,
        "input_remapper": remapper,
        "tv_pad": tv_pad_ready,
        "tv_pad_reason": str(pad_health.get("reason", "")) if pad_health else "",
        "tv_pad_device": str(pad_health.get("current_device_path", "")) if pad_health else "",
        "catalog": bool(catalog_health.get("ok")),
        "catalog_core": str(catalog_health.get("core", "")),
        "catalog_rails_ready": bool(catalog_health.get("rails_ready", False)),
        "catalog_live_ready": bool(catalog_health.get("live_ready", True)),
        "openbox": openbox,
    }
    ok = (
        launcher_ok
        and browser_ok
        and input_ok
        and tv_pad_ready
        and bool(catalog_health.get("ok"))
        and openbox == "active"
    )
    return {"ok": ok, "checks": checks}


def collect_catalog_health() -> dict[str, object]:
    try:
        request = Request(f"{CATALOG_UPSTREAM.rstrip('/')}/health", method="GET")
        with urlopen(request, timeout=3) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return {"ok": False, "core": "down", "rails_ready": False, "live_ready": False}
    if not isinstance(data, dict):
        return {"ok": False, "core": "invalid", "rails_ready": False, "live_ready": False}
    live = data.get("live")
    live_ready = bool(data.get("live_ready", True))
    if isinstance(live, dict) and "ready" in live:
        live_ready = live_ready and bool(live.get("ready"))
    ready = (
        bool(data.get("ok"))
        and data.get("core") == "ready"
        and bool(data.get("rails_ready"))
        and live_ready
    )
    return {
        "ok": ready,
        "core": str(data.get("core", "")),
        "rails_ready": bool(data.get("rails_ready")),
        "live_ready": live_ready,
    }


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
        if path == "/api/voice/ack":
            self._write_json({"ok": True, **read_voice_ack()})
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
        if path == "/api/activity/touch":
            if not _client_is_local(self):
                self._write_json(
                    {"ok": False, "error": "activity is localhost-only"},
                    HTTPStatus.FORBIDDEN,
                )
                return
            payload = self._read_json_body()
            touch_couch_activity(
                _safe_field(payload.get("source"), 64) or "launcher",
                _safe_field(payload.get("hint"), 96),
            )
            self._write_json({"ok": True})
            return
        if path == "/api/perf":
            if not _client_is_local(self):
                self._write_json(
                    {"ok": False, "error": "perf logs are localhost-only"},
                    HTTPStatus.FORBIDDEN,
                )
                return
            append_perf_event(self._read_json_body())
            self._write_json({"ok": True})
            return
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
        if path == "/api/voice/ack":
            if not _client_is_local(self):
                self._write_json(
                    {"ok": False, "error": "voice ack is localhost-only"},
                    HTTPStatus.FORBIDDEN,
                )
                return
            length = int(self.headers.get("content-length") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self._write_json(
                    {"ok": False, "error": "invalid json"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            if not isinstance(payload, dict):
                self._write_json(
                    {"ok": False, "error": "expected object"},
                    HTTPStatus.BAD_REQUEST,
                )
                return
            ack = record_voice_ack(payload)
            self._write_json({"ok": True, **ack})
            return
        if path.startswith("/api/catalog/"):
            self._proxy_catalog("POST")
            return
        if path == "/api/playback/stop":
            if not _client_is_local(self):
                self._write_json(
                    {"ok": False, "error": "playback stop is localhost-only"},
                    HTTPStatus.FORBIDDEN,
                )
                return
            if not MPV_STOP_SCRIPT.is_file():
                self._write_json(
                    {"ok": False, "error": f"missing script: {MPV_STOP_SCRIPT}"},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            env = os.environ.copy()
            env["MANGO_MPV_STOP_HOME"] = "1"
            env.setdefault("DISPLAY", ":0")
            env.setdefault("XAUTHORITY", str(Path.home() / ".Xauthority"))
            try:
                subprocess.run(
                    ["bash", str(MPV_STOP_SCRIPT)],
                    env=env,
                    capture_output=True,
                    check=False,
                    timeout=6,
                )
            except (OSError, subprocess.TimeoutExpired) as exc:
                self._write_json(
                    {"ok": False, "error": str(exc)},
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                )
                return
            mango_log("playback_stop", status="ok")
            self._write_json({"ok": True, "stopped": True})
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
        if now - last < LAUNCH_DEBOUNCE_SEC:
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
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _read_json_body(self) -> dict[str, object]:
        length = int(self.headers.get("content-length") or "0")
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

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
        if method in {"POST", "DELETE"}:
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
