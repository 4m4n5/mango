#!/usr/bin/env python3
"""Human-readable ops report — nightly top-ups, companion updates, agent reasoning."""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

PDT = ZoneInfo("America/Los_Angeles")


def ops_root() -> Path:
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "mango" / "ops"


def playability_db() -> Path:
    return Path(os.environ.get("MANGO_PLAYABILITY_DB", "/etc/mango/playability.db"))


def companion_db() -> Path:
    return Path(os.environ.get("MANGO_COMPANION_DIR", "/etc/mango/companion")) / "companion.db"


def load_events(date: str | None = None) -> list[dict[str, Any]]:
    path = ops_root() / "events.jsonl"
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if date and not str(event.get("ts", "")).startswith(date):
            continue
        events.append(event)
    return events


def load_reports(date: str) -> list[dict[str, Any]]:
    directory = ops_root() / "reports" / date
    if not directory.exists():
        return []
    reports: list[dict[str, Any]] = []
    for path in sorted(directory.glob("*.json")):
        try:
            reports.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return reports


def pdt_window_ms(date: str, start_hour: int, end_hour: int) -> tuple[int, int]:
    day = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=PDT)
    start = int((day + timedelta(hours=start_hour)).timestamp() * 1000)
    end = int((day + timedelta(hours=end_hour)).timestamp() * 1000)
    return start, end


def reconstruct_playability(date: str) -> dict[str, Any]:
    db_path = playability_db()
    if not db_path.exists():
        return {"error": f"playability db missing: {db_path}"}

    start_ms, end_ms = pdt_window_ms(date, 2, 4)  # 02:00–04:00 PDT (playability timer ~03:00)
    conn = sqlite3.connect(db_path)

    rows = conn.execute(
        """
        SELECT rail_id, type, id_value, outcome, started_at
        FROM verify_log
        WHERE started_at BETWEEN ? AND ?
        ORDER BY started_at
        """,
        (start_ms, end_ms),
    ).fetchall()

    by_rail: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"verified": [], "failed": [], "no_stream": [], "other": []},
    )
    for rail_id, type_, id_value, outcome, started_at in rows:
        entry = by_rail[rail_id]
        key = outcome if outcome in entry else "other"
        entry[key].append({"type": type_, "id": id_value, "ts_ms": started_at})

    # Current pools for context
    pool_rows = conn.execute(
        """
        SELECT rp.rail_id,
               COUNT(*) AS pool_depth,
               SUM(CASE WHEN t.status = 'verified' AND COALESCE(t.expires_at, 0) > CAST(strftime('%s','now') AS INTEGER) * 1000 THEN 1 ELSE 0 END) AS verified_pool
        FROM rail_pool rp
        JOIN titles t ON t.type = rp.type AND t.id = rp.id
        GROUP BY rp.rail_id
        ORDER BY rp.rail_id
        """,
    ).fetchall()
    current_pools = {
        row[0]: {"pool_depth": row[1], "verified_pool": row[2]} for row in pool_rows
    }

    verified_adds = {
        rail: len(data["verified"])
        for rail, data in by_rail.items()
        if rail and data["verified"]
    }

    return {
        "source": "verify_log_reconstruct",
        "window_pdt": f"{date} 02:00–04:00",
        "verify_events": len(rows),
        "verified_adds_by_rail": verified_adds,
        "total_verified_adds": sum(verified_adds.values()),
        "by_rail": dict(by_rail),
        "current_pools": current_pools,
    }


def reconstruct_companion(date: str) -> dict[str, Any]:
    db_path = companion_db()
    if not db_path.exists():
        return {"error": f"companion db missing: {db_path}"}

    start = f"{date}T00:00:00"
    end = f"{date}T23:59:59.999Z"
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        """
        SELECT id, created_at, event_type, payload
        FROM journal_events
        WHERE created_at >= ? AND created_at <= ?
        ORDER BY id
        """,
        (start, end),
    ).fetchall()

    events = []
    for row_id, created_at, event_type, payload_raw in rows:
        try:
            payload = json.loads(payload_raw) if payload_raw else {}
        except json.JSONDecodeError:
            payload = {"raw": payload_raw}
        events.append(
            {"id": row_id, "created_at": created_at, "event_type": event_type, "payload": payload},
        )

    by_type: dict[str, int] = defaultdict(int)
    for event in events:
        by_type[event["event_type"]] += 1

    return {"source": "companion_journal", "event_count": len(events), "by_type": dict(by_type), "events": events}


def format_rail_table(rails: list[dict[str, Any]]) -> str:
    if not rails:
        return "  (no rail deltas recorded)\n"
    lines = [
        f"  {'rail':28} {'before':>8} {'after':>8} {'delta':>6} {'failed':>7}",
        "  " + "-" * 62,
    ]
    for rail in sorted(rails, key=lambda row: row.get("rail_id", "")):
        before = int(rail.get("verified_before") or rail.get("before", {}).get("verified_pool") or 0)
        after = int(rail.get("verified_after") or rail.get("after", {}).get("verified_pool") or 0)
        delta = int(rail.get("verified_added", after - before))
        failed = int(rail.get("failed") or 0)
        marker = " *" if delta != 0 else ""
        lines.append(
            f"  {str(rail.get('rail_id', '-'))[:28]:28} {before:8d} {after:8d} {delta:+6d} {failed:7d}{marker}",
        )
    return "\n".join(lines) + "\n"


def print_report(date: str, *, reconstruct: bool = False) -> int:
    events = load_events(date)
    reports = load_reports(date)

    print(f"# mango ops report — {date}")
    print()

    # Scheduled tasks status
    print("## Scheduled nightly tasks")
    playability_events = [e for e in events if e.get("kind") in {"playability_refresh", "playability_maintenance"}]
    companion_events = [e for e in events if str(e.get("kind", "")).startswith("companion_")]

    if playability_events:
        print(f"- Playability maintenance: ran ({len(playability_events)} logged event(s))")
        for event in playability_events:
            print(f"  - {event.get('ts')} — {event.get('summary')}")
    elif reconstruct:
        recon = reconstruct_playability(date)
        if recon.get("verify_events"):
            print(f"- Playability maintenance: ran (reconstructed from verify_log, {recon['verify_events']} probes)")
            print(f"  - verified adds: {recon['total_verified_adds']} titles across {len(recon['verified_adds_by_rail'])} rails")
        else:
            print("- Playability maintenance: no activity detected in 02:00–06:00 PDT window")
    else:
        print("- Playability maintenance: no ops log (use --reconstruct for verify_log fallback)")

    if companion_events:
        print(f"- Companion nightly: ran ({len(companion_events)} logged event(s))")
        for event in companion_events:
            print(f"  - {event.get('ts')} [{event.get('kind')}] {event.get('summary')}")
    else:
        print("- Companion nightly: not logged (likely not scheduled — no crontab/timer)")

    print()

    # Rail deltas
    print("## Rail pool changes")
    rail_rows: list[dict[str, Any]] = []
    for event in events:
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        if isinstance(payload.get("rails"), list):
            rail_rows.extend(payload["rails"])
    for report in reports:
        if isinstance(report.get("rails"), list):
            rail_rows.extend(report["rails"])
        result = report.get("result")
        if isinstance(result, dict) and isinstance(result.get("rails"), list):
            for rail in result["rails"]:
                rail_rows.append(
                    {
                        "rail_id": rail.get("rail_id"),
                        "label": rail.get("label"),
                        "verified_before": rail.get("before", {}).get("verified_pool"),
                        "verified_after": rail.get("after", {}).get("verified_pool"),
                        "verified_added": (rail.get("after", {}).get("verified_pool") or 0)
                        - (rail.get("before", {}).get("verified_pool") or 0),
                        "failed": rail.get("failed"),
                    },
                )

    if rail_rows:
        print(format_rail_table(rail_rows))
    elif reconstruct:
        recon = reconstruct_playability(date)
        if recon.get("verified_adds_by_rail"):
            print("  (reconstructed from verify_log — before counts unavailable)")
            for rail_id, count in sorted(
                recon["verified_adds_by_rail"].items(),
                key=lambda item: (item[0] or ""),
            ):
                if not rail_id:
                    continue
                pool = recon.get("current_pools", {}).get(rail_id, {})
                print(
                    f"  {rail_id:28} +{count} verified (current pool={pool.get('verified_pool', '?')})",
                )
            print()
            for rail_id, data in sorted(recon.get("by_rail", {}).items()):
                verified = data.get("verified") or []
                if not verified:
                    continue
                print(f"  {rail_id} new verified:")
                for item in verified:
                    print(f"    - {item['type']}:{item['id']}")
        else:
            print("  (no verified adds detected)\n")
    else:
        print("  (no rail delta data — run with --reconstruct)\n")

    # Agent / companion updates
    print("## Agent & companion updates")
    if reconstruct:
        comp = reconstruct_companion(date)
        if comp.get("events"):
            print(f"Companion journal: {comp['event_count']} events")
            for etype, count in sorted(comp.get("by_type", {}).items()):
                print(f"  - {etype}: {count}")
            print()
            for event in comp["events"]:
                if event["event_type"] in {"catalog_gardener", "nightly_consolidate", "profile_patch", "librarian_notes_replace"}:
                    print(f"  [{event['created_at']}] {event['event_type']}")
                    print(f"    {json.dumps(event['payload'], ensure_ascii=False)[:400]}")
                elif event["event_type"] == "voice_turn":
                    payload = event["payload"]
                    tools = payload.get("tools_used") or []
                    if tools:
                        print(f"  [{event['created_at']}] voice_turn tools={tools}")
                        print(f"    transcript: {str(payload.get('transcript', ''))[:120]}")
        else:
            print("  (no companion journal events for this date)")
    else:
        agent_events = [
            e for e in events
            if e.get("kind") in {
                "companion_gardener",
                "companion_consolidate",
                "companion_llm",
                "ai_catalog_bootstrap",
                "ai_catalog_create",
                "ai_catalog_migrate",
            }
        ]
        if agent_events:
            for event in agent_events:
                print(f"- [{event.get('ts')}] {event.get('kind')}: {event.get('summary')}")
                payload = event.get("payload")
                if isinstance(payload, dict) and payload.get("details"):
                    print(f"  details: {json.dumps(payload['details'], ensure_ascii=False)[:500]}")
        else:
            print("  (no agent ops events logged for this date)")

    print()
    print("## Raw ops events")
    if events:
        for event in events:
            print(f"- {event.get('ts')} [{event.get('kind')}] {event.get('summary')}")
    else:
        print("  (none — ops logging starts after next deploy)")

    print()
    print(f"ops log: {ops_root() / 'events.jsonl'}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="mango ops nightly report")
    parser.add_argument("--date", help="YYYY-MM-DD (default: yesterday PDT)")
    parser.add_argument("--reconstruct", action="store_true", help="fill gaps from verify_log + companion.db")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.date:
        date = args.date
    else:
        date = (datetime.now(PDT) - timedelta(days=1)).strftime("%Y-%m-%d")

    if args.json:
        payload = {
            "date": date,
            "events": load_events(date),
            "reports": load_reports(date),
        }
        if args.reconstruct:
            payload["reconstructed_playability"] = reconstruct_playability(date)
            payload["reconstructed_companion"] = reconstruct_companion(date)
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0

    return print_report(date, reconstruct=args.reconstruct)


if __name__ == "__main__":
    raise SystemExit(main())
