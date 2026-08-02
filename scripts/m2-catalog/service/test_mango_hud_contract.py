#!/usr/bin/env python3
"""Deterministic source contract for the production mpv/libass HUD."""

from __future__ import annotations

from pathlib import Path
import unittest


HUD = Path(__file__).with_name("mango-hud.lua").read_text(encoding="utf-8")


class MangoHudContractTest(unittest.TestCase):
    def test_cinematic_safe_area_geometry_and_type_scale(self) -> None:
        self.assertIn("HUD_X, HUD_Y, HUD_W, HUD_H = 192, 744, 1536, 272", HUD)
        self.assertIn("DRAWER_Y, DRAWER_H = 454, 626", HUD)
        self.assertIn('C_AMBER = "&H0020A0E8&"', HUD)
        self.assertIn(" 42, C_WHITE, headline", HUD)
        self.assertIn(" 28, C_MUTED, contextual_hints()", HUD)

    def test_title_unicode_action_and_adaptive_timeout_contracts(self) -> None:
        self.assertIn("local function utf8_prefix", HUD)
        self.assertIn('reason:match("^seek:([+-]?%d+)$")', HUD)
        self.assertIn('return "Subtitles · " .. utf8_prefix(label, 42), LONG_SEC', HUD)
        self.assertIn('return "Audio · " .. utf8_prefix', HUD)
        self.assertIn("local LONG_SEC = 6.0", HUD)
        self.assertIn('or "4.0"', HUD)

    def test_pause_buffering_live_and_clean_start_contracts(self) -> None:
        self.assertIn('overlay_mode = "hidden"', HUD)
        self.assertIn('overlay_mode = "pause_badge"', HUD)
        self.assertIn('"{\\\\fad(180,0)"', HUD)
        self.assertIn('mp.observe_property("paused-for-cache"', HUD)
        self.assertIn("mp.add_timeout(1.0", HUD)
        self.assertIn('PLAYBACK_KIND == "tv"', HUD)
        self.assertIn('PLAYBACK_KIND ~= "youtube_video"', HUD)
        self.assertIn('build_badge_ass("Buffering…"', HUD)

    def test_drawer_readiness_focus_and_failure_contracts(self) -> None:
        self.assertIn('return "Ready now"', HUD)
        self.assertIn('return "May take longer"', HUD)
        self.assertIn('return "Unavailable"', HUD)
        self.assertIn('"May stutter on this device"', HUD)
        self.assertIn("local function initial_stream_focus", HUD)
        self.assertIn("selected.unavailable == true", HUD)
        self.assertNotIn("Try smoother source", HUD)
        self.assertNotIn("FINAL FALLBACK", HUD)

    def test_switch_confirmation_and_contextual_undo_are_revisioned(self) -> None:
        self.assertIn("switch_undo_candidate_id", HUD)
        self.assertIn("switch_confirmed_at", HUD)
        self.assertIn("revision = state.revision", HUD)
        self.assertIn("undo = true", HUD)
        self.assertIn("or request_pending then return", HUD)


if __name__ == "__main__":
    unittest.main()
