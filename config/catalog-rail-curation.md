# Rail catalog curation (v2.4)

Playability-first picks. **Accumulative pools:** each refresh grows verified depth by `pool_growth_per_refresh` (default 10) up to `pool_max` (120); only confirmed-dead titles are pruned from `rail_pool`.

After each fill: `source-hitrate.py` → tune → re-import → `fill-playability-db.sh` (never use `MANGO_FILL_PURGE_POOLS=1` unless resetting).

## Hit-rate principles

1. **Cinemeta charts** (`top`, `imdbRating`) — highest debrid cache; use as anchor on weak series rails.
2. **mdblist daily/trending** (`88302`, `88303`, `88306`) — mainstream cache over one-off novelty lists.
3. **IndiaStreams** (`recmov`, `popmov`, **`trendingtv`**) — legacy regional blend; **demoted** on india rails in favor of **Bharat Binge** (better posters + hit-rate). Keep small weight for dedup diversity.
4. **Bharat Binge** (`tmdb-hi-*`, `tmdb-ta-*`, `tmdb-te-*`, `tmdb-ml-*`, `tmdb-kn-*`) — Hindi plus regional-language TMDB charts; catalog+meta only (streams via AIOStreams). Manifest: `config/bharat-binge-manifest.url`.
5. **Session dedup** — niche/optional rails **last** in yaml (allocate tab session slots first).
6. **Optional rails** — `min_display: 12` so fill does not block on hard-to-probe catalogs.

## Rail -> source map (v2.4)

| Rail | Sources | Rationale |
|------|---------|-----------|
| `movies-global-popular` | Cinemeta `top` + **88302** + **88306** + **87667** + **2202** + platform movie lists + Cinemeta `year` | Mainstream cache with latest-movies and Blu-ray/platform freshness; avoid over-weighting one chart |
| `movies-india-trending` | **Bharat Binge** Hindi/Tamil/Telugu/Malayalam/Kannada recent/top/surprise + **170279** + **180437** + **183641** + **157957** + **44081** + IndiaStreams recmov/popmov + **49761** probation | India-native movie pools only; no generic global charts because they produce too many off-theme candidates for a strict regional rail |
| `movies-classics` | Cinemeta `imdbRating` + **83666** + **101881** + **88006** + **143797** + **97710** + **99248** | Anchor plus Criterion/Oscar/A24/Cannes depth so classics can grow without repeating the same Top 250 set |
| `movies-comedy` | Cinemeta `top` + **91223** + **128040** + **2195** + **3107** + **69712** + **86734** | Popular comedy plus stand-up lists for fresh verified candidates |
| `movies-quick-watches` | **86934** + **84444** + **69712** + **3885** + **86734** + Cinemeta `year` + **45854** | Streaming movies, stand-up, RT-short/easy picks, and shorts; no classics-heavy overlap |
| `movies-documentaries` | **128051** + **84677** + **78210** + **2885** + **178241** + **100477** + **34451** + **81741** + demoted **72165** | Broad doc supply plus true-crime depth; 72165 is retained at very low weight after a 0/3 Pi stream probe |
| `series-global-popular` | Cinemeta `top` + **88303** + **2194** + **88434** + **101882** + demoted **105797** | 88303 probed 3/3 on Pi; 105797 stays as low-weight recovery after 0/3 |
| `series-india-picks` | Active Bharat Binge Hindi latest/recent/top + Tamil/Telugu recent + **165054** + **166155** + IndiaStreams trendingtv + selected Indian MDBList pools; remaining India OTT/list sources rotate through probation | Regional OTT series first; broad low-yield Indian web-series lists stay probation until grow outcomes prove verified thematic yield |
| `series-classics` | Cinemeta `imdbRating` + **101882** + **3086** + **50087** + **3087** + docuseries depth **128052**/**84403** + demoted **143745** | Anchor plus HBO/BBC/provider/docuseries prestige/cache; limited-series overlap stays low because it is now exhausted on nightly grow |
| `series-comedy` | Cinemeta `top` + **91224** + **83918** + **3122** + **142679** + **155168** + **49761** | Sitcom and comedy lists expand theme-safe supply beyond generic top shows |
| `series-miniseries` | **143745** + **50083** + **169800** + **130152** + **147478** + **130153** | Limited-series lists from multiple curators; keep 130153 active but not sole supply |
| `series-reality-casual` | **84401** + promoted deep pool **147884** + **143024** + **122526** + demoted **63182** + **125320** + **125155** + tiny Cinemeta `top` | 84401 probed 3/3 on Pi and remains primary; 147884 gives depth; generic Cinemeta is only a recovery trickle |

## Measurement

```bash
python3 scripts/diag/source-hitrate.py
MANGO_SOURCE_PROBE_EXPORT=1 MANGO_AIOMETADATA_EXPORT=~/.config/mango/aiometadata-import.json \
  python3 scripts/diag/source-hitrate.py
python3 scripts/diag/source-grow-audit.py --rail series-india-picks
```

Goal: ≥80% stream resolve per active source (`MANGO_SOURCE_TARGET_RATE=0.80`).
Use `source-grow-audit.py` after strict grow runs to inspect rail-specific
verified/min, theme rejects, no-stream rejection rate, duplicate pressure,
cursor depth, and probation recovery before promoting or removing a source.

## MDBList inventory + LLM rail composition

Tagged catalog index: `config/mdblist-inventory.json` (synced from [mdblist toplists](https://mdblist.com/toplists/)).

```bash
# Pull popular lists (50 cards) into inventory
bash scripts/m4-addons/mdblist-catalog-pipeline.sh sync

# Export compact context for LLM rail design
bash scripts/m4-addons/mdblist-catalog-pipeline.sh export-llm

# LLM outputs JSON matching config/rail-compose.schema.json → review + apply
python3 scripts/m4-addons/rail-compose.py plan config/rail-proposals/my-rail.json
python3 scripts/m4-addons/rail-compose.py apply config/rail-proposals/my-rail.json --write

# Verify AIOMetadata export covers new mdblist.* ids before Pi import
bash scripts/m4-addons/mdblist-catalog-pipeline.sh check-import
```

Resolve ad-hoc list URLs: `python3 scripts/diag/mdblist-inventory.py resolve user/list-slug`


## Thematic enforcement (grow + retheme)

**Ongoing:** `rail-theme-gate` scores title metadata on every `rail_pool` upsert during grow, global link, and verify. Profiles: `config/rail-theme-profiles.yaml`.

**One-off:** `bash scripts/m3-play/playability/rail-pool-retheme.sh` — prune mismatches and relocate to best-fit or anchor rails.

India rails use **strict** profiles (`min_fit: 14`) — Indian titles only, not western hits popular in India.

Full detail: [docs/PLAYABILITY.md](../docs/PLAYABILITY.md)

## Manual rail curation (pins / blocks)

Override automatic catalog picks for couch-critical titles (e.g. **India's Got Latent** on `series-comedy`).

```bash
# Edit config/rail-curation-overrides.example.yaml (Pi: /etc/mango/rail-curation-overrides.yaml)
bash scripts/m3-play/playability/rail-curation.sh list
bash scripts/m3-play/playability/rail-curation.sh apply

# Quick pin without editing yaml:
bash scripts/m3-play/playability/rail-curation.sh pin add --rail series-comedy --type series --id tt33094114 --label "India's Got Latent"
bash scripts/m3-play/playability/rail-curation.sh pin remove --rail series-comedy --id tt33094114
```

| Field | Effect |
|-------|--------|
| `pins` | Verify stream resolve → `rail_pool` → force session slot |
| `skip_title_filter` | Keep streams when title relevance would drop rows |
| `blocks` | Remove `type:id` from pool (`rail_id: *` = all rails) |

Demoted/probation candidates to re-test with `MANGO_SOURCE_PROBE_EXPORT=1`: `mdblist.63182`, `mdblist.72165`, `mdblist.105797`, plus any newly imported list that reports repeated theme rejects or no-stream failures.

**Stream gate couch exemplars** (`config/stream-gate-fixtures.json`): IGL + Panchayat are **soft** — track Indian series streams without blocking deploy.
