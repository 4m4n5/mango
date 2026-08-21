# Codex implementation brief — harden Mango playback end to end

You are an autonomous coding agent working in the **`mango`** repository. You have **no prior context** on this project; everything you need is in this file. Read it **top to bottom** before writing any code, then implement the workstreams below systematically. A separate reviewer will review your work afterward, so **optimize for correctness, reuse, clarity, and test coverage over cleverness**.

You are running on the **work Mac**. You MAY inspect and modify the local repository and run local builds/tests. You MUST NOT SSH to the Mango Pi or run any Pi deploy/remote wrapper from this machine. Hardware validation is a separate home-Mac handoff after review, commit, and push.

## 0. TL;DR of the mission

Mango has a strong ladder-first playback core, but a completed audit found cross-layer failures that can produce ghost playback after timeout, interrupted couch playback, unreachable fallbacks, unsafe 4K selection, wrong language, stale state, and inconsistent mpv policy. Implement every confirmed **P0/P1** correction below, plus low-risk truthfulness, test, documentation, and measurement work for the P2 findings. Do not tune P2 production thresholds without evidence.

Workstreams, in dependency order:

1. **S1 — Establish deterministic deadline, cancellation, and epoch semantics.**
2. **S2 — Protect foreground playback from maintenance and resolution concurrency.**
3. **S3 — Make provider, ladder, language, quality, picker, and 4K policy internally consistent.**
4. **S4 — Bound and classify preflight/probe work; repair deferred mpv policy.**
5. **S5 — Remove verification from the hot path and repair invalidation/failure memory.**
6. **S6 — Repair playback-return and next-episode UX without changing navigation design.**
7. **S7 — Make telemetry, docs, builds, and gates truthful; add P2 measurements.**
8. **S8 — Run the complete local verification matrix and write the handoff report.**

## 0.1 Overriding principle — no apparent success without end-to-end ownership

- A request that has timed out, been cancelled, or been superseded must never start playback or mutate verification/progress state.
- Foreground couch playback always owns mpv and receives priority over maintenance, grow, and background verification.
- A ladder label is not policy: codec, language, cache, quality, and release identity must be enforced by data and tests.
- Preserve the existing play-first couch model, D-pad behavior, and picker single-shot behavior. Do not introduce new dialogs, modes, or navigation.
- If a Pi-only property cannot be measured locally, record it as deferred with the exact home-Mac command and expected evidence. Never invent a pass.

## 1. What you MAY and MUST NOT do

**You MAY:**

- Read and modify files inside `/Users/aman.shrivastava/Documents/personal/projects/mango`.
- Run local Node, TypeScript, Python, shell syntax, and source-only gate commands described in §3.
- Add focused tests, fixtures, small pure helpers, structured diagnostics, and documentation.
- Use local loopback services only when a test starts and tears them down itself.

**You MUST NOT:**

- Run `ssh mango`, `ssh aman@10.0.0.174`, `ssh mango-mdns`, `scripts/pi-exec.sh`, `scripts/pi-deploy.sh`, `scripts/pi-exec-gate.sh`, or any command intended to diagnose, deploy, restart, or gate the Pi.
- Push, create tags, change git config, amend published commits, use `--no-verify`, or force any Git operation.
- Switch or create branches. Verify you are on **`feat/native-experience`** with `git branch --show-current`; if not, STOP and report.
- Commit unless the operator explicitly tells you to. Leave implementation and report in the working tree.
- Change the locked 8BitDo pad mapping or replace the input stack.
- Add a new playback backend, player, database, queue service, streaming progress protocol, or third-party dependency unless the existing implementation makes the requirement impossible; if so, STOP and explain before adding it.
- Hide failures by merely increasing every timeout, weakening integrity/title checks, treating transient failures as success, disabling tests, or making assertions tautological.
- Change production tuning thresholds that are not explicitly authorized in this spec. The authorized timing envelope is **server 85 s total, proxy 90 s, launcher 95 s**. P2 provider/grow concurrency and cache TTL tuning remain measurement-first.
- Rewrite season-scoped episode navigation, change B/Y semantics, add pre-play selection to auto-play, or re-enable dwell prefetch.
- Hand-edit generated `dist/` output as source. Generated output may be deleted and rebuilt.
- Fabricate any test, runtime fact, codec capability, deployed config, EDID mode, frame-drop measurement, or passing boolean. Unreachable means deferred-with-exact-reason.

**You MUST:**

- Read `AGENTS.md`, `docs/PLAYABILITY.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOY.md`, and `docs/DEPLOY-SPLIT-MACHINE.md` before implementation.
- Preserve git-only deployment; never add `rsync`, `scp`, or file-copy deployment.
- Keep changes minimal and reuse existing ladder, error-classification, cache, epoch, activity, display, and restore abstractions.
- Add a regression test for every P0/P1 behavior changed.
- Keep shell changes compatible with Bash on Raspberry Pi OS; quote expansions and run `bash -n`.
- Keep TypeScript strict and avoid `any` unless an existing external boundary requires it.
- Write `PLAYBACK_HARDENING_CODEX_REPORT.md` as specified in §9.

## 2. Repository map (absolute paths)

### Repository and required reading

- **Repo root:** `/Users/aman.shrivastava/Documents/personal/projects/mango`
- **Agent rules:** `/Users/aman.shrivastava/Documents/personal/projects/mango/AGENTS.md`
- **Play policy:** `/Users/aman.shrivastava/Documents/personal/projects/mango/docs/PLAYABILITY.md`
- **Architecture:** `/Users/aman.shrivastava/Documents/personal/projects/mango/docs/ARCHITECTURE.md`
- **Status and acceptance:** `/Users/aman.shrivastava/Documents/personal/projects/mango/docs/STATUS.md`, `docs/COUCH_TEST.md`
- **Deployment:** `/Users/aman.shrivastava/Documents/personal/projects/mango/docs/DEPLOY.md`, `docs/DEPLOY-SPLIT-MACHINE.md`

### Request, resolve, policy, and state

- `src/catalog-service/src/index.ts` — `handlePlay`, request overrides, epochs, verification/progress writes.
- `src/catalog-service/src/core.ts` — `resolveForPlay`, `resolveRawStreams`, `rawStreams`, caches, single-flight, aliases and addon fan-out.
- `src/catalog-service/src/play-orchestrator.ts` — main/last-resort/obligation attempts, preflight/probe/play and bad-stream handling.
- `src/catalog-service/src/play-ladder.ts` — ladder expansion, filtering, ranking, picker candidate, stable release fingerprint.
- `src/catalog-service/src/stream-filters.ts` — filter config, language/quality/codec policy, runtime plausibility.
- `src/catalog-service/src/preflight-playback.ts` — bounded HTTP range/content inspection.
- `src/catalog-service/src/mpv.ts` — child-process probe/play wrapper and timeout/error parsing.
- `src/catalog-service/src/play-error-classify.ts` — existing garbage/transient/rate-limit/no-stream classes.
- `src/catalog-service/src/stream-bad-cache.ts` — bad URL/release memory.
- `src/catalog-service/src/playability/verify.ts` — prepare, verify and drift behavior.
- `src/catalog-service/src/playability/pipeline.ts` — background prepare/verify pipeline.
- `src/catalog-service/src/playability/trigger-consumer.ts` — maintenance idle gate.
- `src/catalog-service/src/playability/config.ts` — grow/resolve concurrency defaults; measure before tuning.
- `src/catalog-service/src/playability/db.ts` — verification and title invalidation.

### Proxy, launcher, and playback return

- `src/mango-ui-server/serve.py` — launcher-to-catalog proxy timeout and disconnect behavior.
- `src/launcher/src/catalog.ts` — `/play` fetch/watchdog/AbortSignal behavior.
- `src/launcher/src/detail.ts` — play busy state, progress copy, return focus and episode refresh.
- `src/launcher/src/main.ts` — playback surface restoration, snapshots and next-prompt wiring.
- `src/launcher/src/next-prompt.ts` — direct next-episode play and failure handling.
- `src/launcher/src/toast.ts` and existing status surfaces — reuse; do not invent another error UI.

### Pi/mpv scripts and configuration

- `scripts/m2-catalog/service/mpv-play.sh` — ffprobe, mpv startup, deferred VO handoff, render/audio/subtitle policy, activity and process ownership.
- `scripts/m2-catalog/service/mpv-stop.sh` — scoped playback teardown and launcher restore.
- `scripts/lib/couch-activity.sh` — foreground-idle truth.
- `scripts/lib/restore-launcher-after-playback.sh` — return to browse surface.
- `scripts/lib/mango-display-mode.sh` — HDMI source matching.
- `scripts/m6-ship/set-playback-engine.sh` — runtime profile source.
- `scripts/m6-ship/gate-m6-playback-ssot.sh` — playback source-contract gate.
- `scripts/m6-ship/gate-m6-ux-smoke.sh` — launcher source/build UX gate.
- `scripts/diag/playback-4k-proof.sh` — existing Pi-only smoothness evidence.
- `config/aiostreams-target-patch.json` — upstream provider filtering.
- `config/catalog-filters.example.json` — baseline ladder.
- `config/catalog-filters.4k-hdr.example.json` — legacy 4K HDR ladder.
- `config/catalog-filters.4k-hifi.example.json` — intended Pi 4K SDR/HEVC ladder.

### Existing focused tests

- `src/catalog-service/src/play-orchestrator.test.ts`
- `src/catalog-service/src/play-ladder.test.ts`
- `src/catalog-service/src/stream-filters.test.ts`
- `src/catalog-service/src/preflight-playback.test.ts`
- `src/catalog-service/src/core-stream-resolve.test.ts`
- `src/catalog-service/src/bonus-stream-resolve.test.ts`
- `src/catalog-service/src/stream-bad-cache.test.ts`
- `src/catalog-service/src/playability/verify.test.ts`
- `src/catalog-service/src/playability/play-failure-policy.test.ts`
- `src/catalog-service/src/play-verify-state.test.ts`
- `src/launcher/src/catalog-errors.test.ts`
- `src/orchestrator/tests/`

## 3. Environment, lint, and test commands

Run commands from the repo root unless the command explicitly changes directory.

### Required baseline before editing

```bash
git branch --show-current
git status --short
git rev-parse --short HEAD

cd src/catalog-service
rm -rf dist
npm test

cd ../launcher
npm run build

cd ../..
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
bash -n \
  scripts/m2-catalog/service/mpv-play.sh \
  scripts/m2-catalog/service/mpv-stop.sh \
  scripts/lib/couch-activity.sh \
  scripts/lib/restore-launcher-after-playback.sh
```

At the audit baseline `5d3f9b4`, expected evidence was 542 catalog tests passing, launcher build passing, 83 orchestrator tests passing, and shell syntax passing. Counts may legitimately increase after adding tests. If the baseline now differs, report the actual result; do not force it to match these numbers.

### Focused TypeScript test loop

The package builds all TypeScript before running generated tests. Always clean `dist` before a full suite until S7 changes the package scripts.

```bash
cd src/catalog-service
rm -rf dist
npm run build
node --test \
  dist/play-orchestrator.test.js \
  dist/play-ladder.test.js \
  dist/stream-filters.test.js \
  dist/preflight-playback.test.js \
  dist/core-stream-resolve.test.js \
  dist/bonus-stream-resolve.test.js \
  dist/stream-bad-cache.test.js \
  dist/playability/verify.test.js \
  dist/playability/play-failure-policy.test.js \
  dist/play-verify-state.test.js
```

Add new test files to this list and to the relevant fast gate when they protect release-critical behavior.

### Full local verification

```bash
cd src/catalog-service
rm -rf dist
npm test
npm run test:gate

cd ../launcher
npm run build

cd ../..
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
bash scripts/m6-ship/gate-m6-ux-smoke.sh
bash -n \
  scripts/m2-catalog/service/mpv-play.sh \
  scripts/m2-catalog/service/mpv-stop.sh \
  scripts/lib/couch-activity.sh \
  scripts/lib/restore-launcher-after-playback.sh \
  scripts/m6-ship/gate-m6-playback-ssot.sh
```

`gate-m6-ux-smoke.sh` is source/build-safe on Mac. Do not run `gate-lite-play.sh`, `pi-pre-couch-gate.sh`, `pi-exec-gate.sh`, `pi-deploy.sh`, playback smoothness probes, or any live mpv/HDMI gate on this work Mac.

### Test quality rules

- Use dependency injection/fakes already present in tests. Do not invoke real debrid providers.
- Fake timers/processes must model cancellation and teardown, not simply return success.
- For shell behavior, prefer extracting deterministic argument/deadline helpers that can be source-tested. Do not claim frame or HDMI correctness from grep alone.
- A skipped test is not acceptance unless the report lists it as deferred.

## 4. Background and current state

The active branch is `feat/native-experience`. The completed audit was performed from a clean GitHub baseline at `5d3f9b4`. The local suite passed after stale generated `dist` files were removed; that stale-output behavior is itself in scope.

The intended product behavior is:

- B on Play or an episode starts playback without a mandatory picker.
- Main ladder prefers integrity-safe, smooth, cached releases.
- Last resort broadens policy; the obligation floor still tries remaining integrity-safe candidates.
- Picker B is single-shot: play exactly the selected URL, never silently substitute another release.
- mpv-hifi is the intended high-fidelity profile; 4K main verification must require Pi-safe HEVC policy.
- Uncached TorBox is intended as a final playback-for-sure fallback; uncached Real-Debrid remains excluded.
- Launcher browse mode is 1080p60; playback may source-match HDMI before first visible frame.
- Returning from playback must preserve title/episode context and focus Play, while refreshing progress truth.

Confirmed audit findings to close:

1. **P0 — deadline mismatch:** proxy is 60 s, orchestrator may consume 90 s after pre-play work, launcher is 95 s. The UI can fail before mpv starts.
2. **P0 — foreground ownership:** timestamp-only idle logic and global `pkill -x mpv` allow maintenance probes to kill long couch playback.
3. **P0 — unreachable fallback:** AIOStreams target policy excludes all uncached debrid streams under upstream OR semantics, removing uncached TorBox before Mango.
4. **P0 — deferred VOD policy loss:** the normal deferred VOD path starts with buffer args that omit hifi tone-map/audio/subtitle/render policy.
5. **P1 — unbounded/misclassified preflight:** Range may be ignored, `arrayBuffer()` can buffer the whole response, and generic error text becomes NFO.
6. **P1 — incompatible single-flight:** a foreground resolve can inherit a shorter background flight because the key omits request class.
7. **P1 — override blindness:** hard/preferred language and explicit quality/remux overrides are not consistently applied to auto-play, verify, and floor.
8. **P1 — stale writes:** a superseded play can write verify/progress/watch state after mpv returns PASS.
9. **P1 — dead duration guard:** duration is queried from a probe socket after probe teardown.
10. **P1 — stale stream memory:** title invalidation updates DB state but leaves positive/negative stream cache entries.
11. **P1 — verify on hot path:** drift/prepare/inline verify can add extra resolves and probes before couch play and use full combined ladder.
12. **P1 — ffprobe outside deadline:** script timing starts after ffprobe, while Node has a separate child timeout.
13. **P1 — picker loses step:** API receives `prefer_ladder_step` but does not pass it to `singlePickerCandidate`.
14. **P1 — unsafe 4K examples:** baseline and `4k-hdr` main steps can admit 4K non-HEVC despite names/global fields.
15. **P1 — stale return state:** open detail refocuses Play without reloading episode/progress truth; next-prompt failure is invisible and lacks the normal snapshot/cancellation path.
16. **P2 — failure memory asymmetry:** garbage is URL-scoped while picker transients can poison a stable release too broadly.
17. **P2 — telemetry drift:** exclusion counters are synthetic zeros and several response fields are dead.
18. **P2 — documentation drift:** runtime profile, VO path, resolution cap, episode activation, and fallback docs disagree.
19. **P2 — build/gate drift:** generated output is not cleaned and the fast gate is an explicit subset.
20. **P2 — false progress narration:** client timers claim provider/ladder states not reported by the server.
21. **P2 — provider amplification:** alias/cross-probe orchestration can duplicate above per-key single-flight; grow can fan out concurrently. Measure before changing defaults.

## 5. Existing tooling to reuse — do not reinvent

| Need | Reuse this | Notes |
|---|---|---|
| Request supersession | `index.ts` play epoch helpers | Extend checks to every post-success mutation; do not create a second epoch system. |
| Deadline math | Existing timeout config in `stream-filters.ts`, `mpv.ts`, and launcher watchdog | Introduce one small absolute-deadline/remaining-time representation and thread it. |
| Error policy | `play-error-classify.ts` | HTTP/preflight/process errors must map to existing classes. |
| Stable release identity | `play-ladder.ts::stableStreamFingerprint` | Use only where error class justifies release-wide memory. |
| Ladder partitioning | `splitLegacyPlayLadder`, `expandPlayLadder`, `expandObligationFloor` | Keep main, last-resort, and floor semantics explicit. |
| Picker policy | `singlePickerCandidate` | Preserve one selected URL and explicit ladder step. |
| Stream cache | Existing `streamCache`, `streamNegativeCache`, `streamInFlight` in `core.ts` | Add targeted invalidation and request-class-safe flight behavior. |
| Playability queue | Existing trigger/pipeline/verify modules | Move work off the couch path; do not add another queue system. |
| Couch ownership | `couch-activity.sh`, playback-active marker/socket/PID facilities | Make process state authoritative; avoid global process kills. |
| mpv startup/handoff | `append_mpv_render_args`, `append_mpv_buffer_args`, `foreground_handoff` | Factor shared startup policy instead of duplicating option lists. |
| HDMI/restore | `mango-display-mode.sh`, `restore-launcher-after-playback.sh` | Keep born-on-match and black-before-show ordering. |
| User-visible errors | Existing launcher toast/status mapping | Do not add a new modal or surface. |
| Return context | Existing playback return snapshot helpers in `main.ts` | Next episode must follow the same contract. |
| Local gates | Catalog tests, `gate-catalog-unit.sh`, `gate-m6-ux-smoke.sh`, `gate-m6-playback-ssot.sh` | Strengthen existing gates; no parallel gate framework. |

**Only genuinely missing pieces to build, minimally:**

- A small absolute play-deadline/remaining-budget abstraction shared through the TypeScript play path.
- Bounded response-prefix reading for preflight.
- Structured probe output containing duration and any metadata required before teardown.
- Targeted stream-cache invalidation API.
- Truthful resolve/alias/fan-out measurements sufficient to decide later P2 tuning.
- Focused regression fixtures for cancellation, ownership, policy, return state, and stale generated output.

## 6. The workstreams — detailed specs

### S1 — Deterministic deadline, cancellation, and epoch semantics

**Deliverables:**

1. Start one absolute request deadline at `POST /play` ingress. The server owns **85,000 ms total**, including drift handling (if any remains), resolve, preflight, probe, ffprobe, retries, obligation floor, foreground handoff, and teardown except a small bounded process cleanup grace.
2. Set the Python proxy’s play upstream budget to **90,000 ms** and keep the launcher watchdog at **95,000 ms**. Do not broadly increase unrelated endpoint timeouts.
3. Thread remaining budget, not fresh full-duration timers, through:
   - `resolveForPlay`;
   - ladder phases and obligation reserve;
   - preflight;
   - probe/play child processes;
   - ffprobe;
   - any retained verify/drift work.
4. When no budget remains, abort deterministically with the existing timeout/cancel error model. Kill the exact child/process group started for the request and consume its output; do not leave detached work.
5. Make launcher timeout/abort supersede the server play epoch through the existing cancellation mechanism. If the current API lacks a safe cancel endpoint, add the smallest idempotent endpoint tied to request/epoch identity and test it. Do not add WebSockets/SSE.
6. Immediately after `playWithLadder` resolves and before **each** verification, demotion, progress, snapshot, or watch-session mutation, re-check that the request epoch is still current. A stale PASS returns/records cancellation semantics and performs zero writes.
7. Preserve obligation-floor reserve within the 85 s total. It may reserve time from earlier phases; it may not extend the deadline.

**Acceptance:**

- A delayed integration fixture proves no mpv/play callback runs after server, proxy, or launcher cancellation.
- A play A that returns PASS after play B supersedes it writes no verify result, demotion, progress, or watch session.
- Hung resolve, preflight, ffprobe, probe, and play fixtures all finish within the shared deadline plus explicitly asserted teardown grace.
- Existing attempt ordering and obligation-floor tests remain green.

### S2 — Foreground ownership and request-class-safe concurrency

**Deliverables:**

1. Make active playback a hard non-idle condition. `couch-activity.sh` and maintenance entry must consult authoritative playback-active state and/or the scoped couch mpv PID/socket, not timestamp age alone.
2. Close the check/start race: background verify/probe must acquire the existing or minimally added playback ownership lock before invoking mpv. If couch playback is active or wins the lock, background work defers cleanly; it must never stop or replace couch mpv.
3. Scope normal teardown to Mango’s tracked couch mpv PID/socket/process group. Remove `pkill -x mpv` from ordinary playback/probe paths. A separately named explicit emergency cleanup may remain if existing operational docs require it, but no automatic background path may call it.
4. Preserve launcher freeze/hide/display restore behavior for real foreground playback. Background probe deferral must not reveal, hide, freeze, or resize launcher UI.
5. Prevent foreground `resolveForPlay` from joining a background `streamInFlight` with a shorter budget. Minimal acceptable implementation: include `requestClass` plus behavior-affecting options in the key. Background may join an equivalent foreground flight; foreground must bypass or promote a background flight.
6. Add counters/timing for foreground/background flight joins, bypasses, provider fan-out, alias probes, and rate-limit classifications. Do not lower grow concurrency or alias limits in this phase without measured evidence.

**Acceptance:**

- A synthetic playback remains active after activity timestamp exceeds 30 minutes and a maintenance trigger runs.
- A background probe started during couch playback reports deferred/busy and leaves the couch PID/socket untouched.
- Normal stop kills only the tracked Mango couch process; an unrelated fake mpv process survives the test.
- A mocked background fetch exceeding 12 s followed by a user resolve gives the user its foreground budget/result.
- Metrics are deterministic and tested; no provider concurrency default changed.

### S3 — Provider, ladder, language, quality, picker, and 4K policy

**Deliverables:**

1. Fix `config/aiostreams-target-patch.json` for the explicit playback-for-sure policy:
   - retain uncached exclusion for Real-Debrid;
   - remove the all-debrid stream-type exclusion that removes uncached TorBox under AIOStreams OR semantics;
   - add a repository contract test or deterministic config validator proving an uncached TorBox row is not excluded by Mango’s target policy.
2. Thread `hard_language` through main, last-resort, obligation floor, display, and verify selection. An explicit hard language must never be relaxed by floor.
3. Thread `preferred_language` into ladder scoring as a soft reorder only.
4. Make **explicit request overrides** for `min_quality`, `max_quality`, and `exclude_remux` consistent across GET `/stream` and POST `/play` without accidentally turning legacy config preference fields into new global hard caps. Keep request overrides distinguishable from loaded defaults. If an existing documented field is intentionally deprecated, reject it clearly rather than silently accepting and ignoring it.
5. Ensure verify/prepare/drift use `main_ladder` only, never combined main plus last-resort. Align `scripts/diag/ladder-breakdown.ts` with that terminology or clearly report both partitions.
6. Pass `body.prefer_ladder_step` as an explicit picker option to `singlePickerCandidate`. Do **not** use it as a verified hint and do not allow fallthrough. The selected URL is attempted once with its exact selected ladder step.
7. Repair Pi 4K config:
   - every **main/verified** step that admits >1080p must explicitly require HEVC;
   - add `require_hevc: true` to affected baseline/4K HDR main steps or remove a contradictory step if its profile is explicitly 1080p-only;
   - validate this invariant in `loadFilterConfig` after legacy ladder splitting;
   - last-resort/obligation behavior may remain broader but must be labeled unverified and ranked down when not hardware-smooth.
8. Keep the hifi profile’s 4K SDR HEVC policy and 1080p fallback ordering intact.
9. Add end-to-end thin-supplement-to-ladder coverage so unknown metadata cannot silently enter a verified 4K step.

**Acceptance:**

- Uncached TorBox survives target policy; uncached Real-Debrid does not.
- POST `/play` with hard Hindi never attempts English-only candidates, including floor; preferred Hindi reorders but does not exclude.
- Explicit min/max/remux request overrides behave identically in picker display and auto-play.
- Prepare/drift fixtures cannot verify a last-resort-only stream.
- Picker attempts one URL and passes `4k_sdr_remux_cached` (or fixture equivalent) unchanged to mpv.
- Config tests reject a main >1080p Pi step without `require_hevc`; AV1/H.264 4K fixtures never verify.
- Existing title identity, HDR, HEVC, hifi ranking, fallback, and obligation tests remain green.

### S4 — Bounded preflight/probe and complete deferred mpv policy

**Deliverables:**

1. Replace unbounded `response.arrayBuffer()` preflight behavior with a bounded prefix reader:
   - read at most `rangeEnd + 1` bytes;
   - cancel the response body after enough bytes;
   - behave safely if Range is ignored and status is 200.
2. Classify HTTP status before body type:
   - 429 and 5xx are transient/rate-limited as appropriate;
   - other non-success statuses are explicit HTTP failures;
   - only a strong NFO signature is garbage/NFO;
   - generic HTML/text error bodies are not NFO;
   - HLS/video signatures remain recognized.
3. Return structured probe output from the mpv script/wrapper, including `duration_sec` and existing failure classification data, before probe teardown. Run `isPlausibleFeatureDuration` from that output before foreground play. Do not query the global couch socket after teardown.
4. Start the script deadline **before ffprobe**. Cap ffprobe, startup, probe, handoff, and play confirmation to remaining request budget. Keep only a small bounded teardown grace.
5. Refactor mpv argument construction so all deferred non-live VOD receives hifi startup policy while `vo=null`:
   - GPU API/profile;
   - tone mapping;
   - audio channel policy;
   - subtitle startup and `blend-subtitles`;
   - cache/readahead and swap policy.
   At handoff, switch only the properties that must wait for source-matched HDMI: real VO/AO/fullscreen and existing display-sensitive controls.
6. Preserve first-visible-frame ordering: hide/black → HDMI match → real VO enable. Do not move HDMI matching after visible video.
7. Update `gate-m6-playback-ssot.sh` with source-contract assertions for the refactored shared startup policy. Treat this as local structural evidence only; runtime property/frame evidence remains Pi-deferred.

**Acceptance:**

- Large 200 response ignoring Range is read only to the asserted byte cap.
- 403 HTML, 429 text, and 500 text are not NFO; real NFO and HLS fixtures classify correctly.
- A 12-minute stream for a 90-minute movie fails before foreground handoff; bonus episode thresholds remain relaxed.
- Hung ffprobe and mpv fixtures respect the shared deadline.
- Deterministic argument tests prove 1080p HDR and 4K SDR deferred VOD start with intended tone-map/audio/subtitle/GPU/cache options.
- Shell syntax and playback SSOT source gate pass locally.

### S5 — Play-first verification, cache invalidation, and failure memory

**Deliverables:**

1. Remove synchronous full verify/drift/provider work from the couch hot path:
   - resolve once for the user request;
   - use an existing verified hint only as a ranking hint;
   - play within the shared deadline;
   - enqueue drift/reverification after success/failure where appropriate.
2. `prepareVerifyTitle`, demotion drift checks, and background pipelines must use `main_ladder` only and `requestClass: background`.
3. Replace URL-only drift identity with an existing stable release identity where available: infoHash/bingeGroup plus service, with URL hash retained only as a fallback. Do not merge distinct releases merely because titles look similar.
4. Add `CatalogCore.invalidateStreams(type, id, options?)` or equivalently narrow API that clears matching positive cache, negative cache, and incompatible in-flight reuse. Invoke it after confirmed play failure/title invalidation and the existing manual invalidate endpoint.
5. Keep transient provider misses retryable. Do not turn every failure into cache eviction storms.
6. For P2 bad-stream policy:
   - implement release-wide memory only for confirmed content garbage/integrity failures;
   - keep transient/network/rate-limit memory URL/service-scoped and short or absent;
   - never hide the same release from another service because one service timed out.
   Reuse `play-error-classify.ts`; do not introduce another taxonomy.
7. Add `win_on_main` tests for main, last-resort, floor, and picker outcomes so library promotion cannot silently drift.

**Acceptance:**

- Cold verified couch play invokes at most one provider resolve before attempt.
- Rotating a signed URL for the same stable release does not cause false drift; distinct releases remain distinct.
- After seeded positive/negative cache invalidation, the next user resolve reaches provider once.
- Confirmed NFO with rotated URL is skipped by stable release identity; TorBox transient failure does not hide the same infoHash on Real-Debrid.
- Main/last-resort/floor/picker `win_on_main` semantics are explicitly tested.

### S6 — Playback-return and next-episode UX correctness

**Deliverables:**

1. Keep the established return behavior: detail remains open and focus lands on Play.
2. On playback return, refresh or narrowly patch episode progress, global/episode resume target, and Play/Resume labels. Do not rebuild the whole detail view if that would steal focus or reset season context.
3. Preserve the previously fixed playback-return focus ordering: asynchronous episode rendering must not steal focus from Play.
4. Route next-prompt play failure through the existing toast/error mapping. Replace the no-op `setStatus` callback with truthful user-visible handling.
5. Save the same return snapshot for direct next-episode playback as for normal detail playback, and pass an AbortSignal/cancellation identity through the same play API.
6. Keep B on episode = load/resolve/play immediately. Do not reintroduce dwell prefetch or require a picker.
7. Replace timer claims such as “TorBox is caching” or “trying alternate release” with neutral truthful progress unless the server actually supplies that state. Do not add SSE/WebSockets solely for copy.
8. Add focused pure/DOM contract tests where the current launcher test setup permits. If full DOM focus behavior cannot be executed locally, strengthen `gate-m6-ux-smoke.sh` and list the exact couch checks as deferred.

**Acceptance:**

- After episode exit, progress and Play/Resume label update while active season/episode context remains.
- Focus remains on Play after asynchronous refresh.
- Next-episode failure produces the existing toast; cancellation cannot later start playback.
- Direct next play returns to the correct series/season/episode context.
- Slow resolve copy never names a provider or ladder action that has not actually begun.
- Launcher build and UX smoke pass.

### S7 — Truthful observability, documentation, build hygiene, and P2 evidence

**Deliverables:**

1. Replace synthetic zero exclusion telemetry with either:
   - real counted ladder rejection reasons; or
   - a smaller truthful summary: raw, integrity-safe, main, last-resort, obligation-floor.
   Remove dead response fields only if all consumers/docs/tests are updated. Do not preserve lying fields for compatibility.
2. Add structured local metrics/log fields for:
   - request ID/epoch and total deadline;
   - resolve request class;
   - provider fan-out and duration;
   - flight join/bypass;
   - alias/cross-probe count;
   - ladder step attempted and result class;
   - cache invalidation;
   - foreground/background ownership deferral.
   Do not include full signed URLs, tokens, credentials, or private provider userData.
3. Measurement-first P2 rule: do not lower `MANGO_PLAYABILITY_RESOLVE_CONCURRENCY`, cross-probe limits, cache TTLs, or attempt counts in this workstream. Report what runtime evidence the Pi must capture before tuning.
4. Make catalog builds clean generated output deterministically:
   - `npm test` and `test:gate` must not execute orphaned `dist` tests;
   - avoid platform-specific shell where a portable npm script/helper is clearer;
   - fast gate must rebuild rather than trusting stale `dist`.
5. Add the newly safety-critical deadline, cancellation, preflight, policy, ownership-helper, and cache tests to the fast catalog gate. Keep the fast gate materially smaller than full suite, but list its exact scope truthfully.
6. Reconcile docs with implemented reality:
   - current playback engine/profile source of truth;
   - 1080p browse versus source-matched playback resolution;
   - deferred `vo=null` scope;
   - HEVC requirement for verified 4K;
   - uncached TorBox last-resort policy;
   - episode B immediate play and grey/unverified retry behavior;
   - split-machine deploy and Pi-only validation.
7. Update `docs/COUCH_TEST.md` with a compact acceptance matrix for timeout cancellation, language, picker single-shot, return state, long-play maintenance safety, 1080p/HDR, 4K SDR HEVC, subtitles/audio, HDMI restore, and frame drops.
8. Add no secrets or runtime userData to repository artifacts.

**Acceptance:**

- Telemetry fixture rejected for title mismatch/HDR/language reports truthful non-zero reasons or truthful stage counts.
- Deleting/renaming a source test cannot leave an orphan generated test executing.
- `npm run test:gate` rebuilds and includes the named safety-critical tests.
- Docs and source gates agree on profile, VO, resolution, codec, fallback, and episode behavior.
- Report clearly separates measured local facts from deferred Pi runtime facts.

### S8 — Complete local verification and report

**Deliverables:**

1. Run every command in §3’s full local verification section after deleting generated `dist`.
2. Re-run focused tests for every failure corrected during the final pass.
3. Inspect `git diff` for accidental generated files, secrets, lockfile churn, unrelated docs, pad mapping, or deployment changes.
4. Write `/Users/aman.shrivastava/Documents/personal/projects/mango/PLAYBACK_HARDENING_CODEX_REPORT.md` with:
   - baseline branch and commit;
   - one section per S1–S7;
   - finding IDs closed, files changed, and design decisions;
   - exact test commands, pass/fail counts, and relevant output;
   - any failed or skipped test without euphemism;
   - “Deferred to home Mac/Pi” checklist from §9;
   - risk/rollback notes;
   - recommended commit grouping, but no commits.
5. Stop with files in the working tree. Do not push or attempt Pi work.

**Acceptance:**

- Full local matrix is green, or the report identifies a genuine blocker with exact reproduction.
- Report claims are traceable to command output or changed code/tests.
- Git status contains only in-scope source/tests/docs/spec/report and expected rebuilt ignored output.

## 7. Ordering and how to work

Do the work in strict dependency order:

1. Record baseline evidence.
2. **S1** deadline/epoch primitives and tests.
3. **S2** ownership and request-class concurrency.
4. **S3** provider/ladder/config contract.
5. **S4** preflight/probe/mpv.
6. **S5** verify/cache/failure state.
7. **S6** launcher return UX.
8. **S7** truth/docs/build/gates.
9. **S8** clean full verification and report.

After each workstream:

- rebuild and run the focused affected tests;
- run TypeScript build for each touched package;
- run `bash -n` for each touched shell file;
- append evidence to `PLAYBACK_HARDENING_CODEX_REPORT.md`;
- inspect the diff before expanding scope.

If a proposed fix would change the visible couch interaction beyond the explicit S6 requirements, STOP and record the decision needed. Do not make speculative UX changes.

## 8. Commit policy

**Default: do NOT commit and do NOT push.** Leave changes in the working tree for the reviewer.

Only if the operator explicitly instructs you later:

- use coherent commits grouped by behavior, not one giant “hardening” commit;
- use imperative messages that explain why;
- let hooks run;
- never amend, force, skip verification, tag, or push unless separately authorized.

Pi deployment requires a reviewed commit pushed to `origin/feat/native-experience`; that is deliberately outside this work-Mac implementation run.

## 9. Definition of done

### Local implementation

- [ ] Correct branch verified; no branch switch.
- [ ] S1–S7 implemented to acceptance or explicitly blocked with exact reason.
- [ ] Every P0/P1 finding has a non-tautological regression test.
- [ ] P2 threshold tuning remains deferred unless backed by real evidence.
- [ ] Catalog full suite and fast gate pass from clean `dist`.
- [ ] Launcher build and source-safe UX smoke pass.
- [ ] Orchestrator Python suite passes.
- [ ] All touched shell scripts pass `bash -n`.
- [ ] No pad/input changes, secrets, dependencies, generated-source edits, commits, pushes, SSH, or Pi wrappers.
- [ ] `PLAYBACK_HARDENING_CODEX_REPORT.md` is complete and honest.

### Deferred to home Mac/Pi — do not claim locally

After reviewer verification, commit, and push, the home-Mac agent must follow `docs/DEPLOY-SPLIT-MACHINE.md`. Minimize deploy cycles: deploy only after the complete local suite is green; perform one consolidated `--fast --gate` cycle; iterate only for a reproduced Pi failure.

The home-Mac/Pi evidence must include:

- [ ] Home Mac and Pi HEAD equal the reviewed pushed commit.
- [ ] `bash scripts/pi-deploy.sh --fast --gate` passes; use `--full --gate` only if lockfiles changed.
- [ ] Active playback profile/env and AIOStreams userData confirm intended hifi/uncached-TorBox policy without exposing secrets.
- [ ] 95 s client cancellation never produces later ghost playback.
- [ ] >30-minute or safely accelerated equivalent playback is not interrupted by maintenance.
- [ ] Background probe defers while couch playback owns mpv.
- [ ] Picker attempts exactly the selected release and reports the selected ladder step.
- [ ] Hard-language title never attempts wrong-language audio.
- [ ] 1080p HDR and 4K SDR HEVC expose expected effective mpv properties after handoff.
- [ ] Subtitle/audio policy, first-frame HDMI match, launcher restore, and Play focus work from the couch.
- [ ] `scripts/diag/playback-4k-proof.sh` records frame-drop/present evidence; no result is synthesized.
- [ ] Episode completion refreshes progress/Resume and next-episode failure is visible.
- [ ] Provider/alias metrics are captured under couch plus grow load before any concurrency tuning.

Now read the files in §2 and implement S1 through S8.

---

## Starter prompt — work Mac Codex

```text
You are implementing a task defined entirely in:
/Users/aman.shrivastava/Documents/personal/projects/mango/PLAYBACK_HARDENING_CODEX_SPEC.md

Read it top to bottom before writing code; it is the full contract.
Work only on branch feat/native-experience (verify, do not switch).
This is the work Mac: never SSH to the Pi and never run pi-exec/pi-deploy/pi-exec-gate.
Implement all P0/P1 workstreams; keep P2 tuning measurement-first.
Do not commit or push. Never fabricate a pass or hide a skipped/deferred check.
Run the clean local verification matrix and write:
/Users/aman.shrivastava/Documents/personal/projects/mango/PLAYBACK_HARDENING_CODEX_REPORT.md
When done, summarize what passed and exactly what remains for the home-Mac/Pi handoff.
```

## Starter prompt — home Mac validation agent, only after reviewed commit is pushed

```text
You are validating a reviewed Mango playback-hardening commit from the home Mac.
Read these files fully before acting:
~/Documents/personal/projects/mango/docs/DEPLOY-SPLIT-MACHINE.md
~/Documents/personal/projects/mango/PLAYBACK_HARDENING_CODEX_SPEC.md (especially §9)
~/Documents/personal/projects/mango/PLAYBACK_HARDENING_CODEX_REPORT.md

Work only on feat/native-experience. Pull with --ff-only and verify the expected commit.
This home Mac may use the repository Pi wrappers; deployment remains git-only—never rsync/scp.
Minimize deploys: one consolidated `bash scripts/pi-deploy.sh --fast --gate` after local review;
use --full only if lockfiles changed; redeploy only for a reproduced Pi-specific fix.
Execute every “Deferred to home Mac/Pi” check in §9 and append real commands/evidence to the report.
Never synthesize a pass. If a couch/manual observation is required, mark it pending and ask the user.
Do not change UX, thresholds, pad mappings, or unrelated code while validating.
```
