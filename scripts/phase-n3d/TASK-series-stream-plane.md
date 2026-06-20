# Phase N3d — Series stream plane

**Status:** WP1 catalog swaps **shipped** (`feat/native-experience` post–source-hitrate) — WP2–WP5 for parallel agent  
**Branch:** `feat/native-experience`  
**Prerequisite:** Movies tab validated (100% sampled play hit-rate on Pi `76fc853+`)  
**Blocks:** pre-couch `gate-n3d-self-hosted.sh` (stream + language gates), couch TV tab confidence, N3a play orchestrator on series picks

### WP1 shipped (this agent — catalog curation v2.2)

| Change | File(s) |
|--------|---------|
| `series-global-popular`: Cinemeta 0.8 + `mdblist.105797` (dropped 88303) | `catalog.example.yaml` |
| `series-comedy`: composite Cinemeta + 91224; **last in yaml** (session priority) | same |
| `series-india-picks`: trendingtv 0.7 + Cinemeta top 0.3 | same |
| `series-reality-casual`: Cinemeta + 105797; dropped 84401; `min_display: 12` | same |
| `movies-quick-watches`: 88302 + 83666 (dropped 83668) | same |
| AIOMetadata import index updated | `aiometadata-rail-catalogs.json` |
| Cinemeta probe + export discovery mode | `scripts/diag/source-hitrate.py` |

**Pi after WP1:** `aiometadata-config.sh import` → `MANGO_FILL_PURGE_POOLS=1 fill-playability-db.sh` → `source-hitrate.py` → gates.

---

## Problem statement

Discover rails and playability **probe** can pass while **live stream resolve** fails for series. The TV tab is not couch-trustworthy until `GET /stream/series/…` reliably returns playable rows for curated picks.

### Pi evidence (2026-06-19, post-fill)

| Layer | Movies | Series |
|-------|--------|--------|
| Rail hit-rate (2 samples/rail, play) | **12/12 (100%)** | **3/10 (30%)** |
| Source hit-rate (`source-hitrate/latest.json`) | recmov/popmov **100%** | trendingtv **20%**, 88303 **40%**, 91224 **40%**, 84401 **0%** |
| `gate-n3d-catalogs.sh` | PASS | PASS (display items exist) |
| `gate-n3d-streams.sh` | Shawshank PASS | Panchayat, IGL **FAIL**; SpongeBob PASS |
| `gate-n3d-stream-language.sh` | Shawshank PASS | RRR default **FAIL** |

**Anomaly:** `series-comedy` — verified pool **8**, tab display **0** (session dedup starvation).

---

## Goals (acceptance)

1. **Series source stream resolve ≥80%** for every catalog still wired to a series rail (`MANGO_SOURCE_HITRATE_PER_SOURCE=8`, exit 0).
2. **Series rail hit-rate ≥60%** sampled stream+play (`MANGO_RAIL_HITRATE_PER_RAIL=2`, series rails only).
3. **`bash scripts/phase-n3d/gate-n3d-streams.sh`** — all **required** fixtures pass; Indian fixtures may be **soft** (warn) if documented.
4. **`bash scripts/pi-pre-couch-gate.sh`** — PASS (N0 + N3d aggregate).
5. **Couch acceptance (TV tab):** 6 rails show posters; no duplicate titles across tab; B on 2 picks per rail starts mpv within 15s (manual or `MANGO_N3D_PLAY_SMOKE=1`).

### Non-goals

- N3a play-orchestrator implementation (separate task).
- Launcher UI / stream picker (N3b).
- Committing secrets (`keys/`, debrid API keys).
- rsync deploy — **git pull only** on Pi.

---

## Architecture (layer boundaries)

```
IndiaStreams / mdblist / Cinemeta  →  AIOMetadata (:3036)  →  catalog-service (:3020)
                                                                    ↓
                                                          AIOStreams (:3035) → debrid
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **Addons** | Catalog curation (which titles appear) | Cross-rail dedup, playability |
| **AIOStreams** | Stream resolve, debrid cache, season/episode matching | Rail labels, launcher focus |
| **catalog-service** | `/stream` filters (`catalog-filters.example.json`), playability probe | mdblist list selection |
| **Gates** | Regression corpus + tiers | Product UX pixels |

**Principle:** Fix series playability by **curating sources toward debrid-cache-friendly catalogs** and **aligning gates with realistic corpus** — not by weakening mango stream filters globally.

---

## Work packages

### WP1 — Source discovery & rail swaps ✅ shipped (v2.2 yaml)

Parallel agent: **skip yaml/list swaps** unless re-probe fails — pick up at **WP2**.

Use existing tooling before further list changes:

```bash
# Pi — probe every enabled catalog in stremio-export (added 76fc853)
MANGO_SOURCE_PROBE_EXPORT=1 MANGO_SOURCE_HITRATE_PER_SOURCE=8 \
  python3 scripts/diag/source-hitrate.py

# Rail-only sources (default)
MANGO_SOURCE_HITRATE_PER_SOURCE=8 python3 scripts/diag/source-hitrate.py
```

**Active low performers (swap or demote):**

| Source | Rate | Rail | Action |
|--------|------|------|--------|
| `mdblist.84401` | 0% | `series-reality-casual` | Replace with export candidate ≥80% **or** Cinemeta-weighted composite |
| `custom…trendingtv` | 20% | `series-india-picks` | Blend higher-hit regional source from export probe; document trade-off |
| `mdblist.88303` | 40% | `series-global-popular` | Raise Cinemeta `top` weight to **0.85+**; demote or drop 88303 |
| `mdblist.91224` | 40% | `series-comedy` | Swap to higher-hit mdblist from export probe **or** composite with Cinemeta `top` |

**Files to update when swapping:**

- `config/catalog.example.yaml`
- `config/aiometadata-rail-catalogs.json`
- `config/catalog-rail-curation.md`
- `scripts/phase-n3d/map-mdblist-catalogs.md`
- Re-import: `bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json`

**Keep:** `series-miniseries` (`130153` @ 80%), Cinemeta-anchored `series-classics`.

---

### WP2 — AIOStreams series tuning (secondary)

Read: `config/aiostreams-target-patch.json`, `scripts/phase-n3d/configure-aiostreams.md`.

Verify on Pi (`aiostreams-config.sh diff`):

| Setting | Series note |
|---------|-------------|
| `seasonEpisodeMatching.enabled` | Required for `tt…:1:1` requests |
| `excludeSeasonPacks` | OK for episode requests |
| Easynews fallback group | `count(cached) < 3` — confirm exists |
| RD excluded stream expressions | Review if blocking valid series WEB-DL |

Apply patch only if diff shows drift. **No API keys in git.**

---

### WP3 — Stream gate corpus tiers

Add `tier` field to `config/stream-gate-fixtures.json`: `required` | `soft` | `optional`.

Update `gate-n3d-streams.sh` and `gate-n3d-stream-language.sh` to hard-fail only **required** fixtures.

Replace fixtures that will never resolve (e.g. IGL) with titles proven in `source-hitrate`.

---

### WP4 — `series-comedy` display starvation

Pool verified=8, tab display=0 — likely `tabOccupied` starvation from reverse session allocation.

Fix minimally: yaml order tweak **or** reserved minimum slots for optional rails in `allocateTabRailSessions`. Add test. Do not regress movies quick-watches.

---

### WP5 — Re-fill & verify (Pi)

```bash
MANGO_FILL_PURGE_POOLS=1 bash scripts/phase-n3c/fill-playability-db.sh
MANGO_SOURCE_HITRATE_PER_SOURCE=8 python3 scripts/diag/source-hitrate.py
MANGO_RAIL_HITRATE_PER_RAIL=2 python3 scripts/diag/rail-hitrate.py
bash scripts/phase-n3d/gate-n3d-streams.sh
bash scripts/pi-pre-couch-gate.sh
```

Mac: `bash scripts/pi-deploy.sh && bash scripts/pi-exec-gate.sh`

---

## Couch acceptance — TV Shows tab

| # | Test | Pass |
|---|------|------|
| 1 | TV tab loads 6 rails, no blank rows | |
| 2 | No duplicate `type:id` across rails in one session | |
| 3 | `series-comedy` shows ≥3 posters | |
| 4 | Pick from `series-global-popular` → mpv plays ≤15s | |
| 5 | Y back / ⌂ home work from launcher | |

---

## References

- `config/catalog-rail-curation.md`
- `scripts/diag/source-hitrate.py` — `MANGO_SOURCE_PROBE_EXPORT=1`
- `AGENTS.md` — git-only Pi deploy
