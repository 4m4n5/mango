from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = REPO_ROOT / "config/config.example.yaml"
SYSTEM_CONFIG = Path("/etc/mango/config.yaml")


@dataclass(frozen=True)
class OrchestratorSettings:
    host: str
    port: int
    ssl_certfile: str | None
    ssl_keyfile: str | None
    max_utterance_seconds: int
    stt_provider: str
    stt_model: str
    stt_language: str
    stt_api_key_file: str | None
    stt_timeout_seconds: float
    stt_local_model: str
    stt_device: str
    stt_compute_type: str
    piper_voice: str
    piper_data_dir: str | None
    tts_player: str
    tts_async: bool
    duck_volume_while_listening: bool
    duck_volume_percent: int
    llm_provider: str
    llm_model: str
    llm_max_tokens: int
    llm_history_turns: int
    llm_api_key_file: str | None


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open(encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    return data if isinstance(data, dict) else {}


def load_settings() -> OrchestratorSettings:
    config_path = Path(os.environ.get("MANGO_CONFIG", SYSTEM_CONFIG))
    if not config_path.is_file():
        config_path = DEFAULT_CONFIG
    raw = _load_yaml(config_path)
    orch = raw.get("orchestrator", {}) if isinstance(raw.get("orchestrator"), dict) else {}
    audio = raw.get("audio", {}) if isinstance(raw.get("audio"), dict) else {}
    stt = raw.get("stt", {}) if isinstance(raw.get("stt"), dict) else {}
    llm = raw.get("llm", {}) if isinstance(raw.get("llm"), dict) else {}
    return OrchestratorSettings(
        host=str(os.environ.get("MANGO_ORCH_HOST", orch.get("host", "127.0.0.1"))),
        port=int(os.environ.get("MANGO_ORCH_PORT", orch.get("port", 8765))),
        ssl_certfile=_optional_str(
            os.environ.get("MANGO_SSL_CERTFILE", orch.get("ssl_certfile"))
        ),
        ssl_keyfile=_optional_str(os.environ.get("MANGO_SSL_KEYFILE", orch.get("ssl_keyfile"))),
        max_utterance_seconds=max(1, int(
            os.environ.get(
                "MANGO_MAX_UTTERANCE_SECONDS", audio.get("max_utterance_seconds", 30)
            )
        )),
        stt_provider=str(stt.get("provider", "deepgram")),
        stt_model=str(stt.get("model", "nova-2")),
        stt_language=str(stt.get("language", "hi")),
        stt_api_key_file=_optional_str(stt.get("api_key_file")),
        stt_timeout_seconds=max(5.0, float(stt.get("timeout_seconds", 30))),
        stt_local_model=str(stt.get("local_model", "small")),
        stt_device=str(stt.get("device", "cpu")),
        stt_compute_type=str(stt.get("compute_type", "int8")),
        piper_voice=str(audio.get("piper_voice", "en_US-lessac-medium")),
        piper_data_dir=_optional_str(audio.get("piper_data_dir")),
        tts_player=str(audio.get("tts_player", "auto")),
        tts_async=bool(audio.get("tts_async", True)),
        duck_volume_while_listening=bool(audio.get("duck_volume_while_listening", True)),
        duck_volume_percent=int(audio.get("duck_volume_percent", 40)),
        llm_provider=str(llm.get("provider", "anthropic")),
        llm_model=str(llm.get("model", "claude-haiku-4-5-20251001")),
        llm_max_tokens=max(32, int(llm.get("max_tokens", 96))),
        llm_history_turns=max(1, int(llm.get("history_turns", 3))),
        llm_api_key_file=_optional_str(llm.get("api_key_file")),
    )


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
