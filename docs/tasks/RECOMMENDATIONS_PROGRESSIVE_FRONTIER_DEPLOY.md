# Recommendations latest-only deployment runbook

Status: ready for an exact-SHA home-agent deployment. Mac-side implementation
and tests do not constitute Pi or couch proof.

This rollout installs the sole executable recommendation architecture:

- VOD: `vod-content-profile-v2` + `vod-story-frontier-v1`.
- YouTube: subscription/history provenance-gated v2.
- StoryDNA: existing compatible `story-dna-v1` documents are immutable
  overlays; new teacher work is optional and frontier-only.

The cleanup removes code paths, not data. Do not delete, rewrite, merge, vacuum,
or “fresh start” runtime state. Historical tables, columns, migrations, ratings,
Saved rows, watch history, profiles, playability, StoryDNA, generations, and
provider ledgers must remain intact.

## 1. Exact revision and safety boundary

Set `TARGET_SHA` to the full pushed SHA from the handoff. Work only on
`feat/native-experience`. Never use rsync, scp, a tarball, or copied databases.

Before changing the Pi:

1. Record Pi branch, full SHA, dirty state, service status, effective
   recommendation environment, database paths/sizes, and current recommendation
   diagnostics.
2. Require an idle couch and no active playback.
3. Run `PRAGMA quick_check` on the live library and playability databases.
4. Create timestamped Pi-local SQLite online backups of both databases. Keep
   the directory mode `0700` and files `0600`; verify non-zero size, checksum,
   read-only open, and `quick_check`. Never print rows or copy backups off-box.
5. Stop if Pi-local source changes overlap the deployment. Do not reset them.

The repository's unattended deploy wrapper remains blocked by the warnings in
[`docs/DEPLOY.md`](../DEPLOY.md). Use the reviewed exact-SHA Git-only manual path
below; do not invoke `pi-deploy.sh` or `pi-exec-gate.sh` as a shortcut.

## 2. Safe initial configuration

Preserve the operator-owned environment file and change only these keys:

```bash
MANGO_VOD_RECS_V2=shadow
MANGO_YOUTUBE_RECS_V2=shadow
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

`MANGO_VOD_CONTENT_PROFILE` and
`MANGO_STORY_DNA_AUTONOMOUS_BACKFILL` are obsolete and should be removed from
configuration only; removing an environment key does not remove data.

## 3. Pull, build, and restart

On the home Mac, prove the pushed branch equals `TARGET_SHA`. On the Pi, fetch
the named branch, require a clean/non-overlapping tree, fast-forward it, and
prove the resulting full SHA exactly:

```bash
cd ~/mango
git fetch origin feat/native-experience
test "$(git rev-parse origin/feat/native-experience)" = "$TARGET_SHA"
test "$(git branch --show-current)" = feat/native-experience
git pull --ff-only origin feat/native-experience
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
```

Build without running addon/config synchronization:

```bash
cd ~/mango
bash scripts/lib/pi-npm-deps.sh build src/catalog-service
bash scripts/lib/pi-npm-deps.sh build src/launcher
bash scripts/lib/pi-npm-deps.sh build src/companion
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

If dependency manifests changed, use `npm ci && npm run build` within each
affected package. This change itself adds no dependency.

## 4. Build healthy shadow reserves

Confirm the service loaded the safe configuration. Trigger one VOD refresh for
each tab and one YouTube refresh from localhost:

```bash
curl -fsS -X POST http://127.0.0.1:7777/recommendations/refresh \
  -H 'content-type: application/json' -d '{"tab":"movies","reason":"deploy_shadow"}'
curl -fsS -X POST http://127.0.0.1:7777/recommendations/refresh \
  -H 'content-type: application/json' -d '{"tab":"series","reason":"deploy_shadow"}'
curl -fsS -X POST http://127.0.0.1:7777/youtube/refresh \
  -H 'content-type: application/json' -d '{"reason":"deploy_shadow"}'
```

Poll every returned job at
`GET /recommendations/jobs/<job_id>` until terminal. A timeout or failed job is
a blocker, not permission to delete caches or weaken thresholds.

Require VOD diagnostics for Movies and TV to show:

- active model `vod-story-frontier-v1` and profile
  `vod-content-profile-v2`;
- Household taste revision built from current Fire/Water, Saved, and meaningful
  Mango VOD history;
- `eligible_ranked + sparse_unresolved + other_excluded == verified`;
- coverage `1`, no unexplained unscored rows, reserve depth at least `200`, and
  a valid six-card cached slate;
- every serving candidate currently verified-playable and poster-bearing;
- existing enriched StoryDNA count never decreases;
- teacher/frontier/TMDB usage remains unchanged while all three are off.

Require YouTube diagnostics to show a complete current generation sourced only
from authoritative subscriptions and qualifying Takeout/Mango-local history.
Generic cache, Search, Saved, profiles, mood, VOD, charts, and AI catalogs must
not contribute provenance. OAuth absence may produce an explicitly stale
last-good generation; it must not be disguised as fresh.

## 5. Pi gates and promotion

Run the catalog-service test suite and launcher build on the exact Pi SHA, then
the applicable Pi-local smoke/focus/reliability gates described in
[`docs/DEPLOY.md`](../DEPLOY.md). Because the wrapper is blocked, do not use a
gate command that silently pulls or synchronizes addons; run its Pi-local
underlying checks after reviewing it.

Measure cached Home and five X presses. They must cause zero metadata, provider,
graph, rank, or YouTube quota work; VOD/YouTube cached service p95 must be at
most 250 ms. Verify focus/scroll restoration and four-slate repeat avoidance.

If every automated gate is green, set both domains independently to `serve`,
restart once, and repeat diagnostics, Home/X, launch, D-pad, Back, offline, and
restart checks. This authorization prepares the Pi for human couch testing; it
does not claim the human relevance gate passed.

Keep the Companion frontier off for the initial couch test. It is optional and
may be enabled later only with the locked bounds:

```bash
MANGO_STORY_DNA=1
MANGO_STORY_DNA_WORKER_MODE=frontier
MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE=12
MANGO_STORY_DNA_FRONTIER_ROLLING_30D=96
MANGO_STORY_DNA_FRONTIER_BATCH=4
```

Never reintroduce a full-corpus teacher loop. TMDB remains optional and off
unless exact-ID credentials and visible attribution are already approved.

## 6. Failure and rollback

On any recommendation failure:

```bash
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
```

Restart and verify ordinary Continue, Saved, curated VOD, YouTube History, and
YouTube Saved remain usable. If code rollback is required, select a reviewed
earlier Git SHA and rebuild; restore a database backup only for a proven
migration corruption and only with explicit human approval. Never delete rows
to roll back recommendation behavior.

The handoff report must include exact SHA/config, backup metadata, test/gate
results, job IDs, generation/accounting/reserve counts, provider/quota deltas,
latencies, screenshots, rollback state, and explicit `DEFERRED` entries for the
ten-shuffle human relevance/thematic judgment.
