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
| M6 Ship | ◐ | M6.1 ✓ · M6.2 base Pi-gated ✓ · profile-aware recommendations local/TV proof deferred · Reliability Center ✓ · efficiency/perf Tiers 1–4 ✓ · **M6.5 round code ✓** · **launcher UX polish round code ✓ (`539ebdb`, couch sign-off pending)** · 4K Stage 2 validation · wizard pending |

---

## M2 — Browse

| Feature | Detail |
|---------|--------|
| Browse | Search magnifier · Movies · Series · Live · YouTube (L/R shoulders switch browse tabs) |
| Grid/input | 6 posters / 4 landscape per rail, one row each · Home `X` rotates eligible current-tab discovery (VOD Saved/Continue retain their existing tail policy; YouTube History/Saved stay stable) · Search `X` tap delete / 600 ms hold clear |
| Rails | YAML + AI catalog slots + Continue |
| Service | `catalog-service :3020` · `GET /rails` |
| Proxy | `serve.py` → `/api/catalog/*` |

**Gate:** `bash scripts/m2-catalog/browse/gate-m2-browse.sh`

---

## M3 — Play

| Feature | Detail |
|---------|--------|
| Play orchestrator | Concurrent/coalesced resolve · up to two classified empty confirmations inside the same exact-ID flight/deadline · one bounded multi-phase attempt budget · probe-then-play · display-neutral candidate rejection · pipeline-fatal stop |
| Stream picker | `GET /stream/{type}/{id}` · `display_label` rows |
| Continue | Profile-exact `progress.db` v2 · mpv position watcher |
| Episodes | Season list · per-episode streams · next-up overlay |
| Playability | `playability.db` verified pools · best-effort thematic grow jobs with `+20` SLA warnings |
| Browse UX | Verified-only thin rails · empty hidden |
| Thematic rails | `rail-theme-gate` on grow/link/verify · profiles in `rail-theme-profiles.yaml` |
| Pool retheme | Manual repair plus grow orphan/overlap finalization |
| Couch reliability | Chromium launcher · 1080p60 couch display mode · fetch/focus timing logs · Live stale-cache fallback · idle-gated maintenance · X11 anti-sleep/wake · leased pad consumer with 3 s bounded Chromium self-heal |

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
| Rails | Continue remains profile-exact `progress.db`; Saved appears immediately after Continue and before discovery rails when non-empty |
| History | mpv progress writes and live play starts mirror into indefinite library history; VOD finished uses the existing 90% cutoff |
| Voice | `mango_save_title` and `mango_unsave_title` support current context, exact type/id, or exact resolved title; they never start playback |
| Library context | Launcher publishes current detail context to catalog-service for voice Save/Unsave; librarian context reads Saved/history only |
| Backup | `mango-stack.sh stop/restart` runs WAL-safe backups of `progress.db` and `library.db`; operators can also run `scripts/m6-ship/backup-library-state.sh` |
| AI catalogs | Overflow is replace/merge only; AI automation cannot write to Saved |
| YouTube readiness | Schema is source-aware and is used by M6.2 native YouTube; M6.1 itself added no YouTube behavior |

Primary routes: `GET /library/state`, `GET/POST/DELETE /library/saved`,
`GET /library/history`, `GET/POST/DELETE /library/context`, plus Saved-backed
`GET/POST/DELETE /pins` compatibility.

### Fire & Water ratings / For You — profile-aware code local; Pi/couch proof pending

| Area | Current implementation |
|------|------------------------|
| Durable state | Non-destructive `library.db` migrations 4–11 add ratings, profiles/signals, attribution/outcomes, profile metrics, opaque served-slate tokens with exact context, and profile watch state; `progress.db` migration 2 adds profile-exact Continue/resume. Legacy unscoped watch state migrates only to Household |
| Migration safety | One guarded online SQLite backup before v4; all pending `library.db` schemas, backfills, and version markers commit in one immediate transaction and roll back together on failure; DB/history/cache are never deleted or recreated |
| Profiles | Household is the no-prompt default; up to seven optional personal profiles, no PIN/startup chooser, explicit activation, stable-ID rename, clean personal state, and Household exact-dislike veto |
| Mood | Explicit, bounded, expiring session input only; profile activation clears it and Mango never infers mood |
| Rating UI | Detail Rate/Edit Rating plus compact chips; Fire uses five flame emoji and Water five wave emoji, with saturated fill, gray remainder, and clipped half marks matching the household reference |
| Controller | B enters/confirms adjustment and saves; arrows move/change exact half-steps; Y cancels; contextual X confirms clear; existing pad ownership/bindings are unchanged |
| Prompts | Profile-exact movie at 90% natural completion; series after three distinct profile-owned completed episodes, with a season-finale event hook; invitation never steals focus |
| Ranking | Explicit Fire/Water dominates confidence-weighted dual-horizon watch/save signals; every visible rail is exactly six currently verified-playable cards (4 close, 1 adjacent, 1 surprise), otherwise omitted; diversity caps and a rare cooled rewatch lane apply |
| AI boundary | Optional semantic enrichment is background-only; cache reads/writes are batched, watched/Saved anchors retain valid semantics, CPU-heavy scoring/MMR runs in a deadline-bounded worker, the versioned local ranker owns eligibility/final publication, and couch reads retain the last complete snapshot |
| Attribution | Opaque server token binds immutable served owner/domain/rail/revision/membership/context and stale actions return 409. Public cards carry only the content identity required to act; the TV never renders raw IDs, scores, prompts, tags, URLs, or credentials |
| Read coherence | VOD, YouTube, Continue, parallel Saved, Search Detail Saved markers, and Settings hidden-title reads/restores carry the captured profile/revision, require an exact server echo, and fail with 409 on change. Owner-bound rail/Saved caches are activated only together; strict VOD never falls back to legacy endpoints after an ownership failure |
| Detail action coherence | Rating/prompt, Save/Unsave, Not-for-me/Undo, current context, playback acceptance/return, and next-episode reads use the immutable Detail owner and exact echo; client rail labels never count a play, and a validated attributed watch start is idempotent |
| Rail placement | Continue → Saved → For You → user AI catalogs → curated discovery; For You does not consume a user AI slot |
| Nightly | Companion pipeline skips foreground playback/grow overlap and refreshes recommendations after optional AI/gardener phases |
| Flags | `MANGO_FIRE_WATER_RATINGS`, `MANGO_FOR_YOU`, `MANGO_RECOMMENDATIONS_AI` (set `0` to disable without deleting state) |
| Companion | `mango_manage_viewer_profile` lists, creates, renames, activates, and completes onboarding through the same `library.db` authority |
| Deferred | This profile-aware redesign is not claimed deployed: stable-ID seed reconciliation/import, Pi latency/restart/offline proof, screenshots, and human recommendation-quality verdict remain **DEFERRED** |

Detail and home runbook: [FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md).

---

## M6.2 — Native YouTube base ✓; profile-aware recommendations local

The native YouTube base was previously deployed and Pi-gated. The current
profile-aware rail allocator and feedback changes are local code only; current
deployment, Pi diagnostics, screenshots, and TV behavior are **DEFERRED**. See
[YOUTUBE.md](YOUTUBE.md).

Latest Pi evidence as of 2026-07-01: commit `b74bc6b` passed `pi-deploy --fast --gate`,
`scripts/m6-ship/gate-m6-youtube-smoke.sh`, and a direct Popular rail probe
under the superseded nine-card contract. It is not proof for the current
four-card profile allocator.

| Area | Current implementation |
|------|------------------------|
| Storage | `/etc/mango/youtube.db` rebuildable SQLite cache with WAL, rail membership, recommender/rail reservoirs, refresh/quota state, and OAuth auth sessions |
| User state | `/etc/mango/library.db` durable profile-scoped `source="youtube"` Saved, Mango-local history, searches, current context, Not-for-me, and recommendation events; Household preserves legacy state |
| Config | `/etc/mango/youtube-api.key`, `/etc/mango/youtube-oauth-client.json`, `/etc/mango/youtube-auth.json`, optional cookies; examples only in repo |
| Auth | Companion starts/polls Google device-code OAuth and disconnects local token; token file is written `0600` |
| API | Localhost-only operator `/youtube/state` + auth; field-minimized `/youtube/companion/*` through HTTPS; refresh, rails, impressions, grouped search with cached fallback on quota/rate limits, detail, reversible not-interested, play |
| Rails | Exactly four cards per visible rail; anchors For You → Subscriptions → History → Saved, then at most three adaptive rails from Because You Watched, custom AI, Live Now, Fresh Finds, and Trending for you; YouTube last-good cache remains visible and a rail that cannot supply four cards is omitted |
| Refresh | Nightly 03:00 playability timer runs movie/TV stale+grow first, then independently runs phase-isolated `/youtube/refresh` for Popular, subscriptions, Fresh Finds, Live Now, Because You Watched, and For You; Popular uses cheap `videos.list` most-popular region/category charts, Live Now uses fresh cached live metadata before bounded live searches, and non-shuffle tab loads can trigger throttled background live-only refresh when stale |
| Launcher | X advances only deterministic cached discovery slates; History/Saved stay stable and X spends no API quota. Profile/mood attribution is bounded; Not for me is profile-local and reversible |
| Ranking | Explicit feedback dominates dual-horizon usage; exact Saved videos inform taste but stay out of For You so the Saved anchor remains complete. Successful For You rebuilds atomically replace/prune the bounded reservoir while preserving retained profile state. With healthy lane supply, deterministic four-card patterns keep exact long-run 70/20/10 allocation; thin-supply fallback is recorded |
| Playback | Mango wrapper `scripts/m6-ship/youtube-yt-dlp.sh` resolves video/audio URLs with fallback format selectors; deploy refreshes an isolated user `yt-dlp` venv; mpv plays them and writes local history/progress as YouTube source |
| Voice | `mango_youtube_search`, `mango_open_youtube`, and `mango_manage_viewer_profile`; Save/Unsave supports current/exact YouTube video; no voice playback |
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
| API | `/reliability/state`, `/reliability/proofs`, controller state/repair, proof run, safe repair, stack restart, refresh run |
| UI | Settings shows Green/Yellow/Red summary, component cards, and safe actions; home only shows a quiet Settings badge when degraded |
| Proof ledger | `/etc/mango/reliability/proofs.jsonl`, local-only, 30-day retention |
| Nightly chain | `nightly-library-refresh.sh` runs movie/TV, then YouTube independently, then records reliability proof with branch return codes |
| Repair | Delegates to `mango-health-repair.sh --quiet`; no DB rebuilds, cache clears, or destructive repairs |
| Gate | `scripts/m6-ship/gate-m6-reliability-proof.sh` fails red, warns yellow |
| Controller | `mango-controller-link` owns BlueZ reconnect; `mango-tv-pad` owns evdev only; Pi install/couch proof pending home-agent handoff |

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
| C — GPU rasterization + pad-nav API | Snappier repaints + direct focus | Pi 5 Chromium GPU rasterization on by default (`--enable-gpu-rasterization --ignore-gpu-blocklist --enable-zero-copy`, `MANGO_CHROMIUM_DISABLE_GPU=0`); pad → launcher focus API is default-on (`MANGO_PAD_NAV_API=1`) — leased launcher consumer long-polls `/api/pad/nav`, drops stale movement, escapes a stalled rAF after 50 ms, and triggers a state-preserving Chromium-only restart after 3 s without input progress |

---

## M6.3 — target-TV playback (mpv-hifi) ◐

Mango ships a unified **mpv-only** couch playback path. Browse stays
`1920x1080@60`; mpv source-matches the TV on play and `ensure-launcher` restores
1080p browse on every stop/home/deploy path.

| Area | Current implementation |
|------|------------------------|
| Stream policy (ship) | `config/catalog-filters.4k-hifi.example.json` — path capability first; compatible 4K SDR HEVC before 1080p; 4K HDR/DV and software 4K retained as final fallback |
| Stream policy (baseline) | `config/catalog-filters.4k-hdr.example.json` — cached 4K HEVC, no REMUX |
| Engine switch | `scripts/m6-ship/set-playback-engine.sh mpv\|mpv-hifi\|status` |
| Runtime source of truth | `~/.config/mango/voice.env` written by `set-playback-engine.sh`; run `set-playback-engine.sh status` on the Pi before claiming the active profile. `mpv-hifi` is the intended ship profile, not a work-Mac assumption. |
| Display/audio base | `scripts/m6-ship/apply-4k-hdr-profile.sh apply\|revert\|status` — launcher 1080p60, mpv 4K match, HDMI audio |
| Decode/presentation | mpv `gpu` VO, `hwdec=auto-safe`, deferred foreground, launcher stopped during fullscreen, `xcompmgr` off |
| Display enforcement | `mango-display-mode.sh ensure-launcher` on stack boot, home, present, stop, deploy, display-wake |
| Playback OSD/input | Cinematic safe-area mpv Lua HUD with exact action feedback, minimal pause badge, delayed buffering, Live mode, and movie/series Streams drawer; pad → mpv IPC |
| Playback lifecycle | Async, idempotent `/play-session` acceptance survives Chromium hide/restart; durable `ever_ready` suppresses false post-play errors; generation-scoped PID exit cleanup cannot stop a newer play |
| Stream selection | Numeric episode markers are authoritative; full marker > bare marker > unmarked; path-scoped `proven_smooth`/`unknown`/`known_risky` tiers cannot be overridden by cache or scalar hints |
| In-playback switching | **X** opens a URL-free five-choice bottom drawer; current first/best alternate focused/unavailable last; 8s cached/25s uncached validation; contextual X Undo; position/track restoration; original-source fallback; no auto-switching |
| Evidence | `/etc/mango/playability.db` `stream_path_evidence`, keyed by release fingerprint + playback profile; signed URLs are never persisted |
| Transport recovery | One bounded clean/transient-empty confirmation before VOD title exhaustion, plus one fresh resolve for stale cached VOD/YouTube links; no retry on provider error, cancellation, rate limit, malformed media, or deadline exhaustion; YouTube 429s enter a local cooldown |
| 4K+audio smoothness | `--blend-subtitles=no` default (`MANGO_MPV_BLEND_SUBTITLES`); `yes` caused ~2.5 drops/s with audio on Pi 5 — Pi-proven 0 drops/s with eac3 4K |
| Gates | `gate-m6-playback-ssot.sh` · `gate-m6-4k-hdr-profile.sh` · `gate-m6-stream-picker-source.sh` · `gate-m6-stream-picker-smoke.sh` · `playback-smoothness-probe.sh` |

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
| YouTube recommendations | Four-card anchors/adaptives, profile-scoped state, and cache-only X; current Pi/couch proof **DEFERRED** |
| Automated gate | `gate-m6-ux-smoke.sh` in `pi-pre-couch-gate.sh` on `feat/native-experience` |
| Unified Search | Full-bleed temporary magnifier surface with safe-area controls, local keyboard suggestions, progressively reconciled source-isolated rows, silent partial failures, neutral empty state, rail-local More tiles, origin-aware Detail/playback return without remount, coalesced restart-safe state, 12 recents, SafeSearch, query cache and split quota reserves |

**Pi evidence:** commit `8eeb239` — ux-smoke 9/9 PASS.

Spec: [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md) · Round: [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md)

Search source of truth: [SEARCH.md](SEARCH.md). Automated proof:
`gate-m6-search-smoke.sh` is diagnostic/cache-only and must not change search
history, YouTube quota, or playback state.

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
| `gate-m6-search-smoke.sh` | Non-mutating local/cached Search state, suggestions, long-poll, phase isolation, quota/history/playback invariants |
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
