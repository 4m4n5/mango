# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md)

Phase 0 + 1 + **1.5 complete on device**. **Phase 2 voice slices 2.2-2.5** are implemented in repo; Pi audio/couch verification still required. Do not redo bring-up unless asked.

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

## Pi deploy (mandatory — no rsync)

`aman@10.0.0.174` · SSH `mango` · `~/mango`

**Never `rsync` or hand-copy repo files to the Pi.** Mac is source of truth via git.

1. **Verify** — changes are simple and principled; builds pass locally if touching `src/`.
2. **Commit + push** from Mac (`github.com/4m4n5/mango`).
3. **Pull + test** on Pi:

```bash
bash scripts/lib/pi-sync-check.sh <changed-path>   # Mac, before push
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/phase1/restart-mango-ui.sh'
```

Full Pi refresh after a pull:

```bash
cd ~/mango && git pull
bash scripts/phase1/restart-mango-ui.sh
systemctl --user restart mango-tv-pad.service   # if pad autoreconnect installed
```

**Pre-couch gate (agent runs before user tests):** SSH to Pi and run automated
checks — never hand off after Mac-only verification.

```bash
bash scripts/pi-exec-gate.sh          # Mac: pull + gate on Pi
# or on Pi:
bash scripts/pi-pre-couch-gate.sh
```

Gate covers: git sync, `verify-tv.sh`, pad service, BT, launcher window, pad
log. Couch flows **C1–C4** in that script are still manual on TV.

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, Stremio, Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

## Next (Phase 2)

Orchestrator `:8765` with `MANGO_ORCH_TLS=1` · companion HTTPS `:3001` · overlay opt-in with `MANGO_VOICE=1`. See [`docs/PHASE2.md`](docs/PHASE2.md). Do not change pad/input stacks without user approval.
