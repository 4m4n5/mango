# Native mango experience — vision & ideation

**Branch:** `feat/native-experience`  
**Status:** Ideation · active on `feat/native-experience`  
**Intent:** TV-first, AI-driven box where **mango owns the UX**; Stremio/Kodi become playback engines, not the primary interface.

---

## Problem statement

Today mango is a **polished shell** around **desktop apps**:

- Launcher is 10ft-native ✓
- Voice + chat work ✓
- Stremio and Kodi YouTube are **not** designed for couch · D-pad fakes a keyboard

Users feel the fracture: mango on the home screen, then “some other app” for browse and play. That blocks the “AI TV box of the future” vibe.

---

## Product north star

> **Ask or browse in mango. Watch in a player. Never wonder which app you’re in.**

| Principle | Meaning |
|-----------|---------|
| **Content forward** | Posters, rails, and “play” — not window chrome |
| **AI is ambient** | Voice and suggestions are woven in, not a separate mode |
| **One focus model** | D-pad always does the obvious thing |
| **Players are invisible** | Stremio/Kodi open fullscreen playback; mango owns everything before “play” |
| **Phone is optional** | Mic + rich chat on phone; TV must stand alone for browse |

---

## Experience map (target)

```
┌─────────────────────────────────────────────────────────────┐
│  mango home                                                    │
│  ┌─────────────┐  ┌──────────────────────────────────────────┐ │
│  │ voice chip  │  │ Continue · Because you watched · New      │ │
│  │ (listening) │  │ Search · Library · Apps (advanced)        │ │
│  └─────────────┘  └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
         │ voice: "sci-fi under 2 hours"
         ▼
┌─────────────────────────────────────────────────────────────┐
│  mango results (10ft grid)                                     │
│  [poster] [poster] [poster] …                                  │
│  B = play · Y = back · metadata + AI blurb optional            │
└─────────────────────────────────────────────────────────────┘
         │ play
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Stremio or Kodi — fullscreen player ONLY                      │
│  ⌂ = mango home · minimal now-playing bar (future)             │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical strategy (layers)

| Layer | Owner | Stack |
|-------|-------|-------|
| **Shell UI** | mango | Vite + TS in launcher (expand) or `src/tv/` SPA in kiosk |
| **Voice + session** | mango | Existing orchestrator — extend with tools |
| **Catalog / library** | adapters | `stremio-service` (stremio-core) · Kodi JSON-RPC · TMDB metadata |
| **Playback** | engines | `stremio://` deep links · Kodi YouTube plugin · hide-not-kill unchanged |
| **Input** | mango | `mango-tv-pad.py` — focus in mango UI vs player modes |

**Non-goal (V1 native):** Rebuild video decoders, DRM, or subtitle pipelines.

---

## Phased delivery (proposal)

### N0 — Foundation (this branch first)

- [x] `docs/NATIVE_EXPERIENCE.md` + IA in repo
- [x] Focus system — roving 2D grid (`src/launcher/src/focus.ts`)
- [x] Home shell — horizontal rails + poster cards (`home.ts`, `mock-catalog.ts`)
- [ ] Orchestrator refactor: single WS server · thread-safe hub
- [ ] Remove redundant overlay Chromium if launcher HUD suffices

### N1 — Browse rails (MVP native feel)

- [ ] Home: **Continue watching** rail (Stremio library via service)
- [ ] Home: **Search** overlay (10ft keyboard or voice-only v1)
- [ ] Play hands off to Stremio/Kodi · return to mango home on ⌂
- [ ] LLM tool: `search_stremio` · `play_stremio` · `search_youtube` · `play_youtube`

### N2 — AI integration

- [ ] “Ask mango” rail — curated picks from LLM + catalog tools
- [ ] Unified results screen (movies + YouTube in one grid with badges)
- [ ] TV shows reply + structured cards (not paragraph-only)

### N3 — Player chrome

- [ ] Now-playing bar (title, pause, seek) in mango overlay during playback
- [ ] Optional: migrate YouTube to mango-owned player path if Kodi UX blocks

### N4 — Polish

- [ ] Onboarding · settings in 10ft UI
- [ ] systemd · reboot persistence
- [ ] TTS when speaker attached

---

## Open design questions

1. **Single SPA vs launcher-only** — expand `src/launcher` or new `src/tv` routed inside same Chromium?
2. **Stremio browse** — never show desktop app except playback, or “Advanced → open Stremio” tile?
3. **YouTube** — stay Kodi-backed or explore TV web / Invidious (ToS risk)?
4. **Hinglish** — UI copy language · STT already multi · LLM reply language default?
5. **Phone role** — remote-only vs required for best experience?

---

## Success metrics (couch)

| Test | Pass |
|------|------|
| Find and play a movie **without opening Stremio browse UI** | Voice or rails only |
| Continue watching from cold start in **< 3 pad presses** | From mango home |
| ⌂ from player returns to **mango home** in **< 300 ms** | C2 regression |
| User describes device as **“mango”** not “Pi with Stremio” | Subjective |

---

## Relationship to `main`

| `main` | `feat/native-experience` |
|--------|--------------------------|
| Phase 0–2 shipped · stable couch shell | Product UX overhaul |
| Bugfixes · Pi ops | IA · new screens · stremio-service |
| Merge back when rails + tools are couch-signed | |

Keep `main` deployable for daily TV use while the branch prototypes.

---

## References

- [`DESIGN.md`](DESIGN.md) — original V1 spec (LLM tools §)
- [`PHASE2.md`](PHASE2.md) — voice pipeline (shipped)
- [`PLAN.md`](PLAN.md) — roadmap with native fork
- [`DECISIONS.md`](DECISIONS.md) — locked choices per branch
