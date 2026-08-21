import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
ACTIVITY = REPO / "scripts" / "lib" / "couch-activity.sh"
WATCHDOG_UNIT = REPO / "scripts" / "m1-foundation" / "ui" / "systemd" / "mango-watchdog.service"
LAUNCHER_MAIN = REPO / "src" / "launcher" / "src" / "main.ts"


class CouchActivityTests(unittest.TestCase):
    def run_activity(self, *args, env=None, check=False):
        merged = os.environ.copy()
        if env:
            merged.update(env)
        return subprocess.run(
            [str(ACTIVITY), *args],
            text=True,
            capture_output=True,
            env=merged,
            check=check,
        )

    def test_status_reports_active_without_failure_exit(self):
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "activity.json"
            env = {
                "MANGO_COUCH_ACTIVITY_STATE": str(state),
                "MANGO_COUCH_IDLE_SEC": "1800",
                "XDG_CACHE_HOME": str(Path(tmp) / "cache"),
            }
            self.run_activity("touch", "unit", "key", env=env, check=True)

            status = self.run_activity("status", env=env)
            self.assertEqual(status.returncode, 0, status.stderr)
            payload = json.loads(status.stdout)
            self.assertFalse(payload["idle"])
            self.assertEqual(payload["source"], "unit")
            self.assertEqual(payload["hint"], "key")

            idle = self.run_activity("is-idle", env=env)
            self.assertEqual(idle.returncode, 1)

    def test_missing_state_is_idle(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                "MANGO_COUCH_ACTIVITY_STATE": str(Path(tmp) / "missing.json"),
                "MANGO_COUCH_IDLE_SEC": "1800",
                "XDG_CACHE_HOME": str(Path(tmp) / "cache"),
            }
            status = self.run_activity("status", env=env, check=True)
            payload = json.loads(status.stdout)
            self.assertTrue(payload["idle"])
            self.assertEqual(payload["source"], "none")

            idle = self.run_activity("is-idle", env=env)
            self.assertEqual(idle.returncode, 0)

    def test_startup_does_not_synthesize_couch_activity(self):
        unit = WATCHDOG_UNIT.read_text(encoding="utf-8")
        launcher = LAUNCHER_MAIN.read_text(encoding="utf-8")

        self.assertNotRegex(unit, r"(?m)^(Wants|Requires)=")
        self.assertNotIn('touchCouchActivity("launcher", "init")', launcher)


if __name__ == "__main__":
    unittest.main()
