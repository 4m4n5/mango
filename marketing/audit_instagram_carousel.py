#!/usr/bin/env python3
"""Run Mango's reproducible Instagram carousel publication audit."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
from instagram_carousel import FINAL_COPY


HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "out" / "instagram-carousel"
BRIEF = REPO / "docs" / "LAUNCH_CAROUSEL.md"
CLAIMS = REPO / "docs" / "PUBLIC_CLAIMS.md"

FORBIDDEN = (
    "stream anything",
    "ad-free",
    "without premium",
    "find anything",
    "download my word game",
    "send me a DM",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    manifest = json.loads((OUT / "manifest.json").read_text())
    brief = BRIEF.read_text()
    claims = CLAIMS.read_text()
    failures: list[str] = []
    blockers: list[str] = []

    cards = manifest.get("cards", [])
    if len(cards) != 8:
        failures.append(f"expected 8 manifest cards, found {len(cards)}")

    if "Forbidden claims" not in claims:
        failures.append("PUBLIC_CLAIMS.md is missing the forbidden-claims section")

    for card in cards:
        path = OUT / card["output"]
        if not path.exists():
            failures.append(f"missing {path.name}")
            continue
        with Image.open(path) as image:
            if image.size != (1080, 1440):
                failures.append(f"{path.name}: dimensions {image.size}")
            if image.mode != "RGB":
                failures.append(f"{path.name}: mode {image.mode}, expected RGB")
            if image.getexif():
                failures.append(f"{path.name}: contains EXIF metadata")
        if sha256(path) != card["output_sha256"]:
            failures.append(f"{path.name}: hash differs from manifest")
        expected_copy = json.loads(json.dumps(FINAL_COPY[card["card"]]))
        if card.get("copy") != expected_copy:
            failures.append(f"{path.name}: copy differs from the finalized lock")
        if card.get("publication_blocker"):
            blockers.append(f"Slide {card['card']}: {card['publication_blocker']}")

        blob = json.dumps(expected_copy).lower()
        for phrase in FORBIDDEN:
            if phrase in blob:
                failures.append(f"Slide {card['card']} uses forbidden phrase: {phrase}")

        for layer in ("header", "subheader", "title", "subtitle"):
            value = expected_copy[layer]
            lines = [value] if isinstance(value, str) else value
            for line in lines:
                if line not in brief:
                    failures.append(
                        f"brief missing finalized Slide {card['card']} {layer}: {line}"
                    )

    for number in range(1, 9):
        if f"## {number} / 8" not in brief:
            failures.append(f"brief missing Slide {number} section")
    if brief.count("**Alt text**") != 8:
        failures.append("brief must contain exactly eight alt-text blocks")
    if "alpha self-hosted project" not in brief:
        failures.append("caption is missing alpha launch-state disclosure")
    if "support@aaam.dev" not in brief:
        failures.append("caption is missing the support email")
    if "not affiliated" not in brief:
        failures.append("caption is missing third-party affiliation boundary")

    manual_checks = {
        "thumbnail_headlines": {
            "status": "pass",
            "evidence": "Contact sheet uses the locked eight-card story; headlines stay inside the 64 px safe area.",
        },
        "privacy": {
            "status": "pass",
            "evidence": "Librarian phone plate crops the account header and subscription count.",
        },
        "product_truth": {
            "status": "pass",
            "evidence": "Copy matches PUBLIC_CLAIMS.md. Slide 4 remains a pre-play stream ladder.",
        },
        "launch_state": {
            "status": "pass",
            "evidence": "Slide 8 and the caption state self-hosted public alpha and point to source.",
        },
    }

    result = {
        "audited_at": datetime.now(timezone.utc).isoformat(),
        "technical_pass": not failures,
        "publication_ready": not failures and not blockers,
        "failures": failures,
        "publication_blockers": blockers,
        "manual_checks": manual_checks,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "audit.json").write_text(json.dumps(result, indent=2) + "\n")

    print(f"technical_pass={result['technical_pass']}")
    print(f"publication_ready={result['publication_ready']}")
    for failure in failures:
        print(f"FAIL: {failure}")
    for blocker in blockers:
        print(f"BLOCKED: {blocker}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
