# Codex prompt — Phase N0 foundation reset

Copy everything below into Codex as the task prompt.

---

## Prompt

You are a **senior TV-box platform engineer** (embedded Linux, kiosk orchestration, media pipeline, SRE gates). Execute **Phase N0 — Foundation reset** for the **mango** repo end-to-end, including **on-device validation on the Raspberry Pi**.

### Read first (in order)

1. **Task spec (binding):** [`docs/tasks/phase-n0-foundation-reset.md`](docs/tasks/phase-n0-foundation-reset.md)
2. **Roadmap & conflict resolution:** [`docs/NATIVE_ROADMAP.md`](docs/NATIVE_ROADMAP.md)
3. **Product architecture:** [`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)
4. **Pi ops:** [`docs/PHASE0.md`](docs/PHASE0.md) · [`AGENTS.md`](AGENTS.md)
5. **Voice (keep working):** [`docs/PHASE2.md`](docs/PHASE2.md)
6. **Locked choices:** [`docs/DECISIONS.md`](docs/DECISIONS.md)

Apply **`$mango-tv-box-expert`** principles: couch-first, foreground contract, sub-300 ms home, never wallpaper, git-only Pi deploy, automated gate before human handoff.

### Branch & environment

- Work on **`feat/native-experience`** only.
- Pi: SSH host **`mango`** → `aman@10.0.0.174`, repo **`~/mango`**.
- **Never rsync.** Commit + push from dev machine; `git pull` on Pi.
- Secrets stay in `/etc/mango/` — never commit.

### Your mission

**N0 is a principled cleanup — not feature work.** Strip everything that burns RAM/CPU without serving the native **mpv-forward** direction. Leave a **minimal base stack**:

| Keep | Remove from default runtime |
|------|---------------------------|
| 1× Chromium launcher kiosk | 2nd overlay Chromium |
| `serve.py` API | Mock catalog / fake posters |
| Launcher voice HUD embed | Overlay app build + start |
| Orchestrator + companion (voice) | Dual uvicorn WS race |
| `mango-tv-pad.py` | Stremio/Kodi running at idle |
| Stremio/Kodi binaries (fallback only) | Launcher tiles that cold-start media apps |

### Deliverables (all required)

Implement every item in spec **§4 Deliverables D1–D7** and **§5 Validation gates**.

**New scripts (minimum):**

- `scripts/mango-stack.sh` — `start|stop|status|restart` for UI + voice
- `scripts/diag/baseline-metrics.sh` — JSON snapshot (RAM, process counts, listeners)
- `scripts/phase-n0/gate-n0.sh` — master gate; exit non-zero on failure
- `scripts/phase-n0/ws-stress.py` — loopback WS stress test
- `scripts/phase-n0/capture-tv.sh` — TV screenshot best-effort (`scrot`)

**Code changes (minimum):**

- Consolidate orchestrator to **one WebSocket server** (fix `:8765`/`:8766` race)
- Remove overlay Chromium from `start-mango-ui.sh` and `start-voice-stack.sh`
- Strip `mock-catalog.ts` from production; honest empty home until N1
- Skip Piper warmup when TTS disabled
- Archive or remove `src/overlay/` from build path

**Docs (minimum):**

- `docs/N0-INVENTORY.md` — before/after Pi metrics (fill on device)
- `docs/FOREGROUND.md` — `launcher | mpv | fallback_stremio` contract
- Update `DECISIONS.md`, `AGENTS.md`, `PHASE2.md` (overlay deprecated)

### Execution workflow (do not skip steps)

```
1. INVENTORY — SSH Pi, run spec §3.1 commands, draft docs/N0-INVENTORY.md "before"
2. IMPLEMENT — Mac/local edits; npm/python builds pass
3. COMMIT + PUSH — feat/native-experience
4. DEPLOY Pi — git pull, mango-stack.sh restart
5. METRICS — baseline-metrics.sh --label after-n0
6. GATE — bash scripts/phase-n0/gate-n0.sh (must exit 0)
7. VOICE — bash scripts/phase2/verify-voice-ready.sh
8. STRESS — ws-stress.py; grep orchestrator log for WS errors
9. VISUAL — capture-tv.sh screenshots to ~/.cache/mango/gate-screenshots/
10. INVENTORY — complete N0-INVENTORY.md "after" + gate artifacts
11. COMMIT + PUSH — inventory + any Pi-only doc updates
```

If a gate fails, **fix and re-run** until pass or document an explicit waiver in `N0-INVENTORY.md` with root cause.

### Hard rules

- **No catalog-service, no mpv play spike, no TMDB** — that is N1.
- **No secrets in git.** No `keys/`, no `.env` commits.
- **Do not change gamepad evdev codes** (B=304, Y=308, ⌂=316) without approval.
- **Do not uninstall** Stremio `.deb` or Kodi packages.
- `set -euo pipefail` on new bash scripts.
- Prefer **delete/archive dead code** over feature flags — except `MANGO_LEGACY_YOUTUBE` and `MANGO_FALLBACK_STREMIO` for documented interim.
- Chromium stays **UI-only** — do not add in-browser video playback.

### Gate thresholds (enforce in gate-n0.sh)

| Check | Pass |
|-------|------|
| `chromium` processes | ≤ 1 |
| `mango-overlay` chromium | 0 |
| `stremio` / `kodi` at idle | 0 |
| `http://127.0.0.1:3000/api/health` | 200 |
| `https://127.0.0.1:8765/health` | 200 (when voice up) |
| `verify-tv.sh` | pass |
| `verify-voice-ready.sh` | pass (when `MANGO_VOICE=1`) |
| WS stress | no "not connected" tracebacks in last 100 log lines |

### When done

Post a **handoff report** (in commit message body or PR comment):

1. Files added/changed/deleted (counts)
2. Before/after RAM + chromium count from baseline-metrics JSON
3. `gate-n0.sh` output summary
4. Screenshot paths on Pi
5. Anything you could not verify and why
6. Explicit **"Ready for N1"** or **"Blocked on …"**

Do not ask clarifying questions unless **blocked** — make principled choices per spec, document in `N0-INVENTORY.md`.

### Starter command block (Pi)

```bash
cd ~/mango && git fetch && git checkout feat/native-experience && git pull
bash scripts/diag/baseline-metrics.sh --label before-n0 || true
bash scripts/mango-stack.sh restart
bash scripts/phase-n0/gate-n0.sh
bash scripts/phase2/verify-voice-ready.sh
```

---

## Short paste (minimal)

```
Execute mango Phase N0 per docs/tasks/phase-n0-foundation-reset.md on branch feat/native-experience.
Read NATIVE_ROADMAP.md + NATIVE_EXPERIENCE.md. Strip overlay Chromium, mock catalog, dual WS, idle Stremio/Kodi.
Add mango-stack.sh, baseline-metrics.sh, gate-n0.sh. SSH Pi (mango), run full gates, fill N0-INVENTORY.md.
No catalog-service or mpv play — cleanup only. Git-only deploy. gate-n0.sh must exit 0 before handoff.
```
