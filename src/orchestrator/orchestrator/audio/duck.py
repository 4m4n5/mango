from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass

from orchestrator.config import OrchestratorSettings

_PERCENT_RE = re.compile(r"/\s*(\d+)%")
_restore_points: dict[str, int] = {}


@dataclass(frozen=True)
class SinkInput:
    id: str
    volume_percent: int | None


def duck_audio(settings: OrchestratorSettings) -> None:
    if not settings.duck_volume_while_listening or shutil.which("pactl") is None:
        return
    for sink in _list_sink_inputs():
        if sink.volume_percent is not None:
            _restore_points.setdefault(sink.id, sink.volume_percent)
        _run_pactl(["set-sink-input-volume", sink.id, f"{settings.duck_volume_percent}%"])


def restore_audio() -> None:
    if shutil.which("pactl") is None:
        _restore_points.clear()
        return
    for sink_id, percent in list(_restore_points.items()):
        _run_pactl(["set-sink-input-volume", sink_id, f"{percent}%"])
        _restore_points.pop(sink_id, None)


def _list_sink_inputs() -> list[SinkInput]:
    short = _run_pactl(["list", "sink-inputs", "short"])
    sinks: list[SinkInput] = []
    for line in short.splitlines():
        parts = line.split()
        if not parts:
            continue
        sink_id = parts[0]
        volume = _read_sink_volume(sink_id)
        sinks.append(SinkInput(id=sink_id, volume_percent=volume))
    return sinks


def _read_sink_volume(sink_id: str) -> int | None:
    output = _run_pactl(["get-sink-input-volume", sink_id])
    match = _PERCENT_RE.search(output)
    return int(match.group(1)) if match is not None else None


def _run_pactl(args: list[str]) -> str:
    try:
        result = subprocess.run(
            ["pactl", *args],
            capture_output=True,
            check=False,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout if result.returncode == 0 else ""
