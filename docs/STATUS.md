# mango — current status

**Branch:** `feat/native-experience` · **Plan:** [ROADMAP.md](ROADMAP.md) · **Couch:** [COUCH_TEST.md](COUCH_TEST.md)

What works today, how to verify it, and what's next.

---

## Milestones

| Milestone | Status | Headline |
|-----------|--------|----------|
| M1 Foundation | ✓ | `mango-stack.sh` · pad · gates |
| M2 Browse | ✓ | Movies / Series / Live tabs |
| M3 Play | ✓ | mpv · picker · episodes · playability |
| M4 Addons | ✓ | AIOStreams + AIOMetadata on Pi |
| M5 Voice + AI | ◐ | Librarian + AI catalogs shipped · living librarian + M5.5 next |
| M6 Ship | — | Library · YouTube · 4K · TV UX · wizard |

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
| Playability | `playability.db` verified pools · grow jobs |
| Browse UX | Verified-only thin rails · empty hidden |

### Playability ops (Pi)

| Job | UI label | Script |
|-----|----------|--------|
| Reshuffle | Refresh library | inline |
| ~10 min | Quick top-up | `quick-playability-topup.sh --detach` |
| ~45 min | Nightly pass | `playability-maintenance.sh --mode full` |
| ~4 h | Overnight grow | `overnight-playability-grow.sh --detach` |

Status: `python3 scripts/diag/playability-status.py`

**Gates:** `gate-m3-play-ladder.sh` · `gate-m3-detail.sh` · `gate-m3-episodes.sh` · `gate-m3-verified-rails.sh` (full: `MANGO_GATE_FULL=1`)

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

NexoTV Docker · sport rails · mpv `--live` · excluded from gate-lite. [LIVE_TV.md](LIVE_TV.md)

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

### M5.5 — Companion UX ship bar —

Capability review + phone/HUD polish. **M5 merge blocker.** [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)

Full detail: [VOICE.md](VOICE.md)

---

## Next priorities

| # | Item | Milestone |
|---|------|-----------|
| 1 | Living librarian (memory + policy) | M5 |
| 2 | M5.5 AI companion UX ship bar | M5 |
| 3 | Library sync + write-back | M6.1 |
| 4 | YouTube yt-dlp rail | M6.2 |
| 5 | 4K HDR TV + soundbar profile | M6.3 |
| 6 | TV UI/UX ship polish | M6.5 |
| 7 | First-boot wizard | M6.4 |

---

## Gates {#gates}

| Gate | Role |
|------|------|
| **`gate-lite.sh`** | Default deploy — M1–M4 + M2–M3 + M5 (if voice) |
| `pi-pre-couch-gate.sh` | Mac wrapper |
| `MANGO_GATE_FULL=1` | Per-rail verified play sweep |
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
| `config/catalog-live.example.yaml` | `/etc/mango/catalog-live.yaml` | Live rails |
| — | `/etc/mango/playability.db` | Verified pools |
| — | `/etc/mango/progress.db` | mpv resume |
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

---

## Deploy loop

1. Diagnose on Pi · 2. Fix on Mac · 3. Push (when asked) · 4. `pi-deploy.sh` · 5. Couch test

[DEPLOY.md](DEPLOY.md)
