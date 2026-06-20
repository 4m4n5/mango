"""Deliver launcher_command to the TV Chromium via mango-ui-server HTTP queue."""

from __future__ import annotations

import httpx

from orchestrator.config import OrchestratorSettings


class LauncherDispatchError(RuntimeError):
    pass


def post_launcher_command(settings: OrchestratorSettings, command: dict[str, object]) -> int:
    url = f"{settings.launcher_ui_upstream.rstrip('/')}/api/voice/command"
    with httpx.Client(timeout=5.0) as client:
        response = client.post(url, json=command)
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise LauncherDispatchError("launcher UI rejected voice command")
    seq = payload.get("seq")
    if not isinstance(seq, int) or seq <= 0:
        raise LauncherDispatchError("launcher UI did not return command seq")
    return seq
