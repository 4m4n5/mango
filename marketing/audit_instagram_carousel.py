#!/usr/bin/env python3
"""Run Mango's reproducible Instagram carousel publication audit."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image


HERE = Path(__file__).resolve().parent
REPO = HERE.parent
OUT = HERE / "out" / "instagram-carousel"
BRIEF = REPO / "docs" / "INSTAGRAM_LAUNCH_CAROUSEL.md"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    manifest = json.loads((OUT / "manifest.json").read_text())
    brief = BRIEF.read_text()
    failures: list[str] = []
    blockers: list[str] = []

    cards = manifest.get("cards", [])
    if len(cards) != 8:
        failures.append(f"expected 8 manifest cards, found {len(cards)}")

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
        if card.get("publication_blocker"):
            blockers.append(f"Slide {card['card']}: {card['publication_blocker']}")

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
            "evidence": "Reviewed the 270 px-wide contact sheet; all eight headlines and the CTA remain legible.",
        },
        "safe_areas": {
            "status": "pass",
            "evidence": "All copy stays within the 64 px text safe area and 96 px bottom reserve.",
        },
        "privacy": {
            "status": "pass",
            "evidence": "Phone account identity was cropped; no source URLs, tokens, credentials, or private account identifiers are visible.",
        },
        "product_truth": {
            "status": "pass_with_blockers",
            "evidence": "Slides 1–7 use current real Pi/phone states. Slide 4 is explicitly a pre-play verified stream ladder; Slide 8 still needs the approved hardware photograph.",
        },
        "platform": {
            "status": "blocked",
            "evidence": "Slide 7's ad/Premium statement requires technical and platform/legal approval.",
        },
        "launch_state": {
            "status": "pass",
            "evidence": "The caption says alpha/self-hosted, names unfinished boundaries, and uses DM/email rather than retail availability.",
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
