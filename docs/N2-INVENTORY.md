# N2 inventory — browse UI + thematic rails (N2b)

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n2/gate-n2-browse.sh`  
**Config:** `config/catalog.example.yaml` (version 2)

---

## Shipped

| Item | Notes |
|------|-------|
| Launcher poster rails + detail → play | N2 |
| Movies · TV Shows tabs | N2b |
| 12 discover rails (6×2) | `composite_list` + `addon_catalog` |
| `GET /rails?tab=movies\|series` | catalog-service |
| Verified-only serve | N3c — see [N3c-INVENTORY.md](N3c-INVENTORY.md) |

---

## Rails (`config/catalog.example.yaml`)

### Movies

| Rail ID | Type | Sources |
|---------|------|---------|
| `movies-global-popular` | composite | Cinemeta `top` 60% + `year` 40% |
| `movies-india-trending` | composite | India `trendingmovies` + `recmov` + `mdblist.88302` |
| `movies-classics` | composite | Cinemeta `imdbRating` + `mdblist.83666` |
| `movies-comedy` | addon | `mdblist.91223` |
| `movies-quick-watches` | composite | `mdblist.83668` + Cinemeta `year` |
| `movies-documentaries` | addon | `mdblist.128051` |

### TV Shows

| Rail ID | Type | Sources |
|---------|------|---------|
| `series-global-popular` | composite | Cinemeta `series/top` + `series/year` |
| `series-india-picks` | composite | `series.atpmub` + `mdblist.88303` |
| `series-classics` | composite | Cinemeta `series/imdbRating` + `mdblist.88303` |
| `series-comedy` | composite | `mdblist.91224` + `mdblist.84401` |
| `series-miniseries` | composite | `mdblist.130153` + `mdblist.130152` |
| `series-documentaries` | addon | `mdblist.128052` |

`composite_list` merges weighted sources, dedupes by `type:id`, feeds N3c once per title.

---

## Ops

```bash
# Pi uses repo yaml when /etc/mango/catalog.yaml differs
MANGO_CATALOG=1 bash scripts/mango-refresh.sh

# Validate composite ingest (no second stremio-core boot)
bash scripts/phase-n2b/validate-composite-rails.sh

# Fill verified pools (dedicated window)
bash scripts/phase-n3c/playability-maintenance.sh --mode full
```

---

## Deferred

Continue rail (N4) · AI rails (N5) · catalog management UI · `tmdb_list`
