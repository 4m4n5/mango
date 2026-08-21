# Nightly wake grow/recs incident — 2026-08-21

Evidence pack and work contract for an independent diagnosis and patch.
This file records **observed facts, artifacts, and source surfaces**. It does
not state root causes and does not prescribe a patch.

| Field | Value |
|-------|--------|
| Incident window | 2026-08-21 08:17–09:28 PDT (Pi local) |
| Capture time | 2026-08-21T09:44:45-07:00 |
| Pi hostname | `mango` |
| Pi branch | `feat/native-experience` |
| Pi SHA | `90d97586c8c5804fe2a0e949627a285b59341c26` |
| Pi dirty tree | `config/companion.example/compiled-notes.md`, `config/companion.example/profile.yaml` (operator-owned; not opened here) |
| Mac authoring SHA when this file was written | see git history of this document |
| Run id | `playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2` |
| systemd unit | `mango-playability-indexer.service` |
| Start | Fri 2026-08-21 08:17:23 PDT |
| Exit | Fri 2026-08-21 09:28:11 PDT |
| Unit Result | `success` with `ExecMainCode=1` `ExecMainStatus=0` |
| Nightly summary | `playability_rc=10` `youtube_rc=0` `proof_rc=1` |
| Live `playability.db` after the run | `PRAGMA quick_check=ok`; `titles.status='verified'` **10233**; `titles` 30697; `rail_pool` 12227 |
| Reliability at 09:44 PDT | yellow; stack/catalog/live/library/youtube/voice green; maintenance/proof/rail_growth yellow |
| Catalog at 09:44 PDT | `ok=true` `core=ready` addons=8 including AIOStreams and AIOMetadata; `configured_stream_providers.aiostreams=1` |

## Agent contract

1. **Do not SSH, `pi-exec`, deploy, rsync, scp, restart the Pi stack, or mutate Pi state.** All runtime evidence needed for this incident is in this file.
2. Diagnose from **this evidence plus local repository source and tests**. Treat this document as an observation log, not as a root-cause analysis.
3. Do not inherit any prior chat diagnosis. Re-derive conclusions from primary sources.
4. Work on `feat/native-experience`. Do not force-push. Do not deploy unless a human explicitly asks after review.
5. Patch only what the diagnosis supports. Prefer small, test-backed changes. Do not weaken playability proof, last-good recommendation retention, or git-only deploy rules.
6. Deliver: (a) an independent written diagnosis with evidence citations, (b) a principled patch plan ordered by failure class, (c) the source patches and tests, (d) what remains unproven without Pi runtime.

Read first: [`docs/STATUS.md`](../STATUS.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), [`docs/OPERATIONS.md`](../OPERATIONS.md), [`docs/features/content-and-playback.md`](../features/content-and-playback.md), [`scripts/m3-play/playability/LIBRARY-GROWER-OPS.md`](../../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md).

## Context of the observation

The household Pi had just come back onto the LAN after being off-network. Uptime at first check was ~2 minutes (08:19 PDT). Persistent playability timer started a catch-up nightly (`Persistent=true`). Human monitoring watched grow, then rec-job wait, then unit exit. No operator abort, no manual stack restart, and no deploy were performed during the run.

## Timeline (PDT, 2026-08-21)

Times are Pi local. Sources: `journalctl --user-unit=mango-playability-indexer.service`, `journalctl --user-unit=mango-catalog.service`, `~/.cache/mango/playability-grow.log`, `~/.cache/mango/ops/maintenance-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.log`, `~/.cache/mango/ops/refresh-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.json`, `recommendation_refresh_jobs`.

| Time | Observation |
|------|-------------|
| 08:17:23 | `mango-playability-indexer.service` starts (`grow_nightly`, run id above). Pi uptime ~0. Persistent missed 03:00 timer. |
| 08:17:25 | Catalog: waiting for 6 local addon manifests. |
| 08:17:26 | `playability-maintenance: mode=nightly preset=nightly`. Log: `stopping launcher browser`. |
| 08:17:27 | Maintenance hooks on live DB. |
| 08:17:28 | Catalog warning: `manifest boot failed for AIOStreams: fetch failed`. |
| 08:17:31 | Catalog warning: `manifest boot failed for AIOMetadata: fetch failed`. |
| 08:17:32 | VOD rec job `8a3490e2-c4cc-48d1-818c-ec1c28e1eda0` queued/started (`domain=vod`, `content_type=movie`, `trigger_reasons=["service_startup"]`). |
| 08:17:34 | Maintenance hooks `warn rc=1 (continuing — grow still runs)`. Work DB staged: `/home/aman/.cache/mango/playability-work-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.db`. |
| 08:17:36 | Phase 1 stale refresh starts. |
| 08:17:39 | Stale JSON: `ok: false`, `mode: stale`, `stage: core_boot`, `failure_category: catalog_boot_failed`, `error: manifest boot failed for AIOStreams: fetch failed`. Then `phase cooldown: 45s`. |
| 08:17:57 | Catalog listening `:3020`. Health at this era (08:19 sample): `addons=6` names Cinemeta, Bharat Binge, four Live addons; **AIOStreams and AIOMetadata absent**; `configured_stream_providers.aiostreams=0`. |
| 08:18:24 | Phase 2 grow starts. Hit-rate benchmark excluded from critical path. Grow baseline unique_verified 10233, verified_pool 10256. |
| 08:18:25 | Catalog browse tabs warmed. |
| 08:18:49 | Watchdog `mango-health-repair.sh --quiet` finished success in ~0s (playability maintenance was active). |
| ~08:19 | Reliability `red`: stack `launcher, browser`. Chromium unit inactive since 08:17:26. Pad waiting. Indexer running. Docker AIOStreams/AIOMetadata containers already `Up 9 hours (healthy)` and later returned HTTP 200 for manifests. |
| 08:33:25 | Catalog: `recommendation background refresh retained last-good movies snapshot for household and will retry: story graph ranking exceeded its background deadline`. |
| 08:49:15 | Same movies last-good + retry + ranking deadline message. |
| 09:05:06 | Movies job `8a3490e2…` completed `failed`, `error=story graph ranking exceeded its background deadline`, `error_code=refresh_failed`. Catalog log omits “will retry” on this line. |
| 09:08:42 | `merged failed grow memory: failed_titles=72 candidate_rejections=209 verify_logs=39`. Then `discarding failed or incomplete grow DB; live library unchanged`. Grow log: `discarded failed or incomplete grow DB`. Maintenance log: `maintenance refresh rc=1 duration_ms=3073009`. |
| 09:09:52–09:10:31 | Catalog restart during couch restore (new PID 127445). Listening 09:10:17. Startup rec jobs `cdf0e8f3…` (movie) and `728d0641…` (series) queued `trigger_reasons=["service_startup"]`. |
| 09:11:21 | Assess against refresh JSON: `unique library: 10273 titles (+40 this run, was 10233)`. `Target: 6/12 rails met grow target (50%) — FAIL (all-rails target SLA · below 80% warn line)`. Six shortfalls listed (see refresh JSON). |
| 09:11:22 | `playability maintenance: waiting for VOD recommendation jobs 581cfa36-5e37-4538-8153-e4340c875af7,46d2e374-13c9-4eba-b546-39fe2324c665`. Those jobs queued at 16:11:22Z with `trigger_reasons=["playability_corpus_publication"]`, `started_at=null`. |
| 09:25:57 | Catalog (PID 127445): movies last-good + retry + ranking deadline. |
| 09:26:03 | `curl: (28) Operation timed out after 5002 milliseconds with 0 bytes received`. Then `VOD recommendation exact job read failed for 581cfa36-5e37-4538-8153-e4340c875af7; last-good remains active`. Then `nightly library refresh: playability_rc=10`. |
| 09:26:07 | Browse session reshuffled. |
| 09:26:12–16 | YouTube refresh: catalog not healthy; catalog started; catalog ready. |
| 09:26:20–09:27:25 | YouTube job `e550ec70-6cbb-4e8b-97a3-1faba2fc1831` `complete`; all listed v2 phases `ok`; quota_used_today=156. |
| 09:27:27 | `nightly library refresh: complete playability_rc=10 youtube_rc=0`. WAL checkpoint of library/progress/youtube/playability succeeded. |
| 09:27:28–09:28:11 | library.db VACUUM (`freelist was 38835`). |
| 09:27:52 | Catalog PID 127445: uncaught `SqliteError: database is locked` (`code: SQLITE_BUSY`) in `updateRecommendationRefreshJobRuntime` from a `Timeout._onTimeout` in `story-graph-service.js`. Process exit 1. systemd `Failed with result 'exit-code'`. Peak 1.2G, CPU 20min 13s. |
| 09:27:58 | Catalog scheduled restart (counter 1). New PID 144160. |
| 09:28:11 | `reliability proof: catalog-service unavailable at http://127.0.0.1:3020`. `proof_rc=1`. `partial — validated playability output retained with last-good downstream output`. Indexer unit finished. Consumed 14min 27s CPU, 2.4G peak. |
| 09:28:12–14 | Catalog startup recs: last-good movies **and** series retained, retry then final: `recommendation maintenance already active: vod:series`. Jobs `c2d1ac82…` (movie) and `d14c6d38…` (series) `failed` with that error. Prior playability and restore startup jobs marked `coalesced` / superseded pointing at those successors. Listening `:3020`. Addons=8 including AIOStreams and AIOMetadata. |
| 09:44 | Couch stack up. Reliability yellow. Live verified count 10233. YouTube cached videos 17614. No failed user units. Load 0.43. |

During grow, operator snapshots of `python3 scripts/diag/grow_monitor.py status --verbose` showed a **staged work DB** (not live) accumulating probe verifies, then after discard the same tool read **live DB** with unique 10233 (+0 vs baseline). Mid-run monitor `tgt` column was **20**; refresh JSON `grow_target` per rail is **4**.

## Refresh JSON (verbatim fields)

Path: `~/.cache/mango/ops/refresh-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.json` (815074 bytes).

```json
{
  "ok": true,
  "mode": "grow",
  "bootstrap": false,
  "strict_grow_sla": false,
  "stage": "publish",
  "failure_category": null,
  "error": null,
  "verified": 38,
  "failed": 39,
  "unique_candidates": 475,
  "unique_verified_delta": 40,
  "unique_verified_after": 10273,
  "stop_reason": null,
  "maintenance_rc": 1,
  "grow_target_met": false,
  "grow_target_required": false,
  "grow_target_warning": true,
  "all_rails_publishable": true,
  "best_effort_publish": true,
  "linked_existing": 0,
  "started_at": 1787325509597,
  "finished_at": 1787328519569,
  "duration_ms": 3009972,
  "run_id": "playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2"
}
```

`grow_target_short_rails`: `series-reality-casual`, `series-india-picks`, `movies-quick-watches`, `movies-documentaries`, `series-classics`, `movies-comedy`.

| rail_id | ok | grow_target | fresh_verified | probe_verified | new_to_rail_verified | verified | failed | exhausted | failure_category |
|---------|----|-------------|----------------|----------------|----------------------|----------|--------|-----------|------------------|
| series-reality-casual | false | 4 | 3 | 3 | 3 | 3 | 3 | true | theme_rejected |
| series-india-picks | false | 4 | 1 | 1 | 1 | 0 | 2 | true | same_theme_fallback_exhausted |
| series-miniseries | true | 4 | 5 | 5 | 5 | 5 | 0 | false | |
| movies-quick-watches | false | 4 | 2 | 2 | 2 | 2 | 0 | true | theme_rejected |
| series-comedy | true | 4 | 6 | 6 | 6 | 5 | 0 | false | |
| movies-documentaries | false | 4 | 0 | 0 | 0 | 0 | 0 | true | source_exhausted |
| series-classics | false | 4 | 3 | 3 | 3 | 3 | 2 | true | same_theme_fallback_exhausted |
| movies-india-trending | true | 4 | 4 | 4 | 4 | 4 | 24 | false | |
| series-global-popular | true | 4 | 4 | 4 | 4 | 4 | 7 | false | |
| movies-comedy | false | 4 | 1 | 1 | 1 | 1 | 0 | true | theme_rejected |
| movies-classics | true | 4 | 6 | 6 | 6 | 6 | 0 | false | |
| movies-global-popular | true | 4 | 5 | 5 | 5 | 5 | 1 | false | |

Repair-suggestion strings in the same JSON (abbreviated): review theme/source membership for the six short rails; `Grow completed below target for 6 rail(s); publishable verified work was kept, but source yield should be reviewed for those rails.`

Live DB after discard: unique verified **10233** (baseline), not 10273.

## Stale-phase JSON (08:17:39)

```json
{
  "ok": false,
  "mode": "stale",
  "bootstrap": false,
  "strict_grow_sla": true,
  "stage": "core_boot",
  "failure_category": "catalog_boot_failed",
  "error": "manifest boot failed for AIOStreams: fetch failed",
  "verified": 0,
  "failed": 0,
  "rails": []
}
```

Hooks JSON at 08:17:34 also `ok: false`, `stage: maintenance_hooks`, same AIOStreams fetch error. Operator continued (`hooks will retry next run`).

## Recommendation jobs (library.db)

Table `recommendation_refresh_jobs`. Epochs are Unix ms.

| job_id | domain | type | status | trigger | queued_at_iso (UTC) | started | completed_at_iso (UTC) | error | successor |
|--------|--------|------|--------|---------|---------------------|---------|------------------------|-------|-----------|
| `5ec94d09-822d-45b4-8406-9cd9c11e890b` | vod | movie | failed | service_startup | 2026-08-21 04:01:32 | yes | 04:55:32 | story graph ranking exceeded its background deadline | |
| `a345df93-49b7-431e-ab3d-5c640c2bb06c` | vod | series | complete | service_startup | 2026-08-21 04:01:32 | yes | 04:23:53 | | |
| `8a3490e2-c4cc-48d1-818c-ec1c28e1eda0` | vod | movie | failed | service_startup | 2026-08-21 15:17:32 | yes | 16:05:06 | story graph ranking exceeded its background deadline | |
| `cdf0e8f3-6193-4e8d-a76b-031a5c86febb` | vod | movie | coalesced | service_startup | 2026-08-21 16:09:53 | null | 16:28:12 | superseded by a newly captured refresh job | `c2d1ac82…` |
| `728d0641-cea3-4053-892a-015a379f2ac4` | vod | series | coalesced | service_startup | 2026-08-21 16:09:53 | null | 16:28:12 | superseded… | `d14c6d38…` |
| `581cfa36-5e37-4538-8153-e4340c875af7` | vod | movie | coalesced | playability_corpus_publication | 2026-08-21 16:11:22 | **null** | 16:28:12 | superseded… | `c2d1ac82…` |
| `46d2e374-13c9-4eba-b546-39fe2324c665` | vod | series | coalesced | playability_corpus_publication | 2026-08-21 16:11:22 | **null** | 16:28:12 | superseded… | `d14c6d38…` |
| `e550ec70-6cbb-4e8b-97a3-1faba2fc1831` | youtube | | complete | nightly_after_playability_nightly | 2026-08-21 16:26:20 | yes | 16:27:25 | | |
| `c2d1ac82-2a90-4b38-ae0c-48266946a460` | vod | movie | failed | service_startup | 2026-08-21 16:28:12 | yes | 16:28:14 | recommendation maintenance already active: vod:series | |
| `d14c6d38-bb6d-4a00-83fc-bdcf6ff11af5` | vod | series | failed | service_startup | 2026-08-21 16:28:12 | yes | 16:28:14 | recommendation maintenance already active: vod:series | |

Playability-queued jobs never recorded `started_at`. Waiter used `curl -fsS -m 5` against `GET http://127.0.0.1:3020/recommendations/jobs/<id>` in a 1s loop with default wait budget 900s (`MANGO_VOD_RECOMMENDATION_REFRESH_TIMEOUT_SEC`). Observed waiter failure was curl 5.002s timeout, not the 900s deadline.

Movies ranking deadline also occurred on the **previous** boot job at 04:01–04:55 UTC-7 same calendar day. Series completed in ~22 minutes at 04:23.

## Catalog crash (09:27:52)

Uncaught exception from catalog-service (transpiled paths):

```
SqliteError: database is locked
    at …/recommendations/jobs.js updateRecommendationRefreshJobRuntime
    at Timeout._onTimeout (…/recommendations/story-graph-service.js)
code: 'SQLITE_BUSY'
Node.js v20.19.2
```

Library SQLite connections apply `busy_timeout = 5000` (`src/catalog-service/src/sqlite-hot.ts`). VACUUM of `/etc/mango/library.db` ran in the indexer process overlapping this window.

## Other observed anomalies in the same window

These are recorded because they co-occurred. They may or may not share a cause.

1. **Partial addon graph at first catalog listen.** Despite `run-catalog-service.sh` waiting up to 90s for localhost manifests, AIOStreams/AIOMetadata fetch failed and catalog served 6 addons / `aiostreams:0` until later restart. Docker containers had already been up for hours; HTTP 200 to those manifests was observed ~08:19 from the Pi.
2. **Launcher Chromium stopped at maintenance start** and stayed down until restore. Reliability marked stack **red** (`launcher, browser`). UI server remained active. Watchdog ticks during maintenance exited 0 without repairing UI (`playability_maintenance_active` skip in `scripts/mango-health-repair.sh`).
3. **Health vs library counts.** Reliability `library` summary said “10256 verified titles across 12 rails” while `titles.status='verified'` was 10233. `rail_pool` was 12227. Grow monitor grow-rail slots were 10256.
4. **Grow monitor `tgt=20` vs nightly JSON `grow_target=4`.** Same run, two numbers.
5. **Reliability `maintenance` still yellow at 09:44** after the indexer unit was `inactive/dead` and the playability lock was free (`flock -n` succeeded). Latest persisted proof JSONL row is still `2026-08-20T23:17:11.518Z` / `gate_m6_reliability` / yellow — the 09:28 proof attempt recorded `catalog-service unavailable` and `proof_rc=1`.
6. **`jq` is not installed** on the Pi. Operator scripts using `jq` fail; Python JSON parsing works.
7. **`mango-stack.sh status` still printed `indexer: running` after the unit was dead.** No matching coordinator/maintenance PIDs were found shortly after.
8. **Rail growth yellow (pre-existing, restated at 09:44):** `series-reality-casual` missed 27 nights, `series-india-picks` missed 23 nights.
9. **Catalog RSS** ~216MB just after 08:17 listen; ~940MB during grow; ~1.2G peak before crash; ~675MB at 09:44.
10. **Live rails** rebuilt after boot (cache age 33ks stale then refreshed). Live ready stayed true via stale fallback.
11. **Controller** off / connecting / `br-connection-create-socket` at times. Router process alive. Not treated as this incident’s primary subject.
12. **Pi SHA `90d9758` vs later Mac docs commits** on the same branch. Functional grow/recs code under investigation is the Pi SHA. Do not assume Mac HEAD runtime without checking.
13. Historical observation from 2026-08-06 (different SHA): a nightly published grow, then the coordinator failed on an **exact VOD recommendation job read**; last-good recs were retained. Similar waiter symptom.

## Source surfaces to read (inventory, not a theory)

Playability nightly / publish:

- `scripts/m3-play/playability/playability-maintenance.sh` (stale+grow sequencing, `REFRESH_RC`, `publish_or_discard_staged_db`, rec wait loop, `curl -m 5`)
- `scripts/m3-play/playability/nightly-library-refresh.sh` (`playability_rc`, YouTube, vacuum, proof)
- `scripts/m3-play/playability/playability-indexer.ts`
- `scripts/m3-play/playability/playability-coordinator.sh`
- `scripts/m3-play/playability/sqlite-publication.py`
- `scripts/diag/merge_failed_grow_memory.py`
- `scripts/diag/extract_refresh_json.py`
- `scripts/diag/grow_monitor.py`
- `scripts/m3-play/playability/LIBRARY-GROWER-OPS.md`

Catalog boot / addons:

- `scripts/m2-catalog/service/run-catalog-service.sh` (90s localhost manifest wait)
- `src/catalog-service/src/core.ts` (`manifestLoadError`, `isPlayabilityVodCriticalAddon`, playability vs couch boot)

Recommendations:

- `src/catalog-service/src/recommendations/jobs.ts`
- `src/catalog-service/src/recommendations/maintenance.ts` (lease, 15-minute deadline, `already active`)
- `src/catalog-service/src/recommendations/story-graph-service.ts` (lease owner `vod:${tab}`, heartbeat `setInterval` 10s, `updateRecommendationRefreshJobRuntime`)
- `src/catalog-service/src/recommendations/story-graph-rank-worker-client.ts` (`MANGO_STORY_GRAPH_RANK_TIMEOUT_MS` default 15 minutes)
- `src/catalog-service/src/recommendations/background-refresh.ts`
- `src/catalog-service/src/index.ts` (`POST /recommendations/refresh`, `GET /recommendations/jobs/:id`)
- `src/catalog-service/src/sqlite-hot.ts` (`busy_timeout = 5000`)

Ops / reliability:

- `scripts/mango-health-repair.sh`
- `scripts/mango-stack.sh`
- `scripts/m6-ship/reliability-proof.sh`
- `docs/features/content-and-playback.md`, `docs/OPERATIONS.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`

Existing tests that likely constrain patches: `src/catalog-service/src/recommendations/jobs.test.ts`, `maintenance.test.ts`, playability maintenance/publication tests under `scripts/m3-play/playability/`, `src/catalog-service/src/playability/`.

## Pi artifacts (do not fetch; already captured)

| Artifact | Role |
|----------|------|
| `/home/aman/.cache/mango/ops/refresh-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.json` | Grow receipt |
| `/home/aman/.cache/mango/ops/maintenance-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.log` | Maintenance transcript |
| `/home/aman/.cache/mango/playability-grow.log` | Stage/publish/discard lines |
| `/home/aman/.cache/mango/nightly-library-refresh.log` | Coordinator transcript |
| `/etc/mango/library.db` `recommendation_refresh_jobs` | Job rows above |
| `/etc/mango/playability.db` | Live corpus after discard |
| `journalctl --user-unit=mango-playability-indexer.service` / `mango-catalog.service` | Timeline |
| `/etc/mango/reliability/proofs.jsonl` last row | Still 2026-08-20 23:17Z yellow |

Work DB path was deleted as part of discard: `/home/aman/.cache/mango/playability-work-playability-d159c2df-6cf8-40a3-94d4-03b91d5db9a2.db`.

## Required output

After independent diagnosis against source + this evidence:

1. Characterize each distinct failure class you can defend. Separate grow publication, rec job lifecycle, catalog liveness, and incidental observations.
2. State what is proven, what is inferred, and what still needs Pi runtime.
3. Patch in principled order with tests. Do not paper over last-good retention or invent Pi-only manual steps as the product fix.
4. Do not SSH. Do not deploy. Do not run grow/rec refresh against the live Pi.
5. Summarize remaining risk: discarded +40 unique titles are gone from live; failure-memory merge did land (`failed_titles=72`). Couch was serving last-good VOD recs and a complete YouTube refresh after the unit exited.
