# Mango efficiency + stream-sources audit & episode-grey bug fix — Codex task spec

You are an autonomous coding agent working in the **mango** repository at
`/Users/aman.shrivastava/Documents/personal/projects/mango`. You have **no access to any prior chat**.
This file is the entire contract. **Read it top to bottom before touching anything.**

Mango is an AI TV box that runs on a **Raspberry Pi 5** (constrained CPU/RAM). This machine is a
**work Mac that cannot reach the Pi** — you run everything **locally** (build/test/gates) and leave
your work in the tree for a human reviewer, who commits and hands off to a separate home Mac that
deploys to the Pi. You never deploy or validate on hardware yourself.

---

## §0 — TL;DR mission

Make mango's playback + catalog stack **faster, more efficient, and more robust** at pulling
playable streams from every configured source/resolver so playback starts with the best stream as
fast as possible — **without any UX regression or loss of stream coverage** — and fix one concrete
user-visible bug. Deliver in this dependency order:

1. **W1 — Episode "played-but-greyed / catalog timed out" bug (fix + tests).** Highest priority; root cause is already located (see §4/§6).
2. **W2 — Stream source & resolver audit (RD, TorBox, AIOStreams, MediaFusion, Torrentio).** Verify every configured source is wired correctly and contributes to resolution/ranking; fix high-confidence wiring/correctness defects; report the rest.
3. **W3 — Resolve→play efficiency & robustness.** Remove redundant/duplicated hot-path work and close robustness gaps that are safe and high-confidence; report (do not blindly retune) anything touching tuned numeric defaults.
4. **W4 — Audit report + measurement.** One markdown report capturing findings, what you changed, what you deferred (with reasons), and evidence.

## §0.1 — Overriding principle (non-negotiable filter)

**Every change must preserve couch UX and "playback-for-sure," and must not reduce the set of
playable streams mango can pull.** Efficiency is secondary to correctness and coverage. If a change
would make resolution faster but riskier (fewer candidates, weaker fallback, tighter timeout that
could false-fail a real title), **do not make it — write it up in the report with evidence instead.**
Never fabricate or overstate a passing check: an unverifiable/deferred item must read as *deferred
with an exact reason*, never as green.

---

## §1 — Hard constraints

### MUST NOT
- **No SSH to the Pi. No `scripts/pi-*.sh` (pi-exec, pi-deploy, pi-exec-gate). No rsync/scp to the Pi.** There is no retry path from this machine.
- **Do not commit, push, tag, `git config`, `git commit --amend`, or `--no-verify`.** Leave all work in the working tree for the reviewer.
- **Do not switch branches.** Verify with `git branch --show-current`; expected `feat/native-experience`. If it differs, **STOP and report.**
- **Do not add dependencies** (no new npm/pip packages).
- **Do not change tuned numeric defaults this round** unless a workstream explicitly authorizes it. Treat these as *report-only* knobs (list, not exhaustive): `PLAY_SERVER_BUDGET_MS` (85000, `play-deadline.ts`), proxy `CATALOG_PLAY_PROXY_TIMEOUT_SEC`/`CATALOG_PROXY_TIMEOUT_SEC` (90/60, `serve.py`), launcher play/stream/rails timeouts (95000/15000/12000, `catalog.ts`), `STREAM_RESOLVE_BUDGET_USER_MS`/`STREAM_RESOLVE_BUDGET_MS` (30000/12000), `auto_play_wall_ms`/`auto_play_probe_ms`/`auto_play_uncached_probe_ms`/`auto_play_max_attempts`, obligation reserve/attempts, cache TTLs, all `MANGO_PLAYABILITY_*` concurrency values. You MAY *propose* retunes in the report with reasoning; you MAY NOT change them.
- **Do not weaken debrid/source policy.** TorBox uncached must remain **retained**; Real-Debrid uncached must remain **excluded** (`config/aiostreams-target-patch.json`, `aiostreams-policy.ts`). Do not reduce provider coverage.
- **Do not touch** the gamepad/input stack, live IPTV (NexoTV/Area69) gating, or voice pipeline except where a defect you are fixing directly requires it (and then call it out).
- **Do not fabricate measurements.** If you cannot measure something locally (anything needing the Pi/HDMI/real mpv/real debrid), record it as **deferred — <exact reason>** and add a Pi verification step to `docs/COUCH_TEST.md` for the home Mac.

### MUST
- Work **locally only**: implement, then `build` + `test` + `gates` after each workstream (§3).
- Ground **every** change in primary source (the actual code/config in this repo, and where relevant the official docs for RD/TorBox/AIOStreams/Stremio addon protocol/mpv/Pi). Cite file:line in the report.
- Keep changes **minimal and principled** — no speculative rewrites, no new abstractions unless removing net complexity.
- Append progress to the report file (§4) as you close each workstream.
- Preserve all existing gate contracts (the SSOT/UX gates must still pass).

### Tool authority (explicit)
- You **may** run: `npm`/`node`/`tsc`, the repo's test and gate scripts, `bash -n`, `python3 -m py_compile`, `git status`/`git diff`/`git log`/`git branch` (read-only git), `sqlite3` against **local** temp DBs you create, `rg`.
- You **may not** run: anything that reaches the Pi, any deploy, `git` mutating commands, package installs.

---

## §2 — Repository map (absolute paths)

### Catalog service (TypeScript, ESM, Node ≥20) — `src/catalog-service/src/`
- `index.ts` — HTTP routes; `handlePlay()` (~L405–823); post-play verify/demote writes; `POST /play`, `GET /stream`, `GET /series/:id/episodes`, `GET /play/next-prompt`, `POST /progress/flush`, `POST /playability/invalidate`.
- `core.ts` — addon fan-out + caches; `resolveForPlay()` (~L2004–2076), `streams()` (~L2078–2197), `rawStreams()` (~L2592–2685), `performRawStreamResolve()` (~L2687–2806), `fetchAddonStreams()` (~L2879–2906), `fetchJson()` (~L538–574), `invalidateStreams()` (~L1002–1030), `displayStreamTelemetry()` (~L729–772), `buildStreamFilterContext()` (~L1960–2001), `seriesEpisodes()` (~L1932–1959).
- `stream-filters.ts` — `filterAndRankStreams()` (~L1153–1240), `streamPlayScore()` (~L856–912), `parseDebridCacheStatus()` (~L620–632), `debridServiceId()` (~L558–587), `mergeFilterConfig()`, `loadFilterConfig()` (~L980–1065), default budgets (~L965–968).
- `play-ladder.ts` — `defaultPlayLadder()`, `splitLegacyPlayLadder()` (~L116–135), `expandPlayLadder()` (~L485–543), `selectDisplayStreamCandidates()` (~L668–708), `expandObligationFloor()` (~L576–635), `couchStatusForLadderStep()` (~L737–770), `diversifyLadderCandidatesByService()` (~L439–482).
- `play-orchestrator.ts` — `playWithLadder()` (~L610–840), `probeWithLadder()` (~L388–485), `attemptOne()` (~L211–385).
- `aiostreams-policy.ts` — `targetPolicyExcludesUncached()`, `validateAioStreamsTargetPolicy()` (gate/test only today).
- `thin-stream-supplement.ts` — MediaFusion optional supplement (`shouldSupplementThinStreams()`, budget ~8000ms).
- `stream-flight.ts` — single-flight key helpers.
- `stream-bad-cache.ts` — session bad-URL cache (in-process only).
- `mpv.ts` — `probeUrl()`, `playUrl()`, `runMpv()`, `parseMpvSuccessOutput()`.
- `episodes.ts` — `applyEpisodePlayability()` (~L203–225), episode row shaping.
- `playability/ids.ts` — `isSeriesRailGateId()` (~L34–40), `seriesBareId()`, `normalizeSeriesVerifyId()`, `canonicalTitleId()`.
- `playability/db.ts` — `recordVerifyResult()`, `invalidateTitle()`, `demoteTitle()`, `getTitlePlayability()`, `getTitlesPlayabilityBulk()`, `getTitleVerifyProfile()`.
- `playability/verify.ts` — `prepareVerifyTitle()` (~L270–334), background probe path.
- `playability/trigger-consumer.ts` — idle-gated background verify drain.
- `playability/mpv-probe-pool.ts` — persistent maintenance probe workers.
- `playability/config.ts` — all `MANGO_PLAYABILITY_*` knobs.
- Tests live next to sources as `*.test.ts` (run via `node --test dist/**`). Fast gate list: `scripts/lib/gate-catalog-unit.sh`.

### Launcher (TypeScript + Vite) — `src/launcher/src/`
- `detail.ts` — `play()` (~L361–489, snapshot at ~L383, grey override on failure ~L450–465), `refreshAfterPlayback()` (~L131–144), `restoreAfterPlayback()` (~L146–158), `loadEpisodeList()` (~L1087–1116), `renderEpisodes()`/`createEpisodeButton()` (~L1169–1284, server-driven grey ~L1272–1277), `setEpisodeStreamBadge()` (~L940–952).
- `catalog.ts` — `playCard()`/`fetchPlayJson()` (abort→`playTimeoutMessage()` ~L614–616/647–649), `loadSeriesEpisodes()`, `flushProgress()`, timeouts (play 95000, stream 15000, rails 12000, cancel 2500).
- `catalog-errors.ts` — `playTimeoutMessage()` → `"catalog timed out — try again"`.
- `main.ts` — `handlePlaybackReturn()` (~L843–860), `restorePlaybackSurfaceIfNeeded()` (~L869–905), `restoreDetailFromSnapshot()` (~L927–962), `setStatus()` (~L1054–1060).
- `playback-return.ts` — return snapshot save/read.
- `next-prompt.ts` — next-episode overlay + `playNext()`.
- `style.css` — `.detail-episode--no-streams` (grey, ~L1239–1251), `.detail-episode-stream-badge`.

### UI proxy — `src/mango-ui-server/serve.py` (localhost proxy; play vs non-play timeouts).

### Config — `config/`
- `catalog-filters.example.json`, `catalog-filters.4k-hdr.example.json`, `catalog-filters.4k-hifi.example.json` (runtime: `/etc/mango/catalog-filters.json`).
- `aiostreams-target-patch.json` (RD/TorBox uncached policy, dedup, sort, result limits).
- `stremio-export.example.json` (addon manifest graph; runtime `/etc/mango/stremio-export.json`).

### Scripts (hot path / gates)
- `scripts/m2-catalog/service/mpv-play.sh`, `mpv-stop.sh`; `scripts/lib/couch-activity.sh`, `scripts/lib/restore-launcher-after-playback.sh`.
- `scripts/m3-play/playability/mpv-probe-ipc.sh`, `mpv-probe-pool.sh`.
- Gates: `scripts/m6-ship/gate-m6-playback-ssot.sh`, `scripts/m6-ship/gate-m6-ux-smoke.sh`, `scripts/lib/gate-catalog-unit.sh`.

### Docs — `docs/ARCHITECTURE.md`, `docs/PLAYABILITY.md`, `docs/COUCH_TEST.md`, `docs/STATUS.md`, `docs/ROADMAP.md`.

---

## §3 — Environment, build, test, gates

Run from repo root unless noted. Node ≥20, Python 3.

```bash
# 0. Sanity
git branch --show-current            # must print feat/native-experience

# 1. Catalog service — build + full suite + fast gate
cd src/catalog-service
npm run build                        # runs clean-dist then tsc; DO clean to avoid stale dist/*.test.js
npm test                             # full node --test suite
npm run test:gate                    # fast safety gate (scripts/lib/gate-catalog-unit.sh)
cd ../..

# 2. Launcher — build + UX smoke gate
cd src/launcher
npm run build                        # tsc --noEmit && vite build
bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh   # 2 off-Pi warnings expected (launcher/pad not running)
cd ../..

# 3. Orchestrator python
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests

# 4. Shell syntax + playback source contract gate (source-only, off-Pi)
bash -n scripts/m2-catalog/service/mpv-play.sh scripts/m2-catalog/service/mpv-stop.sh \
        scripts/m3-play/playability/mpv-probe-ipc.sh scripts/lib/couch-activity.sh \
        scripts/m6-ship/gate-m6-playback-ssot.sh
python3 -m py_compile src/mango-ui-server/serve.py
MANGO_REPO_DIR="$PWD" MANGO_GATE_SOURCE_ONLY=1 MANGO_MPV_STOP_LAUNCHER=1 MANGO_MPV_DEFER_FOREGROUND=1 \
  bash scripts/m6-ship/gate-m6-playback-ssot.sh
```

Gotchas:
- `npm test` in catalog-service can fail on **stale `dist/*.test.js`** for deleted sources. `npm run build` runs `scripts/clean-dist.mjs` first; always build before test. If a phantom test file for a source that no longer exists fails, delete the stale `dist/...js` + `dist/...test.js` and rebuild.
- Orchestrator tests need `PYTHONPATH=src/orchestrator` or they `ModuleNotFoundError`.
- The SSOT gate's `playback policy examples and docs agree` step greps `docs/PLAYABILITY.md`/`docs/STATUS.md` for required tokens — if you change that doc, keep the required substrings intact (read the gate's Python block before editing docs).

---

## §4 — Background & current state

- Branch `feat/native-experience`; a large playback-hardening round just landed (deadline/cancel/ownership/probe/stream-policy). A follow-up Pi fix corrected a duration-parse bug: `mpv-play.sh` logs a `min_duration_sec=600` preamble before `PASS`, and a naive `/duration_sec=/` regex matched it (`mpv.ts parseMpvSuccessOutput` now prefers the `PASS:` line). **Lesson: parsing/logic was tested only against synthetic fixtures, never against real `mpv-play.sh` stdout.** Apply the same rigor here — test against realistic outputs and real config shapes, not hand-crafted happy-path strings.
- Pi 5 constraints: limited CPU/RAM; systemd caps catalog-service at MemoryMax ~1280M. Persistent mpv probe workers and parallel addon fan-out are the main load amplifiers.
- **Observed bug (W1), reported by the user:** playing a TV **episode** worked start-to-finish, but when playback **ended** the couch showed a **"catalog timed out"** error and that exact episode is now **greyed with "tap to retry"** — even though it just played fine.

### W1 root cause (already located — confirm against code, then fix)
Two independent defects converge:

1. **Grey persists after a successful play.** In `index.ts handlePlay`, `usePlayabilityIndex = body.type !== 'series' || isSeriesRailGateId(playId)` (~L601). `isSeriesRailGateId` is **true only for a bare `tt…` id or `tt…:1:1`** (`playability/ids.ts:34–40`). For any other episode (`tt…:S:E`), `usePlayabilityIndex` is **false**, so **both** the success path (`recordVerifyResult` verified, ~L645–697) **and** the failure path (`invalidateTitle`/`demoteTitle`, ~L740–801) are skipped. Meanwhile `applyEpisodePlayability` (`episodes.ts:203–225`) renders **any** episode whose playability row is `status='failed'` as `playable=false` → grey "tap to retry" (`detail.ts:1272–1277`). Per-episode `failed` rows are produced by the **background verify/grow pipeline** (`playability/verify.ts`, trigger consumer, nightly indexer), not by couch play. Net asymmetry: the background pipeline can mark an episode `failed`, but a **successful couch play of that exact episode can never clear it** → permanent grey on a title that plays fine.
2. **False "catalog timed out" at end of playback.** The launcher cgroup is **frozen during playback** (SSOT gate: "launcher cgroup frozen during playback"). The client `playCard` fetch arms a 95s abort timer (`catalog.ts`); while frozen, both that timer and the fetch's resolution are suspended. On return after a long episode, the abort can win the race → `fetchPlayJson`/`playCard` throw `playTimeoutMessage()`; `detail.play()`'s catch shows the toast **and** calls `setEpisodeStreamBadge(episodeId, false)` (grey) — for a play that actually succeeded (`detail.ts:450–465`). The exact freeze/timer interaction is inferred; confirm the mechanism from code and add Pi confirmation to `COUCH_TEST.md` (you cannot repro on hardware).

Supporting reads: `main.ts restorePlaybackSurfaceIfNeeded` (~L869–905) calls `detail.refreshAfterPlayback` → `loadEpisodeList` → server `seriesEpisodes` → `applyEpisodePlayability`; the return snapshot (`playback-return.ts`) records that a real playback occurred.

### Read-only runtime diagnostics (for the home Mac to confirm on Pi — put in COUCH_TEST.md)
```bash
sqlite3 ~/.cache/mango/playability.db \
  "SELECT type,id,status,fail_reason,expires_at,updated_at FROM titles WHERE id LIKE 'tt%:_:_%';"
curl -sf "http://127.0.0.1:3020/series/<bareSeriesId>/episodes" | jq '.. | .playable? // empty'
```

---

## §5 — Existing tooling to reuse (reuse-first)

| Need | Reuse this | Notes |
|------|-----------|-------|
| Clear/refresh a title's playability truth | `recordVerifyResult()` / `getTitlePlayability()` / `invalidateTitle()` / `demoteTitle()` (`playability/db.ts`) | Same helpers the play/verify paths use; do not write raw SQL. |
| Know if an id is the rail-gate id | `isSeriesRailGateId()` (`playability/ids.ts`) | The gate that currently excludes non-S1E1 episodes. |
| Episode → playable mapping | `applyEpisodePlayability()` (`episodes.ts`) | Read side that greys `failed` rows. |
| Detect a real playback happened on return | `playback-return.ts` snapshot; `restorePlaybackSurfaceIfNeeded()` | Snapshot carries `episodeId`; presence ⇒ a play was launched. |
| Client timeout wrapper | `fetchWithTimeout` / abort handling in `catalog.ts` | Reconcile abort-vs-success here; do not invent a new fetch layer. |
| Single-flight coalescing | `streamFlightKey()`/`streamFlightBehaviorKey()` (`stream-flight.ts`) + `core.streamInFlight` | For W3 dedupe work. |
| Debrid cache-status parse | `parseDebridCacheStatus()` / `debridServiceId()` (`stream-filters.ts`) | For W2 source-wiring checks. |
| Provider policy contract | `validateAioStreamsTargetPolicy()` (`aiostreams-policy.ts`) | Currently gate/test only — note if it should run at boot. |
| Telemetry (already redacts URLs) | `resolve-metrics.ts`, `playback-telemetry.ts` | Reuse counters; do not log stream URLs/credentials. |

**Genuinely missing pieces you may build (only if a workstream needs them):**
- A minimal, principled way for a successful **episode** play to clear its own `failed` playability row without turning on full rail-gate promotion for every episode (W1).
- A reconciliation guard so the launcher never greys / times-out an episode that actually played (W1).
- Small dedupe helpers if W3 removes duplicated ladder/config recomputation — only if they reduce net complexity.

---

## §6 — Per-workstream specs

### W1 — Episode "played-but-greyed / catalog timed out" bug  ← do first

**Deliverables**
- **Fix 1 (grey persistence):** A confirmed successful `mode='auto'` couch play of a series **episode** (any season/episode, not just the rail-gate id) must ensure that episode's own playability row can no longer render it grey. The principled intent: *a successful full-start play is ground truth that the episode is playable.* Choose the **least-invasive** correct mechanism and justify it in the report. Constraints on the fix:
  - Do **not** start assigning every episode to rails or otherwise pollute the rail-gate model (`assignVerifiedTitleToBestRail` and rail promotion stay gated to `isSeriesRailGateId`).
  - Clearing/verifying the played episode's own row is acceptable; blindly enabling the entire `usePlayabilityIndex` block for all episodes is **not** (it would also change failure-demotion behavior for episodes — analyze and avoid unintended side effects).
  - Respect play epoch guards (`assertPlayEpoch`) exactly like the surrounding writes; the new write must be superseded-safe.
- **Fix 2 (false timeout + grey on a successful play):** The launcher must not show the `playTimeoutMessage()` toast nor call `setEpisodeStreamBadge(id,false)` when playback actually started/succeeded. Reconcile the client abort-vs-playback race (e.g. settle/clear the play-fetch timeout once playback begins or the return snapshot proves a real playback occurred; and/or treat a server 200 that arrived as authoritative even if delivered late). Keep genuine failures (no stream, real timeout before any playback) fully intact — they must still toast and grey.
- **Diagnostics + Pi confirmation:** add the read-only queries from §4 and a concrete repro/verification entry to `docs/COUCH_TEST.md` for the home Mac (you cannot test on hardware).

**Acceptance (testable, local)**
- New catalog-service test: given a `titles` row `status='failed'` for `tt<seriesbare>:2:4`, after a successful auto play of that episode id, `getTitlePlayability` for that id is no longer `failed` (verified or cleared), and `applyEpisodePlayability` over a season containing it returns `playable !== false`. The equivalent bare/`:1:1` behavior is unchanged.
- Regression test proving a **failed** episode play (`no_playable_stream`) still marks/keeps the episode appropriately (no accidental "verify on failure").
- New launcher test (or a deterministic unit test around the reconciliation function): a play whose response/playback is present does **not** emit the timeout toast and does **not** apply the grey override; a genuine pre-playback abort still does both.
- All §3 builds/tests/gates pass. `docs/COUCH_TEST.md` has a home-Mac Pi confirmation step.

### W2 — Stream source & resolver audit (RD, TorBox, AIOStreams, MediaFusion, Torrentio)

**Deliverables**
- Trace and document, from primary source, how each configured source actually contributes to a couch resolve: AIOStreams (primary addon; Torrentio/Comet/MediaFusion typically *inside* AIOStreams), any direct MediaFusion supplement, and how RD vs TorBox cache status is parsed and ranked. Confirm:
  - `parseDebridCacheStatus()` correctly reads current AIOStreams bingeGroup/name badges for **both** TorBox and RD (cached/uncached/unknown) against real example shapes — not just the test fixtures. If AIOStreams' badge/bingeGroup format has drifted, fix the parser (this is a high-confidence correctness fix).
  - The uncached policy holds end-to-end: RD uncached excluded, TorBox uncached retained, from `aiostreams-target-patch.json` through `stream-filters`/`play-ladder` to the couch play ladder. Flag any place the policy is asserted only in tests but not enforced at runtime (e.g. `validateAioStreamsTargetPolicy` is gate-only today) and recommend whether it should run at boot.
  - Every source in `stremio-export.example.json` that exposes a `stream` resource is actually queried in fan-out, and none are silently dropped by `filterVodAddonExports`/`supportsResource`. Report any dead/duplicated/unused wiring (e.g. standalone Torrentio addons, WASM stremio-core not used for resolve, `filterAndRankStreams` used only for telemetry, `prefetchStreams` dead).
  - Provider health handling: 429/rate-limit classification and negative-cache reasons (`miss` vs `rate_limited`) are correct so a transient rate-limit doesn't poison the couch path, and TorBox NFO/unreadable transients are not permanently bad-cached.
- **Implement** high-confidence wiring/correctness fixes (parser drift, a source that isn't actually queried, a policy asserted-but-not-enforced where enforcement is clearly intended, a mis-classified error). **Report** (do not change) anything that would alter tuned numerics, provider ordering heuristics, or coverage tradeoffs.

**Acceptance**
- A written source/resolver map in the report: each provider → where wired → how it contributes → cache-status path → verdict (correct / fixed / deferred-with-reason).
- Any parser/wiring fix has a test that uses a **realistic** stream/bingeGroup shape (add the fixture). Existing debrid/policy tests still pass; TorBox-retained / RD-excluded invariant still asserted.
- No reduction in the number of sources queried or streams retained; prove it with a test or a clear code argument.

### W3 — Resolve→play efficiency & robustness

**Deliverables** (implement only the safe, high-confidence subset; report the rest)
- Identify and remove **redundant hot-path work** where provably safe:
  - Detail-open `GET /stream` and subsequent `POST /play` both fully resolve + expand the ladder (only the 10-min positive stream cache helps). Look for a principled, low-risk reuse (e.g. avoid recomputing `displayStreamTelemetry` diagnostics on the couch `GET /stream` when not needed; avoid re-running `mergeFilterConfig`/`buildStreamFilterContext` twice within one logical open→play when inputs are identical). Do **not** introduce cross-request state that could serve stale data.
  - `playWithLadder` expands the ladder up to 3× per attempt sequence (main, last-resort, floor) and `prepareVerifyTitle` + `probeWithLadder` both expand — collapse only if you can prove identical inputs and no behavior change.
  - `displayStreamTelemetry()` recomputes full ladder diagnostics on every `GET /stream`; make it cheap or opt-in without losing observability.
- Close **robustness gaps** that are safe:
  - Foreground (user) and background (verify/grow) resolves use different flight keys and can **double-hit** the same title's addons in parallel. Add a principled guard so background work does not amplify provider load against a title the couch is actively resolving (e.g. let an equivalent user resolve reuse an in-flight background result, or defer background resolve for a title with a live user flight) — **without** letting background deadlines leak into the user path.
  - Ensure per-addon fan-out cannot hang the couch path beyond the play deadline (confirm every `fetchAddonStreams` budget is capped by remaining play budget; you already must not change the numeric defaults, but you may fix a missing cap).
- **Report-only** (do not change this round): the budget-stack layering (85s server / 90s proxy / 95s launcher / 90s wall) and whether the detail `GET /stream` 15s client timeout can false-fail a title the play path would resolve at 30s; per-provider fan-out caps; persistent probe-pool memory on Pi. Provide concrete recommendations with evidence.

**Acceptance**
- Each implemented change has a before/after argument (what work is removed, why it's provably safe, what still guarantees coverage) and a test proving behavior is unchanged (same candidates/streams, same ranking).
- A measured or clearly-reasoned efficiency delta per change (e.g. "removes N redundant `expandPlayLadder` calls per play"; measure with a local micro-benchmark or a counter if feasible, else reason explicitly).
- No change reduces stream coverage or fallback depth. All §3 gates pass.

### W4 — Audit report + measurement

**Deliverable:** `EFFICIENCY_AND_SOURCES_CODEX_REPORT.md` at repo root containing: baseline (branch, HEAD short SHA, clean-tree test counts), per-workstream findings, exactly what you changed vs deferred (deferred items each with an exact reason), the source/resolver map (W2), the efficiency deltas (W3), every test/gate command with its result, and the Pi-only confirmation steps you added to `COUCH_TEST.md`. Be honest: partial/deferred is fine, fabricated-green is not.

---

## §7 — Ordering & how to work

1. `git branch --show-current` → must be `feat/native-experience`. `git status` clean-ish (note untracked spec/report files).
2. Baseline: run the full §3 matrix once, record counts in the report.
3. **W1** (fix + tests + COUCH_TEST.md) → run §3 → append report.
4. **W2** (audit + high-confidence fixes + fixtures) → run §3 → append report.
5. **W3** (safe dedupe/robustness + tests, report the rest) → run §3 → append report.
6. **W4**: finalize report.
7. After each workstream: catalog `npm run build && npm test && npm run test:gate`, launcher build + UX gate, orchestrator python, shell `bash -n` + source-only SSOT gate. Fix anything you broke before moving on.
8. Leave everything in the working tree. Do **not** commit.

---

## §8 — Commit policy

**Do not commit or push.** Leave all changes and the report in the working tree. A human reviewer will
verify (re-run §3 independently, diff for scope/secrets, adversarially check for fabricated passes),
make minimal corrections, commit logical units, and hand off to the home Mac for Pi deploy +
validation. If you believe a commit split would help the reviewer, describe the proposed split in the
report — do not perform it.

---

## §9 — Definition of done (reviewer will verify each)

- [ ] Branch is `feat/native-experience`; no commits/pushes; no branch switch; no deps added; no tuned numeric defaults changed; TorBox-retained/RD-excluded invariant intact.
- [ ] **W1 Fix 1:** successful auto play of any series episode clears its own `failed` row (no permanent grey); rail-gate promotion still limited to bare/`:1:1`; failure-demotion behavior for episodes analyzed and unchanged-or-justified; epoch-safe write. Test proves it.
- [ ] **W1 Fix 2:** launcher never shows "catalog timed out" or greys an episode that actually played; genuine pre-playback failures still toast + grey. Test proves both directions.
- [ ] **W1:** `docs/COUCH_TEST.md` has read-only Pi confirmation steps.
- [ ] **W2:** source/resolver map delivered; cache-status parser verified against realistic shapes (fixed if drifted, with fixture); no loss of queried sources/retained streams; deferred items each have an exact reason.
- [ ] **W3:** implemented dedupe/robustness changes each have a no-behavior-change test + efficiency rationale; background-vs-user provider amplification guarded without leaking background deadlines; report lists deferred retunes with evidence.
- [ ] **W4:** `EFFICIENCY_AND_SOURCES_CODEX_REPORT.md` complete and honest (no fabricated green).
- [ ] Full §3 matrix passes locally (expected off-Pi warnings only).
