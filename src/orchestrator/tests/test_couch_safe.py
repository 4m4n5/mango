"""Tests for couch-safe orchestrator error messages."""

from __future__ import annotations

import unittest

from orchestrator.couch_safe import couch_safe_error_message


class CouchSafeErrorTests(unittest.TestCase):
    def test_safe_exact_messages_pass_through(self) -> None:
        self.assertEqual(couch_safe_error_message("voice is busy"), "voice is busy")
        self.assertEqual(couch_safe_error_message("text is too long"), "text is too long")

    def test_upstream_secrets_scrubbed(self) -> None:
        self.assertEqual(
            couch_safe_error_message("Anthropic API error 401 invalid x-api-key"),
            "Something went wrong — try again in a moment.",
        )
        self.assertEqual(
            couch_safe_error_message("Deepgram rate limit 429"),
            "Something went wrong — try again in a moment.",
        )

    def test_llm_empty_reply_user_friendly(self) -> None:
        self.assertEqual(
            couch_safe_error_message("LLM returned an empty reply"),
            "Mango didn't have a reply — try again.",
        )

    def test_generic_exception_scrubbed(self) -> None:
        raw = 'HTTP 502 Bad Gateway from catalog-service'
        self.assertEqual(
            couch_safe_error_message(raw),
            "Something went wrong — try again in a moment.",
        )


if __name__ == "__main__":
    unittest.main()
