#!/usr/bin/env python3
"""Offline policy tests for the YouTube runtime canary."""

from __future__ import annotations

import importlib.util
import os
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[2]
CANARY = ROOT / "scripts/m6-ship/youtube-runtime-canary.py"
SPEC = importlib.util.spec_from_file_location("mango_youtube_runtime_canary", CANARY)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load YouTube runtime canary")
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def probe(
    label: str,
    *,
    dynamic: bool = False,
    required: bool = True,
    kind: str = "vod",
):
    return MODULE.Probe(label, "https://example.invalid", dynamic, required, kind)


class CanaryPolicyTest(unittest.TestCase):
    def healthy_results(self):
        return [
            (probe("dynamic_1", dynamic=True), True, "pass"),
            (probe("dynamic_2", dynamic=True), True, "pass"),
            (probe("ordinary_vod"), True, "pass"),
            (probe("long_vod"), True, "pass"),
            (probe("music"), True, "pass"),
            (probe("hls_live"), True, "pass"),
            (probe("made_for_kids", required=False), False, "transport_failed"),
        ]

    def test_advisory_failure_does_not_block_a_strict_required_corpus(self):
        result = MODULE.summarize_results(self.healthy_results(), False)
        self.assertTrue(result["ok"])
        self.assertEqual(result["required_total"], 6)
        self.assertEqual(result["required_passed"], 6)
        self.assertEqual(result["failures"], {})
        self.assertEqual(result["advisories"], {"transport_failed": 1})

    def test_any_required_or_current_rail_failure_blocks_promotion(self):
        results = self.healthy_results()
        results[1] = (results[1][0], False, "transport_failed")
        summary = MODULE.summarize_results(results, False)
        self.assertFalse(summary["ok"])
        self.assertEqual(summary["dynamic_passed"], 1)
        self.assertEqual(summary["failures"], {"transport_failed": 1})

    def test_empty_household_rails_use_the_three_stable_controls(self):
        results = [
            item
            for item in self.healthy_results()
            if not item[0].dynamic
        ]
        summary = MODULE.summarize_results(results, False)
        self.assertTrue(summary["ok"])
        self.assertEqual(summary["dynamic_total"], 0)
        self.assertEqual(summary["required_total"], 4)

    def test_fixed_corpus_uses_a_channel_live_target(self):
        fixed = {item.label: item for item in MODULE.fixed_probes(ROOT)}
        self.assertTrue(fixed["ordinary_vod"].required)
        self.assertTrue(fixed["long_vod"].required)
        self.assertTrue(fixed["music"].required)
        self.assertTrue(fixed["hls_live"].required)
        self.assertEqual(fixed["hls_live"].target, "https://www.youtube.com/@NASA/live")
        self.assertFalse(fixed["made_for_kids"].required)

    def test_pot_provider_url_cannot_escape_loopback(self):
        with patch.dict(os.environ, {"MANGO_YOUTUBE_POT_URL": "https://example.com:4416"}):
            self.assertEqual(MODULE.pot_provider_url(), "http://127.0.0.1:4416")
        with patch.dict(os.environ, {"MANGO_YOUTUBE_POT_URL": "http://localhost:5516"}):
            self.assertEqual(MODULE.pot_provider_url(), "http://localhost:5516")

    def test_transport_probe_requires_audio_and_video_streams(self):
        resolved = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=(
                "MANGO_CANARY:not_live|1080|https+https\n"
                "https://video.invalid\nhttps://audio.invalid\n"
            ),
            stderr="",
        )
        with patch.object(MODULE.subprocess, "run", return_value=resolved):
            with patch.object(
                MODULE,
                "transport_stream_types",
                side_effect=[{"video"}, {"audio"}],
            ):
                self.assertEqual(
                    MODULE.probe_one(
                        probe("ordinary_vod"),
                        pathlib.Path("/bin/true"),
                        pathlib.Path("/bin/true"),
                        10,
                        False,
                    ),
                    (True, "pass"),
                )
            with patch.object(
                MODULE,
                "transport_stream_types",
                side_effect=[{"video"}, {"video"}],
            ):
                self.assertEqual(
                    MODULE.probe_one(
                        probe("ordinary_vod"),
                        pathlib.Path("/bin/true"),
                        pathlib.Path("/bin/true"),
                        10,
                        False,
                    ),
                    (False, "transport_incomplete"),
                )

    def test_long_vod_requires_a_nonzero_resume_decode(self):
        resolved = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout=(
                "MANGO_CANARY:not_live|1080|https\n"
                "https://video.invalid\nhttps://audio.invalid\n"
            ),
            stderr="",
        )
        with patch.object(MODULE.subprocess, "run", return_value=resolved):
            with patch.object(
                MODULE,
                "transport_stream_types",
                side_effect=[{"video"}, {"audio"}],
            ), patch.object(MODULE, "resume_transport_ready", return_value=False):
                self.assertEqual(
                    MODULE.probe_one(
                        probe("long_vod"),
                        pathlib.Path("/bin/true"),
                        pathlib.Path("/bin/true"),
                        10,
                        False,
                    ),
                    (False, "resume_transport_failed"),
                )

    def test_live_probe_resolves_with_hls_only_policy(self):
        resolved = subprocess.CompletedProcess(
            args=[],
            returncode=0,
            stdout="MANGO_CANARY:is_live|1080|m3u8_native\nhttps://live.invalid\n",
            stderr="",
        )
        with patch.object(MODULE.subprocess, "run", return_value=resolved) as run:
            self.assertEqual(
                MODULE.probe_one(
                    probe("hls_live", kind="live"),
                    pathlib.Path("/bin/true"),
                    pathlib.Path("/bin/true"),
                    10,
                    True,
                ),
                (True, "pass"),
            )
        command = run.call_args.args[0]
        self.assertEqual(command[command.index("-f") + 1], MODULE.YOUTUBE_LIVE_FORMAT)
        self.assertNotIn("protocol=https", MODULE.YOUTUBE_LIVE_FORMAT)

    def test_resume_probe_mirrors_production_youtube_http_identity(self):
        completed = subprocess.CompletedProcess(args=[], returncode=0)
        cookie_path = pathlib.Path("/tmp/youtube-cookies.txt")
        with patch.object(MODULE, "cookie_file", return_value=cookie_path):
            with patch.object(MODULE.subprocess, "run", return_value=completed) as run:
                self.assertTrue(
                    MODULE.resume_transport_ready(
                        ["https://video.invalid", "https://audio.invalid"],
                        10,
                    ),
                )
        command = run.call_args.args[0]
        self.assertIn(f"--user-agent={MODULE.YOUTUBE_USER_AGENT}", command)
        self.assertIn("--referrer=https://www.youtube.com/", command)
        self.assertIn("--http-header-fields=Origin: https://www.youtube.com", command)
        self.assertIn("--cookies=yes", command)
        self.assertIn(f"--cookies-file={cookie_path}", command)

    def test_resolve_canary_retries_cookies_only_for_account_challenges(self):
        calls = []

        def run(command, **_kwargs):
            calls.append(command)
            if len(calls) == 1:
                return subprocess.CompletedProcess(
                    command,
                    1,
                    "",
                    "ERROR: Sign in to confirm you’re not a bot",
                )
            return subprocess.CompletedProcess(
                command,
                0,
                "MANGO_CANARY:not_live|720|https\nhttps://muxed.invalid\n",
                "",
            )

        with patch.object(MODULE, "cookie_file", return_value=pathlib.Path("/tmp/cookies")):
            with patch.object(MODULE.subprocess, "run", side_effect=run):
                self.assertEqual(
                    MODULE.probe_one(
                        probe("ordinary_vod"),
                        pathlib.Path("/bin/true"),
                        pathlib.Path("/bin/true"),
                        10,
                        True,
                    ),
                    (True, "pass"),
                )
        self.assertNotIn("--cookies", calls[0])
        self.assertEqual(calls[1][calls[1].index("--cookies") + 1], "/tmp/cookies")


if __name__ == "__main__":
    unittest.main()
