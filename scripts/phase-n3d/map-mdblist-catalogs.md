# N3d rail → AIOMetadata catalog mapping (v2.1)

Curation rationale: `config/catalog-rail-curation.md`  
Machine-readable index: `config/aiometadata-rail-catalogs.json`.

```bash
bash scripts/phase-n3d/aiometadata-config.sh check ~/.config/mango/aiometadata-import.json
bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```

## Movies

| Rail | Label | Sources |
|------|-------|---------|
| `movies-global-popular` | popular worldwide | Cinemeta `top` + mdblist **88302** (trending movies) |
| `movies-india-trending` | indian cinema | IndiaStreams **recmov** + **popmov** |
| `movies-classics` | highly rated | Cinemeta `imdbRating` only |
| `movies-comedy` | comedy & comfort | mdblist **91223** |
| `movies-quick-watches` | quick watches | mdblist **83668** + **88302** |
| `movies-documentaries` | true stories | mdblist **84677** (top documentaries) |

## Series

| Rail | Label | Sources |
|------|-------|---------|
| `series-global-popular` | popular worldwide | Cinemeta `top` + mdblist **88303** (trending shows) |
| `series-india-picks` | indian series | IndiaStreams **trendingtv** only |
| `series-classics` | critically acclaimed | Cinemeta `imdbRating` only |
| `series-comedy` | comedy | mdblist **91224** |
| `series-miniseries` | limited series | mdblist **130153** (popular miniseries) |
| `series-reality-casual` | reality & casual | mdblist **84401** |

## IndiaStreams custom catalog ids

| catalog.yaml id | IndiaStreams endpoint |
|-----------------|----------------------|
| `custom.in_rdata_indiastreams.movie.recmov` | `/catalog/movie/recmov.json` |
| `custom.in_rdata_indiastreams.movie.popmov` | `/catalog/movie/popmov.json` |
| `custom.in_rdata_indiastreams.series.trendingtv` | `/catalog/series/trendingtv.json` |

## Import from configure export

```bash
bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```

`import` uses **mango mode** (default): copies only catalogs listed in
`config/aiometadata-rail-catalogs.json`.
