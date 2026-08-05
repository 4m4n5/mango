# Starter prompt template — deploy latest-only recommendations

Replace `<PUSHED_SHA_FROM_HANDOFF>` with the exact full SHA supplied in chat.

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

Mission: deploy the latest-only VOD Progressive Story Frontier and provenance-
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

1. Inventory Pi SHA/branch/dirty state, services, effective env, current
   recommendation diagnostics, verified counts, StoryDNA count, generation
   pointers, reserve depths, DB paths/sizes, and PRAGMA quick_check. Do not
   print rows, secrets, URLs containing credentials, or private history.
2. While services are stopped and before migrations, make and validate
   timestamped Pi-local SQLite online backups of library.db and playability.db:
   directory 0700, files 0600, non-zero, checksum, read-only open, quick_check.
   Never copy them off-box. Stop on failure or overlapping Pi-local source edits.
3. Preserve the operator env and set only:
   MANGO_VOD_RECS_V2=shadow
   MANGO_YOUTUBE_RECS_V2=shadow
   MANGO_STORY_DNA=0
   MANGO_STORY_DNA_WORKER_MODE=off
   MANGO_TMDB_METADATA=off
   Remove obsolete MANGO_VOD_CONTENT_PROFILE and
   MANGO_STORY_DNA_AUTONOMOUS_BACKFILL keys without touching stored data.
4. On Home Mac and Pi, fetch feat/native-experience and prove origin equals
   TARGET_SHA. Fast-forward the Pi with git pull --ff-only, then prove Pi HEAD
   equals TARGET_SHA exactly. Do not reset a dirty tree.
5. Build catalog-service, launcher, and companion through the dependency-aware
   manual commands in the deployment doc; restart Mango without running addon
   configuration sync. Run full catalog tests and launcher build on TARGET_SHA.
6. POST localhost refresh jobs for Movies, TV, and YouTube and poll every job ID
   to terminal. Require for VOD: vod-story-frontier-v1,
   vod-content-profile-v2, Household taste, full verified accounting, coverage
   1, reserve >=200 per domain, valid six-card slates, no unverified/unposterized
   serving items, preserved StoryDNA overlays, and zero provider/TMDB usage.
   Require YouTube: complete atomic generation, allowed provenance only,
   subscription/history isolation, and honest stale status on OAuth loss.
7. Run reviewed Pi-local pre-couch, YouTube smoke, focus, launch, offline,
   restart, and reliability checks. Measure cached Home and five X presses:
   p95 <=250 ms and zero provider/metadata/rank/quota work.
8. If and only if every automated gate passes, set VOD=serve and YouTube=serve,
   restart once, and repeat the diagnostics and cached interaction checks. Keep
   StoryDNA worker and TMDB off for the initial human couch test. Do not enable
   a corpus-wide teacher path; none exists in the new code.
9. On failure, set both recommendation modes off and teacher/frontier off,
   restart, verify utility/curated surfaces, and report. Roll back code only via
   a reviewed Git SHA. Never delete rows or restore DBs without explicit human
   approval and proven corruption.
10. Return a compact PASS/FAIL/DEFERRED evidence table: exact SHA/config,
    backups, tests/gates, job IDs, accounting/reserves, StoryDNA/provider/quota
    deltas, latency, screenshots, rollback readiness, and the remaining ten-
    shuffle human relevance/thematic couch checklist.
```
