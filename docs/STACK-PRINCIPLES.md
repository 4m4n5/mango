# mango stack principles

**Branch:** `feat/native-experience`  
**Purpose:** Single reference for layer boundaries, config sources, and gates — avoid duplicating policy in multiple places.

---

## Layer model

```
Launcher (:3000)  →  catalog-service (:3020)  →  addons (Stremio protocol)
                              ↓
                         mpv play orchestrator
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **AIOStreams** (`:3035`) | Aggregate Torrentio+TB+RD+EN, dedup, SEL, result limits, formatter | Lab 1080p cap, mpv probe, couch auto-play |
| **AIOLists** (`:3036`) | mdblist catalog adapters | Stream resolve |
| **catalog-service** | Rails YAML, play orchestrator, stream metadata parse, lab filters | Indexer search, debrid credentials |
| **Launcher** | Browse UI, detail, Play button | Stream ranking policy (trust upstream + filters) |

**Rule:** Push dedup, junk keywords, debrid order, and row limits **upstream** into AIOStreams. Keep probe-time policy, lab quality cap, and auto-play tiers in **catalog-service**.

---

## Config sources (canonical)

| File | Pi path | Purpose |
|------|---------|---------|
| `config/stremio-export.example.json` | `/etc/mango/stremio-export.json` | Addon graph — **Cinemeta + AIOStreams + AIOLists only** |
| `config/catalog-filters.example.json` | `/etc/mango/catalog-filters.json` | Play policy — AIOStreams-only tiers |
| `config/catalog.example.yaml` | `/etc/mango/catalog.yaml` | Browse rails (movies/series) |
| `config/catalog-live.example.yaml` | `/etc/mango/catalog-live.yaml` | Live sport rails (optional) |
| `config/stream-gate-fixtures.json` | repo only | Stream evaluation corpus (6 titles) |
| `config/catalog-gate-rails.json` | repo only | Required vs optional catalog rails |
| `config/aiostreams-target-patch.json` | via `aiostreams-config.sh apply` | Headless AIOStreams profile |

`mango-stack.sh` uses repo examples when `/etc` copies differ (no sudo required for dev).

---

## Stream API contract

`GET /stream/{type}/{id}` — series use episode ids: `series/tt12004706:1:1`.

| Query / body | Mode |
|--------------|------|
| `language` | **Hard** filter — exclude non-matching |
| `preferred_language` | **Soft** — rank boost only |
| `max_quality` / `min_quality` | Lab cap / floor |
| `include_uncached` | Allow uncached debrid (debug) |

Enriched fields (from `stream-formatter.ts`): `display_label`, `release_group`, `encode`, `size_gb`, `languages`, `debrid_service`, `cache_status`.

---


## Voice stack (N5a)

```
Phone companion (:3001) ──WSS──► orchestrator (:8765)
                                      ├─► catalog-service /voice/*
                                      └─► launcher POST /api/voice/command
Launcher voice-hud ◄── WS loopback :8766
```

| Layer | Owns |
|-------|------|
| companion | Mic · PCM · chat UI |
| orchestrator | STT · LLM tools · launcher dispatch |
| catalog-service | Search · library · notes · manifest |
| launcher | Poll commands · open detail · mpv stop on switch |

**Rule:** Voice opens detail only — playback stays on pad **B**. No `mango_play` in manifest.

## Gate matrix

| Gate | When | What |
|------|------|------|
| **`gate-lite.sh`** | **default deploy** | N0 + N3d (if enabled) + N2 browse + unit + 2 plays + **N5 voice** (if `MANGO_VOICE=1`) |
| `pi-pre-couch-gate.sh` | Mac `pi-exec-gate.sh` | Pull + gate-lite |
| `MANGO_GATE_FULL=1` | release handoff | + per-rail verified play + N3a browse picks |
| `gate-n3d-self-hosted.sh` | self-hosted | N3d stream + catalog corpus |
| `gate-live-iptv.sh` | **opt-in only** | `MANGO_LIVE_GATE=1` — NexoTV (never in gate-lite) |

```bash
bash scripts/pi-exec-gate.sh              # Mac: pull + gate-lite on Pi
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
MANGO_LIVE_GATE=1 bash scripts/phase-live/gate-live-iptv.sh   # manual live only
```

---

## Anti-patterns (removed or forbidden)

| Do not | Why |
|--------|-----|
| Standalone Torrentio in `stremio-export.json` | Triples indexer work; breaks dedup |
| `debrid_preference` / RD WEBRip logic in mango | Owned by AIOStreams SEL |
| ElfHosted in hot path | Rate limits; use local AIOStreams |
| Shawshank-only stream gates | Misses India/Hindi/series paths |
| Hard `preferred_language` | Use `language` for hard, `preferred_language` for soft |
| Title relax clears `hard_language` | Title fallback must keep user language intent |
| `rsync` / `scp` repo to Pi | Git push + `git pull` only — see [`DEPLOY.md`](DEPLOY.md) |

---


## Test tiers

| Tier | Command | When |
|------|---------|------|
| **gate** | `npm run test:gate` in catalog-service | gate-lite / pi-deploy `--gate` (~42 tests) |
| **full** | `npm run test` in catalog-service | release / playability changes (~86 tests) |
| **live** | `MANGO_LIVE_GATE=1 bash scripts/phase-live/gate-live-iptv.sh` | manual only — never deploy gate |

Shared ladder contract: `scripts/lib/verify-play-ladder-config.py`.

## Pi deploy

**Git only.** Diagnose on Pi → fix on Mac → commit + push → **`bash scripts/pi-deploy.sh --fast`** (iterate) or **`--full --gate`** (handoff) → gates on Pi.

Never rsync `~/mango`, `src/`, or `src/orchestrator/.venv`. Canonical: [`DEPLOY.md`](DEPLOY.md).

---

## Future hooks (no duplicate work)

| Feature | Ready when |
|---------|------------|
| N3e episode picker | `GET /series/:id/episodes` + per-episode play |
| N3b picker polish | focus order · cancel long resolve |
| Voice “play in Hindi” | `POST /play { language: "Hindi" }` |
| N7 OLED 4K | Drop `max_quality` / `exclude_remux` in catalog-filters only |
| AI stream context | Enriched stream objects from GET `/stream` |

| Live TV | [`LIVE_TV.md`](LIVE_TV.md) — NexoTV excluded from deploy gates |

See also: [`N3d-AIOSTREAMS-PROFILE.md`](N3d-AIOSTREAMS-PROFILE.md), [`N3d-INVENTORY.md`](N3d-INVENTORY.md).
