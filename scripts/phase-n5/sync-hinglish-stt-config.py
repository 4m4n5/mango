#!/usr/bin/env python3
"""Merge Hinglish STT defaults into /etc/mango/config.yaml without dropping other keys."""

from __future__ import annotations

import sys
from pathlib import Path

import yaml

CONFIG = Path("/etc/mango/config.yaml")

HINGLISH_STT = {
    "provider": "deepgram",
    "model": "nova-3-general",
    "language": "multi",
    "strategy": "multilingual_with_detect_fallback",
    "detect_languages": ["hi", "en-IN"],
    "timeout_seconds": 30,
    "prepare_audio": True,
}

EXTRA_KEYTERMS = [
    "kholo",
    "khol",
    "dikhao",
    "dikha do",
    "chalao",
    "chala do",
    "lagao",
    "laga do",
    "mujhe",
    "kya dekhu",
    "Toy Story",
    "Panchayat",
    "Breaking Bad",
    "Shawshank",
    "Godfather",
]


def main() -> int:
    if not CONFIG.is_file():
        print(f"FAIL: missing {CONFIG}", file=sys.stderr)
        return 1
    raw = yaml.safe_load(CONFIG.read_text()) or {}
    stt = dict(raw.get("stt") or {})
    stt.update(HINGLISH_STT)
    keyterms = list(stt.get("keyterms") or [])
    for term in EXTRA_KEYTERMS:
        if term not in keyterms:
            keyterms.append(term)
    stt["keyterms"] = keyterms
    if not stt.get("api_key_file"):
        stt["api_key_file"] = "/etc/mango/stt.key"
    raw["stt"] = stt
    CONFIG.write_text(yaml.dump(raw, default_flow_style=False, sort_keys=False))
    print(
        f"OK: stt model={stt['model']} language={stt['language']} "
        f"strategy={stt['strategy']} keyterms={len(keyterms)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
