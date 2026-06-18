from __future__ import annotations

import os

import numpy as np

from orchestrator.config import OrchestratorSettings


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    if os.environ.get("MANGO_STT_MOCK") == "1":
        return "mock transcript for dev"
    provider = settings.stt_provider.lower()
    if provider == "deepgram":
        from orchestrator.audio.deepgram_stt import transcribe as deepgram_transcribe

        return deepgram_transcribe(samples, settings)
    if provider == "local":
        from orchestrator.audio.whisper_stt import transcribe as whisper_transcribe

        return whisper_transcribe(samples, settings)
    raise RuntimeError(f"unsupported STT provider: {settings.stt_provider}")
