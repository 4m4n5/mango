from __future__ import annotations

import os
from threading import Lock

import numpy as np

from orchestrator.config import OrchestratorSettings

_model_lock = Lock()
_model: object | None = None
_model_key: tuple[str, str, str] | None = None


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    if os.environ.get("MANGO_STT_MOCK") == "1":
        return "mock transcript for dev"
    model = _load_model(settings)
    segments, _info = model.transcribe(
        samples,
        beam_size=1,
        language="en",
        vad_filter=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise RuntimeError("no speech detected")
    return text


def _load_model(settings: OrchestratorSettings) -> object:
    global _model, _model_key
    key = (settings.whisper_model, settings.whisper_device, settings.whisper_compute_type)
    with _model_lock:
        if _model is not None and _model_key == key:
            return _model
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
        )
        _model_key = key
        return _model
