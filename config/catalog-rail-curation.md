# Rail catalog curation (v2.2)

Playability-first picks. **Accumulative pools:** each refresh grows verified depth by `pool_growth_per_refresh` (default 10) up to `pool_max` (120); only confirmed-dead titles are pruned from `rail_pool`.

After each fill: `source-hitrate.py` → tune → re-import → `fill-playability-db.sh` (never use `MANGO_FILL_PURGE_POOLS=1` unless resetting).

## Hit-rate principles

1. **Cinemeta charts** (`top`, `imdbRating`) — highest debrid cache; use as anchor on weak series rails.
2. **mdblist daily/trending** (`88302`, `105797`) — mainstream cache over “latest/digital/reality”.
3. **IndiaStreams** (`recmov`, `popmov`, **`trendingtv`**) — legacy regional blend; **demoted** on india rails in favor of **Bharat Binge** (better posters + hit-rate). Keep small weight for dedup diversity.
4. **Bharat Binge** (`tmdb-hi-*`) — Hindi OTT charts via TMDB; catalog+meta only (streams via AIOStreams). Manifest: `config/bharat-binge-manifest.url`.
5. **Session dedup** — niche/optional rails **last** in yaml (allocate tab session slots first).
6. **Optional rails** — `min_display: 12` so fill does not block on hard-to-probe catalogs.

## Rail → source map (v2.2)

| Rail | Sources | Rationale |
|------|---------|-----------|
| `movies-global-popular` | Cinemeta `top` + **88302** + **2236** | Mainstream charts; no overlap with quick-watches |
| `movies-india-trending` | **Bharat Binge** recent + surprise + top_rated (81%) · IndiaStreams recmov/popmov (14%) · **49761** India stand-up probation (5%) | Bharat primary; IndiaStreams demoted; 49761 gets small same-theme recovery budget |
| `movies-classics` | Cinemeta `imdbRating` | Anchor |
| `movies-comedy` | **91223** | 100% source; pool top-up not swap |
| `movies-quick-watches` | **86934** (35%) + **84444** (30%) + **3885** (20%) + Cinemeta `year` (15%) | Shorter/easier — no overlap lists 2236/83666/14 |
| `movies-documentaries` | **84677** | 100%; enable in mango import |
| `series-global-popular` | Cinemeta `top` 0.8 + **105797** | Dropped 88303 (40%); daily picks 100% probe |
| `series-india-picks` | **Bharat Binge** recent + latest_episodes + top_rated (85%) · IndiaStreams trendingtv (8%) · **49761** India stand-up probation (5%) · Cinemeta `top` (2%) | Fresh Hindi OTT; IndiaStreams demoted; 49761 can recover only if verified/theme-fit yield is good |
| `series-classics` | Cinemeta `imdbRating` | Anchor |
| `series-comedy` | Cinemeta `top` + **91224** | yaml last = session priority; probe ~40% — WP2 stream tuning |
| `series-miniseries` | **130153** | 80% probe |
| `series-reality-casual` | **63182** reality (70%) + Cinemeta `top` anchor (30%) | Replaces **2194** latest-TV blend; **84401** was 0% probe (legacy) |

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

Demoted candidates to re-test with `MANGO_SOURCE_PROBE_EXPORT=1`: `mdblist.88303`, `mdblist.84401`, `mdblist.83666`, `mdblist.63182` (new on reality rail).

**Stream gate couch exemplars** (`config/stream-gate-fixtures.json`): IGL + Panchayat are **soft** — track Indian series streams without blocking deploy.
