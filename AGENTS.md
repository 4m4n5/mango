# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md) · Cursor/Codex sync: `aaam-sync`

**Branch:** `feat/native-experience` — native TV home. **Shipped through M4 + most of M5** (browse · play · addons · voice librarian · AI catalog slots). **Next:** M5 completion (N5c/N5d) · **M6 ship** (library · YouTube · 4K HDR · plug-and-play wizard).

## Read first

| Doc | Use |
|-----|-----|
| [**`docs/README.md`**](docs/README.md) | **Doc index** |
| [**`docs/VISION.md`**](docs/VISION.md) | **Product vision** |
| [**`docs/ROADMAP.md`**](docs/ROADMAP.md) | **Milestones M1–M6** (single plan) |
| [**`docs/STATUS.md`**](docs/STATUS.md) | **What's shipped · gates · config** |
| [**`docs/ARCHITECTURE.md`**](docs/ARCHITECTURE.md) | **Stack · layers · foreground** |
| [**`docs/OPS.md`**](docs/OPS.md) | **Pi ops** — bring-up, gamepad, troubleshooting |
| [**`docs/DEPLOY.md`**](docs/DEPLOY.md) | **Pi deploy — git only, never rsync** |
| [`docs/VOICE.md`](docs/VOICE.md) | Voice pipeline + N5a tools |
| [`docs/LIVE_TV.md`](docs/LIVE_TV.md) | Live IPTV (opt-in gates) |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Pad diagram |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices |
| [`docs/COUCH_TEST.md`](docs/COUCH_TEST.md) | Couch handoff checklist |
| [`scripts/MILESTONES.md`](scripts/MILESTONES.md) | Script dirs M1–M5 · milestone layout only |

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
bash scripts/pi-deploy.sh --fast                     # ~30–45s: pull, build, restart
bash scripts/pi-deploy.sh --fast --gate              # fast deploy + pre-couch gate
bash scripts/pi-deploy.sh --full                     # always npm ci
bash scripts/pi-deploy.sh --full --gate              # full deps + gate (release handoff)

# Mac — remote command
bash scripts/pi-exec.sh 'cd ~/mango && git pull --ff-only && …'
```

Voice after deploy (`MANGO_VOICE=1`):

```bash
bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh   # on Pi — never rsync .venv
bash scripts/m5-voice/stack/start-voice-stack.sh
bash scripts/m5-voice/stack/verify-voice-ready.sh
```

**Pre-couch gate (agent runs before user tests):**

```bash
bash scripts/pi-exec-gate.sh          # Mac: pull + gate-lite on Pi
bash scripts/pi-pre-couch-gate.sh     # gate-lite (~1–2 min) — see docs/ARCHITECTURE.md
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh   # slow per-rail play sweep
```

Live IPTV (NexoTV) is **excluded** from deploy gates — opt in: `MANGO_LIVE_GATE=1` / `MANGO_LIVE_PROBE=1` ([`docs/LIVE_TV.md`](docs/LIVE_TV.md)).

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **L**=`310` tab − · **R**=`311` tab + · **↻**=`317` shuffle · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, mpv, fallback Stremio/Kodi | **`mango-tv-pad.py`** |
| Fallback only | `input-remapper` `mango-tv` if pad fails |

Do not change pad/input stacks without user approval.
