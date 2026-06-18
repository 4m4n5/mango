from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_CONFIG = REPO_ROOT / "config" / "config.example.yaml"
SYSTEM_CONFIG = Path("/etc/mango/config.yaml")


@dataclass(frozen=True)
class OrchestratorSettings:
    host: str
    port: int
    ssl_certfile: str | None
    ssl_keyfile: str | None
    max_utterance_seconds: int
    whisper_model: str
    whisper_language: str
    whisper_device: str
    whisper_compute_type: str
    piper_voice: str
    piper_data_dir: str | None
    tts_player: str
    duck_volume_while_listening: bool
    duck_volume_percent: int
    llm_provider: str
    llm_model: str
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
        whisper_model=str(audio.get("whisper_model", "small")),
        whisper_language=str(audio.get("whisper_language", "auto")),
        whisper_device=str(audio.get("whisper_device", "cpu")),
        whisper_compute_type=str(audio.get("whisper_compute_type", "int8")),
        piper_voice=str(audio.get("piper_voice", "en_US-lessac-medium")),
        piper_data_dir=_optional_str(audio.get("piper_data_dir")),
        tts_player=str(audio.get("tts_player", "auto")),
        duck_volume_while_listening=bool(audio.get("duck_volume_while_listening", True)),
        duck_volume_percent=int(audio.get("duck_volume_percent", 40)),
        llm_provider=str(llm.get("provider", "anthropic")),
        llm_model=str(llm.get("model", "claude-sonnet-4-20250514")),
        llm_api_key_file=_optional_str(llm.get("api_key_file")),
    )


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
