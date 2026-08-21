from __future__ import annotations

import numpy as np

FRAME_MS = 20
MIN_KEEP_MS = 250
EDGE_PAD_MS = 120
QUIET_PEAK = 0.35
TARGET_PEAK = 0.82


def prepare_for_stt(samples: np.ndarray, sample_rate: int = 16_000) -> np.ndarray:
    """Trim edge silence and gently boost quiet phone mics — local only, no API cost."""
    if samples.size == 0:
        return samples
    trimmed = _trim_edge_silence(samples, sample_rate)
    return _normalize_quiet(trimmed)


def _trim_edge_silence(samples: np.ndarray, sample_rate: int) -> np.ndarray:
    frame_len = max(1, int(sample_rate * FRAME_MS / 1000))
    min_keep = max(frame_len, int(sample_rate * MIN_KEEP_MS / 1000))
    pad = int(sample_rate * EDGE_PAD_MS / 1000)

    energies = []
    for start in range(0, len(samples), frame_len):
        frame = samples[start : start + frame_len]
        if frame.size == 0:
            continue
        energies.append((start, float(np.sqrt(np.mean(frame * frame)))))

    if not energies:
        return samples

    peak = max(energy for _, energy in energies)
    threshold = max(peak * 0.03, 1e-5)

    start_idx = 0
    for offset, energy in energies:
        if energy >= threshold:
            start_idx = max(0, offset - pad)
            break

    end_idx = len(samples)
    for offset, energy in reversed(energies):
        if energy >= threshold:
            end_idx = min(len(samples), offset + frame_len + pad)
            break

    if end_idx - start_idx < min_keep:
        return samples
    return samples[start_idx:end_idx]


def _normalize_quiet(samples: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(samples)))
    if peak < 1e-6 or peak >= QUIET_PEAK:
        return samples
    gain = TARGET_PEAK / peak
    return np.clip(samples * gain, -1.0, 1.0)
