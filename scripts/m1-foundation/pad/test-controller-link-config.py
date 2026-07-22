#!/usr/bin/env python3
"""Tests for comment-preserving BlueZ controller policy updates."""

from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

MODULE = Path(__file__).with_name("controller-link-config.py")
SPEC = importlib.util.spec_from_file_location("controller_link_config", MODULE)
assert SPEC and SPEC.loader
CONFIG = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = CONFIG
SPEC.loader.exec_module(CONFIG)


class ControllerLinkConfigTest(unittest.TestCase):
    def test_preserves_unrelated_lines_and_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "main.conf"
            original = "# retained comment\n[General]\nName = mango\n\n[Audio]\nEnable = true\n"
            path.write_text(original, encoding="utf-8")
            CONFIG.patch_main_conf(path)
            once = path.read_text(encoding="utf-8")
            CONFIG.patch_main_conf(path)
            twice = path.read_text(encoding="utf-8")
            self.assertEqual(once, twice)
            self.assertIn("# retained comment", once)
            self.assertIn("Name = mango", once)
            self.assertIn("[Audio]\nEnable = true", once)
            for section, values in CONFIG.MANAGED_VALUES.items():
                self.assertIn(f"[{section}]", once)
                for key, value in values.items():
                    self.assertEqual(once.count(f"{key} = {value}"), 1)


if __name__ == "__main__":
    unittest.main()
