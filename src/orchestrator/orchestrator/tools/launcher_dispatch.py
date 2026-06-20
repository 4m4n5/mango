"""Deliver launcher_command to the TV Chromium via mango-ui-server HTTP queue."""

from __future__ import annotations

import logging
import time

import httpx

from orchestrator.config import OrchestratorSettings

logger = logging.getLogger(__name__)

DEFAULT_ACK_WAIT_SEC = 4.0
DEFAULT_ACK_POLL_SEC = 0.2


class LauncherDispatchError(RuntimeError):
    pass


def _launcher_base(settings: OrchestratorSettings) -> str:
    return settings.launcher_ui_upstream.rstrip("/")


def wait_for_launcher_ack(
    settings: OrchestratorSettings,
    seq: int,
    *,
    action: str = "",
    timeout_sec: float = DEFAULT_ACK_WAIT_SEC,
) -> bool:
    """Poll until Chromium applies the command or timeout."""
    deadline = time.monotonic() + max(0.5, timeout_sec)
    url = f"{_launcher_base(settings)}/api/voice/ack"
    with httpx.Client(timeout=3.0) as client:
        while time.monotonic() < deadline:
            try:
                response = client.get(url)
                response.raise_for_status()
                payload = response.json()
            except httpx.HTTPError:
                time.sleep(DEFAULT_ACK_POLL_SEC)
                continue
            if not isinstance(payload, dict):
                time.sleep(DEFAULT_ACK_POLL_SEC)
                continue
            if payload.get("seq") != seq:
                time.sleep(DEFAULT_ACK_POLL_SEC)
                continue
            if payload.get("ok") is True:
                if action and payload.get("action") not in {action, ""}:
                    time.sleep(DEFAULT_ACK_POLL_SEC)
                    continue
                return True
            reason = payload.get("reason", "")
            raise LauncherDispatchError(
                f"launcher rejected voice command seq={seq}: {reason or 'unknown'}"
            )
    return False


def _enqueue_and_wait(
    settings: OrchestratorSettings,
    command: dict[str, object],
    *,
    wait_for_ack: bool,
) -> int:
    url = f"{_launcher_base(settings)}/api/voice/command"
    with httpx.Client(timeout=5.0) as client:
        response = client.post(url, json=command)
        response.raise_for_status()
        payload = response.json()
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        raise LauncherDispatchError("launcher UI rejected voice command")
    seq = payload.get("seq")
    if not isinstance(seq, int) or seq <= 0:
        raise LauncherDispatchError("launcher UI did not return command seq")
    action = str(command.get("action", ""))
    logger.info("voice command enqueued seq=%s action=%s", seq, action)
    if wait_for_ack:
        if not wait_for_launcher_ack(settings, seq, action=action):
            raise LauncherDispatchError(
                f"launcher did not apply voice command seq={seq} within {DEFAULT_ACK_WAIT_SEC}s"
            )
        logger.info("voice command ack seq=%s action=%s", seq, action)
    return seq


def _recover_open_detail(settings: OrchestratorSettings, command: dict[str, object]) -> int:
    for prep_action in ("back", "home"):
        prep = {"type": "launcher_command", "action": prep_action}
        try:
            _enqueue_and_wait(settings, prep, wait_for_ack=True)
        except LauncherDispatchError:
            logger.info("voice open recovery prep=%s failed", prep_action)
            continue
        try:
            return _enqueue_and_wait(settings, command, wait_for_ack=True)
        except LauncherDispatchError:
            logger.info("voice open recovery retry after=%s failed", prep_action)
            continue
    raise LauncherDispatchError("launcher did not apply open_detail after recovery attempts")


def post_launcher_command(
    settings: OrchestratorSettings,
    command: dict[str, object],
    *,
    wait_for_ack: bool = True,
) -> int:
    action = str(command.get("action", ""))
    try:
        return _enqueue_and_wait(settings, command, wait_for_ack=wait_for_ack)
    except LauncherDispatchError as exc:
        if wait_for_ack and action == "open_detail":
            logger.warning("open_detail failed (%s) — trying recovery", exc)
            return _recover_open_detail(settings, command)
        raise
