# Recommendations reliability recovery — home deployment runbook

Status: **DEPLOYED ON THE PI IN SERVE MODE; SHUFFLE EFFICIENCY AND OFFICIAL-ONLY
YOUTUBE INPUT GATES PASS.** The exact target passes the full local catalog and
launcher suites, Pi state-preservation/reset checks, cached 30-X-per-tab proof,
and restart-suppression proof. The standard exact-target pre-couch gate also
passes; human thematic, focus, picture, audio, and physical-controller judgment
remain explicitly pending.

```bash
TARGET_SHA=7ed5a3105db2674dac566fd45b1fd4e4b07a3145
```

Do not promote `345535d`, `3ef1b20`, `772b3d5`, `9425b1f`, or `c8cfe72` as the
current target. Do not promote `f24fcda` as the current target. This successor retains the sole executable recommendation
architectures and includes the measured VOD evaluation, memory, shuffle,
synthetic-gate isolation, and playback-smoke corrections.

- VOD: `vod-content-profile-v2` + `vod-story-frontier-v2`.
- YouTube: authoritative OAuth-subscription/official-Takeout provenance-gated v2.5.
- StoryDNA: compatible `story-dna-v1` rows remain immutable optional overlays.

Cleanup is code-only. Never delete, rewrite, merge, vacuum, fresh-start, purge,
or regenerate databases, ratings, Saved, history, profiles, playability,
StoryDNA, generations, tables, migrations, caches, credentials, or ledgers.

## 0. Current deployment record

The work agent deployed and tested the target directly on `mango` on
2026-08-05. This table supersedes the historical containment notes later in
this runbook.

| Gate | Pi evidence |
|------|-------------|
| Modes | VOD `serve`; YouTube `serve`; StoryDNA teacher/frontier and TMDB `off` |
| Durable state | Library schema 17; playability schema 15; live DBs and fresh online backup pass integrity checks; 1,096 `story-dna-v1`/AI feature rows preserved; no synthetic gate Saved row |
| VOD Movies | Active/public latest complete generation; 224 eligible + 5,447 sparse/excluded = 5,671 verified; reserve 224; cyclic six-card cached slate; `evidence_cold_start` |
| VOD TV | Active/public latest complete generation; 229 eligible + 3,645 sparse/excluded = 3,874 verified; reserve 229; cyclic six-card cached slate; `evidence_cold_start` |
| Ratings | `<1` is a true-negative evaluation label, `1–2` is neutral, and `>2` contributes quadratic positive evidence: `((rating - 2) / 3)^2` |
| VOD evaluation | Only thematically rankable rated profiles are labels. Current result is honestly insufficient rather than a false concordance failure; operational serving remains independently authorized |
| Memory/liveness | One catalog invocation, zero restarts/OOM events, process and cgroup memory separated, 128-title bounded work, effective 1280M/1536M limits |
| YouTube | `youtube-household-v2.5` ready for channel `Aman`, India/en; 55 subscriptions; 2,872 Takeout events covering 2,548 unique videos; zero Mango-local ranking anchors; generation-14 reserves 120/32/9/120; More Like thematic; Mango-local meaningful watches only create the 30-day exact cooldown |
| Cached interaction | Thirty exact-target calls per VOD tab changed every category rail and `For You`, held Continue/Saved stable, and measured p50/p95 53.6/71.4 ms Movies and 42.4/47.9 ms TV. Thirty YouTube X calls measured p50/p95 43.4/82.9 ms with stable History and unchanged generation/API/quota counters |
| Playback | Exact-SHA YouTube search/detail/`yt-dlp -> mpv` smoke passes; earlier served VOD representative launch proof remains applicable because the later executable delta is cache/dealer-only |
| Backup | Fresh pre-deploy SQLite online backup: `~/.local/share/mango/backups/agent-snapshots/recommendations-perf-pre-deploy-20260806T075723Z`; Takeout and all older recommendation/frontier backups remain preserved |

The target passed 900/900 catalog tests and the full 87/87 launcher suite on the
Mac; catalog and launcher production builds pass on the same exact revision.
The Pi passed the v2.5 atomic refresh, source-isolation/reset checks, cached
Shuffle proof, and restart-suppression proof.
Reliability is yellow because five curated VOD rails are thin and 1/28 sampled
served titles were broken; automated proof does not substitute for the
user-owned physical couch verdict.

## 1. Source contract and proof

The target adds:

- additive library migration 17 for immutable content-generation priors and
  resumable job phase/cursor/heartbeat/deadline/generation/error/memory state;
- compatible content-generation and prior reuse for taste-only refreshes;
- deterministic 128-title profile/rank pages and one Movies/TV heavy worker;
- a compact worker protocol that never sends the full corpus in `workerData`;
- early evidence-cold-start evaluation without empty corpus replay;
- a 15-minute, heartbeating maintenance lease with page-boundary couch
  preemption and linked successor work;
- `/health/live` and a watchdog that distinguishes liveness from readiness;
- repo defaults `MemoryHigh=1280M`, `MemoryMax=1536M`;
- alternate-seed thematic YouTube acquisition, exact-channel fallback, funnel
  diagnostics, More-Like-first allocation, and honest conditional omission.
- post-auth authorized-channel truth, complete paged subscription coverage,
  official metadata evidence, and source/seed portfolio constraints;
- startup/refresh snapshots for the rolling 30-day YouTube watch cooldown,
  exact Saved/Not-for-me exclusions, and the
  chronological History utility row, with mutation invalidation and count-only
  diagnostics;
- one durable served-attribution transaction per rendered YouTube response
  instead of one SD-card commit per rail;
- cyclic predealt `For You` slates plus a tab-scoped, cache-only X path that
  also re-deals every VOD category rail from its verified pool, leaves
  Continue/Saved stable, and avoids provider or ranking work.
- a revision-keyed bounded verified-pool cache, narrowed playability migration
  15 triggers, and a current-generation startup gate so Shuffle and restart do
  not scan or rebuild unchanged full-corpus state;
- `youtube-household-v2.5`, where Mango-local viewing remains History/progress
  and a 30-day exact-video cooldown but cannot enter taste, ranking, or
  acquisition;
- an immediate launcher update path with no forced layout read, rail-wide card
  cascade, redundant personalization preflight, or duplicate Saved fetch.

Mac proof bound to `TARGET_SHA`:

```text
catalog-service npm test at TARGET_SHA: 900 pass / 0 fail
launcher deterministic tests at TARGET_SHA: 87 pass / 0 fail
catalog-service production build at TARGET_SHA: pass
launcher production build at TARGET_SHA: pass
companion production build at ancestor 7a8bc1b: pass
health-repair shell syntax: pass
```

The handoff docs may be a documentation-only descendant. On the home Mac:

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
git merge-base --is-ancestor "$TARGET_SHA" origin/feat/native-experience
test -z "$(git diff --name-only "$TARGET_SHA"..origin/feat/native-experience | \
  awk '$0 != "AGENTS.md" && $0 !~ /^docs\// { print }')"
git show -s --format='%H %s' "$TARGET_SHA"
```

Stop on any executable/config delta after the target. Run any repeated Mac
proof in a clean detached worktree at the exact target.

`pi-deploy.sh` and `pi-exec-gate.sh` remain blocked: they do not fail closed on
the selected SHA and the deploy wrapper can mutate private AIOMetadata state.
Use the reviewed manual Git/build/restart path below. Do not run addon sync.

## 2. Historical Pi containment — retained for incident provenance

The latest home report records:

```text
Pi HEAD: 9425b1f691c3fe2fe9965ae074f155ca748a0027
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
StoryDNA story-dna-v1/ai rows: 1096
companion.example dirt: preserved
operator drop-in: frontier-memory.conf, MemoryHigh=1100M / MemoryMax=1400M
durable backup: ~/.local/share/mango/backups/agent-snapshots/
  frontier-pre-deploy-20260805T183758Z
older durable T161937Z/T171818Z copies: preserved
```

The prior Movies refresh crossed `MemoryHigh` by roughly 2.2 MiB and changed
the catalog invocation. YouTube built For You/Beyond but no More Like reserve.
Both domains were returned to off. There is no serve or couch claim.

Before mutation, inventory full SHA/branch/dirt, service state, effective env,
DB paths/sizes, StoryDNA count, recommendation diagnostics, schema versions,
`InvocationID`, `NRestarts`, cgroup memory events, RSS/peak, pressure, and swap.
Stop on overlapping source dirt. Preserve companion dirt without stashing or
resetting it.

Make fresh Pi-local SQLite online backups for both library and playability
databases. Do not rely on the routine helper's plain-copy fallback. Use a new
durable directory with mode `0700`, files `0600`, record checksums, open each
backup read-only, and require `PRAGMA quick_check=ok`. Never copy databases
off-box. Do not delete existing backups.

## 3. Exact target and guarded memory headroom

Require an idle couch and no authoritative playback PID/socket. On the Pi:

```bash
cd ~/mango
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor HEAD "$TARGET_SHA"
git merge --ff-only "$TARGET_SHA"
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
```

Do not pull the later documentation tip. Do not reset a dirty tree.

Back up the operator-owned `frontier-memory.conf`, then edit **only** its two
memory assignments to:

```ini
MemoryHigh=1280M
MemoryMax=1536M
```

Do not remove the drop-in or change its other contents. Run user daemon-reload
and read back the effective values. Do not add forced GC, swap tuning,
`--max-old-space-size`, or worker heap caps.

Keep both domains and provider work off while building:

```text
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

Build/restart without addon synchronization:

```bash
cd ~/mango
bash scripts/lib/pi-npm-deps.sh build src/catalog-service
bash scripts/lib/pi-npm-deps.sh build src/launcher
bash scripts/lib/pi-npm-deps.sh build src/companion
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
```

Require catalog `/health/live`, library schema 17, playability schema 15,
`quick_check=ok`, and exactly the pre-deploy StoryDNA count before proceeding.

## 4. Two-cycle VOD shadow proof

Set only VOD to `shadow`; keep YouTube, StoryDNA teacher/frontier, and TMDB off.
Restart and read back the effective environment. Record the baseline after two
idle minutes: invocation/restarts, process memory, cgroup events, pressure,
swap, provider usage, StoryDNA count, and recommendation pointers.

Run **two complete cycles**, each in this strict order:

1. enqueue Movies and poll its exact job ID to a terminal success;
2. wait for the catalog to settle;
3. enqueue TV and poll its exact job ID to terminal success;
4. wait two minutes and capture the same service/cgroup/process evidence.

Do not overlap domain jobs or treat an HTTP timeout as success. For every job,
capture phase, cursor, resume/successor IDs, captured revisions, generation IDs,
typed error, per-phase/peak RSS/heap/external/array-buffer metrics, accounting,
background/prior identity, reserve, slate, active/previous/public pointers, and
offline evaluation.

Per-domain functional gates:

- `model_version=vod-story-frontier-v2`, progressive profile mode;
- `eligible_ranked + sparse_unresolved + other_excluded == verified` and no
  unaccounted title;
- reserve depth at least 200 and a valid six-card cached slate;
- every served candidate currently verified-playable, poster-bearing, unique,
  and not an exact rated/Saved/meaningfully watched/vetoed title;
- taste-only second-cycle work reuses the compatible profile generation and
  persisted corpus priors rather than recompiling/rebuilding them;
- teacher/TMDB usage remains zero and StoryDNA count never decreases;
- active pointers describe the accepted generation, not merely the newest row;
- in shadow, public rank and public recommendation shuffle epoch remain null
  and `For You` cannot advance; category-rail sessions may still reshuffle
  honestly from cached verified pools, and Saved ownership is exactly Household;
- serving is either supervised-evaluated or the existing narrow
  `evidence_cold_start` basis. Never invent ratings or weaken measured gates.

Memory/stability gates across both cycles:

- one `InvocationID`, unchanged `NRestarts`, and healthy `/health/live`;
- zero deltas in cgroup `max`, `oom`, and `oom_kill` events;
- peak no higher than 90% of effective `MemoryHigh`;
- RSS no more than 100 MiB above the baseline two minutes after each cycle;
- no monotonic memory growth from cycle one to cycle two;
- no sustained full-memory pressure and no continuing swap growth;
- cached Home and five X operations service-side p95 `<=250 ms`, with zero
  response-path provider/metadata/graph/rank work.

Exercise couch preemption once in shadow: begin a refresh while idle, create
authoritative couch/playback activity, and require preemption after at most one
128-title batch. The completed page must stay committed, last-good must remain,
the first job must be `coalesced/couch_preempted`, and a linked successor must
resume only after idle. Do not interfere with real playback for this proof.

If the optimized implementation fails these gates twice at 1280M/1536M, do not
raise limits again. Keep VOD off and report the exact evidence. The approved
next architecture is a dedicated `mango-recommendation-worker.service` using
the same checkpoint protocol and SQLite WAL/`SQLITE_BUSY` discipline; do not
invent or patch that fallback on the Pi.

## 5. VOD serve gate

Only after every shadow gate passes, set VOD to `serve`, restart, and require:

- public rank equals active rank and public epoch is non-null;
- one six-card For You rail on Movies and TV;
- six successful representative launches, focus/Back restoration, restart and
  offline last-good behavior;
- five X presses change cached recommendation membership/order, preserve focus
  and scroll, avoid four prior slates where supply permits, and cause zero
  network/ranking/provider work;
- invocation, cgroup, RSS-recovery, pressure, and p95 gates remain healthy.

The user-owned ten-shuffle thematic/relevance judgment and screenshots remain
explicitly **DEFERRED**. Automated serve is not human couch acceptance.

## 6. Independent YouTube recovery

Hold accepted VOD fixed. First prove YouTube `off`: History/Saved utilities
must be HTTP 200 and exact-owner scoped. If only Household exists, mark the
personal-owner case deferred; do not create a profile.

Set YouTube to `shadow`, enqueue one exact refresh job, and require complete
atomic publication with official Takeout history and successful
authoritative subscription pagination. Zero subscriptions is valid history-only
state; omit subscription/live rails.

Require:

- only subscription/history provenance; no Search, Saved influence, VOD,
  profiles, mood, Companion, AI catalogs, charts, or generic cache leakage;
- healthy four-card For You and Beyond reserves when their qualifying inputs
  exist;
- More Like acquisition funnels with opaque seed references and stage counts;
- alternate meaningful seeds, then exact-channel fallback, within the existing
  three triggered/four nightly search limits;
- four thematic cards labelled `More Like …`, or four exact-channel cards
  labelled `More from <channel>`, or rail omission plus explicit
  `more_like_status=not_applicable`;
- More Like allocation before Beyond without starving subscription/live
  semantics; global deduplication and all watched/Saved/Short/live/block rules.

An honest `not_applicable` More Like result does not block YouTube. Required
For You/Beyond failure, acquisition/provider failure, provenance impurity, or
atomic-generation failure still blocks.

Promote YouTube independently only after its applicable gates pass. Verify
stable rail order, four-card rows, launch/focus/offline behavior, cached p95,
and five X presses with unchanged API/quota/acquisition/ranking counters and
stable History/Saved.

## 7. Failure, rollback, and report

On failure, disable only the affected domain. Full containment is:

```text
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

Restart and verify ordinary Continue, exact Saved/History utilities, curated
VOD, and `/health/live`. Roll code back only through a reviewed Git SHA. Restore
a DB backup only for proven corruption and explicit human approval.

Return a compact PASS/FAIL/DEFERRED table with exact SHA/config, backup and
preservation proof, Mac/Pi tests, schema/StoryDNA counts, job IDs/phases,
accounting/reserves/pointers, provider/quota deltas, both-cycle memory evidence,
preemption, latency, screenshots, rollback state, and the remaining human
ten-shuffle checklist.
