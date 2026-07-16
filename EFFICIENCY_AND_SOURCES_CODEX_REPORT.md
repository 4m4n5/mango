# Mango efficiency and stream-sources audit report

Date: 2026-07-15  
Branch: `feat/native-experience`  
Baseline HEAD: `713782d14b46dbd84bd0738937f8c03aff42db9e` (`713782d`)

## Outcome

W1, W2, and the safe measurement-first subset of W3 are complete locally. The episode success path now clears the exact stale failed episode row, the launcher only reconciles the freeze/abort race with fresh server-side proof, current AIOStreams cache badges are parsed correctly, the TorBox/RD uncached policy is both validated and enforced, same-title background work cannot amplify an active couch fan-out, and verification reuses its already-expanded main candidates.

Nothing in this round changes provider coverage, fallback depth, dependency versions, or tuned numeric defaults. Pi-only checks are explicitly deferred to the home-Mac handoff in `docs/COUCH_TEST.md:75-125`; they are not counted as local passes.

## Scope and guardrails

- Verified `feat/native-experience` before editing and never switched branches.
- Baseline tree was clean except for the user-provided untracked `EFFICIENCY_AND_SOURCES_CODEX_SPEC.md`.
- During implementation and local verification, no commit, push, deploy, SSH,
  `scripts/pi-*.sh`, dependency install/update, or Pi access was performed.
  The user later explicitly authorized one commit/push plus a tracked home-Mac
  deployment specification; Pi access and runtime proof remain deferred.
- No tuned timeout, budget, concurrency, attempt, or TTL default was changed.
- The locked policy remains: TorBox uncached retained; Real-Debrid uncached excluded (`config/aiostreams-target-patch.json:13-16`, `src/catalog-service/src/aiostreams-policy.ts:23-35`).
- No credentials or generated Pi manifest data were read or written.

## Baseline verification

The complete §3 matrix passed before edits:

| Command | Result |
|---|---|
| `git branch --show-current` | PASS — `feat/native-experience` |
| `cd src/catalog-service && npm run build` | PASS — clean `dist`, TypeScript build |
| `cd src/catalog-service && npm test` (two clean runs) | PASS — 603/603 each |
| `cd src/catalog-service && npm run test:gate` | PASS — 277/277 |
| `cd src/launcher && npm run build` | PASS — 24 modules |
| `cd src/launcher && bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh` | PASS — 2 expected off-Pi warnings: launcher and pad unavailable |
| `PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests` | PASS — 83/83 |
| §3 `bash -n` command and `python3 -m py_compile src/mango-ui-server/serve.py` | PASS |
| §3 source-only `scripts/m6-ship/gate-m6-playback-ssot.sh` command | PASS — 3 expected off-Pi warnings: HDMI runtime, mpv binary, and `CanFreeze` unavailable |

## W1 — episode played-but-greyed / false timeout

Status: complete locally; actual Pi/mpv confirmation deferred.

### Root cause confirmed

1. The play route gated all playability writes behind the rail-gate predicate. A non-`:1:1` episode could play successfully but never replace its exact stale `failed` row (`src/catalog-service/src/index.ts:602-692`; `src/catalog-service/src/playability/ids.ts`).
2. Episode shaping maps a failed row to `playable=false`, and detail applies the grey retry state (`src/catalog-service/src/episodes.ts:207-222`; `src/launcher/src/detail.ts:435-480`).
3. The launcher starts a 95 s fetch timer before the playback SSOT can freeze its cgroup. After playback, resumed JavaScript can process an expired abort while the server had already completed the exact request (`src/launcher/src/catalog.ts:473-585`; `scripts/m6-ship/gate-m6-playback-ssot.sh`). The old catch path had no server-side success proof and therefore emitted `catalog timed out` and greyed the row.

### Changes

- Added `reconcileSuccessfulEpisodePlayability()`. A successful `mode=auto` play for an exact non-gate series episode records that exact ID as `verified` through `recordVerifyResult()`, guarded by the current play epoch. It does not add rail membership and rejects failed, picker, bare-series, and `:1:1` cases (`src/catalog-service/src/episode-playability-reconcile.ts:28-80`; `src/catalog-service/src/index.ts:602-692`).
- Left rail-gate promotion/demotion behavior unchanged. Non-gate episode failures still do not demote a rail, and the success helper is unreachable from the failure path (`src/catalog-service/src/index.ts:692-762`).
- Added additive `playability_status` and `playability_updated_at` episode response fields so the launcher can prove that the exact episode was freshly updated during this attempt (`src/catalog-service/src/episodes.ts:30-31,207-222`).
- Made the request registry retain proof only for the exact most-recent request that finished successfully; unknown, failed, active-cancelled, and superseded requests return no success proof (`src/catalog-service/src/play-request-registry.ts:3-58`; route outcome at `src/catalog-service/src/index.ts:1735-1758`). Request-scoped cancellation exposes `finished_successfully`, and `PlayTimeoutError` carries that result (`src/launcher/src/catalog-errors.ts:48-51`; `src/launcher/src/catalog.ts:113-119,474-487,572-586`).
- Added `reconcileEpisodePlayTimeout()`. It suppresses the timeout toast/grey override only when cancellation says that exact request finished and the exact episode is `verified` with `updated_at >= attemptStartedAt`. Active aborts, stale proof, failed proof, and reconciliation fetch failures retain the existing error path (`src/launcher/src/playback-reconciliation.ts:12-35`; `src/launcher/src/detail.ts:435-480`).

### Tests and evidence

- Catalog tests use the real temp SQLite path: seed `series:tt12004706:2:4` failed, reconcile a successful auto play, assert the row is verified, then assert episode shaping returns `playable=true`. Other cases prove failed/picker writes do nothing and bare/`:1:1` stay on the existing gate path (`src/catalog-service/src/episode-playability-reconcile.test.ts:47-120`).
- Launcher tests prove fresh exact proof suppresses the false failure, while a genuinely active/pre-play abort and stale/failed proof do not (`src/launcher/src/playback-reconciliation.test.ts:36-59`). The UX gate runs these tests and checks that reconciliation precedes the grey override (`scripts/m6-ship/gate-m6-ux-smoke.sh`).
- Request-registry tests prove only the exact successfully finished request reports completion; unknown, failed, and actively cancelled requests do not (`src/catalog-service/src/play-request-registry.test.ts:49-73`).

Post-W1 complete matrix:

| Command | Result |
|---|---|
| catalog build | PASS |
| catalog full suite, clean run 1 | PASS — 606/606 |
| catalog full suite, clean run 2 | PASS — 606/606 |
| catalog fast gate, isolated | PASS — 280/280 |
| launcher build + UX gate | PASS — 25 modules; reconciliation 3/3; 2 expected off-Pi warnings |
| orchestrator suite | PASS — 83/83 |
| shell syntax + Python compile | PASS |
| playback SSOT source-only gate | PASS — 3 expected off-Pi warnings |

Honest failure record: one fast-gate invocation was accidentally run concurrently with the full suite. Both commands clean/rebuild the shared `dist` tree, producing unrelated missing/partial compiled-test failures. The fast gate was rerun alone and passed 280/280; the collided invocation is not represented as green.

Final-audit note: the explicit successful-request registry proof and two regression tests were added after this W1 checkpoint when diff review found `cancelled=false` was too ambiguous. They are reflected in the final 616/616 and 289/289 counts below.

Deferred — actual cgroup freeze/resume timing, long-episode start/end, mpv ownership, and the Pi SQLite/API before/after proof require the home Mac. Exact read-only checks and both success/failure couch cases are in `docs/COUCH_TEST.md:75-95`.

## W2 — source and resolver audit

Status: static wiring, parser, and policy work complete locally; live provider output deferred.

### Source/resolver map

| Provider / layer | Where wired | How it contributes and cache-status path | Verdict |
|---|---|---|---|
| AIOStreams | Example export points at Pi-local `:3035` (`config/stremio-export.example.json:9-11`). Every loaded manifest advertising `stream` for the requested type is selected and queried concurrently (`src/catalog-service/src/core.ts:576-588,2744-2749`). | Primary aggregator for configured upstream addons. Mango normalizes returned HTTP streams, parses explicit legacy metadata first and current formatter badges second, then applies the ladder (`src/catalog-service/src/core.ts:694-705`; `src/catalog-service/src/stream-filters.ts:593-645`). | **Fixed.** Parser now recognizes current `lightgdrive` `⚡/⏳` and Torrentio `+/download` shapes. Static and live-policy validators cover global/service/type/mode drift. |
| Torrentio | Not a standalone default export. It normally contributes inside AIOStreams and remains visible in the formatted name. If a standalone manifest is added, capability fan-out treats it like any other stream addon. | Cache status arrives through the AIO service badge. Tests cover `[RD+]` cached and `[TB download]` uncached (`src/catalog-service/src/stream-filters.test.ts:54-90`). | **Correct.** No duplicate default wiring; standalone capability is proven by `src/catalog-service/src/core-vod-filter.test.ts:51-72`. Live configured result is deferred. |
| Comet | No standalone default export; configured inside AIOStreams. | Same AIO formatter and debrid-service parse. Unknown badge remains unknown instead of being falsely classified (`src/catalog-service/src/stream-filters.test.ts:54-72`). | **Correct statically; live result deferred.** Mango must not assume the Pi's generated AIO profile contains it. |
| MediaFusion inside AIOStreams | Same AIO manifest and fan-out path. | Returned as part of AIO's stream list and parsed from the service badge/name. | **Correct statically; live result deferred.** |
| Optional direct MediaFusion | Secret URL is read only from env or the operator-owned config file. It supplements only a thin primary pool, is skipped if direct MF is already loaded, skips an empty primary hard-timeout, caps itself to remaining play budget, and URL-deduplicates the merge (`src/catalog-service/src/thin-stream-supplement.ts:7-94`; `src/catalog-service/src/core.ts:2778-2877`). | Adds unique direct MF HTTP streams after the primary fan-out, without replacing AIO results. | **Correct.** Existing tests cover threshold, timeout skip, direct-addon suppression, and URL merge. Pi configuration/result deferred. |
| TorBox | Debrid service configured inside the operator's AIOStreams profile; never stored in the repo patch. | `debridServiceId()` reads source, legacy group, formatter text, or host. Uncached TB is retained upstream and remains eligible in Mango's last-resort/obligation fallback (`src/catalog-service/src/stream-filters.ts:547-645`; `src/catalog-service/src/play-ladder.ts:578-615`). | **Fixed/locked.** Target explicitly has global exclusion false, OR mode, no type-wide uncached exclusion, and only RD service exclusion (`config/aiostreams-target-patch.json:13-16`). Tests prove uncached TB survives. |
| Real-Debrid | Same operator-owned AIO profile. | Current badges and legacy group are parsed. Uncached RD is excluded upstream by target policy and defense-in-depth in display, main/resort ladder, and obligation floor (`src/catalog-service/src/stream-filters.ts:642-645,1193-1249`; `src/catalog-service/src/play-ladder.ts:310-357,578-615`). Cached and safe unknown RD remain eligible. | **Fixed/locked.** Policy drift can no longer expose known-uncached RD to couch play. Live profile deferred. |
| Other exported addons | Cinemeta, AIOMetadata, Bharat Binge, and optional live manifests are listed in the example graph (`config/stremio-export.example.json:4-35`). | VOD boot removes only detected live exports. After manifests load, any remaining addon advertising `stream` for the requested type is queried; metadata-only addons are naturally skipped (`src/catalog-service/src/core.ts:518-524,576-588,2744-2749`). | **Correct.** No provider-name allowlist silently drops standalone stream sources. Live generated manifests determine which actually advertise `stream`. |

Primary-source audit basis: AIOStreams upstream commit `1ef423a62e4911244e6477b9bb11f0fd173f5483` defines `lightgdrive` as `⚡/⏳`, Torrentio as `+/download`, makes `bingeGroup` depend on autoplay attributes, and applies global plus OR/AND service/type uncached filters. This is why formatter text, not current `bingeGroup`, is the necessary fallback for Mango's target (`autoPlay.enabled=false` at `config/aiostreams-target-patch.json:50-55`). Upstream: [formatter definitions](https://github.com/Viren070/AIOStreams/blob/1ef423a62e4911244e6477b9bb11f0fd173f5483/packages/core/src/utils/formatter-definitions.ts), [cache filter](https://github.com/Viren070/AIOStreams/blob/1ef423a62e4911244e6477b9bb11f0fd173f5483/packages/core/src/streams/filterer.ts), and [binge-group generation](https://github.com/Viren070/AIOStreams/blob/1ef423a62e4911244e6477b9bb11f0fd173f5483/packages/core/src/transformers/utils.ts).

### Implemented correctness fixes

- Cache parser: added realistic current-format recognition while preserving legacy explicit group precedence (`src/catalog-service/src/stream-filters.ts:593-645`; fixtures at `src/catalog-service/src/stream-filters.test.ts:54-100`).
- Policy persistence: target patch now explicitly overrides stale `excludeUncached=true` and AND mode. Validator rejects those drifts (`config/aiostreams-target-patch.json:13-16`; `src/catalog-service/src/aiostreams-policy.ts:12-35`; tests at `src/catalog-service/src/aiostreams-policy.test.ts:8-35`).
- Live policy proof: added credential-safe `aiostreams-config.sh verify`; it fetches the profile but prints no keys. The prereq gate invokes it only when AIO is healthy (`scripts/m4-addons/aiostreams-config.sh:29-55,128-139`; `scripts/m4-addons/check-m4-prereqs.sh:104-132`).
- Defense-in-depth: known-uncached RD is rejected consistently in display filtering, every ladder phase, and the obligation floor. TorBox uncached, unknown-cache streams, all cached streams, and every provider fan-out remain available.
- Coverage proof: exported and tested capability matching for both string and typed-object Stremio resources. `filterVodAddonExports()` keeps AIOStreams, standalone Torrentio, and standalone MediaFusion while dropping only live (`src/catalog-service/src/core-vod-filter.test.ts:51-72`).

### Dead, duplicated, and deferred wiring

- `@stremio/stremio-core-web` WASM is initialized for readiness only; couch stream resolve uses direct manifest/resource HTTP fan-out (`src/catalog-service/src/core.ts:679-691,2744-2749`). **Deferred** — removing it changes boot/readiness architecture and was not needed for a correctness fix.
- `prefetchStreams()` has no caller (`src/launcher/src/catalog.ts:445-447`). **Deferred** — deleting dead exported API has no measured hot-path benefit and could affect an external/imported consumer not represented by local grep.
- `filterAndRankStreams()` is production-used by display telemetry; actual play selection separately expands main/resort/floor (`src/catalog-service/src/core.ts:729-770`). **Deferred to W3 measurement** rather than deleting response diagnostics.
- Runtime manifest capabilities, AIO's actual Torrentio/Comet/MediaFusion configuration, paid-provider results, and formatter output are **deferred** because this work Mac cannot access the Pi or its secrets.

Coverage argument: provider fan-out happens before Mango ranking and was not narrowed. The only newly rejected rows are known-uncached RD, which the locked target policy already requires AIOStreams to exclude. All cached RD/TB, unknown-cache RD/TB, uncached TB, optional direct MF, and obligation-floor fallbacks remain. No provider order, result limit, retry count, or source list changed.

Post-W2 complete matrix:

| Command | Result |
|---|---|
| catalog build + full suite | PASS — 611/611 |
| catalog fast gate | PASS — 284/284 |
| launcher build + UX gate | PASS — 25 modules; 3/3 reconciliation tests; 2 expected off-Pi warnings |
| orchestrator suite | PASS — 83/83 |
| shell syntax + Python compile | PASS |
| playback SSOT source-only gate | PASS — 3 expected off-Pi warnings |

Honest failure record: the first post-defense catalog run failed four legacy expectations that used known-uncached RD as an allowed last-resort example. The implementation matched the locked spec; the fixtures were corrected to use uncached TB or safe unknown-cache RD as appropriate. The clean rebuilt suite then passed 611/611. No failing run was counted green.

## W3 — resolve-to-play efficiency and robustness

Status: safe high-confidence subset complete; numeric and observability tradeoffs deferred measurement-first.

### Implemented changes and efficiency deltas

1. **Same-title foreground/background amplification guard.** Equivalent requests still join the exact flight. If a background request with different retry/cross-probe behavior arrives during a user flight, it now waits for the user flight, then re-enters with its own options/deadline. A cacheable couch result eliminates the second provider fan-out; an empty/transient result permits a sequential background retry only after couch capacity is released. A user request continues to bypass an older background request with its own deadline (`src/catalog-service/src/core.ts:2637-2698`).
   - Delta: removes one simultaneous N-addon fan-out for every overlapping different-behavior background request on the same title; may remove it entirely on positive cache fill.
   - Safety: it never makes the user await a background deadline and never gives background retries to the user path. Metric `background_defer_foreground` makes the behavior observable (`src/catalog-service/src/resolve-metrics.ts:1-21`).
   - Tests prove background cannot start beside a live couch flight and retains its own options after waiting, while user still bypasses an older background with its own deadline (`src/catalog-service/src/core-invalidate-streams.test.ts:58-127`).

2. **Prepared verification candidate reuse.** `prepareVerifyTitle()` now carries the exact main-ladder candidates it already computed; `verifyPreparedTitle()` passes them to `probeWithLadder()` instead of expanding identical streams/config/context again (`src/catalog-service/src/playability/verify.ts:62-78,271-322,338-379`; `src/catalog-service/src/play-orchestrator.ts:390-437`).
   - Delta: exactly one redundant `expandPlayLadder()` call removed from every successful prepared verification. Resolve count, candidates, order, maximum attempts, fallback depth, and probe behavior are unchanged.
   - Test passes a pre-expanded candidate with an empty raw stream array and proves it is the sole candidate probed (`src/catalog-service/src/play-orchestrator.test.ts:231-246`).

3. **Play-deadline cap audit.** No code change was needed: every per-addon fetch uses its request-class cap bounded by remaining play time, and direct MF supplement uses the same remaining-deadline cap (`src/catalog-service/src/core.ts:2853-2866,2893-2919`). This closes the audit item without pretending a runtime timing pass.

### Measurement-first deferrals

- **Display telemetry recomputation:** every `GET /stream` runs diagnostic `filterAndRankStreams()` plus main, resort, and obligation-floor expansion (`src/catalog-service/src/core.ts:729-770`), then `POST /play` selects again. **Deferred** because the response/gates consume these diagnostics and there is no local CPU/latency profile showing meaningful impact. Recommendation: add timing/counter telemetry around `displayStreamTelemetry()` on Pi, then consider an explicit diagnostics flag or single-pass summary only if p50/p95 cost is material.
- **Detail-open resolve reuse:** launcher detail `GET /stream` times out at 15 s (`src/launcher/src/catalog.ts:430-434`) while user provider fetches may take 30 s (`src/catalog-service/src/core.ts:361-373`); later `POST /play` benefits only if the 10-minute positive cache was filled. **Deferred** because cross-request reuse/state can serve stale results or alter retry semantics. Recommendation: first measure detail timeout frequency, cache-fill-after-client-abort, and open-to-play interval; then design an explicit resolve token only if evidence warrants it.
- **Three play phases:** main, last-resort, and obligation floor are separate safety semantics, not identical repeated work. **Deferred** because collapsing them risks fallback coverage. Candidate preparation reuse above removes only the provably identical expansion.
- **Budget stack:** 85 s server (`src/catalog-service/src/play-deadline.ts:1-25`), 90 s play proxy / 60 s non-play proxy (`src/mango-ui-server/serve.py:35-36,883-887`), 95 s launcher play timer (`src/launcher/src/catalog.ts:507-585`), 90 s auto-play wall plus 8 s/25 s probe defaults and 12 attempts (`src/catalog-service/src/stream-filters.ts:970-990`), and 30 s/12 s user/background provider caps (`src/catalog-service/src/core.ts:361-373`). **Deferred by contract.** Recommendation: capture per-stage p50/p95/p99 and cancellation/freeze timestamps before proposing a coherent nesting change.
- **Provider caps/order/result limits:** **deferred** because changing them can reduce coverage or change ranking. Measure per-addon latency, unique winning contribution, and rate-limit incidence first.
- **Persistent probe-pool memory and playability concurrency:** **deferred** because only the Pi can provide RSS, worker lifetime, pressure, and real provider timing; defaults were not changed.
- **Dead launcher prefetch and Stremio WASM readiness:** reported in W2, not removed without consumer/boot measurements.

Post-W3 complete matrix:

| Command | Result |
|---|---|
| focused compiled W3 Node tests | PASS — 29/29 |
| catalog build + full suite | PASS — 614/614 |
| catalog fast gate | PASS — 287/287 |
| launcher build + UX gate | PASS — 25 modules; 3/3 reconciliation tests; 2 expected off-Pi warnings |
| orchestrator suite | PASS — 83/83 |
| shell syntax + Python compile | PASS |
| playback SSOT source-only gate | PASS — 3 expected off-Pi warnings |

## Follow-up — popular movie stream lists and Dune stutter

### Diagnosis

- **The invisible list was a client/server budget race, not proof of zero streams.** Movie detail aborted `GET /stream` after 15 seconds while the user-class provider resolve is intentionally allowed 30 seconds because popular titles can take roughly 18–25 seconds. The launcher caught that timeout, replaced the result with `[]`, and hid the entire stream section. The Python proxy and catalog request could continue, fill the positive cache, and make a later Play succeed—exactly matching “Dune plays even though no list appeared.”
- **The apparent absence of unverified rows had the same cause.** The response never reached the display ladder, so neither main nor last-resort rows could render.
- **Dune stutter had a separate deterministic policy risk.** When no cached smooth main candidate existed, the hifi last-resort ladder preferred cached software-decoded 4K before uncached 1080p TorBox. That chose nominal resolution over the Pi’s decode-safe tier. Nominal 4K is not automatically smooth 4K: the current box treats SDR HEVC as hardware-safe; HDR tone mapping and 4K AV1/H.264 stay unverified until real target-TV proof.

### Implemented fix

1. **No-retune late join.** `CatalogTimeoutError` distinguishes a bounded browse timeout from other catalog errors. Movie detail retries only that timeout with `existing_only=1`. Catalog-service returns a positive cache entry or joins the identical in-flight user resolve; if neither exists, it returns empty and cannot start provider work. This preserves the existing 15 s/30 s defaults and eliminates duplicate fan-out risk.
2. **Honest detail state.** A true empty now leaves a visible `streams · none found` label. A failed late join leaves `streams · unavailable — Play retries`; the entire section no longer silently disappears.
3. **Smoothness before nominal resolution.** The 4k-hifi last-resort order is now `1080p_uncached_fallback` → `4k_sdr_soft_cached` → `last_resort`. Uncached RD remains excluded; uncached TorBox remains retained. Soft/HDR 4K remains available after the smoother attempt, so stream coverage is unchanged.
4. **Regression locks.** Catalog tests prove late recovery joins one flight and cannot fan out after it ends. Launcher tests prove only typed timeouts trigger a late join. Ladder/SSOT checks prove smooth 1080p precedes soft 4K while both remain candidates.

### Verification boundary

Focused local build/tests passed before the final clean matrix: catalog-service build; 7/7 flight/invalidation tests; launcher build (26 modules); and 11/11 launcher timeout/reconciliation tests. Actual provider inventories for The Martian (`tt3659388`) and Dune 2021 (`tt1160419`), live debrid cache status, real late-join timing, and dropped-frame/decoder proof are **deferred — home Mac/Pi required**. Exact steps are in `docs/COUCH_TEST.md`.

## Final clean local verification

The complete §3 matrix was rerun sequentially after the follow-up implementation and self-review:

| Exact command | Result |
|---|---|
| `git branch --show-current` | PASS — `feat/native-experience` |
| `cd src/catalog-service && npm run build && npm test && npm run test:gate` | PASS — full 619/619; fast gate 292/292 |
| `cd src/launcher && npm run build && bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh` | PASS — 26 modules; launcher timeout/reconciliation 11/11; 2 expected off-Pi warnings |
| `PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests` | PASS — 83/83 |
| `bash -n scripts/m2-catalog/service/mpv-play.sh scripts/m2-catalog/service/mpv-stop.sh scripts/m3-play/playability/mpv-probe-ipc.sh scripts/lib/couch-activity.sh scripts/m6-ship/gate-m6-playback-ssot.sh` | PASS |
| `python3 -m py_compile src/mango-ui-server/serve.py` | PASS |
| `MANGO_REPO_DIR="$PWD" MANGO_GATE_SOURCE_ONLY=1 MANGO_MPV_STOP_LAUNCHER=1 MANGO_MPV_DEFER_FOREGROUND=1 bash scripts/m6-ship/gate-m6-playback-ssot.sh` | PASS — 3 expected off-Pi warnings |

The two UX warnings were launcher/pad runtime unavailable off-Pi. The three SSOT warnings were runtime HDMI enforcement, mpv binary, and systemd `CanFreeze`; none was converted into a pass. `git diff --check` also passed after the matrix. One preliminary SSOT invocation omitted `MANGO_REPO_DIR`, failed before the gate at `cd $HOME/mango`, and was corrected by running the exact §3 command above; it was never counted as a pass.

The optional independent GPT-5.5 diff-review lane did **not** produce a verdict: the initial 120-second run and one bounded 240-second retry both returned `codex_unavailable` after timeout. No silence was treated as approval. The required audit entries are retained in `.orchestration/feedback.jsonl`; correctness claims above rest on direct code review and the reported local tests only.

## Pi-only handoff added to `docs/COUCH_TEST.md`

- Episode success reconciliation: read-only SQLite and episode API before/after proof, no late timeout toast/grey state, real pre-play failure remains visible, and bare/`:1:1` gate regression check (`docs/COUCH_TEST.md:75-95`).
- Source policy and load: credential-safe live AIO policy verification, real formatter/cache shapes, configured Torrentio/Comet/MediaFusion source labels, optional direct MF dedupe, foreground priority, and background amplification journal evidence (`docs/COUCH_TEST.md:97-125`).
- Popular-title playback: cold-cache The Martian/Dune lists, equivalent-flight join/no duplicate fan-out, installed hifi-profile refresh, smooth 1080p-before-soft-4K ordering, and real decoder/dropped-frame proof (`docs/COUCH_TEST.md:127-160`).

Deferred — these checks require the home Mac/Pi: live AIO user profile and generated manifest; RD/TB/Torrentio/Comet/MF responses; actual fan-out/journal concurrency; mpv start/end and cgroup freeze/resume; the before/after playability DB row; and couch visuals/input. None is reported as passed here.

## Reviewer and home-Mac handoff

- Review the pushed change set on `feat/native-experience`; this report and
  `HOME_PI_PLAYBACK_LIVE_VALIDATION_CODEX_SPEC.md` are part of the handoff.
- Re-run the §3 matrix independently from a clean catalog `dist`.
- Follow the tracked home-Mac specification and only the git-based split-machine
  deploy flow, then perform every unchecked Pi row in `docs/COUCH_TEST.md`.
- Do not promote this report's local source-only gates into Pi playback claims.

## Follow-up — Native Mango Live curation and playable search

Status: implemented and verified locally on `feat/native-experience`;
Pi/runtime proof is deferred to the tracked home-Mac handoff. No deploy, SSH,
`pi-exec`, or `pi-deploy` action was performed on the work Mac. Commit/push was
performed only after the user explicitly authorized the final handoff.

### Root causes confirmed

1. Live rail admission flattened identity, programme, genre, and description
   into broad keyword text. Generic multiplexes, adjacent competitions, replay
   labels, and incidental team words could therefore qualify before ranking.
2. AREA69's compact-index builder treated every `VS`/date event row as noise.
   Legitimate current matches disappeared from the full search index together
   with the placeholders it intended to reject. Neither the index nor rail
   cache had an incompatibility boundary for the new membership semantics.
3. NexoTV current-programme/language fields were not fully preserved, curated
   M3U EPG was disabled, and the cartoon inventory contained unknown/foreign
   variants. Standing sport channels could not be qualified safely.
4. Live quality scoring treated 2160p/3840 as the top tier. Search was a title
   match over local inventories/cache with no persistent real-play health, so
   known-dead and never-tested rows could surface as if playable.
5. `/play` selected the first URL that delivered bytes and invoked mpv once. A
   playback-start failure did not advance to a same-channel/event alternative,
   and outcomes did not improve later search ordering.

### Implemented policy and data changes

- Added typed optional rail policies for senior men's FIFA World Cup matches,
  India-participant cricket, the Big Five plus UCL/UEL, four exact F1 brands,
  the exact 12-channel news target, and English/Hindi-only cartoon families.
  Qualification uses distinct identity, current programme, category, language,
  and structured event fields before canonical dedupe and quality ranking.
- Kept six rails in existing order, capped them at 8/8/8/4/12/8, and retained
  only the four approved inventories: `mango Live TV` (AREA69), `mango Live
  Free`, `mango Live News`, and `mango Live Cartoons`. Empty qualified rails are
  omitted by the existing Live response builder.
- Enabled EPG for curated free M3U profiles. Rebuilt cartoon curation to join
  IPTV-org channel-language metadata, reject unknown/mixed foreign variants,
  select classics first, and emit one stream for at most eight approved
  families. The checked-in playlist now has seven explicitly English rows;
  missing families shrink the rail.
- AREA69 search index v2 retains real current event-shaped rows and safe
  competition/team/timing metadata while rejecting ended/replay/offline,
  placeholder, season-pack, and VOD rows. Credential-shaped source and artwork
  data is never persisted. Legacy v1 indexes now return incompatible/empty
  until rebuilt. Live rail disk cache policy v2 similarly rejects legacy broad
  snapshots rather than serving them as stale fallback.
- Corrected quality tiers: explicit 8K/4320p is top; 4K/UHD/2160p/3840 follows;
  then 1080p/720p/SD. After eligibility/proof, resolution outranks
  English/Hindi, codec, and fresh measured health.

### Playable full-catalog search and playback failover

- `GET /voice/search?tab=live&q=...` is an additive live-only form of the
  existing response contract. It searches the full configured local free-IPTV
  catalogs plus AREA69's full v2 index, independent of thin browse rails.
- Added an operator-owned registry at
  `~/.cache/mango/live-channel-health.json`. Keys are SHA-256 source/id
  identities; raw channel IDs, sources, URLs, and credentials are not stored.
  Writes are serialized, atomic, mode 0600, and failure reasons are sanitized.
  Freshness reuses the existing Live cache horizon—no TTL was added or retuned.
- Fresh verified results return immediately; fresh failures are suppressed.
  Search selects at most one unknown free-IPTV and one unknown AREA69 candidate
  per response, deduplicates in-flight proof, and waits at most the approved
  2-second response allowance. Unfinished headless-mpv proof stays hidden and
  continues asynchronously for a later search. Any active Mango playback
  blocks background validation; AREA69 therefore never spends its one
  connection beside foreground playback.
- Canonical same-channel/event variants expose one search/browse leader.
  `/play` expands the selected logical item into a resolution/language/codec/
  health-ordered ladder, performs reachability and playback-start attempts, and
  advances after a failed variant under the unchanged overall play deadline.
  Successful real plays promote the actual working variant; reachability and
  play-start failures demote the actual failing variant. One unavailable
  configured source no longer erases the other Live inventories.
- `/health.live.search_health` additively reports qualified, verified, failed,
  queued, unknown, total, and stale counts. Existing API response fields and
  existing channel IDs remain accepted.

No existing timeout, provider budget, concurrency, cache TTL, NexoTV verify
rate, or play deadline was changed. `verify_streams: false` remains unchanged;
the only new numeric behavior is the explicitly approved hard 2-second Live
search response allowance. No source coverage was reduced outside the approved
rail curation: full-catalog native search still sees all four allowed local
inventories.

### Tests added

- Classifier fixtures cover FIFA qualifiers/replays/ended/adjacent events,
  India versus West Indies/incidental `Indian`, every approved soccer
  competition, EPG-only standing proof, generic broadcaster rejection, exact
  F1/news allowlists, and English/Hindi cartoon evidence.
- Config/rail tests cover the exact four-source restriction, all six policies,
  2160p versus 4320p, language tie-breaking, canonical one-item-per-event
  grouping, and incompatible stale-cache rejection.
- AREA69/Python tests cover legitimate event retention, replay/placeholder/VOD
  rejection, v2 incompatibility, credential-safe metadata, and compact-M3U
  standing-channel behavior. Cartoon tests cover language joins, localized
  feed rejection, classics-first selection, the eight-family cap, and the
  checked-in playlist.
- Search/play tests cover persistent health, fresh-failure suppression, the
  2-second bound, one candidate per inventory class, async completion, queued
  diagnostics, active-playback AREA69 exclusion, and playback variant failover.

### Final clean local verification

| Exact command | Result |
|---|---|
| `git branch --show-current` and `git rev-list --left-right --count HEAD...origin/feat/native-experience` | PASS — `feat/native-experience`; `0 0` after fetch, so no pull/switch was needed |
| `cd src/catalog-service && npm run build && npm test && npm run test:gate` | PASS — clean build; full 656/656; fast gate 301/301 |
| `python3 scripts/live/test_build_curated_area69_m3u.py` | PASS — 4/4 |
| `python3 scripts/live/test_build_curated_cartoons_m3u.py` | PASS — 4/4 |
| `python3 -m py_compile scripts/live/build-curated-area69-m3u.py scripts/live/test_build_curated_area69_m3u.py scripts/live/build-curated-cartoons-m3u.py scripts/live/test_build_curated_cartoons_m3u.py src/mango-ui-server/serve.py` | PASS |
| `cd src/launcher && npm run build && bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh` | PASS — 26 modules; 15/15 launcher tests; 2 expected off-Pi warnings |
| `PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests` | PASS — 83/83 |
| `bash -n scripts/m2-catalog/service/mpv-play.sh scripts/m2-catalog/service/mpv-stop.sh scripts/m3-play/playability/mpv-probe-ipc.sh scripts/lib/couch-activity.sh scripts/m6-ship/gate-m6-playback-ssot.sh` | PASS |
| `MANGO_REPO_DIR="$PWD" MANGO_GATE_SOURCE_ONLY=1 MANGO_MPV_STOP_LAUNCHER=1 MANGO_MPV_DEFER_FOREGROUND=1 bash scripts/m6-ship/gate-m6-playback-ssot.sh` | PASS — 3 expected off-Pi warnings |
| `git diff --check` | PASS |

Honest failure record: one preliminary Python unittest command was run from
`src/catalog-service` with repo-relative paths and failed import; a later
root-level combined command tried `npm run build` where no root `package.json`
exists. Both were rerun from the correct directories and were never counted as
passes. The first fast-gate attempt also had one timing-sensitive
`scoped-child` assertion miss its child `started` output (299/300); the complete
656-test suite had passed it, an immediate clean gate rerun passed 300/300, and
the final clean gate after all edits passed 301/301. The failed attempt is not
hidden or green.

### Pi-only handoff — deferred

`docs/COUCH_TEST.md` now contains exact home-Mac/Pi steps for rebuilding the
AREA69 v2 index, applying EPG-enabled free/news/cartoon profiles, clearing the
legacy Live rail cache, inspecting six-rail membership, timing native
full-catalog search, verifying that active playback blocks AREA69 proof, checking
credential-safe health state, and couch-playing a representative fallback
ladder. Actual AREA69 inventory, NexoTV EPG delivery, provider reachability,
search latency, single-connection behavior, and mpv playback were not available
on this work Mac and are explicitly **deferred — home Mac/Pi required**.
