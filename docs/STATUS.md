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
| M5 Voice + AI | ◐ | Librarian + AI catalogs shipped · living librarian + M5.5a voice contract pending |
| M6 Ship | — | Mango library · YouTube · 4K · unified UX · wizard |

---

## M2 — Browse

| Feature | Detail |
|---------|--------|
| Tabs | Movies · Series · Live (L/R shoulders) |
| Grid | 9-up posters · ↻ shuffle (pad `317`) |
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
| ~10 min | Quick top-up | `quick-playability-topup.sh --detach` |
| ~45 min | Nightly pass | `playability-maintenance.sh --mode nightly` |
| ~4 h | Overnight grow | `overnight-playability-grow.sh --detach` |

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

Phone PTT → Hinglish STT → LLM tools → **open detail on TV**. User presses **B** to play.

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified library search |
| `GET /voice/library` | Browse verified list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `POST /voice/library/notes` | Librarian taste notes |

Tools include `mango_search` · `mango_open_title` · `mango_navigate` — **no `mango_play`**.

**Gate:** `bash scripts/m5-voice/ai/gate-m5-voice.sh` (gate-lite when `MANGO_VOICE=1`)

### AI catalog slots ✓

Max **3 slots per tab** · `/etc/mango/ai-catalogs/slots/` · voice CRUD + overflow.

**Gate:** `bash scripts/m5-voice/ai/gate-m5-ai-catalogs.sh`

### Living librarian ◐

Profile · journal · conversation policy · reflection.

### AI catalog bootstrap ✓

Compose · reserve · async bootstrap. E2E: `MANGO_AI_CATALOG_BOOTSTRAP_E2E=1` on gate.

### M5.5 — Companion UX split —

M5.5a locks the voice safety contract before new surfaces: no false opens, `tv_seq` acks, tool manifest/persona alignment, and couch corpus gates. M5.5b final phone/HUD polish moves after native YouTube so one UX pass covers Movies, Series, Live, and YouTube. [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)

Full detail: [VOICE.md](VOICE.md)

---

## Open priorities

| # | Item | Milestone |
|---|------|-----------|
| 1 | Prove repeated unattended best-effort grows and improve `+20` target hit rate with stronger playable sources for reality and India-series rails | M3 hardening |
| 2 | Living librarian (memory + policy) | M5 |
| 3 | M5.5a AI companion voice safety contract | M5 |
| 4 | Mango-owned library state | M6.1 |
| 5 | YouTube yt-dlp rail/search/detail | M6.2 |
| 6 | 4K HDR TV + soundbar profile | M6.3 |
| 7 | M5.5b + M6.5 unified companion/TV UX polish after YouTube | M6.5 |
| 8 | First-boot wizard | M6.4 |

---

## Gates {#gates}

| Gate | Role |
|------|------|
| **`gate-lite.sh`** | Default deploy (~2 min) — M1–M4 + M2–M3 + M5 (if voice) + 2-play smoke |
| `pi-pre-couch-gate.sh` | Mac wrapper |
| `MANGO_GATE_FULL=1` | Full gate (~5–8 min) — holistic M1/M4 + **3 plays/rail** + play orchestrator |
| `gate-m4-self-hosted.sh` | Self-hosted addon corpus |
| `gate-live-iptv.sh` | Opt-in live only |

```bash
bash scripts/pi-exec-gate.sh
bash scripts/pi-deploy.sh --fast --gate
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
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
| `config/catalog.example.yaml` | `/etc/mango/catalog.yaml` | Browse rails |
| `config/rail-theme-profiles.yaml` | repo (or `MANGO_RAIL_THEME_PROFILES`) | Thematic fit for grow + retheme |
| `config/rail-curation-overrides.example.yaml` | `/etc/mango/rail-curation-overrides.yaml` | Pins / blocks |
| `config/catalog-live.example.yaml` | `/etc/mango/catalog-live.yaml` | Live rails |
| — | `/etc/mango/playability.db` | Verified pools |
| — | `/etc/mango/progress.db` | mpv resume |
| — | `/etc/mango/library.db` | Mango-owned saved/history/finished state (planned M6.1) |
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
