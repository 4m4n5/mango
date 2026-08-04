"""Strict, stateless StoryDNA teaching for Mango's local VOD graph."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

from orchestrator.companion_llm import extract_json_payload
from orchestrator.config import OrchestratorSettings
from orchestrator.llm.provider import generate_reply

STORY_DNA_SCHEMA_VERSION = "story-dna-v1"
STORY_DNA_ONTOLOGY_VERSION = "story-dna-core-v1"
STORY_DNA_PROMPT_VERSION = "story-dna-v1"
LEGACY_PROMPT_VERSION = "recommendation-semantics-v1"
# The existing /recommendations/enrich route remains a v4 compatibility API.
PROMPT_VERSION = LEGACY_PROMPT_VERSION
MAX_ITEMS = 24

_TYPES = {"movie", "series"}
_GENRE_SUBGENRES = {
    "action", "adventure", "animation", "biography", "comedy", "crime",
    "documentary", "drama", "family", "fantasy", "history", "horror", "music",
    "musical", "mystery", "reality", "romance", "sci-fi", "sport", "talk",
    "thriller", "war", "western", "none",
}
_FORMATS = {
    "feature-film", "short-film", "documentary-feature", "special", "miniseries",
    "limited-series", "ongoing-series", "anthology-series", "documentary-series",
    "reality-series", "talk-series", "none",
}
_STORY_ENGINES = {
    "investigation", "quest", "survival", "rivalry", "heist", "revenge",
    "romance", "family-conflict", "coming-of-age", "rise-and-fall",
    "transformation", "workplace", "political-struggle", "social-issue",
    "friendship", "slice-of-life", "procedural", "anthology", "biography", "none",
}
_THEMES = {
    "family", "belonging", "love", "friendship", "identity", "ambition", "power",
    "justice", "duty", "freedom", "faith", "grief", "redemption", "class",
    "community", "survival", "morality", "obsession", "legacy", "prejudice",
    "nature", "technology", "none",
}
_CHARACTER_DYNAMICS = {
    "lone-protagonist", "ensemble", "found-family", "parent-child", "siblings",
    "romantic-pair", "rivals", "mentor-student", "partners", "team",
    "antihero-society", "none",
}
_TONES = {
    "warm", "hopeful", "playful", "witty", "absurd", "romantic", "earnest",
    "contemplative", "melancholic", "dark", "gritty", "suspenseful",
    "frightening", "cynical", "triumphant", "none",
}
_SETTING_ERAS = {
    "ancient", "medieval", "early-modern", "nineteenth-century",
    "early-twentieth-century", "mid-twentieth-century", "late-twentieth-century",
    "contemporary", "near-future", "far-future", "timeless", "mixed", "none",
}
_GEOGRAPHIC_SCOPES = {
    "single-location", "neighborhood", "city", "regional", "national", "global",
    "cosmic", "virtual", "mixed", "none",
}
_SOCIAL_SETTINGS = {
    "domestic", "school", "workplace", "military", "political",
    "criminal-underworld", "wealth-elite", "working-class", "rural-community",
    "urban-community", "religious", "sports", "entertainment-industry",
    "scientific", "wilderness", "none",
}
_NARRATIVE_STRUCTURES = {
    "linear", "nonlinear", "episodic", "serialized", "anthology", "procedural",
    "multiple-timelines", "framed", "unreliable-narrator", "none",
}
_ENDING_EMOTIONAL_ARCS = {
    "uplifting", "bittersweet", "tragic", "ambiguous", "redemptive", "triumphant",
    "downbeat", "cyclical", "open-ended", "none",
}
_FACET_KEYS = (
    "pace", "action", "tension", "spectacle", "humor", "romance", "fear",
    "tenderness", "sadness", "hope", "realism", "narrative_complexity",
    "moral_ambiguity", "violence", "family_accessibility",
)
_CONFIDENCE_KEYS = (
    "overall", "genre_subgenre", "format", "story_engine", "themes",
    "character_dynamics", "tone", "setting_era", "geographic_scope",
    "social_setting", "narrative_structure", "ending_emotional_arc", "facets",
)
_LOOKUP_REASONS = (
    "identity-ambiguity", "short-synopsis", "missing-genres",
    "sparse-catalog-evidence",
)
_EVIDENCE_FIELDS = (
    "title", "year", "synopsis", "genres", "keywords", "languages", "countries",
    "runtime-minutes", "release-state", "format", "cast", "characters",
    "directors", "writers", "awards-certification", "external-ids",
    "curated-pool-memberships", "source", "retrieved-at",
    "field-provenance",
)
_TEACHER_ITEM_KEYS = {
    "type", "id", "genre_subgenres", "format", "story_engines", "themes",
    "character_dynamics", "tone", "setting_era", "geographic_scope",
    "social_settings", "narrative_structures", "ending_emotional_arc", "facets",
    "confidence",
}


def _csv(values: set[str]) -> str:
    return "|".join(sorted(values))


STORY_DNA_SYSTEM_PROMPT = f"""
You are a stateless content teacher for known movies and TV series. You never
recommend, rank, score a viewer, choose a slate, or publish. Use only canonical
title evidence in this request. Never use or infer household ratings, Saved/watch
events, profile data, mood, conversations, companion memory, popularity, charts,
quality, or predicted enjoyment. Do not browse or recall unsupported facts.

Return JSON only as {{"items":[...]}}. Return at most one object for each input,
copying type and id exactly. Each item must have exactly these keys and no others:
type, id, genre_subgenres, format, story_engines, themes, character_dynamics,
tone, setting_era, geographic_scope, social_settings, narrative_structures,
ending_emotional_arc, facets, confidence.

Controlled values:
- genre_subgenres (1-4): {_csv(_GENRE_SUBGENRES)}
- format: {_csv(_FORMATS)}
- story_engines (1-4): {_csv(_STORY_ENGINES)}
- themes (1-6): {_csv(_THEMES)}
- character_dynamics (1-4): {_csv(_CHARACTER_DYNAMICS)}
- tone (1-4): {_csv(_TONES)}
- setting_era: {_csv(_SETTING_ERAS)}
- geographic_scope: {_csv(_GEOGRAPHIC_SCOPES)}
- social_settings (1-3): {_csv(_SOCIAL_SETTINGS)}
- narrative_structures (1-3): {_csv(_NARRATIVE_STRUCTURES)}
- ending_emotional_arc: {_csv(_ENDING_EMOTIONAL_ARCS)}

Every categorical family is required. Use "none" alone when evidence cannot
support a family; never invent a free-form tag. When returning multiple values,
order them from strongest to weakest evidence salience; Mango preserves that
order as a strict reciprocal per-value intensity policy. facets must contain exactly these
integer 0-4 keys: {','.join(_FACET_KEYS)}. Zero is legitimate absence.
confidence must contain exactly these 0-1 numeric keys:
{','.join(_CONFIDENCE_KEYS)}. Do not return titles, explanations, people, URLs,
lookup results, model/version fields, provenance, or any additional property.
""".strip()


def _clean_text(value: object, limit: int, *, lower: bool = False) -> str:
    cleaned = re.sub(r"\s+", " ", str("" if value is None else value)).strip()[:limit]
    return cleaned.lower() if lower else cleaned


def _clean_list(
    value: object,
    limit: int,
    item_limit: int,
    *,
    lower: bool = True,
) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for raw in value:
        item = _clean_text(raw, item_limit, lower=lower)
        if item and item not in output:
            output.append(item)
        if len(output) >= limit:
            break
    return output


def _clean_external_ids(value: object) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, str] = {}
    for raw_key, raw_value in value.items():
        key = re.sub(r"[^a-z0-9._-]", "", _clean_text(raw_key, 40, lower=True))
        content_id = _clean_text(raw_value, 160)
        if key and content_id and key not in output:
            output[key] = content_id
        if len(output) >= 12:
            break
    return dict(sorted(output.items()))


def _clean_field_provenance(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return {}
    output: dict[str, list[str]] = {}
    for raw_field, raw_sources in value.items():
        field = re.sub(
            r"[^a-z0-9._-]", "", _clean_text(raw_field, 40, lower=True),
        )
        sources = raw_sources if isinstance(raw_sources, list) else [raw_sources]
        cleaned = _clean_list(sources, 8, 80)
        if field and cleaned and field not in output:
            output[field] = cleaned
        if len(output) >= 24:
            break
    return dict(sorted(output.items()))


def _normalized_runtime(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not number.is_integer() or not 1 <= number <= 1440:
        return None
    return int(number)


def _canonical_hash(value: object) -> str:
    canonical = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _nested_or_flat(raw: dict[str, Any], evidence: dict[str, Any], key: str) -> object:
    return evidence[key] if key in evidence else raw.get(key)


def _substantive_evidence_count(evidence: dict[str, Any]) -> int:
    keys = (
        "synopsis", "genres", "keywords", "languages", "countries",
        "runtime_minutes", "release_state", "format", "cast", "characters",
        "directors", "writers", "awards_certification", "external_ids",
        "curated_pool_memberships",
    )
    count = 0
    for key in keys:
        value = evidence[key]
        if isinstance(value, (list, dict)):
            count += int(bool(value))
        else:
            count += int(value is not None and value != "")
    return count


def _javascript_string_length(value: str) -> int:
    """Match JavaScript's UTF-16 ``String.length`` at the hash boundary."""
    return len(value.encode("utf-16-le")) // 2


def _selective_lookup(
    raw: dict[str, Any],
    year: str | None,
    evidence: dict[str, Any],
) -> dict[str, Any]:
    reasons: list[str] = []
    if not year and not evidence["external_ids"]:
        reasons.append("identity-ambiguity")
    if not evidence["synopsis"] or _javascript_string_length(evidence["synopsis"]) < 120:
        reasons.append("short-synopsis")
    if not evidence["genres"]:
        reasons.append("missing-genres")
    if _substantive_evidence_count(evidence) < 3:
        reasons.append("sparse-catalog-evidence")
    incoming = raw.get("selective_lookup")
    raw_reasons = incoming.get("reasons") if isinstance(incoming, dict) else raw.get("lookup_reasons")
    for reason in _clean_list(raw_reasons, len(_LOOKUP_REASONS), 40):
        if reason in _LOOKUP_REASONS and reason not in reasons:
            reasons.append(reason)
    return {
        "requested": bool(reasons),
        "reasons": reasons,
        "policy": "structured-only",
        # The endpoint never looks anything up itself. A caller may mark that
        # it already performed the approved structured-provider lookup before
        # sending this canonical evidence envelope.
        "used": bool(reasons) and isinstance(incoming, dict)
        and incoming.get("used") is True,
    }


def normalize_story_dna_request(payload: object) -> list[dict[str, Any]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("expected an items array")
    raw_items = payload["items"]
    if not raw_items or len(raw_items) > MAX_ITEMS:
        raise ValueError(f"items must contain 1 to {MAX_ITEMS} titles")
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw_value in raw_items:
        if not isinstance(raw_value, dict):
            raise ValueError("every item must be an object")
        raw = raw_value
        content_type = _clean_text(raw.get("type"), 16, lower=True)
        content_id = _clean_text(raw.get("id"), 160)
        title = _clean_text(raw.get("title"), 160)
        if content_type not in _TYPES or not content_id or not title:
            raise ValueError("every item requires a known type, stable id, and title")
        key = f"{content_type}:{content_id}"
        if key in seen:
            raise ValueError("duplicate item identity")
        seen.add(key)
        nested = raw.get("evidence")
        supplied = nested if isinstance(nested, dict) else {}
        synopsis = _nested_or_flat(raw, supplied, "synopsis")
        if synopsis is None:
            synopsis = raw.get("description")
        pool_memberships = supplied.get(
            "curated_pool_memberships",
            raw.get("curated_pool_memberships", raw.get("rail_ids", raw.get("hints"))),
        )
        sources = supplied.get("sources", raw.get("evidence_sources"))
        if not isinstance(sources, list):
            sources = [raw.get("source")] if raw.get("source") else []
        evidence = {
            "synopsis": _clean_text(synopsis, 4000) or None,
            "genres": _clean_list(_nested_or_flat(raw, supplied, "genres"), 12, 60),
            "keywords": _clean_list(_nested_or_flat(raw, supplied, "keywords"), 32, 60),
            "languages": _clean_list(_nested_or_flat(raw, supplied, "languages"), 12, 60),
            "countries": _clean_list(_nested_or_flat(raw, supplied, "countries"), 12, 60),
            "runtime_minutes": _normalized_runtime(
                supplied.get("runtime_minutes", raw.get("runtime_minutes")),
            ),
            "release_state": _clean_text(
                supplied.get("release_state", raw.get("release_state")), 60, lower=True,
            ) or None,
            "format": _clean_text(
                supplied.get("format", raw.get("format")), 60, lower=True,
            ) or None,
            "cast": _clean_list(
                _nested_or_flat(raw, supplied, "cast"), 20, 100, lower=False,
            ),
            "characters": _clean_list(
                _nested_or_flat(raw, supplied, "characters"), 20, 100, lower=False,
            ),
            "directors": _clean_list(
                _nested_or_flat(raw, supplied, "directors"), 12, 100, lower=False,
            ),
            "writers": _clean_list(
                _nested_or_flat(raw, supplied, "writers"), 12, 100, lower=False,
            ),
            "awards_certification": _clean_list(
                _nested_or_flat(raw, supplied, "awards_certification"),
                16,
                120,
                lower=False,
            ),
            "external_ids": _clean_external_ids(
                supplied.get("external_ids", raw.get("external_ids")),
            ),
            "curated_pool_memberships": _clean_list(pool_memberships, 20, 80),
            "sources": _clean_list(sources, 8, 80) or ["catalog"],
            "retrieved_at": _clean_text(
                supplied.get("retrieved_at", raw.get("retrieved_at")), 48,
            ) or None,
            "field_provenance": _clean_field_provenance(
                supplied.get("field_provenance", raw.get("field_provenance")),
            ),
        }
        year = _clean_text(raw.get("year"), 12) or None
        output.append({
            "type": content_type,
            "id": content_id,
            "title": title,
            "year": year,
            "evidence": evidence,
            "selective_lookup": _selective_lookup(raw, year, evidence),
        })
    return output


def _enum(value: object, allowed: set[str], field: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise ValueError(f"invalid {field}")
    return value


def _enum_list(
    value: object,
    allowed: set[str],
    field: str,
    maximum: int,
) -> list[str]:
    if (
        not isinstance(value, list)
        or not 1 <= len(value) <= maximum
        or len(set(value)) != len(value)
        or any(not isinstance(item, str) or item not in allowed for item in value)
        or ("none" in value and len(value) != 1)
    ):
        raise ValueError(f"invalid bounded {field}")
    return value


def _unit(value: object, field: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"invalid {field}")
    number = float(value)
    if not 0 <= number <= 1:
        raise ValueError(f"invalid {field}")
    return round(number, 3)


def _ordinal(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 4:
        raise ValueError(f"invalid {field}")
    return value


def _exact_keys(value: object, expected: set[str], field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError(f"{field} is partial or has additional properties")
    return value


def _evidence_envelope(source: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in source.items() if key != "selective_lookup"}


def _evidence_fields(source: dict[str, Any]) -> list[str]:
    fields = ["title"]
    if source["year"]:
        fields.append("year")
    mapping = (
        ("synopsis", "synopsis"), ("genres", "genres"), ("keywords", "keywords"),
        ("languages", "languages"), ("countries", "countries"),
        ("runtime_minutes", "runtime-minutes"), ("release_state", "release-state"),
        ("format", "format"), ("cast", "cast"), ("characters", "characters"),
        ("directors", "directors"), ("writers", "writers"),
        ("awards_certification", "awards-certification"),
        ("external_ids", "external-ids"),
        ("curated_pool_memberships", "curated-pool-memberships"),
        ("sources", "source"), ("retrieved_at", "retrieved-at"),
        ("field_provenance", "field-provenance"),
    )
    for key, field in mapping:
        value = source["evidence"][key]
        if isinstance(value, (list, dict)):
            present = bool(value)
        else:
            present = value is not None and value != ""
        if present:
            fields.append(field)
    return fields


def normalize_story_dna_response(
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
    for raw_value in raw_items:
        if not isinstance(raw_value, dict):
            continue
        content_type = raw_value.get("type")
        content_id = raw_value.get("id")
        if not isinstance(content_type, str) or not isinstance(content_id, str):
            continue
        key = f"{content_type}:{content_id}"
        source = requested_by_key.get(key)
        if source is None or key in seen:
            continue
        try:
            raw = _exact_keys(raw_value, _TEACHER_ITEM_KEYS, "teacher item")
            facets_raw = _exact_keys(raw.get("facets"), set(_FACET_KEYS), "facets")
            confidence_raw = _exact_keys(
                raw.get("confidence"), set(_CONFIDENCE_KEYS), "confidence",
            )
            facets = {field: _ordinal(facets_raw[field], f"facets.{field}") for field in _FACET_KEYS}
            confidence = {
                field: _unit(confidence_raw[field], f"confidence.{field}")
                for field in _CONFIDENCE_KEYS
            }
            document = {
                "type": content_type,
                "id": content_id,
                "schema_version": STORY_DNA_SCHEMA_VERSION,
                "ontology_version": STORY_DNA_ONTOLOGY_VERSION,
                "teacher_role": "content-only",
                "model_version": settings.llm_model,
                "prompt_version": STORY_DNA_PROMPT_VERSION,
                "input_hash": _canonical_hash(source),
                "genre_subgenres": _enum_list(
                    raw.get("genre_subgenres"), _GENRE_SUBGENRES, "genre_subgenres", 4,
                ),
                "format": _enum(raw.get("format"), _FORMATS, "format"),
                "story_engines": _enum_list(
                    raw.get("story_engines"), _STORY_ENGINES, "story_engines", 4,
                ),
                "themes": _enum_list(raw.get("themes"), _THEMES, "themes", 6),
                "character_dynamics": _enum_list(
                    raw.get("character_dynamics"), _CHARACTER_DYNAMICS,
                    "character_dynamics", 4,
                ),
                "tone": _enum_list(raw.get("tone"), _TONES, "tone", 4),
                "setting_era": _enum(
                    raw.get("setting_era"), _SETTING_ERAS, "setting_era",
                ),
                "geographic_scope": _enum(
                    raw.get("geographic_scope"), _GEOGRAPHIC_SCOPES,
                    "geographic_scope",
                ),
                "social_settings": _enum_list(
                    raw.get("social_settings"), _SOCIAL_SETTINGS, "social_settings", 3,
                ),
                "narrative_structures": _enum_list(
                    raw.get("narrative_structures"), _NARRATIVE_STRUCTURES,
                    "narrative_structures", 3,
                ),
                "ending_emotional_arc": _enum(
                    raw.get("ending_emotional_arc"), _ENDING_EMOTIONAL_ARCS,
                    "ending_emotional_arc",
                ),
                "facets": facets,
                "confidence": confidence,
                "provenance": {
                    "teacher": "llm-content-teacher",
                    "content_only": True,
                    "evidence_hash": _canonical_hash(_evidence_envelope(source)),
                    "evidence_fields": _evidence_fields(source),
                    "sources": source["evidence"]["sources"],
                },
                "selective_lookup": source["selective_lookup"],
            }
        except (KeyError, TypeError, ValueError):
            # A malformed member is an independent retryable artifact. Valid
            # siblings from the same teacher batch remain publishable to cache.
            continue
        output.append(document)
        seen.add(key)
    if not output:
        raise ValueError("enrichment returned no valid requested stable ids")
    return output


def enrich_story_dna_items(
    payload: object,
    settings: OrchestratorSettings,
) -> list[dict[str, Any]]:
    """Handler-ready StoryDNA endpoint body; routing remains in ``main.py``."""
    requested = normalize_story_dna_request(payload)
    reply = generate_reply(
        [{"role": "user", "content": json.dumps({"items": requested}, ensure_ascii=False)}],
        settings,
        system_prompt=STORY_DNA_SYSTEM_PROMPT,
        max_tokens=min(16_384, max(2_048, len(requested) * 650)),
    )
    return normalize_story_dna_response(extract_json_payload(reply), requested, settings)


# ---------------------------------------------------------------------------
# v4 compatibility teacher
# ---------------------------------------------------------------------------

RECOMMENDATION_ENRICH_SYSTEM_PROMPT = """
You enrich known movie and TV-series identities for a deterministic local
recommender. Return JSON only as {"items":[...]}. Copy type and id exactly.
For every item return themes (0-12 short strings), tone (0-8 short strings),
pace (slow|moderate|fast|varied), and numbers from 0 to 1 for tension, humor,
spectacle, emotional_intensity, tenderness, and narrative_complexity. Do not
recommend, rank, add titles, URLs, explanations, or viewer/profile data.
""".strip()

_LEGACY_PACES = {"slow", "moderate", "fast", "varied"}
_LEGACY_NUMERIC_FIELDS = (
    "tension", "humor", "spectacle", "emotional_intensity", "tenderness",
    "narrative_complexity",
)


def normalize_enrichment_request(payload: object) -> list[dict[str, Any]]:
    """Normalize the unchanged v4 ``/recommendations/enrich`` request."""
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
        content_type = _clean_text(raw.get("type"), 16, lower=True)
        content_id = _clean_text(raw.get("id"), 160, lower=True)
        title = _clean_text(raw.get("title"), 160)
        if content_type not in _TYPES or not content_id or not title:
            raise ValueError("every item requires a known type, stable id, and title")
        key = f"{content_type}:{content_id}"
        if key in seen:
            raise ValueError("duplicate item identity")
        seen.add(key)
        output.append({
            "type": content_type,
            "id": content_id,
            "title": title,
            "year": _clean_text(raw.get("year"), 12) or None,
            "hints": _clean_list(raw.get("hints"), 16, 40),
        })
    return output


def _legacy_tags(value: object, limit: int) -> list[str]:
    return _clean_list(value, limit, 40)


def normalize_enrichment_response(
    payload: dict[str, Any],
    requested: list[dict[str, Any]],
    settings: OrchestratorSettings,
) -> list[dict[str, Any]]:
    """Validate the unchanged partial v4 feature shape separately from v1."""
    raw_items = payload.get("items")
    if not isinstance(raw_items, list):
        raise ValueError("enrichment returned no items array")
    requested_by_key = {f"{item['type']}:{item['id']}": item for item in requested}
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        content_type = _clean_text(raw.get("type"), 16, lower=True)
        content_id = _clean_text(raw.get("id"), 160, lower=True)
        key = f"{content_type}:{content_id}"
        source = requested_by_key.get(key)
        if source is None or key in seen:
            continue
        try:
            pace = _clean_text(raw.get("pace"), 16, lower=True)
            if pace not in _LEGACY_PACES:
                raise ValueError("invalid pace")
            numeric = {field: _unit(raw.get(field), field) for field in _LEGACY_NUMERIC_FIELDS}
            document = {
                "type": content_type,
                "id": content_id,
                "model_version": settings.llm_model,
                "prompt_version": LEGACY_PROMPT_VERSION,
                "input_hash": _canonical_hash(source),
                "themes": _legacy_tags(raw.get("themes"), 12),
                "tone": _legacy_tags(raw.get("tone"), 8),
                "pace": pace,
                **numeric,
            }
        except (TypeError, ValueError):
            continue
        output.append(document)
        seen.add(key)
    if not output:
        raise ValueError("enrichment returned no valid requested stable ids")
    return output


def enrich_recommendation_items(
    payload: object,
    settings: OrchestratorSettings,
) -> list[dict[str, Any]]:
    """Existing v4 handler retained until its one-release rollback window ends."""
    requested = normalize_enrichment_request(payload)
    reply = generate_reply(
        [{"role": "user", "content": json.dumps({"items": requested}, ensure_ascii=False)}],
        settings,
        system_prompt=RECOMMENDATION_ENRICH_SYSTEM_PROMPT,
        max_tokens=min(8192, max(768, len(requested) * 250)),
    )
    return normalize_enrichment_response(extract_json_payload(reply), requested, settings)
