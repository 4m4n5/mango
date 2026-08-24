#!/usr/bin/env python3

from __future__ import annotations

import unittest

from playability_refresh_decision import staged_receipt_publishable


class StagedPublishDecisionTests(unittest.TestCase):
    def test_successful_grow_survives_an_unrelated_stale_failure(self) -> None:
        # The nightly aggregate rc is 1 because phase 1 failed; the grow phase
        # itself exited 0, so its +N verified corpus must publish.
        self.assertTrue(staged_receipt_publishable({
            "ok": True,
            "mode": "grow",
            "all_rails_publishable": True,
            "best_effort_publish": True,
            "maintenance_rc": 1,
        }, 0))

    def test_publish_does_not_require_the_best_effort_stage_heartbeat(self) -> None:
        # extract_refresh_json falls back to "completion_report" when
        # grow-run-state.json is missing. That must not discard a good grow.
        self.assertTrue(staged_receipt_publishable({
            "ok": True,
            "mode": "grow",
            "stage": "completion_report",
            "all_rails_publishable": True,
        }, 0))

    def test_couch_deferred_nightly_still_publishes_its_stale_phase_work(self) -> None:
        # Staging happens before phase 1, so a deferred grow leaves real stale
        # refresh work in the work DB. Discarding it would lose that pass.
        self.assertTrue(staged_receipt_publishable({
            "ok": True,
            "mode": "stale",
            "stage": "completion_report",
        }, 0))

    def test_failed_phase_or_unpublishable_grow_never_publishes(self) -> None:
        self.assertFalse(staged_receipt_publishable({
            "ok": True,
            "mode": "grow",
            "all_rails_publishable": True,
        }, 1))
        self.assertFalse(staged_receipt_publishable({
            "ok": False,
            "mode": "grow",
            "all_rails_publishable": True,
        }, 0))
        self.assertFalse(staged_receipt_publishable({
            "ok": True,
            "mode": "grow",
            "all_rails_publishable": False,
        }, 0))
        self.assertFalse(staged_receipt_publishable({
            "ok": False,
            "mode": "stale",
            "failure_category": "catalog_boot_failed",
        }, 0))

    def test_malformed_receipt_never_publishes(self) -> None:
        self.assertFalse(staged_receipt_publishable("invalid", 0))
        self.assertFalse(staged_receipt_publishable({}, 0))


if __name__ == "__main__":
    unittest.main()
