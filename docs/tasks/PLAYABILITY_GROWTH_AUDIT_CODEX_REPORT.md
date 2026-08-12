# Mango title verification and library growth audit

| Field | Value |
|---|---|
| Audit date | 2026-08-06 |
| Audited branch | `feat/native-experience` |
| Audited source revision | `4a17519723c4fd3c2de3d19a6e52e80b22437b23` |
| Authoring baseline | `b7fdaeb587fcb53a5f53004c9d8f70437d61a204` |
| Scope | S1-S8 of `PLAYABILITY_GROWTH_AUDIT_CODEX_SPEC.md` |
| Disposition | Evidence-only audit; no fix, commit, push, deploy, provider probe, refresh, or intentional content-changing runtime action was performed. One contract-listed diagnostic, `source-grow-audit.py --json`, used a default read/write-capable SQLite connection for SELECTs, so a strict connection-level no-mutation guarantee is unavailable; see sections 9.3 and 14.3. |

## 1. Executive verdict

**Verdict: Mango's staged publication design is directionally sound, but the system is not yet robust enough to call its stored rows title-verified, and its current growth loop is neither bounded by the advertised rail controls nor measured well enough to optimize safely. Confidence: high for source and local-test conclusions; high for the timestamped Pi aggregates; medium for causal explanations that need a controlled replay; no confidence claim for couch behavior.**

The five facts that dominate the verdict are:

1. **Three independent P0 correctness paths can create false playability proof, one under an explicit overlap precondition.** The grow path drops candidate title/year identity before verification; two overlapping callers/processes can round-robin onto the same unleased mpv worker socket and replace each other's playback; and an exact-series fallback/obligation win can be persisted as globally `verified` even when the main ladder never won. One `processVerifyQueue` caps itself to the worker count, so it cannot alone trigger the mpv collision. These are executable-source conclusions, not observed wrong-title examples.
2. **Current physical growth is not equivalent to useful title growth.** At the 2026-08-06T22:59:42Z point sample, the Pi had 10,017 physical `verified` rows but 9,904 logical canonical keys. The current 113-row difference was entirely episode-shaped series records, and all 113 were verified titles with no rail membership. It does not establish the historical cause of an older count, but it is consistent with the source-proven non-main exact-episode persistence path.
3. **The latest assessed grow published on an older revision, but its coordinator failed afterward.** The Aug 6 refresh window ended at 06:03:32 PDT; the existing log records `stage DB: published completed grow` at 06:03:35 PDT, and systemd records the oneshot ending failed at 06:06:39 PDT after an exact VOD recommendation-job read error. The immediate 06:06:37 proof binds the run to `3ffda16`; audited commit `4a17519` did not exist until 15:12:46 PDT. The older-revision refresh added 155 physical verified rows over 4,315,233 ms (71.92 minutes; derived 2.16/minute) and met `+20` on only 6/12 rails. Last-good recommendations remained active, YouTube and reliability proof completed. “Publish succeeded” and “nightly succeeded” are therefore different facts.
4. **Source allocation and pool controls materially diverge from configuration.** The loaded Pi YAML was byte-for-byte equal to checked-in `config/catalog.example.yaml` (SHA-256 `1ae9059f...e2623`), but 132/188 source references fall into the allocator's `<=0.08` probation class at neutral learned weight and 99/188 cannot leave it even at the `2.0x` ceiling. All 12 live curated pools also exceeded configured `pool_max: 120`; the current excess ranged from 293 to 1,583 memberships because grow mode does not enforce `pool_max`, `pool_growth_per_refresh`, or rail `ingest_multiplier`.
5. **Evidence is yellow and revision-incomplete, not release proof.** The Pi was on the audited SHA, healthy enough to serve, and the local suite passed 920/920 plus 51/51 diagnostics and the full N3c gate. The newest persisted Pi proof was yellow, sampled 32 served titles with 4 broken, and was from an older SHA. No exact-SHA persisted gate proof or controller/target-TV couch proof exists.

**Decision:** do not increase provider budgets, weaken themes, or tune source weights yet. First make a proof belong exclusively to one requested identity and one mpv worker, make only a main-ladder win durable, and establish a truthful stage-aligned run ledger. Those changes protect correctness and make later growth optimization measurable.

## 2. Audit identity and evidence ledger

### 2.1 Identity and boundaries

| Boundary | Observed fact | Evidence / limitation |
|---|---|---|
| Mac source | Branch was `feat/native-experience`; no branch switch occurred. HEAD was `4a175197...`; the already-available `origin/feat/native-experience` ref matched. | Captured before investigative commands. Remote refs were not refreshed because this audit forbade refresh. |
| Revision relationship | HEAD is one commit after baseline `b7fdaeb...`. Commit `4a17519` changes Live rail source retention, not playability implementation. | `git log`, `git diff --name-status b7fdaeb..HEAD`. |
| Initial dirty state | Four pre-existing untracked task files: `OPS_HEALTH_CODEX_PROMPT.md`, `OPS_HEALTH_CODEX_SPEC.md`, `PLAYABILITY_GROWTH_AUDIT_CODEX_PROMPT.md`, and the audit spec. | Preserved. This report is the only auditor-created file. |
| Concurrent worktree activity | After the captured baseline, `docs/tasks/README.md` changed and two unrelated `MANGO_CODEBASE_HEALTH_CODEX_*` files appeared around 2026-08-06T23:06Z. | Not created, edited, or used by this audit; preserved as concurrent user/other-workflow state. |
| Local host | Darwin 25.6.0, arm64. | Local tests are Mac evidence only. |
| Pi access | Read-only smoke succeeded. At 2026-08-06T22:48Z the Pi branch and SHA matched the audit revision. | SSH alias path from `pi-exec.sh`; no auth work, pull, revision selection, or numeric IP. |
| Pi dirty state | Only operator-owned `config/companion.example/compiled-notes.md` and `config/companion.example/profile.yaml` were modified. | Files were neither opened nor changed. |
| Pi evidence window | Point-in-time aggregates captured 2026-08-06T22:48Z-23:00:54Z; bounded ops/proof evidence covered August 1-6. | systemd journal returned no entries for the requested 30-day window; the verify log itself retains about 14 days. |
| Couch / TV | Not observed. | Controller, target-TV, audible/visual playback, title identity, and sustained playback are **DEFERRED**. |

### 2.2 Evidence tiers

| Tier | Meaning in this report |
|---|---|
| SOURCE-COMPLETE | Executable source, config, tests, unit files, and canonical docs read at audit SHA. All 82 files under `src/catalog-service/src/playability/` were inspected (42 implementation, 40 test; 20,599 lines). |
| LOCAL-PASS | Command ran locally at the audit SHA and exited zero. It does not prove Linux/mpv/provider/Pi/couch behavior. |
| PI-LIVE | Read-only point-in-time state observed from the Pi at the audit SHA. It is not a persisted gate or couch proof. |
| PI-HISTORICAL | Existing ops report, cache, log, or reliability proof. It is bound to its own timestamp and recorded commit, which may differ from the audit SHA. |
| DERIVED | Arithmetic over explicitly named values that share the stated window. |
| DEFERRED / UNAVAILABLE | Required evidence was not safely obtainable. No conclusion is substituted. |

### 2.3 Evidence ledger

| Claim | Source revision | Runtime revision | Timestamp | Artifact | Tier | Verdict | Limitation |
|---|---|---|---|---|---|---|---|
| Verification and growth source traced | `4a175197...` | n/a | audit | `src/catalog-service/src/playability/**`, scripts, config | SOURCE-COMPLETE | complete | Does not prove runtime manifestation. |
| Full catalog-service test suite | `4a175197...` | n/a | audit run | npm TAP output | LOCAL-PASS | 920/920 pass | Modeled dependencies; Mac, not Pi. |
| Required Python diagnostics | `4a175197...` | n/a | audit run | seven unittest invocations | LOCAL-PASS | 51/51 pass | Tests diagnostic code, not current truth. |
| N3c library-grow gate | `4a175197...` | n/a | audit run | `gate-m3-library-grow.sh` | LOCAL-PASS | pass | Reran 920 tests and diagnostic assertions; no provider/Pi play. |
| Current Pi source identity | `4a175197...` | `4a175197...` | 2026-08-06T22:48Z | branch/SHA/status readback | PI-LIVE | exact match | No persisted proof at this SHA. |
| Timer scheduling | same | same | 2026-08-06T22:48Z | `systemctl list-timers/show/cat`; `systemctl --version` | PI-LIVE | timer active; 03:00; `Persistent=true`; systemd 257 (`257.13-1~deb13u1`) | Point-in-time only. |
| Latest service result | same | same | 2026-08-06T22:48Z | `systemctl show` | PI-LIVE | `failed`, exit status 1; no restart | Failure was after DB publication. |
| Current DB integrity/schema | same | same | 2026-08-06T22:54-23:00Z | URI `mode=ro`, `query_only=ON`, aggregate SQL | PI-LIVE | `quick_check=ok`, WAL, schema 17 | No checkpoint or write performed. |
| Current physical/logical corpus | same | same | 2026-08-06T22:59:42Z | aggregate SQL | PI-LIVE | 10,017 physical verified; 9,904 logical; 113 episode-shaped orphans | Logical key canonicalizes episode IDs to their show. |
| Latest completed grow payload | `3ffda166...` inferred from immediate proof | `3ffda166...` | payload ended 2026-08-06 06:03:32 PDT | `~/.cache/mango/ops/refresh-playability-20260806-030038.json`; proof line 79 | PI-HISTORICAL | grow payload `ok=true`, publish-eligible; +155 physical | The payload alone does not prove copy completion; `4a17519` was committed later; useful logical delta unavailable. |
| Latest physical publication | `3ffda166...` | `3ffda166...` | 2026-08-06 06:03:35 PDT | `~/.cache/mango/playability-grow.log:291972` | PI-HISTORICAL | `stage DB: published completed grow` | Existing log ordering proves the backup call returned; no structured receipt/post-copy integrity readback. |
| Immediate post-run proof | `3ffda166...` | `3ffda166...` | 2026-08-06T13:06:37.313Z | `/etc/mango/reliability/proofs.jsonl:79`, proof `70d482d8...` | PI-HISTORICAL | yellow; binds run-era runtime commit | `4a17519` was committed at 2026-08-06T15:12:46-07:00; this is not exact-audit-SHA proof. |
| Latest coordinator completion | `3ffda166...` | `3ffda166...` | 2026-08-06 06:06:39 PDT | `systemctl --user show ... ExecMainExitTimestamp,Result,ExecMainStatus`; immediate proof | PI-LIVE readback of historical unit result | failed, status 1 after exact VOD job read error | Journal history unavailable; log has no timestamp on every downstream line. |
| Latest persisted reliability proof | older proof commit `fb20baa...` | audit SHA serving later | 2026-08-06T21:12:43Z | `/etc/mango/reliability/proofs.jsonl` | PI-HISTORICAL | yellow; 4/32 broken; 5 starving rails | Not exact revision; `play_probe=false`. |
| Current Reliability state | audit SHA | audit SHA | 2026-08-06T22:52Z | GET `/reliability/state` | PI-LIVE | yellow; library/growth/proof yellow | Generated live state, not a persisted gate. |
| Couch identity/playback | audit SHA | audit SHA | n/a | human observation | DEFERRED | unavailable | Required exact-revision controller/TV proof absent. |

### 2.4 Reconciliation and material drift

| Topic | Recorded/canonical statement | Audit truth |
|---|---|---|
| Latest Pi SHA | `AGENTS.md` records contained Pi state at `3ef1b20`; `docs/STATUS.md:38,203` describes older `fb20baa`/unhealthy growth evidence. | Pi was at `4a175197...` during this audit. Old statements remain dated history. |
| Schema | `docs/STATUS.md:99-102` still calls migration/public schema 14; other dated tasks cite 13/15. | `src/catalog-service/src/playability/db.ts` migration registry and Pi `playability_migrations` both report schema 17. `PRAGMA user_version` is not the authority. |
| Corpus | `docs/STATUS.md:38` says Movies 5,930 and TV 3,974. | Movies physical/logical = 5,930. Series physical = 4,087; logical canonical = 3,974 because 113 episode-shaped records collapse to shows. Both numbers are valid only with their counting definition. |
| Browse candidates | `docs/STATUS.md:38` and `docs/PLAYABILITY.md:496` say 19,950. | Active reservoirs at 22:59Z held 19,951 payload rows (11,920 Movies + 8,031 Series), spanning 5,930 and 3,974 unique verified keys. Difference is +1, not silently normalized. |
| Runtime catalog | `config/catalog-rail-curation.md:5-7` makes checked-in YAML source truth; deployment copies it to `/etc`. | Loaded Pi YAML SHA-256 exactly matched checked-in YAML; 12 active composite VOD rails and 188 source references. Addon resolution can still drop unavailable sources at process load, and per-reference loaded-manifest state is deferred. |
| Default versus loaded controls | Executable defaults are `min_display=6`, `pool_target=60`, growth 10, no max, grow 20 (`src/catalog-service/src/rails.ts:69-81`). `config/catalog-rail-curation.md:18` says optional rails use `min_display=12`. | Every checked-in/loaded VOD rail instead has min 6, target 20, growth 15, max 120, grow 20 (`config/catalog.example.yaml:18-404`). Loaded YAML overrides defaults; prose 12 is stale. |
| Theme thresholds | `docs/PLAYABILITY.md:240-247` and `config/catalog-rail-curation.md:73-80` say India `min_fit=14`. | Checked-in and loaded profile uses 10 for both India rails (`config/rail-theme-profiles.yaml:15-18,42-45`); default is 8, anchors 3, classics 0. |
| Source weight owner | `config/catalog-rail-curation.md:9` says runtime weights are cache-only; `docs/PLAYABILITY.md:416-420` centers `~/.cache/mango/source-grow/latest.json`. | SQLite `source_grow_weights` and `source_grow_rail_outcomes` are authoritative after one-time legacy import (`src/catalog-service/src/playability/source-hitrate-weights.ts:423-509`). `scripts/diag/source-grow-audit.py:172-289` still reads legacy JSON multipliers. |
| Atomicity | `docs/STATUS.md:527-535` says grow publication is atomic and failed/aborted/crashed work retains the previous snapshot. | Online Backup transaction semantics are sound for handled incomplete copies, but pre-stage hooks mutate live; failed stages merge cursor/rejection/title/log memory; stale/manual/overnight paths can write live; no validated publication receipt/rollback generation exists; recommendation/YouTube/proof are outside publication. |
| Thin rail | Canonical prose uses display/growth language without one definition (`docs/PLAYABILITY.md:17,311-315`). | Three thresholds coexist: publish floor 6 from loaded YAML, Reliability display depth 9, and monitor `<50% of pool_target` (10 at target 20, plus age). |
| Backup wording | `docs/DEPLOY.md:238-242` describes fail-closed online backups; `docs/STATUS.md:103-107` describes a separate validated routine backup set. | Maintenance stage/publish also uses transactional Online Backup, but unlike the routine backup helper it omits validation/readback/retained generation and ignores checkpoint result before manual sidecar cleanup (`scripts/m3-play/playability/playability-maintenance.sh:186-231`). |
| Historical-run comparability | The Aug 6 03:00 run/proof was at `3ffda16`; audit/current Pi later reached `4a17519`. | `git diff 3ffda16..4a17519` includes playability DB/session/Browse and recommendation files, so run counters are historical evidence only. They may be compared with current point samples only when the report names the different revisions/windows; they do not validate audit-SHA behavior. |
| 4K/HDR/couch | Hardware and feature prose can be read as capability. | This audit obtained no TV-mode, HDR activation, decode, dropped-frame, or couch evidence. All remain deferred. |

## 3. End-to-end architecture and call graph

### 3.1 Production path

```text
systemd user timer (03:00, Persistent=true)
  -> mango-playability-indexer.service (oneshot, no service timeout)
  -> nightly-library-refresh.sh
       -> playability-maintenance.sh --mode nightly
            -> optional AIOMetadata catalog sync (operator-owned state; before idle/lock)
            -> couch-idle check -> maintenance flock -> stop launcher/catalog
            -> pre-stage LIVE hooks
                 expiry sweep / trigger drain / migrations / stream-evidence work
            -> SQLite online backup live -> work DB
            -> refresh --all --mode stale
            -> fixed phase cooldown
            -> second couch-idle check
            -> source hit-rate preflight (can probe providers in production; not run here)
            -> refresh --all --mode grow
                 rail config -> ListSource/CompositeListSource
                 -> candidate ingest / cursor write
                 -> external ID normalization
                 -> prepareVerifyTitle / resolver cache
                 -> verify ladder -> mpv probe pool
                 -> title + verify_log + rail_pool batch writes
                 -> theme link / orphan attach / overlap finalization
            -> parse refresh JSON
            -> publish work DB to live OR discard + merge selected negative memory
            -> gate (runtime currently sets skip=1)
            -> restore couch stack
            -> enqueue exact VOD recommendation refresh and wait for all job IDs
       -> best-effort session reshuffle POST
       -> independent YouTube refresh unless playability lock remains held
       -> best-effort WAL checkpoint
       -> stale-flock cleanup
       -> reliability proof
       -> oneshot success only if playability, YouTube, and proof all succeed
```

Executable anchors: `scripts/m3-play/playability/nightly-library-refresh.sh:1-151`, `playability-maintenance.sh:180-389,560-849`, `playability-indexer.ts`, `refresh.ts`, `grow-rail.ts`, `candidate-ingest.ts`, `pipeline.ts`, `verify.ts`, `resolver.ts`, `mpv-probe-pool.ts`, and `db.ts`.

### 3.2 Candidate-to-card and downstream consumers

```text
catalog row
  -> normalized candidate {type,id,title/year hints, source provenance}
  -> existing-title link OR new verify queue
  -> prepare requested identity
  -> resolve stream candidates through addon core/cache
  -> identity/risk ranking
  -> main ladder probes
       success -> titles.status=verified -> rail_pool membership
       confirmed miss -> failed/stale + rejection/log
       infrastructure unknown -> should defer, but cache classification can collapse
  -> rail theme gate / curated pool
  -> staged finalization and publish
  -> active Browse-v3 reservoirs / rail_session / API cards
  -> recommendation corpus pages and VOD recommendation jobs
```

Strict recommendation and count readers filter `titles.status='verified'`; couch pool reads intentionally include `verified` and `stale`. Browse-v3 filters status when building a generation, but its active reservoir and 45-minute deal cache do not re-check current status when serving (`db.ts:3019-3024,3806-3826`; `core.ts:2559-2599,2859-2868`).

### 3.3 Other entrypoints and bypasses

| Entry/path | Classification | Isolation / risk |
|---|---|---|
| 03:00 systemd timer | production | Staged grow, but live pre-hooks and post-publish handoffs remain outside stage. Installer removes the legacy 15:00 and 7x/day catch-up units. |
| `playability-indexer refresh --mode stale` | production phase/manual | Direct-live when invoked outside staged wrapper. |
| `refresh --mode grow/nightly` | wrapper production/manual | `MANGO_GROW_STAGE_DB=0` bypasses staging. `ALLOW_PARTIAL` changes exit behavior, not the internal publishability rule. |
| Incremental `top-up.ts` / scheduler | service background | Live writes; scheduler lifecycle has no focused test. |
| Search, voice, playback triggers | interactive production | Live title/trigger/session writes; Search episode trigger and canonical pool key diverge. |
| Manual curation/pins/retheme | operator/manual | Sequential live mutation; pins can synthesize absent/nonverified rows. |
| Overnight grow loop | manual/benchmark | Own lock and direct live DB; no staged publish, couch-idle, or maintenance-lock equivalence. |
| Old catch-up watcher / aliases | retired but potentially callable | Installer removes named timers; unobserved leftovers outside requested unit are not claimed absent. |
| Abort helper | emergency operator path | Broad process kill, work-DB/lock cleanup, and couch restart; not safe as an unattended recovery primitive. |

## 4. Data model and lifecycle state machines

### 4.1 Durable ownership map

| State | Owner / writer | Semantics, retention, invalidation |
|---|---|---|
| `titles` | playability DB (`db.ts`, batch writer, live hooks) | Global physical `(type,id)` status. `verified_at`, expiry, best source, first verification. Episode IDs and bare show IDs can coexist. Status is global, not rail-specific. |
| `rail_pool` | verification/link/finalization/curation | Membership and display metadata. No foreign key; reads include verified + stale for couch, strict consumers join verified. Failed rows are pruned; stale rows intentionally survive. |
| `rail_session`, `recently_shown` | session allocation and ordinary Home requests | Session rows retained 2 days; recent rows 14 days. A GET-like Home allocation can mutate them. |
| `rail_ingest_state`, `rail_source_ingest_state` | list-source/grow/top-up | Durable offsets. Grow writes offsets before durable verification. Deep rewinds from a failed work DB can be merged live. No automatic removal of retired per-source rows. |
| `rail_candidate_rejections` | ingest/theme/verification | Per rail/title reason and TTL; no size cap. Upsert replaces reason but keeps maximum old/new expiry, so a new reason can inherit an old quarantine. |
| `source_grow_weights`, `source_grow_rail_outcomes` | source adaptation | SQLite authority. Full read/merge/replace lacks compare-and-swap. Expiration uses report-global newest timestamp, so one fresh row can keep old rows active. Failed-stage merge omits these tables. |
| Legacy `source-grow/latest.json` | preflight and historical migration | One-time migration input if both SQLite tables are empty; retained afterward. Diagnostic incorrectly treats it as live multiplier truth. |
| `playability_triggers` | Search/voice/playback/display-low producers; trigger consumer | Priority queue without atomic claim/lease. Handled rows retained at least 7 days; unhandled retention is unbounded. Consumer marks handled even after transient throws. |
| `verify_log` | direct/batch verify writes, sweep | Append-only diagnostic rows pruned to about 14 days, not the requested 30. Outcome duration semantics differ by success/failure. |
| `stream_path_evidence` | playback/probe evidence | Base rows unbounded; issue overlay expires after 7 days. URI-RO Pi snapshot on `4a17519` at 2026-08-06T22:59:42Z: 142 rows, 4 known-risky, 138 proven-smooth, no active issue. |
| `recommendation_corpus_state` | SQLite triggers on every title/pool insert/update/delete | Generation increments even for a newly inserted `pending` title (`db.ts:1190-1260`). Pages filter verified, but the cursor is ID-only and each page reads the current generation. |
| Browse-v3 generation/active/previous tables | corpus build/promotion | Immutable ready generations plus active/previous pointer. Failed/building generations are cleaned only after a later success. `vod_browse_membership_v3` is legacy/DDL-only in current path. |
| Ops events/reports | shell `ops-write-run.py` | Existing JSONL/report artifacts; may contain bounded candidate audit/raw excerpts. Retention is file/operator-owned, not a DB invariant. |
| Reliability proofs | `reliability-proof.sh` and service | Append-only persisted proof ledger. Revision-bound but current live state can be generated without becoming a persisted proof. |
| Migration state | `playability_migrations` | Schema authority, current version 17. `PRAGMA user_version` is not used as product truth. |

Source anchors: `db.ts:700-780,1180-1305,1583-1705,1940-1990,2100-2155,2910-3140,3390-3590,4260-4450`; `batch-writer.ts`; `source-hitrate-weights.ts:395-512`; `merge_failed_grow_memory.py:12-181`.

### 4.2 Title lifecycle

```text
absent
  -> pending (candidate/Search/bootstrap insertion)
       -> verified [only a successful, identity-safe MAIN probe should allow this]
       -> failed [confirmed content miss / probe failure]
       -> stale [infrastructure-unknown or expired evidence]

verified
  -> stale       expiry sweep, repeated couch miss, play failure policy
  -> failed      confirmed reprobe failure / stronger demotion
  -> verified    successful reverify refreshes evidence

stale/play_miss
  -> verified    successful background main proof
  -> preserved   current code can preserve stale in DB but return synthetic
                 `verified` to the trigger caller: a state/result contradiction

failed
  -> pending/reverify after retry window or explicit trigger
  -> verified only after a new valid main proof
```

Expiry is sweep-driven. Reads that test only `status='verified'` can count or serve expired-but-unswept rows. At 2026-08-06T22:59:42Z, 282/10,017 physical verified rows were due (`2.82%`, derived); active Browse reservoirs contained those same 157 Movies + 125 Series due rows because they had not yet been demoted.

### 4.3 Rail/source/trigger/publication state

- **Rail:** candidate -> theme fit -> membership -> session -> visible card. A title can become globally verified before every theme link rejects it, leaving a verified orphan. Pins can bypass the normal pool query and synthesize membership.
- **Rejection:** active TTL blocks one rail; expired rows cease blocking but persist until cleanup. The reason/TTL upsert mismatch can over-quarantine.
- **Source:** YAML base weight -> preflight/global and rail outcome multipliers -> absolute final floor -> normal/probation allocation -> in-run circuit -> persisted cursor/outcome. “Probation” is not a durable exploration lease; its cursor is process memory.
- **Trigger:** unhandled -> selected -> work -> handled. There is no claimed/leased state. Two consumers can select the same row, and a crash between verify and handled write replays it.
- **Publication:** live snapshot -> work DB -> live pre-hooks + staged refresh -> publish if refresh rc=0 and parsed JSON `ok=true`; otherwise selected cursor/negative memory merges and work DB is discarded. Restore, VOD recommendation refresh, session reshuffle, YouTube, checkpoint, and proof occur later and can fail independently.

## 5. Correctness and invariant audit

### 5.1 Requested identity is not preserved end to end — P0

The intended identity tuple is `{requested type, canonical item ID, exact video ID for series, candidate title, year, edition/provenance}`. The executable path breaks that contract in four places:

1. Grow candidates retain title/year hints in the queue, but `prepareVerifyTitle` is called with only type and ID (`src/catalog-service/src/playability/pipeline.ts:395-404`); resolver preparation therefore passes `{}` as the identity hint (`src/catalog-service/src/playability/verify.ts:271-284`). With no hint, the verifier can check an explicit ID contradiction but cannot disprove a wrong-title stream whose metadata omits identity.
2. Candidate normalization accepts the sole exact-title search result despite contradictory year, does not enforce returned media type, and stops at the first addon match (`src/catalog-service/src/playability/candidate-normalize.ts:63-113`; `src/catalog-service/src/core.ts:3198-3238`). Mango begins with `tmdb:<id>` and needs TMDB-to-IMDb normalization, so TMDB's authoritative mapping is the movie or TV external-ID endpoint—not `/find`, whose direction is external ID to TMDB. Prefer the official [movie external IDs](https://developer.themoviedb.org/reference/movie-external-ids) / [TV external IDs](https://developer.themoviedb.org/reference/tv-series-external-ids) result; otherwise text-search fallback must require returned type plus a bounded year/title match, not “only result.”
3. `core.meta` merges pieces from addons without fencing every returned piece to the requested type/ID; a later piece can overwrite identity and union video lists. This is a source risk; no current addon contamination was observed.
4. The manual picker selects a URL from a raw fallback pool without re-running the identity/episode/supplemental eligibility predicate. A stale or crafted choice can bypass the verifier's ranking contract.

Stremio's protocol explicitly separates catalog/meta item ID from stream `videoID`, and notes that a series metadata object can contain many videos ([Stremio Addon Protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html), Stremio project, accessed 2026-08-06). Mango's bare-show and exact-episode identity must therefore remain separate through resolution and proof.

### 5.2 mpv probe ownership is not exclusive across callers/processes — conditional P0

The module-level `probeUrlViaPool` function selects workers round-robin but does not hold a busy lease (`src/catalog-service/src/playability/mpv-probe-pool.ts:67-104`). A single `processVerifyQueue` admits at most the configured worker count (`src/catalog-service/src/playability/pipeline.ts:329-341`), so one ordinary queue cannot create a fourth overlap. The unsafe interleaving requires two concurrent callers in one process or separate processes sharing the same fixed worker sockets—for example, detached per-rail background top-up processes if the off-by-default feature is enabled (`src/catalog-service/src/playability/top-up-scheduler.ts:18-44`), a top-up overlapping manual curation, or two operator CLIs. Current enablement/overlap was not observed. With configured concurrency 3, the exact conditional interleaving is:

1. A, B, C are assigned workers 0, 1, 2 and remain in flight.
2. D is admitted by a second caller/process before A completes; its process-local counter selects or wraps to worker 0.
3. D sends `loadfile ... replace` through the same socket and resets shared state/stop handling (`mpv-probe-ipc.sh:142-166`).
4. A can observe D's playback state or be stopped by D, producing a false success or false failure for either title.

The stable mpv manual says `loadfile ... replace` returns before the current file is stopped or the new file even begins loading ([mpv stable manual](https://mpv.io/manual/stable/), mpv project, accessed 2026-08-06). That makes command correlation and exclusive worker ownership mandatory. The missing cross-process lease is source-proven; the concurrency precondition and runtime manifestation are **not observed**.

### 5.3 Main ladder is not the only durable success — P0

The desired invariant is:

| Outcome | May serve this immediate request? | May write global `verified`? |
|---|---:|---:|
| Identity-safe main-ladder win | yes | yes |
| Last-resort / obligation-floor win | optionally, with explicit provenance | **no** |
| Manual picker choice | optionally | no, unless independently main-probed |
| Infrastructure unknown / cached error | no new proof | no |

The exact non-gate series reconciliation path violates this: any successful auto result can be persisted, without checking `win_on_main`. Thus a last-resort or obligation-floor exact-episode play can become global verified and recommendation-eligible (`src/catalog-service/src/episode-playability-reconcile.ts:33-80`, called by `src/catalog-service/src/index.ts:963-971`; tests cover ordinary success but not fallback provenance). The URI-RO Pi snapshot on `4a17519` at 2026-08-06T22:59:42Z is consistent but not causal proof: all 113 episode-shaped verified rows were orphans.

### 5.4 Resolver cache collapses infrastructure into content failure — P1

On the first 5xx/timeout, the structured result can remain stale/infrastructure-unknown. The negative cache later returns a generic `miss`; the next background attempt can interpret it as a clean no-stream confirmation and mark a title failed. Authentication semantics are also incomplete: 401/403 are not retained as distinct infrastructure/configuration causes. RFC 9110 defines 401 as missing/invalid credentials, 403 as understood but refused (and says not to repeat automatically with the same credentials), and 503 as likely temporary with optional `Retry-After` ([RFC 9110](https://datatracker.ietf.org/doc/html/rfc9110), IETF Internet Standard, June 2022). RFC 9110 standardizes HTTP semantics, not Mango's internal taxonomy; Mango nevertheless fails to preserve the distinctions needed for correct retry and cache policy when it flattens these causes into reusable `miss`.

Required states are `content_absent_confirmed`, `auth_invalid`, `forbidden`, `rate_limited(retry_at)`, `upstream_5xx`, `timeout`, and `transport_error`, with cause-preserving cache entries. Provider/system errors must not train source content yield.

### 5.5 Bare series and exact episodes diverge — P1

- Direct exact-episode verification can mirror S1E1 to a bare show, but bare grow ordinarily verifies only the bare key.
- Search queues a bare canonical title/pool row but emits a trigger for the raw episode-shaped ID, so the trigger can verify a record that remains invisible while the canonical row stays pending.
- The couch path maps a bare show to S1E1, while exact verify profiles can miss that mapping.
- `demoteVerifyIfDrifted` has no caller, so stored identity drift has no active correction path.

This asymmetry is a likely contributor to count inflation and orphaned episode records. It does not establish that all current orphans were created by Search or fallback.

### 5.6 Status, expiry, Browse, and session invariants — P1

- Verified reads often do not fence `expires_at`; 282 current rows were due but still verified.
- Browse-v3 checks status only during reservoir build. Serving the active payload does not rejoin current titles, and the generic 45-minute cache can return before stored-deal validation (`db.ts:3019-3024,3806-3826,4022-4035`; `core.ts:2559-2599,2859-2868`). Current reservoirs had no failed/stale keys at capture, but current `rail_session` history already contained 1 failed and 21 stale rows. Stale can be intentional couch policy; failed is not.
- A newly inserted `pending` movie/series increments recommendation generation before verification (`db.ts:1190-1260`). The corpus query filters verified, so this causes churn/snapshot instability rather than direct pending inclusion.
- Recommendation cursors contain only last ID and a pending insert advances generation before verified inclusion. The page scanner correctly rejects a generation change or final row-count drift (`src/catalog-service/src/recommendations/story-graph-service.ts:607-634`), so mutation cannot silently mix generations. The residual risk is fail-closed abort/churn/retry load without a measured coordinator recovery contract (`src/catalog-service/src/playability/db.ts:1190-1260,3474-3582`).
- A confirmed reprobe failure can preserve `stale/play_miss` in the DB but return synthetic `verified`; the trigger consumer promotes solely from that returned status (`verify.ts:182-190,343-355,418-437`; `trigger-consumer.ts:87-105`).

### 5.7 Ordering and concurrency risks

| Risk | Exact ordering | Classification |
|---|---|---|
| Trigger double work/loss | Two consumers select unhandled row; both probe. A throw is still followed by handled write. Crash after probe before handled causes replay. | P1 source-proven; runtime frequency unavailable. |
| Cursor ahead of evidence | Grow/top-up/legacy refresh persists fetched offset, then verification crashes before a durable outcome. Candidate is skipped until wrap/reset. | P1 source-proven (`grow-rail.ts:647-665`; `top-up.ts:180-193`; `refresh.ts:668-683`). |
| Bootstrap early return | Pipeline declares enough work and returns without joining/cancelling active promises; caller flushes/stops pool while tasks can still write or reject. | P1 source-proven; no focused test. |
| Batch chronology | Default batch writer writes verification using flush time and omits `first_verified_at`; later init may backfill from log, but same-process chronology and first-time couch messaging can be wrong. Errors are awaited and propagate; they are not swallowed (`batch-writer.ts:39-177`; `pipeline.ts:619-634`; `grow-rail.ts:830-870`). | P1 source-proven chronology/parity gap; error propagation is sound. |
| Top-up hint leak | Process hints are applied before already-full return and cleared only at normal tail; early return/throw leaks context. | P1 source-proven (`top-up.ts:146-174,225-239`). |
| Theme orphan | Global verified write occurs before rail theme link; all links reject, leaving a verified orphan. | P2 source-proven (`pipeline.ts:251-283`). |
| Curation partial state | Blocks, pins, relocations, removals, and session clear are sequential live writes. Crash yields a partial configuration. | P2 source-proven. |

### 5.8 Additional false-positive/false-negative mechanisms

- Filtered catalog rows control cursor advancement and exhaustion; a full upstream page with one blocked/malformed row appears short and can hide later pages (`list-source.ts:288-315,629-640`).
- Zero-source composite returns no candidates but not exhausted, so grow can wall-spin; `skipped_no_sources` is unreachable.
- Duplicates consume `freshQueued` before deduplication, shrinking the unique queue.
- Stale/infrastructure probe results do not consume the `max_attempts` budget; wall/attempt checks occur between batches, not each provider/probe action.
- `MANGO_GROW_LINK_MAX` caps the explicit link prepass but becomes a Boolean for discovered candidates, allowing unbounded existing links.
- Known-risky stream paths sort last but remain eligible when all alternatives fail; active stream evidence does not block verification.
- Direct couch evidence is written non-atomically, so response and persisted state can disagree after partial failure.
- A zero playback duration can pass after brief state transition; couch pool and direct probe use unequal minimum-duration accounting.
- Verify duration records winning TTFF on success but summed attempts on failure, so outcome latency distributions are not comparable.
- IMDb canonicalization preserves case, allowing duplicate logical IDs.
- Failure reason retains only the last ladder error, obscuring earlier causes.

## 6. Efficiency scorecard and funnel

### 6.1 One consistent funnel

Existing names do not form a clean funnel. The contract below is the minimum comparable sequence; “missing” means the current system cannot compute the stage for one run without raw-title reconstruction.

| Stage | Current counter / source | Audit interpretation |
|---|---|---|
| Source requested | `source_stats[].requested` | Planned candidate slots, **not** HTTP/provider request count. |
| Rows returned | `source_stats[].returned` | Post-slice, post-block, post-missing-ID `CandidateMeta` rows; raw addon `metas` unavailable (`list-source.ts:251-315,613-641`). |
| Scanned | `candidates_seen`, `ingest_scanned`, source `scanned` | Incremented only after already-verified and recent-failed skips; not all returned rows (`candidate-ingest.ts:166-196`). |
| Duplicate | `duplicate_candidates` | Dedupe after `fresh_queued` increments; per ingest call, not run-global. A duplicate can satisfy the per-ingest `freshTarget` early; it does not directly satisfy the rail's +20 verified target. |
| Already verified | `skipped_verified`, `linked_verified_seen` | Both increment for the same ingest observation; aliases, not additive. Later link outcomes are different. |
| Recent failure | `skipped_recent_failed` | Some counted outside scanned; rail/source totals can differ. |
| Active rejection | `skipped_rejected`; current rejection DB | Run counter is post-ingest; DB is a current TTL snapshot, not run history. |
| Unresolved external ID | `skipped_unresolved_external_id` | Already counted scanned/fresh before filter. |
| Theme rejected | same-run `source_stats[].theme_rejected` | No exhaustive top-level counter. `candidate_audit` is bounded and privacy-sensitive. |
| Resolve attempted | missing | Final `verify_queue_size` is hardcoded zero; heartbeat is rolling, not cumulative. |
| No stream / error | `verify_log`, source `failed`, rejection DB | Different populations: source `failed` also sees infrastructure-stale actions; rejection DB is active TTL. |
| Candidate probed | missing | One title can probe several ladder streams; per-attempt details do not reach refresh result. |
| Main-ladder verified | `processed.verified`, `verify_log=verified` | `processed.verified` also requires at least one post-verify rail link; all-theme-rejected verified orphans are omitted. It does not currently prove main-only provenance. |
| New rail membership | `new_to_rail_verified`, `fresh_verified`, `probe_verified`, deprecated `verified_added` | Four aliases for `max(0, after_verified_pool - before_verified_pool - linked)`, not independent observations (`grow-rail.ts:295-303,880-884,949-978`). |
| Pool growth | `max(0, after-before)` | Negative shrinkage is hidden; snapshot is before global finalization. |
| Net unique verified | `unique_verified_after-before` | Physical `(type,id)` rows, not logical canonical titles (`db.ts:1931-1940`). |
| Finalization kept | `retheme_finalization.*` | Global membership totals only; no new-cohort intersection. Per-rail `after` remains pre-finalization. |
| Staged publish | shell log only | Refresh `ok` means publish-eligible. Ops artifact is written before online backup; no durable publish receipt. |
| Visible / consumer eligible | later DB/API/couch | No run-cohort-to-visible receipt. Pool depth includes stale; couch observation is deferred. |

Additional schema defects: `pool_target` is overwritten with incremental `growTarget`; `candidate_limit` means `maxAttempts`; `unique_candidates` sums non-distinct rail `candidates_seen`; `verify_queue_size`, `batch_flush`, and `pruned_pool_entries` are hardcoded zero; and top-level `ingest_fresh_queued` sums only each rail's final ingest batch (`grow-rail.ts:220-247,667-674,949-998`; `refresh.ts:522-554`). The published `wasted_candidate_ratio` has no valid probability denominator and can exceed 1.

### 6.2 Current efficiency scorecard

Window for run metrics: the existing Aug 6 refresh payload, `2026-08-06T11:51:36.897Z` to `13:03:32.130Z`, produced on runtime `3ffda166...`; same historical run/payload unless stated. Audited/current SHA `4a17519` is a later source/runtime point and is not credited with these outcomes. “Physical” is deliberate.

| Measure | Status | Value / formula | What it proves and does not prove |
|---|---|---|---|
| Grow wall time | MEASURED | 4,315,233 ms = 71.92055 min | Work-DB refresh duration. Does not include all coordinator handoff time. |
| Physical net verified growth | MEASURED | 10,017 - 9,862 = **155** | Physical row delta, not logical useful-title delta. |
| Physical growth/min | DERIVED | 155 / 71.92055 = **2.16/min** | Same window; identity/fallback inflation remains. |
| Physical growth/100 scanned | DERIVED | 100 x 155 / 1,300 = **11.92** | `scanned` is post-skip and not raw returned. |
| Physical growth/100 final-batch fresh queued | DERIVED, WEAK | 100 x 155 / 601 = **25.79** | Numerator all rails; denominator is only each rail's last ingest batch aggregation. Not a funnel conversion. |
| Processed-action verified share | DERIVED, WEAK | 100 x 155 / (155 + 235) = **39.74%** | Uses 390 refresh `verified` + `failed` action fields. It does not reconcile to the 526 `verify_log` rows in the same timestamp window; the 136-row population difference is unattributed. Not a terminal success or probe pass rate. |
| Rails meeting +20 target | MEASURED | 6/12 = **50%** | Publish remained best-effort; strict target was off. |
| Publish eligibility | MEASURED | all rails publishable; refresh `ok=true` | Minimum/finalization gates passed. |
| Physical publication | MEASURED from ordering/log | refresh artifact ended 06:03:32 PDT; `~/.cache/mango/playability-grow.log:291972` records publish complete at **06:03:35 PDT** | The synchronous backup call returned. No durable structured receipt or post-copy integrity readback. |
| Last exactly evidenced publish age at capture | DERIVED | 22:59:42Z audit-SHA point sample - 13:03:35Z older-revision log event = **9h 56m 7s** | Same calendar day but different runtime revisions; this is elapsed wall time only, and later unobserved publication cannot be excluded. |
| Coordinator outcome | MEASURED | systemd failed, exit 1 | Exact recommendation job read failed after publish; service was not restarted. |
| `verify_log` outcomes in Aug 6 payload timestamp window | MEASURED | 526 rows: verified 155 (**29.47%**), no-stream 231 (**43.92%**), timeout 70 (**13.31%**), probe-failed 66 (**12.55%**), status-clip 4 (**0.76%**) | URI-RO timestamp filter only. `verify_log` has no `run_id`; rows can repeat titles or come from another writer/stage in the window. This is not an exact run cohort or per-title terminal denominator. |
| Rate-limit/title-mismatch shares | UNAVAILABLE | `verify_log.outcome` has no such typed outcomes | Zero rows cannot be inferred; current taxonomy collapses or omits these causes. |
| Useful logical title delta | UNAVAILABLE | no run-cohort canonical set | Physical delta cannot be corrected from aggregates alone. |
| New cohort surviving finalization | UNAVAILABLE | no cohort intersection | Global orphan/overlap before/after is insufficient. |
| Raw provider/catalog requests | UNAVAILABLE | no counter | `requested` is slots, not requests. |
| Resolve attempts / mpv probes | UNAVAILABLE | no cumulative counter | Cannot compute verified per resolve/probe or provider cost. |
| Per-source useful yield | UNAVAILABLE | no raw-request/main-win/final-cohort denominator by source | Current decayed source rows and legacy audit cannot produce a same-window yield. |
| Attempt/wall-budget exhausted or unused | UNAVAILABLE | configured caps exist, but no run receipt records consumed expensive actions or unused wall by rail | `candidate_limit` is not a provider/probe budget and timeout rows do not prove the rail cap fired. |
| Source-weight movement/recovery | UNAVAILABLE | only post-run SQLite vector was captured; no revision-bound pre-vector/delta receipt | Current floor/probation class is measurable; movement caused by this run is not. |
| Per-rail wall/provider budget | UNAVAILABLE | no per-rail duration/request receipt | Source `elapsed_ms` assigns whole-rail time to every touched source and decays it. |
| Publish-to-visible / couch | UNAVAILABLE | no cohort receipt; couch deferred | Current API health is not cohort proof. |
| Expired-but-unswept verified | MEASURED, point-in-time | 282/10,017 = **2.82%** | Status freshness debt at 22:59Z, not Aug 6 run-only. |
| Physical/logical inflation | MEASURED, point-in-time | 113/10,017 = **1.13%** | All difference is episode-shaped; causality remains unproven. |
| 30-day success/fail/defer/restart/OOM/lock frequency | UNAVAILABLE | retained proof shows Aug 1-4 `playability_rc=0`, Aug 6 `playability_rc=1`; one date and the rest of 30 days are not classifiable; journal returned no rows | Current unit readback has `NRestarts=0` for the latest invocation only. Absence is not a zero-frequency measurement. |

The `grow_per_pass=20` objective is misaligned with the stated useful-growth objective. It targets **new memberships per rail**, permits the same title across rails, uses a physical global delta, and is independent of current pool depth. It can continue growing a 1,703-row pool even though config says `pool_max=120`, while accepting 0-6 additions on weak rails under best-effort publication. A defensible objective is: **identity-safe, main-ladder-proven, thematically accepted logical titles that remain consumer-eligible after finalization per provider request, probe-second, and Pi minute**, with minimum coverage floors per rail.

### 6.3 Rail outcomes in the latest two assessed artifacts

These are existing historical report rows, not provider replays. Aug 6 is bound to `3ffda16`; Aug 5 remains bound only to its own stored artifact/proof rather than the audit SHA. A value is `new_to_rail_verified`. The outcome text is the artifact's bounded explanation, not an audited root cause.

| Rail | Aug 5 | Aug 6 | Aug 6 artifact signal |
|---|---:|---:|---|
| movies-global-popular | 20 | 21 | target met |
| movies-india-trending | 21 | 22 | target met |
| movies-classics | 20 | 22 | target met |
| movies-comedy | 20 | 20 | target met |
| movies-quick-watches | 17 | 6 | theme pressure |
| movies-documentaries | 8 | 3 | same-theme/exhausted |
| series-global-popular | 20 | 20 | target met |
| series-india-picks | 2 | 4 | low stream yield |
| series-classics | 21 | 22 | target met |
| series-miniseries | 17 | 0 | source exhausted |
| series-reality-casual | 1 | 1 | theme pressure |
| series-comedy | 18 | 14 | theme pressure |

Aug 6 additionally reported 1,300 candidates, 78 duplicates, 179 recent-failure skips, 201 active rejections, 52 unresolved IDs, 235 final failures, 22 orphans attached (22 -> 0 at finalization), and overlap 143 -> 145 with maximum over-cap 2. The reported `batch_flush` zeros contradict enabled batch mode and are placeholders, not evidence that no batch writes occurred.

Bounded nightly history is incomplete. Persisted proofs exposed four `playability_rc=0` nightly entries on Aug 1-4 and one `playability_rc=1` entry on Aug 6; absence on another date cannot be classified as a skipped, deferred, deleted, or failed run. The 30-day service journal returned zero retained/user-visible entries, so a 30-day success frequency is **UNAVAILABLE**.

### 6.4 Source-obvious hot-path costs

- Rails run serially at the orchestration level while provider/resolver/probe work is bounded within a rail; a weak rail can consume its wall budget after stronger rails have already overgrown.
- Candidate status, metadata, theme, and link checks repeat across rails; duplicate provenance is attributed to earliest YAML source and later sources spend fetch/cursor budget without credit.
- Cursors advance before proof; failed staged work merges negative memory but discards source learning, encouraging repetition.
- Fixed phase cooldown consumes time regardless of observed dependency state.
- A full ~58 MB live DB is copied to work and back; at capture the WAL was ~37 MB. That point sample does not identify the run bottleneck, but whole-DB copy cost grows with unbounded pools/logs.
- Source hit-rate preflight starts the catalog and may spend provider calls on tiny, statistically weak head samples before the actual grow.
- Infrastructure-stale actions and multiple ladder attempts evade the nominal attempts counter; the current cap is neither provider-call nor probe-work bounded.
- Early target completion does not guarantee all in-flight pipeline work has joined, and bootstrap can finalize underneath active promises.

## 7. Source and thin-rail analysis

### 7.1 Static config, loaded runtime config, and current state

The loaded Pi YAML was byte-identical to checked-in `config/catalog.example.yaml` at 2026-08-06T23:00:54Z on `4a17519`. “Neutral floor” counts references for which `max(0.08, yaml_weight x 1) <= 0.08`; “locked” counts those still at floor at the hard `2.0x` learned multiplier; “current floor” combines loaded YAML with the current SQLite multiplier. These are audit-SHA point-in-time allocation classes, not provider-quality judgments. The `Aug 6 new` column is separately historical at `3ffda16`; it is shown for context and is not treated as an audit-SHA causal outcome.

| Rail | Refs / weight sum | Theme threshold and hard profile | Neutral floor / locked / current | Current pool V/S | Over `pool_max=120` | Aug 6 new | Evidence-backed pressure |
|---|---:|---|---:|---:|---:|---:|---|
| movies-global-popular | 13 / 1.000 | `min_fit=3`; anchor, no exclude list | 9 / 4 / 6 | 1,679 / 24 | 1,583 | 21 | Broad anchor; target met; no need for unbounded nightly growth. |
| movies-india-trending | 37 / 1.570 | `min_fit=10`; excludes named non-India regions/genres | 31 / 26 / 33 | 906 / 3 | 789 | 22 | Large portfolio; most refs floor-classified, but target met this run. |
| movies-classics | 8 / 1.000 | `min_fit=0`; excludes stand-up/reality | 3 / 1 / 4 | 1,001 / 21 | 902 | 22 | Source curation carries most precision. |
| movies-comedy | 9 / 1.000 | default `min_fit=8`; excludes horror/documentary/true crime | 5 / 2 / 5 | 916 / 17 | 813 | 20 | Target met; positive source/title fit can bypass exclusions. |
| movies-quick-watches | 8 / 1.000 | default `min_fit=8`; `max_runtime=110`; excludes documentary/epic/miniseries | 2 / 1 / 4 | 778 / 5 | 663 | 6 | Current adaptive state has 365 theme rejects; runtime cap can be bypassed. |
| movies-documentaries | 10 / 1.000 | default `min_fit=8`; excludes fiction/comedy/horror/superhero | 4 / 1 / 3 | 710 / 3 | 593 | 3 | One addon family; exhausted/same-theme artifact signal; 360 adaptive failures. |
| series-global-popular | 12 / 1.000 | `min_fit=3`; anchor, no exclude list | 8 / 4 / 8 | 992 / 3 | 875 | 20 | Broad anchor; continued growth despite depth. |
| series-india-picks | 50 / 1.061 | `min_fit=10`; excludes named non-India regions/platform signals | 47 / 47 / 49 | 413 / 0 | 293 | 4 | Strongest structural issue: nearly all refs permanently floor-classified; 296 failures and 151 unresolved in adaptive state. |
| series-classics | 9 / 1.000 | `min_fit=0`; excludes reality/game show | 5 / 1 / 2 | 757 / 1 | 638 | 22 | Source curation carries most precision; target met. |
| series-miniseries | 13 / 1.000 | `min_fit=8`; excludes reality/soap | 8 / 5 / 7 | 686 / 0 | 566 | 0 | One addon family; reported source exhaustion; 391 adaptive failures. |
| series-reality-casual | 12 / 1.050 | default `min_fit=8`; excludes scripted/documentary/animation/miniseries signals | 8 / 6 / 8 | 463 / 0 | 343 | 1 | Six refs permanently floor-classified; 185 theme rejects; 2 rate-limit events in adaptive state. |
| series-comedy | 7 / 1.000 | default `min_fit=8`; excludes horror/reality/documentary/crime/thriller | 2 / 1 / 3 | 745 / 3 | 628 | 14 | Smallest source portfolio; 386 theme rejects; short target but not one of the five repeated-target-miss rails. |

V/S means current verified/stale memberships. Adaptive counts are decayed SQLite state after the run, not additive run or lifetime denominators. Theme values come from `config/rail-theme-profiles.yaml:1-63`; absent `min_fit` uses executable default 8. All rail rows configure `display_limit=display_max=9`, `min_display=6`, `pool_target=20`, `pool_max=120`, `pool_growth_per_refresh=15`, and `grow_per_pass=20`; ingest multipliers vary 5/8/10. Executable defaults differ (`src/catalog-service/src/rails.ts:69-81`: pool target 60, growth 10, no max) but checked-in and loaded YAML overrides them. Grow mode ignores `pool_max`, `pool_growth_per_refresh`, and rail `ingest_multiplier`, and reports incremental grow target as `pool_target` (`src/catalog-service/src/playability/grow-target.ts:51-72`; `grow-rail.ts:182-208,632-657,949-999`; `pool-growth.ts:87-106`).

### 7.2 Complete configured source-reference inventory

This is the complete 188-reference inventory from the checked-in and byte-identical loaded YAML. `Ord` is YAML order within a rail and therefore the stable tie/order input before weighted/probation allocation. `N` means the static weight is at the neutral `0.08` floor; `L` means even the maximum `2.0x` learned multiplier cannot lift it above that floor. The YAML declares no source ID schema, so `ID` is `undeclared -> runtime normalize` for every row; exact manifest resolution is **DEFERRED** because no addon/provider manifest probe was authorized. “Configured” proves only that the loaded rail referenced the source.

| Ord | Rail / type | Addon : catalog | Weight | Floor N/L | ID | Runtime availability |
|---:|---|---|---:|---|---|---|
| 1 | `movies-global-popular` / `movie` | `Cinemeta : top` | 0.22 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.88302` | 0.13 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.88306` | 0.11 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.87667` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.2618` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.14` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.2202` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.2236` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.3093` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.3094` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 11 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.3095` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 12 | `movies-global-popular` / `movie` | `AIOMetadata : mdblist.3096` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 13 | `movies-global-popular` / `movie` | `Cinemeta : year` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-hi-recent-movie` | 0.12 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.180437` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.170279` | 0.09 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-ta-recent-movie` | 0.09 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-te-recent-movie` | 0.09 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.160358` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.165053` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-ml-recent-movie` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.167063` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.79339` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 11 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.160357` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 12 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-kn-recent-movie` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 13 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.167057` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 14 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.160365` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 15 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.131141` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 16 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.45216` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 17 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.156057` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 18 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-hi-surprise_me-movie` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 19 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-hi-top_rated-movie` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 20 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-ta-top_rated-movie` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 21 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-te-top_rated-movie` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 22 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.183641` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 23 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.157957` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 24 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.44081` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 25 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.162567` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 26 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.166154` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 27 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-ml-top_rated-movie` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 28 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-kn-top_rated-movie` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 29 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-ta-surprise_me-movie` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 30 | `movies-india-trending` / `movie` | `Bharat Binge : tmdb-te-surprise_me-movie` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 31 | `movies-india-trending` / `movie` | `AIOMetadata : custom.in_rdata_indiastreams.movie.recmov` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 32 | `movies-india-trending` / `movie` | `AIOMetadata : custom.in_rdata_indiastreams.movie.popmov` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 33 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.49761` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 34 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.44881` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 35 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.15960` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 36 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.56447` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 37 | `movies-india-trending` / `movie` | `AIOMetadata : mdblist.142371` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `movies-classics` / `movie` | `Cinemeta : imdbRating` | 0.28 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `movies-classics` / `movie` | `AIOMetadata : mdblist.83666` | 0.18 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `movies-classics` / `movie` | `AIOMetadata : mdblist.101881` | 0.15 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `movies-classics` / `movie` | `AIOMetadata : mdblist.88006` | 0.13 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `movies-classics` / `movie` | `AIOMetadata : mdblist.143797` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `movies-classics` / `movie` | `AIOMetadata : mdblist.97710` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `movies-classics` / `movie` | `AIOMetadata : mdblist.99248` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `movies-classics` / `movie` | `AIOMetadata : mdblist.3922` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `movies-comedy` / `movie` | `Cinemeta : top` | 0.22 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.91223` | 0.22 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.128040` | 0.15 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.2195` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.3107` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.69712` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.86734` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.11274` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `movies-comedy` / `movie` | `AIOMetadata : mdblist.84444` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.86934` | 0.23 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.84444` | 0.18 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.69712` | 0.14 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.3885` | 0.14 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.86734` | 0.11 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.11274` | 0.09 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `movies-quick-watches` / `movie` | `Cinemeta : year` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `movies-quick-watches` / `movie` | `AIOMetadata : mdblist.45854` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.128051` | 0.18 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.2406` | 0.15 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.84677` | 0.13 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.78210` | 0.12 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.2885` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.178241` | 0.11 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.100477` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.34451` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.81741` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `movies-documentaries` / `movie` | `AIOMetadata : mdblist.72165` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `series-global-popular` / `series` | `Cinemeta : top` | 0.28 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `series-global-popular` / `series` | `AIOMetadata : mdblist.88303` | 0.15 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `series-global-popular` / `series` | `AIOMetadata : mdblist.88434` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `series-global-popular` / `series` | `AIOMetadata : mdblist.2194` | 0.09 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `series-global-popular` / `series` | `AIOMetadata : mdblist.3882` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `series-global-popular` / `series` | `AIOMetadata : mdblist.3082` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `series-global-popular` / `series` | `AIOMetadata : mdblist.3088` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `series-global-popular` / `series` | `AIOMetadata : mdblist.3090` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `series-global-popular` / `series` | `AIOMetadata : mdblist.3089` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `series-global-popular` / `series` | `AIOMetadata : mdblist.72464` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 11 | `series-global-popular` / `series` | `AIOMetadata : mdblist.101882` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 12 | `series-global-popular` / `series` | `AIOMetadata : mdblist.105797` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `series-india-picks` / `series` | `AIOMetadata : mdblist.173530` | 0.34 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `series-india-picks` / `series` | `AIOMetadata : mdblist.160359` | 0.24 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `series-india-picks` / `series` | `AIOMetadata : mdblist.107457` | 0.18 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `series-india-picks` / `series` | `AIOMetadata : mdblist.181621` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `series-india-picks` / `series` | `AIOMetadata : mdblist.1824` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `series-india-picks` / `series` | `AIOMetadata : mdblist.80807` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `series-india-picks` / `series` | `AIOMetadata : custom.in_rdata_indiastreams.series.trendingtv` | 0.015 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `series-india-picks` / `series` | `AIOMetadata : mdblist.167064` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `series-india-picks` / `series` | `AIOMetadata : mdblist.166155` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `series-india-picks` / `series` | `AIOMetadata : mdblist.8310` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 11 | `series-india-picks` / `series` | `AIOMetadata : mdblist.107438` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 12 | `series-india-picks` / `series` | `AIOMetadata : mdblist.183642` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 13 | `series-india-picks` / `series` | `AIOMetadata : mdblist.11103` | 0.008 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 14 | `series-india-picks` / `series` | `AIOMetadata : mdblist.122391` | 0.008 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 15 | `series-india-picks` / `series` | `AIOMetadata : mdblist.65408` | 0.008 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 16 | `series-india-picks` / `series` | `AIOMetadata : mdblist.81619` | 0.008 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 17 | `series-india-picks` / `series` | `AIOMetadata : mdblist.33753` | 0.008 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 18 | `series-india-picks` / `series` | `AIOMetadata : mdblist.89014` | 0.008 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 19 | `series-india-picks` / `series` | `AIOMetadata : mdblist.55120` | 0.006 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 20 | `series-india-picks` / `series` | `AIOMetadata : mdblist.131190` | 0.006 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 21 | `series-india-picks` / `series` | `AIOMetadata : mdblist.160360` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 22 | `series-india-picks` / `series` | `AIOMetadata : mdblist.167061` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 23 | `series-india-picks` / `series` | `AIOMetadata : mdblist.160363` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 24 | `series-india-picks` / `series` | `AIOMetadata : mdblist.181302` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 25 | `series-india-picks` / `series` | `AIOMetadata : mdblist.21011` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 26 | `series-india-picks` / `series` | `AIOMetadata : mdblist.141869` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 27 | `series-india-picks` / `series` | `AIOMetadata : mdblist.138454` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 28 | `series-india-picks` / `series` | `AIOMetadata : mdblist.165054` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 29 | `series-india-picks` / `series` | `Bharat Binge : tmdb-hi-recent-series` | 0.005 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 30 | `series-india-picks` / `series` | `Bharat Binge : tmdb-hi-latest_episodes-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 31 | `series-india-picks` / `series` | `Bharat Binge : tmdb-hi-top_rated-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 32 | `series-india-picks` / `series` | `Bharat Binge : tmdb-hi-surprise_me-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 33 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ta-recent-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 34 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ta-latest_episodes-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 35 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ta-top_rated-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 36 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ta-surprise_me-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 37 | `series-india-picks` / `series` | `Bharat Binge : tmdb-te-recent-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 38 | `series-india-picks` / `series` | `Bharat Binge : tmdb-te-latest_episodes-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 39 | `series-india-picks` / `series` | `Bharat Binge : tmdb-te-top_rated-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 40 | `series-india-picks` / `series` | `Bharat Binge : tmdb-te-surprise_me-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 41 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ml-recent-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 42 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ml-latest_episodes-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 43 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ml-top_rated-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 44 | `series-india-picks` / `series` | `Bharat Binge : tmdb-ml-surprise_me-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 45 | `series-india-picks` / `series` | `Bharat Binge : tmdb-kn-recent-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 46 | `series-india-picks` / `series` | `Bharat Binge : tmdb-kn-latest_episodes-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 47 | `series-india-picks` / `series` | `Bharat Binge : tmdb-kn-top_rated-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 48 | `series-india-picks` / `series` | `Bharat Binge : tmdb-kn-surprise_me-series` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 49 | `series-india-picks` / `series` | `AIOMetadata : mdblist.79344` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 50 | `series-india-picks` / `series` | `AIOMetadata : mdblist.89085` | 0.003 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `series-classics` / `series` | `Cinemeta : imdbRating` | 0.28 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `series-classics` / `series` | `AIOMetadata : mdblist.101882` | 0.2 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `series-classics` / `series` | `AIOMetadata : mdblist.3086` | 0.13 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `series-classics` / `series` | `AIOMetadata : mdblist.50087` | 0.11 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `series-classics` / `series` | `AIOMetadata : mdblist.3087` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `series-classics` / `series` | `AIOMetadata : mdblist.127220` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `series-classics` / `series` | `AIOMetadata : mdblist.143745` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `series-classics` / `series` | `AIOMetadata : mdblist.128052` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `series-classics` / `series` | `AIOMetadata : mdblist.84403` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `series-miniseries` / `series` | `AIOMetadata : mdblist.143745` | 0.18 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `series-miniseries` / `series` | `AIOMetadata : mdblist.83865` | 0.16 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `series-miniseries` / `series` | `AIOMetadata : mdblist.149728` | 0.13 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `series-miniseries` / `series` | `AIOMetadata : mdblist.61189` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `series-miniseries` / `series` | `AIOMetadata : mdblist.50083` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `series-miniseries` / `series` | `AIOMetadata : mdblist.130152` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `series-miniseries` / `series` | `AIOMetadata : mdblist.130153` | 0.07 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `series-miniseries` / `series` | `AIOMetadata : mdblist.181334` | 0.06 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `series-miniseries` / `series` | `AIOMetadata : mdblist.169800` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `series-miniseries` / `series` | `AIOMetadata : mdblist.147478` | 0.03 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 11 | `series-miniseries` / `series` | `AIOMetadata : mdblist.35502` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 12 | `series-miniseries` / `series` | `AIOMetadata : mdblist.24908` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 13 | `series-miniseries` / `series` | `AIOMetadata : mdblist.134293` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.84401` | 0.35 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.147884` | 0.25 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.143024` | 0.14 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.122526` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.63182` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.125320` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.125155` | 0.05 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 8 | `series-reality-casual` / `series` | `Cinemeta : top` | 0.02 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 9 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.88303` | 0.015 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 10 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.88434` | 0.015 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 11 | `series-reality-casual` / `series` | `AIOMetadata : mdblist.101882` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 12 | `series-reality-casual` / `series` | `Cinemeta : imdbRating` | 0.01 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 1 | `series-comedy` / `series` | `Cinemeta : top` | 0.32 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 2 | `series-comedy` / `series` | `AIOMetadata : mdblist.91224` | 0.2 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 3 | `series-comedy` / `series` | `AIOMetadata : mdblist.83918` | 0.14 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 4 | `series-comedy` / `series` | `AIOMetadata : mdblist.3122` | 0.12 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 5 | `series-comedy` / `series` | `AIOMetadata : mdblist.142679` | 0.1 | N/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 6 | `series-comedy` / `series` | `AIOMetadata : mdblist.155168` | 0.08 | Y/N | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |
| 7 | `series-comedy` / `series` | `AIOMetadata : mdblist.49761` | 0.04 | Y/Y | undeclared -> runtime normalize | configured; manifest-resolved **DEFERRED** |

The 188 rows contain 132 neutral-floor references and 99 locked-at-maximum references, matching the independently calculated runtime matrix. Runtime health reported eight loaded addons and the YAML hash, but did not expose a credential-safe source-ref-to-manifest resolution map. Per-reference configured/resolved/missing state therefore remains deferred rather than being inferred from addon names.


### 7.3 Absolute floor defeats relative YAML intent — P1

`effectiveSourceWeight` computes `max(0.08, base_weight x multiplier)`, then the allocator labels every effective weight `<=0.08` probation (`source-hitrate-weights.ts:326-334`; `composite-merge.ts:128-158`). The YAML is a relative distribution whose smallest values are `.003-.08`; an absolute floor is not scale-invariant. Disabling learned hit-rate weights does not restore YAML semantics because the floor remains.

Only four probation sources receive a slot on a default page. The probation cursor is in process memory and starts at zero when a new source object is built. Series India needs 12 such pages to reach all 47 floor sources and Movies India needs eight; a later run reconstructs the source and begins with the earliest floor sources again (`list-source.ts:464-489,534-543`). There is no durable exploration guarantee. Current cursor state reinforces lifecycle drift: per-source cursor tables contained 12 quick-watch rows for eight configured refs, 51 series-India rows for 50 refs, and 14 reality rows for 12 refs. Retired cursor rows are not pruned with config.

This mechanism explains allocation starvation; it does **not** prove that late sources would yield playable titles. A controlled shadow benchmark is required before source promotion/removal.

### 7.4 Theme admission is simultaneously too permissive and too punitive — P1

`candidateThemeText` includes source name/label. Any positive title/source-only fit returns early before metadata hard exclusions or `max_runtime_minutes` are evaluated (`rail-theme-gate.ts:53-60,97-110,123-148`). A thematically named catalog can therefore make every row pass, and a quick-watch title can bypass the 110-minute cap. Conversely, metadata fetch failure is cached as null and converted to an ordinary below-threshold rejection, which can quarantine a title for seven days and penalize a source rather than recording `infra_unknown` (`rail-theme-gate.ts:151-163`; `config.ts:140-177`). Existing story evidence is not used by this gate. Dynamic AI VOD rails have no checked-in profile and take the permissive `no_profile` path.

The repair is not a weaker threshold. Hard exclusions/runtime caps must run whenever metadata is available; positive lexical evidence and source provenance can contribute a score but cannot bypass hard constraints; metadata outage must remain unknown and retryable.

### 7.5 Preflight and adaptation validity

- Production `source-hitrate.py` issues provider requests, invokes stream logic, writes latest/history artifacts, and retains sampled ID/title/error data. It was correctly **not run** during this audit.
- Sample sizes are one (quick) or three (nightly), randomly drawn from the first 15 accepted candidates, without a confidence bound. It checks stream list presence, not the mpv title-verification contract.
- Incremental merge refreshes a top-level timestamp while carrying old rows without per-row timestamps. The preflight freshness checker validates source-key coverage but not sample count, error state, config hash, catalog revision, or per-row age.
- TypeScript adaptation combines preflight and decayed grow evidence; the lower multiplier wins, otherwise it averages. Decay is 0.70. A target-met weighted run followed by a miss resets touched multipliers to 1; it is not a versioned rollback (`source-hitrate-weights.ts:175-299,336-393,550-724`).
- SQLite is authoritative, but `source-grow-audit.py` reads the obsolete JSON for multipliers, defaults missing data, mixes decayed counters with current TTL rejections, double-counts `skipped_verified + linked_verified_seen`, uses whole-rail elapsed time per source, and returns `ok:true` unconditionally (`source-grow-audit.py:172-289`). Its default catalog is repository `config/catalog.example.yaml`, not `/etc/mango/catalog.yaml`. Its output is unsuitable for current tuning even though the explicitly allowed invocation completed.
- Every current SQLite weight row had `updated_at=1786021391899`, while per-row `last_ts` differed. Report-global freshness plus full replacement can keep genuinely old entries active as long as another entry is fresh. Read/merge/replace has no CAS; parallel outcome writers can lose updates.
- Failed-stage memory merge preserves title/rejection/log evidence and cursor rewinds, but drops the source weights/outcomes learned during the failed run. A weak rail can repeat the same allocation on the next attempt.

### 7.6 Growth-starved rail diagnosis

The five persisted-proof problem rails are **growth-starved**, not display-thin: they are selected by consecutive grow-target misses (`src/catalog-service/src/reliability/model.ts:249-263`; `service.ts:384-428`). Actual display-thin means `verified_pool < 9` (`src/catalog-service/src/reliability/service.ts:296-305`). At the 22:59Z audit-SHA point sample, every one of the 12 configured VOD rails had hundreds of verified memberships, so none was display-thin. The historical Reliability wording that presented five rails as “thin” conflates freshness/growth starvation with current display depth.

| Rail | What is known | What remains unknown | Correct next hypothesis |
|---|---|---|---|
| series-india-picks | +2 Aug 5, +4 Aug 6; current 49/50 effective floor; adaptive state 24 verified, 296 failed, 151 unresolved; current cursor depth large. | Provider-request/probe denominator and which late configured refs are resolvable/playable. | Separate relative YAML weight from explicit exploration; fix ID/error classification; shadow every ref under equal bounded budget. |
| series-miniseries | +17 then 0; artifact says source exhausted; single addon family; adaptive 47 verified/391 failed. | Whether exhaustion is true upstream continuation, filtered-page false exhaustion, cursor state, or temporary provider failure. | Repair raw-page continuation and cause ledger before adding/weakening sources. |
| series-reality-casual | +1 twice; eight neutral floor/six locked; adaptive 18 verified, 61 failed, 185 theme rejects. | True hard-theme mismatch versus metadata-outage/source-label effects. | Enforce authoritative hard theme, classify unknown, then benchmark broader sources without weakening theme. |
| movies-documentaries | +8 then +3; one addon family; adaptive 38 verified/360 failed; artifact says same-theme/exhausted. | Raw continuation, exact no-stream/infra share, duplicate pressure. | Add provider/candidate-stage receipts and diversify only after controlled evidence. |
| movies-quick-watches | +17 then +6; current four floor; adaptive 39 verified, 84 failed, 365 theme rejects. | How many accepted titles actually satisfy 110-minute cap. | Make metadata cap authoritative; remeasure useful yield. |

Series comedy missed the historical +20 target (+14) but had 745 current verified memberships and was neither display-thin nor one of the five consecutive-miss rails. Treating every target miss as a thin library conflates freshness with usable depth.

### 7.7 Promotion, probation, recovery, and removal evidence standard

No source should be promoted or removed from the current evidence. Future decisions require a fixed config revision and isolated run window with, per source: raw request count; raw/accepted/normalized/unique counts; ID resolution; theme pass/unknown/reject; resolver cause; main probe attempts/wins; provider latency/rate limit; final consumer-eligible logical titles; and sample size/confidence. Preserve a minimum exploration floor independent of YAML weight. Promote only on a reproducible improvement in useful titles per provider request/probe-second without correctness or theme regression; probation on bounded evidence with cause; recover after a new window demonstrates recovery; remove only after repeated controlled windows or authoritative source retirement. Provider outage, auth error, and metadata outage are never removal evidence.

## 8. Scheduling, publication, and recovery audit

### 8.1 Timer, couch, and lock semantics

The installed Pi unit was active/waiting with `OnCalendar=*-*-* 03:00:00`, `Persistent=true`, oneshot service, and no service timeout. The Pi reported systemd 257 (`257.13-1~deb13u1`). The matching upstream [systemd.timer v257 source](https://github.com/systemd/systemd/blob/v257/man/systemd.timer.xml) says a persistent calendar timer stores last trigger time and can fire on activation after a missed run; [systemd.service v257](https://github.com/systemd/systemd/blob/v257/man/systemd.service.xml) defines the service timeout controls Mango leaves unset (systemd project, accessed 2026-08-06). Catch-up is correct for an appliance but can occur during daytime couch use.

Mango checks couch idle before the maintenance lock and again between stale and grow. However:

- implicit AIOMetadata sync occurs before the first idle check/lock and can mutate addon config;
- the activity helper accepts a playback-active path argument but never reads it, relying on pidfile/socket and last-input signals;
- a couch-active second check writes a deferred report, sets refresh rc to zero, and substitutes stale-phase JSON, so deferred-grow identity is not preserved cleanly through proof;
- `Persistent=true` has no automatic daytime retry after an idle deferral; next owner is the next timer or an operator;
- the maintenance lock is released before couch restore and recommendation handoff, and YouTube uses a check-then-release lock probe. A second grow can overlap post-publish restore/recommendation/YouTube work;
- the overnight script uses a different lock, no couch-idle contract, and direct live writes, so it can overlap the timer.

### 8.2 Isolation and SQLite semantics

Python's SQLite Online Backup API produces a consistent destination snapshot and can copy a live source, which is the right primitive ([SQLite Online Backup API](https://www.sqlite.org/c3ref/backup_finish.html), SQLite project, accessed 2026-08-06). SQLite holds a destination write transaction during the backup, and `sqlite3_backup_finish()` rolls it back if the copy is abandoned before `SQLITE_DONE`; an ordinary handled incomplete backup must therefore **not** be described as leaving a partially copied destination. Mango uses the API to seed the work DB and copy the work DB back. Its operational publication contract is nevertheless incomplete:

- publish copies into the existing live destination, then requests a TRUNCATE checkpoint without checking the returned busy/log/checkpointed tuple and manually unlinks destination `-wal`/`-shm`; this is a source-proven unsafe cleanup risk if checkpoint/connection quiescence assumptions ever fail, not evidence that corruption occurred;
- no pre-publish or post-publish `quick_check`/`integrity_check`, durable commit marker, publication-ID readback, or retained rollback copy exists;
- the structured ops report is written **before** the copy, so report presence is publish eligibility, not publication;
- handled API failures should roll back. Sudden process death, power loss, I/O error, a busy checkpoint, and the manual sidecar cleanup have not been fault-injected, so their end state is **DEFERRED**, not a source-proven corruption window;
- the URI-RO Pi check on `4a17519` at 2026-08-06T22:54-23:00Z returned `quick_check=ok`, so no current corruption was observed.

SQLite also documents that an overlapping reader can prevent a WAL checkpoint from resetting and sustained readers can grow the WAL without bound ([SQLite WAL](https://www.sqlite.org/wal.html), SQLite project, accessed 2026-08-06). The observed ~37 MB WAL beside a ~58 MB DB is a point sample, not proof of starvation; it warrants a checkpoint result/age/bytes metric. `PRAGMA query_only` alone is not a true read-only boundary and can still checkpoint, which is why this audit paired URI `mode=ro` with `query_only=ON` ([SQLite `query_only`](https://www.sqlite.org/pragma.html#pragma_query_only)).

### 8.3 Mutations outside the staged publication contract

1. AIOMetadata sync can POST configuration, rewrite credentials/export, print a private manifest URL, and leave fixed `/tmp/aiometadata-save.json`; failures are masked (`scripts/m3-play/playability/playability-maintenance.sh:72-90`; `scripts/m4-addons/aiometadata-config.sh:24-73,252-295`). It must not be automated until explicit opt-in, secret-safe output, unique restrictive temp handling, and a separate lock exist.
2. Pre-stage migrations, expiry sweep, trigger drain, and stream-evidence hooks mutate the live DB and are warning-only on failure (`playability-maintenance.sh:560-609`). Their survival is deliberate but not transactionally tied to the published corpus.
3. On failed staged grow, cursor rewinds and selected title/rejection/verify-log negative memory are merged live; source learning is not.
4. Stale-only, Search, voice, playback, top-up, curation, retheme, manual pin, and session paths mutate live state.
5. Overnight growth writes directly to live with partial progress surviving failure.

### 8.4 Best-effort and coordinator semantics

Refresh can publish when every rail passes minimum display/finalization even if `+20` is missed. That is an explicit best-effort policy and was the Aug 6 outcome. More concerning, default `ALLOW_PARTIAL=1` can mask a structured nonzero refresh beyond simple min-display shortfall: the staged DB is discarded, but restoration and VOD enqueue can still run whenever an output artifact was written. A mid-nightly couch deferral forces rc 0 and can publish stale-phase work or silently discard a failed stale phase while the outer coordinator reports success.

The post-publish exact recommendation job wait is fail-closed for recommendation promotion: invalid/enqueue/read/failed/timeout leaves last-good active and exits nonzero (`playability-maintenance.sh:731-849`). The Aug 6 exact job read failed, so playability publication succeeded while the coordinator failed. Session reshuffle is nonfatal; YouTube runs independently unless the playability lock appears held; checkpoint is best effort; stale-lock cleanup is best effort; reliability proof records component rc and can fail the oneshot. These distinctions are healthy, but current observability collapses them into one yellow/failed surface without a publication receipt.

### 8.5 Failure matrix

| Failure point | Durable state | Visible state | Cursor/rejection/weight result | Retry owner | Detection / gap |
|---|---|---|---|---|---|
| Timer missed while Pi off | none until catch-up | old corpus | unchanged | systemd `Persistent` catch-up | timer timestamp; daytime couch risk |
| Couch active before maintenance | unchanged, except AI sync may already mutate | old corpus | unchanged | next timer/operator; no daytime retry | deferred artifact/state; proof does not cleanly preserve phase |
| Lock busy | unchanged | old corpus | unchanged | next timer/operator | shell result/lock; journal retention unavailable |
| AI sync failure | addon state may be partial; warning masked | previous or mutated addon config | n/a | next run/operator | weak log; possible secret output/fixed temp |
| Source-hit-rate preflight stale/catalog-down/script failure | cached/partially rewritten source report may remain; script failure is swallowed | grow continues using cached/default weight evidence | weights may be stale or partially refreshed; cause not bound to run | same run continues, then next timer/operator | heartbeat says skipped/complete, but `\|\| true` at `playability-maintenance.sh:427-447` prevents a fail-closed outcome and row age/config hash are not validated |
| Pre-stage hook failure | earlier live hook writes may persist | mixed old corpus/live status changes | triggers/sweep partially changed | next run | warning only; no hook transaction receipt |
| Stage backup failure | handled Online Backup failure rolls back its destination transaction; an unusable work path may remain for trap cleanup, but it is not published; sudden process death is deferred | old corpus | unchanged | next timer/operator | shell exit/trap; no structured stage receipt or fault-injection proof |
| Stale phase fails, grow succeeds | work DB may contain partial stale+grow | publication rc inherits stale failure; default partial handling complicates result | work effects discarded or selected memory merged | next run | parsed JSON/rc; policy ambiguous |
| Mid-night couch deferral | stale phase work may publish under rc0 | stale-refreshed corpus or unchanged live | grow absent; deferred not cleanly represented | next timer/operator | deferred report plus substituted JSON; proof ambiguity |
| Grow misses +20 but is publishable | complete work DB publishes | new best-effort corpus | cursors/outcomes advance | normal next timer | refresh warning, target rows; intended policy |
| Grow crash/malformed fallback/nonzero | work DB discarded | live corpus unchanged except pre-hooks/merged memory | rewinds + negative memory merge; source learning lost | next timer | fallback raw excerpt; privacy and exact-stage gap |
| Hung-but-live grow / heartbeat stalls | staged work and live pre-hooks remain; process/lock continue indefinitely | couch stack may remain stopped; old live corpus remains until publish | in-flight work/cursors live only in work DB; no outcome receipt | human/operator only | oneshot has no timeout/watchdog; heartbeat can show stale phase but no enforced lease/kill-safe recovery; journal unavailable |
| SIGTERM / shell exit / SIGKILL | ordinary shell exit should run `restore_couch` EXIT trap and delete work DB; SIGKILL cannot; abort helper may kill processes then delete work DB/lock broadly | couch may recover or remain unavailable depending boundary | staged cursor/weights lost; live pre-hooks/merged writes may remain; abort artifact is reconstructed from mutable state | operator abort/helper or systemd next action | `playability-maintenance.sh:475-494`; `abort-maintenance-grow.sh:14-109`; no deterministic signal/crash suite, so exact boundary behavior is deferred |
| Finalization throws | normally nonzero/discard | old live plus pre-hooks | selected memory merge | next timer | no cohort/finalization transaction receipt |
| Publish API error / interruption / power loss | handled incomplete backup should roll back its destination transaction; sudden-death/power-loss result and manual sidecar cleanup are not fault-tested; no retained rollback generation | old/new/final state is not independently read back, so consumer state is indeterminate | work DB cleanup/trap uncertain; report may already say eligible | human restore | no publication ID/post-copy integrity receipt; current DB is okay; destructive cases DEFERRED |
| Restore fails | published DB may be valid | couch stack unavailable | publication retained | operator/next service action | shell/service health; lock already released later |
| Recommendation enqueue/read/job/timeout | published DB retained; last-good rec pointer retained | new pools, old recommendations | unchanged | next timer/operator; no targeted automatic retry | exact message + service rc; Aug 6 manifested read failure |
| Session reshuffle fails | published DB retained | old session deal until normal rotation | unchanged | daily session rotation | warning only, nonfatal |
| YouTube fails | VOD publication retained | VOD new; YouTube old | independent state | next nightly/operator | component rc in proof |
| WAL checkpoint blocked/fails | committed WAL retained | usually still serviceable | unchanged | automatic/next checkpoint | currently swallowed; bytes/result missing |
| Proof fails | product state retained | serving may be okay | unchanged | next proof/operator | oneshot fails; green/yellow/red is evidence, not rollback |
| Trigger consumer crash/throw | title write may persist; trigger may replay or be lost as handled | mixed | no lease/dead letter | next drain only if unhandled | DB rows; causality missing |
| Overnight loop failure | partial live writes persist | partial growth can surface | direct cursors/rejections/weights survive | loop/operator | different lock/state; no staged containment |
| Direct-live overnight/top-up/manual owner overlaps coordinator | both owners may write live or share probe sockets while coordinator stages/restores | corpus, couch, and proof can reflect mixed owners | cursor/rejection/weight effects depend on winner and are not generation-bound | whichever owner/timer runs next | maintenance and overnight use different locks; top-up is detached/off by default; no common writer lease or overlap receipt |

## 9. Observability, security, and test coverage

### 9.1 What each surface can and cannot answer

| Surface | Can answer | Cannot safely answer |
|---|---|---|
| grow run state/heartbeat | latest declared phase/message/progress | durable history; atomicity; publish completion; it is overwritten without atomic rename/lock and Python/TS timestamp types differ |
| refresh JSON | publish eligibility and modeled rail counters | actual publish; provider/probe counts; cohort survival; several fields are aliases/placeholders |
| ops events/reports | existing run/event payloads | privacy-safe raw export; `--json` emits complete candidate audit/raw fallback |
| `grow_monitor` | some current/baseline aggregates | strict read-only status, coherent one-snapshot truth, true 48h thinness, run-scoped verifies; `status` can unlink stale pidfiles and opens lock `a+` |
| `source-grow-audit` | legacy cache/cursor/rejection hints | authoritative current multipliers, valid source throughput, runtime config unless explicitly set; always `ok:true` |
| `playability-status` | current membership status summary | last indexer/publish: labels use any verify-log writer and membership max; totals double-count cross-rail titles |
| rail health / SLA | recent artifact rows | nights or publishes: manual/failed/incomplete artifacts can mix; configured absent rails can disappear from denominator |
| Reliability live state | current synthesized component color | exact-SHA persisted proof, couch play, publication receipt, provider-vs-content cause |
| reliability proofs | bounded historical proof payload at recorded SHA | current source truth or unsampled couch correctness; latest proof used `play_probe=false` |
| systemd | timer/unit and last retained service state | 30-day causal history here: journal returned no entries |
| direct RO DB | bounded aggregate read window; coherent cross-query snapshot only with an explicit read transaction | couch experience, exact cross-query atomic consistency here, and run attribution unless `run_id` is stored consistently |

Reliability **Green** would mean its configured checks passed, not that every title is identity-safe, all current cards play, the main ladder alone wrote verified, provider budgets were efficient, or the target TV/controller worked. **Yellow** currently combines thin depth, growth target misses, stale/older proofs, and served-sample breaks. **Red** indicates configured critical failures, not an automatic rollback or proof of DB corruption.

### 9.2 Minimal metric and receipt contract

Use a compact SQLite run ledger plus bounded metrics; do not put `run_id`, title ID, URL, or unbounded source key into time-series labels. Keep full aggregate run receipts 90 days, per-source aggregate rows 30 days, and redacted bounded samples 14 days. Expose only latest/rolling aggregates to Reliability.

| Name / receipt | Definition | Bounded labels and maximum series/rows | Owner | Persistence window | Decision enabled |
|---|---|---|---|---|---|
| `mango_growth_run_last_success_timestamp_seconds` | Unix timestamp of last coordinator success and separately last publish commit | `scope` = publish/coordinator (2 series) | maintenance wrapper | SQLite run ledger 90d; latest gauge exported | distinguish stalled grow from post-publish failure |
| `mango_growth_stage_duration_seconds` | duration of each completed stage; store start/end/outcome in receipt | `stage` <=16 x `outcome` <=5 (<=80 series) | wrapper/indexer | aggregate receipt 90d | hung/slow stage and wall allocation |
| `growth_funnel_receipt` (structured) | run-local count at each precisely defined funnel boundary | SQLite row per `run_id`/rail/stage/outcome; configured bounds rail <=14, stage <=20, outcome <=8; no Prometheus `_total` reset per run | grow pipeline | aggregate receipt 90d; expose only cumulative or latest bounded gauges | valid conversion/waste ratios without violating counter monotonicity |
| `mango_growth_dependency_requests_total` | actual HTTP/addon/resolver requests completed | `dependency` <=10 x `outcome_class` <=10 (<=100 series) | addon core/resolver | aggregate receipt 30d | provider budget, outage vs content absence |
| `mango_growth_probe_attempts_total` | every mpv attempt, including cancellation | `ladder` 3 x `outcome` <=8 x `capability_class` 3 (<=72 series) | verifier/probe pool | aggregate receipt 30d | main-only proof and verified/probe efficiency |
| `mango_growth_probe_duration_seconds` | attempt duration histogram, same outcomes as above | same <=72 labelsets; fixed histogram buckets; no URL/title | verifier | aggregate receipt 30d | concurrency and timeout tuning |
| `growth_publish_receipt` (structured) | `eligible`, `copy_started`, `copy_complete`, `quick_check`, `service_readback`, `consumer_readback`, exact source SHA/config hash/publication ID | no metric labels; exactly one row/run | wrapper | 90d | prove actual publication and locate handoff failure |
| `mango_growth_verified_titles` | point gauges for physical and logical canonical counts, plus expired-due | `scope` 2 x `state` <=4 (<=8 series) | URI-RO DB status reader | daily/run snapshots 90d; current gauge exported | detect count inflation and freshness debt |
| `source_allocation_receipt` | per configured source: raw funnel, YAML weight, learned multiplier, explicit exploration state, cursor before/after, evidence age | SQLite row/source/run, configured source cap <=256; exported aggregates only `rail` <=14 x `reason` <=16 (<=224 series) | list source/adaptation | 30d | fair promotion/probation/recovery/removal |
| `mango_growth_trigger_queue` | current count and oldest age | `state` 4 x `type` <=8 (<=32 series) | trigger owner | queue state durable; daily/run aggregate 30d | detect lost/hung trigger work |
| `mango_growth_deferred_total` | completed deferrals | `phase` <=16 x `reason` 3 (<=48 series) | wrapper | aggregate receipt 90d | distinguish couch safety from crash and schedule retry |
| `mango_sqlite_wal_bytes` / `mango_sqlite_checkpoint_timestamp_seconds` | WAL file bytes and last successful checkpoint timestamp/result receipt | `db` <=6 x `result` <=4 where applicable (<=24 series) | checkpoint helper | checkpoint receipts 30d; current gauges exported | reader starvation/disk risk |

Prometheus's official instrumentation guidance says batch jobs should expose last success, stage and total duration, completion, and records processed; failures need a total-attempt denominator; timestamps should be exported rather than “age” ([Prometheus instrumentation](https://prometheus.io/docs/practices/instrumentation/), Prometheus project, accessed 2026-08-06). Its label guidance warns that every labelset costs resources and unbounded identifiers should not be labels. The proposed bounded dimensions fit a Pi 5; source/title detail stays in TTL-controlled SQLite, not Prometheus.

### 9.3 Security and privacy

1. `PlayAttempt` can carry raw stream URLs into verify CLI stdout; the couch failure response places `CatalogError.details` in HTTP JSON. Signed/debrid transport credentials can therefore leak. The picker and diagnostics need a centralized URL redactor before serialization/logging.
2. `source-hitrate.py` persists sampled title/ID/raw-ish error picks. `ops-report.py --json` emits whole events/reports; refresh reports can contain candidate audit rows; fallback extraction stores the final 2,000 stdout characters. None is safe for wholesale support export.
3. `source-grow-audit.py --json` opens SQLite through a default read/write-capable connection (`source-grow-audit.py:112`). It was executed once for bounded SELECT-based evidence before that connection behavior was fully classified. No content-changing SQL was observed, but the execution cannot support a strict connection-level no-mutation guarantee. The exact `ops-report.py --json` invocation was file-only because `--reconstruct` was not supplied (`ops-report.py:372-405`), but it remains privacy-sensitive because it emits whole existing events/reports. Neither complete output is safe for support export. `grow_monitor status` was not run after source inspection showed it can unlink stale pidfiles and open the lock `a+`. A genuine audit/status mode must use URI `mode=ro`, `query_only=ON`, one transaction, bounded/redacted output, and no cleanup side effects.
4. AIOMetadata helper output and fixed temp handling can expose a private manifest/credentials and mutate operator state before lock/idle checks.
5. Cache writers do not uniformly enforce restrictive file mode/atomic rename/retention.

OpenTelemetry's URL semantic convention says user/password information must not be recorded and known sensitive query values must be scrubbed ([OpenTelemetry URL semantic conventions](https://opentelemetry.io/docs/specs/semconv/url/), OTel semantic conventions 1.44.0, accessed 2026-08-06). OWASP's logging guidance says access tokens, passwords, connection strings, and primary secrets should be removed, masked, sanitized, hashed, or encrypted and log event data should be sanitized ([OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html), accessed 2026-08-06). Mango appears to violate this in the raw URL/error paths; fix centrally and add negative snapshot tests.

### 9.4 Test coverage matrix

All 40 playability test files were read; they declare 223 focused test cases. The full service suite's 920 tests include broader code. Existing coverage is valuable but heavily helper-oriented.

| Invariant area | Existing evidence | Target test / fixture layer and exact failing assertion |
|---|---|---|
| DB/WAL/migrations | singleton, schema/log retention | Extend `src/catalog-service/src/playability/db-singleton.test.ts` with child-process/disposable-file fixtures: every supported prior migration opens at schema 17; injected busy/disk-full/interruption leaves an openable old or new DB and never a half-applied migration. |
| Identity/normalization | candidate/ID examples | Extend `src/catalog-service/src/playability/candidate-normalize.test.ts` and `src/catalog-service/src/core-stream-identity.test.ts`: sole wrong-year/type result is rejected; Unicode/punctuation properties preserve equivalent IDs; a mixed-addon piece cannot overwrite requested type/ID. |
| Resolver/cache | positive/negative examples | Extend `src/catalog-service/src/core-stream-resolve.test.ts`: replay each 401/403/429/5xx/timeout through cache and assert exact cause/retry time survives; two concurrent equal requests make one dependency flight and receive the same typed result. |
| Verify ladder | ordinary verify tests | Extend `src/catalog-service/src/playability/verify.test.ts` and `src/catalog-service/src/episode-playability-reconcile.test.ts`: main miss plus last-resort/obligation success returns immediate-play provenance but writes zero global verified rows; picker tamper is revalidated. |
| mpv pool | no focused lease test | Add `src/catalog-service/src/playability/mpv-probe-pool.test.ts` with fake IPC/shared-lock fixtures: two callers/four tasks/three workers cannot issue a second `loadfile` to a leased worker; delayed events never cross attempt tokens; cancellation releases once. |
| Pipeline | additive linking | Extend `src/catalog-service/src/playability/pipeline-additive.test.ts`: quota early-stop joins/cancels every prepare/probe before flush/stop; verify+link failure cannot leave a recommendation-eligible orphan; all theme rejects yield no durable global proof. |
| Browse v3 | build/deal basics | Extend `src/catalog-service/src/playability/vod-browse-v3.test.ts`: after reservoir creation, demote/expire a row and assert both memory-cache and stored-deal responses exclude it; incomplete/corrupt generation is never selected. |
| Triggers | create/priority/sweep | Extend `src/catalog-service/src/playability/trigger-consumer.test.ts` and `playability-triggers.test.ts`: two consumers claim once; crash after proof before ack yields one idempotent durable effect; transient throw retries and terminal exhaustion dead-letters, never marks handled early. |
| Cursors/pagination | simple persistence/reset | Extend `src/catalog-service/src/playability/list-source-cursors.test.ts`: a full raw page whose rows are blocked/malformed/duplicates still advances by upstream continuation; repeated page is detected; crash before outcome replays; removed source state is pruned or quarantined. |
| Source allocation | simple weights/composite | Extend `src/catalog-service/src/playability/source-hitrate-weights.test.ts` and `composite-merge.test.ts`: real `.003-.08` vector conserves normalized allocation, is scale-invariant, samples every source within a bounded epoch, ages each entry independently, and concurrent versioned update rejects stale CAS. |
| Theme | score/gate examples | Extend `src/catalog-service/src/playability/rail-theme-gate.test.ts`: positive source label cannot override excluded genre or 110-minute cap; metadata error returns `unknown` not rejection; story evidence requires named provenance. |
| Grow budgets | helper tests | Add `src/catalog-service/src/playability/pipeline-budget.test.ts` with fake clock/dependency/probe: every request, resolve, probe second, link, and wall unit consumes one declared cap; zero work begins after exhaustion; pool never exceeds chosen max. |
| Batch writes | basic batching | Extend `src/catalog-service/src/playability/batch-writer.test.ts`: direct and batch first-verification timestamps/outcomes match; injected flush failure propagates; shutdown waits for or cancels active producers before close. |
| Curation/pins | override helpers | Extend `src/catalog-service/src/playability/rail-overrides.test.ts` and add `rail-curation.test.ts`: absent/failed/stale pin cannot become serveable without accepted main proof; injected write failure leaves the prior complete curation generation. |
| Recommendation pages | production scanner already rejects generation/count drift | Extend `src/catalog-service/src/recommendations/story-graph-v1.test.ts` and `src/catalog-service/src/playability/recommendation-corpus.test.ts`: force mutation between pages, assert the existing `StaleStoryGraphGenerationError`, bounded coordinator retry/last-good preservation, and no publication; redesign so pending insert alone does not churn verified corpus generation. |
| Top-up/scheduler | no focused scheduler suite | Add `src/catalog-service/src/playability/top-up-scheduler.test.ts`: early return/throw clears hints and child ownership; start/stop is idempotent; overlapping rail schedules and grow share one owner and cannot share an mpv worker. |
| Staging/publication | shell assertions | Add `scripts/m3-play/playability/test_playability_maintenance.py` around disposable DB/filesystem/service stubs: inject death/error at backup, checkpoint, generation switch, readback, receipt, restore; assert old-or-new DB validates, receipt never leads state, previous generation remains usable, and no WAL sidecar is unlinked manually. |
| Diagnostics/SLA | 51 current unit tests | Add `scripts/diag/test_source_grow_audit.py` and extend `scripts/diag/test_grow_monitor.py`, `scripts/diag/test_ops_grow_sla.py`, and `scripts/diag/test_rail_health.py`: SQLite is authoritative; missing/mixed/incomplete runs emit `UNAVAILABLE`; all configured rails remain denominator; status changes no DB/file/lock mtime; credential/title fixtures never appear in JSON/stdout. |

Static greps can pass while semantics are wrong: the gate confirms field/text presence but not that counters are populated, the correct DB is read, all configured rails are in the denominator, status is non-mutating, or a publish actually happened. Future shell/Python runners must propagate individual subtest failure and assert counts, not merely a zero wrapper exit.

## 10. Prioritized findings

Severity means impact if the path executes, not proof that every risk manifested. “Observed” is reserved for current/historical evidence actually seen.

### P0 — correctness

| ID | Finding | Exact evidence | Manifestation status |
|---|---|---|---|
| P0-01 | Candidate identity is dropped before verification and downstream meta/picker paths lack a complete requested-identity fence. | `src/catalog-service/src/playability/pipeline.ts:395-404`; `src/catalog-service/src/playability/verify.ts:271-284`; `src/catalog-service/src/playability/candidate-normalize.ts:63-113`; `src/catalog-service/src/core.ts:3175-3195,3198-3238`; `src/catalog-service/src/meta-merge.ts:59-92`; `src/catalog-service/src/play-ladder.ts:778-798`; `src/catalog-service/src/play-orchestrator.ts:822-869` | Source-proven risk; wrong-title runtime example not observed. |
| P0-02 | If callers/processes overlap, round-robin pool selection can reuse a busy shared worker socket; `loadfile replace` and shared state can cross-correlate titles. One `processVerifyQueue` alone is capped safely. | `src/catalog-service/src/playability/mpv-probe-pool.ts:67-104`; `src/catalog-service/src/playability/pipeline.ts:329-341`; `src/catalog-service/src/playability/top-up-scheduler.ts:18-44`; `scripts/m3-play/playability/mpv-probe-ipc.sh:142-166`; mpv manual | Cross-caller/process lease gap source-proven; overlap enablement and collision not observed. |
| P0-03 | Exact-series last-resort/obligation success can persist global `verified` without `win_on_main`. | `src/catalog-service/src/episode-playability-reconcile.ts:33-80`; caller/main gate `src/catalog-service/src/index.ts:963-971,988-1028`; missing fallback case in `src/catalog-service/src/episode-playability-reconcile.test.ts:47-137` | Source-proven. Pi URI-RO `/etc/mango/playability.db` point sample at 2026-08-06T22:59:42Z had 113 episode-shaped verified orphans, consistent but not causal proof. |

### P1 — growth or reliability blockers

| ID | Finding | Exact evidence / runtime fact |
|---|---|---|
| P1-01 | Negative cache loses auth/timeout/5xx cause, reduces rate limits to a fixed coarse class without provider retry metadata, and can convert infrastructure unknown to clean miss/failed. | `src/catalog-service/src/core.ts:1200-1208,3960-3983,4232-4253` collapses cache causes to `miss` or `rate_limited`; `src/catalog-service/src/playability/verify.ts:182-205,343-355,418-437` maps replayed outcomes to durable/result status. |
| P1-02 | Bare-show and exact-episode state diverge across Search, grow, couch mapping, pools, and triggers. | `src/catalog-service/src/playability/ids.ts:4-43`; `src/catalog-service/src/playability/db.ts:2220-2301,3670-3715`; `src/catalog-service/src/episode-playability-reconcile.ts:33-80`; `src/catalog-service/src/index.ts:963-1028`; exported-but-uncalled `demoteVerifyIfDrifted` at `src/catalog-service/src/playability/verify.ts:209-235`; Pi URI-RO point sample 2026-08-06T22:59:42Z: 113 episode-shaped verified orphans. |
| P1-03 | Browse active reservoir/deal cache lacks a serve-time current status/expiry fence. | `src/catalog-service/src/playability/db.ts:3019-3024,3806-3826,4022-4035`; `src/catalog-service/src/core.ts:2559-2599,2859-2868`; Pi URI-RO point sample 2026-08-06T22:59:42Z: 282 due verified rows, one failed and 21 stale session rows. |
| P1-04 | Preserved stale failure can be returned as `verified` and promoted by trigger consumer. | `src/catalog-service/src/playability/verify.ts:182-190,343-355,418-437`; `src/catalog-service/src/playability/trigger-consumer.ts:87-105`. |
| P1-05 | Trigger queue has no claim/lease, marks transient throws handled, and has replay/loss windows. | `src/catalog-service/src/playability/db.ts:4248-4306`; `src/catalog-service/src/playability/trigger-consumer.ts:40-123`. |
| P1-06 | Cursor advances before durable proof in grow/top-up/legacy refresh. | `src/catalog-service/src/playability/grow-rail.ts:647-665`; `src/catalog-service/src/playability/top-up.ts:180-193`; `src/catalog-service/src/playability/refresh.ts:668-683`. |
| P1-07 | Bootstrap early exit does not join/cancel active promises before flush/pool shutdown. | `src/catalog-service/src/playability/pipeline.ts:222-227,244-341,371-392`; caller finalization `src/catalog-service/src/playability/grow-rail.ts:830-870`; no focused concurrency assertion in the 40-file playability suite. |
| P1-08 | Batch flush time flattens first-verification chronology and omits direct-write first-verification semantics; direct/batch parity is untested. Errors do propagate. | `src/catalog-service/src/playability/batch-writer.ts:39-177`; direct-write chronology `src/catalog-service/src/playability/db.ts:2220-2301`; awaited flush/stop `src/catalog-service/src/playability/pipeline.ts:619-634` and `src/catalog-service/src/playability/grow-rail.ts:830-870`. |
| P1-09 | Absolute `0.08` floor turns 132/188 neutral YAML refs into probation and permanently locks 99; exploration cursor is process-local. | `src/catalog-service/src/playability/source-hitrate-weights.ts:326-334`; `src/catalog-service/src/playability/composite-merge.ts:128-158`; `config/catalog.example.yaml:18-404`; loaded `/etc/mango/catalog.yaml` SHA-256 `1ae9059f208832405936f6376c1f44ec0f86eea1a9464f73f22aae8ce94e2623` at 2026-08-06T23:00:54Z. |
| P1-10 | Grow ignores `pool_max`, `pool_growth_per_refresh`, and rail `ingest_multiplier`; all 12 current pools exceed 120. | `src/catalog-service/src/playability/grow-target.ts:51-72`; `src/catalog-service/src/playability/grow-rail.ts:182-208,632-657`; ignored normal-growth cap helper `src/catalog-service/src/playability/pool-growth.ts:87-106`; Pi URI-RO point sample 2026-08-06T22:59:42Z: excess 293-1,583. |
| P1-11 | Positive title/source-label fit bypasses metadata exclusions and runtime cap; metadata outage becomes a 7-day theme rejection. | `src/catalog-service/src/playability/rail-theme-gate.ts:53-60,97-110,123-163`; TTL mapping `src/catalog-service/src/playability/config.ts:140-177`. |
| P1-12 | Filtered rows determine cursor advance/exhaustion, hiding later upstream pages. | `src/catalog-service/src/playability/list-source.ts:288-315,613-640`. |
| P1-13 | Current source diagnostic reads obsolete JSON, default example config, mixed populations, and says `ok:true` unconditionally. | `scripts/diag/source-grow-audit.py:29-54,104-135,172-289`; DB authority/migration `src/catalog-service/src/playability/source-hitrate-weights.ts:395-509`. |
| P1-14 | No run ledger counts actual dependency requests, resolves, probes, main wins, publication, or visible cohort. | `src/catalog-service/src/playability/candidate-ingest.ts:145-227`; `src/catalog-service/src/playability/grow-rail.ts:930-998`; `src/catalog-service/src/playability/refresh.ts:522-554`; historical payload `~/.cache/mango/ops/refresh-playability-20260806-030038.json`, runtime `3ffda166f4713866fcf64e7295fc6654a5220dec`, window 2026-08-06T11:51:36.897Z-13:03:32.130Z. |
| P1-15 | Implicit AIOMetadata sync mutates operator state and can expose a private manifest before idle/lock, with masked failure/fixed temp. | `scripts/m3-play/playability/playability-maintenance.sh:72-90`; `scripts/m4-addons/aiometadata-config.sh:24-73,252-295`. |
| P1-16 | Normal, API/manual overnight, restore, recommendation, and YouTube phases do not share one lock/generation contract. | `scripts/m3-play/playability/playability-maintenance.sh:450-494,699-849`; `scripts/m3-play/playability/nightly-library-refresh.sh:115-149`; `scripts/m3-play/playability/overnight-playability-grow.sh:23-27,85-87,329-409`; `src/catalog-service/src/playability/refresh-control.ts:297-347`. |
| P1-17 | `ALLOW_PARTIAL=1` and mid-night couch deferral can mask failures/discard, publish stale-only work, or enqueue recs without a confirmed publication. | `scripts/m3-play/playability/playability-maintenance.sh:632-713,723-731`; best-effort policy `src/catalog-service/src/playability/refresh.ts:202-235,462-488`. |
| P1-18 | Couch activity ignores supplied playback-active signal; deferral has no bounded daytime retry; oneshot timeout is infinite with no enforced lease. | `scripts/lib/couch-activity.sh:50-93`; deferrals `scripts/m3-play/playability/playability-maintenance.sh:459-465,509-528,632-655`; infinite oneshot `scripts/m3-play/playability/install-playability-timer.sh:47-80`; systemd semantics in section 8.1. |
| P1-19 | Recommendation handoff is not bound to a publication generation after lock release. | `scripts/m3-play/playability/playability-maintenance.sh:475-494,699-849`; `scripts/m3-play/playability/nightly-library-refresh.sh:115-149`; `~/.cache/mango/playability-grow.log:291972` publish at 2026-08-06 06:03:35 PDT and systemd result ending 06:06:39 PDT on runtime `3ffda166...`. |
| P1-20 | Manual pins can synthesize absent/nonverified rows and curation may accept a failed probe if any raw candidate exists. | `src/catalog-service/src/playability/rail-overrides.ts:73-92,199-259`; `src/catalog-service/src/playability/rail-curation.ts:26-78`. |
| P1-21 | Publication lacks validation/readback/rollback generation and manually removes WAL sidecars after ignoring checkpoint results. | `scripts/m3-play/playability/playability-maintenance.sh:186-231,357-376,669-699`; Pi URI-RO `/etc/mango/playability.db` `PRAGMA quick_check=ok` at 2026-08-06T22:54-23:00Z; sudden-death/manual-sidecar outcome remains **DEFERRED**. |

### P2 — material efficiency or observability improvements

| ID | Finding | Evidence |
|---|---|---|
| P2-01 | Infrastructure-stale results and multiple ladder probes evade attempts cap; wall checked only between batches. | `src/catalog-service/src/playability/pipeline.ts:299-325`; `src/catalog-service/src/playability/grow-rail.ts:632-825`. |
| P2-02 | `fresh_queued` increments before dedupe; duplicate candidates can prematurely consume quota. | `src/catalog-service/src/playability/candidate-ingest.ts:166-227`. |
| P2-03 | `MANGO_GROW_LINK_MAX` is a capped prepass but Boolean/unbounded during ingest. | `src/catalog-service/src/playability/grow-global-link.ts:38-50`; `src/catalog-service/src/playability/pipeline.ts:486-545`. |
| P2-04 | Zero-source composite is empty but not exhausted; grow can wall-spin and `skipped_no_sources` is unreachable. | `src/catalog-service/src/playability/list-source.ts:520-531`; `src/catalog-service/src/playability/grow-rail.ts:1002-1039`. |
| P2-05 | Global source-report freshness keeps old rows active; full replacement has no CAS. | `src/catalog-service/src/playability/source-hitrate-weights.ts:423-509`; Pi URI-RO `/etc/mango/playability.db` point sample 2026-08-06T22:59:42Z: all weight rows shared `updated_at=1786021391899` while `last_ts` differed. |
| P2-06 | Failed staged run loses source weights/outcomes while merging negative memory; new source cursor can advance into live. | `scripts/diag/merge_failed_grow_memory.py:68-180`; `scripts/m3-play/playability/playability-maintenance.sh:234-315,357-375`. |
| P2-07 | Pending inserts and broad title/pool triggers cause verified-corpus generation churn. The scanner safely rejects page-generation/count drift, but bounded recovery/last-good retry is not proven. | `src/catalog-service/src/playability/db.ts:1190-1260,3474-3582`; `src/catalog-service/src/recommendations/story-graph-service.ts:607-634`. |
| P2-08 | Top-up hints leak on early return/throw; scheduler lifecycle has no focused tests. | `src/catalog-service/src/playability/top-up.ts:146-174,225-239`; `src/catalog-service/src/playability/top-up-scheduler.ts:18-44`; no scheduler test file exists. |
| P2-09 | Global verified can survive all theme link rejects as an orphan. | `src/catalog-service/src/playability/pipeline.ts:251-283`. |
| P2-10 | Theme/curation/retheme live mutations are sequential, not atomic. | `src/catalog-service/src/playability/rail-curation.ts:93-123`; `src/catalog-service/src/playability/rail-pool-retheme.ts:465-505,587-589`. |
| P2-11 | Obligation floor is best effort; last-resort work can consume budget before it runs. | `src/catalog-service/src/play-orchestrator.ts:899-910,942-970,974-1008`; main and last-resort share an attempt budget and obligation floor runs only if budget/time remain. |
| P2-12 | Couch/probe deadline and minimum-duration accounting are inconsistent; duration zero can pass brief playback. | `src/catalog-service/src/play-orchestrator.ts:132-140,236-311,389-403`; `scripts/m3-play/playability/mpv-probe-ipc.sh:104-124`; `scripts/m2-catalog/service/mpv-play.sh:237-269`; no target-TV observation. |
| P2-13 | Known-risky path is not an exclusion; active stream evidence does not fence verification. | `src/catalog-service/src/playback-capability.ts:100-186,251-269`; `src/catalog-service/src/play-ladder.ts:537-575,670-702`; `src/catalog-service/src/play-orchestrator.ts:622-646,1010-1036`; `src/catalog-service/src/playability/db.ts:436-580`. |
| P2-14 | Direct couch evidence writes are non-atomic; response can disagree with persisted state. | `src/catalog-service/src/index.ts:963-1035,1138-1184`; persistence, assignment, demotion, and trigger writes are separately caught after playback outcome. |
| P2-15 | Verify timing mixes winning TTFF with total failed-attempt time. | `src/catalog-service/src/play-orchestrator.ts:516-567`; `src/catalog-service/src/playability/verify.ts:386-423`; success stores winning `probe_ms`, failure stores summed attempt milliseconds. |
| P2-16 | `wasted_candidate_ratio`, source elapsed/yield, monitor fresh, rail nights, SLA denominators, and status labels are numerically misleading. | `src/catalog-service/src/playability/grow-rail.ts:949-987`; `src/catalog-service/src/playability/refresh.ts:522-554`; `scripts/diag/source-grow-audit.py:172-230`; `scripts/diag/grow_monitor.py:951-1075`; `scripts/diag/rail-health.py:80-154`; `scripts/diag/ops_grow_sla.py:302-381`; `scripts/diag/playability-status.py:42-74`. |
| P2-17 | Rejection upsert replaces reason but keeps maximum TTL, inheriting unrelated quarantine. | `src/catalog-service/src/playability/db.ts:1963-1969`. |
| P2-18 | `verify_log` retention is ~14 days, service journal history was empty, and ops artifact retention is not a product contract. | `src/catalog-service/src/playability/db.ts:967-978`; Pi command `journalctl --user -u mango-playability-indexer.service --since "-30 days" --no-pager` returned zero rows during the 2026-08-06T22:48-23:00Z audit window. |
| P2-19 | Whole-DB copy and unbounded pools/logs increase stage/publish/WAL cost without a storage budget. | `scripts/m3-play/playability/playability-maintenance.sh:186-231,323-377`; cap bypass `src/catalog-service/src/playability/grow-rail.ts:182-208,632-657`; Pi URI-RO point sample 2026-08-06T22:59:42Z: ~58 MB DB, ~37 MB WAL, all 12 pools above 120. |
| P2-20 | Reliability rail history can credit unpublished/incomplete/manual artifacts and uses an incomplete denominator. | `src/catalog-service/src/reliability/service.ts:360-428`; `scripts/diag/rail-health.py:80-154`; `scripts/diag/ops_grow_sla.py:302-381`. |

### P3 — cleanup or optional experiments

| ID | Finding | Evidence |
|---|---|---|
| P3-01 | IMDb canonical IDs preserve case, allowing logical duplicates. | `src/catalog-service/src/playability/ids.ts:4-19`; canonicalization trims but preserves IMDb ID case. |
| P3-02 | Several output names are aliases/placeholders (`verified_added`, four membership aliases, zero batch/prune/queue fields). | `src/catalog-service/src/playability/grow-rail.ts:220-247,295-303,667-674,880-884,949-998`; `src/catalog-service/src/playability/refresh.ts:522-554`. |
| P3-03 | Canonical docs retain schema/SHA/source-authority/threshold/backup/timer drift. | `docs/STATUS.md:99-107,350-358,527-544`; `config/catalog-rail-curation.md:5-18`; `docs/PLAYABILITY.md:416-420`; current source comparisons `src/catalog-service/src/playability/db.ts:999-1008,1535-1579`, `src/catalog-service/src/playability/source-hitrate-weights.ts:395-509`, `src/catalog-service/src/rails.ts:69-81`, `config/catalog.example.yaml:18-404`, and `scripts/m3-play/playability/playability-maintenance.sh:186-231`. |
| P3-04 | Retired aliases/timers/catch-up watcher and debug bypasses remain callable or only installer-removed. | `src/catalog-service/src/playability/refresh-control.ts:135-136,200-212,327-343`; `scripts/m3-play/playability/playability-refresh-level.sh:13-23`; `scripts/m3-play/playability/playability-catchup-watch.sh:4-5,17-258`; `scripts/m3-play/playability/install-playability-timer.sh:9-43,66`; bypass knobs `scripts/m3-play/playability/playability-maintenance.sh:12-35,56-69,129,327-329,707-719`. |
| P3-05 | Non-stationary source allocation is a future controlled research topic, not a reason to deploy a bandit now. | `src/catalog-service/src/playability/source-hitrate-weights.ts:326-392,550-724`; missing reward denominators/placeholders `src/catalog-service/src/playability/grow-rail.ts:949-998` and `src/catalog-service/src/playability/refresh.ts:522-554`; Garivier & Moulines ALT 2011 research in section 14.4. |

## 11. Principled recommendations

### 11.1 Ranked portfolio

| Rank | Recommendation | Primary findings | Expected useful-growth effect | Effort | Change risk | Prerequisite class | Acceptance gate |
|---:|---|---|---|---:|---:|---|---|
| 1 | Exclusive mpv worker lease and command correlation | P0-02 | Removes cross-title false proof/failure; makes probe concurrency trustworthy | M | low | obvious low-risk correctness | Four tasks/three workers across two callers never share a leased socket; isolated Pi local-media outcomes match concurrency 1/3. |
| 2 | Immutable requested-identity envelope and main-only durable proof decision | P0-01, P0-03, P1-01/02/04 | Stops wrong-title/fallback count inflation; improves retry labels | M | medium | correctness before measurement | Only an identity-safe main win changes verified/corpus counts; isolated Pi shadow and human couch sample match exact title/episode. |
| 3 | Validated generation publication with integrity/readback receipt | P1-17/19/21 | Bounds recovery risk and separates publish from handoff | L | medium | high-value operability/data-safety hardening | Fault injection always opens old or new validated generation; controlled Pi URI-RO readback and handoff share publication ID. |
| 4 | Central current consumer-eligibility fence | P1-03/20, P2-07/13 | Prevents failed/expired/synthetic rows reaching Browse/sessions/recs | M | low-medium | after proof contract | Local cache/demotion suite and Pi aggregate show zero failed/due strict cards; couch focus does not regress. |
| 5 | Cause-preserving resolver cache plus leased/idempotent triggers | P1-01/04/05, P2-01 | Avoids false failure, lost retry, duplicate provider work | M | medium | after proof contract | Injected HTTP/transport causes survive cache/retry; duplicate/crash delivery yields one durable effect. |
| 6 | Immutable run ledger, truthful read-only diagnostics, and centralized redaction | P1-13/14/15, P2-16/18/20 | Makes each later optimization measurable and support-safe | M | low-medium | measurement first | Ledger reconciles exact SQL, missing evidence stays unavailable, status changes no files/locks, and secret fixtures never serialize. |
| 7 | One scheduler/lock/couch lease through generation-bound handoff | P1-16/17/18/19 | Prevents overlap, starvation, and ambiguous deferral | M | medium | publication receipt | Pairwise owner/state-machine tests prove one writer; controlled Pi disposable run defers safely and hands off one generation. |
| 8 | Relative source allocation, durable exploration, and enforced pool/work budgets | P1-09/10, P2-01/03/05/06/19 | Redirects provider/probe budget from deep anchors to useful deficits | M | medium | run ledger first | Allocation is scale-invariant/non-starving; every costly action consumes a cap; shadow canary never updates live state or exceeds pool max. |
| 9 | Raw-page cursor contract and authoritative theme gate | P1-11/12, P2-02/09/17 | Recovers hidden candidates without weakening themes | M | medium | cause ledger first | Filtered full pages continue correctly; hard exclusions always hold; unknown dependency state does not reject or penalize. |
| 10 | Controlled source portfolio benchmark; only then promote/remove | P3-05 and growth-starved rails | Identifies better sources/targets with bounded provider cost | M | controlled | R1-R9 evidence contracts | Fixed-budget isolated repeats meet section 7.7 confidence/correctness criteria with zero live-state writes before any promotion. |

The required cross-cutting decision fields are normalized here; the following subsections provide the full mechanism and test detail.

| R | Confidence | Correctness, privacy, provider, and couch trade-offs | Deterministic local target | Controlled Pi / couch target | Rollback / containment | Dependencies / effort |
|---:|---|---|---|---|---|---|
| R1 | high | Correctness removes cross-proof but may expose lower true throughput; privacy adds no transport fields; provider calls do not increase; couch process must remain untouched. | `src/catalog-service/src/playability/mpv-probe-pool.test.ts`, two callers/four tasks/three workers. | Disposable sockets/local media; compare concurrency 1/3; no provider or live DB. | Contain to one coordinator/process plus concurrency 1 under a machine-visible owner lock; never return to an unleased socket. | none; M |
| R2 | high | Correctness may turn metadata-poor positives into `unknown_identity`; privacy protects/redacts title/year/provenance; provider normalization may add bounded work; couch fallback may play immediately but cannot become durable proof. | `candidate-normalize.test.ts`, `core-stream-identity.test.ts`, `verify.test.ts`, `episode-playability-reconcile.test.ts`. | Isolated revision-bound shadow; then human exact-title/episode couch sample. | Retain explicit unknown/fallback; old write policy only in isolated rollback tests. | R1; M |
| R3 | medium overall; high for missing controls, low for untested sudden-death outcome | Correctness/data safety improves at disk/latency cost; privacy receipts exclude rows/URLs; provider neutral; couch restore may take longer and needs bounded failure behavior. | `scripts/m3-play/playability/test_playability_maintenance.py` crash matrix on disposable DB/filesystem. | Disposable same-filesystem generation first; production canary retains previous and URI-RO reads exact ID. | Atomic selected-pointer switch to validated previous plus readback. | R6 receipt and all writer owners; L |
| R4 | high overall; medium for user impact | Correctness excludes failed/due/synthetic rows; privacy neutral; provider neutral; couch may see temporary rail shrink/focus movement. | `vod-browse-v3.test.ts`, session/pin/corpus demotion fixtures. | URI-RO DB/API zero-invalid sample and couch focus regression sample. | Freeze new generation and retain previous eligible deal, never serve failed rows. | R2 schema/provenance; M |
| R5 | high | Correctness preserves unknown causes; privacy stores sanitized cause, not raw error/auth; provider retries become cause-bounded; couch can wait longer on transient failures but avoids false demotion. | `core-stream-resolve.test.ts`, `trigger-consumer.test.ts`, `playability-triggers.test.ts` with fake clock/crashes. | Seeded isolated triggers/dependency stub; no live provider required. | Pause consumer with queue intact; never ack unknown. | R2 types; M |
| R6 | high | Correctness makes evidence causal; privacy materially improves through redaction/retention; provider calls are only counted, not added; couch/status reads become side-effect-free. | Diagnostic golden/property/snapshot tests named in section 9.4. | Two URI-RO snapshots reconcile to direct SQL; measure storage/cardinality only. | Dual-read old artifacts while new ledger proves parity; keep old readers read-only. | receipt schema and redactor; M |
| R7 | high | Correctness serializes owners; privacy removes secret-prone prerequisite from implicit path; provider fan-out cannot overlap owners; couch safety may defer growth and therefore needs bounded ownership. | Coordinator state-machine fixtures for every owner pair, boundary, restart, and lease. | Provider-disabled disposable DB run proves no couch interruption and one owner. | Disable API/overnight retry while conservative timer remains. | R3, R5, R6; M |
| R8 | medium overall; high on defects, medium on allocator | Correctness preserves theme/proof gates; privacy exports only bounded aggregates; provider work is explicitly capped but exploration reallocates it; couch depth may stop growing or shrink to chosen cap. | `source-hitrate-weights.test.ts`, `composite-merge.test.ts`, `pipeline-budget.test.ts`. | Shadow allocation, then one isolated fixed-budget staged canary with no live weight write. | Versioned prior policy/vector; stop canary at any cap. | R1, R2, R6; M |
| R9 | high | Correctness improves continuation/theme precision; privacy stores provenance not raw history; provider work may reach later pages but remains capped; couch sees better theme fit while unknown metadata defers. | `list-source-cursors.test.ts`, `rail-theme-gate.test.ts`, all-link-reject fixture. | Shadow counts before a staged isolated canary. | Restore cursor/theme generation snapshot. | R5 cause model, R6 ledger; M |
| R10 | medium | Correctness requires main-only final cohort; privacy uses redacted isolated fixtures; provider has a fixed request/probe-second ceiling; couch/live state is untouched until a separately approved canary and human check. | Offline replay validates randomization, accounting, confidence intervals, and promotion decision. | Only after R1-R9, isolated DB/cache, explicit provider budget, no live writes; later couch acceptance is separate. | Discard isolated experiment; no live cleanup/reset. | R1-R9; M |

### 11.2 R1 — Exclusive mpv worker leasing

- **Principle/problem:** one playback engine can own one proof at a time across the whole machine. Process-local round-robin selection is not a cross-caller lease, and mpv's asynchronous `loadfile replace` makes response correlation unsafe. One queue's concurrency cap is necessary but not sufficient.
- **Evidence / external guidance / confidence:** P0-02; mpv stable manual's command semantics. Confidence **high**.
- **Expected effect:** removes a correctness confounder and makes concurrency/latency measurements meaningful. It may reduce apparent throughput if existing oversubscription was happening; that is a truthful correction.
- **Smallest implementation shape:** add a machine-visible acquire/release lease around `probeUrlViaPool` worker selection, with a bounded process-local queue for same-process callers; assign an opaque attempt token; reset observed properties before load; accept events only for the leased worker/token/current playlist entry; poison/recreate a worker after timeout/IPC error. Reuse existing worker sockets/lifecycle and configured concurrency; do not raise concurrency.
- **Local acceptance:** deterministic fake IPC fixture with four simultaneous tasks and three workers; delay task A, admit D, assert D cannot send to worker 0 until A releases; reorder/delay events and assert no result crosses tokens; cancellation releases exactly once.
- **Controlled Pi acceptance:** isolated local-media fixtures and disposable sockets, no provider call/live DB. Run at concurrency 1/3 and prove identical per-title outcomes plus bounded queue wait and no couch process interaction.
- **Trade-offs / rollback / dependencies / effort:** small queue latency and recovery complexity. Rollback must contain execution to one coordinator/process plus concurrency 1 under a machine-visible owner lock; concurrency 1 alone is not cross-process isolation. Never return to an unleased socket. No upstream dependency. **M**.

### 11.3 R2 — Immutable identity envelope and proof decision

- **Principle/problem:** a durable proof must answer “which requested title/video won, by which permitted ladder step, under which dependency state?” Grow currently drops hints, meta/picker can change identity, and exact fallback can persist.
- **Evidence / external guidance / confidence:** P0-01/P0-03, P1-01/P1-02/P1-04; Stremio item/video distinction; TMDB type-correct movie/TV external-ID endpoints versus text-search title/year evidence; RFC 9110 error classes. Confidence **high**.
- **Expected effect:** reduces false positives, physical/logical inflation, orphan episodes, false source penalties, and unverifiable recommendation eligibility. Some current “verified” volume will fall; useful growth should become lower but trustworthy.
- **Smallest implementation shape:** introduce immutable `VerificationRequest {requested_type, canonical_item_id, exact_video_id, title, year, edition, source_provenance}` and `ProofDecision {identity_match, ladder_step, main_win, resolver_cause, probe_attempt_id}`. Carry it through candidate normalize -> core meta/stream -> ranking/picker -> probe -> direct/batch writes. Fence returned meta/type/ID and picker choice. Only `main_win && identity_match` may call the durable verified write. Last-resort can satisfy an immediate controlled play but records non-library provenance. Preserve cause in negative cache.
- **Local acceptance:** table/property fixtures for movie, bare show, S1E1, non-gate episode, sibling episode, wrong type, same title/wrong year, translated/alternate title, mixed meta pieces, picker tamper, 401/403/429/5xx/timeout, main miss + fallback success. Assert direct/batch parity and that corpus generation/verified count changes only for a main identity-safe win.
- **Controlled Pi acceptance:** shadow verifier against a revision-bound, redacted, operator-approved title set using an isolated DB/cache and provider budget. Compare decisions to current without writes; then a staged canary must show zero fallback writes and zero identity contradictions. Human couch verifies exact episode/title for sampled successes.
- **Trade-offs / rollback / dependencies / effort:** stricter identity can increase false negatives where metadata is poor; retain explicit `unknown_identity` and immediate fallback rather than weakening. Feature flag writes old decision only in isolated rollback testing, not after promotion. Depends on R1 for trustworthy probes. **M**.

### 11.4 R3 — Validated publication and a generation receipt

- **Principle/problem:** publish is a state transition, not a pre-copy report or log line. SQLite Online Backup provides a destination transaction and rollback for a handled incomplete copy; Mango still lacks a validated generation readback/receipt/rollback and performs unchecked manual WAL cleanup.
- **Evidence / external guidance / confidence:** P1-17/P1-19/P1-21; SQLite Backup API and WAL documentation. Current DB passed `quick_check`. Confidence **high** that validation/recovery evidence is missing and the checkpoint result is ignored; **low** on sudden-death outcome because fault injection is deferred.
- **Expected effect:** makes corpus recovery and downstream handoff attributable and contains whole-library risk; little direct throughput gain.
- **Smallest implementation shape:** quiesce **all** live DB writers; checkpoint/close through SQLite and inspect the checkpoint result (never unlink WAL manually); validate staged `quick_check` plus domain invariants and stored `publication_id`; use a validated unique destination-file generation on the same filesystem, retain a validated `.previous`, and make the selected generation switch atomic; fsync the selected file/parent as appropriate; reopen URI read-only and verify publication ID/schema/count invariants; only then append `publish_committed`. Bind exact recommendation job(s) to that publication/corpus generation. Clean old generations only under retention after proof.
- **Local acceptance:** temp filesystem/DB crash injection before/after every backup, fsync, rename, readback, receipt, and handoff boundary. After each injected death, either old or new validated generation opens—never partial—and the receipt never overstates state. Simulate busy checkpoint/reader.
- **Controlled Pi acceptance:** same-filesystem disposable DB path with service writers absent; read-only validate current live before/after an isolated synthetic generation. Production canary retains previous generation and confirms API/read-only corpus generation before downstream enqueue. Couch restore and recommendation job reference the same ID.
- **Trade-offs / rollback / dependencies / effort:** extra disk (two generations) and publish latency; reserve/check disk first. Rollback is an atomic switch to validated previous plus readback. Coordinate catalog service, top-up, overnight, and session writers. **L**.

### 11.5 R4 — One consumer-eligibility predicate

- **Principle/problem:** build-time verification is insufficient when status/expiry changes after caching; pins and stream evidence are serving exceptions.
- **Evidence / confidence:** P1-03/P1-20, P2-07/P2-13; 282 current due verified, one failed session record. Confidence **high** for source, medium for user impact.
- **Expected effect:** prevents known failed/expired/synthetic rows from Browse, sessions, recommendations, and pins; may temporarily reduce rail depth.
- **Smallest shape:** central predicate/join requiring current `status=verified`, `expires_at>now` (or explicit bounded stale couch policy outside strict consumers), canonical identity, main-proof provenance, and no active risky issue. Recheck at reservoir/deal/session serve and invalidate caches on status/proof generation. Pins must resolve to the same eligible row or be visibly quarantined.
- **Acceptance:** local demotion/expiry/cache fixtures across active reservoir, stored deal, 45-minute cache, explore, session reuse, pins, and corpus pages. Pi read-only API/DB sample shows zero failed/due strict cards; couch sample confirms no vanished-focus regression. Roll back by disabling new Browse generation while retaining previous known-good, not by serving failed rows. Depends R2 schema. **M**.

### 11.6 R5 — Cause-preserving cache and leased triggers

- **Principle/problem:** retries must preserve why evidence is unknown, and work queues need claim/retry/idempotency.
- **Evidence / external / confidence:** P1-01/P1-04/P1-05, P2-01; RFC 9110 and RFC 6585 §4. Confidence **high**.
- **Expected effect:** fewer false demotions, duplicate calls, and lost recovery; source learning stops treating outages as content failure.
- **Smallest shape:** typed evidence with cause/retry-at/evidence time; no generic miss for infrastructure/auth. A 401/403 blocks until credential/config revision or operator action rather than retrying unchanged credentials. A 429 records bounded scheduler/circuit state such as `rate_limited_until`—not a cached 429 response or content miss—because [RFC 6585 §4](https://datatracker.ietf.org/doc/html/rfc6585#section-4) says 429 may carry `Retry-After` and must not be cached. Parse either HTTP-date or delay-seconds, validate and cap it per [RFC 9110 §10.2.3](https://datatracker.ietf.org/doc/html/rfc9110#section-10.2.3). For 503/other 5xx/timeout/transport, capped exponential backoff with jitter is a **Mango design hypothesis** to test; confirmed content absence keeps a separate content TTL. Trigger states are `unhandled -> claimed(lease) -> handled` or `retry/dead`, with an atomic claim, attempt cap/dead-letter, and DB uniqueness over `(trigger_id, proof_generation)` where the immutable generation is captured at claim time. Reuse trigger priority and verify result types.
- **Acceptance:** fake clock and injected 401/403/429/5xx/timeout, two consumers, lease expiry, crash between proof/write/ack, duplicate delivery. Assert one durable effect, cause-preserving metrics, and no source-yield penalty for infra. Pi controlled acceptance uses seeded isolated triggers/no provider or a bounded approved dependency stub. Rollback pauses consumer while retaining queue; never mark unknown handled. **M**.

### 11.7 R6 — Immutable run ledger, honest diagnostics, redaction

- **Principle/problem:** optimize an end-to-end pipeline with one run-scoped truth, not mixed files/aliases. Support evidence must not expose transports/titles.
- **Evidence / external / confidence:** P1-13/P1-14/P1-15, P2-16/P2-18/P2-20; Prometheus instrumentation/naming, Google SRE pipeline correctness/end-to-end SLO guidance, OTel URL and OWASP logging guidance. Confidence **high**.
- **Expected effect:** makes useful growth/provider cost/publish frequency causal; reduces unsafe operator actions and secret leakage.
- **Smallest shape:** compact SQLite run/stage/funnel/source/publish receipts defined in section 9.2, with one writer transaction and bounded retention. Make diagnostics URI-read-only/query-only and emit `UNAVAILABLE` rather than zero/`ok:true`. Separate raw redacted sample store. Central `redactTransport()` at object/log/HTTP boundaries; restrictive modes and atomic rename for files. Retire or rewrite legacy JSON audit.
- **Acceptance:** golden fixtures reconcile ledger to direct aggregate SQL; missing/corrupt/incomplete/mixed runs fail closed; no status command changes mtimes/pidfiles/locks; property/snapshot tests feed credential-bearing URLs, headers, CR/LF, title IDs and assert no secret/raw history in stdout, HTTP, ops, proof, or fallback. Pi acceptance is read-only parity across two snapshots; cardinality/storage budget measured. Rollback keeps old reports read-only while ledger dual-writes until parity. **M**.

### 11.8 R7 — One scheduler, lock, couch lease, and generation-bound handoff

- **Principle/problem:** all mutation entrypoints need one exclusion and safety contract through restore/downstream capture; defer needs a retry owner.
- **Evidence / external / confidence:** P1-16/P1-17/P1-18/P1-19; systemd persistent timer semantics. Confidence **high**.
- **Expected effect:** prevents overlapping live/staged writes and recommendation-generation races; increases unattended completion without couch disruption.
- **Smallest shape:** route timer/API/manual/overnight through one coordinator/lock; overnight becomes an isolated preset, not direct-live. Check actual playback-active signal and boot grace. Hold a publication lease through restore and generation-bound recommendation enqueue; YouTube remains independently stateful but cannot overlap DB writer phases. Narrow best-effort to “all stages succeeded; only fresh target missed.” Couch defer records `pending` and schedules bounded idle-aware retries using R5's cause-specific, capped policy, safe window, and max attempts; systemd watchdog observes heartbeat lease but alerts before kill.
- **Acceptance:** deterministic state-machine tests for all pairwise entry overlaps, couch becomes active at each boundary, defer/retry across restart, stale lease, malformed JSON, handoff for generation A while B waits. Pi controlled test with provider disabled and disposable DB verifies no couch interruption and one owner. Rollback disables retry/API overnight while timer retains conservative idle behavior. Depends R3/R6. **M**.

### 11.9 R8 — Relative allocation, durable exploration, and real budgets

- **Principle/problem:** YAML weight is relative priority; probation is an explicit evidence state. Work caps must bound costly actions and honor configured pool depth.
- **Evidence / research / confidence:** P1-09/P1-10, P2-01/P2-03/P2-05/P2-06/P2-19; current pool/floor matrix. Garivier and Moulines analyze discounted/sliding-window UCB for non-stationary rewards in the refereed ALT 2011 proceedings ([DOI 10.1007/978-3-642-24412-4_16](https://doi.org/10.1007/978-3-642-24412-4_16)); this is research evidence for time-local learning, **not** a recommendation to deploy UCB now. Confidence high on defects, medium on optimal allocator.
- **Expected effect:** bounded exploration reaches late sources, stops overgrowing anchors, and reallocates calls/probe seconds to deficits. Risk is slower discovery if caps are too tight.
- **Smallest shape:** normalize base weights within rail; separate `learned_multiplier` from `exploration_state`; persist exploration epoch/last sampled; guarantee each resolvable source a bounded minimum across runs. Enforce `remaining_pool=max(0,pool_max-current)` and `grow_target=min(grow_per_pass, remaining_pool, useful deficit)`. Add hard per-run actual request/resolve/probe-second/wall/link caps. Per-entry aging/CAS; carry safe source evidence across failed stage with generation/version.
- **Acceptance:** property tests for allocation conservation, scale invariance, no starvation, config removal, concurrency/CAS, pool cap, and every expensive action consuming budget. Replay frozen run ledger offline first. Pi acceptance is shadow allocation only, then one isolated/capped staged canary with no live weight update. Rollback retains previous versioned vector and policy. Depends R1/R2/R6. **M**.

### 11.10 R9 — Cursor correctness and authoritative theme gate

- **Principle/problem:** continuation is defined by upstream page/continuation, not accepted rows; hard product constraints cannot be bypassed by source label.
- **Evidence / confidence:** P1-11/P1-12, P2-02/P2-09/P2-17. Confidence **high**.
- **Expected effect:** recovers candidates hidden by false exhaustion while improving thematic precision; unknown metadata may defer rather than reject, increasing retry load.
- **Smallest shape:** return `{raw_count, accepted, next_offset/continuation, terminal}` from sources; advance on upstream semantics; commit cursor with durable batch outcome or replay token. Always evaluate metadata hard exclusions/runtime cap; lexical/source evidence affects soft score only; `infra_unknown` receives short retry and no source penalty; consume existing story evidence with provenance. Make rejection reason/TTL update coherent.
- **Acceptance:** full raw page with blocked/malformed/duplicates reaches next page; repeated/empty/continuation fixtures; crash replay; positive source label plus excluded genre/over-runtime fails; metadata error returns unknown; all-link rejection does not leave recommendation-eligible orphan. Pi shadow counts only before staged canary. Rollback preserves old cursor snapshot and previous theme generation. **M**.

### 11.11 R10 — Controlled source portfolio benchmark

- **Principle/problem:** source additions/removals and target changes require causal useful-growth evidence, not stale diagnostics or provider hammering.
- **Evidence / external / confidence:** growth-starved-rail table; missing request/probe denominators. Google SRE's pipeline guidance recommends golden data, end-to-end correctness, staging, small dry runs, and comparing expected with actual ([Google SRE Data Processing Pipelines](https://sre.google/workbook/data-processing/), accessed 2026-08-06). AIOStreams documents that all conditional groups begin fetching in parallel and later results can merely be discarded, so group conditions must not be assumed to save upstream provider work ([AIOStreams Groups](https://docs.aiostreams.viren070.me/guides/groups/), accessed 2026-08-06).
- **Expected effect:** identifies whether India/miniseries/reality/documentary/quick rails need sources, identity repair, cursor repair, or target change while respecting provider limits.
- **Protocol / acceptance:** immutable config+code SHA; cloned isolated test DB and cache; synthetic or operator-approved redacted title set; fixed per-source request and probe-second budget; randomized/balanced source order; main-only proof; exact funnel and final consumer-eligible logical set; repeat windows; confidence intervals and provider-cause exclusions. Compare current policy, repaired relative allocation, and candidate sources. No live weight/cursor/rejection/cache writes. Promotion criteria are section 7.7. Rollback is discarding the isolated experiment. Controlled Pi execution is allowed only after R1-R9, against an isolated DB/cache and explicit provider budget, with no live-state writes. Confidence **medium** because the measurement defects are proven but source-quality effects are not. Depends R1-R9. **M**.

## 12. 30/60/90 plan and next three changes

### Days 0-30 — make proof and publication trustworthy

1. Implement R1's exclusive worker lease and collision/cancellation suite.
2. Implement R2's request/proof types, identity fences, main-only durable write, and error-cause model behind a staged schema/feature boundary.
3. Implement R3's validated same-filesystem publication generation, previous-generation rollback, and structured receipt; fault-inject locally before any Pi use.
4. Land the centralized URL/error redactor and negative privacy snapshots from R6 because existing paths can expose credentials.
5. Add the highest-risk regression cases: exact-series fallback, mixed meta identity, batch/direct chronology, Browse demotion, and publication interruption.

**30-day exit:** all P0 tests pass deterministically; no last-resort/picker/unknown result can increment verified; every probe has exclusive token ownership; every publish resolves to old or new validated DB after injected interruption; no credential-bearing fixture survives serialization. No provider/source/target change is allowed in this phase.

### Days 31-60 — make lifecycle, orchestration, and evidence coherent

1. Implement R4's central consumer eligibility fence and cache invalidation.
2. Implement R5's cause-preserving resolver cache and trigger lease/retry/dead-letter state.
3. Implement the R6 run ledger and rewrite `grow_monitor status`, source audit, SLA/rail health, and playability status against one read-only authoritative snapshot. Dual-read historical artifacts without treating them as current.
4. Route timer/API/manual/overnight through R7's coordinator; hold generation ownership through restore and exact VOD handoff; add bounded couch-idle retry and heartbeat lease alert.
5. Controlled Pi canary only after local gates: disposable/staged DB, provider disabled or strictly budgeted, exact SHA/readback, then persisted proof and human couch identity sample.

**60-day exit:** Reliability can independently state last attempt, defer, publish, coordinator completion, consumer readback, and proof SHA; no overlapping writer path exists; strict consumers serve zero failed/expired/non-main rows; deferred work has a bounded retry owner.

### Days 61-90 — improve useful growth under a measured budget

1. Implement R9 raw continuation/cursor semantics and authoritative hard theme checks; replay frozen fixtures and ledgers.
2. Implement R8 relative weights, explicit durable exploration, per-entry aging/CAS, pool cap, and actual request/probe/wall budgets in shadow mode.
3. Run R10's isolated portfolio benchmark for weak rails. Compare current and repaired policies; do not mutate live source state.
4. Promote only improvements meeting section 7.7; canary one change class at a time. Refresh docs from executable definitions and generated config schema.

**90-day exit:** each source and rail has a reproducible useful-title/request/probe-second estimate; every configured resolvable source receives bounded exploration; no active pool exceeds its chosen cap unless the cap is explicitly retired; the five weak rails have either a measured recovery plan or an evidence-backed target/source change.

### Next three implementation-ready changes

1. **`probeUrlViaPool` machine-wide exclusive lease:** bounded worker queue, cross-process worker lock, attempt token, poison/recreate, and two-callers/four-tasks/three-workers deterministic test (R1).
2. **Immutable `VerificationRequest`/`ProofDecision`:** carry exact identity and cause; gate every durable verified write on `main_win && identity_match`; add exact-series/picker/error fixture table (R2).
3. **Validated publication generation:** quiesce writers, close/check SQLite, create and validate a unique immutable generation, atomically switch a selected-generation pointer, retain the previous validated generation, perform URI-RO publication-ID readback, then emit the handoff receipt; crash-injection harness (R3).

These three require no new source portfolio decision and can be handed to implementation agents in this order.

## 13. Rejected shortcuts

| Shortcut | Why rejected |
|---|---|
| Raise `grow_per_pass`, wall time, resolver concurrency, or probe concurrency | Current caps do not count costly actions, worker isolation is unsafe, and anchors already exceed pool cap by hundreds/thousands. It would amplify provider cost and false proof. |
| Weaken India/reality/miniseries/quick/documentary themes | Thin evidence mixes allocator, pagination, identity, outage, and theme defects. Weakening theme would trade product correctness for a count. |
| Persist last-resort, obligation, or picker wins as verified | Immediate fallback availability is not durable title proof. It directly violates the main-ladder invariant. |
| Treat physical `titles.status=verified` delta as useful unique growth | Episode-shaped rows, cross-rail membership, expiry, theme orphan, and main provenance make it an upper bound only. |
| Reset/delete live DB, caches, rejections, weights, cursors, logs, or proof history to get a neutral baseline | Destroys operator evidence and can make a benchmark look artificially fresh. Use cloned isolated state. |
| Run `source-hitrate.py`, refresh providers, or probe a large title set during audit/diagnosis | It calls providers/mpv and writes artifacts. This audit forbade it; future work needs a fixed budget and isolated cache/DB. |
| Trust `source-grow-audit.py ok:true`, `wasted_candidate_ratio`, monitor “fresh,” or rail “nights” | Their authority/denominator/window semantics are invalid for promotion decisions. |
| Add/remove sources based on current decayed counters alone | Actual requests/probes and cause-separated outcomes are unavailable; YAML floor/cursor order confound source quality. |
| Assume AIOStreams conditional groups save upstream calls | Official docs say all groups begin fetching in parallel and later results may only be discarded. Measure actual requests. |
| Disable couch-idle checks or run overnight direct-live to avoid deferral | Violates 10-foot appliance safety and staged isolation. Add a bounded idle-aware retry instead. |
| Automate AIOMetadata sync inside every grow | Current helper can mutate operator config and expose secrets before safety gates. Split into explicit secret-safe prerequisite. |
| Auto-kill a hung grow from heartbeat age now | Abort/cleanup and publish failure recovery are not deterministic. Alert first; automate termination only after crash tests. |
| Call local/Pi test success couch proof | Tests and API health cannot observe title identity, audio/video, controller focus, target-TV mode, or sustained playback. |

## 14. Commands, tests, and external sources

### 14.1 Identity and source investigation

The required identity commands were run before audit actions:

```bash
git branch --show-current
git rev-parse HEAD
git rev-parse origin/feat/native-experience
git status --short
git log -20 --oneline --decorate
```

Result: correct branch; HEAD and existing origin ref both `4a17519723c4fd3c2de3d19a6e52e80b22437b23`; initial dirt was the four named untracked task files. The later task-index/codebase-health changes recorded in section 2.1 appeared concurrently and were preserved untouched. No fetch, switch, commit, or push. Read-only `git log/show/blame/diff`, `rg`, and file reads traced history and all relevant source/config/docs/tests. No Ruff command was invented because the subsystem has no Ruff contract.

### 14.2 Local verification

```bash
XDG_CACHE_HOME="${TMPDIR:-/tmp}/mango-playability-audit-cache" \
  npm --prefix src/catalog-service test
```

Exit 0; build passed; TAP: **920 tests, 920 pass, 0 fail**, 20,810.715 ms.

```bash
python3 -m unittest discover -s scripts/diag -p 'test_grow_monitor.py' -v
python3 -m unittest discover -s scripts/diag -p 'test_ops_grow_sla.py' -v
python3 -m unittest discover -s scripts/diag -p 'test_source_hitrate_preflight.py' -v
python3 -m unittest discover -s scripts/diag -p 'test_merge_failed_grow_memory.py' -v
python3 -m unittest discover -s scripts/diag -p 'test_grow_run_state.py' -v
python3 -m unittest discover -s scripts/diag -p 'test_extract_refresh_json.py' -v
python3 -m unittest discover -s scripts/diag -p 'test_rail_health.py' -v
```

All exited 0: respectively **22, 10, 5, 2, 2, 4, and 6 tests** = **51/51**.

```bash
bash scripts/m3-play/playability/gate-m3-library-grow.sh
```

Exit 0; ended `N3c library grow gate ok`; reran the full 920-test suite (920 pass, 0 fail, 20,817 ms), monitor 22, SLA 10, and shell assertions. These are local modeled-behavior results only.

### 14.3 Pi evidence and diagnostic execution disclosure

The initial smoke and identity commands succeeded:

```bash
bash scripts/pi-exec.sh 'true'
bash scripts/pi-exec.sh 'cd ~/mango && git branch --show-current && git rev-parse HEAD && git status --short'
```

The retained command ledger for §3.4 read surfaces is:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && systemctl --user list-timers mango-playability-indexer.timer --all --no-pager'
bash scripts/pi-exec.sh 'systemctl --user show mango-playability-indexer.service -p ActiveState -p SubState -p Result -p ExecMainStatus -p NRestarts -p InvocationID --no-pager'
bash scripts/pi-exec.sh 'systemctl --version'
bash scripts/pi-exec.sh 'journalctl --user -u mango-playability-indexer.service --since "-30 days" --no-pager'
bash scripts/pi-exec.sh 'cd ~/mango && python3 scripts/diag/playability-status.py'
bash scripts/pi-exec.sh 'curl -fsS http://127.0.0.1:3020/health'
bash scripts/pi-exec.sh 'curl -fsS http://127.0.0.1:3020/reliability/state'
bash scripts/pi-exec.sh 'curl -fsS "http://127.0.0.1:3020/reliability/proofs?limit=20"'
```

Two additional commands were executed once because the contract explicitly listed them. **Contract-listed does not mean mechanically strict-read-only or privacy-safe; do not rerun or export their complete output.** `source-grow-audit.py:112` opens SQLite through a default read/write-capable connection. The exact `ops-report.py --json` path did not use its `--reconstruct` SQLite branches (`ops-report.py:372-405`) and was file-only, but it emits whole existing events/reports that can contain title/error-bearing payloads.

```bash
# HISTORICAL EXECUTION RECORD ONLY — DO NOT RERUN OR EXPORT WHOLE OUTPUT
bash scripts/pi-exec.sh 'cd ~/mango && python3 scripts/diag/source-grow-audit.py --json'
bash scripts/pi-exec.sh 'cd ~/mango && python3 scripts/diag/ops-report.py --json'
```

Both completed; `source-grow-audit.py` used SELECTs in the inspected DB path and no content-changing SQL was observed. That is weaker than a connection-level no-mutation proof for that invocation. The artifact files themselves were not transferred wholesale, but both diagnostics streamed stdout over SSH into the audit execution session (`scripts/pi-exec.sh:32-36`). Off-Pi retention of that raw tool output was not independently audited. Only aggregate/sanitized fields are reproduced in this report. The systemd journal command returned zero entries. `source-grow-audit.py` is explicitly rejected as authoritative in sections 7 and 9.

Supplementary readbacks captured the installed unit text and `ExecMainStartTimestamp`/`ExecMainExitTimestamp` fields used in sections 2 and 8, but their exact additional `systemctl cat/show` command strings were not retained. Command-text reproduction for those fields is therefore **UNAVAILABLE** rather than reconstructed. The observed unit values and timestamps remain bounded PI-LIVE readbacks with that reproducibility limitation; the checked-in installer at `scripts/m3-play/playability/install-playability-timer.sh:47-92` independently supports the source configuration.

`grow_monitor.py status --json` was **not run** after source inspection showed that “status” unlinks stale pidfiles and opens the maintenance lock `a+` (`grow_monitor.py:245-260,300-315,346-361`). This is **DEFERRED**, not missing-zero evidence.

Direct aggregates used one connection beginning with:

```python
db = sqlite3.connect("file:/etc/mango/playability.db?mode=ro", uri=True)
db.execute("PRAGMA query_only=ON")
db.execute("PRAGMA quick_check")
```

The connection was closed without `VACUUM`, checkpoint, init/migration/indexer CLI, or write-capable API. Queries emitted only counts/distributions/timestamps: schema/migrations; physical/logical titles; expiry; memberships; orphan shapes; verify outcomes/latency; rejection reasons; triggers; source weights/outcomes/cursor counts; stream evidence; recommendation/Browse generations; session status; and file sizes. A second URI-RO script parsed active reservoir payloads internally and emitted status counts only—no title ID, title, URL, or row. Runtime YAML inspection emitted SHA/config controls/counts only.

The exact one-off SSH/heredoc wrapper text for those aggregate scripts was not retained, and the retained preamble does not prove an explicit `BEGIN`; command-text replay and cross-query snapshot atomicity are therefore **UNAVAILABLE** rather than reconstructed after the fact. Each value below is bound to the same URI-RO capture window, but separate queries are not claimed to share one SQLite snapshot. The query boundaries and formulas that produced every headline aggregate were retained and are reproducible against a safely cloned DB or a URI-RO connection:

| Claim | Exact query or formula | Bound artifact/window | Observed output |
|---|---|---|---|
| Schema/integrity | `PRAGMA query_only=ON; PRAGMA quick_check; SELECT MAX(version) FROM playability_migrations;` | `/etc/mango/playability.db`, URI `mode=ro`, 2026-08-06T22:54Z | `ok`; schema 17 |
| Physical verified | `SELECT COUNT(*) FROM titles WHERE status='verified';` | same connection, 2026-08-06T22:59:42Z | 10,017 |
| Logical verified | `COUNT(DISTINCT (type, canonical_id))`, where `canonical_id = re.sub(r'^(tt\d+):\d+:\d+$', r'\1', id, flags=re.I)` only for `type='series'`; rows were processed internally and only the count emitted | same URI-RO capture window | 9,904 |
| Episode-shaped verified orphan | count rows where `status='verified'`, `type='series'`, `re.fullmatch(r'tt\d+:\d+:\d+', id, re.I)`, and no exact `(type,id)` exists in `rail_pool` | same URI-RO capture window | 113 of 113 episode-shaped verified rows |
| Due verified | `SELECT COUNT(*) FROM titles WHERE status='verified' AND expires_at IS NOT NULL AND expires_at<=1786057182000;` | capture epoch = 2026-08-06T22:59:42Z | 282/10,017 = 2.82% |
| Per-rail V/S and pool excess | join `rail_pool rp` to `titles t` on exact `(type,id)`; group by `rail_id`; sum `t.status='verified'` and `t.status='stale'`; `excess=max(0, verified+stale-120)` | same URI-RO capture window; loaded `pool_max=120` | all 12 rails over max; excess 293-1,583 |
| Active Browse rows | sum `candidate_count` from `vod_browse_reservoir_generations_v3` joined through each `vod_browse_active_reservoirs_v3.active_generation_id`, restricted to `state='ready'` | same URI-RO capture window | 19,951 = 11,920 Movies + 8,031 Series |
| Aug 6 `verify_log` window outcomes | `SELECT outcome,COUNT(*) FROM verify_log WHERE started_at BETWEEN 1786017096897 AND 1786021412130 GROUP BY outcome;` | timestamp window matching the `3ffda16` payload, 2026-08-06T11:51:36.897Z-13:03:32.130Z; no `run_id` binding | 526 rows; may repeat titles or include other stages/writers: verified 155, no_stream 231, timeout 70, probe_failed 66, status_clip 4 |
| Physical run rate | `(unique_verified_after-unique_verified_before)/(duration_ms/60000)` = `(10017-9862)/(4315233/60000)` | same `3ffda16` payload | 2.1552/min, reported 2.16/min |
| YAML equality | SHA-256 bytes of checked-in `config/catalog.example.yaml` and loaded `/etc/mango/catalog.yaml`; no YAML values or manifest URLs emitted | local and Pi `4a17519`, 2026-08-06T23:00:54Z | both `1ae9059f208832405936f6376c1f44ec0f86eea1a9464f73f22aae8ce94e2623` |
| Neutral/locked allocation | per configured ref, `effective(w,m)=max(0.08,w*m)`; neutral iff `effective(w,1)<=0.08`; locked iff `effective(w,2)<=0.08`; current floor substitutes the SQLite `multiplier` joined by `(rail_id,source_key)` | byte-equal YAML + same URI-RO SQLite capture window | 188 refs; 132 neutral; 99 locked; per-rail current values in section 7.1 |
| Immediate run/proof chronology | refresh payload end `13:03:32.130Z`; existing grow log line 291972 at 06:03:35 PDT; proof JSONL line 79 timestamp `13:06:37.313Z`, commit `3ffda16`; systemd exit timestamp 06:06:39 PDT/status 1 | named existing artifacts only | publish returned before proof and coordinator failure; not audit-SHA proof |

The Pi version readback was `systemd 257 (257.13-1~deb13u1)` during the same 2026-08-06T22:48Z-23:00Z evidence window; the external manual sources below are pinned to upstream tag v257. Because the aggregate wrapper text was not retained, future audit tooling should store a redacted query manifest and result hash without raw title/URL rows.

### 14.4 External sources actually read

Access date for every row: **2026-08-06**.

| Source | Authority / date | Exact claim used | Mango-specific mapping |
|---|---|---|---|
| [Stremio Addon Protocol](https://stremio.github.io/stremio-addon-sdk/protocol.html) | Stremio project; update date not displayed | Catalog/meta uses item ID; stream uses video ID; a series meta can contain multiple videos. | Preserve canonical show and exact episode identity separately through proof. |
| [TMDB Movie External IDs](https://developer.themoviedb.org/reference/movie-external-ids), [TV External IDs](https://developer.themoviedb.org/reference/tv-series-external-ids), and [Movie Search](https://developer.themoviedb.org/reference/search-movie) | TMDB official developer docs; pages displayed “Updated 10 months ago” at access | Movie/TV external-ID endpoints map a TMDB object to external IDs; text search exposes title/year evidence. | Resolve known `tmdb:` IDs through the type-correct external-ID endpoint; use text search only with explicit type/year/title checks. |
| [mpv stable manual](https://mpv.io/manual/stable/) | mpv project; update date not displayed | `loadfile replace` returns before current stop/new load completes. | Require exclusive worker lease and command/event correlation. |
| [SQLite Online Backup API: finish semantics](https://www.sqlite.org/c3ref/backup_finish.html) | SQLite project; update date not displayed | Backup holds a destination write transaction; reaching `SQLITE_DONE` commits, while `sqlite3_backup_finish()` rolls back a handled incomplete copy. | Do not claim an ordinary handled incomplete backup leaves a partial DB; add validated generation/readback/rollback evidence for process death, I/O, checkpoint, and selection boundaries. |
| [SQLite WAL](https://www.sqlite.org/wal.html) | SQLite project; update date not displayed | WAL is persistent DB state; readers can block reset and sustained readers can grow WAL; sidecars must not be separated casually. | Record checkpoint result/bytes and stop manual sidecar deletion. |
| [SQLite `query_only`](https://www.sqlite.org/pragma.html#pragma_query_only) | SQLite project; update date not displayed | `query_only` blocks data-changing SQL but is not truly read-only and can still checkpoint. | Pair diagnostic URI `mode=ro` with `query_only=ON`. |
| [systemd.timer v257 source](https://github.com/systemd/systemd/blob/v257/man/systemd.timer.xml) and [systemd.service v257 source](https://github.com/systemd/systemd/blob/v257/man/systemd.service.xml) | systemd project, tag v257; matches observed Pi systemd 257 | `Persistent=true` can catch up a missed calendar event when activated; service runtime limits depend on service timeout settings. | Expect boot/daytime catch-up, and treat the installed oneshot's unbounded runtime plus missing defer owner as Mango policy choices requiring a couch-safe bounded retry/lease. |
| [RFC 9110: HTTP Semantics](https://datatracker.ietf.org/doc/html/rfc9110) | IETF Internet Standard, June 2022 | 401 lacks valid credentials; 403 refuses and should not repeat same credentials automatically; 503 is likely temporary and may provide Retry-After. | Do not cache all dependency failures as clean no-stream/content miss. |
| [RFC 6585 §4: 429 Too Many Requests](https://datatracker.ietf.org/doc/html/rfc6585#section-4) | IETF Proposed Standard, April 2012 | 429 identifies rate limiting, may include `Retry-After`, and must not be stored by a cache. | Persist bounded scheduler/circuit state rather than a cached 429 response or content miss; parse/cap `Retry-After`. |
| [AIOStreams Groups](https://docs.aiostreams.viren070.me/guides/groups/) | AIOStreams official docs; date not displayed | All groups start fetching in parallel; later groups/results can be skipped/discarded after conditions resolve. | Conditional groups are latency/result policy, not proven provider-call savings. |
| [Prometheus Instrumentation](https://prometheus.io/docs/practices/instrumentation/) and [Naming](https://prometheus.io/docs/practices/naming/) | Prometheus project; current docs | Batch jobs need last success/stage duration/completion/records; failures need attempt denominator; timestamps over ages; control label cardinality. | Defines the compact run/funnel/receipt metric contract. |
| [Google SRE: Monitoring](https://sre.google/workbook/monitoring/) and [Data Processing Pipelines](https://sre.google/workbook/data-processing/) | Google SRE Workbook; page date not displayed | Observe dependency latency/errors; measure end-to-end pipeline SLO; use golden data, staging/small dry runs, and expected-vs-actual correctness. | Run isolated benchmark and publication-to-consumer receipts, not stage-only success. |
| [OpenTelemetry URL semantic conventions](https://opentelemetry.io/docs/specs/semconv/url/) | OTel semantic conventions 1.44.0 | Never record URL user/password; scrub known sensitive query values. | Redact stream transports before logs, HTTP errors, ops, and artifacts. |
| [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | OWASP; update date not displayed | Tokens/passwords/connection strings/secrets should be removed/masked/sanitized/hashed/encrypted; sanitize event data. | Central redactor and privacy snapshot tests. |
| [Garivier & Moulines, “On Upper-Confidence Bound Policies for Switching Bandit Problems”](https://doi.org/10.1007/978-3-642-24412-4_16) | Refereed ALT 2011 proceedings, Springer, pp. 174-188 | Discounted and sliding-window UCB address piecewise-changing reward distributions. | Supports time-local shadow research only; Mango lacks a valid reward ledger for deployment. |

Standards versus examples are intentionally separated: RFC 9110 is an Internet Standard and RFC 6585 is a Proposed Standard; Stremio/mpv/SQLite/systemd/TMDB/OTel are protocol/product specifications or official guidance; Prometheus/Google/OWASP/AIOStreams are mature guidance/examples; Garivier-Moulines is peer-reviewed research. Mango source and timestamped runtime state remain product truth.

## 15. Deferred to human or controlled environment

| Missing evidence | Status and exact reason | Safe future evidence owner / method |
|---|---|---|
| Exact-revision controller/TV title identity, audio/video, sustained playback | **DEFERRED** — no couch observer; API/local/Pi DB cannot see it. | Human runs `docs/COUCH_TEST.md` only after an authorized exact-SHA deploy/readback and Pi gate; record requested title/episode, visible/audible identity, 8BitDo controls, target TV mode, and sustained playback. |
| Exact-SHA persisted Pi gate/proof | **DEFERRED** — current live state was generated at audit SHA, newest persisted proof was older SHA/yellow. Running proof/gate can write evidence and probe playback, prohibited here. | Authorized operator runs already-reviewed Pi gate/proof on selected read-back SHA; retain proof ID/SHA. |
| 30-day timer/service success frequency | **UNAVAILABLE** — requested user journal returned zero entries; ops/proof histories do not distinguish every absence. | Configure/verify journal retention prospectively; immutable run ledger from R6. Do not reconstruct missing nights as failures. |
| `grow_monitor status` Pi view | **DEFERRED** — source mode mutates stale pidfiles/lock. | First implement a no-side-effect URI-RO status path and test mtimes/locks; then run. |
| Actual provider/catalog requests, resolves, probe attempts, per-source cost | **UNAVAILABLE** — no current counters; provider probing prohibited. | R6 ledger, then R10 isolated benchmark with fixed request/probe-second budget. |
| Useful logical titles added by Aug 6 run | **UNAVAILABLE** — artifact records physical delta but not before/after canonical cohort or main proof provenance. | Future run receipt stores canonical new cohort and final eligible intersection. Never infer by subtracting current totals across unrelated windows. |
| Root cause for each failed/missed candidate | **UNAVAILABLE** — current counters mix content, infra, theme, active TTL, and decayed windows; raw rows intentionally excluded. | Typed cause ledger and redacted controlled replay; no raw title history in report. |
| Whether source refs absent/late in process-local probation would yield useful titles | **DEFERRED** — allocation starvation is proven; source quality is not. | R10 balanced isolated shadow benchmark after R1/R2/R6. |
| Publication behavior under power loss, I/O error, busy reader, SIGKILL, disk full | **DEFERRED** — destructive fault injection is inappropriate on live Pi. | Local disposable filesystem/DB harness, then disposable Pi path only; assert old-or-new validated generation. |
| Current 282 due titles after a sweep | **DEFERRED** — sweep mutates live DB and was prohibited. | After R4, controlled maintenance then read-only status and cache/session invalidation checks. |
| Provider auth/rate-limit state | **DEFERRED** — no provider calls or secret inspection. | Cause-preserving dependency health under explicit operator-approved bounded test; redact all transport/auth fields. |
| AIOMetadata mutation/output safety | **SOURCE-CONFIRMED RISK; runtime effect deferred** — helper was not run and operator config was not inspected. | Refactor/test helper with stub endpoint, unique mode-0600 temp, redacted output, explicit opt-in; human reviews before automation. |
| Current addon-resolved source availability per ref | **PARTIAL** — health reported eight addons and config/SQLite source parity, but no provider/manifest probe was allowed. | New read-only, secret-redacted manifest inventory that reports only configured/resolved/missing counts at config hash. |
| Target-TV 4K/HDR/decode/drop-frame behavior | **DEFERRED** — outside title-growth source/local/Pi aggregate proof and no TV observation. | Exact hardware gate and couch observation; do not infer from advertised specs. |

### Completion check

- S1-S8 are complete at source/local scope; runtime and couch gaps are explicitly deferred.
- Branch remained `feat/native-experience`; no switch/fetch/commit/push/deploy/refresh/provider probe occurred.
- No content-changing SQL, API mutation, provider call, refresh, probe, deploy, or intentional runtime-state change was observed. One contract-listed diagnostic, `source-grow-audit.py --json`, used a read/write-capable default SQLite connection for SELECTs, so strict connection-level no-mutation proof is unavailable and is disclosed in sections 9.3 and 14.3. `ops-report.py --json` was file-only without `--reconstruct`, though its output is privacy-sensitive.
- This report is the only auditor-created/edited file.
- Current, local, Pi-live, historical, couch, derived, and deferred evidence are kept distinct.
- No secret, manifest URL, raw title/candidate row, or private viewing history is included.
