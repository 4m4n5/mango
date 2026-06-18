# Source

Phase 1 source is intentionally small and local-first.

| Path | Status | Purpose |
|------|--------|---------|
| `launcher/` | Phase 1 | Vite + vanilla TypeScript TV launcher |
| `overlay/` | Removed in N0 | Historical Chromium overlay app deleted from runtime/build path |
| `mango-ui-server/` | Phase 1 | Stdlib-only Python static server and launch API |
| `orchestrator/` | Phase 2 / N0 | Voice, LLM, single WebSocket listener |
| `companion/` | Phase 2 | Phone PWA |
| `stremio-service/` | Deferred | Stremio catalog/library API |
| `adapters/` | Deferred | Kodi RPC, Stremio deep links, window focus, TMDB |

Build launcher:

```bash
cd src/launcher && npm install && npm run build
```

Run the native base stack from the repo root:

```bash
bash scripts/mango-stack.sh restart
```

See [PHASE1.md](../docs/PHASE1.md), [PHASE2.md](../docs/PHASE2.md), and
[FOREGROUND.md](../docs/FOREGROUND.md) for the runbooks.
