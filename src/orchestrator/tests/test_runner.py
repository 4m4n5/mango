"""Tests for voice tool runner validation."""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from orchestrator.config import OrchestratorSettings
from orchestrator.tools.runner import execute_tool


class CreateAiCatalogValidationTests(unittest.IsolatedAsyncioTestCase):
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
            overlay_reply_seconds=0,
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

    async def test_youtube_tab_requires_youtube_video_content_type(self) -> None:
        result = await execute_tool(
            "mango_create_ai_catalog",
            {"label": "Cooking", "tab": "youtube", "content_type": "movie"},
            self._settings(),
        )
        payload = json.loads(result)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "youtube tab requires youtube_video content_type")

    async def test_youtube_tab_accepts_youtube_video_content_type(self) -> None:
        # Validation should pass locally; mock the downstream catalog call so the test
        # does not require a running catalog service.
        with patch(
            "orchestrator.tools.catalog.tool_create_ai_catalog",
            return_value={"ok": True, "catalog": {"slot_id": "cooking"}},
        ):
            result = await execute_tool(
                "mango_create_ai_catalog",
                {"label": "Cooking", "tab": "youtube", "content_type": "youtube_video"},
                self._settings(),
            )
        payload = json.loads(result)
        self.assertTrue(payload["ok"])

    async def test_invalid_tab_rejected(self) -> None:
        result = await execute_tool(
            "mango_create_ai_catalog",
            {"label": "Cooking", "tab": "games", "content_type": "movie"},
            self._settings(),
        )
        payload = json.loads(result)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "tab must be movies, series, youtube, or live")

    async def test_invalid_content_type_rejected(self) -> None:
        result = await execute_tool(
            "mango_create_ai_catalog",
            {"label": "Cooking", "tab": "movies", "content_type": "youtube_channel"},
            self._settings(),
        )
        payload = json.loads(result)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "content_type must be movie, series, youtube_video, or tv")

    async def test_live_tab_requires_tv_content_type(self) -> None:
        result = await execute_tool(
            "mango_create_ai_catalog",
            {"label": "News", "tab": "live", "content_type": "movie"},
            self._settings(),
        )
        payload = json.loads(result)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "live tab requires tv content_type")

    async def test_tv_content_type_requires_live_tab(self) -> None:
        result = await execute_tool(
            "mango_create_ai_catalog",
            {"label": "News", "tab": "movies", "content_type": "tv"},
            self._settings(),
        )
        payload = json.loads(result)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "tv content_type requires live tab")

    async def test_live_tab_accepts_tv_content_type(self) -> None:
        with patch(
            "orchestrator.tools.catalog.tool_create_ai_catalog",
            return_value={"ok": True, "catalog": {"slot_id": "news"}},
        ):
            result = await execute_tool(
                "mango_create_ai_catalog",
                {"label": "News", "tab": "live", "content_type": "tv"},
                self._settings(),
            )
        payload = json.loads(result)
        self.assertTrue(payload["ok"])

    async def test_profile_create_is_explicit_and_does_not_request_activation(self) -> None:
        with patch(
            "orchestrator.tools.catalog.tool_manage_viewer_profile",
            return_value={"ok": True, "profile": {"profile_id": "alice"}},
        ) as manage:
            result = await execute_tool(
                "mango_manage_viewer_profile",
                {"action": "create", "name": "  Alice  "},
                self._settings(),
            )
        self.assertTrue(json.loads(result)["ok"])
        manage.assert_called_once_with(
            self._settings(),
            action="create",
            profile_id=None,
            name="Alice",
        )

    async def test_profile_activation_waits_for_tv_invalidation_handshake(self) -> None:
        commands: list[dict[str, object]] = []

        async def dispatch(command: dict[str, object]) -> int:
            commands.append(command)
            return 73

        with patch(
            "orchestrator.tools.catalog.tool_manage_viewer_profile",
            return_value={"ok": True, "state": {"active_profile_id": "alice"}},
        ):
            result = await execute_tool(
                "mango_manage_viewer_profile",
                {"action": "activate", "profile_id": "alice"},
                self._settings(),
                dispatch_launcher=dispatch,
            )
        payload = json.loads(result)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["tv_synced"])
        self.assertEqual(payload["tv_seq"], 73)
        self.assertEqual(commands, [{
            "type": "launcher_command",
            "action": "profile_changed",
            "profile_id": "alice",
        }])

    async def test_profile_actions_require_their_specific_fields(self) -> None:
        for action in ("rename", "activate", "complete_onboarding"):
            result = await execute_tool(
                "mango_manage_viewer_profile",
                {"action": action, "name": "Alice"},
                self._settings(),
            )
            self.assertEqual(
                json.loads(result)["error"],
                f"profile_id required for {action}",
            )
        for action in ("create", "rename"):
            result = await execute_tool(
                "mango_manage_viewer_profile",
                {"action": action, "profile_id": "alice"},
                self._settings(),
            )
            self.assertEqual(json.loads(result)["error"], f"name required for {action}")

    async def test_profile_rename_preserves_explicit_stable_id(self) -> None:
        with patch(
            "orchestrator.tools.catalog.tool_manage_viewer_profile",
            return_value={"ok": True, "profile": {"profile_id": "alice", "name": "Alice Prime"}},
        ) as manage:
            result = await execute_tool(
                "mango_manage_viewer_profile",
                {"action": "rename", "profile_id": " Alice ", "name": " Alice Prime "},
                self._settings(),
            )
        self.assertTrue(json.loads(result)["ok"])
        manage.assert_called_once_with(
            self._settings(),
            action="rename",
            profile_id="Alice",
            name="Alice Prime",
        )

    async def test_profile_unknown_action_fails_closed(self) -> None:
        result = await execute_tool(
            "mango_manage_viewer_profile",
            {"action": "delete", "profile_id": "alice"},
            self._settings(),
        )
        self.assertEqual(json.loads(result), {"ok": False, "error": "valid profile action required"})


if __name__ == "__main__":
    unittest.main()
