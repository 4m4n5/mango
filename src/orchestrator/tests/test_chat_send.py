"""Tests for companion chat_send text input path."""

from __future__ import annotations

import asyncio
import os
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import WebSocket

from orchestrator import main as main_module
from orchestrator.config import OrchestratorSettings
from orchestrator.main import handle_client_message, run_text_pipeline, session


class ChatSendValidationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._prev_voice_log = os.environ.get("MANGO_VOICE_LOG")
        os.environ["MANGO_VOICE_LOG"] = "0"
        session.messages.clear()
        session.set_overlay("idle", "idle")
        main_module.ptt_owner = None
        if main_module.voice_lock.locked():
            main_module.voice_lock.release()
        main_module.voice_lock = asyncio.Lock()
        self.patchers = [
            patch.object(main_module, "broadcast_error", new=AsyncMock()),
            patch.object(main_module, "broadcast_status", new=AsyncMock()),
            patch.object(main_module, "broadcast_chat", new=AsyncMock()),
            patch.object(main_module, "run_text_pipeline", new=AsyncMock()),
        ]
        for p in self.patchers:
            p.start()

    async def asyncTearDown(self) -> None:
        for p in self.patchers:
            p.stop()
        if main_module.voice_lock.locked():
            main_module.voice_lock.release()
        if self._prev_voice_log is None:
            os.environ.pop("MANGO_VOICE_LOG", None)
        else:
            os.environ["MANGO_VOICE_LOG"] = self._prev_voice_log

    async def test_empty_text_rejected(self) -> None:
        ws = AsyncMock(spec=WebSocket)
        await handle_client_message(ws, '{"type": "chat_send", "text": "   "}')
        main_module.broadcast_error.assert_awaited_once_with("text is empty")
        main_module.run_text_pipeline.assert_not_awaited()
        main_module.run_text_pipeline.assert_not_called()

    async def test_non_string_text_rejected(self) -> None:
        ws = AsyncMock(spec=WebSocket)
        await handle_client_message(ws, '{"type": "chat_send", "text": 123}')
        main_module.broadcast_error.assert_awaited_once_with("text is empty")
        main_module.run_text_pipeline.assert_not_called()

    async def test_long_text_rejected(self) -> None:
        ws = AsyncMock(spec=WebSocket)
        text = "x" * 501
        await handle_client_message(ws, f'{{"type": "chat_send", "text": "{text}"}}')
        main_module.broadcast_error.assert_awaited_once_with("text is too long")
        main_module.run_text_pipeline.assert_not_called()

    async def test_ptt_active_rejects_chat(self) -> None:
        owner = AsyncMock(spec=WebSocket)
        main_module.ptt_owner = owner
        ws = AsyncMock(spec=WebSocket)
        await handle_client_message(ws, '{"type": "chat_send", "text": "hello"}')
        main_module.broadcast_error.assert_awaited_once_with("voice is busy")
        main_module.run_text_pipeline.assert_not_called()

    async def test_voice_lock_held_rejects_chat(self) -> None:
        await main_module.voice_lock.acquire()
        try:
            ws = AsyncMock(spec=WebSocket)
            await handle_client_message(ws, '{"type": "chat_send", "text": "hello"}')
            main_module.broadcast_error.assert_awaited_once_with("voice is busy")
            main_module.run_text_pipeline.assert_not_called()
        finally:
            main_module.voice_lock.release()

    async def test_valid_text_starts_pipeline(self) -> None:
        ws = AsyncMock(spec=WebSocket)
        await handle_client_message(ws, '{"type": "chat_send", "text": "hello mango"}')
        main_module.broadcast_error.assert_not_awaited()
        main_module.run_text_pipeline.assert_called_once()
        args, _ = main_module.run_text_pipeline.call_args
        self.assertEqual(args[0], "hello mango")


class TextPipelineTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self._prev_voice_log = os.environ.get("MANGO_VOICE_LOG")
        os.environ["MANGO_VOICE_LOG"] = "0"
        session.messages.clear()
        session.set_overlay("idle", "idle")
        main_module.ptt_owner = None
        if main_module.voice_lock.locked():
            main_module.voice_lock.release()
        main_module.voice_lock = asyncio.Lock()

    async def asyncTearDown(self) -> None:
        if main_module.voice_lock.locked():
            main_module.voice_lock.release()
        if self._prev_voice_log is None:
            os.environ.pop("MANGO_VOICE_LOG", None)
        else:
            os.environ["MANGO_VOICE_LOG"] = self._prev_voice_log

    def _settings(self) -> OrchestratorSettings:
        return OrchestratorSettings(
            host="127.0.0.1",
            port=8765,
            local_ws_port=None,
            ssl_certfile=None,
            ssl_keyfile=None,
            max_utterance_seconds=30,
            stt_provider="none",
            stt_model="",
            stt_language="",
            stt_strategy="",
            stt_detect_languages=(),
            stt_api_key_file=None,
            stt_timeout_seconds=10.0,
            stt_keyterms=(),
            stt_prepare_audio=False,
            stt_local_model="",
            stt_device="",
            stt_compute_type="",
            piper_voice="",
            piper_data_dir=None,
            tts_player="none",
            tts_enabled=False,
            tts_async=False,
            overlay_reply_seconds=5,
            duck_volume_while_listening=False,
            duck_volume_percent=0,
            llm_provider="none",
            llm_model="",
            llm_max_tokens=1024,
            llm_history_turns=0,
            llm_api_key_file=None,
            catalog_upstream="http://127.0.0.1:3020",
            launcher_ui_upstream="http://127.0.0.1:3000",
            voice_tools_enabled=False,
            max_tool_rounds=0,
        )

    async def test_text_pipeline_skips_pcm_and_tts(self) -> None:
        settings = self._settings()
        with (
            patch("orchestrator.main.load_settings", return_value=settings),
            patch("orchestrator.main.generate_reply", return_value="hello back") as mock_generate,
            patch("orchestrator.main.duck_audio") as mock_duck,
            patch("orchestrator.main.restore_audio") as mock_restore,
            patch("orchestrator.main.decode_pcm_b64") as mock_decode,
            patch("orchestrator.main.transcribe_detailed") as mock_stt,
            patch("orchestrator.main.broadcast_chat", new=AsyncMock()) as mock_chat,
            patch("orchestrator.main.broadcast_status", new=AsyncMock()) as mock_status,
            patch("orchestrator.main.broadcast_error", new=AsyncMock()) as mock_error,
        ):
            epoch = main_module.voice_epoch
            await run_text_pipeline("hello", epoch)

        mock_duck.assert_not_called()
        mock_restore.assert_not_called()
        mock_decode.assert_not_called()
        mock_stt.assert_not_called()
        mock_generate.assert_called_once()
        mock_chat.assert_awaited()
        mock_error.assert_not_awaited()
        self.assertEqual(len(session.messages), 2)
        self.assertEqual(session.messages[0].role, "user")
        self.assertEqual(session.messages[0].text, "hello")
        self.assertEqual(session.messages[1].role, "assistant")
        self.assertEqual(session.messages[1].text, "hello back")


if __name__ == "__main__":
    unittest.main()
