#!/usr/bin/env python3
"""Privacy-safe, display-neutral canary for a candidate Mango yt-dlp runtime."""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import subprocess
import sys
import urllib.request
from urllib.parse import urlsplit
from dataclasses import dataclass
from typing import Any


YOUTUBE_FORMAT = (
    "bv*[height<=1080][protocol^=m3u8]+ba[protocol^=m3u8]/"
    "bv*[height<=1080]+ba/b[height<=1080][protocol^=m3u8]"
)
YOUTUBE_FORMAT_SORT = "res:1080,fps,vcodec:vp9:vp9.2:av01:h264,acodec:opus:mp4a"


@dataclass(frozen=True)
class Probe:
    label: str
    target: str
    dynamic: bool
    required: bool
    kind: str


def read_json(path: pathlib.Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def pot_provider_url() -> str:
    fallback = "http://127.0.0.1:4416"
    configured = os.environ.get("MANGO_YOUTUBE_POT_URL", "").strip()
    if not configured:
        return fallback
    try:
        parsed = urlsplit(configured)
        if (
            parsed.scheme != "http"
            or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
            or parsed.username
            or parsed.password
        ):
            return fallback
        port = f":{parsed.port}" if parsed.port else ""
        host = f"[{parsed.hostname}]" if parsed.hostname == "::1" else parsed.hostname
        return f"http://{host}{port}"
    except ValueError:
        return fallback


def cookie_file() -> pathlib.Path | None:
    configured = os.environ.get("MANGO_YTDLP_COOKIES", "").strip()
    candidate = pathlib.Path(configured or "/etc/mango/youtube-cookies.txt")
    return candidate if candidate.is_file() else None


def account_required(stderr: str) -> bool:
    return bool(re.search(
        r"confirm (?:your )?age|age[- ]restricted|members[- ]only|"
        r"private video|login required|sign in to confirm "
        r"(?:you(?:'|’)re|you are) not a bot",
        stderr,
        flags=re.IGNORECASE,
    ))


def fixed_probes(repo_root: pathlib.Path) -> list[Probe]:
    corpus = read_json(repo_root / "scripts/m6-ship/youtube-acceptance-corpus.json")
    wanted = ("ordinary_vod", "music", "made_for_kids", "hls_live")
    found: dict[str, Probe] = {}
    for item in corpus.get("items") or []:
        if not isinstance(item, dict):
            continue
        label = str(item.get("id") or "")
        video_id = str(item.get("video_id") or "")
        target = str(item.get("url") or "")
        if not target and video_id:
            target = f"https://www.youtube.com/watch?v={video_id}"
        if label in wanted and target:
            found[label] = Probe(
                label=label,
                target=target,
                dynamic=False,
                required=item.get("required") is True,
                kind=str(item.get("kind") or "vod"),
            )
    return [found[label] for label in wanted if label in found]


def dynamic_probes(catalog_url: str) -> list[Probe]:
    url = catalog_url.rstrip("/") + "/youtube/rails"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            payload = json.load(response)
    except Exception:
        return []
    if not isinstance(payload, dict):
        return []
    ids: list[str] = []
    for rail in payload.get("rails") or []:
        if not isinstance(rail, dict):
            continue
        for item in rail.get("items") or []:
            if not isinstance(item, dict) or item.get("kind") != "video":
                continue
            video_id = str(item.get("id") or "").strip()
            if video_id and video_id not in ids:
                ids.append(video_id)
            if len(ids) >= 3:
                break
        if len(ids) >= 3:
            break
    return [
        Probe(
            label=f"dynamic_{index}",
            target=f"https://www.youtube.com/watch?v={video_id}",
            dynamic=True,
            required=True,
            kind="current_rail",
        )
        for index, video_id in enumerate(ids, 1)
    ]


def resolved_urls(stdout: str) -> list[str]:
    return [
        line.strip()
        for line in stdout.splitlines()
        if line.strip().lower().startswith(("http://", "https://"))
    ][:2]


def resolved_meta(stdout: str) -> tuple[str, int | None, str]:
    for line in stdout.splitlines():
        if not line.startswith("MANGO_CANARY:"):
            continue
        fields = line.removeprefix("MANGO_CANARY:").split("|")
        if len(fields) < 3:
            return "", None, ""
        try:
            height = int(float(fields[1]))
        except (TypeError, ValueError):
            height = None
        return fields[0], height if height and height > 0 else None, fields[2]
    return "", None, ""


def transport_stream_types(url: str, timeout_sec: int) -> set[str]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-rw_timeout",
        str(timeout_sec * 1_000_000),
        "-probesize",
        "65536",
        "-analyzeduration",
        "1000000",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "json",
        url,
    ]
    try:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=timeout_sec + 2,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return set()
    if result.returncode != 0:
        return set()
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return set()
    return {
        str(stream.get("codec_type") or "")
        for stream in payload.get("streams") or []
        if isinstance(stream, dict)
    } & {"audio", "video"}


def probe_one(
    probe: Probe,
    yt_dlp: pathlib.Path,
    deno: pathlib.Path,
    timeout_sec: int,
    resolve_only: bool,
) -> tuple[bool, str]:
    command = [
        str(yt_dlp),
        "--ignore-config",
        "--no-playlist",
        "--no-warnings",
        "--socket-timeout",
        "8",
        "--js-runtimes",
        f"deno:{deno}",
    ]
    if os.environ.get("MANGO_YOUTUBE_POT", "1") != "0":
        command.extend([
            "--extractor-args",
            f"youtubepot-bgutilhttp:base_url={pot_provider_url()}",
        ])
    command.extend([
        "-f",
        YOUTUBE_FORMAT,
        "--format-sort",
        YOUTUBE_FORMAT_SORT,
        "--print",
        "MANGO_CANARY:%(live_status)s|%(height)s|%(protocol)s",
        "-g",
        probe.target,
    ])
    try:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return False, "resolve_timeout"
    except OSError:
        return False, "resolver_missing"
    cookies = cookie_file()
    if result.returncode != 0 and cookies and account_required(result.stderr):
        authenticated = [*command[:-1], "--cookies", str(cookies), command[-1]]
        try:
            result = subprocess.run(
                authenticated,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False, "cookie_resolve_timeout"
        except OSError:
            return False, "resolver_missing"
    if result.returncode != 0:
        return False, "resolve_failed"
    urls = resolved_urls(result.stdout)
    if not urls:
        return False, "no_urls"
    live_status, height, protocol = resolved_meta(result.stdout)
    if height is not None and height > 1080:
        return False, "height_policy"
    if probe.kind == "live" and (
        live_status != "is_live" or "m3u8" not in protocol.lower()
    ):
        return False, "live_policy"
    if not resolve_only:
        streams = [
            transport_stream_types(url, min(12, timeout_sec))
            for url in urls
        ]
        if any(not stream_types for stream_types in streams):
            return False, "transport_failed"
        if {"audio", "video"} - set().union(*streams):
            return False, "transport_incomplete"
    return True, "pass"


def fixture_result(value: str, yt_dlp: pathlib.Path) -> int:
    ok = value == "pass"
    if value == "revision":
        revision = os.environ.get("MANGO_YTDLP_TEST_REVISION", "")
        meta = read_json(yt_dlp.resolve().parents[2] / "meta.json")
        if meta.get("revision"):
            revision = str(meta["revision"])
        ok = revision == os.environ.get("MANGO_YTDLP_CANARY_PASS_REVISION", "")
    print(json.dumps({
        "ok": ok,
        "total": 7,
        "passed": 6 if ok else 0,
        "required_total": 6,
        "required_passed": 6 if ok else 0,
        "advisory_total": 1,
        "advisory_passed": 0,
        "dynamic_total": 3,
        "dynamic_passed": 3 if ok else 0,
        "transport": True,
        "failures": {} if ok else {"fixture": 4},
    }, sort_keys=True))
    return 0 if ok else 1


def summarize_results(
    results: list[tuple[Probe, bool, str]],
    resolve_only: bool,
) -> dict[str, Any]:
    passed = sum(1 for _, ok, _ in results if ok)
    required_total = sum(1 for probe, _, _ in results if probe.required)
    required_passed = sum(1 for probe, ok, _ in results if probe.required and ok)
    advisory_total = sum(1 for probe, _, _ in results if not probe.required)
    advisory_passed = sum(1 for probe, ok, _ in results if not probe.required and ok)
    dynamic_total = sum(1 for probe, _, _ in results if probe.dynamic)
    dynamic_passed = sum(1 for probe, ok, _ in results if probe.dynamic and ok)
    fixed_passed = {
        probe.label
        for probe, ok, _ in results
        if not probe.dynamic and ok
    }
    failures: dict[str, int] = {}
    advisories: dict[str, int] = {}
    for probe, ok, reason in results:
        if not ok:
            destination = failures if probe.required else advisories
            destination[reason] = destination.get(reason, 0) + 1

    required_fixed = {"ordinary_vod", "music", "hls_live"}
    ok = (
        dynamic_passed == dynamic_total
        and required_fixed.issubset(fixed_passed)
        and required_total >= 3
        and required_passed == required_total
    )
    return {
        "ok": ok,
        "total": len(results),
        "passed": passed,
        "required_total": required_total,
        "required_passed": required_passed,
        "advisory_total": advisory_total,
        "advisory_passed": advisory_passed,
        "dynamic_total": dynamic_total,
        "dynamic_passed": dynamic_passed,
        "transport": not resolve_only,
        "failures": failures,
        "advisories": advisories,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--yt-dlp", required=True, type=pathlib.Path)
    parser.add_argument("--repo-root", type=pathlib.Path)
    parser.add_argument("--deno", type=pathlib.Path)
    parser.add_argument("--catalog-url", default=os.environ.get(
        "MANGO_CATALOG_URL",
        f"http://127.0.0.1:{os.environ.get('MANGO_CATALOG_PORT', '3020')}",
    ))
    parser.add_argument("--timeout-sec", type=int, default=30)
    parser.add_argument("--resolve-only", action="store_true")
    args = parser.parse_args()

    fixture = os.environ.get("MANGO_YTDLP_CANARY_FIXTURE", "").strip().lower()
    if fixture and os.environ.get("MANGO_YTDLP_TEST_MODE") != "1":
        raise SystemExit("canary fixtures require MANGO_YTDLP_TEST_MODE=1")
    if fixture in {"pass", "fail", "revision"}:
        return fixture_result(fixture, args.yt_dlp)

    repo_root = args.repo_root or pathlib.Path(__file__).resolve().parents[2]
    deno = args.deno or pathlib.Path.home() / ".local/share/mango/deno/bin/deno"
    if not args.yt_dlp.is_file() or not os.access(args.yt_dlp, os.X_OK) or not deno.is_file():
        print(json.dumps({
            "ok": False,
            "total": 0,
            "passed": 0,
            "required_total": 0,
            "required_passed": 0,
            "advisory_total": 0,
            "advisory_passed": 0,
            "dynamic_total": 0,
            "dynamic_passed": 0,
            "transport": not args.resolve_only,
            "failures": {"runtime_missing": 1},
        }, sort_keys=True))
        return 1

    dynamic = dynamic_probes(args.catalog_url)
    fixed = fixed_probes(repo_root)
    probes = dynamic + fixed
    results: list[tuple[Probe, bool, str]] = [
        (
            probe,
            *probe_one(
                probe,
                args.yt_dlp,
                deno,
                max(10, min(args.timeout_sec, 60)),
                args.resolve_only,
            ),
        )
        for probe in probes
    ]
    summary = summarize_results(results, args.resolve_only)
    print(json.dumps(summary, sort_keys=True))
    return 0 if summary["ok"] is True else 1


if __name__ == "__main__":
    sys.exit(main())
