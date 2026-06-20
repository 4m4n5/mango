# Rail catalog curation (v2.1)

Playability-first catalog picks for mango discover rails. Each rail targets **20 verified playable titles**
(`display_limit` / `min_display` / `pool_target` = 20).

## Hit-rate principles

1. **Cinemeta charts** (`top`, `imdbRating`) — highest debrid cache rate; anchor global/classics rails.
2. **mdblist trending** (`88302` movies, `88303` series) — mainstream titles with strong cache vs “latest/digital” lists.
3. **IndiaStreams regional** (`recmov`, `popmov`, `atpmub`) — Indian content; `atpmub` only for series (no chart bleed).
4. **Niche mdblist** — higher `ingest_multiplier` (probe more candidates); swap list when probe pass rate is near zero.
5. **Session dedup** — niche rails are later in yaml but allocate **first** (reverse tab session order).

## Rail → source map

| Rail | Sources | Curation rationale |
|------|---------|-------------------|
| `movies-global-popular` | Cinemeta `top` + mdblist **88302** trending movies | Trending over “latest” for debrid hit rate |
| `movies-india-trending` | IndiaStreams **recmov** + **popmov** | Regional recommendations, not OTT charts |
| `movies-classics` | Cinemeta `imdbRating` | Canonical highly-rated pool |
| `movies-comedy` | mdblist **91223** | Stable comedy mdblist; high prior hit rate |
| `movies-quick-watches` | mdblist **83668** modern + **88302** trending | Dropped digital-release list (low cache on new titles) |
| `movies-documentaries` | mdblist **84677** top documentaries | Replaced **128051** (0% probe pass in bootstrap) |
| `series-global-popular` | Cinemeta `top` + mdblist **88303** trending shows | Trending over daily-picks for cache |
| `series-india-picks` | IndiaStreams **atpmub** only | Pure Indian series recommendations |
| `series-classics` | Cinemeta `imdbRating` | Same as movies-classics |
| `series-comedy` | mdblist **91224** | Stable comedy shows list |
| `series-miniseries` | mdblist **130153** popular miniseries | Single list (popular > latest for playability) |
| `series-reality-casual` | mdblist **84401** top reality | Prior bootstrap filled successfully |

## Fill workflow (Pi)

```bash
bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
MANGO_FILL_PURGE_POOLS=1 bash scripts/phase-n3c/fill-playability-db.sh
MANGO_RAIL_HITRATE_PER_RAIL=2 bash scripts/diag/rail-hitrate.py
```

`fill-playability-db.sh` runs bootstrap (min_display) then pool top-up (pool_target) when `MANGO_FILL_POOL_TOPUP=1` (default).
