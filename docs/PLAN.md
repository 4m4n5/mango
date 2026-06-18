# mango — Implementation Plan

**Hardware:** Pi 5 8GB · 128GB SD · 8BitDo Micro · phone · TV  
**Status:** **Phase 0 + 1 + 1.5 complete on device** (`mango`, 2026-06). **Phase 2 — voice pipeline** in progress.  
**Canonical ops:** [`PHASE0.md`](PHASE0.md) · [`PHASE1.md`](PHASE1.md) · [`PHASE2.md`](PHASE2.md) · **V1 spec:** [`DESIGN.md`](DESIGN.md)

---

## Current implementation (accurate)

```
Pi 5 · Pi OS Desktop · X11 + Openbox
├── serve.py :3000          launcher static + POST /api/launch/*
├── Chromium kiosk          class mango-launcher
├── mango-tv-pad.py         single pad owner (launcher + Stremio + Kodi)
├── Stremio desktop         hidden/shown via hide-media + present-stremio
├── Kodi + YouTube addon    JSON-RPC · window 10025 = Videos
└── scripts/diag/           couch-test harness (alpha-test.sh)
```

| Layer | Shipped | Not yet |
|-------|---------|---------|
| Launcher tiles + API | ✓ | Settings API keys UI |
| App switch + ⌂ home | ✓ | — |
| Pad routing (B/Y/⌂/D-pad) | ✓ | — |
| Overlay Chromium | off on Pi (`MANGO_SKIP_OVERLAY=1`) | Phase 2 — re-enable |
| Orchestrator / voice | scaffold | Phase 2 |
| Companion PWA | scaffold | Phase 2 |
| stremio-service | — | Phase 3 |

**Repo layout (today):**

```
src/launcher/          Vite + TS tile UI
src/overlay/           badge UI (WS → orchestrator :8765)
src/companion/         phone PWA (HTTPS :3001)
src/orchestrator/      FastAPI voice hub (:8765)
src/mango-ui-server/   serve.py
scripts/launch-*.sh    API wrappers (refocus + cold launch)
scripts/phase0/        Kodi, Stremio, pad, present-*
scripts/phase1/        UI bring-up, systemd units
scripts/diag/          alpha session logging
scripts/lib/           present-*, hide-media, mango-window
```

---

## Build order (revised)

```
Phase 0   Pi OS + X11 + gamepad + Kodi + Stremio          ✓ complete
Phase 1   Launcher + app switching + pad router           ✓ complete
Phase 1.5 Launch polish — couch acceptance                ✓ complete (2026-06-18)
Phase 2   Phone companion + voice pipeline (PTT → LLM → TTS)   ← NOW
Phase 3   Media tools (stremio-service, Kodi RPC, focus routing)
Phase 4   Stretch (TMDB, recap, Kodi subtitles)
Phase 5   install.sh + first-boot wizard + long-tail polish
```

**Phase 1.5 signed off** — session `20260618-013528`, C2 confirmed. Phase 2 started.

---

## Phase 1.5 — Launch polish ✓ (archive)

**Goal:** World-class couch UX — no wallpaper, predictable switching, sub-300 ms home.

**Sign-off:** [`phase0-checklist.md`](phase0-checklist.md) · diag `20260618-013528`

### Couch acceptance matrix

| # | Flow | Pass |
|---|------|------|
| C1 | Launcher → Stremio → ⌂ → Stremio (refocus) | ✓ |
| C2 | Launcher → Stremio → ⌂ → YouTube → ⌂ → Stremio | ✓ |
| C3 | Y-back single press inside Stremio title | ✓ (subjective) |
| C4 | Y on Stremio home — no window-mode jitter | ✓ |
| C5 | 30 min idle — no `verify_tv repair_server` | deferred |
| C6 | Double-tap Stremio tile — always opens | ✓ (subjective) |

Orchestration rules remain locked in [`DECISIONS.md`](DECISIONS.md) and [`PHASE0.md`](PHASE0.md).

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
- D-pad sends key events (wire in 2.4)
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
- Re-enable overlay on Pi when voice ships (`MANGO_SKIP_OVERLAY=0`)

**Exit criteria:** General chat works from couch; overlay reflects state; TTS on TV speakers.

---

## Phase 3 — Media tools (~2 weeks)

**Goal:** Voice controls Stremio and YouTube; session memory; diagnostics.

### 3.1 `src/stremio-service/` (Node + Express)

- Wrap `@stremio/stremio-core-web` or HTTP bridge to stremio-core
- Endpoints: `/search`, `/play` (returns deep link), `/library`, `/recommend`
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

**Exit criteria:** DESIGN.md Core #3–#9.

---

## Phase 4 — Stretch (~1 week)

- TMDB API key + `get_playback_context` / `recap` / `ask_about_content`
- Kodi-only subtitle fetch/switch
- Stremio context via library sync (approximate)
- Voice watch-later verification in desktop app

**Exit criteria:** DESIGN.md Stretch #11–#14.

---

## Phase 5 — Polish (ongoing)

- `scripts/install.sh` — automate Phase 0 deps + systemd + mkcert
- First-boot wizard in Settings (LLM key, Kodi pass, companion QR)
- Pin Kodi YouTube addon version in docs
- stremio-web fallback script if .deb breaks on OS update
- HDMI-CEC one-touch play (V2 per DESIGN.md)

---

## Module dependency graph (target)

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

**Today:** only launcher + Stremio + Kodi + pad + `serve.py` are wired.

---

## Risk register (updated)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phone mic blocked on HTTP | **High** | HTTPS via mkcert in Phase 2 |
| Stremio .deb breaks on apt upgrade | Medium | Hold package; document version |
| **App switch kills sibling** | **High** | **hide-not-kill** — never `killall` on tile switch |
| Refocus fail → wallpaper | **High** | Restore launcher on fail; orphan window cleanup |
| Wayland left on by default | High | Phase 0 — verify `x11` |
| RAM: Chromium + Stremio + Kodi warm | Medium | Hide background apps; one foreground |
| stremio:// deep links don't work | Medium | xdotool keyboard search fallback |
| YouTube addon API change | Medium | Pin version; diagnostics |
| False watchdog restart | Medium | `tv_pad` health; no repair on input mismatch |

---

## References

- [PHASE0.md](PHASE0.md) — ops, architecture, troubleshooting
- [PHASE1.md](PHASE1.md) — launcher API
- [DESIGN.md](DESIGN.md) — V1 scope & success criteria
- [DECISIONS.md](DECISIONS.md) — locked choices
- [HARDWARE.md](HARDWARE.md) — 8BitDo layout
- `$mango-tv-box-expert` — launch polish KB
