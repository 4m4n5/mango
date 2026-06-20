from __future__ import annotations

import logging
import os
from pathlib import Path

import httpx
import numpy as np

from orchestrator.audio.pcm_prep import prepare_for_stt
from orchestrator.config import OrchestratorSettings

logger = logging.getLogger(__name__)

DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"
SAMPLE_RATE = 16_000
MIN_CONFIDENCE = 0.52

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
    "dikha do",
    "chalao",
    "chala do",
    "lagao",
    "laga do",
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
    "mujhe",
    "please",
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
    strategy = settings.stt_strategy.strip().lower()

    if strategy == "detect":
        return _transcribe_once(pcm, settings, api_key, mode="detect")

    text, confidence, detected = _request_transcript(pcm, settings, api_key, mode="multilingual")
    if text and _confidence_ok(confidence):
        logger.info(
            "stt multilingual ok lang=%s conf=%.2f chars=%d text=%r",
            detected,
            confidence or 0.0,
            len(text),
            text[:96],
        )
        return text

    if strategy in {"multilingual", "multilingual_with_detect_fallback"}:
        logger.info(
            "stt multilingual weak (conf=%s lang=%s) — retry detect hi+en-IN",
            confidence,
            detected,
        )
        fallback = _transcribe_once(pcm, settings, api_key, mode="detect")
        if fallback:
            return fallback

    if text:
        return text
    raise RuntimeError("no speech detected")


def _transcribe_once(
    pcm: bytes,
    settings: OrchestratorSettings,
    api_key: str,
    *,
    mode: str,
) -> str:
    text, confidence, detected = _request_transcript(pcm, settings, api_key, mode=mode)
    if not text:
        raise RuntimeError("no speech detected")
    logger.info(
        "stt %s ok lang=%s conf=%.2f chars=%d text=%r",
        mode,
        detected,
        confidence or 0.0,
        len(text),
        text[:96],
    )
    return text


def _confidence_ok(confidence: float | None) -> bool:
    if confidence is None:
        return True
    return confidence >= MIN_CONFIDENCE


def _request_transcript(
    pcm: bytes,
    settings: OrchestratorSettings,
    api_key: str,
    *,
    mode: str,
) -> tuple[str, float | None, str | None]:
    params = _listen_params(settings, mode=mode)
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
    channel = (payload.get("results") or {}).get("channels", [{}])[0]
    alternative = (channel.get("alternatives") or [{}])[0]
    transcript = str(alternative.get("transcript", "")).strip()
    confidence_raw = alternative.get("confidence")
    confidence = float(confidence_raw) if isinstance(confidence_raw, (int, float)) else None
    detected = channel.get("detected_language")
    if isinstance(detected, list):
        detected = detected[0] if detected else None
    detected_text = str(detected) if detected is not None else None
    return transcript, confidence, detected_text


def _listen_params(settings: OrchestratorSettings, *, mode: str) -> list[tuple[str, str]]:
    params: list[tuple[str, str]] = [
        ("model", settings.stt_model),
        ("smart_format", "true"),
        ("punctuate", "true"),
        ("numerals", "true"),
        ("filler_words", "false"),
        ("encoding", "linear16"),
        ("sample_rate", str(SAMPLE_RATE)),
        ("channels", "1"),
    ]
    if mode == "detect":
        for language in settings.stt_detect_languages:
            params.append(("detect_language", language))
    else:
        params.append(("language", settings.stt_language))

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
