"""Voice TV navigation helpers — search-hit picking and open payloads."""

from __future__ import annotations

import re
from typing import Any

_ORDINAL_WORDS: dict[str, int] = {
    "first": 0,
    "one": 0,
    "pehla": 0,
    "pehle": 0,
    "pehli": 0,
    "second": 1,
    "two": 1,
    "doosra": 1,
    "doosre": 1,
    "dusra": 1,
    "third": 2,
    "three": 2,
    "teesra": 2,
    "teesri": 2,
    "fourth": 3,
    "four": 3,
    "chautha": 3,
}
_OPTION_NUM = re.compile(r"\b(?:option|number|#)\s*(\d+)\b", re.IGNORECASE)
_BARE_NUM = re.compile(r"\b([1-4])\b")


def hit_to_open_input(hit: dict[str, Any]) -> dict[str, Any]:
    content_type = hit.get("type")
    content_id = hit.get("id")
    title = hit.get("title")
    if not isinstance(content_type, str) or not isinstance(content_id, str):
        raise ValueError("search hit missing type/id")
    if not isinstance(title, str) or not title.strip():
        title = content_id
    payload: dict[str, Any] = {
        "type": content_type,
        "id": content_id,
        "title": title.strip(),
    }
    tab = hit.get("tab")
    if isinstance(tab, str) and tab.strip():
        payload["tab"] = tab.strip()
    poster = hit.get("poster")
    if isinstance(poster, str) and poster.strip():
        payload["poster"] = poster.strip()
    return payload


def pick_hit_from_utterance(text: str, hits: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Resolve 'the second one' / title name against recent search hits."""
    if not hits:
        return None
    normalized = text.strip().lower()
    if not normalized:
        return None

    for word, index in _ORDINAL_WORDS.items():
        if re.search(rf"\b{re.escape(word)}\b", normalized) and index < len(hits):
            return hits[index]

    option_match = _OPTION_NUM.search(normalized)
    if option_match:
        index = int(option_match.group(1)) - 1
        if 0 <= index < len(hits):
            return hits[index]

    if len(hits) <= 4:
        bare = _BARE_NUM.search(normalized)
        if bare and any(token in normalized for token in ("option", "number", "wala", "one")):
            index = int(bare.group(1)) - 1
            if 0 <= index < len(hits):
                return hits[index]

    best: tuple[int, dict[str, Any]] | None = None
    for hit in hits:
        title = hit.get("title")
        if not isinstance(title, str) or not title.strip():
            continue
        title_lower = title.strip().lower()
        if title_lower in normalized:
            score = 100
        elif any(part in normalized for part in title_lower.split() if len(part) >= 4):
            score = 75
        else:
            continue
        if best is None or score > best[0]:
            best = (score, hit)
    return best[1] if best is not None else None


def pick_auto_open_hit(hits: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not hits:
        return None
    scored: list[tuple[int, dict[str, Any]]] = []
    for hit in hits:
        score = hit.get("score")
        score_value = int(score) if isinstance(score, (int, float)) else 0
        if isinstance(hit.get("id"), str) and isinstance(hit.get("title"), str):
            scored.append((score_value, hit))
    if not scored:
        if len(hits) == 1 and isinstance(hits[0].get("id"), str):
            return hits[0]
        return None
    scored.sort(key=lambda pair: pair[0], reverse=True)
    top_score, top_hit = scored[0]
    if top_score >= 92:
        return top_hit
    if len(scored) == 1 and top_score >= 78:
        return top_hit
    if len(scored) == 1 and top_score == 0:
        return top_hit
    if len(scored) > 1:
        second_score = scored[1][0]
        if top_score >= 85 and top_score - second_score >= 12:
            return top_hit
    return None
