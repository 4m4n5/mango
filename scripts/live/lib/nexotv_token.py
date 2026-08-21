#!/usr/bin/env python3
"""Build NexoTV config token (encrypt or base64url fallback)."""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.request


def encode_base64url(config: dict) -> str:
    raw = json.dumps(config, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    b64 = base64.b64encode(raw).decode("ascii")
    return b64.replace("+", "-").replace("/", "_").rstrip("=")


def encrypt_config(base_url: str, config: dict) -> str | None:
    payload = json.dumps(config).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url.rstrip('/')}/encrypt",
        data=payload,
        headers={"content-type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.load(resp)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
        return None
    token = body.get("token")
    return token if isinstance(token, str) and token else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Encode NexoTV addon config to token")
    parser.add_argument("config_json", help="Path to config JSON object")
    parser.add_argument("--base-url", default="http://127.0.0.1:7000")
    args = parser.parse_args()

    with open(args.config_json, encoding="utf-8") as fh:
        config = json.load(fh)
    if not isinstance(config, dict):
        print("config must be a JSON object", file=sys.stderr)
        return 2

    token = encrypt_config(args.base_url, config)
    mode = "encrypt"
    if not token:
        token = encode_base64url(config)
        mode = "base64url"

    manifest_url = f"{args.base_url.rstrip('/')}/{token}/manifest.json"
    print(json.dumps({
        "mode": mode,
        "token": token,
        "manifest_url": manifest_url,
        "profile": config.get("catalogName") or config.get("provider"),
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
