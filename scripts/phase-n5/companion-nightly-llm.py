#!/usr/bin/env python3
"""Nightly Sonnet consolidation — journal + profile → profile patch via catalog HTTP."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

from orchestrator.companion_llm import parse_consolidation_response
from orchestrator.config import load_settings
from orchestrator.llm.provider import _read_api_key


def _http_json(
    settings,
    method: str,
    path: str,
    *,
    body: dict | None = None,
    timeout: float = 30.0,
) -> dict:
    url = f"{settings.catalog_upstream.rstrip('/')}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _build_prompt(profile: dict, journal: list[dict], compiled_excerpt: str) -> str:
    events = []
    for event in journal[:40]:
        if event.get("event_type") != "voice_turn":
            continue
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        events.append(
            {
                "transcript": payload.get("transcript", ""),
                "reply": payload.get("reply", ""),
            }
        )

    return (
        "You consolidate a TV companion memory journal into structured profile updates.\n"
        "Return ONLY valid JSON with keys:\n"
        "append_facts (string[]), append_loves (string[]), append_avoids (string[]),\n"
        "open_questions (string[]), compiled_notes_addendum (string),\n"
        "catalog_hints ([{slot_id, topup_suggestion?, add_ids?}]).\n"
        "Never duplicate existing facts. Max 5 items per list. No remove_ids.\n\n"
        f"CURRENT PROFILE:\n{json.dumps(profile, indent=2)[:4000]}\n\n"
        f"COMPILED NOTES EXCERPT:\n{compiled_excerpt[:1500]}\n\n"
        f"RECENT VOICE TURNS:\n{json.dumps(events[:20], indent=2)[:4000]}"
    )


def run(*, dry_run: bool = False) -> int:
    settings = load_settings()
    api_key = _read_api_key(settings, "anthropic")

    summary = _http_json(settings, "GET", "/voice/companion/summary")
    profile_resp = _http_json(settings, "GET", "/voice/companion/profile")
    journal_resp = _http_json(settings, "GET", "/voice/companion/journal?limit=80")

    profile = profile_resp.get("profile") if isinstance(profile_resp, dict) else {}
    journal = journal_resp.get("events") if isinstance(journal_resp, dict) else []
    compiled = summary.get("compiled_excerpt") if isinstance(summary, dict) else ""

    if not journal:
        print("SKIP: no journal events for nightly LLM")
        return 0

    from anthropic import Anthropic

    client = Anthropic(api_key=api_key)
    model = settings.llm_model
    prompt = _build_prompt(profile if isinstance(profile, dict) else {}, journal, str(compiled))

    response = client.messages.create(
        model=model,
        max_tokens=800,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )

    text_parts: list[str] = []
    for block in response.content:
        if getattr(block, "type", None) == "text":
            text = getattr(block, "text", "")
            if isinstance(text, str):
                text_parts.append(text)
    raw = "\n".join(text_parts)
    patch = parse_consolidation_response(raw)

    if dry_run:
        print(json.dumps(patch, indent=2))
        return 0

    catalog_hints = patch.pop("catalog_hints", None)
    compiled_addendum = patch.pop("compiled_notes_addendum", None)

    if patch:
        _http_json(settings, "POST", "/voice/companion/profile", body=patch)

    if isinstance(compiled_addendum, str) and compiled_addendum.strip():
        notes_resp = _http_json(settings, "GET", "/voice/library/notes")
        existing = notes_resp.get("notes") if isinstance(notes_resp, dict) else ""
        merged = f"{existing}\n\n{compiled_addendum.strip()}".strip()
        _http_json(settings, "POST", "/voice/library/notes", body={"notes": merged[-4000:]})

    if isinstance(catalog_hints, list):
        for hint in catalog_hints:
            if not isinstance(hint, dict):
                continue
            slot_id = hint.get("slot_id")
            if not isinstance(slot_id, str):
                continue
            body: dict = {"slot_id": slot_id, "llm_hints": {}}
            if isinstance(hint.get("topup_suggestion"), str):
                body["llm_hints"]["topup_suggestions"] = [hint["topup_suggestion"]]
            if isinstance(hint.get("add_ids"), list):
                body["llm_hints"]["add_ids"] = hint["add_ids"]
            _http_json(settings, "POST", "/voice/ai-catalogs/update", body=body)

    print("PASS: companion nightly LLM consolidation")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Nightly companion Sonnet consolidation")
    parser.add_argument("--dry-run", action="store_true", help="Parse only; do not write")
    args = parser.parse_args()
    try:
        return run(dry_run=args.dry_run)
    except urllib.error.URLError as exc:
        print(f"FAIL: catalog HTTP error: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
