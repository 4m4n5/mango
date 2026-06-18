# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

Phase 0 + 1 **complete on device** — do not redo bring-up unless asked.

## Read first

| Doc | Use |
|-----|-----|
| [**`docs/PHASE0.md`**](docs/PHASE0.md) | **Pi ops** — bring-up, architecture, gamepad, troubleshooting |
| [`docs/PHASE1.md`](docs/PHASE1.md) | Launcher dev + API |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Pad diagram |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices |

## Pi

`aman@10.0.0.174` · SSH `mango` · `~/mango`

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/phase1/restart-mango-ui.sh'
```

One-time: `bash scripts/setup-mac-pi-ssh.sh` on Mac.

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| App | Stack |
|-----|--------|
| Launcher, Kodi | `input-remapper` `mango-tv` |
| Stremio | `stremio-pad-bridge.py` (Y → Escape) |

## Next

Phase 2 per [`docs/PLAN.md`](docs/PLAN.md). Do not change gamepad/input stacks without user approval.
