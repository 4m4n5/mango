#!/usr/bin/env python3

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("aiostreams_policy.py")
SPEC = importlib.util.spec_from_file_location("aiostreams_policy", MODULE_PATH)
assert SPEC and SPEC.loader
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


def fixture() -> dict:
    return {
        "data": {
            "userData": {
                "services": [
                    {"id": "torbox", "enabled": True, "credentials": {"token": "tb-secret"}},
                    {"id": "realdebrid", "enabled": True, "credentials": {"token": "rd-secret"}},
                    {"id": "easynews", "enabled": True, "credentials": {"password": "en-secret"}},
                ],
                "presets": [
                    {"type": "torrentio", "instanceId": "tor", "enabled": True, "options": {}},
                    {"type": "comet", "instanceId": "com", "enabled": True, "options": {}},
                    {
                        "type": "mediafusion",
                        "instanceId": "mf",
                        "enabled": False,
                        "options": {
                            "url": "https://old.example/secret/manifest.json",
                            "resources": ["stream"],
                            "timeout": 8_000,
                        },
                    },
                    {"type": "easynews-search", "instanceId": "en", "enabled": True, "options": {}},
                ],
                "groups": None,
            }
        }
    }


class AioStreamsPolicyTest(unittest.TestCase):
    def test_enable_mediafusion_replaces_secret_override_and_wires_groups(self) -> None:
        original = fixture()
        updated = POLICY.enable_mediafusion(original)
        self.assertEqual(POLICY.mediafusion_policy_errors(updated), [])
        self.assertFalse(original["data"]["userData"]["presets"][2]["enabled"])
        config = updated["data"]["userData"]
        mediafusion = config["presets"][2]
        self.assertEqual(mediafusion["options"]["url"], POLICY.MEDIAFUSION_BASE_URL)
        self.assertEqual(mediafusion["options"]["resources"], ["stream"])
        self.assertEqual(mediafusion["options"]["services"], ["torbox", "realdebrid"])
        self.assertEqual(config["groups"]["groupings"][0]["addons"], ["tor", "com", "mf"])
        self.assertEqual(config["groups"]["groupings"][1]["addons"], ["en"])

    def test_policy_rejects_secret_manifest_override_or_broad_resources(self) -> None:
        updated = POLICY.enable_mediafusion(fixture())
        mediafusion = updated["data"]["userData"]["presets"][2]
        mediafusion["options"]["url"] = "https://mediafusion.elfhosted.com/private/manifest.json"
        mediafusion["options"]["resources"] = ["stream", "catalog"]
        errors = POLICY.mediafusion_policy_errors(updated)
        self.assertTrue(any("non-secret HTTPS base" in error for error in errors))
        self.assertTrue(any("stream-only" in error for error in errors))

    def test_prepare_payload_preserves_credentials_without_printing_them(self) -> None:
        previous_uuid = os.environ.get("AIOSTREAMS_UUID")
        previous_password = os.environ.get("AIOSTREAMS_PASSWORD")
        os.environ["AIOSTREAMS_UUID"] = "uuid-secret"
        os.environ["AIOSTREAMS_PASSWORD"] = "password-secret"
        try:
            with tempfile.TemporaryDirectory() as directory:
                output = Path(directory) / "payload.json"
                POLICY.write_put_payload(POLICY.enable_mediafusion(fixture()), str(output))
                payload = json.loads(output.read_text(encoding="utf-8"))
                self.assertEqual(payload["uuid"], "uuid-secret")
                self.assertEqual(payload["password"], "password-secret")
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                self.assertEqual(
                    payload["config"]["services"][0]["credentials"]["token"],
                    "tb-secret",
                )
        finally:
            if previous_uuid is None:
                os.environ.pop("AIOSTREAMS_UUID", None)
            else:
                os.environ["AIOSTREAMS_UUID"] = previous_uuid
            if previous_password is None:
                os.environ.pop("AIOSTREAMS_PASSWORD", None)
            else:
                os.environ["AIOSTREAMS_PASSWORD"] = previous_password

    def test_manifest_requires_movie_and_series_stream_capabilities(self) -> None:
        POLICY.validate_manifest(
            {"resources": [{"name": "stream", "types": ["movie", "series", "tv"]}]}
        )
        with self.assertRaisesRegex(POLICY.PolicyError, "series"):
            POLICY.validate_manifest({"resources": [{"name": "stream", "types": ["movie"]}]})


if __name__ == "__main__":
    unittest.main()
