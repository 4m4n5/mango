#!/usr/bin/env python3
from __future__ import annotations

import argparse
import functools
import json
import ssl
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error, request
from urllib.parse import urlsplit


class CompanionRequestHandler(SimpleHTTPRequestHandler):
    catalog_upstream: str

    def __init__(self, *args, catalog_upstream: str, **kwargs):
        self.catalog_upstream = catalog_upstream.rstrip("/")
        super().__init__(*args, **kwargs)

    def do_GET(self) -> None:
        if self.path.startswith("/api/catalog/"):
            self._proxy_catalog("GET")
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path.startswith("/api/catalog/"):
            self._proxy_catalog("POST")
            return
        self.send_error(404)

    def do_DELETE(self) -> None:
        if self.path.startswith("/api/catalog/"):
            self._proxy_catalog("DELETE")
            return
        self.send_error(404)

    def _proxy_catalog(self, method: str) -> None:
        parsed = urlsplit(self.path)
        upstream_path = parsed.path.removeprefix("/api/catalog") or "/"
        upstream_url = f"{self.catalog_upstream}{upstream_path}"
        if parsed.query:
            upstream_url = f"{upstream_url}?{parsed.query}"
        length = int(self.headers.get("content-length") or "0")
        body = self.rfile.read(length) if length > 0 else None
        headers = {"accept": self.headers.get("accept", "application/json")}
        if self.headers.get("content-type"):
            headers["content-type"] = self.headers["content-type"]
        req = request.Request(
            upstream_url,
            data=body if method in {"POST", "DELETE"} else None,
            headers=headers,
            method=method,
        )
        try:
            with request.urlopen(req, timeout=60) as response:
                response_body = response.read()
                self._send_proxy_response(response.status, response.headers, response_body)
        except error.HTTPError as exc:
            self._send_proxy_response(exc.code, exc.headers, exc.read())
        except error.URLError as exc:
            payload = json.dumps({
                "error": "catalog proxy unavailable",
                "detail": str(exc.reason),
            }).encode() + b"\n"
            self.send_response(502)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def _send_proxy_response(self, status: int, headers, body: bytes) -> None:
        self.send_response(status)
        content_type = headers.get("content-type") or "application/json"
        self.send_header("content-type", content_type)
        cache_control = headers.get("cache-control")
        if cache_control:
            self.send_header("cache-control", cache_control)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve static files over HTTPS")
    parser.add_argument("--directory", required=True)
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=3001)
    parser.add_argument("--certfile", required=True)
    parser.add_argument("--keyfile", required=True)
    parser.add_argument("--catalog-upstream", default="http://127.0.0.1:3020")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    directory = Path(args.directory).resolve()
    handler = functools.partial(
        CompanionRequestHandler,
        directory=str(directory),
        catalog_upstream=args.catalog_upstream,
    )
    server = ThreadingHTTPServer((args.host, args.port), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.certfile, args.keyfile)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"serving {directory} at https://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
