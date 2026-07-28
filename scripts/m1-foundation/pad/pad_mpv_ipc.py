#!/usr/bin/env python3
"""Small ordered mpv JSON IPC client for latency-sensitive pad actions."""

from __future__ import annotations

import itertools
import json
import math
import socket
import time
from pathlib import Path
from typing import Any


class MpvIpcError(RuntimeError):
    """The mpv socket did not accept or complete a command."""


_request_ids = itertools.count(1)


def _coerce_arg(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        return value
    try:
        integer = int(stripped)
        if stripped == str(integer):
            return integer
    except ValueError:
        pass
    try:
        number = float(stripped)
        if math.isfinite(number):
            return number
    except ValueError:
        pass
    return value


def send_mpv_command(
    socket_path: str | Path,
    command: str,
    *args: Any,
    timeout_sec: float = 0.2,
) -> Any:
    """Send one command and wait for its acknowledgement before returning."""

    request_id = next(_request_ids)
    payload = json.dumps(
        {
            "command": [command, *[_coerce_arg(arg) for arg in args]],
            "request_id": request_id,
        },
        separators=(",", ":"),
    ).encode("utf-8") + b"\n"
    deadline = time.monotonic() + timeout_sec
    buffered = b""

    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(timeout_sec)
            client.connect(str(socket_path))
            client.sendall(payload)
            while time.monotonic() < deadline:
                client.settimeout(max(0.01, deadline - time.monotonic()))
                chunk = client.recv(65536)
                if not chunk:
                    break
                buffered += chunk
                while b"\n" in buffered:
                    raw, buffered = buffered.split(b"\n", 1)
                    if not raw:
                        continue
                    response = json.loads(raw)
                    if response.get("request_id") != request_id:
                        continue
                    error = response.get("error")
                    if error != "success":
                        raise MpvIpcError(f"mpv command failed: {error or 'unknown error'}")
                    return response.get("data")
    except (OSError, TimeoutError, json.JSONDecodeError) as exc:
        raise MpvIpcError(str(exc)) from exc

    raise MpvIpcError("mpv command acknowledgement timed out")
