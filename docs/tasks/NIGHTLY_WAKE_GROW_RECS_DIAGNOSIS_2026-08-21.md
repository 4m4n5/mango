# Nightly wake grow/recommendations — diagnosis and local patch

**Evidence:** [`NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md`](NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md)  
**Source baseline:** `feat/native-experience` at `db74b217822f57ab552d28c33ab2f31905d83359`  
**Runtime boundary:** no Pi access, mutation, or deployment was performed.

## Follow-on refactor complete (local source 2026-08-21)

The **Trustworthy Recommendation Refactor** supersedes the containment patches
documented below for the rank/grow coupling class. Workstation HEAD at
documentation time: `293f8ec3` (uncommitted). Summary:

- Deterministic sparse IDF-weighted 0/1/2 lanes; legacy LOAO quarantined off
  by default (`MANGO_VOD_LEGACY_LOAO_RANK=1`).
- `vod_desired_revisions` (library migration 19); catalog enqueue-only; isolated
  `mango-vod-recs-worker.service` with file lease/heartbeat, ignores couch
  preemption, low-priority/≤384 MiB target; household taste/exclusion hash on
  desired state; activation-only ack; failed ranks pending with 1m–1h retry;
  transactional stale-revision check before pointer swap.
- Grow publication no longer waits on recommendation completion; nightly records
  separate `recommendation_rc`.
- Full `library.db` VACUUM removed from nightly; offline compaction hook backs
  up, stops enabled worker+catalog, `quick_check`, restores.
- Staged stale owns expired demotion + proactive renewal; grow-only pre-stage is
  trigger drain only.
- Truthful Top Picks; YouTube Detail **More to watch**; VOD Related unchanged.
- POT fd 200 closure in `youtube-pot-server.sh`.

Local tests: catalog **1163/1163**, launcher **141/141**, builds pass,
`gate-m3-library-grow.sh` pass. See
[STATUS.md](../STATUS.md#current-local-source--2026-08-21-trustworthy-recommendation-refactor).

**Still unproven without Pi:** worker rank duration/RSS, catalog serve latency,
three unattended nights, original ~522 demotion count on first staged stale
sweep, couch relevance/focus/playability. The sections below remain historical
diagnosis of the pre-refactor failure class and the `ad73f10` containment
patches — not current architecture.

## Independent diagnosis (historical — pre-refactor)

### 1. Successful grow was discarded by cross-phase status coupling — proven

The staged grow completed with `ok=true`, `all_rails_publishable=true`,
`best_effort_publish=true`, and +40 unique verified titles. The earlier stale
phase failed while critical addon manifests were unavailable.
`playability-maintenance.sh` copied that stale RC onto the successful grow RC,
while staged publication required both RC zero and JSON `ok=true`. The resulting
discard preserved failure memory but correctly left the live database at its
prior 10,233 titles
([incident lines 54–65, 88–136](NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md)).

This contradicted the documented best-effort contract: a target-short but
completed publishable grow is valid, while the stale pass is independent
maintenance evidence. The script now tracks `PUBLISH_RC` — the exit status of
the phase whose work actually landed in the staged DB — separately from the
nightly aggregate `REFRESH_RC`, and publication requires that phase RC plus its
own receipt `ok=true` (`playability-maintenance.sh:373-400,697-760`,
`scripts/diag/playability_refresh_decision.py`).

The decision deliberately does not read `stage`. `stage` is not part of a
successful refresh result; `extract_refresh_json.enrich_payload` copies it from
the best-effort `grow-run-state.json` heartbeat and falls back to
`completion_report` when that file is missing, so requiring `stage=publish`
would have discarded genuinely publishable corpora. For the same reason the
decision stays mode-agnostic: staging happens *before* phase 1, so a
couch-deferred nightly leaves real stale-phase work in the staged DB that the
previous behavior published and that must keep publishing. Failed phases,
`ok=false` receipts, synthesized fallback receipts, and grows with
`all_rails_publishable=false` are still discarded.

### 2. VOD refresh waiting and queued-job ownership had separate defects — proven

The playability jobs remained `queued` with `started_at=null`; therefore the
catalog never promoted those exact rows to running. The evidence does not prove
why the in-memory worker did not enter before the timeout. It does prove that
the waiter exited on one five-second `curl` timeout rather than its 900-second
budget ([incident lines 168–176](NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md)).

The waiter now retries transient reads until the total deadline, preserves
terminal failure/last-good behavior, and follows durable successor IDs instead
of declaring a superseded job complete
(`wait-vod-recommendation-jobs.sh`). The in-memory pending map now mirrors the
database's latest-only queued supersession, preventing an older coalesced ID
from consuming the completion slot (`src/catalog-service/src/index.ts:1673-1676`).

### 3. Catalog crashed on an operational SQLite write, through two channels — proven

`library.db` VACUUM overlapped an uncaught `SQLITE_BUSY` in
`updateRecommendationRefreshJobRuntime` from the story-graph heartbeat timer
([incident lines 75–78, 178–190](NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md)).
The catch path attempted the same runtime write again, allowing a diagnostic
checkpoint failure to escape the timer and terminate catalog. `library.db`
already opens with `busy_timeout = 5000` via `applySqliteHotPragmas`, so this is
lock duration — a VACUUM holding the write lock far longer than five seconds —
not a missing pragma.

Runtime job checkpoints are now best-effort only for `SQLITE_BUSY` and
`SQLITE_LOCKED`; semantic rank writes and publication remain strict
(`src/catalog-service/src/recommendations/jobs.ts:198-218`). Nightly VACUUM also
skips while a live recommendation-maintenance lease exists
(`nightly-library-refresh.sh:38-41,135-136`). Reliability proof remains after
VACUUM so it still measures the final nightly state.

A second channel carried the same class. The refresh queue's notifiers do
durable job bookkeeping, and a throw from `onRetainedLastGood` propagated out of
`drain()` into `flight`, which nothing awaits outside `idle()` — an unhandled
rejection, which Node terminates on. The same throw also skipped
`activeRecommendationJobs.delete(key)`, leaving that key permanently "active" and
matching the observed `recommendation maintenance already active` failures. The
couch-preempt successor timer had an uncaught tail for the same reason. Notifier
faults are now isolated and reported, `flight` can no longer reject, in-memory
ownership is released before the durable write, and the timer tail is caught
(`recommendations/background-refresh.ts:29-96`, `index.ts:1606-1660,2864-2880`).

### 4. Recent dead-process lease blocked restart work — strong inference

Catalog restarted about 20 seconds after the crash, inside the 30-second lease
freshness window, and both startup jobs failed with
`recommendation maintenance already active: vod:series`. The lease artifact was
not captured, so its exact contents are unproven; the timing, owner string, and
release-only-in-`finally` path support a dead-process lease.

Lease freshness now requires both a recent heartbeat and a live PID
(`src/catalog-service/src/recommendations/maintenance.ts:66-86`). This does not
weaken exclusion between live workers.

### 5. Wake-time local manifest readiness was not shared — proven source gap

The first catalog/indexer boot failed AIOStreams and AIOMetadata fetches, later
served a six-addon partial graph, and recovered only after restart. The shell
reachability wait and each Node `CatalogCore` fetch were independent. Exact
container/network timing is not captured, but the absence of an indexer-side
retry is source-proven.

Critical loopback manifests now retry under one shared bounded boot deadline;
remote manifests remain single-attempt and playability still fails closed if a
critical manifest never becomes valid (`src/catalog-service/src/core.ts:847-883,1404-1432`).
Only still-starting failures (connection refused/reset, `fetch failed`, timeouts,
5xx) retry — a 4xx or malformed manifest is a real misconfiguration and fails on
the first attempt rather than stalling boot for the whole budget. The budget is
purpose-aware: maintenance waits 90s because it must not index a partial addon
graph, while the couch path waits 20s and then keeps the existing
warn-and-continue behavior.

### 6. Monitor target mismatch was semantic, not corpus corruption — proven

The monitor used raw `grow_per_pass=20`; the indexer used the full-pool breadth
lane, `ceil(20 × 0.2)=4`. Python diagnostics now mirror pool headroom, policy
breadth, anchor diet, and environment overrides
(`scripts/diag/ops_grow_sla.py:65-101`). Likewise, 10,256 was summed rail-pool
membership while 10,233 was the distinct verified-title count.

## Not patched as root causes (historical)

- **Repeated movie rank deadlines — addressed in local refactor by isolated
  worker + deterministic lanes; Pi duration/RSS proof still open.** Movies
  exceeded the 15-minute rank budget on both of this day's runs (04:01–04:55 and
  15:17–16:05), while series finished in ~22 minutes
  ([incident lines 62–65, 163–176](NIGHTLY_WAKE_GROW_RECS_INCIDENT_2026-08-21.md)).
  Containment patches below kept last-good served and catalog alive; the refactor
  moves rank out of catalog and replaces the Bayesian/LOAO path by default.
- Launcher Chromium being stopped and repair being suppressed during active
  maintenance are current design behavior, not the grow discard cause.
- Thin-rail source/theme exhaustion is genuine yield evidence but did not make
  this best-effort grow unpublishable.
- `jq`, controller state, stale Live cache, and the later `mango-stack.sh`
  process-label observation were incidental or insufficiently reproduced.

## Local verification (historical — `ad73f10` containment)

- Catalog-service: **1,100/1,100 tests passed** (pre-refactor baseline).
- `gate-m3-library-grow.sh`: passed, including new publish-decision, lease,
  waiter, target-alignment, and catalog lifecycle tests.
- `scripts/mac-gate-pr.sh`: passed all local catalog, launcher, companion, HUD,
  stream-picker, deploy-hardening, and documentation gates.
- TypeScript build, shell syntax, Python compilation, focused lints, and
  `git diff --check`: passed.

**Post-refactor (2026-08-21):** catalog **1163/1163**, launcher **141/141**,
builds pass, grow gate includes POT fd and offline compaction tests.

## Still unproven without Pi runtime

1. A wake catch-up with stale failure plus successful grow publishes the staged
   +N corpus atomically on the Pi.
2. A transient five-second job read no longer terminates the waiter, and
   successor jobs reach a truthful terminal state within the total budget.
3. VACUUM skips active recommendation work and catalog remains live through the
   full nightly/proof sequence.
4. Dead-PID lease recovery works under actual systemd restart timing.
5. AIOStreams/AIOMetadata recover inside the shared local-manifest deadline on
   boot.
6. The recurring movie rank deadline's phase, page, CPU, memory, and I/O cause
   under the **new isolated worker** (historical in-catalog deadline class
   documented above).
7. The discarded +40 titles are absent from live state and require a future
   successful grow; this patch does not reconstruct deleted staged data.
8. That no third uncaught write path exists in the recommendation subsystem. The
   two found here were reached by reading every call site that runs outside a
   request scope (timers, `setImmediate`, queue tails), not by fault injection on
   the Pi.
9. **Refactor-specific:** worker peak RSS within ≤384 MiB envelope; catalog serve
   p95 under rank load; three unattended nights with enqueue-only grow;
   staged stale demotion magnitude (~522 original estimate); couch relevance,
   focus, and playability.

## Self-review corrections

A second adversarial pass over these patches found and fixed three defects in the
first round, all now covered by tests:

1. The publish gate required `stage=publish`, which is enriched from a
   best-effort heartbeat file — it would have discarded good grows whenever
   `grow-run-state.json` was missing.
2. That same gate was mode-restricted to `grow`, which silently stopped
   publishing the couch-deferred nightly's stale-phase work.
3. The boot manifest retry treated permanent failures (4xx, malformed JSON) as
   retryable and applied the 90-second maintenance budget to couch boot too.
