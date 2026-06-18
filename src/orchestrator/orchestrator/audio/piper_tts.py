from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from orchestrator.config import OrchestratorSettings

_FIRST_SENTENCE_RE = re.compile(r"^(.+?[.!?])(?:\s|$)", re.DOTALL)


def speak_reply(text: str, settings: OrchestratorSettings) -> None:
    if os.environ.get("MANGO_TTS_DISABLED") == "1" or not settings.tts_enabled:
        return
    spoken = first_sentence(text)
    if not spoken:
        return

    with tempfile.TemporaryDirectory(prefix="mango-tts-") as tmp:
        wav_path = Path(tmp) / "reply.wav"
        subprocess.run(_piper_command(spoken, wav_path, settings), check=True, timeout=60)
        subprocess.run(_player_command(wav_path, settings), check=True, timeout=60)


def warmup_piper(settings: OrchestratorSettings) -> None:
    if os.environ.get("MANGO_TTS_DISABLED") == "1" or not settings.tts_enabled:
        return
    with tempfile.TemporaryDirectory(prefix="mango-tts-warm-") as tmp:
        wav_path = Path(tmp) / "warm.wav"
        subprocess.run(
            _piper_command("ready", wav_path, settings),
            check=True,
            timeout=30,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def first_sentence(text: str) -> str:
    cleaned = " ".join(text.split())
    match = _FIRST_SENTENCE_RE.search(cleaned)
    if match is not None:
        return match.group(1).strip()
    if len(cleaned) <= 260:
        return cleaned
    return f"{cleaned[:240].rstrip()}..."


def _resolve_voice_model(settings: OrchestratorSettings) -> str:
    voice = settings.piper_voice
    if voice.endswith(".onnx"):
        return voice
    if settings.piper_data_dir:
        candidate = Path(settings.piper_data_dir).expanduser() / f"{voice}.onnx"
        if candidate.is_file():
            return str(candidate)
    return voice


def _piper_command(text: str, wav_path: Path, settings: OrchestratorSettings) -> list[str]:
    command = [sys.executable, "-m", "piper", "-m", _resolve_voice_model(settings)]
    if settings.piper_data_dir:
        command.extend(["--data-dir", settings.piper_data_dir])
    command.extend(["-f", str(wav_path), "--", text])
    return command


def _player_command(wav_path: Path, settings: OrchestratorSettings) -> list[str]:
    if settings.tts_player != "auto":
        return [settings.tts_player, str(wav_path)]
    for player in ("paplay", "aplay"):
        path = shutil.which(player)
        if path is not None:
            return [path, str(wav_path)]
    raise RuntimeError("no audio player found; install pulseaudio-utils or alsa-utils")
