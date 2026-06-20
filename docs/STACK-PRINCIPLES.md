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
| `config/catalog.example.yaml` | `/etc/mango/catalog.yaml` | Browse rails |
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

## Gate matrix

| Gate | When | What |
|------|------|------|
| `gate-n0.sh` | always | Foundation |
| `gate-n3d-streams.sh` | self-hosted | 6-title stream corpus |
| `gate-n3d-stream-language.sh` | self-hosted | Language soft/hard policy |
| `gate-n3d-catalogs.sh` | self-hosted | Required rails + optional warns |
| `gate-n3d-self-hosted.sh` | pre-couch | Orchestrates N3d gates |
| `gate-n3a-play.sh` | pre-couch / manual | Two browse picks play <=15s + N2/N0 |
| `gate-n3c-verified-rails.sh` | manual / CI | Browse pick play ≤15s |
| `pi-pre-couch-gate.sh` | Mac `pi-exec-gate.sh` | Pull + N0 + N3d when `MANGO_SELF_HOSTED_ADDONS=1` |

```bash
# Mac
bash scripts/pi-exec-gate.sh

# Pi full N3d
bash scripts/phase-n3d/gate-n3d-self-hosted.sh
bash scripts/phase-n3d/gate-n3d-stream-language.sh
cd src/catalog-service && npm run test
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

## Pi deploy

**Git only.** Diagnose on Pi → fix on Mac → commit + push → **`bash scripts/pi-deploy.sh --fast`** (iterate) or **`--full --gate`** (handoff) → gates on Pi.

Never rsync `~/mango`, `src/`, or `src/orchestrator/.venv`. Canonical: [`DEPLOY.md`](DEPLOY.md).

---

## Future hooks (no duplicate work)

| Feature | Ready when |
|---------|------------|
| N3b stream picker | `display_label` + `POST /play { url }` |
| Voice “play in Hindi” | `POST /play { language: "Hindi" }` |
| N7 OLED 4K | Drop `max_quality` / `exclude_remux` in catalog-filters only |
| AI stream context | Enriched stream objects from GET `/stream` |

See also: [`N3d-AIOSTREAMS-PROFILE.md`](N3d-AIOSTREAMS-PROFILE.md), [`N3d-INVENTORY.md`](N3d-INVENTORY.md).
