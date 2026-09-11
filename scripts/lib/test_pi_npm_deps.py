"""Fast deploy must not reuse native modules across Node ABI changes."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("pi-npm-deps.sh")


class NpmDependencyFingerprintTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="mango-npm-deps-test-")
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.pkg = self.root / "catalog"
        self.pkg.mkdir()
        (self.pkg / "package.json").write_text("{}\n")
        (self.pkg / "package-lock.json").write_text('{"lockfileVersion":3}\n')
        (self.bin / "node").write_text(
            '#!/bin/sh\n[ "${TEST_NODE_FAIL:-0}" != 1 ] || exit 1\n'
            'printf "%s\\n" "$TEST_NODE_RUNTIME"\n'
        )
        (self.bin / "npm").write_text(
            '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_NPM_LOG"\n'
            '[ "${TEST_NPM_FAIL:-0}" != 1 ] || exit 1\n'
            'mkdir -p "$2/node_modules"\n'
        )
        for path in self.bin.iterdir():
            path.chmod(0o700)
        self.log = self.root / "npm.log"
        self.env = {
            **os.environ,
            "HOME": str(self.root),
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "TEST_NODE_RUNTIME": "linux:arm64:115:9",
            "TEST_NPM_LOG": str(self.log),
        }

    def ensure(self, **changes):
        return subprocess.run(
            ["bash", str(SCRIPT), "ensure", str(self.pkg)],
            env={**self.env, **changes}, capture_output=True, text=True,
            check=False,
        )

    def installs(self):
        return len(self.log.read_text().splitlines()) if self.log.exists() else 0

    def test_same_lock_and_runtime_reuses_dependencies(self):
        self.assertEqual(self.ensure().returncode, 0)
        self.assertEqual(self.ensure().returncode, 0)
        self.assertEqual(self.installs(), 1)

    def test_native_runtime_change_reinstalls(self):
        for runtime in ["linux:arm64:115:9", "linux:arm64:127:10", "linux:x64:127:10"]:
            self.assertEqual(self.ensure(TEST_NODE_RUNTIME=runtime).returncode, 0)
        self.assertEqual(self.installs(), 3)

    def test_lock_change_reinstalls(self):
        self.assertEqual(self.ensure().returncode, 0)
        (self.pkg / "package-lock.json").write_text('{"lockfileVersion":3,"changed":true}\n')
        self.assertEqual(self.ensure().returncode, 0)
        self.assertEqual(self.installs(), 2)

    def test_missing_modules_reinstalls(self):
        self.assertEqual(self.ensure().returncode, 0)
        (self.pkg / "node_modules").rmdir()
        self.assertEqual(self.ensure().returncode, 0)
        self.assertEqual(self.installs(), 2)

    def test_node_failure_does_not_install_or_stamp(self):
        self.assertNotEqual(self.ensure(TEST_NODE_FAIL="1").returncode, 0)
        self.assertEqual(self.installs(), 0)
        self.assertFalse((self.root / ".cache/mango").exists())

    def test_failed_install_does_not_advance_stamp(self):
        self.assertNotEqual(self.ensure(TEST_NPM_FAIL="1").returncode, 0)
        self.assertEqual(self.ensure().returncode, 0)
        self.assertEqual(self.installs(), 2)


if __name__ == "__main__":
    unittest.main()
