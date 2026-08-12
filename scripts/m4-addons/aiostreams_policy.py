#!/usr/bin/env python3
"""Credential-safe AIOStreams policy transformations used by Mango tooling."""

from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


MEDIAFUSION_BASE_URL = "https://mediafusion.elfhosted.com"
MEDIAFUSION_TIMEOUT_MS = 12_000
MEDIAFUSION_SERVICES = ["torbox", "realdebrid"]
EASYNEWS_FALLBACK_CONDITION = "count(cached(previousStreams)) < 3"


class PolicyError(RuntimeError):
    pass


def _load(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise PolicyError("AIOStreams document must be an object")
    return value


def _write_private(path: str, value: object) -> None:
    target = Path(path)
    target.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    target.chmod(0o600)


def _config(document: dict[str, Any]) -> dict[str, Any]:
    try:
        config = document["data"]["userData"]
    except (KeyError, TypeError) as error:
        raise PolicyError("AIOStreams response has no data.userData object") from error
    if not isinstance(config, dict):
        raise PolicyError("AIOStreams data.userData must be an object")
    return config


def _presets(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for preset in config.get("presets", []):
        if not isinstance(preset, dict):
            continue
        preset_type = str(preset.get("type") or "").lower()
        if not preset_type:
            continue
        if preset_type in result:
            raise PolicyError(f"duplicate AIOStreams preset type: {preset_type}")
        result[preset_type] = preset
    return result


def _enabled_services(config: dict[str, Any]) -> set[str]:
    return {
        str(service.get("id") or "").lower()
        for service in config.get("services", [])
        if isinstance(service, dict) and service.get("enabled", True) is not False
    }


def _instance_id(presets: dict[str, dict[str, Any]], preset_type: str) -> str:
    preset = presets.get(preset_type)
    if not preset:
        raise PolicyError(f"missing AIOStreams preset: {preset_type}")
    instance_id = str(preset.get("instanceId") or "").strip()
    if not instance_id:
        raise PolicyError(f"AIOStreams preset has no instanceId: {preset_type}")
    return instance_id


def enable_mediafusion(document: dict[str, Any]) -> dict[str, Any]:
    updated = copy.deepcopy(document)
    config = _config(updated)
    services = _enabled_services(config)
    missing_services = sorted(set(MEDIAFUSION_SERVICES) - services)
    if missing_services:
        raise PolicyError(
            "MediaFusion requires enabled AIOStreams services: " + ", ".join(missing_services)
        )

    presets = _presets(config)
    for required in ("torrentio", "comet", "mediafusion", "easynews-search"):
        preset = presets.get(required)
        if not preset:
            raise PolicyError(f"missing AIOStreams preset: {required}")
        if required != "mediafusion" and preset.get("enabled") is not True:
            raise PolicyError(f"required AIOStreams preset is disabled: {required}")

    mediafusion = presets["mediafusion"]
    mediafusion["enabled"] = True
    options = mediafusion.setdefault("options", {})
    if not isinstance(options, dict):
        raise PolicyError("MediaFusion preset options must be an object")
    options.update(
        {
            "name": "MediaFusion",
            "timeout": max(MEDIAFUSION_TIMEOUT_MS, int(options.get("timeout") or 0)),
            "resources": ["stream"],
            "url": MEDIAFUSION_BASE_URL,
            "services": list(MEDIAFUSION_SERVICES),
            "mediaTypes": ["movie", "series"],
            "useCachedResultsOnly": True,
            "enableWatchlistCatalogs": False,
            "includeP2P": False,
            "useMultipleInstances": False,
            "downloadViaBrowser": False,
            "contributorStreams": False,
        }
    )

    primary = [_instance_id(presets, key) for key in ("torrentio", "comet", "mediafusion")]
    fallback = [_instance_id(presets, "easynews-search")]
    config["groups"] = {
        "enabled": True,
        # AIO's Easynews season searches can legitimately take 18-25 seconds.
        # Starting that group after the primary group would exceed Mango's
        # 14-second Streams-list wall. Parallel mode starts both groups
        # together; the condition still controls whether fallback results are
        # admitted, but is deliberately not claimed as provider-call suppression.
        "behaviour": "parallel",
        "groupings": [
            {"addons": primary, "condition": "true"},
            {"addons": fallback, "condition": EASYNEWS_FALLBACK_CONDITION},
        ],
    }
    return updated


def mediafusion_policy_errors(document: dict[str, Any]) -> list[str]:
    config = _config(document)
    presets = _presets(config)
    errors: list[str] = []
    mediafusion = presets.get("mediafusion")
    if not mediafusion or mediafusion.get("enabled") is not True:
        return ["MediaFusion preset is not enabled"]
    options = mediafusion.get("options")
    if not isinstance(options, dict):
        return ["MediaFusion preset options are malformed"]

    parsed = urlparse(str(options.get("url") or ""))
    if (
        parsed.scheme != "https"
        or parsed.hostname != "mediafusion.elfhosted.com"
        or parsed.path not in ("", "/")
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        errors.append("MediaFusion must use the non-secret HTTPS base URL")
    if options.get("resources") != ["stream"]:
        errors.append("MediaFusion must be stream-only behind AIOStreams")
    if options.get("services") != MEDIAFUSION_SERVICES:
        errors.append("MediaFusion must use the explicit TorBox/Real-Debrid service set")
    if options.get("mediaTypes") != ["movie", "series"]:
        errors.append("MediaFusion must be limited to Mango VOD media types")
    if options.get("useCachedResultsOnly") is not True:
        errors.append("MediaFusion cached-search-only mode is not enabled")
    if options.get("includeP2P") is not False:
        errors.append("MediaFusion P2P results are not disabled")
    if int(options.get("timeout") or 0) < MEDIAFUSION_TIMEOUT_MS:
        errors.append("MediaFusion timeout is below the Mango policy floor")

    groups = config.get("groups")
    if not isinstance(groups, dict) or groups.get("enabled") is not True:
        errors.append("AIOStreams conditional groups are not enabled")
        return errors
    if groups.get("behaviour") != "parallel":
        errors.append("AIOStreams groups must use latency-bounded parallel evaluation")
    groupings = groups.get("groupings")
    if not isinstance(groupings, list) or len(groupings) != 2:
        errors.append("AIOStreams must have exactly two Mango provider groups")
        return errors
    expected_primary = [_instance_id(presets, key) for key in ("torrentio", "comet", "mediafusion")]
    expected_fallback = [_instance_id(presets, "easynews-search")]
    if groupings[0] != {"addons": expected_primary, "condition": "true"}:
        errors.append("AIOStreams primary group does not contain Torrentio/Comet/MediaFusion")
    if groupings[1] != {
        "addons": expected_fallback,
        "condition": EASYNEWS_FALLBACK_CONDITION,
    }:
        errors.append("AIOStreams Easynews fallback group is not policy-compatible")
    return errors


def validate_manifest(document: dict[str, Any]) -> None:
    resources = document.get("resources", [])
    stream_types: set[str] = set()
    for resource in resources:
        if resource == "stream":
            stream_types.update(("movie", "series"))
        elif isinstance(resource, dict) and resource.get("name") == "stream":
            stream_types.update(str(value) for value in resource.get("types", []))
    missing = sorted({"movie", "series"} - stream_types)
    if missing:
        raise PolicyError("MediaFusion manifest lacks stream types: " + ", ".join(missing))


def write_put_payload(document: dict[str, Any], output: str) -> None:
    uuid = os.environ.get("AIOSTREAMS_UUID", "")
    password = os.environ.get("AIOSTREAMS_PASSWORD", "")
    if not uuid or not password:
        raise PolicyError("AIOSTREAMS_UUID and AIOSTREAMS_PASSWORD are required")
    _write_private(output, {"uuid": uuid, "password": password, "config": _config(document)})


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=("prepare-mediafusion", "prepare-put", "verify-mediafusion", "verify-manifest"),
    )
    parser.add_argument("input")
    parser.add_argument("output", nargs="?")
    args = parser.parse_args()
    try:
        document = _load(args.input)
        if args.command == "prepare-mediafusion":
            if not args.output:
                raise PolicyError("prepare-mediafusion requires an output path")
            updated = enable_mediafusion(document)
            write_put_payload(updated, args.output)
            print(
                "MediaFusion plan: enabled; HTTPS base integration; stream-only movie/series; "
                "TorBox+Real-Debrid; cached-search-only; Torrentio/Comet/MediaFusion primary; "
                "parallel conditional Easynews fallback"
            )
        elif args.command == "prepare-put":
            if not args.output:
                raise PolicyError("prepare-put requires an output path")
            write_put_payload(document, args.output)
        elif args.command == "verify-mediafusion":
            errors = mediafusion_policy_errors(document)
            if errors:
                raise PolicyError("; ".join(errors))
            print(
                "MediaFusion policy verified: enabled through AIOStreams; stream-only movie/series; "
                "TorBox+Real-Debrid; cached-search-only; parallel conditional Easynews fallback"
            )
        else:
            validate_manifest(document)
            print("MediaFusion manifest verified: movie and series stream capabilities")
    except (OSError, ValueError, TypeError, PolicyError) as error:
        print(f"aiostreams-policy: {error}", file=os.sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
