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
    {"stream_count": 14}   # expand the streams panel to a full ladder
    {"all_unverified": true}   # every stream unverified: floor-only label, dashed rows

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

# A recorded stream response holds whatever that one title resolved to on the day
# it was captured — Dune came back with a single 2160p bubble. The streams panel's
# real design problem is a long ladder, which no recording on hand contains and
# which cannot be re-recorded without Pi access, so `{"stream_count": 14}` in the
# control file expands the panel to a realistic ladder. Fields mirror the recorded
# schema exactly (see FIELDS in a captured streams-movie.json); values are ordered
# the way a debrid resolver returns them, best-first, and are deterministic so
# screenshots are reproducible. URLs are placeholders — nothing can play on a Mac.
SYNTHETIC_LADDER: list[dict] = [
    ("2160p", "BluRay REMUX", "HEVC", ["DV", "HDR10"], 78.4, "cached", "FraMeSToR", "4k_dv_remux_cached"),
    ("2160p", "BluRay", "HEVC", ["HDR10"], 54.1, "cached", "SWTYBLZ", "4k_hdr_remux_cached"),
    ("2160p", "WEB-DL", "HEVC", ["DV"], 18.6, "cached", "FLUX", "4k_dv_web_cached"),
    ("2160p", "WEB-DL", "HEVC", ["HDR10+"], 14.2, "cached", "NTb", "4k_hdr_web_cached"),
    ("2160p", "WEB-DL", "AV1", [], 9.8, "cached", "CtrlHD", "4k_sdr_web_cached"),
    ("1080p", "BluRay REMUX", "H.264", [], 24.9, "cached", "FraMeSToR", "1080p_remux_cached"),
    ("1080p", "BluRay", "HEVC", [], 8.3, "cached", "TAoE", "1080p_bluray_cached"),
    ("1080p", "BluRay", "H.264", [], 12.1, "cached", "SPARKS", "1080p_bluray_cached"),
    ("1080p", "WEB-DL", "H.264", [], 5.5, "cached", "NTb", "1080p_web_cached"),
    ("1080p", "WEB-DL", "HEVC", [], 3.9, "cached", "FLUX", "1080p_web_cached"),
    ("1080p", "WEBRip", "H.264", [], 4.2, "uncached", "RARBG", "1080p_uncached_fallback"),
    ("720p", "BluRay", "H.264", [], 2.1, "cached", "PSA", "720p_bluray_cached"),
    ("720p", "WEB-DL", "H.264", [], 1.4, "cached", "ION10", "720p_web_cached"),
    ("480p", "WEBRip", "H.264", [], 0.7, "uncached", "YTS", "obligation_floor"),
    ("1080p", "HDTV", "H.264", [], 3.1, "unknown", "MeGusta", "last_resort"),
    ("2160p", "WEB-DL", "HEVC", ["HDR10"], 22.7, "uncached", "SMURF", "4k_sdr_soft_cached"),
]

SYNTHETIC_LANGS = [
    ["English"],
    ["English", "French", "German", "Italian", "Spanish", "Korean"],
    ["English", "Spanish"],
    ["English", "Hindi", "Tamil"],
]


def synthetic_streams(count: int, base: dict | None) -> list[dict]:
    """Expand the streams panel to `count` bubbles across the ladder."""
    out: list[dict] = []
    for index in range(min(count, len(SYNTHETIC_LADDER))):
        res, tier, encode, hdr, size, cache, group, step = SYNTHETIC_LADDER[index]
        stream = dict(base) if base else {}
        stream.update({
            "name": f"[{'TB⚡' if cache == 'cached' else 'TB'}] Torrentio {res}",
            "title": f"[{'TB⚡' if cache == 'cached' else 'TB'}] Torrentio {res}",
            "url": f"http://127.0.0.1:3035/api/v1/harness/placeholder/{index}",
            "source": "AIOStreams",
            "resolution": res,
            "release_tier": tier,
            "release_group": group,
            "encode": encode,
            "hdr_tags": hdr,
            "size_gb": size,
            "indexer": group,
            "languages": SYNTHETIC_LANGS[index % len(SYNTHETIC_LANGS)],
            "debrid_service": "torbox",
            "cache_status": cache,
            "display_label": f"{res} {tier} {encode} · {group} · {size:.0f} GB",
            "ladder_step": step,
            "behaviorHints": {"videoSize": int(size * 1_000_000_000)},
        })
        out.append(stream)
    return out


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

    def resolve(self, path_with_query: str, fallbacks: bool = True) -> Path | None:
        key = canonical(path_with_query)
        name = self.index.get(key) or self.index.get(urlparse(path_with_query).path)
        if name:
            candidate = FIXTURES / name
            if candidate.exists():
                return candidate
        if not fallbacks:
            return None
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
            # An emptied progressive Search job would otherwise stay "Searching"
            # forever (incomplete + no groups). Force completion so the couch
            # surface can show the neutral No results state.
            if "search" in families and isinstance(payload, dict) and "complete" in payload:
                payload["complete"] = True
        stream_count = int(cfg.get("stream_count") or 0)
        if stream_count and "stream" in families and isinstance(payload, dict):
            recorded = payload.get("streams") or []
            payload["streams"] = synthetic_streams(stream_count, recorded[0] if recorded else None)
        # An all-unverified ladder is its own layout case -- the panel label switches to
        # the floor-only form and every row goes dashed -- and it is common enough on the
        # Pi that the first real screenshots of it caught two defects. No recorded fixture
        # produces it, and the synthetic ladder is deliberately mixed, so it has to be
        # asked for explicitly.
        if cfg.get("all_unverified") and "stream" in families and isinstance(payload, dict):
            for stream in payload.get("streams") or []:
                stream["unverified"] = True
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
                    json.dumps({"error": "couldn't start playback. try another title."}).encode(),
                )
            return
        # A recorded POST body is served when the manifest captured that exact
        # URL — submitting a Search needs the snapshot the Pi replied with, and
        # answering {"ok": true} left the whole results surface unreachable
        # locally. Prefix fallbacks are deliberately not consulted: they would
        # answer mutations like cancel or library writes with a stranger's body.
        fixture = self.resolve(self.path, fallbacks=False)
        if fixture is None:
            self._send(200, json.dumps({"ok": True}).encode())
            return
        payload = json.loads(fixture.read_text())
        if self.families_for(path) & set(cfg.get("empty", [])):
            payload = blank_like(payload)
            if isinstance(payload, dict) and "complete" in payload:
                payload["complete"] = True
        self._send(200, json.dumps(payload).encode())


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
