# Home-agent starter — Progressive Frontier target deployment

```text
Work in the mango repo on branch feat/native-experience from the home Mac/Pi
LAN. Deploy and verify exactly:

TARGET_SHA=9425b1f691c3fe2fe9965ae074f155ca748a0027

Read completely before acting:
- AGENTS.md
- docs/DEPLOY.md
- docs/ARCHITECTURE.md
- docs/FIRE_WATER_RATINGS.md
- docs/YOUTUBE.md
- docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md

Do not deploy/promote 345535d, 3ef1b20, or 772b3d5. The recorded Pi is contained
at 772b3d58b53208a278da4e9d5281b46f88054b8e with VOD=off, YouTube=off,
StoryDNA/teacher/frontier/TMDB off, 1096 StoryDNA story-dna-v1/ai rows
preserved, Pi-local backups under /tmp/mango-frontier-h2-20260805T161937Z and
/tmp/mango-frontier-h2-20260805T171818Z (plus a reported durable copy), and
companion.example dirt preserved. An operator-owned
frontier-memory.conf drop-in remains at MemoryHigh=1100M/MemoryMax=1400M.
Treat those as facts to read back, not assumptions. No serve/couch claim exists.

Mission: follow the deployment runbook end-to-end. Prove the exact target on the
home Mac, preserve all Pi/operator state, deploy through the reviewed exact-SHA
manual Git/build/restart path, build healthy VOD reserves from current real
Household Fire/Water + Saved + meaningful Mango history, prove VOD shadow then
serve, then independently prove YouTube off ownership, shadow, and serve from
authoritative subscriptions + qualifying history. Leave the Pi ready for the
human ten-shuffle couch test; do not claim that human gate passed.

The target fixes the blocker you just found. It does not invent ratings or mark
the offline evaluator passed. It permits a complete operationally safe
generation to serve with `serve_basis=evidence_cold_start` when the only missing
evidence is stratified explicit-rating/nDCG coverage. Any measured hard failure
still blocks and retains last-good.

Non-negotiable boundaries:
- Git only. Never rsync, scp, tar, or hand-copy source or databases.
- Never delete, clear, rewrite, merge, vacuum, fresh-start, purge, or regenerate
  durable data. Preserve DBs, ratings, Saved, history, profiles, playability,
  StoryDNA, generations, tables/columns/migrations, caches, credentials, and
  ledgers. Cleanup in this release is code/feature cleanup only.
- Preserve the Pi companion dirt. Stop on overlapping source dirt; do not
  stash/reset by default.
- Do not use pi-deploy.sh or pi-exec-gate.sh. Their exact-SHA and implicit
  AIOMetadata-mutation blockers remain. Run no addon/config synchronization.
- Keep MANGO_STORY_DNA=0, WORKER_MODE=off, and TMDB=off for this couch round.
- No household data may enter a teacher request. Never enable corpus-wide
  teacher work; no such current path is supported.
- Never weaken a gate or invent ratings. Report unavailable evidence as
  DEFERRED with the exact reason.

Execution contract:
1. Fetch origin. The handoff/canonical status docs may be a documentation-only
   descendant of TARGET_SHA. Prove TARGET_SHA is an ancestor and that
   TARGET_SHA..origin changes only AGENTS.md/docs paths as specified in the
   runbook. Stop on any executable or config delta. Run the full catalog suite
   and launcher deterministic tests plus production build on TARGET_SHA itself.
2. Inventory Pi full SHA/branch/dirt, services, env, DB paths/sizes,
   recommendation state/pointers, verified counts, StoryDNA count,
   playability schema/migration versions, and quick_check. Preserve the old
   backup directory. Make fresh online SQLite
   backups unless the runbook's strict unchanged/validated reuse conditions are
   all proven. Backups stay Pi-local, 0700 directory/0600 files. Preserve and
   report the companion dirt and frontier-memory.conf; do not edit, remove, or
   raise the memory limits. Capture ActiveState, InvocationID, NRestarts,
   MemoryCurrent, MemoryPeak, MemoryHigh, and MemoryMax.
3. Require idle couch/no playback. Fetch the target on Pi and advance the
   existing feat/native-experience branch with `git merge --ff-only
   "$TARGET_SHA"`; do not `git pull` the later docs tip. Prove Pi HEAD exactly.
4. Set only VOD=shadow, YouTube=off, StoryDNA=0, WORKER_MODE=off, TMDB=off.
   Build catalog/launcher/companion with the manual dependency-aware commands,
   restart without addon sync, and re-read HEAD/env/state.
5. Refresh Movies first and wait for its exact job to finish before starting TV.
   Capture service invocation/restart/memory evidence after each. Require no
   restart/OOM/connection reset, full verified accounting, schema_version=14,
   reserve >=200 per domain, six valid cards, provider silence, preserved 1096+
   overlays, and active-pointer diagnostics distinct from latest-row data. In
   shadow public rank/epoch must be null; Saved must be exact Household;
   Shuffle must be hidden and unable to advance an epoch. Accept either
   `serve_basis=evaluated` with promotion eligible, or
   `serve_basis=evidence_cold_start` with promotion false and only
   insufficient_stratified_ratings/ndcg_unavailable reasons. In both cases
   require serve_eligible=true and no serve blockers. Never invent ratings.
6. Run exact-SHA Pi-local catalog, launcher/focus, pre-couch, launch, offline,
   restart, and reliability checks. Promote only VOD to serve after every
   operational gate. Require public==active pointer, valid six-card rails and
   launches, cached Home/five-X p95 <=250 ms, and stable service invocation.
   X success requires real card change. Evidence-cold-start serve is explicitly
   provisional until the user's ten-shuffle relevance verdict.
7. With VOD fixed, prove YouTube off under a personal active profile returns
   HTTP 200 and exact personal History/Saved when such a profile exists; if the
   Pi still has Household only, report that owner case DEFERRED rather than
   creating a profile. Then set YouTube=shadow, refresh authoritative
   subscriptions/history, poll the job, and prove provenance and
   stale-last-good truth. Zero authoritative subscriptions is a valid
   history-only state: omit subscription/live rails rather than failing. But
   History-driven For You/Beyond/More Like still require complete four-card
   rows. The previous attempt had no More Like reserve; inspect the meaningful
   seed, phase errors/quota, and `more_like:` provenance. If still incomplete,
   keep YouTube off and report the narrow blocker. Promote only after its
   applicable history-only or subscription-aware rail gates; five X presses
   must spend zero quota/network/rank.
8. On a failure, return only the affected domain to its tested safe mode. Full
   containment is both recommendation modes off plus StoryDNA/frontier/TMDB
   off. Never repair by deleting rows or restoring DBs without explicit human
   approval and proven corruption.
9. Return a compact PASS/FAIL/DEFERRED table with exact SHA/config, backup proof,
   Mac/Pi tests, jobs, counts/reserves/pointers, StoryDNA/provider/quota deltas,
   latency, screenshots, rollback state, and the remaining user-owned
   ten-shuffle thematic/relevance checklist.
```
