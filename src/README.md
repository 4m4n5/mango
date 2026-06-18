# Source

Native TV stack on `feat/native-experience`. Local-first; Pi deploy via git pull.

| Path | Status | Purpose |
|------|--------|---------|
| `launcher/` | Shipped | TV UI shell + embedded voice HUD |
| `mango-ui-server/` | Shipped | `serve.py` — static server + launch API |
| `orchestrator/` | Shipped | Voice hub — WSS `:8765` + loopback `:8766` |
| `companion/` | Shipped | Phone PWA (HTTPS `:3001`) |
| **`catalog-service/`** | **N1** | stremio-core bridge → mpv (`:3020`) |
| `overlay/` | Removed (N0) | Historical — not in build path |
| `stremio-service/` | Superseded | Replaced by `catalog-service` |
| `adapters/` | N3+ | Kodi RPC, window focus, LLM tools |

## Build launcher

```bash
cd src/launcher && npm install && npm run build
```

## Run stack (Pi)

```bash
bash scripts/mango-stack.sh restart
# N1 when ready:
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

## Docs

| Topic | Doc |
|-------|-----|
| Launcher API | [PHASE1.md](../docs/PHASE1.md) |
| Voice | [PHASE2.md](../docs/PHASE2.md) |
| Foreground states | [FOREGROUND.md](../docs/FOREGROUND.md) |
| catalog-service | [catalog-service/README.md](catalog-service/README.md) |
