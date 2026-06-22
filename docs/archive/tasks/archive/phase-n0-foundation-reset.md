# Phase N0 — Foundation reset

**Status:** Not started  
**Branch:** `feat/native-experience`  
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md)  
**Codex prompt:** [`CODEX-phase-n0-prompt.md`](CODEX-phase-n0-prompt.md)  
**Prerequisite:** Phase 0–2 shipped on `main`; native architecture locked in [`NATIVE_EXPERIENCE.md`](../NATIVE_EXPERIENCE.md)

---

## 1. Objective

Take stock of the mango Pi stack, **remove every process and code path that does not serve the native mpv-forward architecture**, consolidate what remains into a **single principled base**, and prove on-device **compute headroom** for upcoming 4K mpv playback.

N0 is **refactor + ops + gates only**. No catalog features. No mock content pretending to be real.

### Success definition

An agent can SSH to `mango` (`aman@10.0.0.174`), run **one gate script**, and get:

- Documented inventory of processes and RAM **before/after** cleanup  
- **≤1 Chromium** at idle with voice enabled  
- Voice pipeline functional (PTT → HUD on TV) without overlay Chromium  
- Orchestrator **single WebSocket** listener (no race errors in log sample)  
- Launcher **does not** cold-start Stremio/Kodi on normal home screen  
- `baseline-metrics.json` artifact committed under `diag/sessions/` (gitignored JSON ok in `~/.cache/mango/` on Pi; script writes there)  
- Docs reflect new foreground contract  

---

## 2. Non-goals

| Out of scope | Deferred to |
|--------------|-------------|
| `catalog-service` implementation | N1 |
| Real metadata rails | N2 |
| mpv RD stream playback | N1 |
| yt-dlp YouTube | N6 |
| Removing Stremio `.deb` / Kodi packages | N7 |
| 4K tuning | N7 |
| Visual redesign of launcher | N2 (`ux-design-expert`) |

---

## 3. Inventory (mandatory first step)

Create **`docs/N0-INVENTORY.md`** (commit to repo) from Pi observation + code audit.

### 3.1 Process inventory template

Run on Pi and capture in inventory doc:

```bash
# Processes
ps aux --sort=-%mem | head -30
pgrep -a chromium || true
pgrep -a stremio || true
pgrep -a kodi || true
pgrep -a mpv || true
pgrep -a python3 | grep -E 'orchestrator|serve' || true
pgrep -a node || true
tmux ls 2>/dev/null || true
systemctl --user list-units 'mango*' --all

# Memory
free -h
vcgencmd measure_temp 2>/dev/null || true

# Network listeners
ss -tlnp | grep -E '3000|3001|8765|8766|8080' || true
```

### 3.2 Code inventory template

| Component | Path | N0 verdict |
|-----------|------|------------|
| Launcher | `src/launcher/` | **Keep** — strip mocks |
| Overlay app | `src/overlay/` | **Remove from runtime** — archive or delete |
| Shared voice HUD | `src/shared/voiceHud.ts` | **Merge or delete** if duplicate of launcher embed |
| Orchestrator | `src/orchestrator/` | **Keep** — consolidate WS |
| Companion | `src/companion/` | **Keep** |
| UI server | `src/mango-ui-server/serve.py` | **Keep** — trim dead routes |
| Mock catalog | `src/launcher/src/mock-catalog.ts` | **Remove** from production build |
| Whisper STT | `whisper_stt.py` | **Keep** optional fallback only |
| Phase 2 overlay scripts | `ensure-tv-overlay.sh`, `present-overlay.sh` | **Remove** from default stack |
| Stremio launch tiles | launcher `home.ts` Apps rail | **Replace** with Settings-only or hidden Advanced |

---

## 4. Deliverables

### D1 — Runtime cleanup (Pi behavior)

| ID | Task | Acceptance |
|----|------|------------|
| D1.1 | **Never start overlay Chromium** when voice enabled | `pgrep -f mango-overlay` empty after `mango-stack.sh start` |
| D1.2 | Remove `ensure-tv-overlay.sh` from `start-voice-stack.sh` | Voice start does not spawn overlay |
| D1.3 | Default `MANGO_SKIP_OVERLAY=1` permanently in Pi `voice.env` | Documented in `PHASE2.md` |
| D1.4 | Launcher home **no Stremio/Kodi cold launch** on boot | Home shows mango shell + voice; Apps rail removed or collapsed to Settings / Advanced fallback |
| D1.5 | Stremio/Kodi **not running at idle** after stack start | `pgrep stremio` and `pgrep kodi` empty |
| D1.6 | Single stack entrypoint | `scripts/mango-stack.sh {start,stop,status,restart}` replaces ad-hoc tmux-only flow for daily ops |

### D2 — Orchestrator consolidation

| ID | Task | Acceptance |
|----|------|------------|
| D2.1 | **One uvicorn** process for WebSocket hub | No second thread binding `:8766` on duplicate app instance |
| D2.2 | Phone WSS `:8765` + TV HUD loopback both work | `verify-voice-ready.sh` passes; launcher HUD connects |
| D2.3 | No `WebSocket is not connected` race in 60s log sample | Grep orchestrator log after 10 synthetic WS connects |
| D2.4 | Skip Piper import/warmup when `tts_enabled: false` | Orchestrator boot &lt; 2s faster; log shows skip |

**Recommended approach:** single FastAPI app; TV clients use `ws://127.0.0.1:8765/ws` on a **second bind** via one ASGI server with multiple listeners, OR reverse proxy on loopback — **not** two threads sharing session dict.

### D3 — Launcher honesty

| ID | Task | Acceptance |
|----|------|------------|
| D3.1 | Delete or gate `mock-catalog.ts` | Production build has no fake title strings |
| D3.2 | Home shows **empty rails state** + copy: "catalog connects in N1" | No misleading posters |
| D3.3 | Keep `focus.ts` + rail layout scaffolding | Keyboard nav still works on Settings / placeholder |
| D3.4 | Voice HUD unchanged functionally | PTT still updates embedded HUD |

### D4 — Overlay codebase

| ID | Task | Acceptance |
|----|------|------------|
| D4.1 | Remove `src/overlay/` from build/start scripts OR move to `archive/overlay/` | `start-mango-ui.sh` does not build overlay |
| D4.2 | Remove `/overlay/` route from `serve.py` if unused | Or 410 stub with comment |
| D4.3 | Delete duplicate `src/shared/voiceHud.ts` if launcher owns HUD | One source of truth |

### D5 — Scripts & gates

| ID | Task | Acceptance |
|----|------|------------|
| D5.1 | `scripts/diag/baseline-metrics.sh` | Writes JSON snapshot: timestamp, `free -h`, chromium count, RSS sum, listeners, git sha |
| D5.2 | `scripts/phase-n0/gate-n0.sh` | Runs baseline + verify-tv + verify-voice-ready + N0-specific asserts |
| D5.3 | Update `scripts/pi-pre-couch-gate.sh` | Check `origin/feat/native-experience` when on that branch; N0 asserts |
| D5.4 | `scripts/phase-n0/capture-tv.sh` | Optional: `scrot` or `import -window root` screenshot to `~/.cache/mango/gate-screenshots/` |

### D6 — Documentation

| ID | Task | Acceptance |
|----|------|------------|
| D6.1 | `docs/FOREGROUND.md` | launcher \| mpv \| fallback_stremio table + diagrams |
| D6.2 | `docs/N0-INVENTORY.md` | Before/after metrics filled from Pi |
| D6.3 | Update `DECISIONS.md` | Native playback row; overlay removed; stack entrypoint |
| D6.4 | Update `AGENTS.md` | N0 gate commands; branch deploy |
| D6.5 | Update `PHASE2.md` | Overlay Chromium deprecated; single WS |
| D6.6 | `DESIGN.md` banner | Points to `NATIVE_EXPERIENCE.md` — full rewrite later |

### D7 — Fallback preservation

Keep but **namespace** legacy scripts:

```
scripts/fallback/launch-stremio.sh   # symlink or thin wrapper to existing
scripts/fallback/launch-kodi.sh
```

Set `MANGO_FALLBACK_STREMIO=1` / `MANGO_LEGACY_YOUTUBE=1` env to enable Advanced tile in launcher (off by default).

---

## 5. Validation gates (agent runs on Pi — mandatory)

**Do not hand off to human couch until `gate-n0.sh` exits 0** (or documents waivers in `N0-INVENTORY.md`).

### Gate N0-A — Baseline metrics

```bash
cd ~/mango && git pull
bash scripts/diag/baseline-metrics.sh --label before   # if before cleanup not captured, skip
# ... apply N0 changes ...
bash scripts/diag/baseline-metrics.sh --label after-n0
```

**Assert (after):**

| Metric | Threshold |
|--------|-----------|
| `chromium_process_count` | ≤ 1 |
| `stremio_process_count` | 0 |
| `kodi_process_count` | 0 |
| `overlay_chromium` | 0 |
| `mem_available_mb` | ≥ 3500 (warn if lower; fail if &lt; 2500) |

### Gate N0-B — TV shell

```bash
bash scripts/phase-n0/gate-n0.sh
```

Includes existing `verify-tv.sh` + launcher HTTP 200 + pad service.

### Gate N0-C — Voice

```bash
bash scripts/phase2/verify-voice-ready.sh
```

All checks pass. Launcher HUD visible state reachable (WS connect from loopback).

### Gate N0-D — Orchestrator stability

```bash
# 20 rapid WS connect/disconnect from loopback — no traceback in log
python3 scripts/phase-n0/ws-stress.py --url ws://127.0.0.1:8765/ws --count 20
tail -100 ~/.cache/mango/orchestrator.log | grep -i 'not connected' && exit 1 || true
```

Implement `ws-stress.py` minimal.

### Gate N0-E — Network diagnostics

```bash
curl -sf --max-time 3 http://127.0.0.1:3000/api/health
curl -skf --max-time 3 https://127.0.0.1:8765/health
curl -skf --max-time 3 https://127.0.0.1:3001/ | head -1
# External (optional warn): curl -sf --max-time 5 https://api.deepgram.com/ -o /dev/null || warn
```

### Gate N0-F — Visual capture (best effort)

```bash
bash scripts/phase-n0/capture-tv.sh launcher-idle
bash scripts/phase-n0/capture-tv.sh voice-hud-mock  # optional: trigger mock status via WS
```

Store paths in gate output. If `scrot` missing, `apt-get install scrot` on Pi (document in inventory).

### Gate N0-G — Regression note

**N0-C2** (manual couch, document in inventory):

1. Cold boot or stack restart  
2. Launcher visible — **no wallpaper**  
3. ⌂ from launcher noop  
4. Open Settings → Back → home  
5. Voice stack: phone PTT one turn → HUD on TV  
6. **No** Stremio window appears during 1–5  

---

## 6. File change checklist

```
scripts/mango-stack.sh                    NEW
scripts/diag/baseline-metrics.sh          NEW
scripts/phase-n0/gate-n0.sh               NEW
scripts/phase-n0/ws-stress.py              NEW
scripts/phase-n0/capture-tv.sh            NEW
scripts/phase2/start-voice-stack.sh       EDIT — no overlay
scripts/phase1/start-mango-ui.sh          EDIT — no overlay build/start
src/orchestrator/orchestrator/main.py     EDIT — single WS
src/orchestrator/orchestrator/warmup.py   EDIT — conditional Piper
src/launcher/src/home.ts                  EDIT — no mock rails
src/launcher/src/mock-catalog.ts          DELETE or dev-only
src/overlay/                              ARCHIVE or DELETE
docs/FOREGROUND.md                        NEW
docs/N0-INVENTORY.md                      NEW (filled on Pi)
docs/NATIVE_ROADMAP.md                    EXISTS
pi-pre-couch-gate.sh                      EDIT
```

---

## 7. Deploy protocol

1. Mac: commit + push `feat/native-experience`  
2. Pi: `cd ~/mango && git fetch && git checkout feat/native-experience && git pull`  
3. Pi: `bash scripts/mango-stack.sh restart`  
4. Pi: `bash scripts/phase-n0/gate-n0.sh`  
5. Attach `baseline-metrics` JSON + screenshot paths to PR or `N0-INVENTORY.md`  

**Never rsync.** Git only per `AGENTS.md`.

---

## 8. Risks & waivers

| Risk | Mitigation |
|------|------------|
| Single WS breaks phone TLS + TV plain | Test both clients in gate; document bind addrs |
| Removing Kodi tile blocks YouTube until N6 | `MANGO_LEGACY_YOUTUBE=1` documents interim |
| Voice users rely on overlay z-order | Launcher embed HUD is canonical since Phase 2 |
| Gate fails on `main` sync check | Branch-aware gate per §5 |

Waivers must be **explicit** in `N0-INVENTORY.md` with owner sign-off line.

---

## 9. Exit criteria (checkboxes)

- [ ] `N0-INVENTORY.md` committed with before/after metrics  
- [ ] `gate-n0.sh` exits 0 on Pi  
- [ ] ≤1 Chromium at idle; 0 overlay; 0 Stremio/Kodi at idle  
- [ ] `verify-voice-ready.sh` passes  
- [ ] No mock catalog in production launcher  
- [ ] `FOREGROUND.md` + `DECISIONS.md` updated  
- [ ] `mango-stack.sh` documented in `AGENTS.md`  
- [ ] N0-C2 couch note recorded  

---

## 10. Handoff to N1

N1 agent reads:

- `N0-INVENTORY.md` — measured headroom  
- `FOREGROUND.md` — mpv slot prepared  
- `NATIVE_EXPERIENCE.md` — catalog-service spec  

First N1 spike: **one Cinemeta ID → Torrentio/aiostreams stream → mpv play**.
