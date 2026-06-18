# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md) · Cursor/Codex sync: `aaam-sync`

Phase 0–**2 shipped on `main`**. **Active work:** branch `feat/native-experience` — native TV home ([`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)). N0 base stack gate ([`docs/N0-INVENTORY.md`](docs/N0-INVENTORY.md)). **N1 in progress:** catalog + mpv spike ([`docs/tasks/phase-n1-catalog-play-spike.md`](docs/tasks/phase-n1-catalog-play-spike.md), [`docs/N1-INVENTORY.md`](docs/N1-INVENTORY.md)).

## Read first

| Doc | Use |
|-----|-----|
| [**`docs/README.md`**](docs/README.md) | **Human doc index** |
| [**`docs/NATIVE_EXPERIENCE.md`**](docs/NATIVE_EXPERIENCE.md) | **Product vision** (native) |
| [**`docs/NATIVE_ROADMAP.md`**](docs/NATIVE_ROADMAP.md) | **Phases N0–N7** |
| [**`docs/PHASE0.md`**](docs/PHASE0.md) | **Pi ops** — bring-up, gamepad, troubleshooting |
| [`docs/FOREGROUND.md`](docs/FOREGROUND.md) | launcher \| mpv \| fallback |
| [`docs/PHASE1.md`](docs/PHASE1.md) | Launcher dev + API |
| [`docs/PHASE2.md`](docs/PHASE2.md) | Voice pipeline |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Pad diagram |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices |
| [`docs/PLAN.md`](docs/PLAN.md) | Full timeline (Phase 0–5 + native) |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 historical spec |

**TV box systems:** `$mango-tv-box-expert` · **Launcher visuals:** `$ux-design-expert`

## Branches

| Branch | Use |
|--------|-----|
| `main` | Stable couch stack · voice + launcher · bugfixes |
| `feat/native-experience` | **Active** — native UX · catalog-service · mpv |

## Pi deploy (mandatory — no rsync)

`aman@10.0.0.174` · SSH `mango` · `~/mango`

**Never `rsync` or hand-copy repo files to the Pi.** Mac is source of truth via git.

1. **Verify** — changes are simple and principled; builds pass locally if touching `src/`.
2. **Commit + push** from Mac (`github.com/4m4n5/mango`).
3. **Pull + test** on Pi:

```bash
bash scripts/lib/pi-sync-check.sh <changed-path>   # Mac, before push
bash scripts/pi-exec.sh 'cd ~/mango && git pull && bash scripts/mango-stack.sh restart'
```

Voice stack after pull:

```bash
bash scripts/mango-stack.sh restart
bash scripts/phase2/verify-voice-ready.sh
```

**Pre-couch gate (agent runs before user tests):** SSH to Pi and run automated
checks — never hand off after Mac-only verification.

```bash
bash scripts/pi-exec-gate.sh          # Mac: pull + gate on Pi
# or on Pi:
bash scripts/pi-pre-couch-gate.sh
# native branch direct:
bash scripts/phase-n0/gate-n0.sh
bash scripts/phase-n1/gate-n1-smoke.sh   # after N1 implementation
```

**N1 deploy:** requires `/etc/mango/stremio-export.json` on Pi (Stremio export). Then:

```bash
cd ~/mango && git pull
cd src/catalog-service && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n1/gate-n1-smoke.sh
```

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, mpv, fallback Stremio/Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

Do not change pad/input stacks without user approval.
