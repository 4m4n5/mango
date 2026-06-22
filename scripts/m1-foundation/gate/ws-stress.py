#!/usr/bin/env python3
"""Minimal stdlib WebSocket connect/disconnect stress test."""

from __future__ import annotations

import argparse
import base64
import hashlib
import os
import socket
import ssl
import sys
from urllib.parse import urlparse


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="stress a WebSocket endpoint")
    parser.add_argument("--url", default="wss://127.0.0.1:8765/ws")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=3.0)
    parser.add_argument("--insecure", action="store_true", help="skip TLS verification")
    return parser.parse_args()


def connect_once(url: str, timeout: float, insecure: bool) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("ws", "wss"):
        raise ValueError(f"unsupported scheme: {parsed.scheme}")
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "wss" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"

    raw = socket.create_connection((host, port), timeout=timeout)
    try:
        raw.settimeout(timeout)
        sock: socket.socket | ssl.SSLSocket = raw
        if parsed.scheme == "wss":
            context = ssl._create_unverified_context() if insecure else ssl.create_default_context()
            sock = context.wrap_socket(raw, server_hostname=host)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        sock.sendall(request.encode("ascii"))
        response = sock.recv(4096).decode("latin1", errors="replace")
        if " 101 " not in response.split("\r\n", 1)[0]:
            raise RuntimeError(f"websocket upgrade failed: {response.splitlines()[:1]}")
        accept = None
        for line in response.split("\r\n"):
            if line.lower().startswith("sec-websocket-accept:"):
                accept = line.split(":", 1)[1].strip()
                break
        expected = base64.b64encode(
            hashlib.sha1(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
            ).digest()
        ).decode("ascii")
        if accept != expected:
            raise RuntimeError("websocket accept header mismatch")
        sock.sendall(b"\x88\x80\x00\x00\x00\x00")
    finally:
        raw.close()


def main() -> int:
    args = parse_args()
    for index in range(args.count):
        try:
            connect_once(args.url, args.timeout, args.insecure)
        except Exception as exc:
            print(f"FAIL {index + 1}/{args.count}: {exc}", file=sys.stderr)
            return 1
    print(f"ws-stress ok: {args.count} connects to {args.url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
