from __future__ import annotations

import os
from pathlib import Path

import httpx
import numpy as np

from orchestrator.audio.pcm_prep import prepare_for_stt
from orchestrator.config import OrchestratorSettings

DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"
SAMPLE_RATE = 16_000

# Boost terms mango users say often; overridden by stt.keyterms in config.
DEFAULT_KEYTERMS = (
    "Stremio",
    "Kodi",
    "YouTube",
    "mango",
    "movie",
    "series",
    "episode",
    "season",
    "kholo",
    "khol",
    "dikhao",
    "chalao",
    "lagao",
    "Toy Story",
    "Shawshank",
    "Godfather",
    "Panchayat",
    "Breaking Bad",
    "aaj kya",
    "dekhein",
    "dekhte hain",
    "kya chal raha hai",
    "kya dekhu",
    "lagao",
    "band karo",
    "volume",
    "play",
    "pause",
    "recommend",
    "suggest",
)


def transcribe(samples: np.ndarray, settings: OrchestratorSettings) -> str:
    api_key = _read_api_key(settings)
    prepared = prepare_for_stt(samples, SAMPLE_RATE) if settings.stt_prepare_audio else samples
    pcm = _samples_to_pcm16le(prepared)
    params = _listen_params(settings)
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


def _listen_params(settings: OrchestratorSettings) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = [
        ("model", settings.stt_model),
        ("language", settings.stt_language),
        ("smart_format", "true"),
        ("punctuate", "true"),
        ("numerals", "true"),
        ("filler_words", "false"),
        ("encoding", "linear16"),
        ("sample_rate", str(SAMPLE_RATE)),
        ("channels", "1"),
    ]
    keyterms = settings.stt_keyterms or DEFAULT_KEYTERMS
    for term in keyterms[:100]:
        params.append(("keyterm", term))
    return params


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
