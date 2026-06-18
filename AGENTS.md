# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

**Read [`docs/PHASE0.md`](docs/PHASE0.md) before any Pi or gamepad work.** Phase 0 is complete on device; do not redo bring-up unless user asks.

## Live Pi

`aman@mango.local` · `10.0.0.174` · repo `~/mango`

## Daily commands

```bash
bash scripts/phase0/tv.sh kodi
bash scripts/phase0/tv.sh stremio
```

## Gamepad (locked — do not change without user)

8BitDo Micro · clockwise from left: **Y · X · A · B** · **B** (`304`) = select · **Y** (`308`) = back.

| App | Stack |
|-----|--------|
| Kodi | `input-remapper` → `map-pro-controller.sh` |
| Stremio | `stremio-pad-bridge.py` + hide `js*` — **not** remapper |

Details: [`docs/HARDWARE.md`](docs/HARDWARE.md) · [`docs/DECISIONS.md`](docs/DECISIONS.md)

## Docs map

| Doc | Use |
|-----|-----|
| [`docs/PHASE0.md`](docs/PHASE0.md) | **Runbook** |
| [`scripts/phase0/README.md`](scripts/phase0/README.md) | Script index |
| [`docs/kodi-youtube-setup.md`](docs/kodi-youtube-setup.md) | YouTube API keys |
| [`docs/PLAN.md`](docs/PLAN.md) | Phase 1+ |

## Rules

- No `src/` until Phase 0 sign-off ([`phase0-checklist.md`](docs/phase0-checklist.md))
- Never commit secrets (`keys/`, `youtube-api.json`, Kodi RPC password)
- Never bare `stremio &` — use `reset-stremio.sh`
- Stremio voice → `stremio://` deep links

## Next work

Phase 0: 30 min stability soak → **Phase 1** boot launcher per [`PLAN.md`](docs/PLAN.md).
