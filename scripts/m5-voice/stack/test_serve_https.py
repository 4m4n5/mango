#!/usr/bin/env python3
"""Focused security tests for the LAN-facing companion catalog proxy."""

from __future__ import annotations

import functools
import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from unittest import mock


SCRIPT = Path(__file__).with_name("serve_https.py")
COMPANION_MAIN = Path(__file__).resolve().parents[3] / "src/companion/src/main.ts"
CATALOG_INDEX = Path(__file__).resolve().parents[3] / "src/catalog-service/src/index.ts"
SPEC = importlib.util.spec_from_file_location("mango_companion_serve_https", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
SERVE_HTTPS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SERVE_HTTPS)


class RecordingCatalogHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        self._record_and_reply("GET")

    def do_POST(self) -> None:
        self._record_and_reply("POST")

    def do_DELETE(self) -> None:
        self._record_and_reply("DELETE")

    def _record_and_reply(self, method: str) -> None:
        length = int(self.headers.get("content-length") or "0")
        body = self.rfile.read(length) if length else b""
        calls = getattr(self.server, "calls")
        calls.append((method, self.path, body))
        payload = json.dumps({
            "ok": True,
            "method": method,
            "path": self.path,
        }).encode() + b"\n"
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class QuietCompanionHandler(SERVE_HTTPS.CompanionRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return


@contextmanager
def running_proxy() -> Iterator[tuple[int, list[tuple[str, str, bytes]]]]:
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), RecordingCatalogHandler)
    upstream.calls = []
    upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    upstream_thread.start()

    with tempfile.TemporaryDirectory() as static_dir:
        handler = functools.partial(
            QuietCompanionHandler,
            directory=static_dir,
            catalog_upstream=f"http://127.0.0.1:{upstream.server_port}",
        )
        companion = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        companion_thread = threading.Thread(target=companion.serve_forever, daemon=True)
        companion_thread.start()
        try:
            yield companion.server_port, upstream.calls
        finally:
            companion.shutdown()
            companion.server_close()
            companion_thread.join(timeout=2)
            upstream.shutdown()
            upstream.server_close()
            upstream_thread.join(timeout=2)


def request_proxy(port: int, method: str, path: str) -> tuple[int, dict[str, object]]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=2)
    try:
        connection.request(method, path, headers={"accept": "application/json"})
        response = connection.getresponse()
        return response.status, json.loads(response.read())
    finally:
        connection.close()


class CompanionCatalogProxyTest(unittest.TestCase):
    def test_every_companion_capability_still_proxies(self) -> None:
        allowed = [
            ("GET", "/api/catalog/ai/context"),
            ("GET", "/api/catalog/voice/companion/summary"),
            ("GET", "/api/catalog/youtube/companion/status"),
            ("POST", "/api/catalog/youtube/companion/auth/start"),
            ("GET", "/api/catalog/youtube/companion/auth/poll?session_id=session%2D123"),
            ("POST", "/api/catalog/youtube/companion/auth/disconnect"),
        ]
        with running_proxy() as (port, calls):
            for method, path in allowed:
                with self.subTest(method=method, path=path):
                    status, payload = request_proxy(port, method, path)
                    self.assertEqual(status, 200)
                    self.assertEqual(payload["method"], method)
                    self.assertEqual(payload["path"], path.removeprefix("/api/catalog"))

            self.assertEqual(
                calls,
                [(method, path.removeprefix("/api/catalog"), b"") for method, path in allowed],
            )

    def test_sensitive_generic_and_unneeded_mutation_routes_fail_closed(self) -> None:
        denied = [
            ("GET", "/api/catalog/recommendations/state"),
            ("POST", "/api/catalog/recommendations/refresh"),
            ("GET", "/api/catalog/personalization/state"),
            ("POST", "/api/catalog/personalization/activate"),
            ("GET", "/api/catalog/library/history"),
            ("GET", "/api/catalog/voice/companion/profile"),
            ("GET", "/api/catalog/voice/companion/journal?limit=500"),
            ("POST", "/api/catalog/voice/companion/reflect"),
            ("GET", "/api/catalog/reliability/state"),
            ("POST", "/api/catalog/play"),
            ("GET", "/api/catalog/youtube/state"),
            ("POST", "/api/catalog/youtube/auth/start"),
            ("GET", "/api/catalog/youtube/auth/poll?session_id=session%2D123"),
            ("POST", "/api/catalog/youtube/auth/disconnect"),
            ("DELETE", "/api/catalog/youtube/auth/disconnect"),
        ]
        with running_proxy() as (port, calls):
            for method, path in denied:
                with self.subTest(method=method, path=path):
                    status, payload = request_proxy(port, method, path)
                    self.assertEqual(status, 403)
                    self.assertEqual(payload, {
                        "error": "catalog route unavailable from companion",
                    })

            self.assertEqual(calls, [])

    def test_path_matching_is_exact_and_prefix_confusion_cannot_reach_upstream(self) -> None:
        denied = [
            "/api/catalog/youtube/companion/status/",
            "/api/catalog/youtube/companion/status/extra",
            "/api/catalog/youtube/companion/%73tatus",
            "/api/catalog//youtube/companion/status",
            "/api/catalog/youtube/companion/status/../auth/start",
        ]
        with running_proxy() as (port, calls):
            for path in denied:
                with self.subTest(path=path):
                    status, _payload = request_proxy(port, "GET", path)
                    self.assertEqual(status, 403)

            self.assertEqual(calls, [])

    def test_upstream_failure_does_not_disclose_internal_detail(self) -> None:
        with running_proxy() as (port, calls):
            with mock.patch.object(
                SERVE_HTTPS.request,
                "urlopen",
                side_effect=SERVE_HTTPS.error.URLError("secret upstream detail"),
            ):
                status, payload = request_proxy(
                    port,
                    "GET",
                    "/api/catalog/youtube/companion/status",
                )

            self.assertEqual(status, 502)
            self.assertEqual(payload, {"error": "catalog proxy unavailable"})
            self.assertNotIn("secret", repr(payload))
            self.assertEqual(calls, [])

    def test_companion_client_uses_only_sanitized_youtube_capabilities(self) -> None:
        source = COMPANION_MAIN.read_text(encoding="utf-8")
        for path in [
            "/youtube/companion/status",
            "/youtube/companion/auth/start",
            "/youtube/companion/auth/poll",
            "/youtube/companion/auth/disconnect",
        ]:
            self.assertIn(path, source)
        for old_path in [
            '"/youtube/state"',
            '"/youtube/auth/start"',
            "`/youtube/auth/poll",
            '"/youtube/auth/disconnect"',
        ]:
            self.assertNotIn(old_path, source)
        for forbidden_field in [
            "token_file",
            "scopes",
            "yt_dlp_command",
            "quota_used_today",
            "search_calls_today",
            "api_calls_today",
            "phase_results",
            "last_error",
        ]:
            self.assertNotIn(forbidden_field, source)

    def test_every_proxy_upstream_capability_is_independently_loopback_guarded(self) -> None:
        source = CATALOG_INDEX.read_text(encoding="utf-8")
        route_markers = [
            "parts[1] === 'companion' && parts[2] === 'status'",
            "parts[1] === 'companion' && parts[2] === 'auth' && parts[3] === 'start'",
            "parts[1] === 'companion' && parts[2] === 'auth' && parts[3] === 'poll'",
            "parts[1] === 'companion' && parts[2] === 'auth' && parts[3] === 'disconnect'",
            "parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'summary'",
            "parts[0] === 'ai' && parts[1] === 'context'",
        ]
        for marker in route_markers:
            with self.subTest(marker=marker):
                route_start = source.index(marker)
                route_window = source[route_start:route_start + 500]
                self.assertIn("if (!isLocalRequest(req))", route_window)

        operator_marker = "throw new CatalogError(403, 'YouTube operator state is localhost-only')"
        self.assertIn(operator_marker, source)


if __name__ == "__main__":
    unittest.main()
