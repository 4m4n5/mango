"""Structured voice turn logging — JSONL for couch diagnosis."""

from __future__ import annotations

import contextvars
import json
import logging
import os
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_turn_id: contextvars.ContextVar[str | None] = contextvars.ContextVar("voice_turn_id", default=None)
_active_timer: contextvars.ContextVar[TurnTimer | None] = contextvars.ContextVar(
    "voice_turn_timer", default=None
)
_turn_seq_lock = threading.Lock()
_turn_seq = 0

VOICE_TURNS_BASENAME = "voice-turns.jsonl"
ORCHESTRATOR_LOG_BASENAME = "orchestrator.log"


def cache_dir() -> Path:
    raw = os.environ.get("MANGO_CACHE_DIR", "").strip()
    if raw:
        return Path(raw).expanduser()
    return Path.home() / ".cache" / "mango"


def voice_turns_path() -> Path:
    override = os.environ.get("MANGO_VOICE_LOG", "").strip()
    if override:
        return Path(override).expanduser()
    return cache_dir() / VOICE_TURNS_BASENAME


def orchestrator_log_path() -> Path:
    return cache_dir() / ORCHESTRATOR_LOG_BASENAME


def configure_logging() -> None:
    """Route orchestrator.* INFO logs to ~/.cache/mango/orchestrator.log."""
    if os.environ.get("MANGO_ORCH_LOGGING") == "0":
        return

    log_dir = cache_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = orchestrator_log_path()

    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(fmt)
    file_handler.setLevel(logging.INFO)

    for name in ("orchestrator",):
        orch_logger = logging.getLogger(name)
        orch_logger.setLevel(logging.INFO)
        orch_logger.handlers.clear()
        orch_logger.addHandler(file_handler)
        orch_logger.propagate = False

    logger.info("orchestrator logging → %s", log_path)


def new_turn_id() -> str:
    global _turn_seq
    with _turn_seq_lock:
        _turn_seq += 1
        seq = _turn_seq
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
    return f"{stamp}-{os.getpid()}-{seq:04d}"


def set_turn_id(turn_id: str) -> contextvars.Token[str | None]:
    return _turn_id.set(turn_id)


def reset_turn_id(token: contextvars.Token[str | None]) -> None:
    _turn_id.reset(token)


def set_turn_timer(timer: TurnTimer) -> contextvars.Token[TurnTimer | None]:
    return _active_timer.set(timer)


def reset_turn_timer(token: contextvars.Token[TurnTimer | None]) -> None:
    _active_timer.reset(token)


def active_turn_timer() -> TurnTimer | None:
    return _active_timer.get()


def current_turn_id() -> str | None:
    return _turn_id.get()


def append_event(event: str, **fields: Any) -> None:
    if os.environ.get("MANGO_VOICE_LOG") == "0":
        return

    turn_id = fields.get("turn_id")
    if turn_id is None:
        active = current_turn_id()
        if active is not None:
            fields["turn_id"] = active

    record: dict[str, Any] = {
        "ts": datetime.now(UTC).isoformat(),
        "event": event,
        **fields,
    }

    path = voice_turns_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(record, ensure_ascii=False, default=str)
    with _turn_seq_lock:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")

    if event in {"stt", "agent_reply", "turn_error"}:
        logger.info("voice %s %s", event, _preview(record))


def _preview(record: dict[str, Any]) -> str:
    turn_id = record.get("turn_id", "?")
    if record.get("event") == "stt":
        return f"turn={turn_id} text={record.get('text', '')!r}"
    if record.get("event") == "agent_reply":
        return f"turn={turn_id} text={record.get('text', '')!r}"
    if record.get("event") == "turn_error":
        return f"turn={turn_id} error={record.get('error', '')!r}"
    return f"turn={turn_id}"


def log_tool(
    *,
    phase: str,
    name: str,
    summary: str = "",
    ok: bool | None = None,
) -> None:
    payload: dict[str, Any] = {"phase": phase, "name": name}
    if summary:
        payload["summary"] = summary
    if ok is not None:
        payload["ok"] = ok
    append_event("tool", **payload)


class TurnTimer:
    """Collect per-stage timings for a voice turn."""

    def __init__(self) -> None:
        self._started = time.perf_counter()
        self._stages: dict[str, int] = {}

    def mark(self, stage: str, elapsed_ms: float) -> None:
        self._stages[stage] = int(elapsed_ms)

    @property
    def total_ms(self) -> int:
        return int((time.perf_counter() - self._started) * 1000)

    def as_dict(self) -> dict[str, int]:
        stages = dict(self._stages)
        stages["total"] = self.total_ms
        return stages
