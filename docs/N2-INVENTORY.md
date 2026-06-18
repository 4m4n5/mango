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
| `popular-india` | AIOMetadata \| ElfHosted | `custom.in_rdata_indiastreams.movie.popmov` |
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
| | | | | |

**TMDB list ID (if used):** …

---

## Prereq status (Pi)

| Check | Status | Notes |
|-------|--------|-------|
| `gate-n1-smoke.sh` | | |
| `/etc/mango/catalog.yaml` | | |
| `/etc/mango/tmdb.key` | | |
| Launcher dist built | | |

---

## Metrics (after N2)

| Metric | Value |
|--------|-------|
| `gate-n2-browse.sh` | |
| Trending items | |
| Bollywood items | |
| Detail → play TTFF ms | |
| ⌂ home ms | |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N2-C1 couch note (manual)

**Lab:** 1080p monitor · headphones via monitor 3.5 mm.

- [ ] Home shows ≥2 rails with real posters
- [ ] B on title → detail
- [ ] B Play → mpv (picture + audio)
- [ ] ⌂ → home < 300 ms
- [ ] Voice HUD regression

---

## Handoff to N3

*(Fill when N2 ships.)*
