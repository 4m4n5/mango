#!/usr/bin/env python3
"""Serve recorded catalog-service responses so the launcher renders on a Mac.

The launcher's vite.config.ts already proxies /api to 127.0.0.1:3000, so this
server needs no changes to launcher source. Fixtures are recorded from a real Pi
and live OUTSIDE the repo (they contain debrid playback tokens) — default
~/.cache/mango-ux/fixtures, override with MANGO_UX_FIXTURES.

Scenario control lets the harness render states the Pi cannot be forced into:
a control file (default ~/.cache/mango-ux/control.json) is re-read per request,
so capture runs can flip latency/empty/error without restarting.

    {"delay_ms": 2500, "empty": ["rails"], "fail": ["stream"], "status": 503}

Usage:
    python3 tools/ux-harness/mock-api.py            # port 3000
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlparse

FIXTURES = Path(os.environ.get("MANGO_UX_FIXTURES", Path.home() / ".cache/mango-ux/fixtures"))
CONTROL = Path(os.environ.get("MANGO_UX_CONTROL", Path.home() / ".cache/mango-ux/control.json"))
PORT = int(os.environ.get("MANGO_UX_MOCK_PORT", "3000"))

# Path prefixes that should answer for ANY id, so navigating to any card works
# even though only a couple of titles were recorded.
FALLBACKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"^/api/catalog/meta/movie/"), "detail-movie.json"),
    (re.compile(r"^/api/catalog/meta/series/"), "detail-series.json"),
    (re.compile(r"^/api/catalog/meta/tv/"), "detail-movie.json"),
    (re.compile(r"^/api/catalog/series/[^/]+/episodes"), "series-episodes.json"),
    (re.compile(r"^/api/catalog/stream/movie/"), "streams-movie.json"),
    (re.compile(r"^/api/catalog/stream/series/"), "streams-series-episode.json"),
    (re.compile(r"^/api/catalog/stream/tv/"), "streams-movie.json"),
    (re.compile(r"^/api/catalog/youtube/"), "home-youtube-rails.json"),
    # Suggestions were recorded for one query, so an exact match needs that same
    # query typed; answering any query keeps the suggestions state reachable.
    (re.compile(r"^/api/catalog/search/suggestions"), "search-suggestions.json"),
    (re.compile(r"^/api/catalog/search"), "search-query-start.json"),
]

# Which fixture families a control-file keyword blanks or fails.
FAMILIES = {
    "rails": re.compile(r"^/api/catalog/(rails|youtube)"),
    "detail": re.compile(r"^/api/catalog/(meta|series)/"),
    "stream": re.compile(r"^/api/catalog/stream/"),
    "search": re.compile(r"^/api/catalog/search"),
    "library": re.compile(r"^/api/catalog/(library|saved)"),
    "health": re.compile(r"^/api/(health|catalog/health|info)"),
}


def load_index() -> dict[str, str]:
    """Map "path?sorted-query" -> fixture filename from the recording manifest."""
    index: dict[str, str] = {}
    manifest = FIXTURES / "manifest.json"
    if not manifest.exists():
        return index
    raw = json.loads(manifest.read_text())
    entries = raw if isinstance(raw, list) else raw.get("entries") or raw.get("files") or []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        url, name = entry.get("url"), entry.get("file")
        if not url or not name or int(entry.get("status", 200)) >= 400:
            continue
        index[canonical(url)] = name
    return index


def canonical(url: str) -> str:
    parsed = urlparse(url)
    query = sorted(parse_qsl(parsed.query))
    # tab= and id-ish params decide which fixture applies; drop volatile ones.
    keep = [(k, v) for k, v in query if k in {"tab", "scope", "q", "query"}]
    suffix = "&".join(f"{k}={v}" for k, v in keep)
    return f"{parsed.path}?{suffix}" if suffix else parsed.path


def control() -> dict:
    try:
        return json.loads(CONTROL.read_text())
    except Exception:
        return {}


def blank_like(payload):
    """Preserve response shape while emptying its collections."""
    if isinstance(payload, list):
        return []
    if isinstance(payload, dict):
        return {
            key: ([] if isinstance(value, list) else blank_like(value) if isinstance(value, dict) else value)
            for key, value in payload.items()
        }
    return payload


class Handler(BaseHTTPRequestHandler):
    index: dict[str, str] = {}
    missing: set[str] = set()
    protocol_version = "HTTP/1.1"

    # Long-poll endpoints the launcher holds open continuously. Answering them
    # with an empty batch after a short wait keeps the client from hot-looping.
    LONG_POLL = ("/api/voice/commands", "/api/pad/nav")

    def log_message(self, fmt, *args):  # quieter than the default
        pass

    def _send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def resolve(self, path_with_query: str) -> Path | None:
        key = canonical(path_with_query)
        name = self.index.get(key) or self.index.get(urlparse(path_with_query).path)
        if name:
            candidate = FIXTURES / name
            if candidate.exists():
                return candidate
        for pattern, name in FALLBACKS:
            if pattern.match(urlparse(path_with_query).path):
                candidate = FIXTURES / name
                if candidate.exists():
                    return candidate
        return None

    def families_for(self, path: str) -> set[str]:
        return {name for name, pattern in FAMILIES.items() if pattern.match(path)}

    def do_GET(self) -> None:  # noqa: N802
        cfg = control()
        parsed = urlparse(self.path)
        path = parsed.path

        if path in self.LONG_POLL:
            after = dict(parse_qsl(parsed.query)).get("after", "0")
            time.sleep(float(os.environ.get("MANGO_UX_LONGPOLL_SEC", "1.0")))
            seq = int(after) if after.isdigit() else 0
            self._send(200, json.dumps({"latest_seq": seq, "commands": [], "events": []}).encode())
            return

        families = self.families_for(path)

        delay_ms = int(cfg.get("delay_ms") or 0)
        if delay_ms and (not cfg.get("delay_only") or families & set(cfg.get("delay_only", []))):
            time.sleep(delay_ms / 1000)

        if families & set(cfg.get("fail", [])):
            status = int(cfg.get("status") or 503)
            self._send(status, json.dumps({"error": "harness-forced-failure"}).encode())
            return

        fixture = self.resolve(self.path)
        if fixture is None:
            if path not in self.missing:
                self.missing.add(path)
                print(f"  [mock] no fixture for {path}", file=sys.stderr)
            self._send(404, json.dumps({"error": "no fixture", "path": path}).encode())
            return

        payload = json.loads(fixture.read_text())
        if families & set(cfg.get("empty", [])):
            payload = blank_like(payload)
        self._send(200, json.dumps(payload).encode())

    def do_POST(self) -> None:  # noqa: N802
        cfg = control()
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        if length:
            self.rfile.read(length)
        # Never emulate success for playback unless asked: the interesting UI
        # state is the failure path, and nothing can actually play on a Mac.
        if "play" in path:
            if cfg.get("play") == "ok":
                self._send(200, json.dumps({"ok": True, "played": True}).encode())
            else:
                self._send(
                    int(cfg.get("status") or 502),
                    json.dumps({"error": "no playable stream (harness)"}).encode(),
                )
            return
        self._send(200, json.dumps({"ok": True}).encode())


def main() -> int:
    if not FIXTURES.exists():
        print(f"fixtures not found: {FIXTURES}", file=sys.stderr)
        return 1
    Handler.index = load_index()
    CONTROL.parent.mkdir(parents=True, exist_ok=True)
    if not CONTROL.exists():
        CONTROL.write_text("{}\n")
    print(f"mock-api: {len(Handler.index)} recorded routes from {FIXTURES}")
    print(f"mock-api: control file {CONTROL}")
    print(f"mock-api: listening on http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
