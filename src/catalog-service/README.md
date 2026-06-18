# catalog-service

HTTP bridge between **stremio-core** (addon graph) and **mpv** on the Pi.

**Status:** N1 scaffold — implementation per [`docs/tasks/phase-n1-catalog-play-spike.md`](../../docs/tasks/phase-n1-catalog-play-spike.md).

## Spike order (do not skip)

1. `bash scripts/phase-n1/spike-mpv-http.sh` — mpv HTTP on Pi  
2. `bash scripts/phase-n1/spike-stremio-core.sh` — WASM + addons boot  
3. Implement this service (`:3020`)  
4. `bash scripts/phase-n1/gate-n1-smoke.sh`

## Config (Pi)

| Path | Purpose |
|------|---------|
| `/etc/mango/stremio-export.json` | Addon manifests (from Stremio export) |
| `/etc/mango/catalog-filters.json` | Stream filters (uncached debrid, max quality) |
| `/etc/mango/config.yaml` | Debrid / household keys |

Template: [`config/stremio-export.example.json`](../../config/stremio-export.example.json)  
Filters: [`config/catalog-filters.example.json`](../../config/catalog-filters.example.json)

## API (N1)

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Service + core readiness |
| `GET /meta/:type/:id` | Cinemeta meta |
| `GET /stream/:type/:id` | Resolved streams (filtered + ranked) |
| `POST /play` | Resolve (if needed) + mpv fullscreen |

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

## Dev (after implementation)

```bash
cd src/catalog-service
npm ci
npm run build
MANGO_CATALOG=1 npm start
```

## Dependencies (planned)

- Node ≥ 20
- `@stremio/stremio-core-web`
- TypeScript

Codex: see [`docs/tasks/CODEX-phase-n1-prompt.md`](../../docs/tasks/CODEX-phase-n1-prompt.md).
