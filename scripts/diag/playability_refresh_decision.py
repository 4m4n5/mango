#!/usr/bin/env python3
"""Decide whether a staged playability receipt is safe to publish.

The staged work DB holds whichever refresh phase ran after staging. Publication
must depend on that phase's own completion contract and its own exit status, not
on an unrelated phase's status: a nightly stale failure is independent evidence
and must not discard a completed, publishable grow.

`stage` is deliberately not consulted. It is enriched from the best-effort
grow-run-state heartbeat (see extract_refresh_json.enrich_payload) and falls back
to "completion_report" when that file is missing, so requiring stage == "publish"
would discard genuinely publishable corpora.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


def staged_receipt_publishable(payload: Any, publish_rc: int) -> bool:
    """`publish_rc` is the exit status of the phase that produced this receipt."""
    if not isinstance(payload, dict):
        return False
    if publish_rc != 0:
        return False
    # A synthesized fallback receipt is always ok=false, so it cannot publish.
    if payload.get("ok") is not True:
        return False
    if payload.get("mode") == "grow" and payload.get("all_rails_publishable") is False:
        return False
    return True


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: playability_refresh_decision.py RECEIPT_PATH PUBLISH_RC", file=sys.stderr)
        return 2
    try:
        publish_rc = int(sys.argv[2])
    except ValueError:
        print("0")
        return 0
    try:
        payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        print("0")
        return 0
    print("1" if staged_receipt_publishable(payload, publish_rc) else "0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
