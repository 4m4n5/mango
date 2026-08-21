"""voice_log unit tests."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from orchestrator.voice_log import (
    TurnTimer,
    append_event,
    configure_logging,
    new_turn_id,
    reset_turn_id,
    set_turn_id,
    voice_turns_path,
)


class VoiceLogTests(unittest.TestCase):
    def test_append_event_writes_jsonl(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "voice-turns.jsonl"
            with mock.patch.dict(
                "os.environ",
                {"MANGO_CACHE_DIR": tmp, "MANGO_VOICE_LOG": str(log_path)},
                clear=False,
            ):
                turn_id = new_turn_id()
                token = set_turn_id(turn_id)
                try:
                    append_event("stt", text="open Toy Story", confidence=0.91)
                    append_event("agent_reply", text="Opening Toy Story.")
                finally:
                    reset_turn_id(token)

                lines = log_path.read_text(encoding="utf-8").strip().splitlines()
                self.assertEqual(len(lines), 2)
                stt = json.loads(lines[0])
                self.assertEqual(stt["event"], "stt")
                self.assertEqual(stt["text"], "open Toy Story")
                self.assertEqual(stt["turn_id"], turn_id)
                reply = json.loads(lines[1])
                self.assertEqual(reply["event"], "agent_reply")

    def test_turn_timer_collects_stages(self) -> None:
        timer = TurnTimer()
        timer.mark("stt", 120.4)
        timer.mark("llm", 850.2)
        stages = timer.as_dict()
        self.assertEqual(stages["stt"], 120)
        self.assertEqual(stages["llm"], 850)
        self.assertIn("total", stages)

    def test_configure_logging_creates_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.dict("os.environ", {"MANGO_CACHE_DIR": tmp}, clear=False):
                configure_logging()
                log_path = Path(tmp) / "orchestrator.log"
                self.assertTrue(log_path.is_file())
                self.assertEqual(voice_turns_path().parent, Path(tmp))


if __name__ == "__main__":
    unittest.main()
