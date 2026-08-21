# Playback And Non-Launcher Surface Inventory

Scope: every user-visible mango surface outside the Chromium launcher's main DOM views. The launcher home/detail/search/saved/settings/reliability/toasts are intentionally not re-inventoried here, except where a non-launcher component feeds those browser surfaces.

## Summary Table

| Surface | Category | Primary files | What the user sees | Polish risk |
|---|---:|---|---|---|
| mpv in-player HUD | 1 | `scripts/m2-catalog/service/mango-hud.lua:23`, `scripts/m1-foundation/pad/mango-tv-pad.py:840` | Bottom-center ASS panel with time, track metadata, progress, and controls legend | Medium |
| Streams picker in mpv | 1, 2 | `scripts/m2-catalog/service/mango-hud.lua:278`, `src/catalog-service/src/active-stream-session.ts:173` | Centered modal panel listing alternate streams and actions | Medium |
| mpv native OSD fallback | 1, 8 | `scripts/m2-catalog/service/mango-hud.lua:519` | mpv-default temporary message: `Streams are unavailable for this playback.` | High |
| Legacy Tk playback OSD | 1, 8 | `scripts/m2-catalog/service/playback-osd.py:1`, `scripts/m2-catalog/service/mpv-play.sh:1018` | Optional top-level X11 panel when `MANGO_PLAYBACK_OSD_BACKEND=tk` | High |
| Launcher-embedded voice HUD | 3 | `src/launcher/src/voice-hud.ts:28`, `src/launcher/index.html:89`, `src/launcher/src/style.css:2303` | Bottom-center voice card with state dot, user/reply/tool lines | Low |
| Retired overlay Chromium route | 3, 8 | `src/mango-ui-server/serve.py:528`, `scripts/mango-stack.sh:40` | If manually opened, JSON 410: `overlay deprecated; use launcher HUD` | Medium |
| Power-on to launcher paint | 4 | `scripts/m1-foundation/ui/install-openbox-autostart.sh:12`, `scripts/m1-foundation/ui/start-mango-ui.sh:28` | Pi desktop briefly, then black root / cursor hidden, then Chromium kiosk | High |
| Chromium/Firefox first browser paint | 4 | `scripts/m1-foundation/ui/start-mango-launcher-chromium.sh:86`, `src/mango-ui-server/serve.py:809` | Browser's own blank/white startup before launcher app paints | Medium |
| Playback start handoff | 5 | `scripts/m2-catalog/service/mpv-play.sh:938`, `scripts/lib/mango-display-mode.sh:222` | Launcher hides, black gap during xrandr/mode settle, then first mpv frame | High |
| Playback stop/return handoff | 5 | `scripts/m2-catalog/service/mpv-stop.sh:123`, `scripts/lib/restore-launcher-after-playback.sh:86` | Black gap while mpv unmaps and browse HDMI/launcher returns | High |
| External app hiding / retired apps | 6 | `scripts/lib/hide-media.sh:1`, `scripts/mango-stack.sh:32`, `scripts/launch-launcher.sh:89` | Stremio/Kodi windows are hidden/killed if present; no branded wrapper | Medium |
| Native YouTube playback path | 6 | `src/catalog-service/src/youtube/playback.ts:86`, `src/catalog-service/src/youtube/service.ts:3502`, `scripts/m2-catalog/service/mpv-play.sh:273` | YouTube resolves through yt-dlp, then uses the same mpv surface/HUD as catalog playback | Medium |
| Health/watchdog repair | 7 | `scripts/mango-health-repair.sh:177`, `scripts/m1-foundation/ui/systemd/mango-watchdog.service:13` | Usually no text; may restart UI/browser off-playback, exposing black/browser startup gaps | Medium |
| Reliability inputs from non-launcher services | 7 | `src/mango-ui-server/serve.py:379`, `scripts/mango-health-repair.sh:217` | No standalone surface; feeds browser Reliability Center facts | Low |
| Terminal / VT script output | 8 | `scripts/mango-stack.sh:195`, `scripts/m1-foundation/ui/bootstrap-after-reboot.sh:18`, `scripts/lib/present-launcher.sh:93` | Shell text if run on a visible terminal/VT instead of systemd/SSH | High |

Worst-served category by current observable polish risk: **Category 4, boot and transition states**. It has no branded pre-launch surface; the best case is black root, and the worst case can expose Pi desktop, browser blank paint, or terminal output during manual bring-up.

## 1. The In-Player HUD

### Runtime and Triggering

- File: `scripts/m2-catalog/service/mango-hud.lua:1`.
- Render path: mpv ASS/libass overlay, not a separate X11 window. `mpv-play.sh` loads the script with `--script="$hud_lua"`, disables mpv OSC with `--osc=no`, and disables mpv's native OSD bar with `--osd-bar=no` at `scripts/m2-catalog/service/mpv-play.sh:656`.
- Trigger path: pad actions call `show_playback_osd()`, which sends mpv IPC `script-message mango-hud-show <reason>` at `scripts/m1-foundation/pad/mango-tv-pad.py:840`. Reasons are not shown as text; they only cause a redraw.
- Auto-hide: `VISIBLE_SEC` defaults to `4.0` seconds from `MANGO_PLAYBACK_OSD_VISIBLE_SEC` at `scripts/m2-catalog/service/mango-hud.lua:18`. Normal HUD `show()` starts a 1 Hz redraw timer and hides via `mp.add_timeout(VISIBLE_SEC, hide)` at `scripts/m2-catalog/service/mango-hud.lua:496`.
- Visibility state file: writes JSON with `visible`, `mode`, `ts`, and `visible_sec` to `${HOME}/.cache/mango/playback-osd.visible` at `scripts/m2-catalog/service/mango-hud.lua:77`. Pad uses that file for show-first behavior and Streams capture at `scripts/m1-foundation/pad/mango-tv-pad.py:851` and `scripts/m1-foundation/pad/mango-tv-pad.py:873`.

### Canvas, Placement, And Geometry

All coordinates are authored on a fixed 1920x1080 ASS reference canvas. mpv scales this to the panel, preserving footprint at 1080p and 4K.

- Canvas: `CANVAS_W=1920`, `CANVAS_H=1080` at `scripts/m2-catalog/service/mango-hud.lua:25`.
- Panel: `BOX_W=1280`, `BOX_H=172`, `BOX_X=320`, `BOX_Y=860` from `scripts/m2-catalog/service/mango-hud.lua:26`.
- Padding: `PAD=34`, left `L=354`, right `R=1566` at `scripts/m2-catalog/service/mango-hud.lua:29`.
- Rows: `ROW1=882`, `ROW2=910`, `ROW3=932`, `ROW4=954`, `ROW5=976`, progress track `TRACK_Y=998`, legend `LEGEND_Y=1016` at `scripts/m2-catalog/service/mango-hud.lua:32`.
- Track: width `1212`, height `10`, thumb radius `9` at `scripts/m2-catalog/service/mango-hud.lua:38`.
- Anchor: the panel is bottom center, 48 px above the 1080p bottom edge.

### ASS Styles And Colours

ASS colour format is documented as `&HBBGGRR&`; alpha is `&HAA&` at `scripts/m2-catalog/service/mango-hud.lua:43`.

- Text style builder at `scripts/m2-catalog/service/mango-hud.lua:183`:
  - Exact tag shape: `{\an%d\pos(%d,%d)\fnDejaVu Sans\fs%d\1c%s\3c%s\bord1\shad0%s\q2}%s`
  - Font: `DejaVu Sans`.
  - Border: `\bord1`.
  - Shadow: `\shad0`.
  - Outline colour: `C_OUTLINE=&H00000000&`.
  - Bold is appended as `\b1`.
  - `\q2` wrapping.
- Rectangle style builder at `scripts/m2-catalog/service/mango-hud.lua:190`:
  - Exact tag shape: `{\an7\pos(%d,%d)\1c%s\1a%s\bord0\shad0\p1}m 0 0 l %d 0 %d %d 0 %d{\p0}`.
- Thumb circle builder at `scripts/m2-catalog/service/mango-hud.lua:197`:
  - Exact tag starts `{\an7\pos(%d,%d)\1c%s\bord0\shad0\p1}` and draws Bezier path data.
- Colours at `scripts/m2-catalog/service/mango-hud.lua:44`:
  - Elapsed / selected cyan: `C_ELAPSED=&H00dff1f7&`.
  - Remaining: `C_REMAIN=&H00a0c6d7&`.
  - Status: `C_STATUS=&H00a5bcc5&`.
  - Green: `C_GREEN=&H00a8d49f&`.
  - Red: `C_RED=&H009fa0d4&`.
  - Box fill: `C_BOX=&H00060807&`, alpha `A_BOX=&H12&`.
  - Track: `C_TRACK=&H003d4b51&`, alpha `A_TRACK=&H2c&`.
  - Fill: `C_FILL=&H004cb8ff&`; paused fill `C_FILL_PAUSE=&H005c7a8a&`.
  - Thumb: `C_THUMB=&H00a3e1ff&`; paused thumb `C_THUMB_PAUSE=&H008aa8b8&`.
  - Legend: `C_LEGEND=&H00a5bcc5&`.

### Normal HUD Elements

Drawn by `build_ass()` at `scripts/m2-catalog/service/mango-hud.lua:390`.

- Background panel:
  - `rect_ev(BOX_X=320, BOX_Y=860, BOX_W=1280, BOX_H=172, C_BOX, A_BOX)` at `scripts/m2-catalog/service/mango-hud.lua:444`.
  - `\an7\pos(320,860)`, alpha `&H12&`.
- Elapsed time:
  - `text_ev(7, L=354, ROW1=882, 30, paused and &H00b4c2c9& or C_ELAPSED, fmt_time(pos), true)` at `scripts/m2-catalog/service/mango-hud.lua:445`.
  - Font size 30, bold, left/top anchored with `\an7`.
  - Format: `M:SS` or `H:MM:SS` from `fmt_time()` at `scripts/m2-catalog/service/mango-hud.lua:102`.
  - Paused colour changes from `&H00dff1f7&` to `&H00b4c2c9&`.
- Remaining time / live:
  - `text_ev(9, R=1566, ROW1=882, 24, C_REMAIN, remain_label, false)` at `scripts/m2-catalog/service/mango-hud.lua:446`.
  - Font size 24, right/top anchored with `\an9`.
  - String is `-<time>` when duration is known; `LIVE` when duration is zero/unknown at `scripts/m2-catalog/service/mango-hud.lua:433`.
- Subtitle state:
  - Left: `Subtitles: On` or `Subtitles: Off`, font size 19 at `scripts/m2-catalog/service/mango-hud.lua:447`.
  - Right: `Sub: <label>`, font size 19 at `scripts/m2-catalog/service/mango-hud.lua:448`.
  - Labels can be `Off`, `Track <n>`, language uppercase, title, external filename, or title plus language at `scripts/m2-catalog/service/mango-hud.lua:139`.
- Audio state:
  - Left: `Audio: <label>`, font size 19 at `scripts/m2-catalog/service/mango-hud.lua:449`.
  - Empty label is `Default` at `scripts/m2-catalog/service/mango-hud.lua:405`.
  - Audio labels may append codec as ` · <CODEC>` at `scripts/m2-catalog/service/mango-hud.lua:169`.
- Video technical line:
  - Left: `Video: <label>`, font size 18 at `scripts/m2-catalog/service/mango-hud.lua:450`.
  - Label pieces: `<width>×<height>`, `VCODEC`, `hw:<hwdec>` at `scripts/m2-catalog/service/mango-hud.lua:407`.
  - Empty label: `—`.
  - Colour is green if label includes `3840`, `2160`, or `4096`; otherwise status colour at `scripts/m2-catalog/service/mango-hud.lua:435`.
- Display line:
  - Left: `Display: <label>`, font size 18 at `scripts/m2-catalog/service/mango-hud.lua:451`.
  - Label from mpv `osd-dimensions` as `<w>x<h>` at `scripts/m2-catalog/service/mango-hud.lua:423`.
  - Empty label: `—`.
  - Colour is green for 4K-ish dimensions, red for `1920`, otherwise status at `scripts/m2-catalog/service/mango-hud.lua:436`.
- Progress bar:
  - Track: `rect_ev(L=354, TRACK_Y=998, TRACK_W=1212, TRACK_H=10, C_TRACK, A_TRACK)` at `scripts/m2-catalog/service/mango-hud.lua:453`.
  - Fill: starts at `(354,998)`, width `floor(1212 * pos/dur)`, colour `C_FILL` or `C_FILL_PAUSE` at `scripts/m2-catalog/service/mango-hud.lua:455`.
  - Thumb: circle centered at `(354 + fill_w, 1003)`, radius `9`, colour `C_THUMB` or `C_THUMB_PAUSE` at `scripts/m2-catalog/service/mango-hud.lua:458`.
- Controls legend:
  - `text_ev(7, 354, 1016, 16, C_LEGEND, "B pause   ←/→ seek   ↑ osd/subs   X streams   A audio   ± vol   Y back", false)` at `scripts/m2-catalog/service/mango-hud.lua:460`.

### HUD States

- Play:
  - `pause` property false. Elapsed is cyan, fill is orange/cyan (`C_FILL`), thumb is cyan (`C_THUMB`) at `scripts/m2-catalog/service/mango-hud.lua:396`.
  - Pad B sends mpv `SPACE`, then shows HUD with reason `pause` at `scripts/m1-foundation/pad/mango-tv-pad.py:1078`.
- Pause:
  - `pause` property true. Elapsed colour changes to `&H00b4c2c9&`, fill to `C_FILL_PAUSE`, thumb to `C_THUMB_PAUSE` at `scripts/m2-catalog/service/mango-hud.lua:445`.
  - No explicit `Paused` text is drawn.
- Seek:
  - Left/right pad sends `seek +/-<seconds> relative`, then shows normal HUD at `scripts/m1-foundation/pad/mango-tv-pad.py:496`.
  - No seek delta text; the elapsed/progress changes.
- Volume:
  - +/- buttons call mpv `add volume +/-<percent>` and show normal HUD at `scripts/m1-foundation/pad/mango-tv-pad.py:956`.
  - No volume number is rendered by `mango-hud.lua`.
- Subtitles:
  - First `↑` just shows HUD if hidden; next `↑` sets `sub-visibility=yes`, cycles subtitle track upward, and redraws at `scripts/m1-foundation/pad/mango-tv-pad.py:1006`.
  - Visual change is only `Subtitles: On/Off` and `Sub: <label>`.
- Audio:
  - First A shows HUD if hidden; next A cycles audio track and redraws at `scripts/m1-foundation/pad/mango-tv-pad.py:1018`.
  - Visual change is only `Audio: <label>`.
- Buffering:
  - No buffering-specific overlay exists in `mango-hud.lua`.
  - mpv may have its own disabled/native OSD behavior, but `--osc=no` and `--osd-bar=no` are set by `mpv-play.sh`; no mango buffering string was found.
- Title card:
  - No playback title card exists in `mango-hud.lua`.
- Error:
  - No normal HUD error panel exists in `mango-hud.lua`.
  - The one Lua mpv-native error-like message is `Streams are unavailable for this playback.` at `scripts/m2-catalog/service/mango-hud.lua:522`.
- Stream-switch confirmation:
  - No positive confirmation text is rendered after a switch. The picker header moves through `Checking stream…` / `Switching…` / `Ready`.
- Progress bar:
  - Always present while HUD is visible.
  - If duration is zero, fill stays zero and remaining label is `LIVE`.
- Clock:
  - No wall-clock exists. The HUD has elapsed and remaining playback time only.
- Next episode prompt:
  - Not in `mango-hud.lua`; next episode prompt is launcher detail DOM and therefore outside this agent's surface scope. The launcher checks it after playback return at `src/launcher/src/detail.ts:1583`.
- Streams picker:
  - Lives in this file; detailed in Category 2.

### User-Facing Strings In The HUD File

- `Track <n>`: `scripts/m2-catalog/service/mango-hud.lua:152`, `scripts/m2-catalog/service/mango-hud.lua:167`, `scripts/m2-catalog/service/mango-hud.lua:175`.
- `Off`: subtitle empty label at `scripts/m2-catalog/service/mango-hud.lua:402`.
- `Default`: audio empty label at `scripts/m2-catalog/service/mango-hud.lua:405`.
- `—`: empty video/display label at `scripts/m2-catalog/service/mango-hud.lua:421` and `scripts/m2-catalog/service/mango-hud.lua:423`.
- `LIVE`: no-duration remaining label at `scripts/m2-catalog/service/mango-hud.lua:433`.
- `Subtitles: On`, `Subtitles: Off`: built at `scripts/m2-catalog/service/mango-hud.lua:447`.
- `Sub: <label>`: `scripts/m2-catalog/service/mango-hud.lua:448`.
- `Audio: <label>`: `scripts/m2-catalog/service/mango-hud.lua:449`.
- `Video: <label>`: `scripts/m2-catalog/service/mango-hud.lua:450`.
- `Display: <label>`: `scripts/m2-catalog/service/mango-hud.lua:451`.
- `B pause   ←/→ seek   ↑ osd/subs   X streams   A audio   ± vol   Y back`: `scripts/m2-catalog/service/mango-hud.lua:462`.

## 2. The Streams Picker As Seen During Playback

### Owning File And Entry/Exit

- Drawn in `scripts/m2-catalog/service/mango-hud.lua` by `build_streams_ass()` at `scripts/m2-catalog/service/mango-hud.lua:278`.
- Opened by script message `mango-streams-toggle` at `scripts/m2-catalog/service/mango-hud.lua:557`.
- The X button chooses the mpv surface and sends `script-message mango-streams-toggle` at `scripts/m1-foundation/pad/mango-tv-pad.py:1315`.
- Cancel/close:
  - X toggles closed if already visible.
  - Y sends `script-message mango-streams-close` when Streams is open at `scripts/m1-foundation/pad/mango-tv-pad.py:1088`.
  - Closing calls `close_streams()`, which resets mode to `hud`, clears state, and hides overlay at `scripts/m2-catalog/service/mango-hud.lua:512`.
- Select:
  - B sends `script-message mango-streams-select` when open at `scripts/m1-foundation/pad/mango-tv-pad.py:1072`.
  - Select is ignored while status is `checking` or `switching` at `scripts/m2-catalog/service/mango-hud.lua:580`.

### Layout And Style

- Panel geometry:
  - `panel_w=1320`, `panel_h=760`, `panel_x=300`, `panel_y=160` at `scripts/m2-catalog/service/mango-hud.lua:279`.
  - Left text column `left=354`, right column `right=1566` at `scripts/m2-catalog/service/mango-hud.lua:282`.
  - Background `rect_ev(300,160,1320,760,C_BOX,"&H08&")` at `scripts/m2-catalog/service/mango-hud.lua:286`; alpha is more opaque than the normal HUD (`&H08&` vs `&H12&`).
- Header:
  - Left title: `Streams`, `text_ev(7, 354, 202, 34, C_ELAPSED, "Streams", true)` at `scripts/m2-catalog/service/mango-hud.lua:287`.
  - Right status: `text_ev(9, 1566, 206, 17, C_LEGEND, <status>, false)` at `scripts/m2-catalog/service/mango-hud.lua:288`.
- Candidate rows:
  - First row Y `266`, row height `58` at `scripts/m2-catalog/service/mango-hud.lua:306`.
  - Up to 8 candidate rows come from catalog-service `visibleCandidates = session.candidates.slice(0, 8)` at `src/catalog-service/src/active-stream-session.ts:216`.
  - If current stream is outside the first 8, it replaces the 8th slot at `src/catalog-service/src/active-stream-session.ts:217`.
  - Row text font size 23, anchored top-left at `scripts/m2-catalog/service/mango-hud.lua:320`.
  - Selected row focus treatment: `rect_ev(left - 18 = 336, row_y - 10, panel_w - 72 = 1248, row_h - 4 = 54, C_TRACK, "&H18&")`; selected text colour changes to `C_ELAPSED` at `scripts/m2-catalog/service/mango-hud.lua:311`.
- Actions:
  - After candidate rows, `Try smoother source` appears as a bold row at `scripts/m2-catalog/service/mango-hud.lua:333`.
  - If `undo_available`, `Undo` appears as another bold row at `scripts/m2-catalog/service/mango-hud.lua:335`.
- Detail footer:
  - Left detail line at `(354, 844)`, font size 17, colour `C_LEGEND` at `scripts/m2-catalog/service/mango-hud.lua:345`.
  - Right controls line at `(1566, 882)`, font size 17: `↑/↓ choose   B select   Y close` at `scripts/m2-catalog/service/mango-hud.lua:349`.

### Row Format

- Candidate summary is built as:
  - `resolution or "Unknown"`
  - `hdr or "SDR"`
  - `codec or "Unknown"`
  - `cache or "unknown"`
  - `source or "Source"`
  - Joined by `  ·  ` at `scripts/m2-catalog/service/mango-hud.lua:246`.
- Catalog-service supplies:
  - `resolution`, `hdr` as `HDR` or `SDR`, `codec`, `cache`, `source`, `size`, `bitrate`, `release_group`, `audio`, `capability_class`, and `risk` at `src/catalog-service/src/active-stream-session.ts:173`.
- Detail line:
  - Uses `size`, `bitrate`, `release_group`, `audio`, and `risk`, joined by `  ·  ` at `scripts/m2-catalog/service/mango-hud.lua:257`.
  - If no detail exists and capability is `proven_smooth`: `Proven fit for this playback path`.
  - Otherwise: `Technical details will be learned after validation`.
  - If focus is on an action, fallback detail is `stream_state.error` or `Downranks this source for seven days; you still choose the replacement.` at `scripts/m2-catalog/service/mango-hud.lua:345`.

### Badge Vocabulary And Focus Treatment

- Current stream marker: `● ` prefix, and row text is bold when `candidate.current == true` at `scripts/m2-catalog/service/mango-hud.lua:315`.
- Unavailable stream marker: `× ` prefix, row colour becomes `C_LEGEND` at `scripts/m2-catalog/service/mango-hud.lua:316`.
- Risk badge: `FINAL FALLBACK`, right aligned at font size 16, red, bold when `capability_class == "known_risky"` at `scripts/m2-catalog/service/mango-hud.lua:322`.
- Action colour:
  - `Try smoother source` is green (`C_GREEN`) when not focused, selected cyan when focused at `scripts/m2-catalog/service/mango-hud.lua:333`.
  - `Undo` is status colour when not focused, selected cyan when focused at `scripts/m2-catalog/service/mango-hud.lua:341`.

### States And Text

- Unavailable/no state:
  - Header status: `Unavailable` if `stream_state` missing at `scripts/m2-catalog/service/mango-hud.lua:290`.
  - Body: `No alternate streams are available for this title.` at `scripts/m2-catalog/service/mango-hud.lua:299`.
  - Footer: `Y closes` at `scripts/m2-catalog/service/mango-hud.lua:301`.
- Ready:
  - Header status: `Ready`.
  - D-pad up/down wraps selection through candidates + actions at `scripts/m2-catalog/service/mango-hud.lua:569`.
- Checking:
  - Header status: `Checking stream…`.
  - Select is ignored while checking at `scripts/m2-catalog/service/mango-hud.lua:584`.
  - Catalog state becomes `checking` before validation at `src/catalog-service/src/active-stream-session.ts:546`.
- Switching:
  - Header status: `Switching…`.
  - Catalog state becomes `switching` after alternate validates and before launch at `src/catalog-service/src/active-stream-session.ts:644`.
- Failed:
  - Header status: `Playback stopped`.
  - Catalog sets user-visible errors such as `Playback stopped while checking the alternate stream.` and `Playback stopped because neither stream could start.` at `src/catalog-service/src/active-stream-session.ts:560` and `src/catalog-service/src/active-stream-session.ts:705`.
- Select candidate:
  - Current candidate or unavailable candidate does nothing at `scripts/m2-catalog/service/mango-hud.lua:593`.
  - Alternate candidate posts `/play-session/active/streams/switch`, status moves to `checking`, and panel stays open at `scripts/m2-catalog/service/mango-hud.lua:597`.
- Select `Try smoother source`:
  - Posts `/play-session/active/streams/issue` with reason `user requested a smoother source` at `scripts/m2-catalog/service/mango-hud.lua:604`.
  - Catalog records that reason and sets error `Current source moved to final fallback. Choose an alternate, or Undo.` at `src/catalog-service/src/active-stream-session.ts:720`.
- Select `Undo`:
  - Posts `/play-session/active/streams/issue/undo` at `scripts/m2-catalog/service/mango-hud.lua:607`.
  - Catalog clears `undo_available` and error at `src/catalog-service/src/active-stream-session.ts:744`.

### User-Facing Strings In Streams

- `Streams`
- `Checking stream…`
- `Switching…`
- `Playback stopped`
- `Ready`
- `Unavailable`
- `No alternate streams are available for this title.`
- `Y closes`
- `Unknown`
- `SDR`
- `unknown`
- `Source`
- `● `
- `× `
- `FINAL FALLBACK`
- `Try smoother source`
- `Undo`
- `Proven fit for this playback path`
- `Technical details will be learned after validation`
- `Downranks this source for seven days; you still choose the replacement.`
- `↑/↓ choose   B select   Y close`
- `Streams are unavailable for this playback.`
- Catalog-fed error/detail strings:
  - `Could not check that stream. The current video is still playing.`
  - `Playback stopped while checking the alternate stream.`
  - `That stream is unavailable. The current video is still playing.`
  - `Could not switch streams. The original stream was restored.`
  - `Playback stopped because neither stream could start.`
  - `Current source moved to final fallback. Choose an alternate, or Undo.`

## 3. Voice Surfaces

### Launcher-Embedded Voice HUD

- Markup lives in `src/launcher/index.html:89`.
- Runtime starts from `startVoiceHud()` at `src/launcher/src/voice-hud.ts:28`.
- WebSocket URLs:
  - Explicit `VITE_ORCH_WS`, or `wss://<host>:8765/ws` on HTTPS, or `ws://127.0.0.1:8766/ws` then `ws://<host>:8766/ws` on HTTP at `src/launcher/src/voice-hud.ts:46`.
- Position/style:
  - Fixed `left: 50%`, bottom safe area `max(5vh, env(safe-area-inset-bottom)+1.25rem)` at `src/launcher/src/style.css:2303`.
  - `transform: translateX(-50%)`.
  - Width `min(700px, calc(100vw - 2 * max(7vw, safe-area...)))` at `src/launcher/src/style.css:2308`.
  - Max height `min(34vh, 300px)`, scrollable vertically at `src/launcher/src/style.css:2309`.
  - Padding `16px 20px 18px`.
  - Background `rgba(5, 8, 10, 0.9)`.
  - Border `1px solid var(--border-strong)`.
  - Radius `22px`.
  - Shadow `0 18px 56px rgba(0, 0, 0, 0.5)`.
  - z-index `40`.
  - Pointer events none.
  - Transition: opacity and transform, `0.28s ease` at `src/launcher/src/style.css:2320`.
  - Hidden state opacity `0`, translateY `14px` at `src/launcher/src/style.css:2325`.
- Header:
  - Dot and state label at `src/launcher/index.html:90`.
  - State font `1.1rem`, weight `800`, letter spacing `0.04em`, lowercase, text-secondary at `src/launcher/src/style.css:2337`.
  - Dot `13px`, round, idle bg `#607d8b`, shadow rgba `96,125,139,0.8` at `src/launcher/src/style.css:2345`.
  - Listening dot: `#ffb703`, shadow rgba `255,183,3,0.92` at `src/launcher/src/style.css:2353`.
  - Thinking dot: `#8ecae6`, shadow rgba `142,202,230,0.92` at `src/launcher/src/style.css:2358`.
  - Speaking dot: `#80ed99`, shadow rgba `128,237,153,0.92` at `src/launcher/src/style.css:2363`.
- Lines:
  - Grid columns `3.5rem 1fr`, gap `12px`, margin bottom `8px` at `src/launcher/src/style.css:2368`.
  - Tags: `you`, `mango`, `tool` at `src/launcher/index.html:94`.
  - Tag font `0.95rem`, weight `800`, lowercase, muted at `src/launcher/src/style.css:2376`.
  - Text font `24px`, weight `800`, line-height `1.28`, primary colour at `src/launcher/src/style.css:2385`.
  - User text colour is `var(--accent)` at `src/launcher/src/style.css:2418`.
  - Tool tag colour is accent; tool text is secondary with active opacity `0.92` at `src/launcher/src/style.css:2426`.
  - Hint text exists as `hold on phone to talk` in markup at `src/launcher/index.html:106`, but CSS hides `.voice-hint` at `src/launcher/src/style.css:2438`.

### Visibility And Timing

- Active states are exactly `listening`, `thinking`, `speaking` at `src/launcher/src/voice-hud.ts:24`.
- Max visible cap: `12_000` ms at `src/launcher/src/voice-hud.ts:25`. Any active update arms the cap at `src/launcher/src/voice-hud.ts:73`.
- Error dismiss: 4 seconds at `src/launcher/src/voice-hud.ts:178`.
- Dismiss resets:
  - user/reply/tool text to empty,
  - `data-state="idle"`,
  - `data-visible="false"`,
  - `aria-hidden="true"`,
  - state label `mango`,
  - dot state `idle`,
  at `src/launcher/src/voice-hud.ts:78`.

### Voice States And Strings

- Idle:
  - Hidden.
  - State label `mango` at `src/launcher/src/voice-hud.ts:87`.
- Listening:
  - `humanState()` returns `listening…` at `src/launcher/src/voice-hud.ts:200`.
  - On `ptt_start`, orchestrator sets overlay `listening`, text `listening…` at `src/orchestrator/orchestrator/main.py:184`.
  - User and reply lines are cleared on listening at `src/launcher/src/voice-hud.ts:107`.
- Thinking:
  - `humanState()` maps fallback starting with `transcribing` to `hearing you…` at `src/launcher/src/voice-hud.ts:202`.
  - It preserves `thinking…`, or uses provided fallback, or defaults to `thinking…`.
  - Orchestrator text states include `queued…`, `thinking…`, and `transcribing…` at `src/orchestrator/orchestrator/main.py:218`, `src/orchestrator/orchestrator/main.py:239`, and `src/orchestrator/orchestrator/main.py:419`.
  - User chat from orchestrator causes launcher HUD to show state `hearing you…` and the `you` line with transcript at `src/launcher/src/voice-hud.ts:163`.
  - Assistant partials render reply text with an appended `…` at `src/launcher/src/voice-hud.ts:220`.
- Speaking:
  - State label is `mango` at `src/launcher/src/voice-hud.ts:207`.
  - Assistant final chat sets state `speaking`, label `mango`, and reply text at `src/launcher/src/voice-hud.ts:169`.
  - If synchronous TTS is enabled, orchestrator sets overlay `speaking` with the full reply at `src/orchestrator/orchestrator/main.py:592`.
  - If async TTS is enabled, orchestrator sets overlay `speaking` to `first_sentence(reply)` at `src/orchestrator/orchestrator/main.py:625`.
- Error:
  - Launcher receives `{type:"error", message}`; fallback if absent is `voice error` at `src/launcher/src/voice-hud.ts:178`.
  - Error text appears in the reply line, state label is `mango`, and dismisses after 4 seconds at `src/launcher/src/voice-hud.ts:178`.
  - Orchestrator sanitizes errors through `couch_safe_error_message()` at `src/orchestrator/orchestrator/main.py:100`.
- Tool:
  - Launcher receives `{type:"tool", phase, name, summary}` at `src/launcher/src/voice-hud.ts:185`.
  - Summary fallback is `msg.summary`, `msg.name`, or `working…`.
  - State becomes thinking, state label is the summary, and the `tool` line shows the summary.
  - Tool line active is `true` except when `phase === "done"` at `src/launcher/src/voice-hud.ts:185`.
  - Tool summaries come from `tool_summary()` at `src/orchestrator/orchestrator/tools/runner.py:260`, with examples:
    - `Searching mango for …`
    - `Reading companion profile`
    - `Updating companion profile`
    - `Summarizing what I know about you`
    - `Saving session notes`

### Retired Overlay Route

- The old separate overlay Chromium is intentionally disabled:
  - `MANGO_SKIP_OVERLAY=1` in `start-mango-ui.sh` at `scripts/m1-foundation/ui/start-mango-ui.sh:19`.
  - `mango-stack.sh` kills `chromium.*mango-overlay.*127.0.0.1:3000/overlay/` at `scripts/mango-stack.sh:40`.
  - Voice verification expects overlay route 410 at `scripts/m5-voice/stack/verify-voice-ready.sh:135`.
- If a user manually opens `/overlay/`, server returns JSON:
  - `{"ok": false, "error": "overlay deprecated; use launcher HUD"}` at `src/mango-ui-server/serve.py:528`.

## 4. Boot And Transition States

### Startup Path

- Openbox autostart appends `bash ~/mango/scripts/m1-foundation/ui/start-mango-ui.sh &` to `~/.config/openbox/autostart` at `scripts/m1-foundation/ui/install-openbox-autostart.sh:12`.
- Systemd alternative:
  - UI server unit starts `serve.py` at `scripts/m1-foundation/ui/systemd/mango-ui-server.service:14`.
  - Browser unit starts `start-mango-launcher-chromium.sh` at `scripts/m1-foundation/ui/systemd/mango-launcher-chromium.service:20`.
- `start-mango-ui.sh` sequence:
  - Source voice env if present at `scripts/m1-foundation/ui/start-mango-ui.sh:14`.
  - Hide desktop chrome at `scripts/m1-foundation/ui/start-mango-ui.sh:28`.
  - Hide cursor at `scripts/m1-foundation/ui/start-mango-ui.sh:29`.
  - Ensure launcher display mode at `scripts/m1-foundation/ui/start-mango-ui.sh:30`.
  - Build launcher if `dist` missing at `scripts/m1-foundation/ui/start-mango-ui.sh:36`.
  - Start UI server and poll `/api/health` at `scripts/m1-foundation/ui/start-mango-ui.sh:57`.
  - Start browser kiosk at `scripts/m1-foundation/ui/start-mango-ui.sh:82`.
  - Kill old overlay Chromium at `scripts/m1-foundation/ui/start-mango-ui.sh:104`.
  - Activate launcher and present it at `scripts/m1-foundation/ui/start-mango-ui.sh:107`.
  - Start pad at `scripts/m1-foundation/ui/start-mango-ui.sh:117`.

### What Can Be Visible

- Before Openbox autostart runs:
  - Repo has no Plymouth/splash customization, no `feh` wallpaper, and no branded boot screen found.
  - The user may see the stock Pi desktop/session background and lxpanel until mango hides it.
- When `mango-desktop.sh hide` runs:
  - `lxpanelctl hide`, unmaps `lxpanel-pi`, `Pcmanfm`, and windows named `Desktop`, hides via wmctrl, runs `pcmanfm --desktop-off`, kills `lxpanel`, and paints X root black using `xsetroot -solid black` at `scripts/lib/mango-desktop.sh:9`.
  - Intended visible fallback is pure black.
- Cursor:
  - `xsetroot -cursor_name none`, then `unclutter-xfixes -idle 0 -root -noevents` or `unclutter -idle 0 -root` at `scripts/lib/mango-cursor.sh:9`.
  - Disables DPMS and screen blanking at `scripts/lib/mango-cursor.sh:22`.
- Browser startup:
  - Chromium flags include `--no-first-run`, `--no-default-browser-check`, `--disable-infobars`, `--disable-translate`, `--disable-session-crashed-bubble`, `--noerrdialogs`, and kiosk app mode at `scripts/m1-foundation/ui/start-mango-launcher-chromium.sh:86`.
  - Firefox fallback uses `--kiosk` at `scripts/m1-foundation/ui/start-mango-launcher-chromium.sh:124`.
  - There is no branded loading/splash layer before `index.html` and CSS paint. Browser blank/white/unstyled flash remains possible.
- Build missing:
  - If `src/launcher/dist` is absent and the script is run from a visible terminal, npm install/build output can appear before browser launch at `scripts/m1-foundation/ui/start-mango-ui.sh:36`.
- Startup console strings:
  - `mango UI running at http://127.0.0.1:<port>/` at `scripts/m1-foundation/ui/start-mango-ui.sh:119`.
  - In systemd/autostart this is not normally an on-TV terminal; in a manual VT it is visible text.

### Known Polish Targets

- No branded boot splash or pre-launch card exists.
- Brief bare Pi desktop can appear before autostart's first `mango-desktop.sh hide`.
- Black root is intentional, but unbranded.
- Chromium/Firefox startup may produce browser-native blank/white paint.
- Display mode changes can add resolution-change black gaps; see Category 5.

## 5. Display-Mode Change Artifacts

### Playback Start / Deferred Handoff

- `mpv-play.sh` can run deferred foreground if `MANGO_MPV_STOP_LAUNCHER=1`, defaulting `MANGO_MPV_DEFER_FOREGROUND=1` at `scripts/m2-catalog/service/mpv-play.sh:1102`.
- For VOD, `needs_vo_null_buffer()` starts mpv with `--vo=null --ao=null` so the first visible frame is born after HDMI matching at `scripts/m2-catalog/service/mpv-play.sh:389`.
- Handoff order in `foreground_handoff()`:
  - Mark playback active at `scripts/m2-catalog/service/mpv-play.sh:940`.
  - Hide launcher window and freeze launcher or stop Chromium at `scripts/m2-catalog/service/mpv-play.sh:941`.
  - Hide desktop chrome and black root at `scripts/m2-catalog/service/mpv-play.sh:950`.
  - Resolve video profile if needed at `scripts/m2-catalog/service/mpv-play.sh:951`.
  - Match HDMI via `mango-display-mode.sh playback-auto` or fallback `playback` at `scripts/m2-catalog/service/mpv-play.sh:959`.
  - Settle after display match: default `400` ms; comment says `Brief blank while the TV finishes HDMI mode switch — prefer correct first frame` at `scripts/m2-catalog/service/mpv-play.sh:927`.
  - Enable mpv GPU VO, fullscreen, audio output at `scripts/m2-catalog/service/mpv-play.sh:754`.
  - Raise mpv window at `scripts/m2-catalog/service/mpv-play.sh:905`.
- Visible artifact:
  - Expected: black gap during hide + xrandr + settle.
  - Avoided by design: `browse-res video → flash → black → 4K` and `4K-scaled Chromium flash`, called out in comments at `scripts/m2-catalog/service/mpv-play.sh:389` and `scripts/m2-catalog/service/mpv-play.sh:941`.

### Display Mode Policy

- Browse is always 1080p@60 by default at `scripts/lib/mango-display-mode.sh:1`.
- Playback auto:
  - For 4K-ish source width/height, tries `3840x2160` first, then `1920x1080` at `scripts/lib/mango-display-mode.sh:209`.
  - Otherwise tries `1920x1080`, then `3840x2160`.
  - Chooses refresh close to source fps at `scripts/lib/mango-display-mode.sh:159`.
  - Applies xrandr with `xrandr --output "$output" --mode "$mode" --rate "$rate"` at `scripts/lib/mango-display-mode.sh:335`.
- Logging only:
  - Mode script writes to `${HOME}/.cache/mango/display-mode.log` at `scripts/lib/mango-display-mode.sh:46`.
  - No on-screen text is rendered during mode application.

### Playback Stop / Return To Launcher

- `mpv-stop.sh` uses black-screen-first restore:
  - Hide desktop chrome before mpv teardown at `scripts/m2-catalog/service/mpv-stop.sh:123`.
  - Teardown mpv at `scripts/m2-catalog/service/mpv-stop.sh:135`.
  - Run `restore-launcher-after-playback.sh finish` with optional home at `scripts/m2-catalog/service/mpv-stop.sh:137`.
- Restore contract:
  - Restore HDMI to browse mode while launcher stays hidden, then reveal launcher at browse geometry at `scripts/lib/restore-launcher-after-playback.sh:4`.
  - Keep lxpanel/wallpaper hidden during xrandr gap at `scripts/lib/restore-launcher-after-playback.sh:86`.
  - If prior panel width was >=3k, restart Chromium for clean GL at `scripts/lib/restore-launcher-after-playback.sh:48`.
  - Present all launcher windows full-screen; retry up to 60 times by default at `scripts/lib/restore-launcher-after-playback.sh:62`.
- Visible artifact:
  - Expected: black gap between mpv unmap and launcher reveal.
  - High-risk failure if present fails: black root with hidden launcher, or Chromium cold-start blank paint after 4K reset.

## 6. Other Apps As Surfaces

### Stremio And Kodi

- No active `launch-stremio.sh`, `launch-kodi.sh`, `focus-stremio.sh`, or `focus-kodi.sh` script was found in current `scripts/`.
- Current stack treats them as idle strays:
  - `mango-stack.sh stop_idle_media()` stops mpv, kills `stremio`, and kills `kodi` at `scripts/mango-stack.sh:32`.
  - `launch-launcher.sh` kills orphaned `focus-kodi.sh` and `focus-stremio.sh` loops at `scripts/launch-launcher.sh:58`.
  - `hide-media.sh all` hides Stremio/Kodi before focusing launcher at `scripts/launch-launcher.sh:89`.
- If either app is visible despite being retired:
  - `hide-media.sh` searches by window class, adds hidden/below, unmaps with xdotool, and moves to `-2000,-2000,1,1` at `scripts/lib/hide-media.sh:9`.
  - There is no mango frame, overlay, title bar treatment, or branded transition around those third-party UIs.

### YouTube

- Native YouTube is no longer a Kodi app surface in the current code path.
- `YoutubeService.play()` requires a cached video id and resolves direct playback URLs through yt-dlp at `src/catalog-service/src/youtube/service.ts:3502`.
- `resolveYoutubePlayback()` runs configured yt-dlp formats and returns video/audio URLs at `src/catalog-service/src/youtube/playback.ts:86`.
- The actual visible playback is the same `mpv-play.sh` surface/HUD:
  - `mpv-play.sh` detects YouTube streams by URL containing `googlevideo.com` or `youtube.com` at `scripts/m2-catalog/service/mpv-play.sh:273`.
  - For YouTube, real playback threshold is 0.3 seconds at `scripts/m2-catalog/service/mpv-play.sh:232`.
- User-facing YouTube play errors are catalog/launcher browser toasts, not standalone non-browser surfaces:
  - `YouTube video id is missing`
  - `YouTube playback did not start — try another video`
  - `YouTube live playback did not start — try another live video`
  - yt-dlp couch messages from `src/catalog-service/src/youtube/playback.ts:41`, including `YouTube playback format unavailable — try another YouTube video`, `YouTube is asking for browser verification — reconnect cookies/account and try again`, `YouTube blocked this video for this account or device`, `this YouTube video is unavailable`, and `YouTube playback could not be resolved`.

## 7. Error And Recovery Surfaces

### Watchdog / Health Repair

- Unit: `mango-watchdog.service` runs `%h/mango/scripts/mango-health-repair.sh --quiet` with DISPLAY `:0` at `scripts/m1-foundation/ui/systemd/mango-watchdog.service:7`.
- During playback:
  - `mango-health-repair.sh` treats mpv or playback-active file as playback active at `scripts/mango-health-repair.sh:148`.
  - It skips catalog and launcher repair during playback at `scripts/mango-health-repair.sh:211`.
  - Result: no mid-playback on-screen repair UI.
- Off playback:
  - If catalog unhealthy, restarts catalog at `scripts/mango-health-repair.sh:130`.
  - If launcher frozen outside playback, thaws launcher at `scripts/mango-health-repair.sh:221`.
  - If launcher health fails, restarts UI/browser at `scripts/mango-health-repair.sh:177`.
  - Result: user may see black root, browser startup blank paint, or launcher reload if repair happens while watching the launcher.
- Text:
  - With `--quiet`, normal `say` output is suppressed.
  - Without `--quiet`, shell strings include `health-repair: ok repairs=<n>`, `health-repair: skipped playability maintenance active`, `health-repair: catalog + launcher repair skipped (playback active)`, `health-repair: FAIL <check> <reason>` at `scripts/mango-health-repair.sh:49`.
  - These are not normally on TV unless a visible terminal/VT is running the script.

### Catalog-Service Failures Feeding Browser UI

These are not standalone non-browser surfaces, but they feed launcher toasts/detail states and Reliability Center facts.

- Playback resolve errors:
  - `playback took too long — try again`
  - `no streams found for this title`
  - Stream resolve couch-safe messages at `src/catalog-service/src/core.ts:2275` and `src/catalog-service/src/core.ts:2290`.
- Launcher play-session result maps failed sessions to `session.error` or `couldn't start playback. try another title.` at `src/launcher/src/catalog.ts:542`.
- UI server proxy timeout can emit JSON:
  - `catalog-service unavailable: <reason>`
  - `catalog-service timeout`
  at `src/mango-ui-server/serve.py:911`.
- Reliability Center inputs:
  - `serve.py` health checks report launcher/browser/pad/catalog/openbox facts at `src/mango-ui-server/serve.py:379`.
  - `mango-health-repair.sh` decides repair from those same non-launcher facts at `scripts/mango-health-repair.sh:217`.

### mpv Playback Failure Path

- `mpv-play.sh` writes failure lines to stderr, consumed by catalog-service and not normally painted on TV:
  - `FAIL: playback ownership busy`
  - `FAIL: play deadline exhausted before mpv startup`
  - `FAIL: play cancelled`
  - `FAIL: mpv handoff failed`
  - `FAIL: debrid_status_clip duration=<duration>`
  - `FAIL: debrid_copyright_block`
  - `FAIL: mpv did not start playback within <ms>ms`
  at `scripts/m2-catalog/service/mpv-play.sh:149`, `scripts/m2-catalog/service/mpv-play.sh:1098`, and `scripts/m2-catalog/service/mpv-play.sh:1151`.
- If failure occurs after the launcher has been hidden but before mpv is raised, `mpv-stop.sh` is invoked, so the visible sequence is likely black root then launcher restore.

## 8. On-Screen Text Outside Browser

### Searched Direct Overlay/Notification Tools

No current runtime use was found for:

- `xmessage`
- `notify-send`
- `osd_cat`
- `zenity`
- `yad`
- `gxmessage`
- `kdialog`
- `chvt` / `openvt` production display switching

The only direct non-browser on-screen message found is mpv's native OSD fallback:

- `mp.osd_message("Streams are unavailable for this playback.", 2)` at `scripts/m2-catalog/service/mango-hud.lua:522`.

### Terminal / VT Output That Could Be Visible If Run Locally

Most stack scripts are run via systemd, SSH, or redirected logs. If the user runs them on a visible desktop terminal/VT, these strings can appear:

- `start-mango-ui.sh`: `mango UI running at http://127.0.0.1:<port>/` at `scripts/m1-foundation/ui/start-mango-ui.sh:119`.
- `start-mango-launcher-chromium.sh` stderr:
  - `chromium is required for MANGO_LAUNCHER_BROWSER=chromium`
  - `firefox is required for MANGO_LAUNCHER_BROWSER=firefox`
  - `chromium or firefox is required for the TV launcher`
  - `unknown MANGO_LAUNCHER_BROWSER=<value>`
  at `scripts/m1-foundation/ui/start-mango-launcher-chromium.sh:53`.
- `present-launcher.sh`:
  - `! mango launcher window not found`
  - `✓ Launcher focused (already TV-sized)`
  - `✓ Launcher TV-sized (wid=<id> <w>x<h>)`
  - `! Launcher resize incomplete (wid=<id>)`
  at `scripts/lib/present-launcher.sh:93`.
- `launch-launcher.sh`:
  - `launch-launcher busy`
  - `Launcher already focused (<ms>ms)`
  - `Launcher focus requested (<ms>ms)`
  at `scripts/launch-launcher.sh:63`.
- `mango-stack.sh status`:
  - `mango: commit=<sha> voice=<0/1> catalog=<0/1>`
  - `catalog: <json>` / `catalog: down`
  - `launcher: up` / `launcher: down`
  - `launcher browser: up` / `launcher browser: down`
  - `pad: waiting for controller (router alive)` / `pad: ok` / `pad: unhealthy — bash scripts/m1-foundation/pad/pad-health.sh --repair`
  - `indexer: running (competes with mpv)`
  - `voice: up (:8765 WSS, :8766 HUD)` / `voice: down — bash scripts/m5-voice/stack/start-voice-stack.sh` / `voice: disabled`
  at `scripts/mango-stack.sh:195`.
- `bootstrap-after-reboot.sh`:
  - `=== gamepad (press a button on the Micro if connect is slow) ===`
  - `=== openbox + remapper ===`
  - `=== mango stack ===`
  - `=== catalog-service build (first run) ===`
  - `=== TV pad router ===`
  - `=== status ===`
  - `launcher HTTP: <code>`
  - `input-remapper: inactive`
  - `✓ mango ready — launcher + voice (if MANGO_VOICE=1) + catalog (if MANGO_CATALOG=1). D-pad on home.`
  at `scripts/m1-foundation/ui/bootstrap-after-reboot.sh:18`.
- `mango-health-repair.sh` non-quiet strings listed in Category 7.
- `mpv-play.sh` `PASS:` / `FAIL:` lines listed in Category 7.

### Legacy Tk OSD As A Non-Browser Surface

This is not the default path, but remains available via `MANGO_PLAYBACK_OSD_BACKEND=tk`.

- Started only if backend is `tk` in `ensure_playback_osd()` at `scripts/m2-catalog/service/mpv-play.sh:1018`.
- Window:
  - Tk class `mango-playback-osd`, title `mango playback osd`, `overrideredirect(True)`, topmost, bg `#060807`, alpha default `0.92` at `scripts/m2-catalog/service/playback-osd.py:417`.
  - Reference width `1280`, height `172`, margin bottom `48`, scaled by panel height at `scripts/m2-catalog/service/playback-osd.py:50`.
  - On 1080p, geometry is centered bottom like Lua HUD at `scripts/m2-catalog/service/playback-osd.py:430`.
- Drawn elements mirror the Lua HUD, with Tk colours:
  - Elapsed `#f7f1df`, paused `#c9c2b4`.
  - Remaining `#d7c6a0`, paused `#a89f8c`.
  - Status `#c5bca5`.
  - Video green `#9fd4a8`.
  - Display red-ish for 1920 `#d4a09f`.
  - Track `#514b3d`, fill `#ffb84c` / paused `#8a7a5c`, thumb `#ffe1a3` / paused `#b8a88a`.
  at `scripts/m2-catalog/service/playback-osd.py:505`.
- Strings match the normal HUD:
  - `LIVE`
  - `Subtitles: On/Off`
  - `Sub: <label>`
  - `Audio: <label>`
  - `Video: <label>`
  - `Display: <label>`
  - `B pause   ←/→ seek   ↑ osd/subs   A audio   ± vol   Y back`
  at `scripts/m2-catalog/service/playback-osd.py:509`.

