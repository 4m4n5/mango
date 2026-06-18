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
| Home | `316`/`311` → Control+Alt+m → `launch-launcher.sh` |
| Kodi | `input-remapper` · Y → BackSpace |
| Stremio | `stremio-pad-bridge.py` · Y → Escape · hide `js*` |

## Phase 1 TV shell

| Topic | Choice |
|-------|--------|
| Launcher | Chromium kiosk `mango-launcher` · `serve.py` `:3000` |
| Overlay on Pi | Off (`MANGO_SKIP_OVERLAY=1`) |
| Hide launcher | Z-order below media app |
| YouTube | Kodi RPC · window id **10025** |
| Home | No `xdotool --sync` · `ir_resume_after_bridge` |

Ops: [`PHASE0.md`](PHASE0.md). Never commit API keys or RPC password.
