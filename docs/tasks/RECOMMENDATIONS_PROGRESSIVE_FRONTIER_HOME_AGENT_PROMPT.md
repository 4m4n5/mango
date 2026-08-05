# Starter prompt — deploy Progressive Story Frontier to the home Pi

Replace `<TARGET_SHA>` with the exact pushed implementation commit before use.

```text
Work in the mango repo on branch feat/native-experience from the home Mac/Pi
LAN. Deploy and verify exactly <TARGET_SHA> using git only.

Read completely before acting:
- AGENTS.md
- docs/DEPLOY.md
- docs/ARCHITECTURE.md
- docs/FIRE_WATER_RATINGS.md
- docs/tasks/RECOMMENDATIONS_SIMPLIFY_IMPLEMENTATION_PLAN.md
- docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md

Mission: prepare Mango's Progressive Story Frontier in a safe VOD shadow state,
prove full verified-corpus accounting and healthy local reserves using the
household's existing Fire/Water, Saved, watch history, and compatible StoryDNA,
then enable only the bounded semantic frontier if every prerequisite passes.
Do not promote VOD to serve or modify YouTube without explicit approval.

Hard boundaries:
- Never rsync, scp, or hand-copy repo files or databases. Git pull only.
- Preserve runtime DBs, caches, secrets, ratings, history, Saved, profiles,
  playability, all old StoryDNA, and last-good generations.
- Do not purge playability or regenerate existing compatible StoryDNA.
- No household data may appear in a teacher payload.
- Do not weaken any gate. Report unavailable proof as DEFERRED with the reason.

1. Inspect and report the Pi's current SHA, dirty state, service/env state,
   verified Movies/TV counts, active generations, exact compatible StoryDNA
   count, and backup health. If the Pi repo is unexpectedly dirty or diverged,
   stop before pull and report it.
2. Set/confirm the containment posture before deployment:
   MANGO_VOD_RECS_V2=shadow
   MANGO_VOD_CONTENT_PROFILE=progressive-v2
   MANGO_STORY_DNA=0
   MANGO_STORY_DNA_WORKER_MODE=off
   MANGO_TMDB_METADATA=off
3. Deploy <TARGET_SHA> using docs/DEPLOY.md and the repository's git-only full
   deploy path. Read back the exact running SHA.
4. Trigger and poll one Movies and one TV recommendation refresh. Require
   complete `eligible + excluded == verified` accounting, reserve depth >=200,
   zero provider usage growth, preserved enriched overlays, and distinct sparse
   exclusions. Inspect family/source coverage and calibration status; never
   describe provisional bands as calibrated.
5. Run the catalog tests/build, launcher build, Pi pre-couch gate, Home load,
   and five X presses. Prove Home/X add no provider, metadata, graph, rank, or
   quota work and maintain focus/scroll behavior. Capture exact outputs and
   screenshots.
6. Only if the shadow gate is fully green, restore the existing Companion
   provider and enable:
   MANGO_STORY_DNA=1
   MANGO_STORY_DNA_WORKER_MODE=frontier
   MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE=12
   MANGO_STORY_DNA_FRONTIER_ROLLING_30D=96
   MANGO_STORY_DNA_FRONTIER_BATCH=4
   Observe one run and prove the budgets, content-only payload, one request in
   flight, durable leases/retries, and healthy last-good behavior on failure.
7. Leave TMDB off unless a credential already exists through the approved
   secret mechanism and the Settings attribution is visibly proven. TMDB is
   optional; never add a credential to git and never fuzzy-match identities.
8. Do not set VOD to serve. Hand back an evidence table with PASS/FAIL/DEFERRED,
   exact SHA/config, generation/count deltas, provider usage, latency, logs,
   screenshots, rollback commands, and the remaining human couch checklist.

If any invariant fails, immediately set MANGO_STORY_DNA=0,
MANGO_STORY_DNA_WORKER_MODE=off, keep VOD shadow, restart, verify last-good, and
report the failure without deleting data.
```
