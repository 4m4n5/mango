# Playback hardening implementation report

## Baseline

- Branch: `feat/native-experience` (verified; no branch switch)
- Commit: `5d3f9b4f6746644a21d3a7a329c216bdcf8867bf`
- Initial working tree: clean except untracked operator-supplied `PLAYBACK_HARDENING_CODEX_SPEC.md`
- Constraints honored: work-Mac only; no SSH, Pi wrappers, commit, push, dependency addition, pad/input change, or production P2 tuning.

Finding closure by workstream: S1 closed #1 and #8; S2 closed #2 and #6 and instrumented #21; S3 closed #3, #7, #13, and #14; S4 closed #4, #5, #9, and #12; S5 closed #10, #11, and #16; S6 closed #15 and #20; S7 closed #17–#19 and completed measurement-only work for #21. Pi runtime confirmation remains deferred, so “closed” here means implemented plus locally regression-tested—not deployed hardware proof.

### Clean baseline verification

| Command | Result |
|---|---|
| `cd src/catalog-service && rm -rf dist && npm test` | PASS — 542 tests, 0 failures, 0 skipped |
| `cd src/launcher && npm run build` | PASS — TypeScript + Vite build |
| `PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests` | PASS — 83 tests |
| `bash -n scripts/m2-catalog/service/mpv-play.sh scripts/m2-catalog/service/mpv-stop.sh scripts/lib/couch-activity.sh scripts/lib/restore-launcher-after-playback.sh` | PASS |

## Independent reviewer addendum — final handoff tree

The original implementation was not accepted unchanged. Independent review corrected:

- stream-flight deadline partitioning and invalidated-flight cache races;
- cancellation epoch write races and request-registry cleanup races;
- stale PID teardown, background ownership, and process-group safety;
- deferred VOD audio restore and foreground handoff cancellation races;
- persistent probe-pool couch ownership and missing duration output;
- verified hints bypassing fresh duration safety probes;
- proxy/direct/live deadline mismatches;
- unsafe generic release fingerprints and unbounded main ladder policy;
- unnecessary global detail-page cancellation;
- architecture/playability documentation and source-gate drift.

Final independent verification after these corrections:

| Command | Result |
|---|---|
| `cd src/catalog-service && npm test` | PASS — 602 tests, 0 failures, 0 skipped |
| `cd src/catalog-service && npm run test:gate` | PASS — 277 tests, 0 failures, 0 skipped |
| `cd src/launcher && npm run build` | PASS |
| `PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests` | PASS — 83 tests |
| `bash scripts/m6-ship/gate-m6-ux-smoke.sh` | PASS — 2 expected off-Pi warnings |
| source-only `gate-m6-playback-ssot.sh` | PASS — 3 expected off-Pi warnings |
| touched shell syntax and `python3 -m py_compile src/mango-ui-server/serve.py` | PASS |

The Pi/runtime checklist remains deferred exactly as documented below.

## S1 — Deadline, cancellation, and epoch semantics

Implemented the P0/P1 request-lifetime contract:

- Added one 85,000 ms absolute server deadline at `POST /play` ingress and capped nested resolve/ladder/probe/play budgets to its remaining time.
- Raised only the Python proxy play upstream timeout to 90 s; retained the launcher watchdog at 95 s.
- Added request-ID-scoped, idempotent cancellation so launcher timeout/abort supersedes only its own server play epoch.
- Made epoch generation monotonic and guarded post-PASS verification, demotion, library, watch, and progress mutations against superseded requests.
- Preserved the existing obligation-floor phase inside the absolute deadline.

Focused evidence: catalog build PASS; deadline/cancel/request-registry/orchestrator tests PASS as part of the 31-test S1/S2 loop below.

## S2 — Foreground ownership and request-class concurrency

Implemented foreground ownership and resolve isolation:

- `couch-activity.sh` and the trigger consumer treat a live tracked mpv PID plus its Unix socket as hard non-idle regardless of timestamp age; orphan markers/sockets do not block maintenance.
- `mpv-play.sh` now acquires an atomic playback ownership lock before replacement. Background probes return exit 75 with `DEFERRED` before stop/activity/display/launcher operations when couch playback owns mpv.
- Normal `mpv-stop.sh` teardown targets only Mango's PID file/socket/process group; the global `pkill -x mpv` path was removed.
- Stream single-flight keys include request class and stable retry/cross-probe behavior, but not per-request absolute timestamps. Foreground bypasses a background flight; equivalent concurrent callers coalesce.
- Added deterministic counters for joins, bypasses, provider fan-out count/time, alias probes, rate-limit classification, and ownership deferral. No concurrency or cache threshold changed.

Focused command:

```text
cd src/catalog-service && npm run build && node --test \
  dist/play-deadline.test.js dist/play-cancel.test.js \
  dist/play-request-registry.test.js dist/stream-flight.test.js \
  dist/resolve-metrics.test.js dist/playback-ownership.test.js \
  dist/playability/trigger-consumer.test.js dist/play-orchestrator.test.js
bash -n scripts/m2-catalog/service/mpv-play.sh \
  scripts/m2-catalog/service/mpv-stop.sh scripts/lib/couch-activity.sh
```

Result: PASS — 31 tests, 0 failures, 0 skipped; shell syntax PASS. The scoped-stop fixture proves an unrelated process survives, and the background-probe fixture proves deferral occurs before the mpv invocation header.

## S3 — Provider, ladder, language, quality, picker, and 4K policy

Closed the provider and selection-policy findings:

- Removed AIOStreams' all-debrid uncached exclusion while retaining the Real-Debrid service exclusion. A deterministic OR-semantics validator proves uncached TorBox survives and uncached Real-Debrid does not.
- Threaded hard language through main, last-resort, display, verify, and obligation floor; threaded preferred language as scoring-only reorder.
- Preserved explicit request identity for min/max quality and remux overrides, and applied those constraints consistently to display, automatic play, and floor without converting loaded legacy preferences into global request caps.
- Restricted prepare/drift/verify selection to `main_ladder`; updated the ladder diagnostic to report main and last-resort partitions separately.
- Picker now prefers the explicit `prefer_ladder_step`, attempts one URL, and passes the same step to mpv.
- Added `require_hevc: true` to affected verified 4K examples and validation that rejects any main 4K step without it.
- Added thin-supplement coverage proving unknown metadata cannot enter a verified 4K step.

Focused command: clean catalog build plus nine S3 test files (`aiostreams-policy`, filter-config policy, filters, ladder, orchestrator, thin supplement, verify, bonus resolve, and core resolve).

Result: PASS — 105 tests, 0 failures, 0 skipped.

## S4 — Bounded preflight/probe and deferred mpv policy

Implemented bounded classification and startup policy:

- Preflight now retains at most the configured Range prefix and cancels the body when enough bytes arrive, including Range-ignored 200 responses.
- HTTP 429, 5xx, and other non-success statuses are classified before content sniffing. Only strong NFO signatures return `nfo`; generic HTML/text remains a non-garbage error. HLS and media signatures remain playable.
- Main and persistent-pool probe PASS output now include duration captured before teardown. Plausibility checks consume that structured result, and verified hints remain ranking-only rather than bypassing a fresh safety probe.
- The shell deadline begins before ownership/ffprobe. ffprobe uses a subprocess timeout capped to remaining budget. The Node wrapper uses a detached per-request process group with a 2 s outer cleanup allowance and consumes output after exact group termination.
- Immediate and deferred VOD now share GPU/profile, tone-map, audio-channel, subtitle/blend, cache/readahead, swap, HUD, and resume startup helpers. Deferred handoff still performs hide/black, HDMI match, then real VO/AO/fullscreen activation.
- Strengthened the playback SSOT gate with structural assertions for the shared startup helpers.

Focused result: PASS — 59 tests, 0 failures, 0 skipped; `mpv-play.sh` and the playback SSOT gate pass `bash -n`. Fixtures cover bounded 200 bodies, HTTP/NFO/HLS classification, structured duration, 12-minute movie rejection, relaxed bonus duration, shared 1080p/4K policy arguments, hung ffprobe, and scoped hung-child cleanup.

The first direct SSOT gate run failed only its live idle-HDMI check because this Mac has no `xrandr` display. I added an explicit `MANGO_GATE_SOURCE_ONLY=1` mode that warns rather than claiming runtime HDMI evidence; the source-only gate then PASSed with 2 explicit warnings (`idle HDMI runtime enforcement deferred`, `CanFreeze=unknown`). Pi runtime evidence remains deferred.

## S5 — Play-first verification, invalidation, and failure memory

Removed synchronous provider amplification from couch play and tightened state memory:

- Couch play no longer runs drift verification, trigger draining, inline full verification, or a second resolve. It reads an existing DB hint, performs one user-class resolve, then plays.
- Prepare, drift, and verify use `main_ladder` and background request class.
- Stored verification identity now prefers service-scoped infoHash or a hash-bearing binge-group release token, with signed URL hash as fallback. Generic long binge-group tokens do not merge distinct releases.
- Added `CatalogCore.invalidateStreams(type,id)` to clear only matching positive, negative, and in-flight handles. Confirmed play failure and manual invalidation call it; transient misses do not.
- Confirmed garbage is remembered by service-scoped stable release plus URL. Transient/network/rate-limit picker failures are not release-wide cached.
- Added explicit `win_on_main` assertions for main, last-resort, obligation-floor, and picker outcomes.

Focused result: PASS — 60 tests, 0 failures, 0 skipped. The first focused run exposed an over-broad generic binge-group identity; it was corrected to fall back to URL unless the group contains a release-specific token, then the full S5 loop passed.

## S6 — Playback return and next-episode UX

Repaired the existing return path without changing couch navigation:

- Playback return now flushes progress before refreshing an already-mounted series detail. The refresh reloads episode/global resume truth in place, preserves the snapshot episode/season, suppresses asynchronous episode auto-focus, and focuses Play only after the reload settles.
- A detail restored from a snapshot still uses the existing view and focus contract; no new modal, route, or navigation behavior was added.
- Direct next-episode play now saves the same series/episode return snapshot as normal detail play and carries an `AbortController` through `playCard`. Dismissal invalidates the play token, aborts the request, invokes request-ID-scoped server cancellation through the existing API, and removes a snapshot for a play that did not start.
- Next-episode failures retain the existing `playErrorMessage` mapping and are surfaced through the existing non-focusable toast. Routine status text is not promoted to a new global status UI.
- Replaced unverified timer narration (`trying alternate release`, `caching stream on TorBox`, and `trying best match`) with neutral elapsed-time copy.
- Strengthened `gate-m6-ux-smoke.sh` with source contracts for refresh-before-focus ordering, neutral slow copy, direct-next snapshot/cancellation, and toast wiring.

Focused commands:

```text
cd src/launcher && npm run build
bash -n scripts/m6-ship/gate-m6-ux-smoke.sh
bash scripts/m6-ship/gate-m6-ux-smoke.sh
```

Result: PASS — launcher TypeScript/Vite build; UX source/dist contracts. The gate emitted 2 explicit expected work-Mac warnings: launcher HTTP was not running and `mango-tv-pad` was not running. Real couch focus, episode completion, and cancellation behavior remain in the deferred Pi checklist rather than being claimed locally.

## S7 — Observability, documentation, and build hygiene

Implemented truthful diagnostics and deterministic build/gate behavior without changing any production tuning:

- Replaced the display response's synthetic all-zero exclusions with real `filterAndRankStreams` rejection counts plus unique stage populations for raw, integrity-safe, main, last-resort, and obligation-floor candidates. A fixture with title mismatch, 4K HDR/quality loss, and hard-language loss asserts non-zero truthful counters and exact stage counts.
- Added structured JSON playback telemetry for request ID/epoch/deadline/class, provider fan-out count/time, flight join/bypass, alias probes, ladder step/result class, targeted cache invalidation, and foreground/background ownership deferral. The telemetry helper drops URL/token/credential/userData/secret-named fields; no signed URLs or provider configuration are logged.
- Kept resolve concurrency, cross-probe limits, cache TTLs, and attempt budgets unchanged. Pi tuning remains contingent on captured fan-out/join/bypass/alias timing under simultaneous couch and grow load.
- Catalog `build` now deletes `dist` first. Full test discovery is recursive from that clean output via a portable Node helper. The fast gate always clean-builds and explicitly includes deadline, cancellation, request registry, telemetry, scoped-child, mpv policy, ownership, stream-flight, AIO policy, stream-cache resolve, trigger-consumer, and preflight tests in addition to its prior slice.
- Reconciled `STATUS`, `ROADMAP`, `PLAYABILITY`, and `COUCH_TEST` with the runtime profile source, 1080p browse/source-matched playback split, precise deferred `vo=null` scope, verified-4K HEVC rule, uncached-TorBox last resort, play-first hot path, immediate episode activation, and grey retry behavior. Added the requested compact Pi acceptance matrix and strengthened the playback SSOT gate to check code/config/docs together.
- Split-machine deployment remains git-only and Pi validation remains explicitly home-Mac-only.

Focused evidence:

```text
cd src/catalog-service && npm run test:gate
```

PASS — final independent run 277 tests, 0 failures, 0 skipped. This is materially smaller than the full suite while including all newly safety-critical categories.

```text
# Deliberately seed dist/orphaned-source.test.js, then:
cd src/catalog-service && npm run build
test ! -e dist/orphaned-source.test.js
```

PASS — the clean build removed the orphan before compilation/test discovery.

```text
MANGO_REPO_DIR="$PWD" MANGO_GATE_SOURCE_ONLY=1 \
MANGO_MPV_STOP_LAUNCHER=1 MANGO_MPV_DEFER_FOREGROUND=1 \
bash scripts/m6-ship/gate-m6-playback-ssot.sh
```

PASS — source/config/docs contracts, with 3 explicit work-Mac warnings (idle HDMI runtime deferred, mpv binary absent, launcher `CanFreeze` unknown).

Failures corrected during S7 are recorded rather than hidden: the first telemetry fixture used release text that the integrity parser correctly rejected in all four rows; it was replaced with a known-valid series identity fixture, after which the only mismatch was the truthful one-candidate last-resort count and the expectation was corrected. The first strengthened SSOT run also failed because source-only mode still required a local mpv binary and its legacy-ladder checker misclassified the named `last_resort` step as verified; source-only now warns for the absent runtime binary and the checker mirrors the source's explicit unverified-step set. The corrected focused runs pass.

## S8 — Final verification and audit

Ran the complete §3 matrix from a clean generated catalog build after all source changes:

| Command | Final result |
|---|---|
| `cd src/catalog-service && npm test` | PASS — 602 tests, 0 failures, 0 skipped |
| `cd src/catalog-service && npm run test:gate` | PASS — 277 tests, 0 failures, 0 skipped |
| `cd src/launcher && npm run build` | PASS — TypeScript no-emit + Vite, 24 modules |
| `PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests` | PASS — 83 tests |
| `bash scripts/m6-ship/gate-m6-ux-smoke.sh` | PASS — source/dist contracts; 2 explicit off-Pi warnings (no local HTTP launcher, no local pad process) |
| `bash -n` on the §3 scripts, persistent probe IPC, and all touched gates | PASS |

Additional final evidence:

- Targeted invalidation/provider proof: PASS — 2 tests; after seeded positive/negative/flight invalidation, two concurrent first user calls produce exactly one provider resolve.
- Source-only playback SSOT: PASS with 3 explicit work-Mac warnings (idle HDMI deferred, mpv absent, `CanFreeze` unknown).
- `git diff --check`: PASS.
- Branch remained `feat/native-experience` at baseline commit `5d3f9b4f6746644a21d3a7a329c216bdcf8867bf`; no switch, commit, or push occurred.
- Diff audit found no lockfile/dependency churn, pad/input path change, tracked generated `dist`, deployment-copy mechanism, private key, credential, or runtime provider userData. Secret-like grep hits were only literal `?token=one/two` values on `example.test` test URLs.
- Working tree contains only the operator spec/report and in-scope config, docs, scripts, catalog/proxy/launcher source, and regression tests.

No final test was skipped. No Pi/runtime/hardware test was attempted or represented as local evidence.

### Files changed by workstream

- S1: `play-deadline*`, `play-cancel*`, `play-request-registry*`, `scoped-child*`, `index.ts`, `play-orchestrator*`, `mpv.ts`, `catalog.ts`, and `serve.py`.
- S2: `couch-activity.sh`, `mpv-play.sh`, `mpv-stop.sh`, persistent probe IPC, `stream-flight*`, `resolve-metrics*`, `playback-ownership.test.ts`, `core.ts`, and `playability/trigger-consumer*`.
- S3: AIO/filter example configs, `aiostreams-policy*`, `filter-config-policy.test.ts`, `stream-filters*`, `play-ladder*`, `verify*`, thin/bonus/core resolve tests, and `ladder-breakdown.ts`.
- S4: `preflight-playback*`, `mpv*`, `mpv-policy-args.test.ts`, `scoped-child*`, `mpv-probe-pool.ts`, persistent probe IPC, player shell scripts, and playback SSOT gate.
- S5: `core.ts`, `core-invalidate-streams.test.ts`, `stream-bad-cache.test.ts`, `play-orchestrator*`, `index.ts`, and `verify*`.
- S6: launcher `detail.ts`, `main.ts`, `next-prompt.ts`, `catalog.ts`, and UX smoke gate.
- S7: `playback-telemetry*`, catalog package/build helpers and fast gate, playback SSOT gate, and `ARCHITECTURE`, `STATUS`, `ROADMAP`, `PLAYABILITY`, and `COUCH_TEST` docs.
- S8: this report only; generated `dist` was rebuilt but remains ignored/untracked.

## Deferred to home Mac/Pi

All items below are intentionally unverified on this work Mac:

- [ ] Home Mac and Pi HEAD equal the reviewed pushed commit.
- [ ] `bash scripts/pi-deploy.sh --fast --gate` passes; use `--full --gate` only if lockfiles changed.
- [ ] Active playback profile/env and AIOStreams userData confirm intended hifi/uncached-TorBox policy without exposing secrets.
- [ ] 95 s client cancellation never produces later ghost playback.
- [ ] A greater-than-30-minute or safely accelerated equivalent playback is not interrupted by maintenance.
- [ ] Background probe defers while couch playback owns mpv.
- [ ] Picker attempts exactly the selected release and reports the selected ladder step.
- [ ] Hard-language title never attempts wrong-language audio.
- [ ] 1080p HDR and 4K SDR HEVC expose expected effective mpv properties after handoff.
- [ ] Subtitle/audio policy, first-frame HDMI match, launcher restore, and Play focus work from the couch.
- [ ] `scripts/diag/playback-4k-proof.sh` records real frame-drop/present evidence.
- [ ] Episode completion refreshes progress/Resume and next-episode failure is visible.
- [ ] Provider/alias metrics are captured under couch plus grow load before concurrency tuning.

## Risk and rollback

Primary residual risk is cross-process behavior that source/fake-process tests cannot prove: real Pi process-group cleanup, 95 s ghost-play cancellation, long-play maintenance ownership, HDMI first-frame/restore ordering, actual audio/subtitle negotiation, and frame-drop performance. These are isolated in the home-Mac checklist.

The highest-change surfaces are `mpv-play.sh`, `handlePlay`/orchestration, and stream cache/single-flight. Roll back by coherent behavior group (below), not by retaining only one layer of the deadline or ownership contract; partial rollback could recreate timeout or global-ownership mismatches. The telemetry is additive and may be disabled at runtime with `MANGO_PLAYBACK_TELEMETRY=0` if log volume itself needs isolation, without changing playback policy.

## Recommended commit grouping

No commits were created. Recommended review/commit groups:

1. Request lifetime: deadline, request registry/cancel, epoch guards, proxy/launcher timeouts, scoped child process.
2. Foreground ownership: activity truth, process lock/scoped stop, request-class single-flight and metrics.
3. Selection policy: AIO uncached policy, language/quality overrides, picker step, HEVC examples, ladder diagnostics.
4. Probe/player policy: bounded preflight, structured duration, ffprobe deadline, shared immediate/deferred mpv arguments.
5. Play-first state: stable identity, failure memory, targeted invalidation, verification hot-path removal.
6. Launcher return UX: refresh-before-focus, next-episode snapshot/cancel/toast, neutral progress copy.
7. Truth/build/docs: telemetry, clean test discovery/fast gate, policy docs and couch matrix.
