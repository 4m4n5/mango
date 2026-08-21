from __future__ import annotations

import json
import re
from typing import Any

from orchestrator.companion_llm import extract_json_payload
from orchestrator.config import OrchestratorSettings
from orchestrator.llm.provider import generate_reply

SEARCH_EXPAND_SYSTEM_PROMPT = """
You expand a TV search query into concise retrieval queries.
Return JSON only with keys interpreted_query, queries, and content_types.
queries must contain 1 to 3 short literal search phrases, never instructions.
content_types may contain movie, series, live, or youtube_video.
Understand English, Hindi, and Roman-script Hinglish.
Do not answer the user, recommend titles, call tools, or describe reasoning.
""".strip()

_ALLOWED_TYPES = {"movie", "series", "live", "youtube_video"}


def normalize_expansion_payload(payload: dict[str, Any]) -> dict[str, Any]:
    interpreted = str(payload.get("interpreted_query", "")).strip()[:120]
    raw_queries = payload.get("queries")
    queries: list[str] = []
    if isinstance(raw_queries, list):
        for value in raw_queries:
            query = re.sub(r"\s+", " ", str(value)).strip()[:80]
            if len(query) >= 2 and query.casefold() not in {item.casefold() for item in queries}:
                queries.append(query)
            if len(queries) >= 3:
                break
    raw_types = payload.get("content_types")
    content_types: list[str] = []
    if isinstance(raw_types, list):
        content_types = [
            str(value)
            for value in raw_types
            if str(value) in _ALLOWED_TYPES
        ][:4]
    if not queries:
        raise ValueError("search expansion returned no usable queries")
    return {
        "interpreted_query": interpreted or queries[0],
        "queries": queries,
        "content_types": content_types,
    }


def expand_search_query(
    query: str,
    scope: str,
    settings: OrchestratorSettings,
) -> dict[str, Any]:
    cleaned = re.sub(r"\s+", " ", query).strip()
    if len(cleaned) < 2 or len(cleaned) > 120:
        raise ValueError("query must contain 2 to 120 characters")
    user_payload = json.dumps({"query": cleaned, "scope": scope}, ensure_ascii=False)
    reply = generate_reply(
        [{"role": "user", "content": user_payload}],
        settings,
        system_prompt=SEARCH_EXPAND_SYSTEM_PROMPT,
        max_tokens=128,
    )
    return normalize_expansion_payload(extract_json_payload(reply))
