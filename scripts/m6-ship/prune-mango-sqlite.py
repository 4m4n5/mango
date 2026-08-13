#!/usr/bin/env python3
"""Prune Mango SQLite generation history. Catalog-service must be stopped.

Keep-set (never deleted): Saved, ratings, Takeout, overlays, watch/progress,
active + previous last-good ranks/stories/tastes, in-flight building work,
queued/running refresh jobs.

Keep in sync with catalog-service pruneLibraryMaintenance / pruneYoutubeMaintenance
/ prunePlayabilityMaintenance.
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

JOB_TERMINAL_RETENTION = 20
YOUTUBE_V2_GENERATION_RETENTION = 2
SERVED_SLATE_CREATED_FLOOR = 1_000_000_000_000
BATCH = 8

YOUTUBE_V1_TABLES = (
    "youtube_for_you_candidates",
    "youtube_fresh_find_candidates",
    "youtube_because_you_watched_candidates",
    "youtube_live_now_candidates",
    "youtube_popular_candidates",
    "youtube_rail_items",
    "youtube_impressions",
)


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path))
    connection.isolation_level = None
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def table_exists(connection: sqlite3.Connection, name: str) -> bool:
    row = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    ).fetchone()
    return row is not None


def count(connection: sqlite3.Connection, table: str) -> int:
    if not table_exists(connection, table):
        return 0
    return int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])


def collect_ids(connection: sqlite3.Connection, sql: str) -> set[int]:
    return {
        int(row[0])
        for row in connection.execute(sql)
        if row[0] is not None and int(row[0]) > 0
    }


def delete_ids(connection: sqlite3.Connection, table: str, column: str, ids: list[int]) -> int:
    deleted = 0
    statement = f"DELETE FROM {table} WHERE {column} = ?"
    for offset in range(0, len(ids), BATCH):
        batch = ids[offset:offset + BATCH]
        connection.execute("BEGIN")
        try:
            for identifier in batch:
                deleted += int(connection.execute(statement, (identifier,)).rowcount)
            connection.execute("COMMIT")
        except Exception:
            connection.execute("ROLLBACK")
            raise
    return deleted


def identity(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        "saved": count(connection, "profile_saved_items"),
        "ratings": count(connection, "profile_content_ratings"),
        "takeout": count(connection, "youtube_takeout_history"),
        "overlays": count(connection, "vod_story_dna_overlays"),
        "watch_state": count(connection, "profile_watch_state"),
        "watch_history": count(connection, "watch_history"),
    }


def prune_library(connection: sqlite3.Connection, now: int) -> dict[str, int | bool]:
    stats: dict[str, int | bool] = {
        "dna_edges": 0,
        "rank_generations": 0,
        "taste_generations": 0,
        "story_generations": 0,
        "refresh_jobs": 0,
        "runtime_state": 0,
        "served_slates": 0,
        "frontier_queue": 0,
        "skipped_story_graph": False,
    }
    if table_exists(connection, "vod_story_dna_edges"):
        stats["dna_edges"] = int(connection.execute("DELETE FROM vod_story_dna_edges").rowcount)

    story_count = count(connection, "vod_story_dna_generations")
    active_count = int(connection.execute(
        "SELECT COUNT(*) FROM vod_active_generations WHERE active_rank_generation_id IS NOT NULL"
    ).fetchone()[0]) if table_exists(connection, "vod_active_generations") else 0
    if story_count > 0 and active_count == 0:
        stats["skipped_story_graph"] = True
    else:
        keep_ranks = collect_ids(connection, """
SELECT active_rank_generation_id FROM vod_active_generations
WHERE active_rank_generation_id IS NOT NULL
UNION
SELECT previous_complete_rank_generation_id FROM vod_active_generations
WHERE previous_complete_rank_generation_id IS NOT NULL
UNION
SELECT rank_generation_id FROM recommendation_refresh_jobs
WHERE status IN ('queued', 'running') AND rank_generation_id IS NOT NULL
UNION
SELECT rank_generation_id FROM vod_rank_generations WHERE status = 'building'
""")
        all_ranks = [int(row[0]) for row in connection.execute(
            "SELECT rank_generation_id FROM vod_rank_generations"
        )]
        extra_ranks = sorted(identifier for identifier in all_ranks if identifier not in keep_ranks)
        stats["rank_generations"] = delete_ids(
            connection, "vod_rank_generations", "rank_generation_id", extra_ranks,
        )
        if table_exists(connection, "vod_story_graph_low_water_requests"):
            connection.execute("""
DELETE FROM vod_story_graph_low_water_requests
WHERE rank_generation_id NOT IN (SELECT rank_generation_id FROM vod_rank_generations)
""")

        keep_tastes = collect_ids(connection, """
SELECT active_taste_generation_id FROM vod_active_generations
WHERE active_taste_generation_id IS NOT NULL
UNION
SELECT taste_generation_id FROM vod_rank_generations
UNION
SELECT taste_generation_id FROM recommendation_refresh_jobs
WHERE status IN ('queued', 'running') AND taste_generation_id IS NOT NULL
UNION
SELECT taste_generation_id FROM vod_taste_generations WHERE status = 'building'
""")
        all_tastes = [int(row[0]) for row in connection.execute(
            "SELECT taste_generation_id FROM vod_taste_generations"
        )]
        extra_tastes = sorted(identifier for identifier in all_tastes if identifier not in keep_tastes)
        stats["taste_generations"] = delete_ids(
            connection, "vod_taste_generations", "taste_generation_id", extra_tastes,
        )

        keep_stories = collect_ids(connection, """
SELECT active_story_generation_id FROM vod_active_generations
WHERE active_story_generation_id IS NOT NULL
UNION
SELECT story_generation_id FROM vod_rank_generations
UNION
SELECT story_generation_id FROM vod_taste_generations
UNION
SELECT story_generation_id FROM recommendation_refresh_jobs
WHERE status IN ('queued', 'running') AND story_generation_id IS NOT NULL
UNION
SELECT generation_id FROM vod_story_dna_generations WHERE status = 'building'
""")
        all_stories = [int(row[0]) for row in connection.execute(
            "SELECT generation_id FROM vod_story_dna_generations"
        )]
        extra_stories = sorted(identifier for identifier in all_stories if identifier not in keep_stories)
        stats["story_generations"] = delete_ids(
            connection, "vod_story_dna_generations", "generation_id", extra_stories,
        )

    if table_exists(connection, "recommendation_refresh_jobs"):
        stats["refresh_jobs"] = int(connection.execute(f"""
WITH kept AS (
  SELECT job_id FROM recommendation_refresh_jobs
  WHERE status IN ('coalesced', 'complete', 'failed')
  ORDER BY queued_at DESC
  LIMIT {JOB_TERMINAL_RETENTION}
)
DELETE FROM recommendation_refresh_jobs
WHERE status IN ('coalesced', 'complete', 'failed')
  AND job_id NOT IN (SELECT job_id FROM kept)
""").rowcount)
    if table_exists(connection, "recommendation_runtime_state"):
        lookup = int(connection.execute("""
DELETE FROM recommendation_runtime_state
WHERE state_key LIKE 'vod_story_dna_lookup%'
""").rowcount)
        evaluation = int(connection.execute("""
DELETE FROM recommendation_runtime_state
WHERE state_key LIKE 'vod_story_graph_evaluation:%:%'
  AND state_key NOT IN (
    SELECT 'vod_story_graph_evaluation:' || content_type || ':' || active_rank_generation_id
    FROM vod_active_generations
    WHERE active_rank_generation_id IS NOT NULL
    UNION
    SELECT 'vod_story_graph_evaluation:' || content_type || ':' || previous_complete_rank_generation_id
    FROM vod_active_generations
    WHERE previous_complete_rank_generation_id IS NOT NULL
  )
""").rowcount)
        stats["runtime_state"] = lookup + evaluation
    if table_exists(connection, "profile_recommendation_served_slates"):
        stats["served_slates"] = int(connection.execute("""
DELETE FROM profile_recommendation_served_slates
WHERE expires_at < ? AND created_at > ?
""", (now, SERVED_SLATE_CREATED_FLOOR)).rowcount)
    if table_exists(connection, "vod_semantic_frontier_queue"):
        stats["frontier_queue"] = int(connection.execute("""
DELETE FROM vod_semantic_frontier_queue
WHERE status IN ('complete', 'superseded', 'failed')
  AND updated_at < ?
""", (now - 14 * 24 * 60 * 60 * 1000,)).rowcount)
    return stats


def prune_youtube(connection: sqlite3.Connection) -> dict[str, int]:
    stats = {"generations": 0, "v1_candidates": 0}
    if table_exists(connection, "youtube_v2_generations"):
        cutoff = connection.execute("""
SELECT generation FROM youtube_v2_generations
ORDER BY generation DESC LIMIT 1 OFFSET ?
""", (YOUTUBE_V2_GENERATION_RETENTION,)).fetchone()
        if cutoff is not None:
            connection.execute(
                "DELETE FROM youtube_v2_generation_items WHERE generation <= ?",
                (cutoff[0],),
            )
            stats["generations"] = int(connection.execute(
                "DELETE FROM youtube_v2_generations WHERE generation <= ?",
                (cutoff[0],),
            ).rowcount)
    v1 = 0
    for table in YOUTUBE_V1_TABLES:
        if table_exists(connection, table):
            v1 += int(connection.execute(f"DELETE FROM {table}").rowcount)
    stats["v1_candidates"] = v1
    return stats


def prune_playability(connection: sqlite3.Connection, now: int) -> int:
    fourteen = now - 14 * 24 * 60 * 60 * 1000
    seven = now - 7 * 24 * 60 * 60 * 1000
    deleted = 0
    if table_exists(connection, "verify_log"):
        deleted += int(connection.execute(
            "DELETE FROM verify_log WHERE started_at < ?", (fourteen,),
        ).rowcount)
    if table_exists(connection, "playability_triggers"):
        deleted += int(connection.execute(
            "DELETE FROM playability_triggers WHERE handled_at IS NOT NULL AND created_at < ?",
            (seven,),
        ).rowcount)
    if table_exists(connection, "rail_candidate_rejections"):
        deleted += int(connection.execute(
            "DELETE FROM rail_candidate_rejections WHERE expires_at < ?", (now,),
        ).rowcount)
    if table_exists(connection, "vod_explore_sessions_v3"):
        deleted += int(connection.execute("DELETE FROM vod_explore_sessions_v3").rowcount)
    if table_exists(connection, "rail_session"):
        deleted += int(connection.execute("DELETE FROM rail_session").rowcount)
    if table_exists(connection, "recently_shown"):
        deleted += int(connection.execute(
            "DELETE FROM recently_shown WHERE shown_at < ?", (fourteen,),
        ).rowcount)
    return deleted


def vacuum_db(path: Path) -> None:
    connection = connect(path)
    try:
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.commit()
        connection.execute("VACUUM")
        connection.execute("PRAGMA quick_check")
        check = connection.execute("PRAGMA quick_check").fetchone()
        if check is None or check[0] != "ok":
            raise RuntimeError(f"quick_check failed for {path}: {check}")
    finally:
        connection.close()


def file_bytes(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:
        return 0


def remaining_library(connection: sqlite3.Connection) -> dict[str, int]:
    return {
        "story_generations": count(connection, "vod_story_dna_generations"),
        "rank_generations": count(connection, "vod_rank_generations"),
        "dna_documents": count(connection, "vod_story_dna_documents"),
        "dna_edges": count(connection, "vod_story_dna_edges"),
        "profile_edges": count(connection, "vod_content_profile_edges"),
        "rank_items": count(connection, "vod_rank_items"),
        "overlays": count(connection, "vod_story_dna_overlays"),
        "refresh_jobs": count(connection, "recommendation_refresh_jobs"),
        **identity(connection),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--vacuum", action="store_true")
    parser.add_argument("--library", type=Path, default=Path("/etc/mango/library.db"))
    parser.add_argument("--playability", type=Path, default=Path("/etc/mango/playability.db"))
    parser.add_argument("--youtube", type=Path, default=Path("/etc/mango/youtube.db"))
    args = parser.parse_args()
    now = int(time.time() * 1000)
    before = {
        "library": file_bytes(args.library),
        "playability": file_bytes(args.playability),
        "youtube": file_bytes(args.youtube),
    }
    if not args.apply:
        library = connect(args.library)
        try:
            report = {
                "dry_run": True,
                "identity": identity(library),
                "remaining": remaining_library(library),
                "bytes_before": before,
            }
        finally:
            library.close()
        json.dump(report, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    library = connect(args.library)
    before_identity = identity(library)
    try:
        library_stats = prune_library(library, now)
        after_identity = identity(library)
        if after_identity != before_identity:
            raise RuntimeError(
                f"refusing to continue: identity changed {before_identity} -> {after_identity}"
            )
        remaining = remaining_library(library)
    finally:
        library.close()

    youtube_stats = {"generations": 0, "v1_candidates": 0}
    if args.youtube.is_file():
        youtube = connect(args.youtube)
        try:
            youtube_stats = prune_youtube(youtube)
        finally:
            youtube.close()

    playability_deleted = 0
    if args.playability.is_file():
        playability = connect(args.playability)
        try:
            playability_deleted = prune_playability(playability, now)
        finally:
            playability.close()

    if args.vacuum:
        vacuum_db(args.library)
        if args.playability.is_file():
            vacuum_db(args.playability)
        if args.youtube.is_file():
            vacuum_db(args.youtube)

    json.dump({
        "pruned": {
            "library": library_stats,
            "youtube": youtube_stats,
            "playability_deleted": playability_deleted,
        },
        "identity": after_identity,
        "remaining": remaining,
        "bytes_before": before,
        "bytes_after": {
            "library": file_bytes(args.library),
            "playability": file_bytes(args.playability),
            "youtube": file_bytes(args.youtube),
        },
        "vacuum": args.vacuum,
    }, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        sys.stderr.write(f"{error}\n")
        sys.exit(1)
