#!/usr/bin/env python3

import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from aiostreams_version import parse_version, require_minimum, status_version


class AioStreamsVersionTest(unittest.TestCase):
    def test_accepts_date_series_capable_release(self) -> None:
        payload = {"success": True, "data": {"version": "2.32.1"}}
        self.assertEqual(require_minimum(payload, "2.32.0"), "2.32.1")

    def test_rejects_deployed_legacy_release(self) -> None:
        payload = {"success": True, "data": {"version": "2.30.3"}}
        with self.assertRaisesRegex(ValueError, "date-based series"):
            require_minimum(payload, "2.32.0")

    def test_rejects_missing_or_malformed_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "data.version"):
            status_version({"success": True, "data": {}})
        with self.assertRaisesRegex(ValueError, "semantic version"):
            parse_version("nightly")

    def test_cli_accepts_status_from_stdin(self) -> None:
        script = Path(__file__).with_name("aiostreams_version.py")
        result = subprocess.run(
            [sys.executable, str(script), "-"],
            input=json.dumps({"success": True, "data": {"version": "2.32.0"}}),
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("satisfies minimum", result.stdout)


if __name__ == "__main__":
    unittest.main()
