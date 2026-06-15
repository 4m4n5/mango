# ai-tv-box — V1 Build Spec

**Platform:** Raspberry Pi 5 (8GB) · Raspberry Pi OS 64-bit desktop · **X11 + Openbox**  
**Estimate:** 6–8 weeks part-time · Ship when **V1 Core** criteria pass

---

## Product

Dual-mode TV box:

1. **Streaming box** — launcher → full **Stremio** and **YouTube** (Kodi) apps, navigated with FLIRC/gamepad/phone.
2. **AI layer** — phone push-to-talk for chat, search, recommendations, playback; TV **overlay** for status/toasts.

Voice uses the **phone mic** (WebSocket to Pi). FLIRC/gamepad are navigation only.

---

## Hardware


| Required     | Spec                                                        |
| ------------ | ----------------------------------------------------------- |
| Pi 5         | 8GB RAM, active cooling                                     |
| Storage      | 64GB+ SD; 128GB+ or NVMe preferred                          |
| TV           | HDMI from Pi                                                |
| Network      | Ethernet recommended                                        |
| Phone/tablet | Same WiFi — mic + companion remote PWA                      |
| Couch input  | **FLIRC + IR remote** and/or **USB gamepad** (one required) |



| Optional | Spec                 |
| -------- | -------------------- |
| NVMe HAT | Faster model/OS load |


Shopping details: `[HARDWARE.md](HARDWARE.md)`

---

## Platform constraints


| Decision                 | Choice                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| Display stack            | **X11 + Openbox** (xdotool, overlay, key injection)                   |
| Voice input              | Phone browser → WebSocket → faster-whisper `base.en` on Pi            |
| Voice output             | Piper → TV speakers; duck playback 30–50% while listening             |
| LLM                      | Hybrid cloud API + local tool execution                               |
| Stremio UI               | Official desktop app (fallback: stremio-web in Chromium)              |
| Stremio voice            | stremio-service (stremio-core) → `stremio://` deep link → desktop app |
| YouTube UI + voice       | Kodi 21 + `plugin.video.youtube` + JSON-RPC                           |
| Players                  | **Dual:** Stremio app + Kodi; orchestrator tracks foreground app      |
| Stremio controls (voice) | Media keys via xdotool when Stremio focused                           |
| Kodi controls (voice)    | JSON-RPC                                                              |
| Playback context         | Kodi: accurate; Stremio: library sync (~90s lag)                      |
| Addons                   | Manual setup in Stremio desktop app                                   |
| Secrets                  | `/etc/ai-tv-box/` — mode `600`, never in repo                         |


---

## Scope

### V1 Core (release gate)


| Area     | Features                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------- |
| UI       | Launcher (Stremio · YouTube · Settings), Stremio desktop, Kodi YouTube, phone companion (PTT + D-pad + transport), AI overlay |
| Voice    | PTT, STT, TTS, hybrid LLM, general chat, session memory                                                                       |
| Stremio  | Voice search/play, recommendations, library/continue, watch-later                                                             |
| YouTube  | Voice search/play                                                                                                             |
| Playback | Pause/seek/volume — Kodi full; Stremio media keys                                                                             |
| Ops      | Self-diagnostics                                                                                                              |


### V1 Stretch (after Core)


| Feature              | Limit                                       |
| -------------------- | ------------------------------------------- |
| Recap, watch-and-ask | Kodi reliable; Stremio approximate          |
| Voice subtitles      | Kodi/YouTube only                           |
| Stremio ARM install  | stremio-web fallback if desktop unavailable |


### V2 (not V1)

Wake word, room mic, on-screen actor ID, Stremio subtitle voice, addon voice install, CEC/IR, profiles, Home Assistant, skip intro, Wayland, FLIRC wizard in Settings.

### Out of scope

Netflix/Disney+/Prime on external sticks, watch party, custom recommender model.

---

## Architecture

```
TV:  [ Launcher | Stremio app | Kodi/YouTube ]  +  AI overlay (badge + toasts)
       ▲ FLIRC/gamepad (keyboard)     ▲ phone companion (audio + keys over LAN)
       └──────────── Raspberry Pi 5 ──┘
                    orchestrator · Whisper · Piper · stremio-service
                    cloud LLM (tool calls)
```

### Components


| Component       | Stack                   | Role                              |
| --------------- | ----------------------- | --------------------------------- |
| launcher        | Web fullscreen          | Home; launch apps                 |
| stremio-app     | Official desktop        | Normal Stremio UX                 |
| kodi            | Kodi 21 + YouTube addon | Normal YouTube UX + voice RPC     |
| orchestrator    | Python 3.11+            | Voice, LLM, tools, focus tracking |
| stremio-service | Node + stremio-core-web | Voice catalog/library APIs        |
| overlay         | Chromium always-on-top  | AI status on TV                   |
| companion       | PWA on `:3001`          | Phone mic + remote                |


### systemd

```
ai-tv-orchestrator.service
ai-tv-launcher.service
ai-tv-companion.service
ai-tv-stremio-service.service
kodi.service
```

Stremio desktop: launched on demand from launcher.

### Repository

```
src/orchestrator/     # voice, LLM, tools, session
src/launcher/
src/overlay/
src/companion/
src/stremio-service/
src/adapters/         # kodi_rpc, stremio_deeplink, window_focus, tmdb
scripts/install.sh
scripts/systemd/
config/config.example.yaml
```

---

## UI spec

### Launcher (TV `:3000`)

Tiles: **Stremio** · **YouTube** · **Settings**. No AI tile — AI always via phone + overlay.  
Back (Esc / FLIRC) from apps returns to launcher. Minimize launcher when app is fullscreen.

### Phone companion (`http://<pi-ip>:3001`)

Hold-to-talk · D-pad · OK · Back · Home · play/pause · rewind 30s · app launch · transcript.

WebSocket events: `state`, `transcript`, `now_playing`, `focus_app`, `key`.

### Overlay

Bottom-corner badge (idle / listening / thinking / speaking) + auto-dismiss reply toast (~8s).

---

## LLM tools

Orchestrator exposes JSON-schema tools; LLM never executes URLs directly.

```yaml
# Media
search_stremio:       { query, type? }
play_stremio:         { id, season?, episode? }   # → stremio:// deep link
recommend_stremio:    { mood?, genres?, max_runtime?, exclude_genres?, similar_to? }
library_continue_watching: {}
library_add_watch_later:   { id }
search_youtube:       { query }
play_youtube:         { video_id }
launch_app:           { app: launcher|stremio|youtube|settings }

# Playback
player_command:       { action: pause|resume|seek|volume, value? }

# Context (Stretch)
get_playback_context: {}   # confidence: high|approx|none
recap:                { scope, spoiler_free }
ask_about_content:    { question }

# Subtitles (Stretch, Kodi only)
subtitle_fetch:       { language }
subtitle_select:      { track_index }

# Ops
system_diagnostics:   {}
```

**LLM rules:** Prefer tools for actions; keep last search results in context; spoiler-safe recaps; refuse on-screen actor questions (offer TMDB cast instead).

**Latency target:** 3–8s perceived (streaming TTS on first sentence).

---

## Integrations

### Stremio


| Surface | Path                                                                |
| ------- | ------------------------------------------------------------------- |
| Manual  | Desktop app — browse, addons, library, play                         |
| Voice   | stremio-service → resolve ID → `launch_app(stremio)` + `stremio://` |


Login once in desktop app; export shared token to stremio-service.

### Kodi / YouTube

- Enable web server + JSON-RPC (`localhost:8080`, auth required).
- Voice: `Player.Open` with `plugin://plugin.video.youtube/...` URLs.
- Pin working addon version; check in diagnostics.

### TMDB (Stretch)

Free API key for recap / watch-and-ask metadata.

---

## Configuration

Copy `[config/config.example.yaml](../config/config.example.yaml)` to `/etc/ai-tv-box/config.yaml`.

Required keys: LLM provider + API key, Kodi credentials, Stremio credentials (after login), TMDB key (Stretch).

---

## Build phases


| Phase               | Duration | Deliverables                                                                                    |
| ------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| **0 — Bring-up**    | 3–4 days | X11/Openbox, FLIRC, Kodi+YouTube manual, Stremio install, `stremio://` test, phone→Whisper test |
| **1 — UI shell**    | 1 week   | Launcher, app launch/back, overlay badge, companion D-pad                                       |
| **2 — Voice**       | 1 week   | PTT pipeline, LLM chat, TTS, overlay toasts, volume ducking                                     |
| **3 — Media tools** | 2 weeks  | stremio-service, Kodi RPC, play/search/recommend/library, focus detection, session memory       |
| **4 — Stretch**     | 1 week   | TMDB, recap/ask, Kodi subtitles, diagnostics                                                    |
| **5 — Polish**      | ongoing  | First-boot wizard, stremio-web fallback, error TTS                                              |


---

## Success criteria

**Core (must pass)**

1. Launcher → Stremio → browse/play with FLIRC or gamepad only.
2. Launcher → Kodi YouTube → search/play with remote only.
3. Phone companion navigates TV without voice.
4. PTT → “Play *The Bear* on Stremio” → plays in Stremio app <10s.
5. “Something like *Arrival* but shorter” → picks → “play the second” works.
6. PTT → “Play lofi on YouTube” → Kodi plays.
7. “Pause” / “go back 30 seconds” during Kodi playback.
8. “Why is the box slow?” → spoken diagnostics.
9. Manual Stremio use + voice without restart.
10. Back → launcher from any app.

**Stretch**

1. Recap/plot questions during Kodi playback.
2. Voice watch-later appears in Stremio app.
3. Voice subtitles in Kodi.
4. “What show is this?” during Stremio playback (approx).

---

## Risks


| Risk                         | Mitigation                               |
| ---------------------------- | ---------------------------------------- |
| Stremio ARM desktop missing  | stremio-web fallback                     |
| `stremio://` deep link fails | Keyboard search automation (last resort) |
| YouTube addon breaks         | Pin version; diagnostics                 |
| Dual-player / focus bugs     | Explicit `focus_app` state               |
| Wayland breaks xdotool       | Pin X11 for V1                           |
| RAM pressure (8GB)           | Hide launcher when app fullscreen        |


---

## Security

- API keys, Kodi/Stremio creds: `/etc/ai-tv-box/`, not in git.
- Tools validate IDs; no arbitrary URL execution from LLM.
- Kodi JSON-RPC bound to localhost.

