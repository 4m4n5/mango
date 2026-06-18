#!/usr/bin/env python3
"""Read installed Stremio addons from Qt WebEngine Local Storage on the Pi.

The logged-in Stremio desktop syncs addon descriptors into leveldb under
~/.local/share/Smart Code ltd/Stremio/QtWebEngine/Default/Local Storage/leveldb

Output shape matches config/stremio-export.example.json for catalog-service.
Secrets (RD/TorBox keys embedded in Torrentio URLs) stay in the export file only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

DEFAULT_LEVELDB = Path.home() / (
    ".local/share/Smart Code ltd/Stremio/QtWebEngine/Default/Local Storage/leveldb"
)


def find_leveldb(path: Path | None) -> Path:
    candidate = path or DEFAULT_LEVELDB
    if not candidate.is_dir():
        raise FileNotFoundError(
            f"Stremio local storage not found: {candidate}\n"
            "Log into Stremio on the Pi and open Settings once, then retry."
        )
    return candidate


def load_leveldb_blob(leveldb: Path) -> bytes:
    parts: list[bytes] = []
    for entry in sorted(leveldb.iterdir()):
        if entry.is_file() and entry.suffix in {".ldb", ".log"}:
            parts.append(entry.read_bytes())
    if not parts:
        raise RuntimeError(f"no leveldb files in {leveldb}")
    return b"".join(parts)


def extract_addons_array(blob: bytes) -> list[dict]:
    markers = [b"\x00addons\x00[{", b"addons\n[{", b'[{"transportUrl"']
    start = -1
    for marker in markers:
        idx = blob.find(marker)
        if idx < 0:
            continue
        if marker == b'[{"transportUrl"':
            start = idx
        else:
            start = idx + len(marker) - 2  # point at [
        break
    if start < 0:
        raise RuntimeError("addons array not found in Stremio local storage")

    depth = 0
    end = start
    limit = min(start + 800_000, len(blob))
    for i in range(start, limit):
        ch = blob[i]
        if ch == ord("["):
            depth += 1
        elif ch == ord("]"):
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    else:
        raise RuntimeError("could not parse addons JSON array boundary")

    raw = blob[start:end].decode("utf-8", errors="replace")
    data = json.loads(raw)
    if not isinstance(data, list):
        raise RuntimeError("addons payload is not a list")
    return data


def to_export(addons: list[dict]) -> dict:
    out: list[dict[str, str]] = []
    for entry in addons:
        if not isinstance(entry, dict):
            continue
        url = entry.get("transportUrl") or entry.get("manifestUrl") or ""
        if not url:
            continue
        manifest = entry.get("manifest") if isinstance(entry.get("manifest"), dict) else {}
        name = (
            manifest.get("name")
            or entry.get("transportName")
            or entry.get("name")
            or url.split("/")[2]
        )
        out.append({"name": str(name), "manifestUrl": str(url)})
    if not out:
        raise RuntimeError("no addons with transportUrl found")
    return {"addons": out, "auth": {}, "source": "stremio-local-leveldb"}


def redact_url(url: str) -> str:
    return re.sub(r"(realdebrid=|torbox=)[^/%]+", r"\1***", url, flags=re.I)


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Stremio addons from Pi local storage")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path("/etc/mango/stremio-export.json"),
        help="write export JSON here",
    )
    parser.add_argument(
        "--leveldb",
        type=Path,
        default=None,
        help="override leveldb directory",
    )
    parser.add_argument("--stdout", action="store_true", help="print JSON to stdout, do not write")
    args = parser.parse_args()

    leveldb = find_leveldb(args.leveldb)
    blob = load_leveldb_blob(leveldb)
    addons = extract_addons_array(blob)
    export = to_export(addons)

    if args.stdout:
        json.dump(export, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(export, indent=2) + "\n", encoding="utf-8")
    args.output.chmod(0o600)

    print(f"✓ Wrote {len(export['addons'])} addons → {args.output}")
    for item in export["addons"]:
        print(f"  - {item['name']}")
    print("  (manifest URLs contain debrid keys — never commit this file)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, json.JSONDecodeError, FileNotFoundError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
