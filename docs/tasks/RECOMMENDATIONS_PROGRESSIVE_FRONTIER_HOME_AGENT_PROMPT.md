# Starter prompt template — successor deployment after recommendation blockers close

**Do not use `345535d`.** Replace `<PUSHED_SHA_FROM_HANDOFF>` only with an
explicitly supplied successor SHA that fixes and tests the blockers in the
current deployment runbook.

```text
Work in the mango repo on branch feat/native-experience from the home Mac/Pi
LAN. Deploy exactly:

TARGET_SHA=<PUSHED_SHA_FROM_HANDOFF>

Read completely before acting:
- AGENTS.md
- docs/DEPLOY.md
- docs/ARCHITECTURE.md
- docs/FIRE_WATER_RATINGS.md
- docs/YOUTUBE.md
- docs/tasks/RECOMMENDATIONS_SIMPLIFY_IMPLEMENTATION_PLAN.md
- docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md

Mission: first prove TARGET_SHA closes every blocker listed in the deployment
runbook; then deploy the latest-only VOD Progressive Story Frontier and provenance-
gated YouTube recommendations, build healthy cached reserves from the Pi's
current Household Fire/Water, Saved, Mango VOD history, YouTube subscriptions,
and qualifying YouTube history, promote each domain to serve only after all
automated gates pass, and leave the Pi ready for the user's human couch test.

Non-negotiable boundaries:
- Git-only deployment. Never rsync, scp, tar, or hand-copy source/DB files.
- Do not delete, rewrite, merge, migrate away, clear, or fresh-start any data.
  Preserve all DBs, ratings, Saved, history, profiles, playability, StoryDNA,
  old generations/tables/columns/migrations, caches, credentials, and ledgers.
- Cleanup in this release is executable code/feature cleanup only.
- Never purge verified playability or regenerate compatible StoryDNA.
- No household fields may enter a Companion teacher payload.
- Do not use pi-deploy.sh or pi-exec-gate.sh while the blocker documented in
  docs/DEPLOY.md remains. Use its reviewed exact-SHA manual Git/build/restart
  path without addon synchronization.
- Never weaken a gate. Report unavailable evidence as DEFERRED with the exact
  reason. Human thematic judgment is DEFERRED until the user tests the couch.
- Stop before Pi mutation unless TARGET_SHA fixes/tests YouTube non-Household
  off ownership, VOD shadow/serve Saved ownership, disabled Shuffle feedback,
  active-pointer diagnostics, and focused mode/migration/publication rollback.

1. On the home Mac, fetch feat/native-experience; prove branch HEAD and origin
   both equal TARGET_SHA; require a clean/non-overlapping tree; run the full
   catalog suite and launcher build. Stop on any failure.
2. Inventory Pi SHA/branch/dirty state, services, effective env, current
   recommendation diagnostics, verified counts, StoryDNA count, generation
   pointers, reserve depths, DB paths/sizes, and PRAGMA quick_check. Do not
   print rows, secrets, URLs containing credentials, or private history.
3. While services are stopped and before migrations, make and validate
   timestamped Pi-local SQLite online backups of library.db and playability.db:
   directory 0700, files 0600, non-zero, checksum, read-only open, quick_check.
   Never copy them off-box. Stop on failure or overlapping Pi-local source edits.
4. Preserve the operator env and set only:
   MANGO_VOD_RECS_V2=shadow
   MANGO_YOUTUBE_RECS_V2=shadow
   MANGO_STORY_DNA=0
   MANGO_STORY_DNA_WORKER_MODE=off
   MANGO_TMDB_METADATA=off
   Remove obsolete MANGO_VOD_CONTENT_PROFILE and
   MANGO_STORY_DNA_AUTONOMOUS_BACKFILL keys without touching stored data.
5. On the Pi, fetch feat/native-experience and prove origin equals
   TARGET_SHA. Fast-forward the Pi with git pull --ff-only, then prove Pi HEAD
   equals TARGET_SHA exactly. Do not reset a dirty tree.
6. Build catalog-service, launcher, and companion through the dependency-aware
   manual commands in the deployment doc; restart Mango without running addon
   configuration sync. Run full catalog tests and launcher build on TARGET_SHA.
7. POST localhost :3020 refresh jobs for Movies, TV, and YouTube and poll every
   job ID to terminal. Require for VOD: top-level model_version
   vod-story-frontier-v1 and profile_mode progressive-v2 (teacher_model_version
   is not the rank model), Household taste, scored_count + excluded_count ==
   verified_count, unscored_count 0, coverage 1, reserve >=200 per domain,
   valid six-card slates, no unverified/unposterized
   serving items, preserved StoryDNA overlays, and zero provider/TMDB usage.
   Require YouTube: complete atomic generation, allowed provenance only,
   subscription/history isolation, and honest stale status on OAuth loss.
   Separately prove active/previous rank pointers, active promotion evaluation,
   and public epoch; mode_ready/latest-row timestamps are insufficient.
8. Run reviewed Pi-local pre-couch, YouTube smoke, focus, launch, offline,
   restart, and reliability checks. Measure cached Home and five X presses:
   p95 <=250 ms, no response-path provider/metadata/rank/quota work, and any
   asynchronous VOD low-water recovery separately attributed.
9. Promote one domain at a time. Set only VOD=serve, restart, and repeat its
   checks while YouTube remains shadow/off; roll VOD back on any failure. Then
   independently promote/test YouTube while holding VOD fixed. Keep
   StoryDNA worker and TMDB off for the initial human couch test. Do not enable
   a corpus-wide teacher path; none exists in the new code.
10. On failure, use the tested safe mode for only the affected domain and keep
   teacher/frontier off,
   restart, verify utility/curated surfaces, and report. Roll back code only via
   a reviewed Git SHA. Never delete rows or restore DBs without explicit human
   approval and proven corruption.
11. Return a compact PASS/FAIL/DEFERRED evidence table: exact SHA/config,
    backups, tests/gates, job IDs, accounting/reserves, StoryDNA/provider/quota
    deltas, latency, screenshots, rollback readiness, and the remaining ten-
    shuffle human relevance/thematic couch checklist.
```
