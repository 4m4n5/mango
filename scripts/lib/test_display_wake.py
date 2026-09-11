#!/usr/bin/env python3
"""Exercise wake ordering without accessing the workstation or Pi display."""

from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).resolve().parents[2]


def apply_xset(state: dict, args: list[str]) -> None:
    pending = list(args)
    while pending:
        option = pending.pop(0)
        if option == "-dpms":
            state["enabled"] = False
        elif option == "dpms":
            if pending[0] == "force":
                assert pending[:2] == ["force", "on"]
                del pending[:2]
                state.update(enabled=True, monitor="on")
            else:
                state.update(enabled=True, timeouts=[int(value) for value in pending[:3]])
                del pending[:3]
        elif option == "s":
            value = pending.pop(0)
            if value == "0":
                assert pending.pop(0) == "0"
                state["screensaver"] = 0
            else:
                assert value in ("off", "noblank", "reset")
        else:
            raise AssertionError(f"unexpected xset option: {option}")


class DisplayWakeTests(unittest.TestCase):
    def initial_state(self) -> dict:
        return dict(enabled=True, timeouts=[600, 600, 600], monitor="off", screensaver=600)

    def assert_no_automatic_blank(self, state: dict) -> None:
        self.assertFalse(state["enabled"])
        self.assertEqual(state["timeouts"], [0, 0, 0])
        self.assertEqual(state["screensaver"], 0)

    def run_shell_helper(self, helper: str) -> dict:
        with tempfile.TemporaryDirectory(prefix="mango-display-test-") as temporary:
            directory = Path(temporary)
            state_path = directory / "state.json"
            state_path.write_text(json.dumps(self.initial_state()), encoding="utf-8")
            xset = directory / "xset"
            # Import only this safe test module, never the production pad loop.
            xset.write_text(
                f"#!{sys.executable}\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                f"sys.path.insert(0, {str(Path(__file__).parent)!r})\n"
                "from test_display_wake import apply_xset\n"
                "p = Path(os.environ['MANGO_TEST_DISPLAY_STATE'])\n"
                "state = json.loads(p.read_text())\n"
                "apply_xset(state, sys.argv[1:])\n"
                "p.write_text(json.dumps(state))\n",
                encoding="utf-8",
            )
            xset.chmod(0o755)
            # Pretend the cursor daemon is already running: this used to return
            # before repairing display policy on every post-playback restore.
            for name in ("pgrep", "xsetroot"):
                command = directory / name
                command.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                command.chmod(0o755)
            subprocess.run(
                ["bash", str(ROOT / "scripts/lib" / helper)],
                env={**os.environ, "PATH": str(directory) + os.pathsep + os.environ.get("PATH", ""),
                     "MANGO_TEST_DISPLAY_STATE": str(state_path)},
                check=True, timeout=10, capture_output=True,
            )
            return json.loads(state_path.read_text(encoding="utf-8"))

    def test_wake_does_not_leave_dpms_enabled(self) -> None:
        state = self.run_shell_helper("mango-display-wake.sh")
        self.assert_no_automatic_blank(state)
        self.assertEqual(state["monitor"], "on")

    def test_existing_cursor_does_not_skip_display_repair(self) -> None:
        state = self.run_shell_helper("mango-cursor.sh")
        self.assert_no_automatic_blank(state)
        # Hiding a cursor alone must not wake a deliberately blanked display.
        self.assertEqual(state["monitor"], "off")

    def test_pad_wake_has_the_same_final_display_policy(self) -> None:
        source = ROOT / "scripts/m1-foundation/pad/mango-tv-pad.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        function = next(node for node in tree.body
                        if isinstance(node, ast.FunctionDef) and node.name == "_wake_display_xset")
        state = self.initial_state()
        runner = Mock(side_effect=lambda argv, **kwargs: apply_xset(state, argv[1:]))
        namespace = dict(shutil=SimpleNamespace(which=lambda _: "xset"),
                         subprocess=SimpleNamespace(run=runner, DEVNULL=subprocess.DEVNULL,
                                                    TimeoutExpired=subprocess.TimeoutExpired), _env={})
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        namespace["_wake_display_xset"]()
        self.assert_no_automatic_blank(state)
        self.assertEqual(state["monitor"], "on")
        self.assertEqual(runner.call_count, 1)


if __name__ == "__main__":
    unittest.main()
