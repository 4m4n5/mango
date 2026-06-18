# mango UI server

Phase 1 stdlib Python server.

```bash
python3 src/mango-ui-server/serve.py --host 127.0.0.1 --port 3000
```

It serves:

- launcher at `/`
- overlay at `/overlay/`
- fixed launch API at `/api/launch/{stremio,kodi,launcher}`
- health at `/api/health`
