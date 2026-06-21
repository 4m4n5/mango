"""N5c conversation policy — discover vs open intent and open guard."""

from __future__ import annotations

import unittest

from orchestrator.llm.agent import open_title_block_reason
from orchestrator.llm.open_intent import (
    is_discover_request,
    user_wants_open_detail,
    user_wants_title_navigation,
)
from orchestrator.llm.persona import build_system_prompt, load_persona_excerpt
from orchestrator.session import VoiceBrowseContext


class DiscoverIntentTests(unittest.TestCase):
    def test_good_hindi_movies_not_navigation(self) -> None:
        self.assertTrue(is_discover_request("good hindi movies"))
        self.assertFalse(user_wants_title_navigation("good hindi movies"))

    def test_question_discover(self) -> None:
        self.assertTrue(is_discover_request("what are some good hindi movies"))
        self.assertFalse(user_wants_title_navigation("what are some good hindi movies"))

    def test_clear_open_still_navigation(self) -> None:
        self.assertFalse(is_discover_request("Toy Story kholo"))
        self.assertTrue(user_wants_open_detail("Toy Story kholo"))
        self.assertTrue(user_wants_title_navigation("Toy Story kholo"))

    def test_bare_title_still_navigation(self) -> None:
        self.assertFalse(is_discover_request("toy story"))
        self.assertTrue(user_wants_title_navigation("toy story"))

    def test_kuch_light_discover(self) -> None:
        self.assertTrue(is_discover_request("kuch light de"))
        self.assertFalse(user_wants_title_navigation("kuch light de"))


class OpenGuardTests(unittest.TestCase):
    ambiguous_hits = [
        {"type": "movie", "id": "tt0114709", "title": "Toy Story", "score": 90},
        {"type": "movie", "id": "tt0120363", "title": "Toy Story 2", "score": 88},
    ]

    def test_discover_blocks_open(self) -> None:
        browse = VoiceBrowseContext(library_hits=self.ambiguous_hits)
        reason = open_title_block_reason("good hindi movies", browse)
        self.assertIsNotNone(reason)

    def test_ambiguous_search_blocks_open(self) -> None:
        hits = [
            {"type": "movie", "id": "tt1", "title": "Inception", "score": 85},
            {"type": "movie", "id": "tt2", "title": "Interstellar", "score": 83},
        ]
        browse = VoiceBrowseContext(library_hits=hits)
        reason = open_title_block_reason("sci fi epic", browse)
        self.assertIsNotNone(reason)

    def test_clear_open_with_verb_allowed(self) -> None:
        browse = VoiceBrowseContext(library_hits=self.ambiguous_hits)
        reason = open_title_block_reason("Toy Story kholo", browse)
        self.assertIsNone(reason)

    def test_ordinal_pick_allowed(self) -> None:
        browse = VoiceBrowseContext(library_hits=self.ambiguous_hits)
        reason = open_title_block_reason("doosra wala", browse)
        self.assertIsNone(reason)


class PersonaTests(unittest.TestCase):
    def test_persona_loads(self) -> None:
        excerpt = load_persona_excerpt()
        self.assertIn("librarian", excerpt.lower())

    def test_system_prompt_includes_policy(self) -> None:
        prompt = build_system_prompt()
        self.assertIn("CONVERSATION-FIRST", prompt)
        self.assertIn("DISCOVER", prompt)


if __name__ == "__main__":
    unittest.main()
