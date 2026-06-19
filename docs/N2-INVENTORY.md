# N2 inventory — browse UI

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n2/gate-n2-browse.sh`  
**Spec:** [`tasks/phase-n2-browse-ui.md`](tasks/phase-n2-browse-ui.md)

---

## Plan

**Locked scope:** 5 rails · 2 addon sources · `addon_catalog` only.

| Rail ID | Addon | Catalog |
|---------|-------|---------|
| `trending-india` | AIOMetadata \| ElfHosted | `custom.in_rdata_indiastreams.movie.trendingmovies` |
| `popular-india` | AIOMetadata \| ElfHosted | `mdblist.88302` (was `popmov`; upstream returned empty) |
| `recommended-india` | AIOMetadata \| ElfHosted | `custom.in_rdata_indiastreams.movie.recmov` |
| `popular-global` | Cinemeta | `top` |
| `featured-global` | Cinemeta | `imdbRating` |

**Post-N2:** auto-import ~31 AIOMetadata catalogs · explicit enable/order UI · `tmdb_list`.

**Implementation plan (written before feature code):**

1. Keep `config/catalog.example.yaml` as the source template and have
   `catalog-service` load `/etc/mango/catalog.yaml` (or
   `MANGO_CATALOG_YAML`) at boot. Only enabled `addon_catalog` rails count for
   N2; the disabled Continue rail stays documented for N4.
2. Add a small rails module to parse and validate the YAML contract, then extend
   the existing N1 core with `catalog/{type}/{catalog}.json` fetches. Each item
   resolves through the existing meta path so posters/synopsis come from the real
   addon graph, with partial failures skipped per rail instead of crashing home.
3. Add `GET /rails` and `GET /rails/:id/items` to `catalog-service`. `/rails`
   returns configured rail metadata; `/items` returns `{ rail_id, items,
   resolve_ms }` with default `limit: 20`. Unknown rail is 404; missing YAML is
   503.
4. Add a stdlib `serve.py` proxy from `/api/catalog/*` to `127.0.0.1:3020` so
   Chromium never fetches `:3020` directly. Use a longer timeout for item
   routes because addon catalogs can be slow.
5. Replace the launcher empty catalog state with lazy-loaded poster rails:
   fetch `/api/catalog/rails`, then each rail's items, render horizontal poster
   rows above Apps, and preserve the existing 2D focus grid. Posters use native
   lazy loading and fixed aspect ratios for Pi Chromium stability.
6. Add a minimal detail layer: B on poster opens detail, fetches
   `/api/catalog/meta/:type/:id` for synopsis, B/Enter on `play` posts to
   `/api/catalog/play`, and Y/Escape returns home with focus restored.
7. Add `scripts/phase-n2/check-n2-prereqs.sh` and
   `scripts/phase-n2/gate-n2-browse.sh` for YAML, service, proxy, poster-count,
   launcher build, N1, and N0 regression checks. Do not change gamepad evdev
   codes or stream filters.
8. Deploy by git only: local build/checks, commit + push, Pi `git pull`,
   `npm ci && npm run build` in catalog-service and launcher, stack restart with
   `MANGO_CATALOG=1`, then run N2/N1/N0 gates.

**Risks / choices:**

- Addon catalog latency: resolve items in parallel, report `resolve_ms`, and let
  the launcher show per-rail empty/error states.
- Poster load on Pi Chromium: fixed poster cells, lazy images, no browser video,
  no animation loop.
- Real addon names: match exact names first, with whitespace-normalized fallback
  for the `AIOMetadata | ElfHosted` spacing variants seen in docs/prompts.
- Deferred post-N2: all ~31 AIOMetadata catalogs, `tmdb_list`, catalog
  management UI, stream picker, progress DB, YouTube, 4K tuning.

---

## Rails configured

| Rail ID | Type | Label | Items (gate) | resolve_ms |
|---------|------|-------|--------------|------------|
| `trending-india` | `addon_catalog` | trending in india | 20 | 1652 |
| `popular-india` | `addon_catalog` | trending movies | 20 | — |
| `recommended-india` | `addon_catalog` | recommended indian movies | 20 | 1484 |
| `popular-global` | `addon_catalog` | popular | 20 | 112 |
| `featured-global` | `addon_catalog` | featured | 20 | 57 |

**TMDB list ID (if used):** not used in N2; `addon_catalog` only.

**Source note:** `custom.in_rdata_indiastreams.movie.popmov` exists in the AIOMetadata manifest but returned `metas: []` at gate time. Audit swapped `popular-india` to `mdblist.88302` (Trending Movies) so all five rails show posters.

---

## Prereq status (Pi)

| Check | Status | Notes |
|-------|--------|-------|
| `gate-n1-smoke.sh` | PASS | embedded in final `gate-n2-browse.sh` at `6f122c4` |
| `/etc/mango/catalog.yaml` | PASS | matches `config/catalog.example.yaml` |
| `/etc/mango/tmdb.key` | N/A | not required for N2 `addon_catalog` rails |
| Launcher dist built | PASS | Pi build at `6f122c4`; catalog-service starts before Chromium |

---

## Metrics (after N2)

| Metric | Value |
|--------|-------|
| `gate-n2-browse.sh` | PASS at `6f122c4`, 2026-06-18T16:57:45-07:00 |
| Trending items | 20 (`trending-india`) |
| Bollywood items | 20 `popular-india` (mdblist.88302); 20 `recommended-india` |
| Detail → play TTFF ms | 4619 ms via `POST /play` regression |
| ⌂ home ms | N1 regression passed; N1 baseline measured 232 ms |
| Final screenshot | `/home/aman/.cache/mango/gate-screenshots/n2-browse-layout-final-20260618T235714Z.png` |

---

## Waivers

_None — all strict rails pass after catalog swap._

---

## N2-C1 couch note (manual)

**Lab:** 1080p monitor · headphones via monitor 3.5 mm.

- [x] Home shows ≥2 rails with real posters
- [ ] B on title → detail
- [ ] B Play → mpv (picture + audio)
- [x] ⌂ → home regression covered by N1/N0 gate
- [x] Voice HUD regression

---

## Handoff to N3

N2 shipped the first real browse surface:

- Launcher loads `/api/catalog/rails`, renders poster rails, opens title detail,
  and plays via `/api/catalog/play` → mpv.
- `serve.py` proxies `/api/catalog/*` to `catalog-service :3020`; Chromium never
  fetches `:3020` directly.
- `catalog-service` loads `/etc/mango/catalog.yaml`, resolves five locked
  `addon_catalog` rails, prefers Cinemeta meta, and caches meta in-process.
- `scripts/phase-n2/gate-n2-browse.sh` is the N2 gate and includes N1/N0
  regression.
- Ready for N3 stream picker: insert the picker between detail Play and
  existing `/stream`/`/play` resolution, preserving the filters object.
