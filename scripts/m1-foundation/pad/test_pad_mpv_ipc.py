#!/usr/bin/env python3

from __future__ import annotations

import json
import socket
import tempfile
import threading
import unittest
from pathlib import Path

from pad_mpv_ipc import MpvIpcError, send_mpv_command


class FakeMpv:
    def __init__(self, socket_path: Path, *, error: str = "success") -> None:
        self.socket_path = socket_path
        self.error = error
        self.requests: list[dict[str, object]] = []
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)

    def __enter__(self) -> "FakeMpv":
        self.thread.start()
        self.assert_ready()
        return self

    def __exit__(self, *_args: object) -> None:
        self.thread.join(timeout=1)

    def assert_ready(self) -> None:
        if not self.ready.wait(timeout=1):
            raise RuntimeError("fake mpv did not start")

    def _run(self) -> None:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(str(self.socket_path))
            server.listen(1)
            self.ready.set()
            connection, _ = server.accept()
            with connection:
                raw = b""
                while b"\n" not in raw:
                    raw += connection.recv(4096)
                request = json.loads(raw.split(b"\n", 1)[0])
                self.requests.append(request)
                # mpv can emit unrelated events before the command response.
                connection.sendall(b'{"event":"tick"}\n')
                connection.sendall(
                    json.dumps(
                        {
                            "request_id": request["request_id"],
                            "error": self.error,
                            "data": "ack",
                        },
                        separators=(",", ":"),
                    ).encode("utf-8")
                    + b"\n"
                )


class PadMpvIpcTest(unittest.TestCase):
    def test_waits_for_matching_ack_and_coerces_numeric_arguments(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            socket_path = Path(directory) / "mpv.sock"
            with FakeMpv(socket_path) as server:
                result = send_mpv_command(
                    socket_path,
                    "script-message",
                    "mango-streams-move",
                    "-1",
                )
            self.assertEqual(result, "ack")
            self.assertEqual(
                server.requests[0]["command"],
                ["script-message", "mango-streams-move", -1],
            )

    def test_surfaces_mpv_command_errors(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            socket_path = Path(directory) / "mpv.sock"
            with FakeMpv(socket_path, error="command error"):
                with self.assertRaisesRegex(MpvIpcError, "command error"):
                    send_mpv_command(socket_path, "keypress", "UP")


if __name__ == "__main__":
    unittest.main()
