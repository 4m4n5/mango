# Mango efficiency & lightness findings

**Mac/Pi SHA:** `a057a15dd870f00efcb91c8e6d8e427000b67769` (`feat/native-experience`)  
**Baseline:** [BASELINE.md](BASELINE.md)  
**Status:** reconciled (Phase 10) + adversarial re-audit of every fix direction (2026-08-14). Independent adversarial pass applied to all P0/P1; every proposed patch was checked against source, gates, and hidden consumers. Product/UX decisions recorded below.

Severity: **P0** couch-blocking lag · **P1** measurable hot-path waste · **P2** idle/background or secondary-path waste · **P3** complexity/bloat without current user cost.

Rank for shipping: impact × confidence ÷ effort. Contract-sensitive items are marked.

---

## User decisions (2026-08-14)

- **Search interim focus:** resting on a scope chip during the pre-results window is acceptable — only fix the D-pad unresponsiveness. No pending-focus machinery.
- **User move wins:** focus never snaps away from a deliberate D-pad move.
- **Empty results:** focus lands on the active scope chip so the user can retry the query in another scope.
- **Shuffle:** progressive rail paint over a few frames is approved.
- **Detail backdrop (F-024):** downscale-then-blur.
- **YouTube Detail interim (F-022):** brief "loading details…" is acceptable; omit description from rails payload.
- **Controller-link backoff (F-008/F-009):** cap reconnect delay at ~3s, not 8s.
- **Docker memory caps (F-032):** skipped — leave addon memory uncapped.
- **VACUUM (F-019):** scheduled in the 03:00 nightly chain after grow/prune, idle + no-playback gated.
- **F-012 play budget:** Phase A gets the full 90s wall; when the fallback phase actually has obligation candidates, run an additional Phase B ladder of up to 30s (total ≤ the 120s server wall).

---

## Accepted findings

### F-001 · launcher · P0 · confidence high · effort S · Search focus lands on YouTube chip

**User report:** After submitting a Search phrase, results appear with focus on the YouTube scope chip. D-pad appears dead for several seconds.

**Mechanism**

1. `submit()` sets `focusedKey` to the first result card, then `render()` builds results chrome (edit + five scope chips) with empty `resultRows` and calls `applyFocusRows()` *before* any rails exist (`src/launcher/src/search.ts` ~627–630, 757–766).
2. `resolveFocusPosition` cannot find the card key, so it clamps the compose keyboard column onto the 5-wide scope row (`src/launcher/src/focus.ts`). Compose columns ≥ 4 (including the Search key at col 9) land on `search:scope:youtube`. Executed locally: `{row:4,col:9}` → `{row:1,col:4}` = youtube.
3. The `FocusGrid` `onFocus` callback overwrites `focusedKey` to `search:scope:youtube` (`search.ts` 381–386). Later `applyFocusRows()` after each rail therefore keeps the chip.

**Adversarial (independent):** CONFIRMED. Not the Home YouTube tab (`openSearch` hides Home). SEARCH.md requires progressive yield, not chrome-first focus.

**Impact:** Couch focus is the wrong control; Select would re-submit YouTube-scoped search.

**Measurement:** Source + local clamp proof. Pi paint duration unmeasured.

**Fix direction (revised 2026-08-14):** User accepted the chip landing itself. Do **not** add pending-focus-key or deferred-`applyFocusRows` (those desync Select from visual focus: `activate()` clicks `focus.focused`). Deliverable is F-002 responsiveness. Empty-results focus is a separate product change: land on the active scope chip, not `search:edit`.

---

### F-002 · launcher · P0 · confidence high · effort S · Search D-pad starved during rail paint

**Mechanism:** Pad apply runs on Chromium’s main thread (`src/launcher/src/pad-nav.ts` `startPadNavPoll` → `applyPadNavBatch`). `fillResultsView` builds each new rail with synchronous `buildCatalogRails` + poster `src`, then `await yieldToPadInput()` which is only `setTimeout(0)` (`search.ts` 86–90, 1144–1176). Progressive revisions call `scheduleResultsRefresh` → `cancelResultsPaint` (generation++) which aborts in-flight fill (`search.ts` 652–655, 1281–1311). Provider phases `bump()` at 2.5s / related 4s (`src/catalog-service/src/search/service.ts`). Until JS is idle, long-poll responses cannot be applied. Down/Right are also geometric no-ops on the chrome-only two-row grid.

**Adversarial (independent):** NARROWED, still accepted. Long-poll `fetch` waiting is not itself blocking; the hang is sync DOM + image work, plus cancel/restart extending the busy window. `setTimeout(0)` is not the pad contract’s frame-or-50ms turn (`ARCHITECTURE.md`). Coalesce of stale Search moves cannot run while the thread is in `buildCatalogRails`.

**Impact:** All D-pad directions ignored for the progressive Search window (seconds).

**Fix direction:** Yield a real input turn (`rAF` + 50ms fallback matching `waitInputTurn` in `pad-nav.ts`) between rails; keep the function name `yieldToPadInput` (UX smoke gate pins it). Do not abort an in-flight fill on every poll revision — queue one trailing reconcile. Hard-abort still required for `close` / `cancelActive` / `render` / More-click. Keep progressive Search (locked).

---

### F-003 · launcher · P1 · confidence high · effort S · `renderHome` rebuilds tabs + re-POSTs impressions on cache hits

**Mechanism:** Warm L/R uses `tabRenderCache` for rails (`src/launcher/src/main.ts` 537–544) but every `renderHome` still `buildBrowseTabs` → `replaceChildren` (`home.ts` 101–106) and fires YouTube/VOD impression POSTs whenever status is ready (`main.ts` 463–500), ignoring `reused`.

**Adversarial (independent):** CONFIRMED. Server `INSERT OR IGNORE` avoids double-count; client still pays fetch + SQLite attempt on every shoulder-tab revisit.

**Impact:** Needless DOM churn + localhost POSTs on the hottest navigation path.

**Fix direction:** Skip `buildBrowseTabs` when the tab set/active tab is unchanged; gate impressions on slate fingerprint (`slate_sequence`/`slate_revision` + rail ids + card ids) so a new shuffle still POSTs.

---

### F-004 · launcher · P1 · confidence high · effort M · Home shuffle paints all rails with no yield

**Mechanism:** Shuffle → `loadCatalog({ reshuffle: true })` → cache miss → `appendCatalogSections` builds every rail/card in one sync loop (`home.ts` 227–269). No Search-style yield between rails.

**Adversarial (independent):** CONFIRMED as comparative. Fetch is async; paint is not. Default non-Live `railRowLimit` is 1 row, so this is lighter than Search progressive pages — hitch, not multi-second death. Warm tab switch is not this path. `--shuffle-stagger` is harness-only, not live CSS.

**Impact:** Noticeable hitch on X-shuffle / first visit to a tab.

**Fix direction:** Make `appendCatalogSections` async; yield a frame between rails on shuffle rebuild only; one `FocusGrid.setRows` at the end. User approved progressive appearance.

---

### F-005 · playback · P1 · confidence high · effort S · User play re-runs ffprobe after probe

**Mechanism:** Probe mode already measures the stream. User play (`! $PROBE`) still runs `detect_video_profile` / ffprobe (up to 12s) unless `MANGO_MPV_SKIP_FFPROBE=1` (`scripts/m2-catalog/service/mpv-play.sh` ~429–460, 1086–1103). Probe does not forward width/height/fps into the play env.

**Adversarial (independent):** NARROWED. Purpose is HDMI/profile labeling, not a second safety probe. Real TTFF tax. `MANGO_MPV_SKIP_FFPROBE=1` **alone is UNSAFE**: HDMI source-match needs width/height/fps (`mpv-play.sh:923-976`) and the handoff path re-runs ffprobe when dims are missing (`:960-966`). Probe already returns a full `StreamTechnicalProfile` via `technical_b64` in the PASS line (`mpv-play.sh:1201-1204`, parsed in `mpv.ts:206-228`).

**Impact:** Extra network + CPU on the critical path after a successful ladder probe.

**Fix direction:** After a successful structured probe (or `reuseProbe`) with `technical.width/height/fps`, pass those into play env as `MANGO_MPV_KNOWN_*` and seed `video_*` locals before the ffprobe gate (`:1097-1098` already skips when dims set). Never skip when the probe was skipped or technical is incomplete. Keep the debrid `--vo=null` safety probe unchanged.

---

### F-006 · catalog-service + launcher · P1 · confidence high · effort M · Progressive Search `bump()` aborts launcher paint

**Mechanism:** Each provider phase completion calls `bump()` → `revision++` (`search/service.ts` 857–869). Launcher applies every newer revision via `scheduleResultsRefresh` / `cancelResultsPaint`. Timeouts (2.5s / 4s) bound worst case but also allow several revisions in that window.

**Adversarial (independent):** NARROWED to accepted progressive *implementation* cost, not a timeout bug. Unified Search is locked (`docs/DECISIONS.md`). Aborting mid-fill is not required by SEARCH.md; a trailing coalesce already exists (100ms).

**Impact:** Amplifies F-002. Fix with F-002 (do not treat as a separate product change).

**Fix direction:** Same as F-002 trailing reconcile (dirty flag for poll refresh only). Optional server bump coalesce is not required if the launcher dirty flag holds.

---

### F-007 · python · P2 · confidence high · effort S · `serve.py` pad-nav recovery wakes at 4 Hz forever

**Mechanism:** `start_pad_nav_recovery_watch` `while True: time.sleep(0.25)` (`src/mango-ui-server/serve.py` 525–549). Recovery action is gated; the wake is not. Stall threshold is `PAD_NAV_STALL_SEC` default 3s.

**Adversarial:** Not the Chromium 1 Hz heartbeat. Idle load was still ~0.1; cost is wakeup/lock, not a measured CPU hog. Keep P2. Sleeping 5s when idle would delay recovery past the stall threshold.

**Impact:** Standing 4 Hz wakeup with no session.

**Fix direction:** Active (session **and** pending): keep 0.25s. Idle (no session **or** no pending): sleep 2.0s. Never idle-sleep > `PAD_NAV_STALL_SEC`. Playback file already gates Chromium restart.

---

### F-008 · python · P2 · confidence high · effort S · Controller-link 4 Hz GLib tick (when the unit is enabled)

**Mechanism:** `GLib.timeout_add(250, supervisor.tick)` (`scripts/m1-foundation/pad/mango-controller-link.py` ~493). Status disk write is 2s-throttled; D-Bus tick is still 4 Hz.

**Adversarial:** **This Pi’s unit was inactive** at baseline — no current RSS cost here. Source still runs 4 Hz when enabled.

**Fix direction:** Slow tick while `connected`; speed up on disconnect. Reconnect delay cap is F-009 (~3s per user).

---

### F-009 · python · P2 · confidence high · effort M · 1 Hz Connect paging while Micro is off

**Mechanism:** `ASLEEP_PROBE_SEC = 1.0` (`controller_link_state.py`). Intentional short paging, not the dual-owner BlueZ storm (that path is rejected).

**Impact:** Overnight BT page traffic when the pad is powered off and the unit is enabled.

**Fix direction:** Exponential backoff after Host-is-down while keeping fast wake on advertising. **Max reconnect delay ~3s** (user decision; not 8s).

---

### F-010 · python · P2 · confidence medium · effort S · Companion nightly timer independent of `MANGO_VOICE`

**Mechanism:** `mango-stack.sh` starts voice only if `MANGO_VOICE=1`. `mango-companion-nightly.timer` (06:00) is installed separately; gated on playback/grow lock only. `companion-nightly-consolidate.sh` has no `MANGO_VOICE` check.

**Adversarial:** Orchestrator does not load when voice is off. Cost is the oneshot if the timer exists. This Pi has voice **on**, so the gap is off-state hygiene.

**Fix direction:** Early no-op in `companion-nightly-consolidate.sh` when `MANGO_VOICE≠1`.

---

### F-011 · playback · P2 · confidence high · effort S · `mpv-play.sh` `now_ms()` / JSON via `python3` in tight loops

**Mechanism:** `now_ms` spawns `python3 -c` (`mpv-play.sh` 91–93). `wait_mpv_vo_ready` loops every 50ms with `now_ms` + python JSON parse (~843–874, 1160–1169). Script is bash-only (`#!/usr/bin/env bash`, invoked as `bash` from Node). No `jq` dependency.

**Adversarial:** Waits are correct; spawn overhead on Pi is the issue. Default OSD is Lua, not Tk (Tk path rejected). `$EPOCHREALTIME` is available on Pi Bookworm bash 5.2.

**Fix direction:** Bash `$EPOCHREALTIME` for `now_ms`; parse the two known tiny mpv JSON reply shapes in bash with python fallback.

---

### F-012 · playback · P2 · confidence medium · effort M · Obligation reserve shrinks happy-path wall · contract-sensitive

**Mechanism:** `playObligationReserveMs()` default 20s (`play-orchestrator.ts` 168–173) against `auto_play_wall_ms` 90s / server 120s. Reserve is **subtracted upfront** from Phase A (`:787-792`) so Phase B’s obligation floor cannot be starved.

**Adversarial:** The originally proposed “reserve only after main-ladder exhaustion” is **INFEASIBLE** — it inverts the floor-protection contract. User chose a new contract instead.

**Impact:** First-candidate successes still run under a reduced main deadline (70s of 90s).

**Fix direction (user 2026-08-14):** Remove the upfront reserve so `mainDeadline` = full 90s wall. When Phase B’s resort finds obligation candidates, extend the deadline by up to 30s for Phase B only, capped by `options.deadlineAtMs` (server 120s wall — 90+30 fits). No candidates → no extension. Ships last with play-ladder tests.

---

### F-013 · catalog-service · P2 · confidence high · effort S · `structuredClone` of Search snapshots on every poll wake

**Mechanism:** `startQuery` / `waitForSnapshot` always `structuredClone(job.snapshot)` (`search/service.ts` 446–470), including timeout-with-no-new-revision. `bump()` mutates `job.snapshot` in place.

**Adversarial:** Descriptions already stripped. Cost is deep-copy of multi-group snapshots (items duplicated across Top + per-source). Callers serialize or build a new slim object; none mutate the returned clone.

**Fix direction:** Cache one clone per revision; return that clone on unchanged revision. Never return the live `job.snapshot`.

---

### F-014 · catalog-service · P2 · confidence medium · effort M · For You miss path loads all eligible `vod_rank_items`

**Mechanism:** `currentlyEligibleRankRows` `SELECT … FROM vod_rank_items WHERE rank_generation_id=? AND serving_eligible=1 AND content_type=? … ORDER BY rank ASC` (`story-graph-service.ts` ~1778–1787). Cached slates serve 6 rows. Index `idx_vod_rank_items_serving` is `(generation, eligible, best_thread, rank_score DESC)` (`library/db.ts` 1354–1355).

**Adversarial:** In-process cache absorbs repeat X; miss/bootstrap still pays. Pi has 22,166 rank rows. Additive covering index matches the query; other PK joins are unaffected.

**Fix direction:** Covering index `(rank_generation_id, content_type, serving_eligible, rank ASC)`; keep cache.

---

### F-015 · catalog-service · P2 · confidence high · effort S · `library.db` / `youtube.db` Node `openDb()` lacks playability pragmas

**Mechanism:** Playability sets `busy_timeout`, `cache_size=-16000`, `mmap_size`, `wal_autocheckpoint=8192`, `synchronous=NORMAL` (`playability/db.ts` 503–513). Library/YouTube `openDb()` is `new Database(...)` only (`library/db.ts` 335–340, `youtube/db.ts` 71–76`). WAL+FK are set later in `initSchema`.

**Adversarial:** A Python RO connection cannot prove the live Node pragmas (per-connection). Source gap is still real. Pi `library.db` is 418 MB. No library/youtube code assumes `synchronous=FULL`. Backup uses Online Backup API. `checkpoint-wal-dbs.sh` already covers library, progress, youtube, playability.

**Fix direction:** Share a `openSqliteHot()` helper with playability’s pragma set; apply at singleton `openDb` (before/with initSchema).

---

### F-016 · catalog-service · P2 · confidence high · effort — · `/rails/items` ships `playability` / `skipped` · **DESCOPED**

**Mechanism:** Rail JSON includes `skipped` + `playability.{displayed,verified_pool,…}` (`core.ts` ~377–390). Launcher `RailItemsResponse` (`catalog.ts` 33–57) does not map them.

**Adversarial (re-audit):** Dropping from all HTTP responses is **UNSAFE**. `gate-m2-browse.sh:46-48`, `gate-m4-catalogs.sh:111-122`, `scripts/diag/rail-hitrate.py:99-107`, and `ai-catalog-rails.test.ts` read these HTTP fields. Server tab-cache eligibility needs `low_water` internally (`core.ts:2954`). Movies tab is already 5 ms.

**Impact:** Small constant serialize tax. Accepted cost.

**Fix direction:** Do not omit. Keep on HTTP and on the in-memory cache object.

---

### F-017 · catalog-service · P2 · confidence medium · effort S · Tab load warms meta for every movie/series card

**Mechanism:** After non-reshuffle tab load, `warmMetadata: true` fires concurrent `metaCached` (`core.ts` ~2567–2592, 3147–3153).

**Adversarial:** Fire-and-forget after the response; Home posters usually come from pool snapshots. Still competes with Search/play on Pi CPU/network.

**Fix direction:** Cap concurrency; skip when poster+title already complete.

---

### F-018 · python · P2 · confidence high · effort S · Launcher `/api/health` ≈ 300 ms

**Mechanism:** `collect_health` runs `pgrep`, `input-remapper` checks, catalog health, and `PAD_HEALTH_SCRIPT --json` with timeout 3s (`serve.py` 576–600). Catalog `/health` is 1 ms. Measured 294–420 ms standing. Dominant cost is `pad-health.sh` (evdev scan).

**Adversarial:** Not couch D-pad. Hits watchdog (`mango-health-repair.sh` every 3 min) and gate-m1 / voice-ready. Watchdog repair also gates on a live Chromium `pgrep`, so a 1–2s pad-health TTL cannot mask a crashed Chromium. `gate-lite.sh` hits catalog `:3020/health`, not launcher `/api/health`.

**Fix direction:** Cache pad-health JSON 1–2s; skip remapper `systemctl` when `tv_pad` already ok.

---

### F-019 · data · P2 · confidence high · effort S · `library.db` ~142 MB freelist + 418 MB file

**Mechanism:** Pi `page_count=106925`, `freelist_count=36515` (4 KiB pages). StoryDNA documents 17,869; rank items 22,166; watch history 15,588; impressions 4,546.

**Adversarial:** Freelist is reusable; not leaked rows. Still cold-cache and backup cost. VACUUM is a maintenance action (lock, minutes).

**Fix direction:** Idle/nightly `VACUUM` (or `incremental_vacuum`) after prune in the 03:00 chain; never on the couch path. Take a pre-copy beside the file. User approved the nightly window.

---

### F-020 · data · P2 · confidence high · effort S · `youtube_items.raw_json` never pruned

**Mechanism:** Column `raw_json TEXT` (`youtube/db.ts` 114); upsert `COALESCE` keeps old blobs; production callers never pass `rawJsonById` (always `null` write). `pruneYoutubeMaintenance` does not clear them. Zero `SELECT` readers anywhere.

**Adversarial:** Not needed for rail serving. Rebuildable cache, but disk/WAL grow with acquisition.

**Fix direction:** Stop coalescing (always write null after normalize); `UPDATE … SET raw_json = NULL` in prune.

---

### F-021 · data · P2 · confidence high · effort S · Profile impression tables grow without prune

**Mechanism:** `profile_recommendation_impressions` 4,546 rows (Pi); `pruneLibraryMaintenance` does not delete them. YouTube profile impressions similarly unpruned.

**Adversarial:** Unbounded prune is **UNSAFE for YouTube**. The `INSERT OR IGNORE` on `(profile_id, slate_sequence, rail_id, item_id)` is the idempotency gate that prevents double-counting `exposure_count` (`youtube/db.ts:978-1006`). VOD impressions: only reader is the 40-slate diagnostics rollup (`recommendations/service.ts:185-228`); no `last_seen` bump.

**Impact:** Disk growth; YouTube prune without retention would re-impress the same slate.

**Fix direction:** VOD: delete rows older than 90 days. YouTube: retain `slate_sequence >= current − K` (K covers warm Home cache lifetime, e.g. last 32 sequences). Never prune `youtube_profile_candidate_state` with the same job.

---

### F-022 · network · P2 · confidence high · effort S · YouTube Home rails ship `description`

**Mechanism:** `publicYoutubeRails` includes `description` (`youtube/service.ts` 756–778). Search strips synopsis (`search/service.ts` 181–200; launcher `slimSearchSnapshot`). Permanent Detail text comes from `/youtube/detail` + DB `description` column (`detail.ts:340` → `catalog.ts:595-606`). Interim currently uses `card.description || "loading details…"`.

**Adversarial:** Detail can use description as interim; Search already chose cards-never-prose. Home YouTube is the inconsistent heavy path. User accepted the brief "loading details…" interim.

**Fix direction:** Omit description on public rails; keep in DB for scoring.

---

### F-023 · launcher · P2 · confidence high · effort S · Playback-return double `loadMeta`

**Mechanism:** `restoreDetailFromSnapshot` awaits `loadMeta` (`main.ts` 1712–1725), then `detail.show` → `loadFullMeta` → `loadMeta` again (`detail.ts` ~340, 1849–1851).

**Adversarial:** Ordinary B-open is a single load. Duplicate only on Chromium self-heal / 4K return.

**Fix direction:** Pass snapshot meta into `show`, or skip the second `loadMeta` when description/poster already set. Never skip season loading.

---

### F-024 · launcher · P2 · confidence medium · effort S · Detail backdrop `filter: blur(28px)`

**Mechanism:** `.detail-backdrop-image { filter: blur(28px) }` (`style.css` ~2273–2281) on every Detail open.

**Adversarial:** Not scroll-timeline (opacity animation, cheap by design). Real GPU blur. Unmeasured on Pi.

**Fix direction:** Downscale then blur (user decision). Respect `prefers-reduced-motion` (already used elsewhere).

---

### F-025 · launcher · P2 · confidence medium · effort S · `collectResultRows` full DOM rescan per built Search rail

**Mechanism:** After each new rail, `collectResultRows` `querySelectorAll` across all groups (`search.ts` 1174–1209).

**Adversarial:** Needed for focus accuracy; O(groups×DOM) during the F-002 window. Naive append-only is **UNSAFE**: rebuilt rails duplicate rows; earlier-group rebuilds misorder vs `visibleGroups`.

**Fix direction:** Per-rail ordered merge (`Map<railId, rows[]>` rebuilt in `visibleGroups` order). Full rescan at end of fill remains a correctness backstop.

---

### F-026 · catalog-service · P2 · confidence medium · effort S · Playback session clones a fat `result`

**Mechanism:** `handlePlay` stores a large sanitized result; `cloneSession` = `structuredClone` on wait (`playback-session.ts` 53–55). Launcher `PlayResult` needs a slim subset (`catalog.ts` 121–137).

**Adversarial:** One session at a time; URLs already stripped. Smaller than Search clones.

**Fix direction:** Persist only launcher-needed fields on the session object.

---

### F-027 · catalog-service · P2 · confidence high · effort S · Every Search `bump` re-queries selections + re-ranks

**Mechanism:** `rebuildSnapshot` → `listSearchSelections(..., 100)` every bump (`search/service.ts` 778–789). Pi has 32 selection rows (cheap today) but the work multiplies by phase count.

**Fix direction:** Cache boosts for the job lifetime.

---

### F-028 · ops · P3 · confidence high · effort S · Live 60s poll always armed

**Mechanism:** `core.startLiveRailsBackgroundRefresh()` (`index.ts` 1737). Decision no-ops when cache fresh / playback active / config missing.

**Adversarial:** Not heavy when unchanged. `MANGO_LIVE_GATE` does **not** mean product-off (rejected as P1). Standing timer only.

**Fix direction:** TTL/event schedule instead of 60s poll (optional; not in the shipping batches).

---

### F-029 · ops · P3 · confidence medium · effort S · Watchdog every 3 minutes always probes

**Mechanism:** `mango-watchdog.timer` → `mango-health-repair.sh`. Skips disruptive repair during playback; still runs liveness (and thus F-018).

**Fix direction:** Cheap HTTP liveness first; deepen only on failure (optional; F-018 cache already cuts the expensive pad-health work).

---

### F-030 · bloat · P3 · confidence high · effort S · Deprecated m3 gate stubs

**Mechanism:** Thin `exec` wrappers: `gate-m3-source-cursors.sh`, `gate-m3-playability-grow.sh`, `gate-m3-ops-sla.sh`, `gate-m3-grow-rail.sh`, `gate-m3-grow-compose.sh`, `gate-m3-library-grower.sh`, `gate-m3-growth-quota.sh`, `quick-playability-topup.sh`.

**Fix direction:** Delete; one line in ops docs.

---

### F-031 · docs · P3 · confidence medium · effort S · STATUS vs ARCHITECTURE / AGENTS “final SHA” drift

**Mechanism:** STATUS latest recorded deploy `72bc1e0` / this audit `a057a15`; ARCHITECTURE/AGENTS still cite `04171bb…` as final Pi SHA.

**Fix direction:** Point ARCHITECTURE/AGENTS at STATUS “latest recorded” only.

---

### F-032 · ops · P3 · confidence medium · effort S · Addon Redis/AIOMetadata memory uncapped · **SKIPPED**

**Mechanism:** Baseline: AIOMetadata 401 MB + Redis 294 MB with `7.87 GiB` docker limits vs AIOStreams capped at 1 GiB.

**Adversarial:** Required for VOD. Not idle CPU (0%). Memory hygiene only. User declined the compose restart (stream outage).

**Fix direction:** Do not apply. Leave addon memory uncapped.

---

## Rejected (do not re-find)

| Claim | Why rejected |
|-------|----------------|
| Debrid isolated mpv probe then full play is a **bug** | **Accepted cost.** `shouldSkipProbe` forces probe for debrid (`play-orchestrator.ts` 142–148). PLAYABILITY.md: catch NFO/status-clip before visible handoff. Probe is `--vo=null`, not a separate isolated process flag. Optional later: promote probe in-place (contract-sensitive, not in batch 1). |
| `MANGO_LIVE_GATE` unset should stop Live refresh | Gate env only skips opt-in scripts (`docs/LIVE_TV.md`). Product Live is on when YAML/addons exist. This Pi runs four Live addons. |
| Pad 1 Hz heartbeat + 25s long-poll | Locked pad-nav contract (`ARCHITECTURE.md`). Idle `render_age≈999` is documented benign. |
| Search suggestions 120ms are provider work while typing | `suggestions()` is local `searchIndex` only (`search/service.ts` 393–396). SEARCH.md allows local suggestions; no YouTube/provider on that path. |
| localStorage Search still includes descriptions | `slimSearchSnapshot` / server `withoutDescription`. |
| Live `railRowLimit: null` unbounded DOM | Intentional Live inventory; catalog YAML caps rail sizes. |
| Inline `db.prepare()` per call | µs-class; no profile proof. |
| `ORDER BY score DESC` rail_pool miss is a full-table scan | Uses `idx_rail_pool_rail_score` (Pi EXPLAIN). Browse v3 Home largely skips `readRailPool`. |
| Meta/Search oversized prose on the wire | Meta is projected (`enrichMetaForLauncher`); Search strips descriptions. |
| Live 60s refresh does heavy work when unchanged | `liveRailsBackgroundRefreshDecision` returns cache_fresh and skips rebuild. |
| N+1 SQL on `/play` `/meta` `/rails/items` `/search` | Bulk maps / one selections query per bump. |
| Progress watcher 30s idle waste | Playback-only; stops when mpv inactive. |
| Default OSD Python/Tk on TTFF | Default backend Lua. |
| Orchestrator RAM when `MANGO_VOICE≠1` | `mango-stack.sh` does not start it. Residual: leftover units + F-010 timer. |
| Pad debounce disagrees with OPS.md | Code matches: D-pad 0.05s, face 0.12s. |
| Dual-owner BlueZ retry storm | Sole Connect owner + `ReconnectAttempts=0`. |
| CSS scroll-timeline / Search masks as compositor bloat | Opacity-driven, contract-required; Search masks off. |
| `ui-flags.ts` dead flags | Single live flag, used. |
| `prefetchStreams` runtime cost | Dead client helper; never called. |
| Missing `search_selections` index | PK covers the query; Pi has 32 rows. |
| Missing youtube search-cache index | PK + LRU indexes exist. |
| serve.py poster-proxy cache missing | No poster proxy; metahub is direct CDN. |
| D-pad move hits catalog/TMDB/YouTube | Focus is local. |
| Trigger consumer / top-up / StoryDNA worker always on | Env-gated off by default. |
| AIOStreams 13% idle CPU | Repeat `docker stats` was 0.01%; first sample was a spike. |
| Drop `/rails/items` `playability`/`skipped` from HTTP | Gates and diag consume them; internal `low_water` cache check. F-016 descoped. |
| `MANGO_MPV_SKIP_FFPROBE=1` without seeding dims | HDMI match and handoff re-probe need width/height/fps. |
| F-012 “reserve only after main-ladder exhaustion” | Inverts Phase B floor protection. Replaced by the user contract (full 90s Phase A + conditional +30s Phase B). |
| Pending-focus-key / deferred `applyFocusRows` for F-001 | Desyncs Select from visual focus. User accepted chip landing. |

---

## Ranking (ship first)

| Rank | ID | Why first |
|------|-----|-----------|
| 1 | F-002 + F-006 + F-025 (F-001 chip landing accepted) | Couch-reported Search hang |
| 2 | F-003 | Hottest navigation path |
| 3 | F-004 | Shuffle hitch |
| 4 | F-005 + F-011 | TTFF after a successful probe |
| 5 | F-007, F-018, F-008, F-009 | Idle/gate Python |
| 6 | F-015, F-019–F-022, F-014 | Data layer |
| 7 | F-013, F-017, F-023, F-024, F-026, F-027 | Secondary hot-path slimming (F-016 out) |
| 8 | F-010, F-030, F-031 | Hygiene (F-032 skipped) |
| 9 | F-012 | New play-budget contract — last, with play-ladder tests |

Contract-sensitive: F-012 new play budget (user-approved). Pad bindings, Search progressive contract, git-only deploy, debrid `--vo=null` probe: unchanged.
