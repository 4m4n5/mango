# N3d rail → AIOMetadata catalog mapping (v2)

Catalog ids must exist in the configure export and AIOMetadata manifest.
Machine-readable index: `config/aiometadata-rail-catalogs.json`.

```bash
bash scripts/phase-n3d/aiometadata-config.sh check ~/.config/mango/aiometadata-import.json
bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```

## Movies

| Rail | Label | Sources |
|------|-------|---------|
| `movies-global-popular` | popular worldwide | Cinemeta `top` + mdblist **88306** (Latest Movies) |
| `movies-india-trending` | trending in india | IndiaStreams **trendingmovies** + **popmov** |
| `movies-classics` | highly rated | Cinemeta `imdbRating` only |
| `movies-comedy` | comedy & comfort | mdblist **91223** |
| `movies-quick-watches` | quick watches | mdblist **86934** (digital release) + **83668** |
| `movies-documentaries` | true stories | mdblist **128051** |

## Series

| Rail | Label | Sources |
|------|-------|---------|
| `series-global-popular` | popular worldwide | Cinemeta `top` + mdblist **105797** (Daily Picks) |
| `series-india-picks` | india & regional | IndiaStreams **trendingtv** + **atpmub** |
| `series-classics` | critically acclaimed | Cinemeta `imdbRating` only |
| `series-comedy` | comedy | mdblist **91224** |
| `series-miniseries` | limited series | mdblist **130153** + **130152** |
| `series-reality-casual` | reality & casual | mdblist **84401** |

## IndiaStreams custom catalog ids

| catalog.yaml id | IndiaStreams endpoint |
|-----------------|----------------------|
| `custom.in_rdata_indiastreams.movie.trendingmovies` | `/catalog/movie/trendingmovies.json` |
| `custom.in_rdata_indiastreams.movie.popmov` | `/catalog/movie/popmov.json` |
| `custom.in_rdata_indiastreams.series.trendingtv` | `/catalog/series/trendingtv.json` |
| `custom.in_rdata_indiastreams.series.atpmub` | `/catalog/series/atpmub.json` |

Also in export (not wired to rails v2): `recmov` (Recommended Indian Movies).

## Import from configure export

```bash
bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```

`import` uses **mango mode** (default): copies only catalogs listed in
`config/aiometadata-rail-catalogs.json`.

## Migration from AIOLists

Retired — use AIOMetadata per `configure-aiometadata.md`.
