"""STT result metadata for voice diagnosis."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SttResult:
    text: str
    provider: str
    model: str
    confidence: float | None = None
    language: str | None = None
    mode: str | None = None
    fallback: bool = False
