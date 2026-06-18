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
    whisper_model: str
    piper_voice: str
    llm_provider: str
    llm_model: str


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
        whisper_model=str(audio.get("whisper_model", "base.en")),
        piper_voice=str(audio.get("piper_voice", "en_US-lessac-medium")),
        llm_provider=str(llm.get("provider", "anthropic")),
        llm_model=str(llm.get("model", "claude-sonnet-4-20250514")),
    )
