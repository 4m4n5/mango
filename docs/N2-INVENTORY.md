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

*(Agent extends §Plan with implementation notes before coding.)*

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
