# mango — agent entry point

> Workspace: [`../AGENTS.md`](../AGENTS.md) · Cursor/Codex sync: `aaam-sync`

**Branch:** `feat/native-experience` — native TV home. **Implemented:** M1–M4 · Mango-owned library · native YouTube base · Search · voice/phone librarian · Reliability Center · native mpv HUD/Streams · latest-only Household recommendations: progressive VOD content profiles/Story Frontier and provenance-gated YouTube v2. **Current release line:** see [STATUS.md](docs/STATUS.md) for the latest recorded Pi deployment (currently `77cadbe414384cd152525c2befbf6a7b8bef171e`). Older SHAs named in this file are historical, not current Pi truth. **Active:** human couch recommendation/focus/picture/audio/controller acceptance · harden deploy helpers · implement intentional display sleep/CEC · harden playback/provider/grow paths. **Next:** M6.4 no-SSH wizard · final release acceptance · merge to `main`. Read [STATUS.md](docs/STATUS.md) before treating source, Mac tests, Pi deployment, automated gates, or human couch proof as equivalent.

## Read first

| Doc | Use |
|-----|-----|
| [**`docs/README.md`**](docs/README.md) | **Doc index** |
| [**`docs/VISION.md`**](docs/VISION.md) | **Product vision** |
| [**`docs/ROADMAP.md`**](docs/ROADMAP.md) | **Milestones M1–M6** (single plan) |
| [**`docs/STATUS.md`**](docs/STATUS.md) | **What's shipped · gates · config** |
| [**`docs/ARCHITECTURE.md`**](docs/ARCHITECTURE.md) | **Stack · layers · foreground** |
| [**`docs/PLAYABILITY.md`**](docs/PLAYABILITY.md) | **Playability · grow · thematic rails** |
| [`docs/SEARCH.md`](docs/SEARCH.md) | Unified launcher Search · quota · restoration · gates |
| [**`docs/OPS.md`**](docs/OPS.md) | **Pi ops** — bring-up, gamepad, troubleshooting |
| [**`docs/DEPLOY.md`**](docs/DEPLOY.md) | **Pi deploy — git only, never rsync** |
| [`docs/RELIABILITY.md`](docs/RELIABILITY.md) | Reliability Center · nightly proof |
| [`docs/VOICE.md`](docs/VOICE.md) | Voice pipeline (M5) |
| [`docs/LIVE_TV.md`](docs/LIVE_TV.md) | Live IPTV (opt-in gates) |
| [`docs/HARDWARE.md`](docs/HARDWARE.md) | Pad diagram |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Locked choices |
| [`docs/COUCH_TEST.md`](docs/COUCH_TEST.md) | Couch handoff checklist |
| [`scripts/MILESTONES.md`](scripts/MILESTONES.md) | Script dirs M1–M6 + Live · milestone layout only |

**TV box systems:** `$mango-tv-box-expert` · **Launcher visuals:** `$ux-design-expert`

## Cursor performance

- **Indexing:** `.cursorignore` excludes caches, `node_modules/`, `.venv/`, lockfiles, build output, `docs/archive/` (incl. CODEX handoffs), audits, secrets dirs, and harness artifacts — live source, current docs, and UX round shots stay searchable; reopen ignored paths explicitly when needed.
- **MCP:** this workspace ships GitHub only (`mango/.cursor/mcp.json`). Disable unused MCP servers in **Cursor Settings → Tools & MCP** per session; parent-studio servers (playwright, godot) live in `../.cursor/mcp.json`.

## Branches

| Branch | Use |
|--------|-----|
| `main` | Stable couch stack · voice + launcher · bugfixes |
| `feat/native-experience` | **Active** — native UX · catalog-service · mpv |

## Pi deploy (mandatory — git only, never rsync)

SSH `mango` primary, `mango-mdns` fallback via `mango.local` · `~/mango` · numeric LAN addresses are not durable truth · **Full runbook:** [`docs/DEPLOY.md`](docs/DEPLOY.md)

**Never `rsync`, `scp`, or hand-copy repo files to the Pi.** Mac is source of truth via git push; Pi updates via git pull only.

> **Current deploy-helper blocker:** do not run `pi-deploy.sh` or
> `pi-exec-gate.sh` unattended. They derive the Pi branch from the Mac checkout
> instead of enforcing `feat/native-experience`, pull an unpinned branch, and
> `pi-deploy.sh` can invoke a mutating AIOMetadata rail sync that emits sensitive
> output and leaves a fixed `/tmp` response. The local skip variable is not
> forwarded into that remote step. Use the human-reviewed exception/manual path
> in [`docs/DEPLOY.md`](docs/DEPLOY.md) only after exact branch/SHA checks, or fix
> and test the helpers first.

**Split machine:** if this Mac cannot SSH to the Pi (e.g. work laptop), commit + push here; deploy from the home Mac on the Pi LAN — [`docs/DEPLOY-SPLIT-MACHINE.md`](docs/DEPLOY-SPLIT-MACHINE.md).

### Agent loop

| Step | Where | Action |
|------|-------|--------|
| 1. Diagnose | Pi | `pi-exec.sh`, gates, service logs |
| 2. Fix | Mac | Edit repo; local `npm run test` when touching catalog-service |
| 3. Ship | Mac | Commit (when asked) + `git push origin feat/native-experience` |
| 4. Deploy | Pi | Currently blocked for unattended agents; follow the reviewed path in `docs/DEPLOY.md` |
| 5. Verify | Pi | Run Pi-local gates against the read-back exact SHA — **never hand off after Mac-only checks** |

```bash
# Mac — after push; preflight only (the wrappers below remain blocked until hardened)
bash scripts/lib/pi-sync-check.sh path/to/changed…   # optional
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"

# Mac — read-only Pi preflight; do not pull or select a revision implicitly
bash scripts/pi-exec.sh 'cd ~/mango && git branch --show-current && git rev-parse HEAD && git status --short'
```

Voice after deploy (`MANGO_VOICE=1`):

```bash
bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh   # on Pi — never rsync .venv
bash scripts/m5-voice/stack/start-voice-stack.sh
bash scripts/m5-voice/stack/verify-voice-ready.sh
```

**Pre-couch gate (run on the already selected, read-back Pi SHA):**

```bash
bash scripts/pi-pre-couch-gate.sh     # gate-lite (~1–2 min) — see docs/ARCHITECTURE.md
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh   # full gate (~5–8 min, 3 plays/rail)
```

Live IPTV (NexoTV) is **excluded** from deploy gates — opt in: `MANGO_LIVE_GATE=1` / `MANGO_LIVE_PROBE=1` ([`docs/LIVE_TV.md`](docs/LIVE_TV.md)).

## Gamepad (locked)

8BitDo Micro · **B**=`304` select · **Y**=`308` back · **X**=`307` contextual secondary (Home shuffle; Search delete/clear) · **−/+**=`314`/`315` volume · **L**=`310` tab − · **R**=`311` tab + · **⌂**=`316` home

| Surface | Input |
|---------|--------|
| Launcher, mpv | **`mango-tv-pad.py`** |
| Pad recovery only | `input-remapper` `mango-tv` if pad fails to grab |

Do not change pad/input stacks without user approval.
