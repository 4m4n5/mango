from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from orchestrator.config import load_settings
from orchestrator.recommendation_enrich import (
    MAX_ITEMS,
    RECOMMENDATION_ENRICH_SYSTEM_PROMPT,
    enrich_recommendation_items,
    normalize_enrichment_request,
)


class RecommendationEnrichTests(unittest.TestCase):
    def test_request_is_bounded_sanitized_and_stable_id_only(self) -> None:
        items = normalize_enrichment_request({"items": [{
            "type": "Movie",
            "id": "TT1",
            "title": "  A   Film  ",
            "year": 2025,
            "hints": ["Comedy", "comedy", "warm"],
            "url": "https://must-not-pass.test",
        }]})
        self.assertEqual(items, [{
            "type": "movie", "id": "tt1", "title": "A Film", "year": "2025",
            "hints": ["comedy", "warm"],
        }])
        with self.assertRaises(ValueError):
            normalize_enrichment_request({"items": []})
        with self.assertRaises(ValueError):
            normalize_enrichment_request({"items": [items[0]] * (MAX_ITEMS + 1)})

    def test_cloud_output_is_bounded_and_provenanced(self) -> None:
        settings = load_settings()
        response = {"items": [{
            "type": "movie", "id": "tt1", "themes": ["Friendship"],
            "tone": ["Hopeful"], "pace": "moderate", "tension": 0.2,
            "humor": 0.4, "spectacle": 0.3, "emotional_intensity": 0.8,
            "tenderness": 0.9, "narrative_complexity": 0.5,
        }]}
        with patch(
            "orchestrator.recommendation_enrich.generate_reply",
            return_value=json.dumps(response),
        ) as generate:
            items = enrich_recommendation_items(
                {"items": [{"type": "movie", "id": "tt1", "title": "A Film"}]},
                settings,
            )
        self.assertEqual(items[0]["themes"], ["friendship"])
        self.assertEqual(len(items[0]["input_hash"]), 64)
        self.assertEqual(items[0]["model_version"], settings.llm_model)
        self.assertEqual(generate.call_args.kwargs["system_prompt"], RECOMMENDATION_ENRICH_SYSTEM_PROMPT)

    def test_invented_or_missing_ids_fail_closed(self) -> None:
        settings = load_settings()
        bad = {"items": [{
            "type": "movie", "id": "invented", "themes": ["drama"], "tone": ["dark"],
            "pace": "slow", "tension": 0.5, "humor": 0, "spectacle": 0,
            "emotional_intensity": 0.5, "tenderness": 0.2, "narrative_complexity": 0.8,
        }]}
        with patch("orchestrator.recommendation_enrich.generate_reply", return_value=json.dumps(bad)):
            with self.assertRaisesRegex(ValueError, "no valid requested stable ids"):
                enrich_recommendation_items(
                    {"items": [{"type": "movie", "id": "tt1", "title": "A Film"}]}, settings,
                )

    def test_one_bad_member_does_not_discard_a_valid_sibling(self) -> None:
        settings = load_settings()
        response = {"items": [
            {
                "type": "movie", "id": "tt1", "themes": ["Friendship"],
                "tone": ["Hopeful"], "pace": "moderate", "tension": 0.2,
                "humor": 0.4, "spectacle": 0.3, "emotional_intensity": 0.8,
                "tenderness": 0.9, "narrative_complexity": 0.5,
            },
            {"type": "movie", "id": "invented", "themes": ["ignore me"]},
        ]}
        with patch(
            "orchestrator.recommendation_enrich.generate_reply",
            return_value=json.dumps(response),
        ):
            items = enrich_recommendation_items({"items": [
                {"type": "movie", "id": "tt1", "title": "A Film"},
                {"type": "movie", "id": "tt2", "title": "Another Film"},
            ]}, settings)
        self.assertEqual([item["id"] for item in items], ["tt1"])


if __name__ == "__main__":
    unittest.main()
