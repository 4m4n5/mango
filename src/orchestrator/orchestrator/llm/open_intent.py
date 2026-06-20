"""Detect when the user wants a title opened on TV (detail page, not playback)."""

from __future__ import annotations

import re

_OPEN_VERBS = re.compile(
    r"\b("
    r"open|kholo|khol|dikhao|dikha|dikha\s*do|dikha\s*de|show|play|chalao|chala|chala\s*do|"
    r"chalaye|chalana|lagao|laga\s*do|laga\s*de|start|dekhna|dekho|dekhe|dekhte|"
    r"pull\s*up|bring\s*up|karo|kar\s*do|kar\s*de"
    r")\b",
    re.IGNORECASE,
)
_RECOMMEND_ONLY = re.compile(
    r"\b(recommend|suggest|suggestion|kya\s+dekhu|kya\s+dekhe|what\s+should|"
    r"mood|vibe|bored|kuch\s+accha|options|list)\b",
    re.IGNORECASE,
)
_ORDINAL_PICK = re.compile(
    r"\b("
    r"first|second|third|fourth|one|two|three|four|"
    r"pehla|pehle|pehli|doosra|doosre|dusra|teesra|teesri|chautha|"
    r"option|number|#\d|wala|wali|wale"
    r")\b",
    re.IGNORECASE,
)
_SWITCH = re.compile(
    r"\b("
    r"instead|instead\s+of|uski\s+jagah|change|switch|different|next\s+one|"
    r"not\s+this|kuch\s+aur|dusra\s+title|doosra\s+title"
    r")\b",
    re.IGNORECASE,
)
_FOLLOWUP = re.compile(
    r"\b(that\s+one|this\s+one|ye\s+wala|ye\s+wali|wahi|vahi|ye\s+hi|the\s+one)\b",
    re.IGNORECASE,
)
_OPEN_VERBS_STRIP = re.compile(
    r"^\s*(?:"
    r"open|kholo|khol|dikhao|dikha(?:\s*do|\s*de)?|show|play|chalao|chala(?:\s*do)?|"
    r"chalaye|chalana|lagao|laga(?:\s*do|\s*de)?|start|dekhna|dekho|dekhe|dekhte|"
    r"pull\s*up|bring\s*up|karo|kar\s*do|kar\s*de"
    r")\s+",
    re.IGNORECASE,
)
_HINDI_SUFFIX = re.compile(
    r"\s+(?:"
    r"kholo|khol|karo|kar\s*do|kar\s*de|kar\s*dena|chalao|chala\s*do|dikhao|"
    r"dikha\s*do|dikha\s*de|laga\s*do|laga\s*de|open\s*karo|play\s*karo|"
    r"de\s*do|dedo|please|na|ji|yaar|bhai"
    r")\s*$",
    re.IGNORECASE,
)
_QUESTION = re.compile(
    r"\b(what|why|how|when|who|kya|kaise|kyun|tell\s+me\s+about|about)\b",
    re.IGNORECASE,
)
_FRANCHISE_WORDS = re.compile(
    r"\b(story|stories|part|chapter|season|episode|movie|film|series)\b",
    re.IGNORECASE,
)


def _clean_title_query(text: str) -> str:
    cleaned = text.strip(" .,!?:;")
    cleaned = _OPEN_VERBS_STRIP.sub("", cleaned).strip()
    cleaned = _HINDI_SUFFIX.sub("", cleaned).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned


def user_wants_open_detail(text: str) -> bool:
    """True when the utterance is asking to surface a specific title on TV."""
    normalized = text.strip()
    if not normalized:
        return False
    if not _OPEN_VERBS.search(normalized):
        return False
    if _RECOMMEND_ONLY.search(normalized) and not re.search(
        r"\b(open|kholo|khol|dikhao|play|chalao|show)\b",
        normalized,
        re.IGNORECASE,
    ):
        return False
    return True


def user_wants_title_navigation(text: str) -> bool:
    """Open/switch/pick intent — includes ordinals and follow-ups without 'open'."""
    normalized = text.strip()
    if not normalized:
        return False
    if user_wants_open_detail(normalized):
        return True
    if is_followup_pick_only(normalized):
        return True
    if _SWITCH.search(normalized):
        return True
    if _FOLLOWUP.search(normalized):
        return True
    if _bare_title_request(normalized):
        return True
    return False


def _bare_title_request(text: str) -> bool:
    """Short title name without an open verb — 'toy story', 'Shawshank'."""
    if _QUESTION.search(text) or _RECOMMEND_ONLY.search(text):
        return False
    if is_followup_pick_only(text):
        return False
    cleaned = _clean_title_query(text)
    if len(cleaned) < 2:
        return False
    words = cleaned.split()
    return 1 <= len(words) <= 6


def extract_title_search_query(text: str) -> str | None:
    """Strip open verbs and return a catalog search query, if any."""
    normalized = text.strip()
    if not normalized:
        return None
    stripped = _clean_title_query(normalized)
    if len(stripped) < 2:
        return None
    if _RECOMMEND_ONLY.search(stripped) and not _OPEN_VERBS.search(normalized):
        return None
    return stripped


def is_followup_pick_only(text: str) -> bool:
    """Utterance picks from a prior list — not a fresh title name."""
    normalized = text.strip()
    if not normalized:
        return False
    if _FOLLOWUP.search(normalized):
        return True
    if _SWITCH.search(normalized) and not extract_title_search_query(normalized):
        return True
    cleaned = _clean_title_query(normalized)
    if _ORDINAL_PICK.search(normalized) and len(cleaned.split()) <= 3:
        if not _FRANCHISE_WORDS.search(normalized):
            return True
    return False


def utterance_is_title_pick_only(text: str) -> bool:
    """Bare title name or list pick — not a recommendation question."""
    normalized = text.strip()
    if not normalized or _QUESTION.search(normalized):
        return False
    if user_wants_title_navigation(normalized):
        return True
    if _RECOMMEND_ONLY.search(normalized):
        return False
    return len(normalized.split()) <= 6
