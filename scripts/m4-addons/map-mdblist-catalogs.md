# Rail → AIOMetadata catalog mapping

Curation: `config/catalog-rail-curation.md` · Index: `config/aiometadata-rail-catalogs.json`

## Movies

| Rail | Label | Sources |
|------|-------|---------|
| `movies-global-popular` | popular worldwide | Cinemeta anchor + mainstream MDBList/platform pools |
| `movies-india-trending` | indian cinema | Bharat Binge regional movie catalogs + India-native MDBList/IndiaStreams probation |
| `movies-classics` | highly rated | Cinemeta `imdbRating` + Criterion/Oscar/A24/Cannes depth |
| `movies-comedy` | comedy & comfort | Comedy and stand-up MDBList pools |
| `movies-quick-watches` | quick & easy | Short/easy/stand-up/streaming movie pools |
| `movies-documentaries` | true stories | Documentary and true-crime pools with weak sources on probation |

## Series

| Rail | Label | Sources |
|------|-------|---------|
| `series-global-popular` | popular worldwide | Cinemeta anchor + mainstream/trending MDBList depth |
| `series-classics` | critically acclaimed | Cinemeta `imdbRating` + prestige/BBC/HBO/docuseries depth |
| `series-india-picks` | indian series | Measured-yield Indian web-series lists + India OTT/provider pools on probation |
| `series-miniseries` | limited series | Multiple limited-series curator pools |
| `series-reality-casual` | reality TV | Reality/game-show pools; weak catalogs on probation |
| `series-comedy` | comedy | Comedy/sitcom MDBList pools plus theme-safe Indian stand-up overlap |

Exact ids and weights live in `config/catalog.example.yaml`; curation rationale lives in `config/catalog-rail-curation.md`.

## Import

```bash
bash scripts/m4-addons/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```
