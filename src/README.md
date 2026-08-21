# Mango source

Native TV stack on `main`. Mac source ships by Git; Pi runtime
state and physical couch proof remain separate.

| Path | Purpose |
|------|---------|
| `launcher/` | Search, Movies, TV Shows, Live, YouTube, Detail, ratings, Settings, focus/state restoration |
| `mango-ui-server/` | Chromium static/API server, pad-nav queue, catalog proxy, health/launch boundary |
| `catalog-service/` | Catalog/addon graph, library/progress, playability/grow, Search, recommendations, resolver/play sessions, YouTube, Reliability Center |
| `orchestrator/` | Optional text/PTT librarian, STT, tool loop and TV dispatch (`:8765`/`:8766`) |
| `companion/` | Optional HTTPS phone PWA (`:3001`) with a strict capability proxy |

mpv is the only supported daily player. AIOStreams is the intended sole
stream-capable VOD aggregate/path in a wider catalog/metadata/Live manifest
graph; catalog-service still has an optional legacy direct
MediaFusion thin-pool supplement whose removal or explicit gating is open.
Kodi/Stremio artifacts are not the current automatic recovery contract.

## Local checks

```bash
cd src/catalog-service && npm test
cd ../launcher && npm run build
cd ../companion && npm run build
```

Run only the checks relevant to a change, then prove runtime behavior on the
exact Pi SHA before couch handoff.

## Pi stack

```bash
bash scripts/mango-stack.sh restart
bash scripts/pi-pre-couch-gate.sh
```

See [architecture](../docs/ARCHITECTURE.md),
[status](../docs/STATUS.md), [catalog-service](catalog-service/README.md),
and [operations](../docs/OPERATIONS.md).
