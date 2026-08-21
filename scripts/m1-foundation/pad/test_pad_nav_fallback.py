#!/usr/bin/env python3
"""Launcher pad-nav must not fall back to xdotool when the API is enabled."""

from __future__ import annotations

import ast
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

PAD_PATH = Path(__file__).resolve().parent / "mango-tv-pad.py"


def _load_pad_with_fake_evdev():
    """Import mango-tv-pad without requiring python3-evdev (Mac CI / gate host)."""
    if "mango_tv_pad" in sys.modules:
        return sys.modules["mango_tv_pad"]

    fake_ecodes = types.SimpleNamespace(
        EV_KEY=1,
        KEY_UP=103,
        KEY_DOWN=108,
        KEY_LEFT=105,
        KEY_RIGHT=106,
        BTN_A=304,
        BTN_B=305,
        BTN_X=307,
        BTN_Y=308,
        BTN_TL=310,
        BTN_TR=311,
        BTN_SELECT=314,
        BTN_START=315,
        BTN_MODE=316,
    )
    fake_evdev = types.ModuleType("evdev")
    fake_evdev.ecodes = fake_ecodes
    fake_evdev.InputDevice = object
    fake_evdev.list_devices = lambda: []
    sys.modules["evdev"] = fake_evdev
    sys.modules["evdev.ecodes"] = fake_ecodes

    import importlib.util

    spec = importlib.util.spec_from_file_location("mango_tv_pad", PAD_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["mango_tv_pad"] = module
    spec.loader.exec_module(module)
    return module


class PadNavNoXdotoolFallbackTests(unittest.TestCase):
    def test_source_documents_no_xdotool_fallback_on_api_path(self) -> None:
        source = PAD_PATH.read_text(encoding="utf-8")
        self.assertIn("pad_nav_no_xdotool_fallback", source)
        self.assertIn('os.environ.get("MANGO_PAD_NAV_TIMEOUT_SEC", "0.75")', source)
        tree = ast.parse(source)
        fn = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "launcher_send_nav_or_key"
        )
        # Failure after send_pad_nav must return without calling send_key_launcher.
        text = ast.get_source_segment(source, fn) or ""
        self.assertIn("return", text)
        self.assertIn("send_pad_nav", text)
        # The fallback call remains only on the non-API branch at the end.
        self.assertTrue(text.rstrip().endswith("send_key_launcher(symbol, app=app)"))

    def test_launcher_api_path_skips_xdotool_on_http_failure(self) -> None:
        pad = _load_pad_with_fake_evdev()
        with (
            patch.object(pad, "PAD_NAV_API_ENABLED", True),
            patch.object(pad, "routing_app", return_value="launcher"),
            patch.object(pad, "send_pad_nav", return_value=False) as send_nav,
            patch.object(pad, "send_key_launcher") as send_key,
            patch.object(pad, "diag_event"),
        ):
            pad.launcher_send_nav_or_key(
                "Down",
                action="move",
                direction="down",
            )
            send_nav.assert_called_once_with(
                "move", direction="down", delta=None, kind=None
            )
            send_key.assert_not_called()

    def test_api_disabled_still_uses_xdotool(self) -> None:
        pad = _load_pad_with_fake_evdev()
        with (
            patch.object(pad, "PAD_NAV_API_ENABLED", False),
            patch.object(pad, "send_pad_nav") as send_nav,
            patch.object(pad, "send_key_launcher") as send_key,
        ):
            pad.launcher_send_nav_or_key("Down", action="move", direction="down")
            send_nav.assert_not_called()
            send_key.assert_called_once_with("Down", app=None)


if __name__ == "__main__":
    unittest.main()
