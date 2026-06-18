from __future__ import annotations

import os
from threading import Lock

import numpy as np

from orchestrator.config import OrchestratorSettings

_model_lock = Lock()
_model: object | None = None
_model_key: tuple[str, str, str, str, str] | None = None


def _whisper_language(settings: OrchestratorSettings) -> str | None:
    lang = settings.whisper_language.strip().lower()
    if lang in ("", "auto", "null", "none"):
        return None
    return lang


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    if os.environ.get("MANGO_STT_MOCK") == "1":
        return "mock transcript for dev"
    model = _load_model(settings)
    segments, _info = model.transcribe(
        samples,
        beam_size=1,
        best_of=1,
        temperature=0.0,
        language=_whisper_language(settings),
        vad_filter=settings.whisper_vad_filter,
        without_timestamps=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise RuntimeError("no speech detected")
    return text


def warmup_whisper(settings: OrchestratorSettings) -> None:
    if os.environ.get("MANGO_STT_MOCK") == "1":
        return
    model = _load_model(settings)
    silence = np.zeros(int(16_000 * 0.25), dtype=np.float32)
    list(model.transcribe(
        silence,
        beam_size=1,
        language=_whisper_language(settings),
        vad_filter=False,
        without_timestamps=True,
        condition_on_previous_text=False,
    )[0])


def _load_model(settings: OrchestratorSettings) -> object:
    global _model, _model_key
    key = (
        settings.whisper_model,
        settings.whisper_language,
        settings.whisper_device,
        settings.whisper_compute_type,
        str(settings.whisper_num_workers),
    )
    with _model_lock:
        if _model is not None and _model_key == key:
            return _model
        from faster_whisper import WhisperModel

        _model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute_type,
            num_workers=settings.whisper_num_workers,
        )
        _model_key = key
        return _model
