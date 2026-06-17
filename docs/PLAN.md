# mango — Implementation Plan

**Hardware on hand:** Pi 5 8GB (CanaKit) · 128GB SD · USB gamepad (D-pad + receiver) · phone · TV  
**No FLIRC** — gamepad is primary TV navigation; phone is mic + backup remote  
**Code status:** Spec only — no `src/` yet  
**Target:** V1 Core per [DESIGN.md](DESIGN.md), then Stretch

---

## Executive summary

Build order: **prove the Pi as a streaming box first**, then **layer AI on top**. Do not start with the orchestrator — start with apps, input, and display stack on real hardware.

```
Phase 0  Pi OS + X11 + gamepad + Kodi + Stremio     (manual, on device)
Phase 1  Launcher + app switching + overlay shell
Phase 2  Phone companion + voice pipeline (PTT → LLM → TTS)
Phase 3  Media tools (stremio-service, Kodi RPC, focus routing)
Phase 4  Stretch (TMDB, recap, Kodi subtitles)
Phase 5  install.sh + first-boot wizard + polish
```

Estimated calendar: **6–8 weeks part-time** (Phase 0–3 ≈ 4–5 weeks).

---

## Your hardware → plan adjustments

| Design doc | Your setup | Adjustment |
|------------|------------|------------|
| FLIRC or gamepad | Gamepad only | Gamepad = primary couch remote; map via `jstest` / `evdev` → X11 keys |
| 64GB+ SD | 128GB | Plenty for OS + Whisper/Piper models + Kodi cache; no NVMe needed for V1 |
| Ethernet recommended | TBD | WiFi OK; note in diagnostics if streaming buffers |
| Phone mic | Assumed | **Must solve HTTPS** for `getUserMedia` on LAN (see § Phone companion) |

---

## Phase 0 — Device bring-up (on Pi, ~3–4 days)

**Goal:** Pi boots to desktop, gamepad navigates Kodi YouTube and Stremio, no custom code.

### 0.1 Flash & base OS

1. Flash **Raspberry Pi OS Desktop 64-bit** (Bookworm or newer) to 128GB SD via Raspberry Pi Imager.
2. First boot: set hostname `mango`, enable SSH, set user password, connect WiFi or Ethernet.
3. Full update: `sudo apt update && sudo apt full-upgrade -y`
4. **Switch to X11** (required for xdotool overlay + key injection):
   ```bash
   sudo raspi-config
   # Advanced Options → Wayland → X11 Openbox → reboot
   echo $XDG_SESSION_TYPE   # must print x11
   ```

### 0.2 Gamepad

1. Plug USB receiver; verify: `ls /dev/input/js*` and `jstest /dev/input/js0`
2. Install mapping tool: `sudo apt install joystick antimicrox` (or `xboxdrv` if needed)
3. Map D-pad → arrow keys, A → Return, B → Escape, Start → Super (optional)
4. Document button map in `/etc/mango/gamepad.md` (local only)
5. **Exit criteria:** gamepad navigates `lxterminal` and file manager

### 0.3 Kodi + YouTube

1. `sudo apt install kodi`
2. Install `plugin.video.youtube` from official Kodi repo (pin version when one works)
3. Settings → Services → Control → enable **Web server** + **Allow remote control via HTTP**
4. Set HTTP port `8080`, username/password → save to local secrets file
5. **Exit criteria:** gamepad browses YouTube, plays a video, JSON-RPC responds:
   ```bash
   curl -u user:pass 'http://127.0.0.1:8080/jsonrpc' \
     -d '{"jsonrpc":"2.0","id":1,"method":"JSONRPC.Ping"}'
   ```

### 0.4 Stremio (ARM64 native)

**Primary path:** [fragarray/stremio-rpi5](https://github.com/fragarray/stremio-rpi5) `.deb` (Pi 5 tested, HW decode).

1. Download latest `stremio_*_arm64.deb` from Releases
2. `sudo apt install ./stremio_*.deb`
3. Launch `stremio`, log in, install addons manually (e.g. Torrentio — user choice)
4. Test `stremio://` deep link from terminal:
   ```bash
   xdg-open 'stremio:///detail/movie/tt15239678'   # example; adjust ID
   ```
5. **Fallback if .deb fails:** stremio-web in Chromium fullscreen (document breakage)

**Exit criteria:** gamepad navigates Stremio, plays content, deep link opens correct title.

### 0.5 Phone → Pi smoke tests (no custom code)

1. Note Pi IP: `hostname -I`
2. Install deps for later: `sudo apt install python3-pip python3-venv ffmpeg`
3. Optional: test Whisper CLI with a WAV file from phone recording
4. **Exit criteria:** Pi IP reachable from phone browser; Stremio + Kodi work for 30+ min without throttle (`vcgencmd measure_temp`)

### Phase 0 deliverable

Checklist file `docs/phase0-checklist.md` (create when starting) — all items green before writing app code.

---

## Phase 1 — UI shell (~1 week)

**Goal:** Boot to our launcher; launch Stremio/Kodi; Back returns home; overlay visible.

### 1.1 Tech choices (see QA decisions)

| Piece | Recommendation | Rationale |
|-------|----------------|-----------|
| Launcher | **Vite + vanilla TS** or small React | Fast 10-foot UI; tile focus with keyboard events |
| App control | **shell scripts + wmctrl/xdotool** | Launch/kill/focus Stremio & Kodi |
| Overlay | **Second Chromium** `--app=http://localhost:3002` `--always-on-top` | Simplest on X11 Openbox |
| Static server | **Python `http.server` or FastAPI** | Serve launcher + overlay + companion from one process later |

### 1.2 `src/launcher/`

- Fullscreen kiosk: `chromium --kiosk http://127.0.0.1:3000`
- Tiles: Stremio · YouTube · Settings
- Keyboard: arrows move focus, Enter activates
- Settings page: show Pi IP, companion URL, placeholder for API keys

### 1.3 App launcher scripts (`scripts/launch-*.sh`)

```
launch-stremio.sh   → wmctrl -F Stremio || stremio &
launch-kodi.sh      → kodi --standalone &
launch-launcher.sh  → focus chromium kiosk window
```

- **Back (Escape):** global Openbox keybind → `launch-launcher.sh`
- Hide launcher window when app opens (minimize, don't kill)

### 1.4 `src/overlay/`

- Minimal page: state badge (idle only for now)
- WebSocket client → orchestrator (stub in Phase 1)
- Position: bottom-right, transparent background, no window decorations

### 1.5 systemd (initial)

- `mango-launcher.service` — X11 session autostart Openbox + chromium kiosk + overlay
- Kodi/Stremio **not** systemd — on-demand from launcher

**Exit criteria:** Design doc success criteria #1, #2, #10 (gamepad only, no voice).

---

## Phase 2 — Voice pipeline (~1 week)

**Goal:** Phone PTT → transcript → LLM reply → TTS on TV.

### 2.1 `src/orchestrator/` (Python + FastAPI)

```
orchestrator/
  main.py           # FastAPI app, WebSocket hub
  audio/
    ingest.py       # receive PCM from phone
    whisper_stt.py  # faster-whisper
    piper_tts.py    # subprocess piper → aplay
  llm/
    provider.py     # Anthropic/OpenAI adapter
    tools.py        # schema only in Phase 2
  session.py        # conversation history
  config.py         # load /etc/mango/config.yaml
```

### 2.2 Phone companion HTTPS (critical)

Mobile browsers require **secure context** for microphone on non-localhost URLs.

| Option | Effort | Recommendation |
|--------|--------|----------------|
| mkcert + self-signed cert on Pi | Low | **V1 approach** — trust cert once on phone |
| Tailscale HTTPS | Medium | Good if already using Tailscale |
| HTTP localhost only | N/A | Doesn't work from phone to Pi |

Companion served at `https://<pi-ip>:3001` after cert setup.

### 2.3 `src/companion/`

- PWA: hold-to-talk button (touchstart/touchend)
- Stream audio chunks over WebSocket to orchestrator
- D-pad sends key events (Phase 1 can stub; wire in 2.4)
- Show transcript + connection status

### 2.4 Audio flow

```
Phone mic → WebSocket (binary PCM 16kHz mono)
  → buffer while PTT held
  → on release: faster-whisper base.en
  → LLM chat (no tools yet)
  → Piper stream first sentence to HDMI sink
  → duck PulseAudio/PipeWire sink by 40% during PTT
```

### 2.5 Overlay integration

- States: idle → listening → thinking → speaking
- Toast last assistant reply (8s)

**Exit criteria:** General chat works from couch; overlay reflects state; TTS on TV speakers.

---

## Phase 3 — Media tools (~2 weeks)

**Goal:** Voice controls Stremio and YouTube; session memory; diagnostics.

### 3.1 `src/stremio-service/` (Node + Express)

- Wrap `@stremio/stremio-core-web` or HTTP bridge to stremio-core
- Endpoints: `/search`, `/play` (returns deep link), `/library`, `/recommend` (catalog + LLM pre-rank in orchestrator)
- Auth: read token from `/etc/mango/stremio.json` (export from desktop login — document manual step)

### 3.2 `src/adapters/`

| Adapter | Responsibility |
|---------|----------------|
| `kodi_rpc.py` | search, play, player_get, player_command |
| `stremio_deeplink.py` | build `stremio://` URLs, xdg-open |
| `window_focus.py` | wmctrl active window → `stremio` \| `kodi` \| `launcher` |
| `tmdb.py` | Stretch — episode metadata |

### 3.3 LLM tool calling

- Register tools from DESIGN.md (Core subset first)
- System prompt: prefer tools, keep `last_candidates` in session
- `play_youtube` → `launch_app(youtube)` + Kodi `Player.Open`
- `play_stremio` → `launch_app(stremio)` + deep link
- `player_command` → route by `focus_app`

### 3.4 Companion remote (wire D-pad)

- WebSocket `key` events → orchestrator → `xdotool key Up` etc.
- Transport buttons → Kodi RPC or media keys

### 3.5 Self-diagnostics tool

- `vcgencmd measure_temp`, `df`, `curl` Kodi ping, stremio-service health, companion WS test

**Exit criteria:** Design doc Core #3–#9.

---

## Phase 4 — Stretch (~1 week)

- TMDB API key + `get_playback_context` / `recap` / `ask_about_content`
- Kodi-only subtitle fetch/switch
- Stremio context via library sync (approximate)
- Voice watch-later verification in desktop app

**Exit criteria:** Design doc Stretch #11–#14.

---

## Phase 5 — Polish (ongoing)

- `scripts/install.sh` — automate Phase 0 deps + systemd + mkcert
- First-boot wizard in Settings (LLM key, Kodi pass, companion QR)
- Pin Kodi YouTube addon version in docs
- stremio-web fallback script if .deb breaks on OS update

---

## Module dependency graph

```
                    ┌─────────────┐
                    │  companion  │─── HTTPS :3001
                    └──────┬──────┘
                           │ WS audio + keys
                    ┌──────▼──────┐
                    │ orchestrator│─── :8765
                    └──┬───┬───┬──┘
           ┌───────────┘   │   └───────────┐
           ▼               ▼               ▼
    stremio-service    kodi RPC      window_focus
           │               │               │
           ▼               ▼               ▼
    stremio desktop     kodi          launcher
           └───────────────┴───────────────┘
                           │
                      overlay (WS)
```

---

## QA decisions (resolve before Phase 1 code)

See interactive prompts in chat — summary recorded in `docs/DECISIONS.md` after answers.

| # | Question | Default if no answer |
|---|----------|----------------------|
| 1 | LLM provider | Anthropic (configurable) |
| 2 | Stremio install | fragarray .deb first |
| 3 | Companion HTTPS | mkcert on Pi |
| 4 | Launcher framework | Vite + vanilla TS |
| 5 | Stretch timing | After Core passes |
| 6 | Network | WiFi OK for V1 |
| 7 | Gamepad mapping | antimicrox profiles |

---

## Risk register (pre-code)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phone mic blocked on HTTP | **High** | HTTPS via mkcert in Phase 2 |
| Stremio .deb breaks on apt upgrade | Medium | Hold package; document version |
| Gamepad not recognized | Medium | `jstest`, try different USB port, antimicrox |
| Wayland left on by default | High | Phase 0 step 0.1 — verify x11 |
| 8GB RAM with Chromium + Stremio + Kodi | Medium | One app foreground; kill Kodi when in Stremio |
| stremio:// deep links don't work | Medium | xdotool keyboard search fallback |
| YouTube addon API change | Medium | Pin version; diagnostics |

---

## What we build first (sprint 1)

**No orchestrator yet.** Week 1 sprint:

1. Phase 0 checklist on real Pi (you + agent guiding commands)
2. `scripts/launch-{stremio,kodi,launcher}.sh`
3. Minimal launcher static page + chromium kiosk autostart
4. Openbox keybind: Escape → launcher, gamepad verified

**First PR:** `phase-0-checklist.md` + launcher skeleton + launch scripts.

---

## References

- [DESIGN.md](DESIGN.md) — scope & success criteria
- [HARDWARE.md](HARDWARE.md) — update after Phase 0 (gamepad-only)
- [fragarray/stremio-rpi5](https://github.com/fragarray/stremio-rpi5) — Stremio for Pi 5
- [config.example.yaml](../config/config.example.yaml)
