#!/usr/bin/env python3
"""Tag proven expiry-only demotions without renewing playback evidence.

Default is read-only. Apply requires an exact reviewed count, a new rollback
snapshot, and the normal maintenance lock. Stop catalog/worker before applying
and restart afterwards so in-memory browse/recommendation caches are rebuilt.
Never restore a whole database or infer eligibility from first_verified_at.
"""
from __future__ import annotations

import argparse
from collections import Counter
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3

EVIDENCE_FIELDS = (
    "verified_at", "first_verified_at", "expires_at", "best_source",
    "cache_status", "debrid_service", "probe_ms", "win_url_hash",
    "win_ladder_step", "proof_version", "proof_run_id", "proof_exact_main",
)


def connection(path: Path, writable: bool = False) -> sqlite3.Connection:
    db = sqlite3.connect(path.resolve().as_uri() + ("?mode=rw" if writable else "?mode=ro"),
                         uri=True, isolation_level=None, timeout=5)
    db.row_factory = sqlite3.Row
    return db


def plan(db: sqlite3.Connection, baseline: sqlite3.Connection) -> tuple[list[dict], dict]:
    previous = {(r["type"], r["id"]): dict(r) for r in baseline.execute(
        "SELECT * FROM titles WHERE status='verified'")}
    rows = [dict(r) for r in db.execute("SELECT * FROM titles")]
    retries = {(r["type"], r["id"]): r["reason"] for r in db.execute(
        "SELECT type,id,reason FROM playability_retry_queue")}
    baseline_log_id = baseline.execute("SELECT COALESCE(MAX(id),0) FROM verify_log").fetchone()[0]
    logs = {}
    for row in db.execute("SELECT * FROM verify_log WHERE id > ? ORDER BY id", (baseline_log_id,)):
        logs.setdefault((row["type"], row["id_value"]), []).append(dict(row))
    types = {}
    for row in rows:
        types.setdefault(row["id"].lower(), set()).add(row["type"])
    skipped = Counter()
    accepted = []
    for row in rows:
        key = (row["type"], row["id"])
        before = previous.get(key)
        if before is None:
            skipped["not_previously_verified"] += 1
            continue
        if row["status"] == "stale" and row["fail_reason"] == "expired_stale":
            skipped["already_tagged"] += 1
            continue
        if row["status"] != "stale" or row["fail_reason"] is not None:
            skipped["not_expiry_only_stale"] += 1
            continue
        if row["type"] not in ("movie", "series") or ":" in row["id"]:
            skipped["not_canonical_title"] += 1
            continue
        if len(types[row["id"].lower()] & {"movie", "series"}) > 1:
            skipped["identity_type_collision"] += 1
            continue
        if key in retries and retries[key] != "expired_stale":
            skipped["conflicting_retry_evidence"] += 1
            continue
        if any(field not in row or field not in before or row[field] != before[field]
               for field in EVIDENCE_FIELDS):
            skipped["changed_verification_evidence"] += 1
            continue
        events = logs.get(key, [])
        # A later sweep must never conceal an intervening failed attempt.
        log = events[0] if len(events) == 1 else None
        if not log or log["stage"] != "sweep" or log["outcome"] != "expired_stale":
            skipped["missing_sweep_or_later_attempt"] += 1
            continue
        if (not row["verified_at"] or not row["expires_at"]
                or row["expires_at"] > log["started_at"]
                or before["updated_at"] > log["started_at"]
                or row["updated_at"] != log["started_at"]):
            skipped["inconsistent_expiry_timestamps"] += 1
            continue
        accepted.append(row)
    digest = hashlib.sha256(json.dumps(sorted((r["type"], r["id"]) for r in accepted),
                                      separators=(",", ":")).encode()).hexdigest()
    return accepted, {"eligible": len(accepted), "candidate_sha256": digest,
                      "excluded": dict(sorted(skipped.items())), "titles_total": len(rows),
                      "by_type": dict(Counter(r["type"] for r in accepted))}


def apply_plan(db: sqlite3.Connection, rows: list[dict]) -> None:
    for row in rows:
        changed = db.execute("""
UPDATE titles SET fail_reason='expired_stale'
WHERE type=? AND id=? AND status='stale' AND fail_reason IS NULL AND updated_at=?
""", (row["type"], row["id"], row["updated_at"])).rowcount
        if changed != 1:
            raise RuntimeError("candidate changed during restoration")
        # Do not reset backoff for existing work or overwrite a newer failure.
        db.execute("""
INSERT OR IGNORE INTO playability_retry_queue
 (type,id,reason,priority,attempt_count,requested_at,last_attempt_at,next_eligible_at,resume_position)
VALUES (?,?,'expired_stale',70,0,?,NULL,?,0)
""", (row["type"], row["id"], row["updated_at"], row["updated_at"]))


def require_visibility_schema(db: sqlite3.Connection) -> None:
    version = db.execute("SELECT MAX(version) FROM playability_migrations").fetchone()[0]
    trigger = db.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?",
                         ("recommendation_corpus_titles_update",)).fetchone()
    if version != 21 or not trigger or "fail_reason" not in trigger[0]:
        raise RuntimeError("deploy visibility-aware schema 21 before restoration")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--expected-digest")
    parser.add_argument("--rollback-snapshot", type=Path)
    parser.add_argument("--maintenance-lock", type=Path)
    args = parser.parse_args()
    if args.database.resolve() == args.baseline.resolve():
        parser.error("baseline must differ from live database")
    if args.apply and (args.expected_count is None or not args.expected_digest
                       or not args.rollback_snapshot or not args.maintenance_lock):
        parser.error("apply requires expected count/digest, new rollback snapshot, and maintenance lock")
    with connection(args.baseline) as baseline, connection(args.database, args.apply) as db:
        for candidate in (baseline, db):
            if candidate.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                raise RuntimeError("database quick_check failed")
        if not args.apply:
            db.execute("BEGIN")
            baseline.execute("BEGIN")
            _, report = plan(db, baseline)
            print(json.dumps({"mode": "dry_run", **report}, sort_keys=True))
            return
        require_visibility_schema(db)
        # The stable coordinator pathname is never removed or truncated.
        with args.maintenance_lock.open("a+b") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            # Exclusive creation protects every existing snapshot, including baseline.
            fd = os.open(args.rollback_snapshot, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
            with sqlite3.connect(args.rollback_snapshot) as rollback:
                db.backup(rollback)
                if rollback.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise RuntimeError("rollback snapshot failed verification")
            db.execute("BEGIN IMMEDIATE")
            baseline.execute("BEGIN")
            rows, report = plan(db, baseline)
            if report["eligible"] != args.expected_count or report["candidate_sha256"] != args.expected_digest:
                raise RuntimeError("restoration plan changed; repeat and review dry-run")
            apply_plan(db, rows)
            if db.execute("SELECT COUNT(*) FROM titles").fetchone()[0] != report["titles_total"]:
                raise RuntimeError("title inventory changed")
            if db.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("foreign key check failed")
            db.commit()
            print(json.dumps({"mode": "applied", "restored_visibility": len(rows),
                              "verification_timestamps_unchanged": True,
                              "rollback_snapshot": str(args.rollback_snapshot), **report}, sort_keys=True))


if __name__ == "__main__":
    main()
