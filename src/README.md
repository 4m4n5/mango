# Source

Native TV stack on `feat/native-experience`. Local-first; Pi deploy via git pull.

| Path | Status | Purpose |
|------|--------|---------|
| `launcher/` | Shipped | TV UI — movies · series · **live** tabs |
| `mango-ui-server/` | Shipped | `serve.py` — static server + launch API |
| `orchestrator/` | Shipped | Voice hub — WSS `:8765` + loopback `:8766` |
| `companion/` | Shipped | Phone PWA (HTTPS `:3001`) |
| **`catalog-service/`** | Shipped | stremio-core bridge → mpv (`:3020`) + live rails |

## Build launcher

```bash
cd src/launcher && npm install && npm run build
```

## Run stack (Pi)

```bash
bash scripts/mango-stack.sh restart
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

## Docs

| Topic | Doc |
|-------|-----|
| Launcher API | [ARCHITECTURE.md](../docs/ARCHITECTURE.md) |
| Voice | [VOICE.md](../docs/VOICE.md) |
| Foreground states | [ARCHITECTURE.md](../docs/ARCHITECTURE.md) |
| catalog-service | [catalog-service/README.md](catalog-service/README.md) |
| Live IPTV | [LIVE_TV.md](../docs/LIVE_TV.md) |
