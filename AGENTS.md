# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md) · Cursor/Codex sync: `aaam-sync`

Phase 0–**2 shipped on `main`**. **Active work:** branch `feat/native-experience` — native TV home ([`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)). N0 + **N1 + N2 + N3a + N3c + N3d + Track B shipped**. **Next:** N3b stream picker + progress ([`docs/N3-INVENTORY.md`](docs/N3-INVENTORY.md)).

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
| [`docs/STACK-PRINCIPLES.md`](docs/STACK-PRINCIPLES.md) | **Layer boundaries, gates, config sources** |
| [**`docs/DEPLOY.md`**](docs/DEPLOY.md) | **Pi deploy — git only, never rsync** |
| [`docs/N3d-INVENTORY.md`](docs/N3d-INVENTORY.md) | **Self-hosted addons + rails** |
| [`docs/PLAN.md`](docs/PLAN.md) | Full timeline (Phase 0–5 + native) |
| [`docs/DESIGN.md`](docs/DESIGN.md) | V1 historical spec |

**TV box systems:** `$mango-tv-box-expert` · **Launcher visuals:** `$ux-design-expert`

## Branches

| Branch | Use |
|--------|-----|
| `main` | Stable couch stack · voice + launcher · bugfixes |
| `feat/native-experience` | **Active** — native UX · catalog-service · mpv |

## Pi deploy (mandatory — git only, never rsync)

`aman@10.0.0.174` · SSH `mango` · `~/mango` · **Full runbook:** [`docs/DEPLOY.md`](docs/DEPLOY.md)

**Never `rsync`, `scp`, or hand-copy repo files to the Pi.** Mac is source of truth via git push; Pi updates via git pull only.

### Agent loop

| Step | Where | Action |
|------|-------|--------|
| 1. Diagnose | Pi | `pi-exec.sh`, gates, service logs |
| 2. Fix | Mac | Edit repo; local `npm run test` when touching catalog-service |
| 3. Ship | Mac | Commit (when asked) + `git push origin feat/native-experience` |
| 4. Deploy | Pi | **`bash scripts/pi-deploy.sh --fast`** (iteration) or `--full` (deps change) |
| 5. Verify | Pi | `bash scripts/pi-exec-gate.sh` before couch handoff — **never hand off after Mac-only checks** |

```bash
# Mac — after push (agent iteration loop — prefer --fast)
bash scripts/lib/pi-sync-check.sh path/to/changed…   # optional
bash scripts/pi-deploy.sh --fast                     # ~30–45s: pull, build, restart (skip npm ci if lock unchanged)
bash scripts/pi-deploy.sh --fast --gate              # fast deploy + pre-couch gate before user tests
bash scripts/pi-deploy.sh --full                     # always npm ci (package-lock / native module changes)
bash scripts/pi-deploy.sh --full --gate              # full deps + gate (release handoff)

# Mac — remote command
bash scripts/pi-exec.sh 'cd ~/mango && git pull --ff-only && …'

# Pi dirty tree — stash or user-approved reset; never rsync to reconcile
```

Voice after deploy (`MANGO_VOICE=1`):

```bash
bash scripts/phase2/ensure-orchestrator-venv.sh   # on Pi — never rsync .venv
bash scripts/phase2/start-voice-stack.sh
bash scripts/phase2/verify-voice-ready.sh
```

**Pre-couch gate (agent runs before user tests):**

```bash
bash scripts/pi-exec-gate.sh          # Mac: pull + gate on Pi
bash scripts/pi-pre-couch-gate.sh     # on Pi
bash scripts/phase-n3d/gate-n3d-self-hosted.sh   # when MANGO_SELF_HOSTED_ADDONS=1
bash scripts/phase-n3a/gate-n3a-play-ladder.sh   # ladder config + unit (Mac or Pi)
bash scripts/phase-n3c/gate-n3c-verify-ladder.sh
bash scripts/phase-n3c/gate-n3c-verified-rails.sh  # sampled play on displayed items
bash scripts/phase-n3a/gate-n3a-play.sh          # live couch play on Pi
bash scripts/phase-n0/gate-n0.sh
```

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, mpv, fallback Stremio/Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

Do not change pad/input stacks without user approval.
