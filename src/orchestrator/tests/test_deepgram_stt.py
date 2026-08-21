"""Deepgram STT parameter tests — no network calls."""

from __future__ import annotations

import unittest

from orchestrator.audio.deepgram_stt import _listen_params, _samples_to_pcm16le
from orchestrator.config import OrchestratorSettings


def _settings(**overrides: object) -> OrchestratorSettings:
    base = {
        "host": "127.0.0.1",
        "port": 8765,
        "local_ws_port": 8766,
        "ssl_certfile": None,
        "ssl_keyfile": None,
        "max_utterance_seconds": 30,
        "stt_provider": "deepgram",
        "stt_model": "nova-3-general",
        "stt_language": "multi",
        "stt_strategy": "multilingual_with_detect_fallback",
        "stt_detect_languages": ("hi", "en"),
        "stt_api_key_file": None,
        "stt_timeout_seconds": 30.0,
        "stt_keyterms": ("kholo", "Toy Story"),
        "stt_prepare_audio": True,
        "stt_local_model": "small",
        "stt_device": "cpu",
        "stt_compute_type": "int8",
        "piper_voice": "en_US-lessac-medium",
        "piper_data_dir": None,
        "tts_player": "auto",
        "tts_enabled": False,
        "tts_async": True,
        "overlay_reply_seconds": 10,
        "duck_volume_while_listening": True,
        "duck_volume_percent": 40,
        "llm_provider": "anthropic",
        "llm_model": "claude-sonnet-4-6",
        "llm_max_tokens": 192,
        "llm_history_turns": 3,
        "llm_api_key_file": None,
        "catalog_upstream": "http://127.0.0.1:3020",
        "launcher_ui_upstream": "http://127.0.0.1:3000",
        "voice_tools_enabled": True,
        "max_tool_rounds": 6,
    }
    base.update(overrides)
    return OrchestratorSettings(**base)


class DeepgramParamsTests(unittest.TestCase):
    def test_multilingual_uses_multi_language(self) -> None:
        params = dict(_listen_params(_settings(), mode="multilingual"))
        self.assertEqual(params["model"], "nova-3-general")
        self.assertEqual(params["language"], "multi")
        self.assertNotIn("detect_language", params)

    def test_detect_restricts_hindi_and_indian_english(self) -> None:
        params = _listen_params(_settings(), mode="detect")
        detect = [value for key, value in params if key == "detect_language"]
        self.assertEqual(detect, ["hi", "en"])
        self.assertFalse(any(key == "language" for key, _ in params))

    def test_samples_to_pcm16le(self) -> None:
        import numpy as np

        samples = np.array([0.0, 0.5, -0.5, 1.0, -1.0], dtype=np.float32)
        pcm = _samples_to_pcm16le(samples)
        self.assertEqual(len(pcm), len(samples) * 2)
        self.assertEqual(pcm[0:2], b"\x00\x00")

    def test_detect_normalizes_en_in(self) -> None:
        params = _listen_params(_settings(stt_detect_languages=("hi", "en-IN")), mode="detect")
        detect = [value for key, value in params if key == "detect_language"]
        self.assertEqual(detect, ["hi", "en"])


if __name__ == "__main__":
    unittest.main()
