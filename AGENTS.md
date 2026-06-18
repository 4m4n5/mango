# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md) · Cursor/Codex sync: `aaam-sync`

Phase 0–**2 shipped on device**. Couch sign-off partial — [`docs/PHASE2.md`](docs/PHASE2.md). **Active product work:** branch `feat/native-experience` ([`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)).

## Read first

| Doc | Use |
|-----|-----|
| [**`docs/PHASE0.md`**](docs/PHASE0.md) | **Pi ops** — bring-up, architecture, gamepad, troubleshooting |
| [`docs/PHASE1.md`](docs/PHASE1.md) | Launcher dev + API |
| [`docs/PHASE2.md`](docs/PHASE2.md) | Voice pipeline |
| [`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md) | Native TV UX overhaul (branch) |
| [`docs/PLAN.md`](docs/PLAN.md) | Full roadmap |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Pad diagram |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices |

**TV box systems:** `$mango-tv-box-expert` · **Launcher visuals:** `$ux-design-expert`

## Branches

| Branch | Use |
|--------|-----|
| `main` | Stable couch stack · voice + launcher · bugfixes |
| `feat/native-experience` | TV-first browse/rails · AI-integrated shell · stremio-service |

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

Voice stack after pull:

```bash
bash scripts/phase2/start-voice-stack.sh
bash scripts/phase2/verify-voice-ready.sh
```

**Pre-couch gate (agent runs before user tests):** SSH to Pi and run automated
checks — never hand off after Mac-only verification.

```bash
bash scripts/pi-exec-gate.sh          # Mac: pull + gate on Pi
# or on Pi:
bash scripts/pi-pre-couch-gate.sh
```

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, Stremio, Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

Do not change pad/input stacks without user approval.
