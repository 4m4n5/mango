from __future__ import annotations

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from orchestrator.config import load_settings
from orchestrator.main import search_expand
from orchestrator.search_expand import (
    SEARCH_EXPAND_SYSTEM_PROMPT,
    expand_search_query,
    normalize_expansion_payload,
)


class _Request:
    def __init__(self, host: str, payload: object) -> None:
        self.client = SimpleNamespace(host=host)
        self._payload = payload

    async def json(self) -> object:
        return self._payload


class SearchExpandTests(unittest.TestCase):
    def test_normalize_caps_queries_types_and_deduplicates(self) -> None:
        payload = normalize_expansion_payload(
            {
                "interpreted_query": "warm family comedy",
                "queries": ["Hindi family comedy", "hindi family comedy", "feel good movies", "third", "fourth"],
                "content_types": ["movie", "series", "invalid", "youtube_video"],
            }
        )
        self.assertEqual(
            payload["queries"],
            ["Hindi family comedy", "feel good movies", "third"],
        )
        self.assertEqual(payload["content_types"], ["movie", "series", "youtube_video"])

    def test_expand_uses_one_no_tools_no_history_prompt(self) -> None:
        settings = load_settings()
        reply = json.dumps(
            {
                "interpreted_query": "funny Hindi family videos",
                "queries": ["Hindi family comedy", "clean Hindi comedy videos"],
                "content_types": ["movie", "youtube_video"],
            }
        )
        with patch("orchestrator.search_expand.generate_reply", return_value=reply) as generate:
            result = expand_search_query(
                "kuch funny family ke saath",
                "all",
                settings,
            )
        self.assertEqual(result["queries"][0], "Hindi family comedy")
        messages, passed_settings = generate.call_args.args
        self.assertIs(passed_settings, settings)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["role"], "user")
        self.assertEqual(generate.call_args.kwargs["system_prompt"], SEARCH_EXPAND_SYSTEM_PROMPT)
        self.assertEqual(generate.call_args.kwargs["max_tokens"], 128)

    def test_malformed_or_empty_output_fails_closed(self) -> None:
        settings = load_settings()
        with patch("orchestrator.search_expand.generate_reply", return_value="not json"):
            with self.assertRaises(ValueError):
                expand_search_query("something funny", "all", settings)
        with self.assertRaises(ValueError):
            normalize_expansion_payload({"queries": []})


class SearchExpandRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_route_is_localhost_only(self) -> None:
        response = await search_expand(_Request("10.0.0.20", {"query": "dune"}))  # type: ignore[arg-type]
        self.assertEqual(response.status_code, 403)

    async def test_route_returns_validated_expansion(self) -> None:
        expanded = {
            "interpreted_query": "Dune",
            "queries": ["Dune"],
            "content_types": ["movie"],
        }
        with patch("orchestrator.main.expand_search_query", return_value=expanded):
            response = await search_expand(
                _Request("127.0.0.1", {"query": "Dune", "scope": "movies"})  # type: ignore[arg-type]
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.body)["queries"], ["Dune"])

    async def test_route_has_a_hard_timeout(self) -> None:
        async def timeout(awaitable: object, **_kwargs: object) -> object:
            close = getattr(awaitable, "close", None)
            if callable(close):
                close()
            raise asyncio.TimeoutError

        with patch("orchestrator.main.asyncio.wait_for", new=timeout):
            response = await search_expand(
                _Request("127.0.0.1", {"query": "Dune", "scope": "all"})  # type: ignore[arg-type]
            )
        self.assertEqual(response.status_code, 504)


if __name__ == "__main__":
    unittest.main()
