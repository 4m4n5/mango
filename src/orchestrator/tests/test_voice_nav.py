"""Tests for voice navigation intent and hit picking."""

from __future__ import annotations

import unittest

from orchestrator.llm.open_intent import (
    extract_title_search_query,
    is_followup_pick_only,
    user_wants_open_detail,
    user_wants_title_navigation,
)
from orchestrator.tools.voice_nav import pick_auto_open_hit, pick_hit_from_utterance


class OpenIntentTests(unittest.TestCase):
    def test_open_verbs(self) -> None:
        self.assertTrue(user_wants_open_detail("open Shawshank"))
        self.assertTrue(user_wants_open_detail("Shawshank kholo"))

    def test_recommend_without_open(self) -> None:
        self.assertFalse(user_wants_open_detail("kya dekhu aaj mood boring hai"))

    def test_ordinal_navigation(self) -> None:
        self.assertTrue(user_wants_title_navigation("doosra wala"))
        self.assertTrue(user_wants_title_navigation("the second one"))

    def test_extract_query(self) -> None:
        self.assertEqual(extract_title_search_query("open Shawshank"), "Shawshank")

    def test_followup_pick(self) -> None:
        self.assertTrue(is_followup_pick_only("doosra wala"))
        self.assertFalse(is_followup_pick_only("open Godfather"))

    def test_switch_phrases(self) -> None:
        self.assertTrue(user_wants_title_navigation("instead open Godfather"))
        self.assertTrue(user_wants_title_navigation("uski jagah Breaking Bad"))


class VoiceNavPickTests(unittest.TestCase):
    hits = [
        {"type": "movie", "id": "tt0111161", "title": "The Shawshank Redemption", "score": 95},
        {"type": "movie", "id": "tt0068646", "title": "The Godfather", "score": 80},
    ]

    def test_ordinal_pick(self) -> None:
        hit = pick_hit_from_utterance("doosra wala", self.hits)
        self.assertEqual(hit["id"], "tt0068646")

    def test_title_name_pick(self) -> None:
        hit = pick_hit_from_utterance("open Shawshank", self.hits)
        self.assertEqual(hit["id"], "tt0111161")

    def test_auto_open_clear_winner(self) -> None:
        hit = pick_auto_open_hit(self.hits)
        self.assertEqual(hit["id"], "tt0111161")


if __name__ == "__main__":
    unittest.main()
