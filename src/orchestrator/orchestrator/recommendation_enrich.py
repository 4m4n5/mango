"""Bounded LLM semantic enrichment for Mango's local recommendation ranker."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from orchestrator.companion_llm import extract_json_payload
from orchestrator.config import OrchestratorSettings
from orchestrator.llm.provider import generate_reply

PROMPT_VERSION = "recommendation-semantics-v1"
MAX_ITEMS = 24

RECOMMENDATION_ENRICH_SYSTEM_PROMPT = """
You annotate known movie and TV titles for a private recommendation engine.
Return JSON only: {"items":[...]}. Return exactly one object for every input.
Copy type and id exactly. Never add titles or recommend anything.
Each object must contain themes (max 12 short tags), tone (max 8 short tags),
pace (slow|moderate|fast|varied), and six numbers from 0 to 1: tension,
humor, spectacle, emotional_intensity, tenderness, narrative_complexity.
Infer conservatively from the supplied title, year, and catalog hints. Tags
describe content, not quality. Do not include explanations, URLs, or people.
""".strip()

_TYPES = {"movie", "series"}
_PACES = {"slow", "moderate", "fast", "varied"}
_NUMERIC_FIELDS = (
    "tension",
    "humor",
    "spectacle",
    "emotional_intensity",
    "tenderness",
    "narrative_complexity",
)


def _clean_tags(value: object, limit: int) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        tag = re.sub(r"\s+", " ", str(item)).strip().lower()[:40]
        if tag and tag not in output:
            output.append(tag)
        if len(output) >= limit:
            break
    return output


def normalize_enrichment_request(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("expected an items array")
    raw_items = payload["items"]
    if not raw_items or len(raw_items) > MAX_ITEMS:
        raise ValueError(f"items must contain 1 to {MAX_ITEMS} titles")
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            raise ValueError("every item must be an object")
        content_type = str(raw.get("type", "")).strip().lower()
        content_id = str(raw.get("id", "")).strip().lower()
        title = re.sub(r"\s+", " ", str(raw.get("title", ""))).strip()[:160]
        if content_type not in _TYPES or not content_id or not title:
            raise ValueError("every item requires a known type, stable id, and title")
        key = f"{content_type}:{content_id}"
        if key in seen:
            raise ValueError("duplicate item identity")
        seen.add(key)
        hints = _clean_tags(raw.get("hints"), 16)
        output.append({
            "type": content_type,
            "id": content_id,
            "title": title,
            "year": str(raw.get("year", "")).strip()[:12] or None,
            "hints": hints,
        })
    return output


def normalize_enrichment_response(
    payload: dict[str, Any],
    requested: list[dict[str, Any]],
    settings: OrchestratorSettings,
) -> list[dict[str, Any]]:
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise ValueError("enrichment returned no items array")
    requested_by_key = {f"{item['type']}:{item['id']}": item for item in requested}
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        content_type = str(raw.get("type", "")).strip().lower()
        content_id = str(raw.get("id", "")).strip().lower()
        key = f"{content_type}:{content_id}"
        source = requested_by_key.get(key)
        if source is None or key in seen:
            continue
        themes = _clean_tags(raw.get("themes"), 12)
        tone = _clean_tags(raw.get("tone"), 8)
        pace = str(raw.get("pace", "")).strip().lower()
        if not themes or pace not in _PACES:
            continue
        numbers: dict[str, float] = {}
        valid = True
        for field in _NUMERIC_FIELDS:
            try:
                number = float(raw.get(field))
            except (TypeError, ValueError):
                valid = False
                break
            if not 0 <= number <= 1:
                valid = False
                break
            numbers[field] = round(number, 3)
        if not valid:
            continue
        canonical = json.dumps(source, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        output.append({
            "type": content_type,
            "id": content_id,
            "model_version": settings.llm_model,
            "prompt_version": PROMPT_VERSION,
            "input_hash": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            "themes": themes,
            "tone": tone,
            "pace": pace,
            **numbers,
        })
        seen.add(key)
    # A malformed or omitted member is isolated: valid siblings remain useful
    # and the catalog client retries missing IDs on a later rotated batch.
    if not output:
        raise ValueError("enrichment returned no valid requested stable ids")
    return output


def enrich_recommendation_items(
    payload: object,
    settings: OrchestratorSettings,
) -> list[dict[str, Any]]:
    requested = normalize_enrichment_request(payload)
    reply = generate_reply(
        [{"role": "user", "content": json.dumps({"items": requested}, ensure_ascii=False)}],
        settings,
        system_prompt=RECOMMENDATION_ENRICH_SYSTEM_PROMPT,
        max_tokens=min(4096, max(768, len(requested) * 150)),
    )
    return normalize_enrichment_response(extract_json_payload(reply), requested, settings)
