# Foreground contract — native mango

**Status:** N0 contract. This supersedes the Phase 1 daily-use
`launcher | stremio | kodi` contract for `feat/native-experience`.

## Authority

`mango-stack.sh` owns the base stack. At idle it starts:

- Chromium launcher kiosk (`mango-launcher`) on `:3000`
- `serve.py` API on `:3000`
- `mango-tv-pad.py`
- Voice orchestrator and companion when `MANGO_VOICE=1`

It does **not** start Stremio, Kodi, mpv, or overlay Chromium at idle.

## States

| State | Visible | Hidden / stopped | Input owner | Health signal | Home behavior |
|-------|---------|------------------|-------------|---------------|---------------|
| `launcher` | Chromium `mango-launcher` | mpv stopped; Stremio/Kodi stopped unless explicit fallback | `mango-tv-pad.py` | `/api/health` ok; `tv_pad` or remapper fallback | noop / present launcher |
| `mpv` | mpv fullscreen (N1+) | launcher below or hidden | `mango-tv-pad.py` → mpv IPC (N1+) | mpv IPC + launcher server alive | stop/pause mpv, present launcher <300 ms |
| `fallback_stremio` | Stremio desktop | launcher below | `mango-tv-pad.py` → Stremio | fallback process live; launcher server alive | present launcher; hide/stop fallback on stack restart |

Kodi/YouTube is a legacy fallback only via `MANGO_LEGACY_YOUTUBE=1` until N6.

## Input Routing

| Foreground | D-pad | B (`304`) | Y (`308`) | Home (`316`/`311`) |
|------------|-------|-----------|-----------|--------------------|
| `launcher` | launcher focus grid | select focused card | settings back / no-op on home | no-op / present launcher |
| `mpv` | mpv IPC (N1+) | play/pause or select OSD (N1+) | back/OSD close (N1+) | stop/pause mpv → launcher |
| `fallback_stremio` | Stremio key routing | select | Escape | launcher |

Gamepad evdev codes are locked in `HARDWARE.md`.

## Launch / Refocus

```text
mango-stack start
  -> stop idle Stremio/Kodi/mpv remnants
  -> start serve.py + one Chromium launcher
  -> start voice only when MANGO_VOICE=1
  -> never start overlay Chromium

N1 play
  -> resolve stream
  -> present mpv fullscreen
  -> keep launcher recoverable underneath
  -> Home stops/pauses mpv and presents launcher

fallback
  -> only when MANGO_FALLBACK_STREMIO=1 or MANGO_LEGACY_YOUTUBE=1
  -> direct wrapper/API launch
  -> stack restart returns to clean launcher idle
```

## Must Never Happen

- Wallpaper/desktop with no launcher after Home.
- More than one Chromium app instance at idle.
- `mango-overlay` Chromium in the default runtime.
- Stremio or Kodi running at idle after `mango-stack.sh start`.
- A second orchestrator listener on `:8766`.

## Couch Acceptance — N0

| # | Test | Pass |
|---|------|------|
| 1 | `bash scripts/mango-stack.sh restart` | launcher visible; no Stremio/Kodi/mpv |
| 2 | Home button on launcher | no visible change; no desktop flash |
| 3 | Settings → Back | returns to home with focus restored |
| 4 | Phone PTT when `MANGO_VOICE=1` | launcher HUD shows turn and dismisses |
| 5 | `bash scripts/phase-n0/gate-n0.sh` | exits 0 |

