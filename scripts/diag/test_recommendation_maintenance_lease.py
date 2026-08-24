#!/usr/bin/env python3

from __future__ import annotations

import unittest

from recommendation_maintenance_lease import recommendation_maintenance_active


class RecommendationMaintenanceLeaseTests(unittest.TestCase):
    def test_live_fresh_owner_is_active(self) -> None:
        self.assertTrue(recommendation_maintenance_active(
            {"pid": 42, "heartbeat_at": 90_000},
            now_ms=100_000,
            pid_alive=lambda pid: pid == 42,
        ))

    def test_dead_or_stale_owner_is_not_active(self) -> None:
        self.assertFalse(recommendation_maintenance_active(
            {"pid": 42, "heartbeat_at": 90_000},
            now_ms=100_000,
            pid_alive=lambda _pid: False,
        ))
        self.assertFalse(recommendation_maintenance_active(
            {"pid": 42, "heartbeat_at": 60_000},
            now_ms=100_001,
            pid_alive=lambda _pid: True,
        ))

    def test_malformed_lease_is_not_active(self) -> None:
        self.assertFalse(recommendation_maintenance_active({"heartbeat_at": 90_000}))
        self.assertFalse(recommendation_maintenance_active("invalid"))


if __name__ == "__main__":
    unittest.main()
