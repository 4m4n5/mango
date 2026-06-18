# Implementation decisions

Locked choices. Update when changing behavior.

| Decision | Choice |
|----------|--------|
| LLM provider | Configurable — Anthropic + OpenAI in `config.yaml` |
| Stremio install | fragarray/stremio-rpi5 `.deb` |
| Display | X11 + Openbox (not Wayland) |
| TV navigation | 8BitDo Micro Bluetooth |
| UI stack | Vite + vanilla TypeScript |

## Gamepad

| Topic | Choice |
|-------|--------|
| Layout | **Y · X · A · B** clockwise from left ([`HARDWARE.md`](HARDWARE.md)) |
| Select / back | **B**=`304` · **Y**=`308` |
| Home | `316`/`311` → `launch-launcher.sh` directly (`mango-tv-pad.py`) |
| Pad owner | **`mango-tv-pad.py`** — single owner for launcher + Stremio + Kodi; never stop on app switch |
| Fallback | `input-remapper` `mango-tv` only if pad fails to grab |
| Stremio Y-back | Escape to focused window — **no** `windowactivate` before key |

## Phase 1 TV shell

| Topic | Choice |
|-------|--------|
| Launcher | Chromium kiosk `mango-launcher` · `serve.py` `:3000` |
| Overlay on Pi | Off (`MANGO_SKIP_OVERLAY=1`) |
| Hide launcher | Z-order below media app (`mango-window.sh hide`) |
| Hide sibling apps | **`hide-media.sh`** — never `killall` on tile switch |
| Refocus failure | Always `mango-window.sh show` — restore launcher |
| Launch lock | `flock` per script — **release before** background child |
| API debounce | Media launches always queued; launcher home debounced 2 s |
| Launcher client | No debounce on Stremio/YouTube tiles |
| YouTube | Kodi RPC · window id **10025** |
| Home | No `xdotool --sync` · pad stays grabbed (`MANGO_SKIP_REMAPPER=1`) |
| Stremio present-after-back | `present-stremio.sh --after-back` — no F11 toggle |
| Health | `tv_pad` OR `input_remapper=active` — never false-fail watchdog |

## Native experience (branch)

| Topic | Choice |
|-------|--------|
| Product direction | **Option 2** — mango-owned TV-first UX; Stremio/Kodi = playback engines |
| Branch | `feat/native-experience` |
| Doc | [`NATIVE_EXPERIENCE.md`](NATIVE_EXPERIENCE.md) |

Ops: [`PHASE0.md`](PHASE0.md). Never commit API keys or RPC password.

## Phase 2 voice

| Topic | Choice |
|-------|--------|
| Orchestrator | FastAPI + uvicorn · WS `/ws` · HTTP `/health` · port **8765** |
| Companion | Vite PWA · port **3001** · **HTTPS required** for phone mic |
| TLS | **Approach A** — mkcert HTTPS companion + WSS orchestrator; trust root CA on phone once |
| Orchestrator bind | `0.0.0.0:8765` on Pi for phone WSS; use `MANGO_ORCH_TLS=1` |
| Overlay WS | Phone: `wss://<pi>:8765/ws` · TV HUD: `ws://127.0.0.1:8766/ws` |
| Voice state | Orchestrator owns idle/listening/thinking/speaking; errors restore idle |
| Audio payload | `ptt_end.pcm_b64` = 16 kHz mono int16 LE PCM, max 30s |
| Phase 2 scope | Chat only — media tools in Native UX N1 |
| STT | **Deepgram** `nova-3` + `multi` + keyterms; `stt.key` in `/etc/mango/` |
| TTS on Pi | **Off** — `audio.tts_enabled: false` · `MANGO_TTS_DISABLED=1` until HDMI speaker |
| TV HUD | **Launcher-embedded** `voice-hud.ts` — primary surface on kiosk |
| Loopback WS | Port **8766** plain WS for TV clients (mkcert WSS fails in overlay Chromium) |
| Overlay Chromium | Optional secondary HUD — candidate for removal on native UX branch |
| Multi-turn PTT | Allowed while reply visible; block only when `ptt_owner` or voice lock held |
| Reply dwell | `overlay_reply_seconds: 10` — HUD dismisses; phone keeps full history |
