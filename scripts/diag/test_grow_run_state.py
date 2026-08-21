#!/usr/bin/env python3
"""Tests for grow_run_state.py."""

from __future__ import annotations

import os
import tempfile
import unittest

import grow_run_state


class GrowRunStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._previous_cache = os.environ.get("XDG_CACHE_HOME")
        self._previous_run_id = os.environ.get("MANGO_OPS_RUN_ID")
        self._previous_grow_per_pass = os.environ.get("MANGO_GROW_PER_PASS")
        self._tmp = tempfile.TemporaryDirectory()
        os.environ["XDG_CACHE_HOME"] = self._tmp.name

    def tearDown(self) -> None:
        self._tmp.cleanup()
        if self._previous_cache is None:
            os.environ.pop("XDG_CACHE_HOME", None)
        else:
            os.environ["XDG_CACHE_HOME"] = self._previous_cache
        if self._previous_run_id is None:
            os.environ.pop("MANGO_OPS_RUN_ID", None)
        else:
            os.environ["MANGO_OPS_RUN_ID"] = self._previous_run_id
        if self._previous_grow_per_pass is None:
            os.environ.pop("MANGO_GROW_PER_PASS", None)
        else:
            os.environ["MANGO_GROW_PER_PASS"] = self._previous_grow_per_pass

    def test_preserves_benchmark_target_within_same_run(self) -> None:
        os.environ["MANGO_OPS_RUN_ID"] = "benchmark-run"
        os.environ["MANGO_GROW_PER_PASS"] = "5"
        grow_run_state.write_state("preflight", "probing sources")

        os.environ.pop("MANGO_GROW_PER_PASS", None)
        grow_run_state.write_state("grow", "grow movies-comedy")

        state = grow_run_state.read_state()
        self.assertIsNotNone(state)
        assert state is not None
        self.assertEqual(state["run_id"], "benchmark-run")
        self.assertEqual(state["grow_per_pass"], 5)

    def test_does_not_preserve_benchmark_target_across_run_ids(self) -> None:
        os.environ["MANGO_OPS_RUN_ID"] = "benchmark-run"
        os.environ["MANGO_GROW_PER_PASS"] = "5"
        grow_run_state.write_state("grow", "benchmark grow")

        os.environ["MANGO_OPS_RUN_ID"] = "production-run"
        os.environ.pop("MANGO_GROW_PER_PASS", None)
        grow_run_state.write_state("grow", "production grow", grow_target=20)

        state = grow_run_state.read_state()
        self.assertIsNotNone(state)
        assert state is not None
        self.assertEqual(state["run_id"], "production-run")
        self.assertNotIn("grow_per_pass", state)
        self.assertEqual(state["grow_target"], 20)


if __name__ == "__main__":
    unittest.main()
