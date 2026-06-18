# Implementation decisions

Locked choices. Update this file when changing them.

| Decision | Choice |
|----------|--------|
| LLM provider | Configurable — Anthropic + OpenAI in `config.yaml` |
| Stremio install | fragarray/stremio-rpi5 `.deb` |
| Display | X11 + Openbox (not Wayland) |
| TV navigation | 8BitDo Micro Bluetooth (no FLIRC) |
| Companion HTTPS | mkcert on Pi |
| UI stack | Vite + vanilla TypeScript |
| Build order | Phase 0 → launcher → voice → media tools |

## Gamepad (8BitDo Micro)

| Topic | Choice |
|-------|--------|
| Face layout | Clockwise from left: **Y · X · A · B** (see [`HARDWARE.md`](HARDWARE.md)) |
| Select / back | **B** = evdev `304` · **Y** = evdev `308` · A/X unmapped |
| Kodi | `input-remapper` preset `mango-tv` |
| Stremio | `stremio-pad-bridge.py` + hide `/dev/input/js*` — remapper does not work in Qt |
| D-pad quirk | Switch BT reports D-pad as ABS_X/ABS_Y, not hat axes |

## Implications

- Phase 0 sign-off before `src/` ([`phase0-checklist.md`](phase0-checklist.md))
- Daily launch: `scripts/phase0/tv.sh`
- Never commit `keys/`, `youtube-api.json`, Kodi RPC password
