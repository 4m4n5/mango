from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from orchestrator.config import load_settings
from orchestrator.recommendation_enrich import (
    MAX_ITEMS,
    RECOMMENDATION_ENRICH_SYSTEM_PROMPT,
    STORY_DNA_ONTOLOGY_VERSION,
    STORY_DNA_PROMPT_VERSION,
    STORY_DNA_SCHEMA_VERSION,
    STORY_DNA_SYSTEM_PROMPT,
    _canonical_hash,
    _evidence_envelope,
    _evidence_fields,
    enrich_recommendation_items,
    enrich_story_dna_items,
    normalize_enrichment_request,
    normalize_story_dna_request,
)


def complete_story_dna_item(content_id: str = "TT1") -> dict[str, object]:
    return {
        "type": "movie",
        "id": content_id,
        "genre_subgenres": ["drama"],
        "format": "feature-film",
        "story_engines": ["friendship"],
        "themes": ["belonging", "friendship"],
        "character_dynamics": ["found-family"],
        "tone": ["warm", "hopeful"],
        "setting_era": "contemporary",
        "geographic_scope": "city",
        "social_settings": ["urban-community"],
        "narrative_structures": ["linear"],
        "ending_emotional_arc": "uplifting",
        "facets": {
            "pace": 2,
            "action": 1,
            "tension": 1,
            "spectacle": 0,
            "humor": 2,
            "romance": 0,
            "fear": 0,
            "tenderness": 4,
            "sadness": 2,
            "hope": 4,
            "realism": 3,
            "narrative_complexity": 2,
            "moral_ambiguity": 1,
            "violence": 0,
            "family_accessibility": 4,
        },
        "confidence": {
            "overall": 0.8,
            "genre_subgenre": 0.9,
            "format": 1.0,
            "story_engine": 0.8,
            "themes": 0.8,
            "character_dynamics": 0.8,
            "tone": 0.8,
            "setting_era": 0.7,
            "geographic_scope": 0.7,
            "social_setting": 0.7,
            "narrative_structure": 0.8,
            "ending_emotional_arc": 0.7,
            "facets": 0.8,
        },
    }


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


class StoryDnaTeacherTests(unittest.TestCase):
    def test_typescript_hash_contract_includes_canonical_field_provenance(self) -> None:
        item = normalize_story_dna_request({"items": [{
            "type": "movie",
            "id": "TT-HASH",
            "title": "Hash Title",
            "year": 2024,
            "synopsis": "A canonical synopsis.",
            "genres": ["Drama"],
            "keywords": ["Family"],
            "source": "Addon",
            "retrieved_at": 123,
            "field_provenance": {
                "Synopsis": ["TMDB", "tmdb"],
                "Genres": ["Addon:Catalog"],
            },
        }]})[0]
        self.assertEqual(item["evidence"]["field_provenance"], {
            "genres": ["addon:catalog"],
            "synopsis": ["tmdb"],
        })
        self.assertEqual(
            _canonical_hash(item),
            "c339101723086daa581040858c97d1cb0bb0ff428e61b314c6a03f9db8b92a4b",
        )
        self.assertEqual(
            _canonical_hash(_evidence_envelope(item)),
            "cd172aba5767b6fe8f70a5fff82719a85bf9ee34f10870bbf6ea495f3a4e7ab8",
        )
        self.assertEqual(_evidence_fields(item), [
            "title", "year", "synopsis", "genres", "keywords", "source",
            "retrieved-at", "field-provenance",
        ])

    def test_teacher_requires_strongest_first_categorical_order(self) -> None:
        self.assertIn("order them from strongest to weakest", STORY_DNA_SYSTEM_PROMPT)
        self.assertIn("reciprocal per-value intensity policy", STORY_DNA_SYSTEM_PROMPT)

    def test_rich_content_request_is_private_canonical_and_needs_no_lookup(self) -> None:
        synopsis = "A grounded friendship story in Mumbai. " * 5
        items = normalize_story_dna_request({"items": [{
            "type": "Movie",
            "id": "TT1",
            "title": "  A   Film  ",
            "year": 2025,
            "evidence": {
                "synopsis": synopsis,
                "genres": ["Drama"],
                "languages": ["Hindi"],
                "countries": ["India"],
                "directors": ["A Director"],
                "external_ids": {"imdb": "tt0000001"},
                "sources": ["Addon"],
            },
            "profile_id": "must-not-pass",
            "mood": "cozy",
            "taste_tags": ["household-secret"],
            "watch_history": ["TT2"],
            "url": "https://must-not-pass.test",
        }]})
        self.assertEqual(items[0]["id"], "TT1")
        self.assertEqual(items[0]["evidence"]["genres"], ["drama"])
        self.assertEqual(items[0]["selective_lookup"], {
            "requested": False, "reasons": [], "policy": "structured-only", "used": False,
        })
        serialized = json.dumps(items)
        for forbidden in ("profile_id", "mood", "taste_tags", "watch_history", "url", "household-secret"):
            self.assertNotIn(forbidden, serialized)

    def test_sparse_evidence_marks_only_bounded_structured_lookup(self) -> None:
        item = normalize_story_dna_request({"items": [{
            "type": "movie", "id": "TT1", "title": "A Film",
        }]})[0]
        self.assertEqual(item["selective_lookup"], {
            "requested": True,
            "reasons": [
                "identity-ambiguity", "short-synopsis", "missing-genres",
                "sparse-catalog-evidence",
            ],
            "policy": "structured-only",
            "used": False,
        })

    def test_caller_performed_structured_lookup_is_preserved(self) -> None:
        item = normalize_story_dna_request({"items": [{
            "type": "movie", "id": "TT1", "title": "A Film", "year": "2025",
            "synopsis": "Structured provider evidence. " * 8,
            "genres": ["drama"],
            "countries": ["India"],
            "selective_lookup": {
                "reasons": ["short-synopsis"], "used": True,
            },
        }]})[0]
        self.assertEqual(item["selective_lookup"], {
            "requested": True,
            "reasons": ["short-synopsis"],
            "policy": "structured-only",
            "used": True,
        })

    def test_complete_document_is_id_bound_versioned_and_provenanced(self) -> None:
        settings = load_settings()
        response = {"items": [complete_story_dna_item()]}
        request = {"items": [{
            "type": "movie",
            "id": "TT1",
            "title": "A Film",
            "year": "2025",
            "synopsis": "A grounded friendship story in Mumbai. " * 5,
            "genres": ["drama"],
            "languages": ["hindi"],
            "countries": ["india"],
            "source": "addon",
        }]}
        with patch(
            "orchestrator.recommendation_enrich.generate_reply",
            return_value=json.dumps(response),
        ) as generate:
            items = enrich_story_dna_items(request, settings)
        document = items[0]
        self.assertEqual(document["schema_version"], STORY_DNA_SCHEMA_VERSION)
        self.assertEqual(document["ontology_version"], STORY_DNA_ONTOLOGY_VERSION)
        self.assertEqual(document["prompt_version"], STORY_DNA_PROMPT_VERSION)
        self.assertEqual(document["teacher_role"], "content-only")
        self.assertEqual(len(document["input_hash"]), 64)
        self.assertEqual(len(document["provenance"]["evidence_hash"]), 64)
        self.assertTrue(document["provenance"]["content_only"])
        self.assertNotIn("novel_tags", document)
        self.assertEqual(generate.call_args.kwargs["system_prompt"], STORY_DNA_SYSTEM_PROMPT)
        user_payload = generate.call_args.args[0][0]["content"]
        self.assertNotIn("taste_tags", user_payload)

    def test_partial_extra_or_case_mismatched_documents_fail_closed(self) -> None:
        settings = load_settings()
        partial = complete_story_dna_item()
        del partial["facets"]
        extra = complete_story_dna_item("TT2")
        extra["novel_tags"] = ["invented"]
        wrong_case = complete_story_dna_item("tt3")
        with patch(
            "orchestrator.recommendation_enrich.generate_reply",
            return_value=json.dumps({"items": [partial, extra, wrong_case]}),
        ):
            with self.assertRaisesRegex(ValueError, "no valid requested stable ids"):
                enrich_story_dna_items({"items": [
                    {"type": "movie", "id": "TT1", "title": "One"},
                    {"type": "movie", "id": "TT2", "title": "Two"},
                    {"type": "movie", "id": "TT3", "title": "Three"},
                ]}, settings)

    def test_invalid_sibling_does_not_poison_complete_sibling(self) -> None:
        settings = load_settings()
        valid = complete_story_dna_item()
        invalid = complete_story_dna_item("TT2")
        invalid["genre_subgenres"] = ["invented-free-form-tag"]
        with patch(
            "orchestrator.recommendation_enrich.generate_reply",
            return_value=json.dumps({"items": [valid, invalid]}),
        ):
            items = enrich_story_dna_items({"items": [
                {"type": "movie", "id": "TT1", "title": "One"},
                {"type": "movie", "id": "TT2", "title": "Two"},
            ]}, settings)
        self.assertEqual([item["id"] for item in items], ["TT1"])

    def test_none_and_zero_are_the_only_supported_absence_forms(self) -> None:
        settings = load_settings()
        item = complete_story_dna_item()
        item["genre_subgenres"] = ["none"]
        item["story_engines"] = ["none"]
        item["themes"] = ["none"]
        item["character_dynamics"] = ["none"]
        item["tone"] = ["none"]
        item["social_settings"] = ["none"]
        item["narrative_structures"] = ["none"]
        item["format"] = "none"
        item["setting_era"] = "none"
        item["geographic_scope"] = "none"
        item["ending_emotional_arc"] = "none"
        item["facets"] = {key: 0 for key in item["facets"]}
        with patch(
            "orchestrator.recommendation_enrich.generate_reply",
            return_value=json.dumps({"items": [item]}),
        ):
            documents = enrich_story_dna_items({"items": [{
                "type": "movie", "id": "TT1", "title": "Unknown Film",
            }]}, settings)
        self.assertEqual(documents[0]["genre_subgenres"], ["none"])
        self.assertEqual(set(documents[0]["facets"].values()), {0})


if __name__ == "__main__":
    unittest.main()
