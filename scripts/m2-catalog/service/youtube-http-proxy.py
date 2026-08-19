#!/usr/bin/env python3
"""Loopback HTTP proxy that makes googlevideo streams readable by mpv/ffmpeg.

YouTube's CDN 403s unscoped GET, open-ended Range (`bytes=0-`), and ranges that
end far past Content-Length. ffmpeg/mpv send those. This process binds
127.0.0.1, discovers size with a 1-byte range, and translates client requests
into closed in-bounds ranges. If a single large upstream GET still 403s, it
stitches 1 MiB chunks. Upstream URLs are never logged.
"""

from __future__ import annotations

import argparse
import re
import sys
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Optional

CHUNK_BYTES = 1024 * 1024
UPSTREAM_TIMEOUT_SEC = 15
SIZE_PROBE_RANGE = "bytes=0-0"
RANGE_RE = re.compile(r"bytes=(\d+)-(\d+)?$")

VIDEO_URL = ""
AUDIO_URL = ""
CHUNK = CHUNK_BYTES
SIZE_CACHE: dict[str, int] = {}
SIZE_LOCK = threading.Lock()


def parse_range_header(header: Optional[str]) -> tuple[Optional[int], Optional[int], bool]:
    """Return (start, end, open_ended). Missing header → (None, None, True)."""
    if not header:
        return None, None, True
    match = RANGE_RE.match(header.strip())
    if not match:
        return None, None, True
    start = int(match.group(1))
    if match.group(2) in (None, ""):
        return start, None, True
    return start, int(match.group(2)), False


def clamp_range(start: Optional[int], end: Optional[int], size: int) -> tuple[int, int]:
    begin = 0 if start is None else start
    if begin < 0:
        begin = 0
    if begin >= size:
        begin = max(0, size - 1)
    finish = size - 1 if end is None else min(end, size - 1)
    if finish < begin:
        finish = begin
    return begin, finish


def upstream_for(path: str) -> str:
    if path.startswith("/a"):
        return AUDIO_URL
    return VIDEO_URL


def fetch_size(url: str) -> int:
    with SIZE_LOCK:
        cached = SIZE_CACHE.get(url)
        if cached:
            return cached
    request = urllib.request.Request(url, method="GET", headers={"Range": SIZE_PROBE_RANGE})
    try:
        with urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SEC) as response:
            content_range = response.headers.get("Content-Range") or ""
            match = re.search(r"/(\d+)\s*$", content_range)
            if match:
                size = int(match.group(1))
            else:
                length = response.headers.get("Content-Length")
                size = int(length) if length else 0
            response.read(1)
    except urllib.error.HTTPError as error:
        content_range = error.headers.get("Content-Range") if error.headers else ""
        match = re.search(r"/(\d+)\s*$", content_range or "")
        if not match:
            raise
        size = int(match.group(1))
    if size <= 0:
        raise RuntimeError("upstream size unavailable")
    with SIZE_LOCK:
        SIZE_CACHE[url] = size
    return size


def open_upstream(url: str, start: int, end: int):
    request = urllib.request.Request(
        url,
        method="GET",
        headers={"Range": f"bytes={start}-{end}"},
    )
    return urllib.request.urlopen(request, timeout=UPSTREAM_TIMEOUT_SEC)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return

    def _send_failure(self, code: int) -> None:
        try:
            self.send_error(code, "")
        except BrokenPipeError:
            return

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle(body=False)

    def do_GET(self) -> None:  # noqa: N802
        self._handle(body=True)

    def _handle(self, body: bool) -> None:
        url = upstream_for(self.path)
        if not url:
            self._send_failure(404)
            return
        try:
            size = fetch_size(url)
        except Exception:
            self._send_failure(502)
            return
        start, end, _open = parse_range_header(self.headers.get("Range"))
        begin, finish = clamp_range(start, end, size)
        length = finish - begin + 1
        client_ranged = self.headers.get("Range") is not None
        try:
            self.send_response(206 if client_ranged else 200)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(length))
            if client_ranged:
                self.send_header("Content-Range", f"bytes {begin}-{finish}/{size}")
            self.send_header("Connection", "close")
            self.end_headers()
            if not body:
                return
            self._copy_span(url, begin, finish)
        except BrokenPipeError:
            return
        except Exception:
            return

    def _copy_span(self, url: str, begin: int, finish: int) -> None:
        try:
            self._copy_single(url, begin, finish)
            return
        except urllib.error.HTTPError as error:
            if error.code != 403:
                raise
        cursor = begin
        while cursor <= finish:
            chunk_end = min(cursor + CHUNK - 1, finish)
            self._copy_single(url, cursor, chunk_end)
            cursor = chunk_end + 1

    def _copy_single(self, url: str, begin: int, finish: int) -> None:
        remaining = finish - begin + 1
        with open_upstream(url, begin, finish) as response:
            while remaining > 0:
                buf = response.read(min(256 * 1024, remaining))
                if not buf:
                    break
                self.wfile.write(buf)
                remaining -= len(buf)
        if remaining > 0:
            raise RuntimeError("short upstream body")


def serve(video: str, audio: str, chunk_bytes: int) -> None:
    global VIDEO_URL, AUDIO_URL, CHUNK
    VIDEO_URL = video
    AUDIO_URL = audio
    CHUNK = chunk_bytes
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    host, port = httpd.server_address[:2]
    sys.stdout.write(f"READY {host} {port}\n")
    sys.stdout.flush()
    httpd.serve_forever()


def _self_test() -> int:
    import http.client
    from http.server import HTTPServer

    body = bytes(i % 256 for i in range(256 * 1024))
    size = len(body)

    class Mock(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args) -> None:  # noqa: A003
            return

        def do_GET(self) -> None:  # noqa: N802
            header = self.headers.get("Range")
            start, end, open_ended = parse_range_header(header)
            if open_ended or start is None or end is None:
                self.send_error(403)
                return
            if end >= size + 50_000_000:
                self.send_error(403)
                return
            begin, finish = clamp_range(start, end, size)
            data = body[begin : finish + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {begin}-{finish}/{size}")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    mock = HTTPServer(("127.0.0.1", 0), Mock)
    mock_thread = threading.Thread(target=mock.serve_forever, daemon=True)
    mock_thread.start()
    mock_host, mock_port = mock.server_address[:2]
    mock_url = f"http://{mock_host}:{mock_port}/source"

    def mock_status(range_header: Optional[str]) -> int:
        conn = http.client.HTTPConnection(mock_host, mock_port, timeout=3)
        headers = {"Range": range_header} if range_header else {}
        conn.request("GET", "/source", headers=headers)
        response = conn.getresponse()
        response.read()
        conn.close()
        return int(response.status)

    if mock_status(None) != 403 or mock_status("bytes=0-") != 403:
        print("self-test: mock did not 403 open/missing ranges", file=sys.stderr)
        return 1

    global VIDEO_URL, AUDIO_URL, CHUNK
    VIDEO_URL = mock_url
    AUDIO_URL = ""
    CHUNK = CHUNK_BYTES
    proxy = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=proxy.serve_forever, daemon=True).start()
    proxy_host, proxy_port = proxy.server_address[:2]

    def proxy_get(range_header: Optional[str]) -> tuple[int, bytes]:
        conn = http.client.HTTPConnection(proxy_host, proxy_port, timeout=5)
        headers = {"Range": range_header} if range_header else {}
        conn.request("GET", "/v", headers=headers)
        response = conn.getresponse()
        data = response.read()
        conn.close()
        return int(response.status), data

    status, data = proxy_get("bytes=0-")
    if status != 206 or data != body:
        print(f"self-test: open range via proxy status={status} len={len(data)}", file=sys.stderr)
        return 1
    status, data = proxy_get(None)
    if status != 200 or data != body:
        print(f"self-test: missing range via proxy status={status} len={len(data)}", file=sys.stderr)
        return 1
    status, data = proxy_get("bytes=10-19")
    if status != 206 or data != body[10:20]:
        print("self-test: closed subrange mismatch", file=sys.stderr)
        return 1
    mock.shutdown()
    proxy.shutdown()
    print("self-test ok")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Loopback googlevideo Range proxy for mpv")
    parser.add_argument("--video", default="")
    parser.add_argument("--audio", default="")
    parser.add_argument("--chunk-bytes", type=int, default=CHUNK_BYTES)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return _self_test()
    if not args.video:
        print("youtube-http-proxy: --video is required", file=sys.stderr)
        return 2
    if args.chunk_bytes < 64 * 1024:
        print("youtube-http-proxy: --chunk-bytes too small", file=sys.stderr)
        return 2
    serve(args.video, args.audio, args.chunk_bytes)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(0)
