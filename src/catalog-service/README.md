# catalog-service

HTTP bridge between **stremio-core** (addon graph) and **mpv** on the Pi.

**Status:** N1–N3d + Track B + Live TV on `feat/native-experience`.

## Config (Pi)

| Path | Purpose |
|------|---------|
| `/etc/mango/stremio-export.json` | Addon manifests (Cinemeta, AIOStreams, AIOMetadata) |
| `/etc/mango/catalog.yaml` | Home rails (copy from `config/catalog.example.yaml`) |
| `/etc/mango/catalog-filters.json` | Stream filters (uncached debrid, max quality) |
| `/etc/mango/playability.db` | Verified pools + tab session allocation |
| `/etc/mango/rail-curation-overrides.yaml` | Optional pins/blocks per rail |
| `/etc/mango/catalog-live.yaml` | Live sport rails (optional; repo example fallback) |
| `/etc/mango/progress.db` | mpv resume (Continue rail) |
| `/etc/mango/config.yaml` | Debrid / household keys |

Templates: [`config/stremio-export.example.json`](../../config/stremio-export.example.json) · [`config/catalog.example.yaml`](../../config/catalog.example.yaml) · [`config/catalog-filters.example.json`](../../config/catalog-filters.example.json)

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Service + core readiness |
| `GET /rails` | Rail summaries from `catalog.yaml` |
| `GET /rails/items?tab=` | Tab batch — movies · series · **live** |
| `GET /rails/:id/items` | Single-rail items (fallback) |
| `GET /meta/:type/:id` | Cinemeta meta |
| `GET /series/:id/episodes` | Normalized season/episode list + resume + playable flags |
| `GET /stream/:type/:id` | Resolved streams (filtered + ranked) |
| `POST /play` | Resolve (if needed) + mpv fullscreen — bare series id resumes latest episode |
| `GET /playability/status` | Pool depth + maintenance counters |

Rails: `addon_catalog` and `composite_list` (weighted mdblist/Cinemeta blends). Tab session allocation dedupes titles across rails (`session-select.ts`).

### Stream filters (uncached debrid)

By default, `POST /play` and `GET /stream` **skip uncached Real-Debrid / TorBox** streams so you do not hit *"still downloading; this title is not ready on your debrid service yet"*.

**Persistent config** — copy the example and edit on the Pi:

```bash
sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json
```

| Field | Default | Meaning |
|-------|---------|---------|
| `exclude_uncached_debrid` | `true` | Drop debrid streams AIOStreams marks uncached |
| `strict_unknown_cache` | `false` | Also drop debrid when cache status unknown |
| `max_quality` | `1080p` | Skip 4K REMUX on 1080p TV (until N7) |
| `exclude_remux` | `true` | Skip Blu-ray REMUX |
| `stream_display_limit` | `8` | Keep picker rows scannable |

`GET /stream` rows include structured stream metadata parsed from AIOStreams
`lightgdrive` descriptions when available: `display_label`, `release_group`,
`encode`, `size_gb`, `indexer`, `hdr_tags`, `languages`, `debrid_service`, and
`cache_status`.

Language overrides are split:

| Override | Mode | Meaning |
|----------|------|---------|
| `preferred_language` | soft | Boost matching rows; never excludes non-matches |
| `language` | hard | Exclude rows that do not match parsed language metadata |

Examples:

```bash
# Prefer Hindi rows but keep English fallback rows visible
curl "http://127.0.0.1:3020/stream/movie/tt8178634?preferred_language=Hindi"

# Hard-filter to Hindi-tagged rows
curl "http://127.0.0.1:3020/stream/movie/tt8178634?language=Hindi"

# POST /play accepts the same split
curl -X POST http://127.0.0.1:3020/play \
  -H 'content-type: application/json' \
  -d '{"type":"movie","id":"tt8178634","language":"Hindi"}'
```

**Unlock right now** (one request):

```bash
# browse all streams including uncached
curl "http://127.0.0.1:3020/stream/movie/tt0111161?include_uncached=1"

# play first uncached stream anyway
curl -X POST "http://127.0.0.1:3020/play?include_uncached=1" \
  -H 'content-type: application/json' \
  -d '{"type":"movie","id":"tt0111161"}'

# or in JSON body
curl -X POST http://127.0.0.1:3020/play \
  -H 'content-type: application/json' \
  -d '{"type":"movie","id":"tt0111161","include_uncached":true}'
```

**Env overrides** (e.g. in `~/.config/mango/voice.env`): `MANGO_INCLUDE_UNCACHED=1`, `MANGO_MAX_QUALITY=1080p`, `MANGO_EXCLUDE_REMUX=1`.

Responses include a `filters` object with exclusion counts.

### Rate limits

Browse merges **Cinemeta** first, then **AIOMetadata** (`:3036`, your MDBList/TMDB keys).
When those APIs throttle, addons may return metas whose title/description is error copy —
catalog-service **drops** them instead of showing them on posters.

| Env | Default | Meaning |
|-----|---------|---------|
| `MANGO_RAIL_ITEMS_CACHE_TTL_MS` | `2700000` (45 min) | Cache `GET /rails/:id/items` |
| `MANGO_META_CACHE_TTL_MS` | `600000` (10 min) | Positive meta cache TTL |
| `MANGO_META_RATE_LIMIT_BACKOFF_MS` | `300000` (5 min) | Skip re-fetch after throttle |
| `MANGO_RAIL_META_CONCURRENCY` | `6` | Max parallel meta lookups per rail |
| `MANGO_RAIL_META_STAGGER_MS` | `0` | Pause between meta batches (raise if Cinemeta rate-limits) |

If daily limits still bite: [MDBList Standard](https://mdblist.memberful.com/join) (~€2/mo) or TMDB commercial plan.

API errors return **couch-safe** `error` text (never raw “rate limit exceeded”).

### Live TV

Sport rails from `catalog-live.yaml` — dual NexoTV (`mango Live TV` + `mango Live Free`). Full ops: [`docs/LIVE_TV.md`](../../docs/LIVE_TV.md).

| Endpoint | Notes |
|----------|-------|
| `GET /rails/items?tab=live` | **Long-lived cache** (memory + `~/.cache/mango/live-rails-cache.json`); ignores `reshuffle=1`; launcher hides shuffle on live tab |
| `POST /play` + `live: true` | mpv `--live` |

`verify_streams: false` in catalog-live — NexoTV `/stream/` probes share ~60 req/min.

## Dev

```bash
cd src/catalog-service
npm ci
npm run build
npm run test
MANGO_CATALOG=1 npm start
```

## Dependencies

- Node ≥ 20
- `@stremio/stremio-core-web`
- TypeScript · `better-sqlite3`
