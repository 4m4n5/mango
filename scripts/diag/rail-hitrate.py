#!/usr/bin/env python3
"""Per-rail playability diagnostic — pool depth, stream resolve, optional play hit-rate."""

from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict

CATALOG = os.environ.get("MANGO_CATALOG_URL", "http://127.0.0.1:3020")
REPO = os.environ.get("MANGO_REPO_DIR", os.path.expanduser("~/mango"))
PER_RAIL = int(os.environ.get("MANGO_RAIL_HITRATE_PER_RAIL", "2"))
DO_PLAY = os.environ.get("MANGO_RAIL_HITRATE_PLAY", "1") == "1"
SEED = int(os.environ.get("MANGO_RAIL_HITRATE_SEED", str(int(time.time()))))
MPV_STOP = ["bash", "scripts/m2-catalog/service/mpv-stop.sh"]


def fetch_json(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 120) -> dict:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def run_pick(pick: dict) -> dict:
    row: dict = {**pick, "stream_ok": False, "play_ok": False}
    try:
        stream_data = fetch_json(f"{CATALOG}/stream/{pick['type']}/{pick['id']}", timeout=90)
        row["stream_ok"] = True
        filt = stream_data.get("filters") or {}
        row["kept"] = filt.get("kept", 0)
        row["excluded"] = filt.get("excluded")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body[:200]}
        row["stream_error"] = err.get("error", body[:200])
        return row

    if not DO_PLAY:
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
        row["attempts"] = play.get("attempts")
        stream = play.get("stream") or {}
        row["win_debrid"] = stream.get("debrid_service")
        row["win_cache"] = stream.get("cache_status")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            err = json.loads(body)
        except json.JSONDecodeError:
            err = {"error": body[:200]}
        row["play_error"] = err.get("error", body[:200])
    finally:
        subprocess.run(MPV_STOP, cwd=REPO, capture_output=True)
    return row


def main() -> int:
    rng = random.Random(SEED)
    rails = fetch_json(f"{CATALOG}/rails", timeout=30).get("rails") or []
    rail_ids = [r["id"] for r in rails if r.get("id")]

    print("========== mango rail playability diagnostic ==========")
    print(f"rails={len(rail_ids)} per_rail_sample={PER_RAIL} play={DO_PLAY} seed={SEED}")
    print()

    inventory: list[dict] = []
    all_results: list[dict] = []

    for rail_id in rail_ids:
        try:
            data = fetch_json(f"{CATALOG}/rails/{rail_id}/items", timeout=90)
        except Exception as exc:
            print(f"FAIL inventory {rail_id}: {exc}")
            continue
        pb = data.get("playability") or {}
        items = data.get("items") or []
        inv = {
            "rail_id": rail_id,
            "label": data.get("label", rail_id),
            "displayed": len(items),
            "verified_pool": int(pb.get("verified_pool") or 0),
            "pending": int(pb.get("pending") or 0),
            "low_water": bool(pb.get("low_water")),
        }
        inventory.append(inv)

    print(f"{'rail':28} {'shown':>5} {'pool':>5} {'pend':>5} {'low':>4}")
    print("-" * 52)
    for inv in inventory:
        print(
            f"{inv['rail_id'][:28]:28} "
            f"{inv['displayed']:5d} "
            f"{inv['verified_pool']:5d} "
            f"{inv['pending']:5d} "
            f"{'Y' if inv['low_water'] else 'n':>4}"
        )
    print()

    for inv in inventory:
        rail_id = inv["rail_id"]
        try:
            data = fetch_json(f"{CATALOG}/rails/{rail_id}/items", timeout=90)
        except Exception:
            continue
        items = data.get("items") or []
        if not items:
            print(f"--- {rail_id}: no display items — skip playability sample ---")
            continue

        sample = items if len(items) <= PER_RAIL else rng.sample(items, PER_RAIL)
        print(f"--- {rail_id} ({inv['label']}) sample={len(sample)} ---")
        for item in sample:
            pick = {
                "rail": rail_id,
                "type": item["type"],
                "id": item["id"],
                "title": item.get("title") or item.get("id"),
            }
            row = run_pick(pick)
            all_results.append(row)
            stream = "stream OK" if row.get("stream_ok") else "stream FAIL"
            play = ""
            if DO_PLAY:
                play = f" play {'OK' if row.get('play_ok') else 'FAIL'}"
                if row.get("total_ms"):
                    play += f" {row['total_ms']}ms"
            kept = row.get("kept", "-")
            print(f"  {pick['title'][:40]:40} {stream} kept={kept}{play}")

    by_rail: dict[str, list[dict]] = defaultdict(list)
    for row in all_results:
        by_rail[row["rail"]].append(row)

    print()
    print("========== per-rail hit-rate (sampled) ==========")
    print(f"{'rail':28} {'n':>3} {'stream':>8} {'play':>8}")
    print("-" * 52)
    total_stream = total_play = total_n = 0
    for rail_id in rail_ids:
        rows = by_rail.get(rail_id, [])
        if not rows:
            continue
        n = len(rows)
        s_ok = sum(1 for r in rows if r.get("stream_ok"))
        p_ok = sum(1 for r in rows if r.get("play_ok")) if DO_PLAY else 0
        total_n += n
        total_stream += s_ok
        total_play += p_ok
        play_col = f"{p_ok}/{n}" if DO_PLAY else "—"
        print(f"{rail_id[:28]:28} {n:3d} {s_ok}/{n:>6} {play_col:>8}")

    if total_n:
        print("-" * 52)
        play_summary = f"{total_play}/{total_n} ({100*total_play/total_n:.0f}%)" if DO_PLAY else "—"
        print(
            f"{'TOTAL':28} {total_n:3d} "
            f"{total_stream}/{total_n} ({100*total_stream/total_n:.0f}%) "
            f"{play_summary:>8}"
        )

    out = f"/tmp/mango-rail-hitrate-{SEED}.json"
    with open(out, "w", encoding="utf-8") as handle:
        json.dump(
            {
                "seed": SEED,
                "per_rail": PER_RAIL,
                "play": DO_PLAY,
                "inventory": inventory,
                "results": all_results,
            },
            handle,
            indent=2,
        )
    print(f"\nwritten {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
