# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

**Read [`docs/PHASE0.md`](docs/PHASE0.md) before any Pi or gamepad work.** Phase 0 is complete on device; do not redo bring-up unless user asks.

## Live Pi

`aman@mango.local` · `10.0.0.174` · repo `~/mango`

## Daily commands

```bash
bash scripts/phase1/start-mango-ui.sh
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
| [`docs/PHASE0.md`](docs/PHASE0.md) | Pi runbook (Phase 0) |
| [`docs/PHASE1.md`](docs/PHASE1.md) | Launcher shell, UI server, Pi autostart |
| [**`docs/tasks/phase1-ui-shell.md`**](docs/tasks/phase1-ui-shell.md) | **Phase 1 implementation spec** |
| [`docs/tasks/CODEX-phase1-prompt.md`](docs/tasks/CODEX-phase1-prompt.md) | Copy-paste prompt for Codex |
| [`scripts/phase0/README.md`](scripts/phase0/README.md) | Phase 0 scripts |
| [`docs/PLAN.md`](docs/PLAN.md) | Full roadmap |

## Next work

Use [`docs/PHASE1.md`](docs/PHASE1.md) for the launcher shell runbook, verification checklist, and Pi autostart flow before starting Phase 2 work.
