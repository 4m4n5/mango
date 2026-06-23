# N3d rail → AIOMetadata catalog mapping (v2.2)

Curation: `config/catalog-rail-curation.md` · Index: `config/aiometadata-rail-catalogs.json`

## Movies

| Rail | Label | Sources |
|------|-------|---------|
| `movies-global-popular` | popular worldwide | Cinemeta `top` + mdblist **88302** |
| `movies-india-trending` | indian cinema | Bharat Binge **recent** + **surprise** + **top_rated** (85%) · IndiaStreams recmov/popmov (15%) |
| `movies-classics` | highly rated | Cinemeta `imdbRating` |
| `movies-comedy` | comedy & comfort | mdblist **91223** |
| `movies-quick-watches` | quick & easy | mdblist **86934** + **84444** + **3885** |
| `movies-documentaries` | true stories | mdblist **84677** |

## Series

| Rail | Label | Sources |
|------|-------|---------|
| `series-global-popular` | popular worldwide | Cinemeta `top` + mdblist **105797** (daily picks) |
| `series-classics` | critically acclaimed | Cinemeta `imdbRating` |
| `series-india-picks` | indian series | Bharat Binge **recent** + **latest_episodes** + **top_rated** (85%) · IndiaStreams trendingtv · Cinemeta `top` |
| `series-miniseries` | limited series | mdblist **130153** |
| `series-reality-casual` | reality TV | mdblist **63182** + Cinemeta `top` anchor |
| `series-comedy` | comedy | Cinemeta `top` + mdblist **91224** |

## Import

```bash
bash scripts/m4-addons/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```
