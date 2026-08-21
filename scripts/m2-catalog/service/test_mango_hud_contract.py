#!/usr/bin/env python3
"""Deterministic source contract for the production mpv/libass HUD."""

from __future__ import annotations

from pathlib import Path
import unittest


HUD = Path(__file__).with_name("mango-hud.lua").read_text(encoding="utf-8")
PAD = Path(__file__).resolve().parents[2] / "m1-foundation" / "pad" / "mango-tv-pad.py"
PAD_SRC = PAD.read_text(encoding="utf-8")
MPV_PLAY = Path(__file__).with_name("mpv-play.sh").read_text(encoding="utf-8")


class MangoHudContractTest(unittest.TestCase):
    def test_floating_card_geometry_and_material(self) -> None:
        self.assertIn("HUD_X, HUD_Y, HUD_W, HUD_H = 160, 728, 1600, 292", HUD)
        self.assertIn("SHEET_X, SHEET_Y, SHEET_W, SHEET_H = 160, 228, 1600, 780", HUD)
        self.assertIn("CARD_RADIUS = 16", HUD)
        self.assertIn("CHIP_H = 64", HUD)
        self.assertIn("CHIP_MIN_W = 276", HUD)
        self.assertIn('C_ACCENT = "&H0020A0E8&"', HUD)
        self.assertIn('C_PRIMARY = "&H00EAF1F4&"', HUD)
        self.assertIn('A_CARD = "&H48&"', HUD)
        self.assertIn('C_SECONDARY = "&H00B2B2B0&"', HUD)
        self.assertIn('C_CAPTION = "&H0092918D&"', HUD)
        self.assertIn("\\\\bord1.2", HUD)
        self.assertIn("local function rounded_rect", HUD)
        self.assertIn("local function draw_control", HUD)
        self.assertIn("local function draw_legend", HUD)
        self.assertIn("One closed cubic path", HUD)
        self.assertNotIn("fill_disc", HUD)
        self.assertNotIn("local function draw_pill", HUD)
        self.assertNotIn("HUD_X, HUD_Y, HUD_W, HUD_H = 160, 744, 1600, 280", HUD)
        self.assertNotIn("HUD_X, HUD_Y, HUD_W, HUD_H = 160, 752, 1600, 252", HUD)
        self.assertNotIn("DRAWER_Y, DRAWER_H = 454, 626", HUD)

    def test_named_controls_and_complete_legend(self) -> None:
        self.assertIn('noun = "Subtitles"', HUD)
        self.assertIn('noun = "Audio"', HUD)
        self.assertIn('noun = "Quality"', HUD)
        self.assertIn("local function quality_control", HUD)
        self.assertIn("local function quality_is_active", HUD)
        self.assertIn("local function matching_chip_width", HUD)
        self.assertIn("resolution .. \" HDR\"", HUD)
        self.assertNotIn("local function picture_meta", HUD)
        self.assertNotIn("local function codec_label", HUD)
        self.assertIn('return "Off"', HUD)
        self.assertIn('label = "Skip"', HUD)
        self.assertIn('label = "Subtitles"', HUD)
        self.assertIn('label = "Audio"', HUD)
        self.assertIn('label = "Volume"', HUD)
        self.assertIn('label = "Streams"', HUD)
        self.assertIn('label = "Undo"', HUD)
        self.assertIn('key = "←→"', HUD)
        self.assertIn('key = "−+"', HUD)
        self.assertIn('tostring(hud_reason) == "subs"', HUD)
        self.assertIn('tostring(hud_reason) == "audio"', HUD)
        self.assertIn("local function identity_title", HUD)
        self.assertNotIn('return "↑  Off"', HUD)
        self.assertNotIn('return "↑  " ..', HUD)
        self.assertNotIn('return "A  " ..', HUD)
        self.assertNotIn("Subtitles ·", HUD)
        self.assertNotIn("Audio ·", HUD)
        self.assertNotIn("local function contextual_hints", HUD)
        self.assertIn("local function legend_active_label", HUD)
        self.assertIn('text_ev(6, plus_x, cy, 18, glyph_colour, "+", false)', HUD)
        self.assertIn("local LONG_SEC = 6.0", HUD)
        self.assertIn('or "4.0"', HUD)

    def test_progress_volume_and_seek_without_title_hijack(self) -> None:
        self.assertIn('reason:match("^seek:([+-]?%d+)$")', HUD)
        self.assertIn("local function volume_percent", HUD)
        self.assertIn('mp.get_property_number("volume-max")', HUD)
        self.assertIn("VOLUME_MAX_PERCENT = 100", PAD_SRC)
        self.assertIn('"volume-max"', PAD_SRC)
        self.assertIn("local function draw_volume", HUD)
        self.assertIn("VOL_TICKS = 10", HUD)
        self.assertIn("local function seek_transient", HUD)
        self.assertIn("seeking() and C_ACCENT or C_PRIMARY", HUD)
        self.assertIn("local function utf8_prefix", HUD)
        self.assertNotIn('return "Vol " .. tostring(volume)', HUD)
        self.assertNotIn("volume_transient", HUD)

    def test_overlay_can_reshow_after_hide(self) -> None:
        self.assertIn("overlay.hidden = false", HUD)
        self.assertNotIn("overlay.hidden = true", HUD)
        self.assertIn("HIDDEN_ASS", HUD)
        self.assertIn("transparent offscreen event", HUD)
        self.assertNotIn("overlay:remove()", HUD)
        self.assertNotIn('overlay.data = ""', HUD)
        self.assertIn('mp.register_script_message("mango-hud-display-ready"', HUD)
        self.assertIn("local overlay = nil", HUD)
        self.assertIn("write_visible_state(true, overlay_mode, seconds)", HUD)
        self.assertIn("is_visible and \"true\" or \"false\"", HUD)
        self.assertIn("visible_state_owned_by_other", HUD)
        self.assertIn('"instance":"%s"', HUD)
        self.assertIn('mp.observe_property("aid", "native"', HUD)
        self.assertIn('mp.observe_property("vo-configured", "bool"', HUD)
        self.assertIn("previous ~= false", HUD)

    def test_new_player_and_action_feedback_recover_stale_streams_state(self) -> None:
        self.assertIn("local function reset_streams_state", HUD)
        self.assertIn('if overlay_mode == "streams" then reset_streams_state() end', HUD)
        self.assertNotIn('if overlay_mode == "streams" then return end', HUD)
        self.assertIn("reset_playback_hud_state", MPV_PLAY)
        stop = MPV_PLAY.index('bash "$SCRIPT_DIR/mpv-stop.sh" 2>/dev/null || true')
        reset = MPV_PLAY.index("reset_playback_hud_state", stop)
        session = MPV_PLAY.index("begin_playback_session", reset)
        self.assertLess(stop, reset)
        self.assertLess(reset, session)

    def test_pause_buffering_live_and_clean_start_contracts(self) -> None:
        self.assertIn('overlay_mode = "hidden"', HUD)
        self.assertIn('overlay_mode = "pause_badge"', HUD)
        self.assertIn('"{\\\\fad(180,0)"', HUD)
        self.assertIn('mp.observe_property("paused-for-cache"', HUD)
        self.assertIn("mp.add_timeout(1.0", HUD)
        self.assertIn('PLAYBACK_KIND == "tv"', HUD)
        self.assertIn('PLAYBACK_KIND ~= "youtube_video"', HUD)
        self.assertIn('build_badge_ass("Buffering"', HUD)
        self.assertIn('build_badge_ass("Paused"', HUD)
        self.assertNotIn("Buffering…", HUD)

    def test_sheet_readiness_focus_and_failure_contracts(self) -> None:
        self.assertIn('return "Ready now"', HUD)
        self.assertIn('return "May take longer"', HUD)
        self.assertIn('return "Unavailable"', HUD)
        self.assertIn('"May stutter on this device"', HUD)
        self.assertIn("local function initial_stream_focus", HUD)
        self.assertIn("selected.unavailable == true", HUD)
        self.assertIn('text_ev(9, list_x + list_w - 20, y + 22, 20, C_ACCENT, "Now"', HUD)
        self.assertIn("A_FOCUS", HUD)
        self.assertNotIn("Try smoother source", HUD)
        self.assertNotIn("FINAL FALLBACK", HUD)
        self.assertNotIn("✓  Playing", HUD)
        self.assertNotIn("4px white", HUD)

    def test_switch_confirmation_and_contextual_undo_are_revisioned(self) -> None:
        self.assertIn("switch_undo_candidate_id", HUD)
        self.assertIn("switch_confirmed_at", HUD)
        self.assertIn("revision = state.revision", HUD)
        self.assertIn("revision = stream_state.revision", HUD)
        self.assertIn("undo = true", HUD)
        self.assertIn('or request_pending then return', HUD)
        self.assertIn('hud_reason = "confirmation"', HUD)
        self.assertNotIn("PLAYBACK_TITLE = START_CONFIRMATION", HUD)

    def test_accent_is_state_only(self) -> None:
        self.assertIn("seeking() and C_ACCENT or C_PRIMARY", HUD)
        self.assertIn('tostring(hud_reason) == "subs"', HUD)
        self.assertNotIn("C_AMBER", HUD)
        self.assertNotIn("C_CHARCOAL", HUD)

    def test_pad_trusts_lua_visible_false(self) -> None:
        self.assertIn('if payload.get("visible") is not True:', PAD_SRC)
        self.assertIn('PLAYBACK_OSD_BACKEND == "lua"', PAD_SRC)
        self.assertIn('if payload.get("mode") == "streams":', PAD_SRC)
        self.assertNotIn(
            "max(visible_sec, PLAYBACK_OSD_VISIBLE_SEC)",
            PAD_SRC,
        )


if __name__ == "__main__":
    unittest.main()
