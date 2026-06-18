from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
BYTES_PER_SAMPLE = 2


@dataclass(frozen=True)
class PcmAudio:
    samples: np.ndarray
    duration_seconds: float


def decode_pcm_b64(payload: str, max_seconds: int = 30) -> PcmAudio:
    try:
        raw = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid microphone payload") from exc

    max_bytes = max_seconds * SAMPLE_RATE * BYTES_PER_SAMPLE
    if len(raw) == 0:
        raise ValueError("empty microphone payload")
    if len(raw) > max_bytes:
        raise ValueError(f"microphone payload exceeds {max_seconds}s limit")
    if len(raw) % BYTES_PER_SAMPLE != 0:
        raise ValueError("microphone payload is not 16-bit PCM")

    int_samples = np.frombuffer(raw, dtype="<i2")
    samples = int_samples.astype(np.float32) / 32768.0
    return PcmAudio(samples=samples, duration_seconds=len(int_samples) / SAMPLE_RATE)
