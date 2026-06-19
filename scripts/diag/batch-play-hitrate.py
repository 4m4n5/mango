#!/usr/bin/env python3
"""Batch play hit-rate audit — random catalog picks, stream filter + POST /play."""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request

CATALOG = "http://127.0.0.1:3020"
MPV_STOP = ["bash", "scripts/phase-n1/mpv-stop.sh"]
SAMPLE = int(sys.argv[1]) if len(sys.argv) > 1 else 10
SEED = int(sys.argv[2]) if len(sys.argv) > 2 else int(time.time())
MIN_OK = int(os.environ.get("MANGO_HITRATE_MIN_OK", max(1, SAMPLE * 8 // 10)))


def fetch_json(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 120) -> dict:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def rail_items() -> list[dict]:
    rails = fetch_json(f"{CATALOG}/rails", timeout=30).get("rails") or []
    pool: list[dict] = []
    for rail in rails:
        rid = rail.get("id")
        if not rid:
            continue
        try:
            data = fetch_json(f"{CATALOG}/rails/{rid}/items", timeout=90)
        except Exception:
            continue
        for item in data.get("items") or []:
            if item.get("id") and item.get("type"):
                pool.append(
                    {
                        "rail": rid,
                        "type": item["type"],
                        "id": item["id"],
                        "title": item.get("title") or item.get("id"),
                    }
                )
    return pool


def summarize_stream(data: dict) -> dict:
    filt = data.get("filters") or {}
    streams = data.get("streams") or []
    first = streams[0] if streams else {}
    return {
        "kept": filt.get("kept", 0),
        "excluded": filt.get("excluded"),
        "fallback": filt.get("torbox_uncached_fallback"),
        "first_source": first.get("source"),
        "first_debrid": first.get("debrid_service"),
        "first_cache": first.get("cache_status"),
        "first_title": (first.get("title") or first.get("name") or "")[:60],
    }


def main() -> int:
    pool = rail_items()
    if not pool:
        print("no rail items", file=sys.stderr)
        return 1

    rng = random.Random(SEED)
    picks = rng.sample(pool, min(SAMPLE, len(pool)))
    print(f"batch-play-hitrate sample={len(picks)} seed={SEED}")
    results: list[dict] = []

    for index, pick in enumerate(picks, start=1):
        label = f"{pick['title']} ({pick['id']})"
        row: dict = {"index": index, **pick, "stream_ok": False, "play_ok": False}
        print(f"\n[{index}/{len(picks)}] {label}")

        try:
            stream_data = fetch_json(f"{CATALOG}/stream/{pick['type']}/{pick['id']}", timeout=90)
            row["stream_ok"] = True
            row.update(summarize_stream(stream_data))
            print(
                f"  stream kept={row['kept']} fallback={row['fallback']} "
                f"first={row['first_debrid']} cache={row['first_cache']}"
            )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            try:
                err = json.loads(body)
            except json.JSONDecodeError:
                err = {"error": body[:200]}
            row["stream_error"] = err.get("error", body[:200])
            row["excluded"] = (err.get("filters") or {}).get("excluded")
            print(f"  stream FAIL: {row['stream_error'][:120]}")
            results.append(row)
            continue

        subprocess.run(MPV_STOP, cwd="/home/aman/mango", capture_output=True)
        started = time.time()
        try:
            play = fetch_json(
                f"{CATALOG}/play",
                method="POST",
                body={"type": pick["type"], "id": pick["id"]},
                timeout=120,
            )
            row["play_ok"] = play.get("ok") is True
            row["total_ms"] = play.get("total_ms")
            row["ttff_ms"] = play.get("ttff_ms")
            row["attempts"] = play.get("attempts")
            stream = play.get("stream") or {}
            row["win_source"] = stream.get("source")
            row["win_debrid"] = stream.get("debrid_service")
            row["win_cache"] = stream.get("cache_status")
            row["win_quality"] = stream.get("quality")
            print(
                f"  play {'OK' if row['play_ok'] else 'FAIL'} "
                f"total={row.get('total_ms')}ms attempts={row.get('attempts')} "
                f"via {row.get('win_debrid')} {row.get('win_quality')}"
            )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode(errors="replace")
            try:
                err = json.loads(body)
            except json.JSONDecodeError:
                err = {"error": body[:200]}
            row["play_error"] = err.get("error", body[:200])
            row["play_attempts"] = err.get("attempts")
            print(f"  play FAIL: {row['play_error'][:120]}")
        row["elapsed_s"] = round(time.time() - started, 1)
        subprocess.run(MPV_STOP, cwd="/home/aman/mango", capture_output=True)
        results.append(row)

    stream_ok = sum(1 for r in results if r.get("stream_ok"))
    play_ok = sum(1 for r in results if r.get("play_ok"))
    print("\n=== summary ===")
    print(f"stream_resolved: {stream_ok}/{len(results)}")
    print(f"play_ok: {play_ok}/{len(results)} (min {MIN_OK})")
    for r in results:
        status = "PLAY" if r.get("play_ok") else ("STREAM" if r.get("stream_ok") else "FAIL")
        print(f"  [{status}] {r.get('title')} kept={r.get('kept', 0)} fb={r.get('fallback')}")

    out = f"/tmp/mango-hitrate-{SEED}.json"
    with open(out, "w", encoding="utf-8") as handle:
        json.dump({"seed": SEED, "results": results}, handle, indent=2)
    print(f"written {out}")
    return 0 if play_ok >= MIN_OK else 2


if __name__ == "__main__":
    raise SystemExit(main())
