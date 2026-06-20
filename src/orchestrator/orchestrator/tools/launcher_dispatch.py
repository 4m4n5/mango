"""Deliver launcher_command to the TV Chromium via mango-ui-server HTTP queue."""

from __future__ import annotations

import httpx

from orchestrator.config import OrchestratorSettings


def post_launcher_command(settings: OrchestratorSettings, command: dict[str, object]) -> None:
    url = f"{settings.launcher_ui_upstream.rstrip('/')}/api/voice/command"
    with httpx.Client(timeout=5.0) as client:
        response = client.post(url, json=command)
        response.raise_for_status()
