"""Load mango librarian persona + tool policy for the voice agent."""

from __future__ import annotations

import os
from pathlib import Path

_TOOL_POLICY = (
    "CONVERSATION-FIRST (binding): "
    "DISCOVER — vague recs ('good Hindi movies', 'kuch light de') → chat or one clarifying question; "
    "do NOT search with the user's full question as query; do NOT open TV on turn 1. "
    "OPEN — clear title + open/kholo → mango_search with normalized title → mango_open_title only if one clear match. "
    "After listing options → open only on ordinal/follow-up or explicit title name — never auto-pick. "
    "Ambiguous search (2+ close matches) → list 2–4 and ask; do NOT open. "
    "MEMORY — 'what do you know about me?' → summarize taste; never dump raw yaml. "
    "NEVER start playback — user presses B. "
    "Only claim a title opened if mango_open_title returned ok:true with tv_seq."
)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[5]


def _persona_paths() -> list[Path]:
    paths: list[Path] = []
    env_dir = os.environ.get("MANGO_COMPANION_DIR", "").strip()
    if env_dir:
        paths.append(Path(env_dir) / "persona.md")
    paths.append(Path("/etc/mango/companion/persona.md"))
    paths.append(_repo_root() / "config" / "companion.example" / "persona.md")
    return paths


def load_persona_excerpt() -> str:
    for path in _persona_paths():
        if path.is_file():
            text = path.read_text(encoding="utf-8").strip()
            if text:
                return text
    return (
        "You are mango's TV librarian — warm, film-literate couch friend. "
        "Mirror the user's Hinglish, Hindi, or English. "
        "Short replies for navigation; longer when discussing films they ask about."
    )


def build_system_prompt() -> str:
    return f"{load_persona_excerpt()}\n\n{_TOOL_POLICY}"
