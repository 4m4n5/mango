from __future__ import annotations

import os
from pathlib import Path

import httpx
import numpy as np

from orchestrator.config import OrchestratorSettings

DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"
SAMPLE_RATE = 16_000


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    api_key = _read_api_key(settings)
    pcm = _samples_to_pcm16le(samples)
    params = {
        "model": settings.stt_model,
        "language": settings.stt_language,
        "smart_format": "true",
        "punctuate": "true",
        "encoding": "linear16",
        "sample_rate": str(SAMPLE_RATE),
        "channels": "1",
    }
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "audio/raw",
    }
    timeout = httpx.Timeout(settings.stt_timeout_seconds, connect=10.0)
    with httpx.Client(timeout=timeout) as client:
        response = client.post(DEEPGRAM_LISTEN_URL, params=params, content=pcm, headers=headers)
    if response.status_code >= 400:
        detail = response.text.strip()[:240]
        raise RuntimeError(f"deepgram STT failed ({response.status_code}): {detail}")
    payload = response.json()
    transcript = (
        payload.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("transcript", "")
    )
    text = str(transcript).strip()
    if not text:
        raise RuntimeError("no speech detected")
    return text


def _read_api_key(settings: OrchestratorSettings) -> str:
    env_value = os.environ.get("DEEPGRAM_API_KEY")
    if env_value:
        return env_value.strip()
    if settings.stt_api_key_file:
        key_path = Path(settings.stt_api_key_file).expanduser()
        if key_path.is_file():
            return key_path.read_text(encoding="utf-8").strip()
    raise RuntimeError("missing Deepgram API key — set /etc/mango/stt.key")


def _samples_to_pcm16le(samples: np.ndarray) -> bytes:
    clipped = np.clip(samples, -1.0, 1.0)
    int16 = (clipped * 32767.0).astype(np.int16)
    return int16.tobytes()
