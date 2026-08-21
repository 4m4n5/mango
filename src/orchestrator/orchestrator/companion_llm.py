"""Parse Sonnet nightly consolidation JSON — unit-tested without API calls."""

from __future__ import annotations

import json
import re
from typing import Any


class ConsolidationParseError(ValueError):
    pass


def extract_json_payload(text: str) -> dict[str, Any]:
    """Extract JSON object from model output (raw or fenced)."""
    stripped = text.strip()
    if not stripped:
        raise ConsolidationParseError("empty model output")

    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", stripped, re.DOTALL)
    if fence:
        stripped = fence.group(1)

    try:
        payload = json.loads(stripped)
    except json.JSONDecodeError as exc:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start >= 0 and end > start:
            payload = json.loads(stripped[start : end + 1])
        else:
            raise ConsolidationParseError(f"invalid json: {exc}") from exc

    if not isinstance(payload, dict):
        raise ConsolidationParseError("payload must be an object")
    return payload


def normalize_consolidation_patch(payload: dict[str, Any]) -> dict[str, Any]:
    """Map LLM JSON to catalog profile patch body."""

    def as_string_list(value: Any, *, limit: int) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                out.append(item.strip()[:200])
        return out[:limit]

    patch: dict[str, Any] = {}
    append_facts = as_string_list(payload.get("append_facts"), limit=8)
    append_loves = as_string_list(payload.get("append_loves"), limit=8)
    append_avoids = as_string_list(payload.get("append_avoids"), limit=8)
    open_questions = as_string_list(payload.get("open_questions"), limit=5)

    if append_facts:
        patch["append_facts"] = append_facts
    if append_loves:
        patch["append_loves"] = append_loves
    if append_avoids:
        patch["append_avoids"] = append_avoids
    if open_questions:
        patch["open_questions"] = open_questions

    catalog_hints = payload.get("catalog_hints")
    if isinstance(catalog_hints, list):
        cleaned: list[dict[str, Any]] = []
        for entry in catalog_hints[:6]:
            if not isinstance(entry, dict):
                continue
            slot_id = entry.get("slot_id")
            if not isinstance(slot_id, str) or not slot_id.strip():
                continue
            hint: dict[str, Any] = {"slot_id": slot_id.strip()}
            suggestion = entry.get("topup_suggestion")
            if isinstance(suggestion, str) and suggestion.strip():
                hint["topup_suggestion"] = suggestion.strip()[:240]
            add_ids = as_string_list(entry.get("add_ids"), limit=5)
            if add_ids:
                hint["add_ids"] = add_ids
            cleaned.append(hint)
        if cleaned:
            patch["catalog_hints"] = cleaned

    summary = payload.get("compiled_notes_addendum")
    if isinstance(summary, str) and summary.strip():
        patch["compiled_notes_addendum"] = summary.strip()[:1200]

    return patch


def parse_consolidation_response(text: str) -> dict[str, Any]:
    return normalize_consolidation_patch(extract_json_payload(text))
