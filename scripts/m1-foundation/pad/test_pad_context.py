#!/usr/bin/env python3

from __future__ import annotations

import unittest

from pad_context import contextual_secondary_surface, secondary_press_kind


class PadContextTest(unittest.TestCase):
    def test_visible_launcher_owns_x_over_lingering_playback(self) -> None:
        self.assertEqual(contextual_secondary_surface("launcher", True), "launcher")

    def test_visible_or_deferred_playback_owns_x(self) -> None:
        self.assertEqual(contextual_secondary_surface("mpv", True), "mpv")
        self.assertEqual(contextual_secondary_surface("other", True), "mpv")

    def test_unowned_x_stays_unowned(self) -> None:
        self.assertEqual(contextual_secondary_surface("other", False), "other")

    def test_tap_and_hold_boundary(self) -> None:
        self.assertEqual(secondary_press_kind(10.0, 10.59, 0.6), "tap")
        self.assertEqual(secondary_press_kind(10.0, 10.6, 0.6), "hold")


if __name__ == "__main__":
    unittest.main()
