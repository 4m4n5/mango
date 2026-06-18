# Source

Phase 1 source is intentionally small and local-first.

| Path | Status | Purpose |
|------|--------|---------|
| `launcher/` | Phase 1 | Vite + vanilla TypeScript TV launcher |
| `overlay/` | Phase 1 | Vite + vanilla TypeScript idle overlay stub |
| `mango-ui-server/` | Phase 1 | Stdlib-only Python static server and launch API |
| `orchestrator/` | Deferred | Voice, LLM, tools, session |
| `companion/` | Deferred | Phone PWA |
| `stremio-service/` | Deferred | Stremio catalog/library API |
| `adapters/` | Deferred | Kodi RPC, Stremio deep links, window focus, TMDB |

Build launcher and overlay separately:

```bash
cd src/launcher && npm install && npm run build
cd ../overlay && npm install && npm run build
```

Run the Phase 1 shell from the repo root:

```bash
bash scripts/phase1/start-mango-ui.sh
```

See [PHASE1.md](../docs/PHASE1.md) for the full runbook.
