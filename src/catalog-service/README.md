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
| `/etc/mango/config.yaml` | Debrid / household keys |

Template: [`config/stremio-export.example.json`](../../config/stremio-export.example.json)

## API (N1)

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Service + core readiness |
| `GET /meta/:type/:id` | Cinemeta meta |
| `GET /stream/:type/:id` | Resolved streams |
| `POST /play` | Resolve (if needed) + mpv fullscreen |

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
