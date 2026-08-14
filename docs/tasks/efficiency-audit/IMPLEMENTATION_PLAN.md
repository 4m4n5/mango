# Implementation & Pi deploy plan (final audited)

**Inputs:** [FINDINGS.md](FINDINGS.md) · [BASELINE.md](BASELINE.md)
**SHA at audit:** `a057a15`
**Constraint:** git-only deploy. Do **not** use `pi-deploy.sh` / `pi-exec-gate.sh` (branch/AIOMetadata blockers). Follow `docs/DEPLOY.md` manual path: push from Mac → Pi `git fetch` + exact SHA checkout → rebuild what changed → Chromium reload if launcher → gate-lite + named smokes.

Pad bindings, Search progressive contract, mpv-only playback, latest-only YouTube v2, debrid `--vo=null` probe: **unchanged**.

Each batch is independently revertible. Stop after a batch if gate-lite fails. Re-measure the named baseline metric before calling the batch done.

Product/UX decisions (2026-08-14) are recorded in FINDINGS.md. This file is the shipping sequence after the adversarial re-audit of every fix direction.

---

## Batch 1 — Search D-pad responsiveness (F-002, F-006, F-025; empty-results focus)

**Why first:** The reported couch hang. F-001 chip landing is accepted; do not relocate interim focus.

**Code:** `src/launcher/src/search.ts`

- `yieldToPadInput`: `requestAnimationFrame` + 50ms fallback matching `waitInputTurn` in `pad-nav.ts`. Keep the function name (UX smoke pins it).
- Soft/hard abort split:
  - `scheduleResultsRefresh` (poll): if `fillResultsView` is in flight, set a dirty flag; reconcile once at the end. Do not bump `resultsPaintGeneration` mid-loop.
  - `close` / `cancelActive` / `render` / More-click `refreshResults`: hard abort (generation++ and clear dirty).
  - Dirty reconcile must clear `railPaintActive` before re-fill so atmosphere is not suppressed.
- `collectResultRows`: per-rail ordered merge (`Map<railId, rows[]>` in `visibleGroups` order). Full rescan at end of fill as backstop. Not append-only.
- Empty results: when submit/complete has no items, set `focusedKey` to `search:scope:${this.scope}` (active chip), not `search:edit`.

**Tests**

- `search.test.ts`: yield helper is frame-based (or the 50ms fallback); empty-results preferred key is the active scope chip; paint-ms window still 80–120.
- `search.test.ts` / extractable helpers: per-rail merge keeps `visibleGroups` order on rebuild; in-flight fill is not generation-aborted by a trailing poll refresh.
- UX smoke (`scripts/m6-ship/gate-m6-ux-smoke.sh`): keep `fillResultsView` / `yieldToPadInput` / `slimSearchSnapshot` / `refreshResults`→`applyFocusRows` slice with no `this.render()` inside. Pin PlayWaitCopy remains. Do not add chrome-first-focus contracts that contradict the accepted chip landing.

**Gates:** launcher `tsx --test` slice + `gate-m6-ux-smoke.sh` + `gate-m6-search-smoke.sh` if present on Pi.

**Baseline delta:** qualitative couch — D-pad moves during progressive paint. Optional: Chromium `render_age_ms` should not stick high for seconds after submit.

**Rebuild:** launcher `npm run build` + `systemctl --user restart mango-launcher-chromium.service`.

**Rollback:** `git revert` the batch SHA; launcher rebuild + Chromium restart.

---

## Batch 2 — Home tab chrome + impressions (F-003)

**Code:** `src/launcher/src/main.ts`, `src/launcher/src/home.ts`

- Skip `buildBrowseTabs` when active tab + tab order unchanged.
- Record last impression fingerprint (`slate_sequence` / `slate_revision` + rail ids + card ids); POST only on change. A new shuffle must still POST.

**Tests:** home-state / main-adjacent unit if extractable; otherwise UX smoke string contracts.

**Gates:** `gate-m6-ux-smoke.sh`.

**Baseline delta:** no extra `/api/catalog/.../impressions` on L/R back to a warm tab.

**Rebuild:** launcher + Chromium restart.

---

## Batch 3 — Shuffle yield (F-004) — **withdrawn**

Couch-rejected 2026-08-14: progressive Home paint scrolled to top, lost focus, and hung D-pad. Keep atomic `buildCatalogRails` + `shuffleFocusRestore` (poster slot, not old card key). Search progressive yield is unchanged.

---

## Batch 4 — Play TTFF (F-005 redesigned, F-011)

**Code**

- `scripts/m2-catalog/service/mpv-play.sh`: `now_ms` via `$EPOCHREALTIME`; bash-parse the two known tiny mpv JSON reply shapes in VO-ready / property loops (python fallback).
- After a successful structured probe with `technical.width/height/fps`, pass `MANGO_MPV_KNOWN_*` into play env; seed `video_*` locals before the ffprobe gate. Do **not** skip ffprobe when probe was skipped or technical is incomplete. Do **not** rely on `MANGO_MPV_SKIP_FFPROBE=1` alone.
- `src/catalog-service/src/mpv.ts` / play-orchestrator: thread `structuredProbeResult.technical` into the play invocation.

**Tests:** play-orchestrator unit; mpv-play shell tests if any; `gate-m6-playback-ssot.sh`.

**Baseline delta:** cold `/stream` stays whatever the provider is; **user play after a successful probe** should drop ffprobe wall (human play of a known cached TorBox title).

**Rebuild:** catalog-service if TS changes; `mpv-play.sh` is sourced on next play. Restart `mango-catalog.service` if Node changed.

**Contract:** do not skip the debrid `--vo=null` probe. Do not change pad bindings.

---

## Batch 5 — Python idle / health (F-007, F-018, F-008, F-009)

**Code**

- `serve.py` recovery thread: 0.25s when session **and** pending; 2.0s otherwise. Never idle-sleep > `PAD_NAV_STALL_SEC` (default 3s).
- `collect_health`: cache pad-health JSON 1–2s; skip remapper `systemctl` when `tv_pad` already ok.
- Controller-link: slow tick while connected; exponential backoff while asleep with **max reconnect delay ~3s**.

**Tests:** `src/mango-ui-server/test_pad_nav_queue.py`; pad health still reports `ok` in `gate-m1`.

**Baseline delta:** launcher `/api/health` from ~300 ms → tens of ms (re-run the 3-curl sample).

**Rebuild:** `systemctl --user restart mango-ui-server.service` (Chromium can stay; pad-nav session will re-register). Controller-link unit only if enabled.

---

## Batch 6 — SQLite hygiene (F-015, F-019–F-021, F-014)

**Code**

- Shared `openSqliteHot()` for library + youtube (F-015).
- Covering index `(rank_generation_id, content_type, serving_eligible, rank ASC)` for `vod_rank_items` (F-014); migration in `library/db.ts`.
- Stop coalescing `youtube_items.raw_json`; NULL existing blobs in prune (F-020).
- Prune profile impressions (F-021): VOD 90-day retention; YouTube retain `slate_sequence >= current − K` (K ≥ warm Home cache lifetime). Never prune `youtube_profile_candidate_state` with the same job.
- Nightly/maintenance: `VACUUM` library after prune when freelist is huge (F-019) — **idle-gated**, never on couch path. Pre-copy beside the file. Run inside the 03:00 chain after grow. Expect minutes + a lock.

F-022 (YouTube description omit) ships in Batch 7 with the other payload work.

**Tests:** library/youtube db tests; rank serving still returns the same ids; prune tests for retention bounds.

**Gates:** `gate-lite-unit.sh`, `gate-m6-youtube-smoke.sh`, `gate-m6-library-smoke.sh`.

**Baseline delta:** library.db size after VACUUM (418 MB → closer to used pages).

**Rebuild:** catalog-service. **Do not VACUUM unattended** without confirming couch idle + playability lock.

---

## Batch 7 — Payload / clone slimming (F-013, F-017, F-022, F-023, F-026, F-027)

**Code:** Search clone-on-revision-only (never return live `job.snapshot`); cap `warmMetadata`; omit `description` on `publicYoutubeRails`; skip duplicate `loadMeta` on playback return (never skip season loading); slim playback session `result`; cache search selection boosts for the job.

F-016 is **not** in this batch (descoped — gates/diag consume `playability`/`skipped`).

**Tests:** catalog unit + launcher playback-return tests; youtube rails payload test that description is absent.

**Gates:** gate-lite unit + UX smoke + playback-return tests.

**Rebuild:** catalog and/or launcher as touched.

---

## Batch 8 — Hygiene (F-010, F-024, F-030, F-031)

- Tie companion nightly consolidate to `MANGO_VOICE=1` (F-010).
- Detail backdrop: downscale then blur (F-024). Needs a glance on TV.
- Delete deprecated m3 stubs (F-030); one line in ops docs.
- Docs: ARCHITECTURE/AGENTS “final SHA” → STATUS latest recorded (F-031).
- F-032 docker caps: **skipped** (user declined the AIO restart).
- F-028 / F-029: optional, not in this batch.

**Gates:** docs/source greps; no Pi required for stubs/docs. Launcher rebuild if CSS changes.

---

## Batch 9 — F-012 new play-budget contract

**Code:** `src/catalog-service/src/play-orchestrator.ts`

- Remove the upfront 20s reserve so `mainDeadline` = full 90s wall.
- When Phase B’s resort finds obligation candidates, extend the deadline by up to 30s for Phase B only, capped by `options.deadlineAtMs` (server 120s).
- No candidates → no extension.

**Tests:** play-ladder: happy path uses full wall; hard title with floor candidates gets the +30s window; no candidates means no extension; server wall never exceeded.

**Gates:** catalog unit + `gate-m6-playback-ssot.sh`. Human play verification.

**Rebuild:** catalog-service.

Do not mix with Batch 1. Debrid probe-to-foreground handoff stays an explicitly-rejected non-bug.

---

## Per-batch Pi sequence

```text
Mac: commit (when asked) + git push origin feat/native-experience
Mac: git rev-parse HEAD   # BATCH_SHA
Mac: bash scripts/pi-exec.sh 'cd ~/mango && git fetch origin feat/native-experience && git rev-parse origin/feat/native-experience'
# confirm equals BATCH_SHA, then:
Mac: bash scripts/pi-exec.sh 'cd ~/mango && git checkout --detach BATCH_SHA'  # or merge/pull after SHA check
# rebuild only what the batch lists
# launcher: cd src/launcher && npm run build && systemctl --user restart mango-launcher-chromium.service
# catalog:  rebuild dist && systemctl --user restart mango-catalog.service
# ui-server: systemctl --user restart mango-ui-server.service
Mac: bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse HEAD && bash scripts/gate-lite.sh'
# plus the batch's named M6 smokes
# re-measure the batch's baseline metric
```

Never `rsync`. If `gate-lite` fails: revert the batch on Mac, push, Pi reset to previous known SHA, rebuild.

---

## Suggested order

1. Batch 1 (Search D-pad) — ship and couch-check F-002 before anything else.
2. Batch 2 (Home chrome).
3. Batch 3 withdrawn — atomic Shuffle + slot restore (do not re-ship yield).
4. Batch 4 (TTFF) — needs a human play.
5. Batch 5 (health 300 ms) — cheap, helps every later gate.
6. Batches 6, 7 as capacity allows.
7. Batch 8 docs/stubs/CSS anytime.
8. Batch 9 last — contract change, human play verification.

---

## Rollback cheat sheet

| Batch | Restart |
|-------|---------|
| 1–3, 7 (launcher), 8 CSS | launcher build + Chromium unit |
| 4, 6, 7 (catalog), 9 | catalog-service unit |
| 5 | ui-server unit (pad session re-registers) |
| 6 VACUUM | restore `library.db` from the pre-VACUUM copy taken beside the file |
