# Phase 1 — UI shell (task spec)

**For:** Codex / implementation agent  
**Repo:** `github.com/4m4n5/mango` · local `~/mango` on Pi  
**Branch:** `main` (or `phase1/launcher` if you prefer a PR branch)  
**Est. scope:** First vertical slice — launcher + launch/back + overlay stub + Pi autostart docs

---

## 1. Context (read first)

Phase **0 is done** on a real Pi 5 (`mango`). Kodi + YouTube + Stremio work with an **8BitDo Micro** gamepad. Do **not** redo Phase 0 bring-up.

| Doc | Purpose |
|-----|---------|
| [`docs/PHASE0.md`](../PHASE0.md) | Pi runbook, gamepad layout, `tv.sh` |
| [`docs/HARDWARE.md`](../HARDWARE.md) | Face buttons: Y·X·A·B — **B** (`304`) select, **Y** (`308`) back |
| [`docs/DECISIONS.md`](../DECISIONS.md) | Locked stack choices |
| [`docs/PLAN.md`](../PLAN.md) § Phase 1 | Original plan |
| [`docs/DESIGN.md`](../DESIGN.md) § UI spec, success criteria #1 #2 #10 | Product spec |
| [`config/config.example.yaml`](../../config/config.example.yaml) | Ports: launcher `3000`, overlay `3002`, companion `3001` |

**Live Pi:** `aman@mango.local` · `10.0.0.174` · user `aman` · X11 + Openbox

---

## 2. Goal

Boot (or manual start) → **fullscreen launcher** in Chromium → user picks **Stremio** or **YouTube** → app opens with correct gamepad stack → **Escape / Y-back** returns to launcher.

**Phase 1 exit criteria** (from DESIGN.md — only these three for this task):

1. Launcher → Stremio → browse/play with **gamepad only**
2. Launcher → Kodi YouTube → navigate with **gamepad only**
3. **Back** → launcher from any app (success criterion #10)

Voice, companion PTT, orchestrator, stremio-service: **out of scope**.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Chromium kiosk :3000  →  Launcher (Vite + vanilla TS)  │
│  Chromium app   :3002  →  Overlay (idle badge stub)     │
├─────────────────────────────────────────────────────────┤
│  mango-ui-server (Python) — static + POST /api/launch/* │
├─────────────────────────────────────────────────────────┤
│  scripts/launch-*.sh  →  scripts/phase0/tv.sh (existing)│
├─────────────────────────────────────────────────────────┤
│  Openbox: Escape → launch-launcher.sh                   │
└─────────────────────────────────────────────────────────┘
```

**Why a Python server:** The launcher runs in a browser; it cannot `exec` shell scripts. Server receives `POST /api/launch/{stremio|kodi|launcher}` and runs the appropriate script as user `aman`.

**Gamepad on launcher:** When launcher is focused, use existing **input-remapper** (`map-pro-controller.sh`) — D-pad → arrows, B → Return, Y → Escape. Launcher UI must listen for **keyboard** events only (not gamepad APIs).

**Gamepad in apps:** Unchanged Phase 0 behavior via `tv.sh` wrappers.

---

## 4. Reuse Phase 0 scripts (do not reimplement)

| Action | Call |
|--------|------|
| Stremio + pad bridge | `bash scripts/phase0/reset-stremio.sh` |
| Kodi + remapper | `bash scripts/phase0/launch-kodi.sh` |
| BT connect | `bash scripts/phase0/connect-gamepad.sh` (already inside launch scripts) |

Create **thin wrappers** at `scripts/` (not under `phase0/`):

```
scripts/launch-stremio.sh   → exec phase0/reset-stremio.sh
scripts/launch-kodi.sh      → exec phase0/launch-kodi.sh
scripts/launch-launcher.sh  → see § 5.3
```

---

## 5. Deliverables

### 5.1 `src/launcher/` — Vite + vanilla TypeScript

- **Tiles:** Stremio · YouTube · Settings (3 tiles, horizontal or grid)
- **10-foot UI:** large text, high contrast, focus ring on selected tile
- **Navigation:** Arrow keys move focus; `Enter` / `Space` activates; wrap at edges
- **Activate:**
  - Stremio → `POST /api/launch/stremio`
  - YouTube → `POST /api/launch/kodi`
  - Settings → in-app subview (no new window)
- **Settings page:** Pi hostname/IP (fetch `/api/info` or hardcode from server), companion URL placeholder `https://<ip>:3001` (not live yet), note “API keys in Phase 2”
- **No React** — vanilla TS per DECISIONS.md
- Build output: `src/launcher/dist/`

### 5.2 `src/overlay/` — Vite + vanilla TS (minimal)

- Single **idle** badge, bottom-right, semi-transparent
- WebSocket client stub: connect to `ws://127.0.0.1:8765` optional; fail silently if down
- Build output: `src/overlay/dist/`
- Served at `/overlay/` or port `3002` (pick one approach; document in README)

### 5.3 `src/mango-ui-server/` — Python static + API

Minimal **stdlib-only** preferred (`http.server` + threading) or **FastAPI** if cleaner — agent's choice, but keep dependencies light for Pi.

**Required endpoints:**

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/` | Serve launcher `dist/index.html` |
| `GET` | `/overlay/` | Serve overlay dist |
| `GET` | `/api/info` | JSON: `{ "hostname", "ip", "launcher_port", "companion_port" }` |
| `POST` | `/api/launch/stremio` | Run `scripts/launch-stremio.sh` in background; return `{ "ok": true }` |
| `POST` | `/api/launch/kodi` | Run `scripts/launch-kodi.sh` in background |
| `POST` | `/api/launch/launcher` | Run `scripts/launch-launcher.sh` |

**Security:** Bind `127.0.0.1` only. No auth for Phase 1 (LAN TV box).

**Launch scripts must:** set `DISPLAY=:0`, `XAUTHORITY=/home/aman/.Xauthority`, `HOME=/home/aman`.

### 5.4 `scripts/launch-launcher.sh`

Behavior when returning home:

1. `bash scripts/phase0/stop-stremio-pad-bridge.sh` (if running)
2. `bash scripts/phase0/map-pro-controller.sh` (Kodi-style remapper for launcher keyboard nav)
3. Minimize or hide Kodi/Stremio windows (`wmctrl -r Stremio -b add,hidden` / `-r Kodi` — tune as needed)
4. Focus Chromium launcher: `wmctrl -xa chromium.Chromium` or match kiosk window class; fallback `xdotool search --class chromium windowactivate`
5. Do **not** kill Chromium kiosk

### 5.5 Openbox integration

Add `scripts/phase1/install-openbox-autostart.sh` that:

1. Installs `~/.config/openbox/autostart` entries (idempotent backup of existing)
2. Starts on login:
   - `bash ~/mango/scripts/phase1/start-mango-ui.sh` (new — builds if needed, starts Python server, starts Chromium kiosk + overlay window)
3. Openbox **keybind** in `~/.config/openbox/rc.xml` snippet or `rc.xml` patch:
   - `Escape` → `bash ~/mango/scripts/launch-launcher.sh`

Provide **manual install instructions** in `docs/PHASE1.md` if full automation is risky.

### 5.6 `scripts/phase1/start-mango-ui.sh`

- `cd ~/mango`
- Run `npm run build` in launcher/overlay if `dist/` missing (or always build — document)
- Start `python3 -m mango_ui_server` (or `scripts/serve-mango-ui.py`) on port **3000**
- Start Chromium:
  ```bash
  chromium --kiosk --app=http://127.0.0.1:3000/ &
  chromium --app=http://127.0.0.1:3000/overlay/ --window-position=... --always-on-top &
  ```
  Tune overlay window flags for bottom-right, no decorations (see DESIGN.md).

### 5.7 Documentation

Create **`docs/PHASE1.md`**:

- What was built
- Dev workflow on Mac (`npm install`, `npm run dev`, mock server)
- Deploy on Pi (`git pull`, `bash scripts/phase1/install-openbox-autostart.sh`)
- Verification checklist (§ 7 below)

Update **`AGENTS.md`**: point “next work” to PHASE1.md.

Update **`src/README.md`**: reflect actual layout.

---

## 6. Constraints (must follow)

- **Never** commit secrets, `keys/`, `node_modules/`, `.env`
- **Never** `git push --force` to main
- **Do not** change Phase 0 gamepad mappings without user approval
- **Do not** use Wayland APIs
- **Do not** bare `stremio &` — always `reset-stremio.sh`
- Match existing bash style: `set -euo pipefail`, comments, `SCRIPT_DIR`
- TypeScript strict mode
- Keep diff focused — no Phase 2 voice/orchestrator code

---

## 7. Verification (agent must run / document)

### On dev machine (Mac)

- [ ] `npm run build` in launcher + overlay succeeds
- [ ] Launcher keyboard nav works in browser (`npm run dev` + manual arrow/enter)
- [ ] Python server starts; `curl -X POST http://127.0.0.1:3000/api/launch/stremio` returns 200 (may fail script on Mac — OK)

### On Pi (`ssh aman@mango.local`)

```bash
cd ~/mango && git pull
# install node if missing: sudo apt install -y nodejs npm  (or document version)
bash scripts/phase1/start-mango-ui.sh   # or full autostart install
```

- [ ] Launcher visible fullscreen in Chromium
- [ ] D-pad moves tile focus; B selects
- [ ] Stremio tile → Stremio opens; gamepad works (B/Y)
- [ ] YouTube tile → Kodi opens; gamepad works
- [ ] Escape (or Y from remapper) → returns to launcher
- [ ] Overlay idle badge visible bottom-right
- [ ] `bash scripts/phase0/kill-stremio.sh` still works after testing

Document results in PR description or `docs/PHASE1.md` § Verification.

---

## 8. Suggested file tree (after implementation)

```
src/
  launcher/           package.json, vite.config.ts, index.html, src/main.ts, src/style.css
  overlay/            package.json, vite.config.ts, ...
  mango-ui-server/    __main__.py or serve.py, README
scripts/
  launch-stremio.sh
  launch-kodi.sh
  launch-launcher.sh
  phase1/
    start-mango-ui.sh
    install-openbox-autostart.sh
docs/
  PHASE1.md
  tasks/phase1-ui-shell.md   (this file)
```

---

## 9. Out of scope (defer)

- systemd units (`mango-launcher.service`) — stub OK in docs only
- Phone companion (`:3001`)
- Orchestrator / WebSocket voice
- mkcert / HTTPS
- Settings API key forms
- `xdg-open stremio://` deep links
- Polished visual design — functional 10-foot UI is enough

---

## 10. PR checklist

- [ ] All §5 deliverables present
- [ ] `docs/PHASE1.md` written
- [ ] No secrets in diff
- [ ] `.gitignore` includes `node_modules/`, `dist/` if not committed (prefer **commit dist** only if no Node on Pi — document choice; building on Pi is slow, consider CI or commit dist for Pi-only deploy)
- [ ] Single commit or small logical commits; message style matches repo

**Pi build note:** Pi may not have Node 20+. Either (a) document `npm run build` on Mac and commit `dist/`, or (b) add `scripts/phase1/build-ui.sh` and require one-time `apt install nodejs` on Pi. **Recommend (a)** for first PR: commit built `dist/` OR add clear build step to `start-mango-ui.sh` with version check.

---

## 11. Reference — gamepad (do not break)

```
      X
    Y   A
      B
```

| Button | evdev | Launcher (remapper) | Kodi | Stremio |
|--------|-------|---------------------|------|---------|
| D-pad | ABS_X/Y | arrows | arrows | bridge → arrows |
| B | 304 | Return | Return | Return |
| Y | 308 | Escape | Back | Back |

When Stremio runs, remapper stops; pad bridge takes over. When launcher returns, remapper restarts (`launch-launcher.sh`).
