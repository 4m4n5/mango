# mango — current status

**Branch:** `feat/native-experience` · **Plan:** [ROADMAP.md](ROADMAP.md) · **Couch:** [COUCH_TEST.md](COUCH_TEST.md)

What works today, what is still being hardened, and how to verify it.

---

## Milestones

| Milestone | Status | Headline |
|-----------|--------|----------|
| M1 Foundation | ✓ | `mango-stack.sh` · pad · gates |
| M2 Browse | ✓ | Movies / Series / Live tabs |
| M3 Play | ✓ hardening | mpv · picker · episodes · playability/grow |
| M4 Addons | ✓ | AIOStreams + AIOMetadata on Pi |
| M5 Voice + AI | ◐ | Phase 3 ✓ · M5.5a corpus ✓ · **M5.5b round code ✓** · living librarian memory ✓ · couch sign-off pending |
| M6 Ship | ◐ | M6.1 ✓ · M6.2 Pi-gated ✓ · Reliability Center ✓ · efficiency/perf Tiers 1–4 ✓ · **M6.5 round code ✓** · 4K Stage 2 validation · wizard pending |

---

## M2 — Browse

| Feature | Detail |
|---------|--------|
| Tabs | Movies · Series · Live · YouTube (L/R shoulders; native YouTube is Pi-gated and has an explicit M6.2 smoke after YouTube changes) |
| Grid | 9-up posters · `X` shuffle (pad `307`) |
| Rails | YAML + AI catalog slots + Continue |
| Service | `catalog-service :3020` · `GET /rails` |
| Proxy | `serve.py` → `/api/catalog/*` |

**Gate:** `bash scripts/m2-catalog/browse/gate-m2-browse.sh`

---

## M3 — Play

| Feature | Detail |
|---------|--------|
| Play orchestrator | Parallel resolve · ladder · 90 s wall · probe-then-play |
| Stream picker | `GET /stream/{type}/{id}` · `display_label` rows |
| Continue | `progress.db` · mpv position watcher |
| Episodes | Season list · per-episode streams · next-up overlay |
| Playability | `playability.db` verified pools · best-effort thematic grow jobs with `+20` SLA warnings |
| Browse UX | Verified-only thin rails · empty hidden |
| Thematic rails | `rail-theme-gate` on grow/link/verify · profiles in `rail-theme-profiles.yaml` |
| Pool retheme | Manual repair plus grow orphan/overlap finalization |
| Couch reliability | Chromium launcher · 1080p60 couch display mode · fetch/focus timing logs · Live stale-cache fallback · idle-gated maintenance · X11 anti-sleep/wake |

**Detail:** [PLAYABILITY.md](PLAYABILITY.md)

### Playability ops (Pi)

| Job | UI label | Script |
|-----|----------|--------|
| Reshuffle | Refresh library | inline |
| ~8 min | Quick top-up | `quick-playability-topup.sh --detach` |
| ~60–90 min total | Nightly pass | `playability-maintenance.sh --mode nightly` |
| ~4 h loop | Overnight grow | `overnight-playability-grow.sh --detach` |

Status: `python3 scripts/diag/playability-status.py` · grow monitor: `grow_monitor.py status`

**Gates:** `gate-m3-play-ladder.sh` · `gate-m3-detail.sh` · `gate-m3-episodes.sh` · `gate-m3-verified-rails.sh` (full: `MANGO_GATE_FULL=1`, 3 plays/rail)

### Library grow current state

| Area | Current implementation |
|------|------------------------|
| Growth target | Every active browse/AI rail aims for fresh `new_to_rail_verified >= grow_per_pass` (`20` in YAML; `MANGO_GROW_PER_PASS=5` only for benchmarks) |
| Couch publish | Grow writes an isolated work DB and publishes a completed publishable run even when some rails miss target; failed/aborted/crashed runs keep the previous visible rail snapshot |
| Hygiene | Completed publishable grows attach verified orphans, cap unpinned overlap, and preserve pins/curation overrides |
| Negative memory | Recent theme/no-stream/title-mismatch/unresolved-ID misses are tombstoned per rail to avoid re-probing the same bad candidates |
| Source control | Runtime-only source weights demote zero-yield and near-zero-yield catalogs into the 5-10% probation budget; catalog YAML is never auto-edited |
| Diagnostics | `grow_monitor.py`, structured refresh JSON, candidate audit samples, source-grow weights, and `source-grow-audit.py` expose failure causes |
| Regional content yield | Popular South-Indian regional lists added to `movies-india-trending`; MediaFusion India-regional trial kit added; `india-regional-yield.sh` probe bash-parsing bug fixed |

**Known hardening gap:** the pipeline is wired correctly enough for targeted repair and benchmark iteration, but sustained unattended full `+20` target completion is still blocked by source yield on thin rails. On 2026-06-25, an earlier Pi grow published `+280` unique verified titles. The scheduled 03:00 nightly later staged `+3` stale re-verifications but was aborted with rc `143`, so the work DB was discarded and the live DB stayed at `1054` unique verified titles with `0` orphans. Source audits still show the hardest thin rails are `series-reality-casual` and `series-india-picks`; their samples are mostly no-stream, duplicate-heavy, unresolved-ID, or theme-rejected. See [PLAYABILITY.md](PLAYABILITY.md), [LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md), and [catalog-rail-curation.md](../config/catalog-rail-curation.md).

---

## M4 — Addons

| Service | Port | Role |
|---------|------|------|
| AIOStreams | `:3035` | Stream aggregate · dedup · debrid |
| AIOMetadata | `:3036` | mdblist + regional catalogs |
| catalog-service | `:3020` | Stremio graph · rails · play |

**Gate:** `bash scripts/m4-addons/gate-m4-self-hosted.sh` · Setup: [reference/addon-stack.md](reference/addon-stack.md)

---

## Live TV (opt-in)

NexoTV Docker · sport rails · stale non-empty cache fallback · health-only
diagnostics · mpv `--live` · excluded from gate-lite. [LIVE_TV.md](LIVE_TV.md)

---

## M5 — Voice + AI

### Voice librarian ✓

Phone PTT or text → Hinglish STT (voice only) → LLM tools → **open detail on TV**. User presses **B** to play. Replies are **text-only** on the phone (no TTS, no speaking-state lock).

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified movies/series **+ full live IPTV catalog** (AREA69, free, news, cartoons) |
| `GET /voice/library` | Browse verified list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `GET /voice/ai/context` | Tab · open title · now playing (companion mirror) |
| `POST /voice/library/notes` | Librarian taste notes |

Tools: `mango_search` · `mango_open_title` · `mango_youtube_search` · `mango_open_youtube` · `mango_navigate` · AI catalog CRUD · save/unsave · profile/memory — **no `mango_play`**.

**Gate:** `bash scripts/m5-voice/ai/gate-m5-voice.sh` · `bash scripts/m5-voice/ai/gate-m5-companion-couch.sh`

### AI layer Phases 0–3 ✓

| Phase | Shipped |
|-------|---------|
| 0 — Spine | Tab-agnostic AI-rail engine · `GET /ai/context` |
| 1 — YouTube AI | Custom YT rails · recommender steering · voice YT tools |
| 2 — Live AI | Live adapter · channel search/open · now-playing flag |
| 3 — Companion | Text `chat_send` · rich mirror · HUD tool cards · safety corpus · chat-first phone UI |

Detail: [AI_LAYER.md](AI_LAYER.md)

### Phase 3 companion (2026-07) ✓

| Area | Implementation |
|------|----------------|
| Text input | Orchestrator `chat_send` · shared `run_agent_turn` · companion composer (Enter send, 500 char max) |
| Phone UX | Chat-first layout · collapsible YouTube / On TV drawers · bottom composer + PTT |
| Mirror | Polls `/ai/context` + launcher WS for tab, open title, playing, tool status |
| TV HUD | Tool action line on launcher voice card |
| Replies | Text bubble only — idle immediately after reply (no Piper, no composer block on "speaking") |
| Live search | `mango_search` queries full NexoTV catalog (~600+ channels), not just curated live rails |
| Persona | Concierge-curator tone via `MANGO_COMPANION_DIR` · live-TV tool policy in persona |
| Safety | EN + Hinglish corpus · `gate-m5-companion-couch.sh` |

### AI catalog slots ✓

Max **3 slots per tab** (movies · series · youtube · live) · voice CRUD + overflow.

**Gate:** `bash scripts/m5-voice/ai/gate-m5-ai-catalogs.sh`

### Living librarian ✓ (2026-07-05)

Profile · journal · conversation policy · reflection · gardener · nightly consolidate.

| Area | Implementation |
|------|----------------|
| Watch signals | `watch-signals.ts` — mpv progress → journal `play_started` / `play_completed` / `play_abandoned` |
| Familiarity | First `play_completed` per `content_key` bumps `completed_watches`; stage reapplied; compiled notes rewritten |
| Journal hygiene | `rollUpJournalEvents(90)` in nightly rule phase — summary event + prune raw events older than 90 days |
| Notes path | GET `/voice/library/notes` prefers compiled notes; nightly LLM addendum POSTs `/voice/companion/session-notes` |
| Gates | `gate-m5-companion-memory.sh` — 22 unit tests incl. watch-signals + journal rollup |

**Pi evidence:** commit `8eeb239` — companion-memory 22/22 · catalog 163/163 · ux-smoke 9/9.

### M5.5 — Companion UX split ◐

| Track | Status |
|-------|--------|
| **M5.5a** safety contract | Corpus + automated gate shipped · full LLM integration opt-in (`MANGO_VOICE_LLM_INTEGRATION=1`) |
| **M5.5b** polish | **Round code shipped** — structured pick cards · HUD 12s dismiss · couch-safe errors · companion-couch in gate-lite · manual V1–V12 pending |

Round scope: [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md) · [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)

Full detail: [VOICE.md](VOICE.md)

---

## M6.1 — Mango-owned library core ✓

Mango now owns durable local user-library state. Stremio remains an addon
protocol/manifest graph only; there is no Stremio user-library sync or write-back.

| Area | Current implementation |
|------|------------------------|
| Storage | `/etc/mango/library.db` SQLite with WAL, migrations, source-aware item keys, and dormant hidden/blocked fields |
| Saved | Explicit only; detail Save/Unsave writes `saved_items`; playback never auto-saves |
| Migration | Existing `~/.config/mango/user-pins.json` imports once into Saved; `/pins` remains a compatibility wrapper over Saved |
| Rails | Continue remains `progress.db`; Saved appears immediately after Continue and before discovery rails when non-empty |
| History | mpv progress writes and live play starts mirror into indefinite library history; VOD finished uses the existing 90% cutoff |
| Voice | `mango_save_title` and `mango_unsave_title` support current context, exact type/id, or exact resolved title; they never start playback |
| Library context | Launcher publishes current detail context to catalog-service for voice Save/Unsave; librarian context reads Saved/history only |
| Backup | `mango-stack.sh stop/restart` runs WAL-safe backups of `progress.db` and `library.db`; operators can also run `scripts/m6-ship/backup-library-state.sh` |
| AI catalogs | Overflow is replace/merge only; AI automation cannot write to Saved |
| YouTube readiness | Schema is source-aware and is used by M6.2 native YouTube; M6.1 itself added no YouTube behavior |

Primary routes: `GET /library/state`, `GET/POST/DELETE /library/saved`,
`GET /library/history`, `GET/POST/DELETE /library/context`, plus Saved-backed
`GET/POST/DELETE /pins` compatibility.

---

## M6.2 — Native YouTube ✓ hardening

Native YouTube is implemented, deployed, and Pi-gated on the couch stack. See [YOUTUBE.md](YOUTUBE.md).

Latest Pi evidence as of 2026-07-01: commit `b74bc6b` passed `pi-deploy --fast --gate`,
`scripts/m6-ship/gate-m6-youtube-smoke.sh`, and a direct Popular rail probe
showing 9 unique non-live/non-Short cards with cache-only reshuffle.

| Area | Current implementation |
|------|------------------------|
| Storage | `/etc/mango/youtube.db` rebuildable SQLite cache with WAL, rail membership, recommender/rail reservoirs, refresh/quota state, and OAuth auth sessions |
| User state | `/etc/mango/library.db` durable `source="youtube"` Saved videos, history, current context, and Not Interested feedback; Saved videos remain until explicit Unsave |
| Config | `/etc/mango/youtube-api.key`, `/etc/mango/youtube-oauth-client.json`, `/etc/mango/youtube-auth.json`, optional cookies; examples only in repo |
| Auth | Companion starts/polls Google device-code OAuth and disconnects local token; token file is written `0600` |
| API | `/youtube/state`, auth start/poll/disconnect, refresh, rails, grouped search with cached fallback on quota/rate limits, detail, not-interested, play |
| Rails | 9-up Saved, Mango-local History, reservoir-backed For You, diverse unwatched New From Subscriptions inbox, reservoir-backed Fresh Finds broad discovery, seed-scoped Because You Watched, short-TTL reservoir-backed Live Now, neutral reservoir-backed Popular; VOD stale cache remains visible |
| Refresh | Nightly 03:00 playability timer runs movie/TV stale+grow first, then independently runs phase-isolated `/youtube/refresh` for Popular, subscriptions, Fresh Finds, Live Now, Because You Watched, and For You; Popular uses cheap `videos.list` most-popular region/category charts, Live Now uses fresh cached live metadata before bounded live searches, and non-shuffle tab loads can trigger throttled background live-only refresh when stale |
| Launcher | YouTube tab after Live; shuffle re-samples Mango-local History, For You, New From Subscriptions, Fresh Finds, Because You Watched, Live Now, and Popular without couch-time API calls; videos play/save, channels/playlists open video lists, Not Interested removes discovery cards |
| Playback | Mango wrapper `scripts/m6-ship/youtube-yt-dlp.sh` resolves video/audio URLs with fallback format selectors; deploy refreshes an isolated user `yt-dlp` venv; mpv plays them and writes local history/progress as YouTube source |
| Voice | `mango_youtube_search` and `mango_open_youtube`; Save/Unsave supports current/exact YouTube video; no voice playback |
| Fallback | Legacy Kodi YouTube is emergency-only with `MANGO_LEGACY_YOUTUBE=1` |

Gates:

```bash
cd src/catalog-service && npm run test:gate
cd src/catalog-service && npm test
cd src/launcher && npm run build
cd src/companion && npm run build
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
bash scripts/m6-ship/gate-m6-youtube-smoke.sh
MANGO_YOUTUBE_PLAY=1 bash scripts/m6-ship/gate-m6-youtube-smoke.sh
```

The default YouTube smoke verifies state, rails, configured `yt-dlp`, API-backed search/detail when an API key is present, and skips playback unless `MANGO_YOUTUBE_PLAY=1`.

---

## Reliability Center / nightly proof ✓

Reliability Center is the operator-facing proof surface in Settings and
catalog-service. It records whether Mango is ready for couch use and whether the
last unattended refresh proved the stack.

| Area | Current implementation |
|------|------------------------|
| API | `/reliability/state`, `/reliability/proofs`, proof run, safe repair, stack restart, refresh run |
| UI | Settings shows Green/Yellow/Red summary, component cards, and safe actions; home only shows a quiet Settings badge when degraded |
| Proof ledger | `/etc/mango/reliability/proofs.jsonl`, local-only, 30-day retention |
| Nightly chain | `nightly-library-refresh.sh` runs movie/TV, then YouTube independently, then records reliability proof with branch return codes |
| Repair | Delegates to `mango-health-repair.sh --quiet`; no DB rebuilds, cache clears, or destructive repairs |
| Gate | `scripts/m6-ship/gate-m6-reliability-proof.sh` fails red, warns yellow |

Detail: [RELIABILITY.md](RELIABILITY.md).

---

## M6 hardening — Efficiency & performance (Tiers 1-4) ✓

A repo-wide efficiency audit shipped and is Pi-proven across four tiers: DB/cache
overhead, perceived input/render latency, voice idle cost, and resource-guard
safety.

| Tier | Focus | Current implementation |
|------|-------|-------------------------|
| 1 — Efficiency | DB + cache overhead | Playability DB is a singleton; YouTube rails have a TTL cache; nightly WAL checkpoint script (`checkpoint-wal-dbs.sh`) |
| 2 — Perceived latency | Input/render feel | D-pad input resolves in a single window with caching in `mango-tv-pad.py`; launcher reuses per-tab DOM instead of full rebuilds; UI server serves HTTP/1.1 keep-alive with static asset caching |
| 3 — Idle cost | Voice command delivery | Fixed 150 ms HTTP poll replaced with an HTTP long-poll (`threading.Condition` in `serve.py`, `AbortController` on the frontend); idle load dropped from ~6.7 req/s to ~0.04 req/s |
| 4 — Resource guards & safety | Contention protection | Memory cgroup v2 controller enabled at boot (`cgroup_enable=memory` in `cmdline.txt`); systemd `MemoryMax`/`MemoryHigh`/`TasksMax` for `mango-launcher-chromium` (1536M/2048M) and `mango-catalog` (768M/1280M); `CPUWeight=60` on catalog so foreground UI wins under contention |

---

## D-pad browse latency (Tiers A–C) ✓

A three-tier pass cut launcher D-pad input-to-photon latency on the browse path.

| Tier | Focus | Current implementation |
|------|-------|------------------------|
| A — Pad hot path | Cut per-press work | `get_launcher_wid()` cache (2s TTL); stop invalidating foreground cache on every evdev event; fast launcher key (`activate=False` when launcher focused); `write_status` only on heartbeat/state transitions; `DPAD_DEBOUNCE_SEC=0.05` vs `0.12` for face buttons; removed `ensure-launcher` from display-wake |
| B — Periodic lag + launcher feel | Kill the ~every-4th-click spike | Async/throttled couch-activity (`popen`, 0.5s throttle); display wake = inline `xset` only from pad (no present-launcher on D-pad); launcher foreground cache TTL → 2s; `send_key_launcher(symbol, app=app)`; `logPerf` off by default; O(1) focus class toggle; instant focus-ring CSS (`--dur-focus-in/out: 0ms`) |
| C — GPU rasterization + pad-nav API | Snappier repaints + direct focus | Pi 5 Chromium GPU rasterization on by default (`--enable-gpu-rasterization --ignore-gpu-blocklist --enable-zero-copy`, `MANGO_CHROMIUM_DISABLE_GPU=0`); opt-in pad → launcher focus API (`MANGO_PAD_NAV_API=1`) — pad POSTs directional intents to `/api/pad/nav`, launcher long-polls and applies focus directly to FocusGrid, xdotool fallback on any HTTP failure |

---

## M6.3 — target-TV playback (mpv-hifi) ◐

Mango ships a unified **mpv-only** couch playback path. Browse stays
`1920x1080@60`; mpv source-matches the TV on play and `ensure-launcher` restores
1080p browse on every stop/home/deploy path.

| Area | Current implementation |
|------|------------------------|
| Stream policy (ship) | `config/catalog-filters.4k-hifi.example.json` — cached 4K SDR HEVC REMUX first, HDR excluded above 1080p, 1080p fallbacks |
| Stream policy (baseline) | `config/catalog-filters.4k-hdr.example.json` — cached 4K HEVC, no REMUX |
| Engine switch | `scripts/m6-ship/set-playback-engine.sh mpv\|mpv-hifi\|status` |
| Display/audio base | `scripts/m6-ship/apply-4k-hdr-profile.sh apply\|revert\|status` — launcher 1080p60, mpv 4K match, HDMI audio |
| Decode/presentation | mpv `gpu` VO, `hwdec=auto-safe`, deferred foreground, launcher stopped during fullscreen, `xcompmgr` off |
| Display enforcement | `mango-display-mode.sh ensure-launcher` on stack boot, home, present, stop, deploy, display-wake |
| Playback OSD/input | `playback-osd.py` on pause/seek; pad → mpv IPC |
| Gates | `gate-m6-playback-ssot.sh` (mpv-only + idle 1080p browse) · `gate-m6-4k-hdr-profile.sh` (profile + EDID + resources) |

4K stream quality is owned by catalog filters + mpv ladder — never by Chromium
resolution.

---

## M6.5 — Unified TV/companion UX ◐

**Code shipped** in the M5.5b/M6.5 round (2026-07-05); **merge bar** is manual couch sign-off (COUCH_TEST U1–U9 + voice V1–V12).

| Area | Shipped |
|------|---------|
| Detail navigation | 2D `FocusGrid` — actions L/R · episodes/streams U/D |
| Voice HUD | Safe-area CSS (`env(safe-area-inset-*)`) · max-height cap · 12s wall-clock dismiss |
| Companion picks | Numbered tappable rows · `pick_select` WS (no LLM round-trip) |
| YouTube AI rails | 9-card cap · gate isolates `MANGO_AI_CATALOGS_DIR` |
| Automated gate | `gate-m6-ux-smoke.sh` in `pi-pre-couch-gate.sh` on `feat/native-experience` |

**Pi evidence:** commit `8eeb239` — ux-smoke 9/9 PASS.

Spec: [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md) · Round: [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md)

---

## Open priorities

Efficiency & performance audit (Tiers 1-4 — DB/cache efficiency, perceived latency, voice idle cost, resource guards) is shipped and Pi-proven; it is no longer an open item. Remaining priorities:

| # | Item | Milestone |
|---|------|-----------|
| 1 | **Comprehensive couch sign-off** — COUCH_TEST V1–V12 + U1–U9 + memory/familiarity | M5.5b / M6.5 |
| 2 | Monitor unattended nightly proof + M3 `+20` grow hit rate | M3 |
| 3 | YouTube rail quality + quota/live-refresh monitoring | M6.2 |
| 4 | 4K HDR TV + soundbar validation on target TV | M6.3 |
| 5 | First-boot wizard | M6.4 |

---

## Gates {#gates}

| Gate | Role |
|------|------|
| **`gate-lite.sh`** | Default deploy (~2 min) — M1–M4 + M2–M3 + M5 (if voice) + 2-play smoke |
| `pi-pre-couch-gate.sh` | Mac wrapper |
| `MANGO_GATE_FULL=1` | Full gate (~5–8 min) — holistic M1/M4 + **3 plays/rail** + play orchestrator |
| `gate-m4-self-hosted.sh` | Self-hosted addon corpus |
| `gate-live-iptv.sh` | Opt-in live only |
| `gate-m6-youtube-smoke.sh` | Native YouTube state/rails/search/detail and optional playback |
| `gate-m5-companion-memory.sh` | Living librarian profile/journal/watch-signals/rollup (22 tests) |
| `gate-m6-ux-smoke.sh` | M6.5 focus/HUD DOM+CSS contracts; detail FocusGrid bundle; pad alive |
| `gate-m6-reliability-proof.sh` | Reliability Center proof; fails red and warns yellow |
| `gate-m6-4k-hdr-profile.sh` | M6.3 Stage 2 profile/display/resource gate |

```bash
bash scripts/pi-exec-gate.sh
bash scripts/pi-deploy.sh --fast --gate
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
bash scripts/m6-ship/gate-m6-reliability-proof.sh
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh
```

### catalog-service tests

| Tier | Command |
|------|---------|
| gate | `npm run test:gate` |
| full | `npm run test` |

---

## Config

| Repo example | Pi path | Purpose |
|--------------|---------|---------|
| `config/stremio-export.example.json` | `/etc/mango/stremio-export.json` | Addon graph |
| `config/catalog-filters.example.json` | `/etc/mango/catalog-filters.json` | Play ladder |
| `config/catalog-filters.4k-hdr.example.json` | `~/.config/mango/catalog-filters.4k-hdr.json` via apply script | M6.3 target-TV safe playback profile |
| `config/catalog.example.yaml` | `/etc/mango/catalog.yaml` | Browse rails |
| `config/rail-theme-profiles.yaml` | repo (or `MANGO_RAIL_THEME_PROFILES`) | Thematic fit for grow + retheme |
| `config/rail-curation-overrides.example.yaml` | `/etc/mango/rail-curation-overrides.yaml` | Pins / blocks |
| `config/catalog-live.example.yaml` | `/etc/mango/catalog-live.yaml` | Live rails |
| `config/youtube-oauth-client.example.json` | `/etc/mango/youtube-oauth-client.json` | Google OAuth client example |
| — | `/etc/mango/youtube-api.key` | YouTube Data API key |
| — | `/etc/mango/youtube-auth.json` | YouTube OAuth token, local `0600` |
| — | `/etc/mango/youtube.db` | Rebuildable YouTube metadata/cache |
| — | `/etc/mango/playability.db` | Verified pools |
| — | `/etc/mango/progress.db` | mpv resume |
| — | `/etc/mango/library.db` | Mango-owned Saved/history/finished state |
| — | `/etc/mango/ai-catalogs/` | AI catalog slots |

Deploy sync: `scripts/lib/sync-etc-mango-config.sh`

---

## Anti-patterns

| Do not | Why |
|--------|-----|
| Standalone Torrentio in export | Breaks AIOStreams dedup |
| ElfHosted in hot path | Rate limits |
| `rsync` repo to Pi | Git push + pull only |
| Shawshank-only stream gates | Misses India/Hindi/series |
| Voice `mango_play` | Pad **B** owns playback |
| Voice `play_youtube` / `mango_play_youtube` | YouTube follows the same voice-open, pad-play contract |

---

## Deploy loop

1. Diagnose on Pi · 2. Fix on Mac · 3. Push (when asked) · 4. `pi-deploy.sh` · 5. Couch test

[DEPLOY.md](DEPLOY.md)
