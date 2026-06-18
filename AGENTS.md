# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

Phase 0 + 1 + **1.5 complete on device**. **Phase 2 voice** in progress — do not redo bring-up unless asked.

## Read first

| Doc | Use |
|-----|-----|
| [**`docs/PHASE0.md`**](docs/PHASE0.md) | **Pi ops** — bring-up, architecture, gamepad, troubleshooting |
| [`docs/PHASE1.md`](docs/PHASE1.md) | Launcher dev + API |
| [**`docs/PHASE2.md`**](docs/PHASE2.md) | **Voice pipeline** (current) |
| [`docs/PLAN.md`](docs/PLAN.md) | Full roadmap |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Pad diagram |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices |

**TV box systems:** `$mango-tv-box-expert` · **Launcher visuals:** `$ux-design-expert`

## Pi

`aman@10.0.0.174` · SSH `mango` · `~/mango`

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/phase1/restart-mango-ui.sh'
```

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, Stremio, Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

## Next (Phase 2)

Orchestrator `:8765` · companion HTTPS `:3001` · overlay re-enable when voice ships. See [`docs/PHASE2.md`](docs/PHASE2.md). Do not change pad/input stacks without user approval.
