# mango UI server

Phase 1 stdlib Python server.

```bash
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
```

It serves:

- launcher at `/`
- `/overlay/` returns 410 after N0; launcher HUD is the only default TV voice surface
- fixed launch API at `/api/launch/{stremio,kodi,launcher}`
- health at `/api/health`
