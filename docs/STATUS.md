# mango — current status

**Branch:** `feat/native-experience` · **Plan:** [ROADMAP.md](ROADMAP.md) · **Couch:** [COUCH_TEST.md](COUCH_TEST.md)

Authoritative inventory of what works today, how to verify it, and what is next.

---

## Milestone summary

| Milestone | Status | Headline |
|-----------|--------|----------|
| M1 Foundation | ✓ | `mango-stack.sh` · pad · gates |
| M2 Browse | ✓ | Movies / Series / Live tabs |
| M3 Play | ✓ | mpv · picker · episodes · playability |
| M4 Addons | ✓ | AIOStreams + AIOMetadata on Pi |
| M5 Voice + AI | ◐ | N5a + N5b + N5d compose/bootstrap shipped · N5c partial |
| M6 Ship | — | Library · YouTube · 4K HDR · wizard |

---

## Browse (M2)

| Feature | Detail |
|---------|--------|
| Tabs | Movies · Series · Live (L/R shoulders) |
| Grid | 9-up posters · ↻ shuffle (pad `317`) |
| Rails | YAML + AI catalog slots + Continue |
| Service | `catalog-service :3020` · `GET /rails` |
| Proxy | `serve.py` → `/api/catalog/*` |

**Gate:** `bash scripts/m2-catalog/browse/gate-m2-browse.sh`

---

## Play (M3)

| Feature | Detail |
|---------|--------|
| Orchestrator | Parallel resolve · play ladder · 90 s wall · probe-then-play |
| Stream picker | `GET /stream/{type}/{id}` · `display_label` rows |
| Continue | `progress.db` · mpv position watcher |
| Episodes | Season list · per-episode streams · next-up overlay |
| Playability | `playability.db` verified pools · grow jobs |
| Browse UX | Verified-only thin rails · empty hidden · dedup session |

### Playability ops (Pi)

| Job | UI label | Script |
|-----|----------|--------|
| Reshuffle | Refresh library | inline |
| ~10 min | Quick top-up | `quick-playability-topup.sh --detach` |
| ~45 min | Nightly pass | `playability-maintenance.sh --mode full` |
| ~4 h | Overnight grow | `overnight-playability-grow.sh --detach` |

Status: `python3 scripts/diag/playability-status.py`

**Gates:** `gate-m3-play-ladder.sh` · `gate-m3-detail.sh` · `gate-m3-episodes.sh` · `gate-m3-verified-rails.sh` (full sweep: `MANGO_GATE_FULL=1`)

---

## Self-hosted addons (M4)

| Service | Port | Role |
|---------|------|------|
| AIOStreams | `:3035` | Stream aggregate · dedup · debrid · formatter |
| AIOMetadata | `:3036` | mdblist + regional catalogs |
| catalog-service | `:3020` | Stremio graph · rails · play |

**Export contract:** Cinemeta + AIOStreams + AIOMetadata only (no standalone Torrentio · no ElfHosted in hot path).

**Gate:** `bash scripts/m4-addons/gate-m4-self-hosted.sh`

Operator setup: [reference/addon-stack.md](reference/addon-stack.md)

---

## Live TV (shipped · opt-in)

- NexoTV Docker `:7000` (paid) · `:7001` (free)
- `config/catalog-live.yaml` sport rails
- mpv `--live` · excluded from gate-lite

[LIVE_TV.md](LIVE_TV.md)

---

## Voice + AI (M5)

### N5a — voice librarian ✓

Phone PTT → Hinglish STT → LLM tools → **open detail on TV**. User presses **B** to play.

| Route | Purpose |
|-------|---------|
| `GET /voice/tools` | Tool manifest |
| `GET /voice/search?q=` | Verified library search |
| `GET /voice/library` | Browse verified list |
| `GET /voice/search/external?q=` | Cinemeta fallback |
| `POST /voice/library/notes` | Librarian taste notes |

Tools: `mango_search` · `mango_open_title` · `mango_navigate` · … — **no `mango_play`**.

**Gate:** `bash scripts/m5-voice/ai/gate-m5-voice.sh` (in gate-lite when `MANGO_VOICE=1`)

Full detail: [VOICE.md](VOICE.md)

### N5b — AI catalog slots ✓

- Max **3 slots per tab** (movies + series)
- Storage: `/etc/mango/ai-catalogs/slots/*.yaml`
- Voice CRUD + overflow (replace / pin / merge)
- Module: `src/catalog-service/src/ai-catalogs/`

**Gate:** `bash scripts/m5-voice/ai/gate-m5-ai-catalogs.sh`

### N5c — living librarian ◐

Companion memory · profile · conversation policy. In progress.

### N5d — AI catalog bootstrap ✓

Compose + reserve + bootstrap jobs shipped. Full voice E2E bootstrap: `MANGO_AI_CATALOG_BOOTSTRAP_E2E=1` on gate.

---

## Next priorities

| # | Item | Milestone |
|---|------|-----------|
| 1 | N5c living librarian | M5 |
| 2 | N5c completion (proactive HUD, polish) | M5 |
| 3 | Stremio library merge + write-back | M6.1 |
| 4 | YouTube yt-dlp rail | M6.2 |
| 5 | 4K HDR TV + soundbar profile | M6.3 |
| 6 | `install.sh` first-boot wizard | M6.4 |

---

## Gates {#gates}

| Gate | Role |
|------|------|
| **`gate-lite.sh`** | **Default deploy** — M1 + M4 (if self-hosted) + M2 + M3 detail/episodes + unit + M5 ai/bootstrap/reserve + lite play + M5 voice/policy/memory/gardener (if `MANGO_VOICE=1`) |
| `pi-pre-couch-gate.sh` | Mac `pi-exec-gate.sh` wrapper |
| `MANGO_GATE_FULL=1` | + per-rail verified play sweep |
| `gate-m4-self-hosted.sh` | Self-hosted addon corpus |
| `gate-live-iptv.sh` | **Opt-in** — `MANGO_LIVE_GATE=1` only |

```bash
bash scripts/pi-exec-gate.sh
bash scripts/pi-deploy.sh --fast --gate
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
```

### Test tiers (catalog-service)

| Tier | Command |
|------|---------|
| gate | `npm run test:gate` (82 unit tests in gate slice) |
| full | `npm run test` (~86 tests) |

---

## Config (canonical)

| Repo example | Pi path | Purpose |
|--------------|---------|---------|
| `config/stremio-export.example.json` | `/etc/mango/stremio-export.json` | Addon graph |
| `config/catalog-filters.example.json` | `/etc/mango/catalog-filters.json` | Play ladder · quality cap |
| `config/catalog.example.yaml` | `/etc/mango/catalog.yaml` | Browse rails |
| `config/catalog-live.example.yaml` | `/etc/mango/catalog-live.yaml` | Live sport rails |
| — | `/etc/mango/playability.db` | Verified pools |
| — | `/etc/mango/progress.db` | mpv resume |
| — | `/etc/mango/ai-catalogs/` | AI catalog slots |

Deploy sync: `scripts/lib/sync-etc-mango-config.sh` on `pi-deploy.sh`.

Gate-only (repo): `stream-gate-fixtures.json` · `catalog-gate-rails.json`

---

## Anti-patterns (forbidden)

| Do not | Why |
|--------|-----|
| Standalone Torrentio in export | Breaks AIOStreams dedup |
| ElfHosted in hot path | Rate limits — use local AIOStreams |
| `rsync` / `scp` repo to Pi | Git push + pull only |
| Shawshank-only stream gates | Misses India/Hindi/series paths |
| Voice `mango_play` | Pad **B** owns playback |

---

## Deploy loop

1. Diagnose on Pi (`pi-exec.sh`, logs)
2. Fix on Mac · `npm run test` when touching catalog-service
3. Commit + push (when asked)
4. `bash scripts/pi-deploy.sh --fast` or `--full --gate`
5. Couch test — [COUCH_TEST.md](COUCH_TEST.md)

[DEPLOY.md](DEPLOY.md)
