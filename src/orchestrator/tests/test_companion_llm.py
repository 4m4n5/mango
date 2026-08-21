"""Tests for companion nightly LLM JSON parsing."""

from __future__ import annotations

import unittest

from orchestrator.companion_llm import ConsolidationParseError, parse_consolidation_response


class CompanionLlmParseTests(unittest.TestCase):
    def test_parse_fenced_json(self) -> None:
        payload = parse_consolidation_response(
            """Here is the update:
```json
{
  "append_facts": ["prefers light weeknight comedies"],
  "append_loves": ["hindi comedy"],
  "append_avoids": ["horror"],
  "catalog_hints": [
    {"slot_id": "cozy-nights", "topup_suggestion": "Add warm hindi comedies", "add_ids": ["tt1"]}
  ],
  "compiled_notes_addendum": "User likes cozy hindi films."
}
```"""
        )
        self.assertIn("append_loves", payload)
        self.assertEqual(payload["append_loves"], ["hindi comedy"])
        self.assertEqual(len(payload["catalog_hints"]), 1)

    def test_rejects_empty(self) -> None:
        with self.assertRaises(ConsolidationParseError):
            parse_consolidation_response("")


if __name__ == "__main__":
    unittest.main()
