"""M5.5a companion couch corpus — mock-path validation (no LLM API)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from orchestrator.llm.open_intent import (
    is_discover_request,
    user_wants_open_detail,
    user_wants_title_navigation,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES = REPO_ROOT / "scripts" / "m5-voice" / "ai" / "fixtures"


def _load_corpus(name: str) -> list[dict[str, object]]:
    path = FIXTURES / name
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    assert isinstance(data, list)
    return data


class CompanionCorpusTests(unittest.TestCase):
    def test_fixtures_exist(self) -> None:
        for name in ("companion-corpus-en.json", "companion-corpus-hinglish.json"):
            path = FIXTURES / name
            self.assertTrue(path.is_file(), f"missing fixture: {path}")

    def test_en_discover_cases(self) -> None:
        for row in _load_corpus("companion-corpus-en.json"):
            if row.get("expect") != "discover":
                continue
            utterance = str(row["utterance"])
            self.assertTrue(
                is_discover_request(utterance),
                f"{row['id']}: expected discover intent",
            )
            self.assertFalse(
                user_wants_title_navigation(utterance),
                f"{row['id']}: discover must not trigger navigation",
            )

    def test_en_open_cases(self) -> None:
        for row in _load_corpus("companion-corpus-en.json"):
            if row.get("expect") != "open":
                continue
            utterance = str(row["utterance"])
            self.assertTrue(
                user_wants_open_detail(utterance) or user_wants_title_navigation(utterance),
                f"{row['id']}: expected open intent",
            )

    def test_hinglish_open_and_discover(self) -> None:
        for row in _load_corpus("companion-corpus-hinglish.json"):
            utterance = str(row["utterance"])
            expect = row.get("expect")
            if expect == "discover":
                self.assertTrue(is_discover_request(utterance), row["id"])
            elif expect == "open":
                self.assertTrue(
                    user_wants_open_detail(utterance) or user_wants_title_navigation(utterance),
                    row["id"],
                )

    def test_navigate_corpus_has_youtube_tab(self) -> None:
        rows = [
            row
            for row in _load_corpus("companion-corpus-en.json")
            if row.get("expect") == "navigate" and row.get("tab") == "youtube"
        ]
        self.assertGreaterEqual(len(rows), 1)
        self.assertEqual(rows[0].get("tool"), "mango_navigate")

    def test_en_live_open_cases(self) -> None:
        rows = [
            row
            for row in _load_corpus("companion-corpus-en.json")
            if row.get("expect") == "open" and row.get("tab") == "live"
        ]
        self.assertGreaterEqual(len(rows), 1)
        for row in rows:
            utterance = str(row["utterance"])
            self.assertTrue(
                user_wants_open_detail(utterance) or user_wants_title_navigation(utterance),
                f"{row['id']}: expected live open intent",
            )


class NavigateToolSchemaTests(unittest.TestCase):
    def test_mango_navigate_includes_youtube_tab(self) -> None:
        tools_path = REPO_ROOT / "src" / "catalog-service" / "src" / "voice" / "tools.ts"
        text = tools_path.read_text(encoding="utf-8")
        self.assertIn("name: 'mango_navigate'", text)
        chunk = text.split("name: 'mango_navigate'", 1)[1].split("required: ['action']", 1)[0]
        self.assertIn("'youtube'", chunk)


if __name__ == "__main__":
    unittest.main()
