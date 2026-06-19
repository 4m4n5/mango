#!/usr/bin/env python3
"""Exhaustive play hit-rate study — multi-seed, failure taxonomy, recommendations."""

from __future__ import annotations

import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import Counter, defaultdict

CATALOG = "http://127.0.0.1:3020"
MPV_STOP = ["bash", "scripts/phase-n1/mpv-stop.sh"]
REPO = os.environ.get("MANGO_REPO_DIR", os.path.expanduser("~/mango"))

SAMPLE = int(sys.argv[1]) if len(sys.argv) > 1 else 30
SEEDS = [int(s) for s in sys.argv[2:]] if len(sys.argv) > 2 else [42, 7, 99, 123, 456]


def fetch_json(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 150) -> dict:
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


def classify_failure(row: dict) -> str:
    if row.get("play_ok"):
        return "play_ok"
    if not row.get("stream_ok"):
        excl = row.get("excluded") or {}
        if (excl.get("title_mismatch") or 0) > 0 and row.get("kept", 0) == 0:
            return "filter_title_mismatch"
        if (excl.get("uncached_debrid") or 0) > 0 and row.get("kept", 0) == 0:
            return "filter_all_uncached"
        return "filter_no_streams"
    err = (row.get("play_error") or "").lower()
    attempts = row.get("play_attempts") or []
    attempt_text = " ".join(
        (a.get("error") or "").lower() for a in attempts if isinstance(a, dict)
    )
    blob = f"{err} {attempt_text}"
    if "debrid_status_clip" in blob:
        return "play_status_clip"
    if "debrid_copyright" in blob:
        return "play_rd_copyright"
    if "did not start playback" in blob or "timeout" in blob:
        return "play_timeout"
    if "no_playable_stream" in blob:
        return "play_exhausted_candidates"
    return "play_other"


def run_pick(pick: dict) -> dict:
    row: dict = {**pick, "stream_ok": False, "play_ok": False}
    try:
        stream_data = fetch_json(f"{CATALOG}/stream/{pick['type']}/{pick['id']}", timeout=90)
        row["stream_ok"] = True
        filt = stream_data.get("filters") or {}
        streams = stream_data.get("streams") or []
        row["kept"] = filt.get("kept", 0)
        row["excluded"] = filt.get("excluded")
        row["fallback_tb"] = filt.get("torbox_uncached_fallback")
        row["fallback_rd"] = filt.get("rd_safe_unknown_fallback")
        row["candidates_preview"] = [
            {
                "source": s.get("source"),
                "debrid": s.get("debrid_service"),
                "cache": s.get("cache_status"),
                "title": (s.get("title") or "")[:50],
            }
            for s in streams[:5]
        ]
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body[:300]}
        row["stream_error"] = err.get("error", body[:300])
        row["excluded"] = (err.get("filters") or {}).get("excluded")
        row["failure"] = classify_failure(row)
        return row

    subprocess.run(MPV_STOP, cwd=REPO, capture_output=True)
    try:
        play = fetch_json(
            f"{CATALOG}/play",
            method="POST",
            body={"type": pick["type"], "id": pick["id"]},
            timeout=150,
        )
        row["play_ok"] = play.get("ok") is True
        row["total_ms"] = play.get("total_ms")
        row["ttff_ms"] = play.get("ttff_ms")
        row["attempt_count"] = play.get("attempts")
        row["candidate_count"] = play.get("candidate_count")
        stream = play.get("stream") or {}
        row["win"] = {
            "source": stream.get("source"),
            "debrid": stream.get("debrid_service"),
            "cache": stream.get("cache_status"),
            "quality": stream.get("quality"),
        }
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body[:300]}
        row["play_error"] = err.get("error", body[:300])
        row["play_attempts"] = err.get("attempts")
        row["candidate_count"] = err.get("candidates")
    subprocess.run(MPV_STOP, cwd=REPO, capture_output=True)
    row["failure"] = classify_failure(row)
    return row


def main() -> int:
    pool = rail_items()
    if not pool:
        print("no rail items", file=sys.stderr)
        return 1

    all_results: list[dict] = []
    seen_ids: set[str] = set()

    print(f"exhaustive-hitrate pool={len(pool)} sample_per_seed={SAMPLE} seeds={SEEDS}")
    started = time.time()

    for seed in SEEDS:
        rng = random.Random(seed)
        available = [item for item in pool if item["id"] not in seen_ids]
        if len(available) < SAMPLE:
            available = pool
        picks = rng.sample(available, min(SAMPLE, len(available)))
        for pick in picks:
            seen_ids.add(pick["id"])
        print(f"\n--- seed {seed} ({len(picks)} picks) ---")
        for index, pick in enumerate(picks, start=1):
            label = f"{pick['title']} ({pick['id']})"
            print(f"[{index}/{len(picks)}] {label} ...", flush=True)
            row = run_pick(pick)
            row["seed"] = seed
            all_results.append(row)
            status = "OK" if row.get("play_ok") else row.get("failure", "FAIL")
            kept = row.get("kept", 0)
            print(f"  -> {status} kept={kept} attempts={row.get('attempt_count', row.get('candidate_count', '?'))}")

    failures = Counter(r.get("failure", "?") for r in all_results)
    play_ok = sum(1 for r in all_results if r.get("play_ok"))
    stream_ok = sum(1 for r in all_results if r.get("stream_ok"))
    total = len(all_results)
    elapsed = round(time.time() - started, 1)

    wins_by_debrid = Counter((r.get("win") or {}).get("debrid", "?") for r in all_results if r.get("play_ok"))
    wins_by_cache = Counter((r.get("win") or {}).get("cache", "?") for r in all_results if r.get("play_ok"))
    fallback_tb = sum(1 for r in all_results if r.get("play_ok") and r.get("fallback_tb"))

    print("\n========== EXHAUSTIVE SUMMARY ==========")
    print(f"titles_tested: {total}  elapsed_s: {elapsed}")
    print(f"stream_resolved: {stream_ok}/{total} ({100*stream_ok/total:.1f}%)")
    print(f"play_ok: {play_ok}/{total} ({100*play_ok/total:.1f}%)")
    print("failure_taxonomy:")
    for key, count in failures.most_common():
        print(f"  {key}: {count}")
    print("wins_by_debrid:", dict(wins_by_debrid))
    print("wins_by_cache:", dict(wins_by_cache))
    print(f"wins_after_tb_fallback: {fallback_tb}")

    hard_fails = [r for r in all_results if r.get("failure") == "filter_all_uncached"]
    if hard_fails:
        print("\nall_uncached (no TB cached) sample:")
        for r in hard_fails[:8]:
            print(f"  - {r.get('title')} ({r.get('id')})")

    out = f"/tmp/mango-exhaustive-{int(time.time())}.json"
    report = {
        "sample_per_seed": SAMPLE,
        "seeds": SEEDS,
        "total": total,
        "stream_ok": stream_ok,
        "play_ok": play_ok,
        "failures": dict(failures),
        "wins_by_debrid": dict(wins_by_debrid),
        "wins_by_cache": dict(wins_by_cache),
        "results": all_results,
    }
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(f"\nwritten {out}")

    min_rate = float(os.environ.get("MANGO_EXHAUSTIVE_MIN_RATE", "0.65"))
    rate = play_ok / total if total else 0
    return 0 if rate >= min_rate else 2


if __name__ == "__main__":
    raise SystemExit(main())
