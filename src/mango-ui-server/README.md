# mango UI server

Stdlib Python static server + launch API. Part of the native base stack.

```bash
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
```

| Route | Notes |
|-------|-------|
| `/` | Launcher (Vite build) + embedded voice HUD |
| `/api/health` | Stack health |
| `/api/launch/launcher` | Home (return to launcher) |
| `/overlay/` | 410 — legacy overlay removed from the native stack |

**Pi:** started by `mango-stack.sh` / `m1-foundation/ui/start-mango-ui.sh`

Docs: [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) · [OPS.md](../../docs/OPS.md)
