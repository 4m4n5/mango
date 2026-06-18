"""Optional on-device STT fallback — requires: pip install faster-whisper"""

from __future__ import annotations

import os
from threading import Lock

import numpy as np

from orchestrator.config import OrchestratorSettings

_model_lock = Lock()
_model: object | None = None
_model_key: tuple[str, str, str] | None = None


def _whisper_language(settings: OrchestratorSettings) -> str | None:
    lang = settings.stt_language.strip().lower()
    if lang in ("", "auto", "null", "none", "multi"):
        return None
    return lang


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    model = _load_model(settings)
    segments, _info = model.transcribe(
        samples,
        beam_size=1,
        language=_whisper_language(settings),
        vad_filter=True,
        without_timestamps=True,
        condition_on_previous_text=False,
    )
    text = " ".join(segment.text.strip() for segment in segments).strip()
    if not text:
        raise RuntimeError("no speech detected")
    return text


def warmup_whisper(settings: OrchestratorSettings) -> None:
    model = _load_model(settings)
    silence = np.zeros(int(16_000 * 0.25), dtype=np.float32)
    list(
        model.transcribe(
            silence,
            beam_size=1,
            language=_whisper_language(settings),
            vad_filter=False,
            without_timestamps=True,
            condition_on_previous_text=False,
        )[0]
    )


def _load_model(settings: OrchestratorSettings) -> object:
    global _model, _model_key
    key = (settings.stt_local_model, settings.stt_device, settings.stt_compute_type)
    with _model_lock:
        if _model is not None and _model_key == key:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "local STT requires faster-whisper — pip install faster-whisper"
            ) from exc

        _model = WhisperModel(
            settings.stt_local_model,
            device=settings.stt_device,
            compute_type=settings.stt_compute_type,
        )
        _model_key = key
        return _model
