# Handoff: VOD recommendations, grow publication, and ranking — 2026-08-21

Work contract for an independent diagnosis and a principled redesign of how
Household VOD recommendations interact with playability grow, catalog liveness,
and nightly maintenance.

**Status (local source 2026-08-21):** the **Trustworthy Recommendation
Refactor** is source-complete on workstation HEAD `293f8ec3` (uncommitted).
See [STATUS.md](../STATUS.md#current-local-source--2026-08-21-trustworthy-recommendation-refactor)
for the current contract and local test matrix. **Not** Pi-deployed or
couch-observed. Historical observation windows below remain intact evidence for
the pre-refactor failure class.

This file is an **observation log plus product ask**. It is not a root-cause
analysis and not a patch plan. Prior chats, the local diagnosis at
[`NIGHTLY_WAKE_GROW_RECS_DIAGNOSIS_2026-08-21.md`](NIGHTLY_WAKE_GROW_RECS_DIAGNOSIS_2026-08-21.md),
and the patches in `ad73f10` are **inputs to re-examine**, not instructions to
extend. Re-read source. Re-derive conclusions. Invent the architecture.

| Field | Value |
|-------|--------|
| Branch | `feat/native-experience` |
| Pi SHA at proof | `ad73f1032db16b6d50c9d0d7cce8fd09f6f59188` |
| Incident evidence | [`NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md`](NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md) |
| Local diagnosis (no Pi) | [`NIGHTLY_WAKE_GROW_RECS_DIAGNOSIS_2026-08-21.md`](NIGHTLY_WAKE_GROW_RECS_DIAGNOSIS_2026-08-21.md) |
| Local refactor complete | workstation `293f8ec3` — deterministic lanes, desired-revision worker, enqueue-only grow (see STATUS) |
| Household Pi | hostname `mango`, SSH host `mango` |
| Proof window | 2026-08-21 10:43–12:17 PDT |
| Proof operator | home agent after `ad73f10` was already pushed |

## Agent contract

1. **Do not SSH, `pi-exec`, deploy, rsync, scp, or mutate the Pi** unless a human
   later asks. Runtime evidence for both the wake incident and the proof run is
   in this file and the two documents it cites.
2. Diagnose from **this evidence plus local repository source and tests**. Treat
   every causal sentence in the diagnosis doc as a claim to verify or refute.
3. The goal is not a pile of further containments. The goal is a **recommendation
   system that stays correct and lightweight on a Pi 5** while playability grow
   and nightly maintenance do their jobs. Ranking must not take the catalog down,
   discard verified library work, leak locks, or leave For You empty.
4. Do not weaken last-good recommendation retention, playability exact-main proof,
   git-only deploy, or the locked pad map (B=304, Y=308, X=307, −/+=314/315,
   L/R=310/311, ⌂=316).
5. Work on `feat/native-experience`. Do not force-push. Do not deploy unless a
   human asks after review.
6. Prefer a smaller ranking/refresh contract over raising timeouts, truncating
   the corpus, or dropping candidates to make a clock fit.
7. Deliver: (a) independent diagnosis of each outstanding failure class with
   source citations, (b) a principled target architecture for VOD recs vs grow vs
   catalog liveness, (c) ordered patches and tests, (d) what remains unproven
   without Pi/couch.

Read first: [`docs/STATUS.md`](../STATUS.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md),
[`docs/features/content-and-playback.md`](../features/content-and-playback.md),
[`docs/OPERATIONS.md`](../OPERATIONS.md), [`docs/TESTING.md`](../TESTING.md),
[`scripts/m3-play/playability/LIBRARY-GROWER-OPS.md`](../../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md).

## What the product is supposed to do

Household VOD For You is StoryDNA / story-graph ranking over the **verified
playability corpus**, isolated from YouTube. Grow is couch-silent maintenance:
stage a work DB, verify new titles, publish atomically when the grow receipt is
publishable. Nightly is stale refresh, then grow, then wait for VOD recs to
absorb the new corpus, then YouTube refresh, then SQLite maintenance, then
reliability proof.

Browse v3 X-shuffle is a cached weighted sample with **no provider or rank
work**. That path is not the failure under study. The failure was the **heavy
background rank / refresh** that ran inside catalog at startup, after playability
publication, and on couch-preempted resume — and how nightly grow coupled to it.

**Local refactor (2026-08-21) addresses the coupling class in source:** rank
work moved to `mango-vod-recs-worker.service` (ignores couch preemption,
low-priority/≤384 MiB); grow enqueues `vod_desired_revisions` with the live
household taste/exclusion hash; only **activated** ranks ack — failures stay
pending with 1m–1h retry; pointer swap checks stale revision transactionally;
playability/compaction stop the enabled worker before exclusive DB work and
restore after; nightly records separate `recommendation_rc`; full VACUUM
deferred to offline compaction; POT fd 200 closed; staged stale owns expiry
demotion; grow pre-stage is trigger drain only. Pi proof of duration/RSS/latency
and couch quality remains open.

Current documented knobs: `MANGO_VOD_RECS_V2=off|shadow|serve`; Fire/Water
ratings; last-good rails while a refresh is in flight. Legacy story-graph rank
timeout (`MANGO_STORY_GRAPH_RANK_TIMEOUT_MS`, default 15 minutes) applies only
when `MANGO_VOD_LEGACY_LOAO_RANK=1`. The enqueue-only grow path no longer waits
on a 900-second job-completion budget. Library SQLite `busy_timeout` is **5000
ms**.

## Two observation windows

### Window 1 — wake catch-up nightly (pre-patch)

Pi SHA `90d97586c8c5804fe2a0e949627a285b59341c26`. Run
`playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2`, 08:17:23–09:28:11 PDT.
Full artifact: the incident file. Short form:

- Persistent timer started catch-up after the Pi came back on LAN.
- Catalog first listen had **6 addons**, AIOStreams/AIOMetadata fetch failed,
  `configured_stream_providers.aiostreams=0`. Docker addons were already healthy.
- Stale phase `ok=false`, `catalog_boot_failed`, AIOStreams fetch failed.
- Grow receipt `ok=true`, `unique_verified_delta=40`, `unique_verified_after=10273`,
  `all_rails_publishable=true`, `maintenance_rc=1`.
- Log: `discarding failed or incomplete grow DB; live library unchanged`. Live
  unique stayed **10233**.
- Rec jobs from playability publication stayed `queued` / `started_at=null`.
- Waiter: `curl: (28) ... 5002 milliseconds` then
  `VOD recommendation exact job read failed`.
- Movies ranking hit the 15-minute deadline twice that calendar day
  (04:01–04:55 and 15:17–16:05). Series completed ~22 minutes at 04:23.
- Catalog crashed `SQLITE_BUSY` in `updateRecommendationRefreshJobRuntime` from a
  story-graph heartbeat during `library.db` VACUUM. systemd restart.
- Startup recs then failed `recommendation maintenance already active: vod:series`
  for **both** movies and series.
- Nightly: `playability_rc=10`, `youtube_rc=0`, `proof_rc=1`.
- Reliability library text said “10256 verified titles across 12 rails” while
  `titles.status='verified'` was 10233. Grow monitor `tgt=20` vs receipt
  `grow_target=4`.

### Window 2 — deploy `ad73f10` and prove the pipeline (post-patch)

Workstation had already landed 23 files in `ad73f10` (“Stop nightly cross-phase
coupling from discarding verified grow work”) after 1,100/1,100 catalog tests,
`gate-m3-library-grow.sh`, and `mac-gate-pr.sh`. Nothing in that commit had Pi
runtime proof yet. Home agent deployed git-only `--fast` at 10:44 PDT with
`MANGO_DEPLOY_ALLOW_DIRTY=1` (Pi dirty only `config/companion.example/*`).

#### Baseline (10:43 PDT, still on `896a714` until deploy)

- Unique verified **10233**, titles 30697, rail_pool 12228.
- Catalog `NRestarts=0`, PID 153378, addons=8, aiostreams=1, RSS ~975MB.
- Disk 31G used / 117G, 83G free.
- 70 `recommendation_refresh_jobs` rows. Movie job `588610c6` **running**
  `couch_preempted_resume` since 10:26:08, phase `heartbeat 6290/6290`, lease
  `vod:movies` PID 153378. Series `9b22d6bc` had completed 10:26:00–10:30:33.
- Playability lock free. Indexer inactive.

#### Deploy and gate

- Pi HEAD became `ad73f10`. Catalog rebuilt; health addons=8 immediately after
  stack restore.
- `pi-pre-couch-gate.sh` **failed**: catalog unit 660 pass / 1 fail.
  `cold Search state returns chrome immediately while the index warms` at
  `src/catalog-service/src/search/service.test.ts` asserted
  `performance.now() - started < 100`. Isolated rerun of that test **passed**
  (`duration_ms` 107 for the whole test; the assertion itself passed). Full gate
  was not re-run to green. Treat as a load-sensitive timing test, not as grow/recs
  proof.

#### Phase B — catalog restart addon graph (10:51:57)

- PID 193391 → wrapper 200653 → node 200795. `NRestarts=0`.
- Shell: waiting for 6 local manifests, then reachable.
- Listening 10:52:26: addons=8 including AIOStreams and AIOMetadata, aiostreams=1.
- Health curl timed out (3s) until 10:52:53; listen line already had a full graph.
- No `manifest boot failed` in this restart.
- On-Pi `node --test dist/core-manifest-retry.test.js`: 3/3, including
  “permanently broken local manifest fails fast”.

Catalog systemd `Environment=HOME=/home/aman`. No `XDG_CACHE_HOME` and no
`MANGO_RECOMMENDATION_MAINTENANCE_LEASE` pin on catalog or
`mango-playability-indexer.service`. Default lease path is therefore
`$HOME/.cache/mango/recommendation-maintenance.lease` for both catalog and
nightly shell **if HOME matches**.

#### Phase C — grow-only, nightly preset (run `playability-d24ea367-…`)

Started 10:54:04 via `playability-grow.sh --mode grow --preset nightly --detach`
with indexer-like probe-pool env. Couch marker idle (`age_sec=3472`).

**Unique count at catalog stop / hooks:** live `titles.status='verified'` became
**9711** (stale 3541, failed 17445, titles still 30697). Work DB unique 9711 then
9712. This is **not** the +40 discarded corpus coming back; it is a drop versus
the 10233 seen while catalog was up. Expired-looking verified (expires_at in the
past) was 0. Pre-stage log: `maintenance hooks: pre-stage sweep/drain/migrate on
live DB`.

Grow ran on staged
`/home/aman/.cache/mango/playability-work-playability-d24ea367-07dd-4199-a70a-fc4a27cee097.db`.
Monitor `tgt=4` on grow rails during the run. `grow-run-state.json` `grow_target=4`.

Published:

```
stage DB: publishing completed grow to /etc/mango/playability.db
unique library: 9760 titles (+49 this run, was 9711)
maintenance refresh rc=0 duration_ms=709996
```

Receipt `refresh-playability-d24ea367-07dd-4199-a70a-fc4a27cee097.json`:
`ok=true`, `mode=grow`, `unique_verified_delta=49`, `unique_verified_after=9760`,
`verified=45`, `failed=10`, `all_rails_publishable=true`, `best_effort_publish=true`,
`grow_target_met=false`, `grow_target_warning=true`, `maintenance_rc=0`,
`duration_ms=694037`. Short rails: series-reality-casual, series-india-picks,
movies-quick-watches, movies-comedy. Live unique after publish: **9760**.

Then waiter for `399c11a3` (movie) and `3afec1e7` (series),
`trigger_reasons=["playability_corpus_publication"]`, **queued, started_at=null**.
Meanwhile restore-startup jobs `0a05d4da` (movie) and `1a9dcb3d` (series) were
**running** from 11:06:22. Lease `vod:movies` then later `vod:series`.

Waiter log (this SHA):

```
VOD recommendation job read delayed for 3afec1e7-…; retrying within 900s budget
VOD recommendation jobs timed out after 900s (399c11a3-…:queued,3afec1e7-…:queued); last-good remains active
```

Catalog at 11:22:18: last-good movies retained,
`story graph ranking exceeded its background deadline`. `NRestarts=0`.
Grow/waiter processes gone by 11:24. Playability jobs still queued.

Movie job `0a05d4da-27f4-4545-93a0-1a3f56aee92d` at timeout:

| Field | Value |
|-------|--------|
| status | still `running` with `error_code=refresh_failed` (error text null) |
| started | 11:06:22 |
| deadline | 11:21:22 |
| last heartbeat | 11:21:13 |
| checkpoint | `{"phase":"heartbeat","cursor":null}` |
| `MANGO_STORY_GRAPH_RANK_TIMEOUT_MS` | **unset** in catalog environ |
| peak RSS | 1023442944 (~1.02 GiB) |

Resource-metric timestamps:

| Prefix | First | Last | Span |
|--------|-------|------|------|
| `scan` 0 → 6024/6024 | 11:06:22 | 11:07:06 | ~44s |
| `compile_profiles` 128 → 6026/6026 | 11:07:08 | 11:07:11 | ~4s |
| `content_profiles` 128 → 6026/6026 | 11:07:12 | 11:07:18 | ~6s |
| `heartbeat` only | 11:21:13 | 11:21:13 | one sample; ~14 min undocumented after profiles |

Corpus size on that job: **6026** titles in compile/content_profiles. Earlier
pre-deploy job compiled **6290**.

#### Lock leak that blocked nightly

After grow finished, `flock` on `playability-maintenance.lock` still failed.
`lsof`: PID **231679** `deno run … ../src/main.ts --port 4416` (bgutil POT),
PPID 1, **fd 200** → the maintenance lock. STIME 11:06 (restore window).
`scripts/m6-ship/youtube-pot-server.sh` starts deno with `nohup … &` from a
subshell inside node_modules; it inherits the grow process fds.

Operator recovery: `youtube-pot-server.sh stop` then `start` from a fresh SSH.
Lock freed. New deno did **not** hold the lock. Nightly could start. **No source
patch for this was deployed.**

#### Phase D — full nightly via systemd (run `playability-592027c9-…`)

`systemctl --user start mango-playability-indexer.service` at 11:25:35.
ExecStart is `nightly-library-refresh.sh --mode nightly --preset nightly`.

- Phase 1 stale: **`ok: true`** (AIOStreams up). 45s cooldown.
- Phase 2 grow published:

```
maintenance refresh rc=0 duration_ms=1760648
stage DB: publishing completed grow to /etc/mango/playability.db
unique library: 9959 titles (+39 this run, was 9920)
```

Receipt: `ok=true`, `delta=39`, `after=9959`, `all_rails_publishable=true`,
`maintenance_rc=0`. Live unique **9959**. Stale-fail + grow-success was **not**
reproduced (stale succeeded). Cross-phase publish with both phases healthy did
publish.

Waiter jobs `b516ef8b` (movie) and `101d1871` (series) playability publication,
again **queued**. Startup `a81bfdbe` / `e09b8819` running from 11:55:28.

```
VOD recommendation job read delayed for b516ef8b-…; retrying within 900s budget
VOD recommendation job read delayed for 101d1871-…; retrying within 900s budget
VOD recommendation jobs timed out after 900s (…:queued,…:queued); last-good remains active
nightly library refresh: playability_rc=10
youtube refresh: terminal job_id=9506628a-… complete … quota_used_today=293 … all v2 phases ok
nightly library refresh: complete playability_rc=10 youtube_rc=0
nightly library refresh: VACUUM skipped (VOD recommendation maintenance active)
nightly library refresh: proof_rc=0
```

Indexer unit: `Result=success`, `ExecMainCode=1`, `ActiveState=inactive`.
Catalog `NRestarts=0` PID 364722 through nightly. Movie deadline again at
**12:11:33** (last-good movies retained).

#### Dead-PID lease check (12:15:07 catalog restart)

Lease before restart: `owner=vod:series`, `pid=364722`. After restart PID
**379630**, `NRestarts=0`. New startup jobs `8084a36f` (movie) and `047d7362`
(series) **running** at 12:15:09 — not `already active`. Prior playability jobs
marked coalesced/superseded into those successors. Health addons=8, aiostreams=1.

#### Last-good serving (API at 12:16, not couch)

`GET /recommendations/state`: `enabled=true`, `vod_mode=serve`,
`story_frontier.mode_ready=true`, `public_ready=true`.

Movies domain: `rank_generation_id=224`, `status=complete`, `verified_count=6635`,
`serving_pointer.active_ready=true`, `serve_blockers=[]`,
`last_good_publication=1786820762817` (older than today — movies did not publish
a new generation during the proof window). `worker_latency_ms=513504` on the
stored evaluation record.

Series domain: `rank_generation_id=241`, `last_good_publication=1787333160168`
(~10:26 PDT, the completed series job). `worker_latency_ms=244048`.
`active_ready=true`, `serve_blockers=[]`.

YouTube job `9506628a` complete 12:11:58–12:12:34.

Couch For You / Related / blank-rail observation: **not done**. Related HTTP
probes used here were YouTube `related` or nonexistent VOD paths (404). Human
TV check remains deferred.

End of proof: Pi HEAD still `ad73f10`, lock free, catalog PID 379630,
`NRestarts=0`, live unique **9959**. Startup recs still running.

## What `ad73f10` changed in source (inventory, not a verdict)

23 files. Read the commit. Named surfaces:

- `scripts/diag/playability_refresh_decision.py` and tests — publish vs discard
  from receipt + phase RC, not stale RC copied onto grow RC.
- `scripts/m3-play/playability/playability-maintenance.sh` — `PUBLISH_RC` vs
  aggregate `REFRESH_RC`.
- `scripts/m3-play/playability/wait-vod-recommendation-jobs.sh` — retry slow
  reads inside 900s; follow `successor_job_id` on coalesced rows.
- `src/catalog-service/src/index.ts` — pending-map supersession.
- `src/catalog-service/src/recommendations/jobs.ts` — SQLITE_BUSY/LOCKED on
  runtime checkpoints best-effort.
- `src/catalog-service/src/recommendations/background-refresh.ts` — isolate
  notifier faults; release in-memory ownership.
- `src/catalog-service/src/recommendations/maintenance.ts` — lease freshness
  requires live PID.
- `src/catalog-service/src/core.ts` + `core-manifest-retry.test.ts` — bounded
  loopback manifest retry; 4xx/malformed fail fast; purpose-aware budget.
- `scripts/m3-play/playability/nightly-library-refresh.sh` — skip VACUUM while
  rec maintenance lease is live.
- `scripts/diag/ops_grow_sla.py` — monitor target mirrors indexer breadth lane
  (`ceil(grow_per_pass × 0.2)=4` vs raw 20).
- `scripts/diag/recommendation_maintenance_lease.py`.

Local-only verification of that commit (not Pi): 1,100 catalog tests, grow
regression gate, `mac-gate-pr.sh`.

## Outstanding issues and failures

Each item is a **failure or risk still visible after `ad73f10`**. Group them.
Do not assume one root cause.

### A. Ranking never finishes for movies inside the 15-minute budget

Observed on **both** 2026-08-21 windows and **twice** during the proof run
(11:22:18, 12:11:33), plus overnight 04:01–04:55 pre-patch. Series can complete
(~22 min at 04:23; ~4.5 min for `9b22d6bc` 10:26–10:30 on a resume path).

Proof-run instrumentation: scan + compile + content_profiles for 6026 titles
finished in **under a minute**. The next ~14 minutes produced **no rank-phase
metrics**, only a late `heartbeat` sample, then deadline. Peak RSS ~1.0–1.2 GiB
(catalog `MemoryHigh=1280M`, `MemoryMax=1536M`). Default timeout 15 minutes.
`worker_latency_ms` stored on movies evaluation: **513504** (~8.6 min) for an
older complete generation 224 — different from today’s unfinished runs.

Raising `MANGO_STORY_GRAPH_RANK_TIMEOUT_MS` without a finished duration is a
guess. Truncating corpus or dropping candidates to beat the clock is out of
scope unless the new architecture explicitly redefines the ranked set.

### B. Playability-publication rec jobs do not run, so nightly `playability_rc=10`

Every proof wait: exact IDs `playability_corpus_publication`, status `queued`,
`started_at=null`, until 900s timeout **or** a later catalog restart coalesces
them into `service_startup` jobs.

Startup jobs for the same tabs are already `running` and hold
`recommendation-maintenance.lease` (`vod:movies` / `vod:series`). Waiter now
survives 5s curl timeouts (proven) but still exits 10 because those IDs never
become running/complete. Grow **does** publish first.

Nightly unit `ExecMainCode=1` with systemd `Result=success` (oneshot mapping).
Coordinator treats rec-wait failure as `playability_rc=10` even when the corpus
landed.

### C. Heavy rank vs exclusive indexer vs SQLite

Grow **stops catalog** for exclusive playability. Restore starts catalog, which
immediately starts **two** 15-minute rank flights and a 1 GB RSS process, then
nightly tries to wait on different job IDs, then may VACUUM `library.db`.
Pre-patch this killed catalog (`SQLITE_BUSY`). Post-patch VACUUM **skipped**
while the lease was live (proven). Rank still saturates the only catalog
process that also serves couch HTTP (health curl 3–5s timeouts during rank).

`busy_timeout=5000` in `src/catalog-service/src/sqlite-hot.ts`. Heartbeat
`setInterval` 10s writes job runtime.

### D. YouTube POT inherits the playability flock

Proven 11:24–11:25 PDT: deno `:4416` held `playability-maintenance.lock` after
grow exited. `youtube-pot-server.sh` `nohup` without closing inherited fds.
Blocked the next nightly until POT was restarted. Same class of “child keeps
maintenance exclusion” as any other restore subprocess.

### E. Unique verified count is not a single number

| When | Unique verified | Notes |
|------|-----------------|--------|
| Window 1 live after discard | 10233 | Catalog up; WAL present |
| Window 1 grow receipt (discarded) | 10273 (+40) | Staged only |
| Window 2 catalog-up baseline | 10233 | rail_pool 12228; playability-status verified_pool total 10261 |
| Window 2 after catalog stop + hooks | 9711 | stale 3541 |
| After grow C publish | 9760 (+49 vs 9711) | |
| After nightly D publish | 9959 (+39 vs 9920 work baseline) | stale phase recovered some; not back to 10233 |

Reliability copy used **rail-pool slot sums** (10256) vs distinct `titles`
verified (10233). Monitor `tgt` 20 vs JSON 4 was a **SLA helper bug**; `ad73f10`
aligned grow rails to 4. `ai-cricket-channels` still shows monitor tgt 20 and
0 verified; it is extra-pool / not in the grow receipt.

The 10233→9711 drop at maintenance start was **not explained** in the proof run
beyond “hooks ran; expired verified count was 0”. It is a library-size
observation the rec/grow design must not paper over.

### F. Addon graph at first listen is still a wake hazard

Window 1: 90s localhost wait still produced a 6-addon catalog without AIOStreams.
Window 2 restart with addons already up: 8-addon graph. Retry tests pass in
unit isolation. Wake-from-cold with Docker racing catalog is **not re-proven**.
Playability stale still fails closed if a critical manifest never becomes valid.

### G. Last-good vs “jobs complete”

API last-good was non-empty (`active_ready=true`, empty `serve_blockers`) while
rank was failing. Movies generation **224** was not updated during the proof
window. Series **241** was from 10:26. Acceptance “Movies and Series For You
visibly refreshed on the couch” is **unproven**. “No blank rail” is API-plausible,
not TV-observed.

Job row `status=running` can coexist with `error_code=refresh_failed` after
deadline.

### H. Pre-couch gate flake

`assert.ok(performance.now() - started < 100)` in Search chrome-warming failed
once on the Pi under the full catalog suite. Unrelated to grow, but the gate
did not go green on this SHA.

### I. Historical / incidental (still in the incident file)

`jq` missing on the Pi. `mango-stack.sh` labeled indexer running after the unit
was dead. Thin rails (india-picks, reality-casual) miss grow targets across many
nights — yield, not publication. Launcher Chromium stopped during maintenance is
current design. Watchdog skips UI repair while playability lock is held. Display
sleep unimplemented (STATUS). Pi `companion.example` dirty. Catalog RSS 200MB
idle → ~1 GB during rank.

### J. What `ad73f10` proved vs did not prove

| Claim | Pi result |
|-------|-----------|
| Publishable grow is not discarded because stale RC is 1 | Not reproduced (stale succeeded on the nightly). Grow-only and healthy nightly **did publish**. |
| 5s curl no longer ends the waiter | **Proven** (delayed + 900s timeout). |
| VACUUM skips active rec lease | **Proven**. |
| Catalog stays up through nightly | **Proven** (`NRestarts=0`). |
| Dead-PID lease does not block restart recs | **Proven** (startup jobs running). |
| Loopback manifest retry on cold wake | **Not proven** (addons were already up). |
| Movie rank finishes | **Failed** as expected; not patched. |
| Rec jobs from corpus publication complete | **Failed**. |
| `playability_rc=0` | **Failed** (rc=10). |
| POT does not steal the grow lock | **Failed**. |
| Unique count stable across catalog stop | **Failed** (10233→9711). |

## Source surfaces to read (inventory)

Playability / nightly:

- `scripts/m3-play/playability/playability-maintenance.sh`
- `scripts/m3-play/playability/playability-grow.sh`
- `scripts/m3-play/playability/playability-coordinator.sh`
- `scripts/m3-play/playability/nightly-library-refresh.sh`
- `scripts/m3-play/playability/wait-vod-recommendation-jobs.sh`
- `scripts/m3-play/playability/playability-indexer.ts`
- `scripts/diag/playability_refresh_decision.py`
- `scripts/diag/grow_monitor.py`, `scripts/diag/ops_grow_sla.py`
- `src/catalog-service/src/playability/grow-target.ts`
- `src/catalog-service/src/playability/refresh.ts`

Catalog boot:

- `scripts/m2-catalog/service/run-catalog-service.sh`
- `src/catalog-service/src/core.ts`

Recommendations (the system under redesign):

- `src/catalog-service/src/recommendations/story-graph-service.ts`
- `src/catalog-service/src/recommendations/story-graph-rank-worker-client.ts`
- `src/catalog-service/src/recommendations/background-refresh.ts`
- `src/catalog-service/src/recommendations/maintenance.ts`
- `src/catalog-service/src/recommendations/jobs.ts`
- `src/catalog-service/src/index.ts` (`POST /recommendations/refresh`, `GET /recommendations/jobs/:id`, `GET /recommendations/state`)
- `src/catalog-service/src/sqlite-hot.ts`
- `scripts/m1-foundation/ui/systemd/mango-catalog.service` and drop-ins
  (`frontier-memory.conf`, etc.)

Restore / fd leak:

- `scripts/m6-ship/youtube-pot-server.sh`
- `scripts/mango-stack.sh`
- `scripts/mango-health-repair.sh`

## Required output

After an independent deep dive:

1. Characterize each of A–J (and any new class you can defend from source).
   Separate grow publication, rec job lifecycle, rank workload, catalog
   liveness, lock/fd hygiene, and library-count semantics.
2. Propose a **target contract** for VOD recommendations on this hardware:
   what work runs at boot vs after corpus publish vs on the couch; what is
   synchronous vs incremental; what process isolation exists; how last-good is
   guaranteed; how grow publication is acknowledged without a 900s wait on job
   IDs that never start; how rank work stays within Pi memory/CPU without
   discarding verified titles.
3. Patch toward that contract in principled order with tests. Do not stack
   more containments that leave movies unable to rank and nightly always
   `playability_rc=10`.
4. Do not SSH. Do not deploy. Do not run grow against the live Pi.
5. Summarize remaining risk, including the discarded Window-1 +40 titles (gone
   from live) and the Window-2 unique count still below the 10233 catalog-up
   baseline.

### Local refactor delivered (2026-08-21, workstation only)

| Target contract item | Local source implementation |
|----------------------|----------------------------|
| Process isolation | `mango-vod-recs-worker.service`; catalog enqueue-only; ignores couch preemption; low-priority/≤384 MiB |
| Desired revision ack | `vod_desired_revisions` (migration 19); household taste/exclusion hash; **activated-only** ack; failures pending with 1m–1h retry |
| Stale before pointer swap | `updateActiveGeneration` transactional desired-revision check |
| Grow does not wait on rank | `playability-maintenance.sh` queues revision; no waiter on critical path |
| Exclusive DB windows | playability-maintenance + offline compaction stop enabled worker before publish/VACUUM; restore after |
| Deterministic rank within Pi envelope | 0/1/2 IDF-weighted lanes; full-corpus centroids |
| Truthful serve | Top Picks fallback; activation gates; last-good retention without false ack |
| Nightly VACUUM decoupled | removed from `nightly-library-refresh.sh`; `library-offline-compaction.sh` |
| fd leak class | `youtube-pot-server.sh` closes fd 200 before detach |
| Staged stale demotion | expiry sweep on stale refresh only; grow pre-stage trigger drain only |

**Still unproven on Pi:** rank duration/RSS, catalog latency, three unattended
nights, original ~522 demotion magnitude on first staged stale sweep, couch
relevance/focus/playability. Deploy and gate before treating handoff as closed.

Pi artifacts already captured (do not fetch):

| Path | Role |
|------|------|
| `~/.cache/mango/ops/refresh-playability-d159c2df-….json` | Window 1 discarded grow receipt |
| `~/.cache/mango/ops/refresh-playability-d24ea367-….json` | Window 2 grow-only published |
| `~/.cache/mango/ops/refresh-playability-592027c9-….json` | Window 2 nightly published |
| `~/.cache/mango/ops/maintenance-playability-*.log` | Matching transcripts |
| `~/.cache/mango/playability-grow.log` | Stage/publish/discard |
| `~/.cache/mango/nightly-library-refresh.log` | Append-only; grep the latest header |
| `/etc/mango/library.db` `recommendation_refresh_jobs` | Job rows above |
| `/etc/mango/playability.db` | Live corpus after 9959 |
