from __future__ import annotations

import os

import numpy as np

from orchestrator.audio.stt_types import SttResult
from orchestrator.config import OrchestratorSettings


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    return transcribe_detailed(samples, settings).text


def transcribe_detailed(samples: np.ndarray, settings: OrchestratorSettings) -> SttResult:
    if os.environ.get("MANGO_STT_MOCK") == "1":
        return SttResult(
            text="mock transcript for dev",
            provider="mock",
            model="mock",
        )
    provider = settings.stt_provider.lower()
    if provider == "deepgram":
        from orchestrator.audio.deepgram_stt import transcribe_detailed as deepgram_transcribe

        return deepgram_transcribe(samples, settings)
    if provider == "local":
        from orchestrator.audio.whisper_stt import transcribe as whisper_transcribe

        text = whisper_transcribe(samples, settings)
        return SttResult(
            text=text,
            provider="local",
            model=settings.stt_local_model,
        )
    raise RuntimeError(f"unsupported STT provider: {settings.stt_provider}")
