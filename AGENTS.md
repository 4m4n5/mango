# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md) · Cursor/Codex sync: `aaam-sync`

Phase 0–**2 shipped on `main`**. **Active work:** branch `feat/native-experience` — native TV home ([`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)). N0 + **N1 + N2 shipped**. **N3a in progress:** stream play orchestrator ([`docs/tasks/phase-n3-stream-orchestrator.md`](docs/tasks/phase-n3-stream-orchestrator.md), [`docs/N3-INVENTORY.md`](docs/N3-INVENTORY.md)).

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
# or on Pi (N0 + sampled N3c):
bash scripts/pi-pre-couch-gate.sh
# full play gate on served items:
MANGO_GATE_FULL=1 bash scripts/phase-n3c/gate-n3c-verified-rails.sh
# phase-specific (no nested regressions):
bash scripts/phase-n0/gate-n0.sh
bash scripts/phase-n1/gate-n1-smoke.sh   # MANGO_GATE_SPIKES=1 for S0/S1 spikes
bash scripts/phase-n2/gate-n2-browse.sh
```

**N2 deploy:** requires `/etc/mango/catalog.yaml` (from `config/catalog.example.yaml`) + optional `tmdb.key`. Then:

```bash
cd ~/mango && git pull
cd src/catalog-service && npm ci && npm run build
cd src/launcher && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n2/gate-n2-browse.sh
```

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, mpv, fallback Stremio/Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

Do not change pad/input stacks without user approval.
