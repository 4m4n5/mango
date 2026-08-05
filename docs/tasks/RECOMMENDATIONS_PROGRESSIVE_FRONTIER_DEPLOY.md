# Progressive Frontier deployment runbook

Status: **READY FOR HOME SHADOW DEPLOYMENT** at the implementation target below.
This means the Mac source blockers are fixed and tested; it is not Pi, serve, or
couch proof.

```bash
TARGET_SHA=c41eda9da7a5de15c5b9c777d82275468a739c46
```

Do not promote `345535d883805bbfc21bb277b62adbb33ccb96cb` or
`3ef1b2079f0cd2b45f92adf6b476bc59e1a99478`. The target fixes their rollout
defects while preserving the sole executable architectures:

- VOD: `vod-content-profile-v2` + `vod-story-frontier-v1`.
- YouTube: authoritative subscription/history provenance-gated v2.
- StoryDNA: compatible `story-dna-v1` rows remain immutable optional overlays.

Cleanup is code-only. Never delete, rewrite, merge, vacuum, fresh-start, or
purge runtime databases, ratings, Saved, history, profiles, playability,
StoryDNA, generations, tables, migrations, caches, credentials, or ledgers.

## What the successor closes

- YouTube `off` now returns History/Saved for the exact active personal owner,
  so the HTTP ownership fence no longer produces a false 409. Shadow/serve
  remain internally Household-owned.
- VOD `shadow` and `serve` both read exact Household Saved state; neither blends
  preserved personal Saved rows.
- Home exposes Shuffle only when the current tab has a public shuffleable
  recommendation rail. Off/shadow do not advance hidden epochs; an unchanged
  slate gets warning feedback, never success feedback.
- `/recommendations/state` now reports, per media type, the active and previous
  pointers, active model/status/publication, active promotion evaluation ID,
  active/public shuffle epoch, and public rank ID separately from the newest
  diagnostic row. Top-level readiness derives from active pointers.
- Focused tests cover every mode/owner pair, utility ownership, disabled
  reshuffle, Saved policy, active-vs-latest publication, migration/data
  preservation, rollback-off behavior, and initial subscription-only More Like.

Mac proof at the target:

```text
catalog-service npm test: 875 pass / 0 fail
launcher deterministic tests: 86 pass / 0 fail
launcher production build: pass
```

## 1. Resume from the contained Pi

The recorded starting point is:

```text
Pi HEAD: 3ef1b2079f0cd2b45f92adf6b476bc59e1a99478
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
StoryDNA story-dna-v1/ai rows: 1096 preserved
Pi-local backup directory: /tmp/mango-frontier-h2-20260805T161937Z
companion.example dirt: preserved
```

Treat these as handoff evidence to read back, not permanent live truth. Keep the
existing backup directory. Before this deploy, make fresh timestamped Pi-local
SQLite online backups unless the operator proves the old backups are still
present, mode/ownership-safe, checksum-valid, read-only-openable, `quick_check`
clean, and no durable DB has changed since they were made. Never copy backups
off-box. Directory mode is `0700`; files are `0600`.

Before mutation, inventory Pi branch/full SHA/dirty state, services, effective
recommendation environment, DB paths/sizes, StoryDNA count, diagnostics, and
`PRAGMA quick_check`. Stop on overlapping source dirt. Preserve the recorded
companion dirt; do not stash/reset it by default.

## 2. Exact revision contract

The handoff and canonical status docs are committed after `TARGET_SHA`, so fresh
origin may be a documentation-only descendant. On the home Mac:

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
git merge-base --is-ancestor "$TARGET_SHA" origin/feat/native-experience
test -z "$(git diff --name-only "$TARGET_SHA"..origin/feat/native-experience | \
  awk '$0 != "AGENTS.md" && $0 !~ /^docs\// { print }')"
git show -s --format='%H %s' "$TARGET_SHA"
```

Stop if the descendant contains any executable/config change. Run exact-target
Mac proof from a clean detached worktree or by temporarily checking out the
target; do not claim branch-tip tests as target proof.

The ordinary `pi-deploy.sh` and `pi-exec-gate.sh` wrappers remain blocked by
[`docs/DEPLOY.md`](../DEPLOY.md): they do not pin the expected SHA and the deploy
wrapper can implicitly mutate AIOMetadata private state. Do not use them. Use a
human-reviewed Git-only target merge and manual build/restart with no addon sync.

On the Pi, after recording dirt and ensuring the couch is idle:

```bash
cd ~/mango
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor HEAD "$TARGET_SHA"
git merge --ff-only "$TARGET_SHA"
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
```

Do not run `git pull`, because that would select the later documentation-only
tip rather than the reviewed executable target. Do not reset a dirty tree.

## 3. Safe VOD-first configuration and build

Preserve the operator-owned environment file and change only these keys:

```bash
MANGO_VOD_RECS_V2=shadow
MANGO_YOUTUBE_RECS_V2=off
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

Remove obsolete `MANGO_VOD_CONTENT_PROFILE` and
`MANGO_STORY_DNA_AUTONOMOUS_BACKFILL` keys only; never touch stored data.

Build/restart without addon synchronization:

```bash
cd ~/mango
bash scripts/lib/pi-npm-deps.sh build src/catalog-service
bash scripts/lib/pi-npm-deps.sh build src/launcher
bash scripts/lib/pi-npm-deps.sh build src/companion
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
```

No dependency manifest changed. Run catalog tests, launcher build, and reviewed
Pi-local pre-couch/focus/reliability checks on this exact SHA.

## 4. VOD shadow, then serve

Trigger Movies and TV refresh jobs and poll each exact job ID to terminal:

```bash
curl -fsS -X POST http://127.0.0.1:3020/recommendations/refresh \
  -H 'content-type: application/json' -d '{"tab":"movies","reason":"deploy_shadow"}'
curl -fsS -X POST http://127.0.0.1:3020/recommendations/refresh \
  -H 'content-type: application/json' -d '{"tab":"series","reason":"deploy_shadow"}'
```

Require per domain:

- `model_version=vod-story-frontier-v1`, `profile_mode=progressive-v2`;
- current Household taste revision from real ratings/Saved/meaningful history;
- `scored_count + excluded_count == verified_count`, `unscored_count=0`,
  `coverage=1`, reserve at least 200, and six valid cached cards;
- existing enriched StoryDNA count never decreases; teacher/TMDB usage does not
  change while all provider work is off;
- `serving_pointer.active_ready=true`, active model/status/pointers match the
  published generation, and the evaluation is tied to
  `promotion_rank_generation_id`;
- in shadow, `public_rank_generation_id` and `public_shuffle_epoch` are null.

Prove a newer failed/building diagnostic row cannot replace the active pointer.
Prove Saved is exact Household in shadow and serve. In shadow/off, the launcher
must hide Shuffle and direct reshuffle must leave the active epoch unchanged.

After all shadow gates pass, change only VOD to `serve`, restart, and require
`public_rank_generation_id == active_rank_generation_id`, a non-null public
epoch, visible six-card rails, valid launches, focus/Back restoration, offline
last-good behavior, and five cache-only X presses. Success feedback requires
actual recommendation membership/order change.

## 5. YouTube shadow, then serve

Hold accepted VOD fixed. First prove YouTube `off` with a non-Household active
profile returns HTTP 200 plus only that profile's exact History/Saved utilities,
with no epoch change on `reshuffle=1`.

Set only YouTube to `shadow`, restart, enqueue `/youtube/refresh`, and poll the
exact job. Require complete authoritative subscription pagination, qualifying
Takeout/Mango-local history only, allowed provenance only, no generic cache or
Saved/profile/mood/VOD/companion/chart influence, honest stale last-good on
OAuth loss, and no public recommendation rails.

Then set only YouTube to `serve`, restart, and repeat state, rail order,
deduplication, subscription-only More Like, quota, focus, launch, offline, and
restart proof. Five X presses must leave API/search/quota/ranking counters
unchanged and keep History/Saved stable.

## 6. Latency, failure, and handoff

For each served domain, cached Home and five X responses must be service-side
p95 `<=250 ms` and perform no response-path provider, metadata, graph, corpus,
rank, or quota work. Attribute asynchronous low-water recovery separately.

On failure, disable only the affected domain. Full containment remains:

```bash
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
```

Restart and verify ordinary Continue, personal Saved/History in off, curated
VOD, and YouTube utilities. Code rollback uses a reviewed Git SHA. Restore a DB
backup only for proven corruption and only with explicit human approval.

Return exact SHA/config, backup metadata, test/gate results, job IDs,
accounting/reserves/pointers, StoryDNA/provider/quota deltas, latency,
screenshots, and rollback readiness. The user-owned ten-shuffle thematic and
relevance verdict remains explicitly **DEFERRED**.
