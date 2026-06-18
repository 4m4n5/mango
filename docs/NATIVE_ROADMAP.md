# Native mango — implementation roadmap

**Branch:** `feat/native-experience`  
**Vision:** [`NATIVE_EXPERIENCE.md`](NATIVE_EXPERIENCE.md)  
**First execution phase:** [`tasks/phase-n0-foundation-reset.md`](tasks/phase-n0-foundation-reset.md) · Codex: [`tasks/CODEX-phase-n0-prompt.md`](tasks/CODEX-phase-n0-prompt.md)

---

## Conflict resolution (old → new)

Decisions from Phase 0–2 and the native UX workshop are **merged** below. Where they conflict, **native wins** after N0 cleanup.

| Area | Phase 0–2 (shipped) | Native target | Resolution |
|------|----------------------|---------------|------------|
| **Primary player** | Stremio desktop + Kodi YouTube | **mpv** (addon streams + yt-dlp) | N0: remove Stremio/Kodi from launcher **hot path**; keep installed for fallback only |
| **Launcher** | 3 app tiles | Browse rails + legit catalog | N0: strip **mock catalog**; honest empty/loading shell until N2 |
| **YouTube** | Kodi addon + JSON-RPC | **yt-dlp → mpv** (N6) | N0: document interim `MANGO_LEGACY_YOUTUBE=1` if Kodi needed before N6 |
| **Foreground contract** | `launcher \| stremio \| kodi` | **`launcher \| mpv`** | N0: rewrite contract in `DECISIONS.md`; pad routes ⌂ to launcher, mpv IPC later (N1) |
| **Hide-not-kill** | Stremio/Kodi warm under launcher | mpv process on demand; **no warm Stremio/Kodi at idle** | N0: stop autostarting media apps; archive daily-use `present-stremio` / tile launches |
| **Voice HUD** | Launcher embed + **second overlay Chromium** | Launcher embed **only** | N0: **remove overlay Chromium** and `src/overlay/` from runtime |
| **Orchestrator WS** | Dual uvicorn `:8765` + `:8766` | **Single listener**, loopback-safe | N0: consolidate; fix WebSocket race |
| **STT** | Deepgram default; Whisper optional | Unchanged | N0: keep; disable Whisper warmup paths |
| **TTS** | Off (`tts_enabled: false`) | Unchanged until speaker | N0: skip Piper warmup when disabled |
| **C2 couch test** | Stremio → ⌂ → YouTube → ⌂ → Stremio | **mango → play smoke → ⌂ → mango** | N0: new **N0-C2** gate (launcher + voice + pad; mpv smoke in N1) |
| **stremio-service** | Planned Phase 3 | **`catalog-service`** (stremio-core) | N1+; name locked in N0 docs |
| **Docs** | DESIGN.md = Stremio/Kodi primary | DESIGN.md lags | N0: add banner + pointer to `NATIVE_EXPERIENCE.md`; full DESIGN refresh in N2 |

### Explicit non-goals in N0

- No `catalog-service` feature work  
- No real rails / TMDB / aiostreams integration  
- No mpv 4K tuning (N7) — only **install + IPC skeleton** if needed for N1 spike  
- No removal of Stremio `.deb` or Kodi packages from the Pi image  

---

## Compute budget (Pi 5 · 8 GB · 4K path)

**Principle:** Chromium is **UI only** — never decode 4K in the browser ([Pi 5 Chromium HEVC limitations](https://gist.github.com/schickling/089f4faf412b5267508f758408f0645f); [mpv kiosk pattern](https://git.sr.ht/~jmaibaum/raspberry-mpv-kiosk)).

| At idle (post-N0) | Target |
|-------------------|--------|
| Chromium processes | **1** (`mango-launcher` only) |
| Stremio desktop | **0** |
| Kodi | **0** |
| mpv | **0** |
| Python (orchestrator) | **1** (when voice enabled) |
| Node (companion) | **1** (when voice enabled) |
| tmux sessions | **0** — prefer systemd or `mango-stack.sh` supervisor in N0 |

N0 delivers **`scripts/diag/baseline-metrics.sh`** — RSS, process count, GPU/CPU snapshot — run before/after cleanup to prove headroom.

---

## Phase map

| Phase | Name | Outcome | Couch gate |
|-------|------|---------|------------|
| **N0** | **Foundation reset** | Principled base stack; stripped cruft; metrics + gates | N0-GATE (automated on Pi) |
| **N1** | Catalog + play spike | `catalog-service` + **one title → mpv** with RD stream | N1-SMOKE |
| **N2** | Real browse UI | `catalog.yaml` rails; launcher wired; India/Bollywood | N2-BROWSE |
| **N3** | Stream picker + progress | Simple picker; mango `progress.db` | N3-PLAY |
| **N4** | Library + Continue | Stremio export import; merged Continue rail; write-back spike | N4-CONTINUE |
| **N5** | AI catalogs + voice tools | 3 home slots; LLM create/list catalogs | N5-AI |
| **N6** | YouTube | yt-dlp rail; remove Kodi from default path | N6-YT |
| **N7** | 4K + fallback polish | mpv 4K flags; Stremio hidden fallback; systemd persistence | N7-SHIP |

---

## N0 — Foundation reset (detail)

**Spec:** [`tasks/phase-n0-foundation-reset.md`](tasks/phase-n0-foundation-reset.md)

Inventory → strip → consolidate → document → measure on Pi.

**Remove from default runtime**

- Second Chromium (`mango-overlay`)  
- `ensure-tv-overlay.sh` from voice stack start  
- Mock catalog production path (`mock-catalog.ts` → dev-only or delete)  
- Launcher tiles that cold-start Stremio/Kodi on daily use  
- Dual uvicorn orchestrator threads  
- Piper warmup when `tts_enabled: false`  
- Obsolete task docs pointers where misleading  

**Keep**

- Launcher kiosk + `serve.py`  
- `mango-tv-pad.py` (extend contract doc for future mpv mode)  
- Orchestrator + companion + launcher voice HUD  
- Deepgram STT path  
- Stremio/Kodi **binaries** + launch scripts behind `MANGO_FALLBACK_*`  
- Phase 0 pad/X11/Openbox stack  

**Add**

- `scripts/diag/baseline-metrics.sh`  
- `scripts/phase-n0/gate-n0.sh`  
- `scripts/mango-stack.sh` (or systemd) — single entry to start/stop voice + UI  
- `docs/FOREGROUND.md` — launcher \| mpv contract  
- Updated `pi-pre-couch-gate.sh` for `feat/native-experience`  

---

## N1 — Catalog + play spike

- `src/catalog-service/` — Node + `@stremio/stremio-core-web` (or HTTP bridge)  
- Load addons from exported config: Cinemeta, Torrentio, **aiostreams**  
- Endpoints: `GET /health`, `GET /meta/:type/:id`, `GET /stream/:type/:id`, `POST /play` → mpv IPC  
- **Validation:** resolve one known title; play RD HTTP stream in mpv on Pi; log TTFF  

---

## N2 — Real browse UI

- `config/catalog.example.yaml` + user `catalog.yaml`  
- Rails: Continue (placeholder), Bollywood (TMDB list), addon catalogs  
- Launcher: fetch `/rails` from catalog-service; remove mocks  
- Title detail screen (minimal)  

---

## N3 — Stream picker + progress

- Simple picker UI (2–5 streams; aiostreams sort + language filter)  
- `progress.db` + mpv watch-later position  
- ⌂ returns to launcher &lt; 300 ms with mpv killed or paused per contract  

---

## N4 — Library + Continue

- Stremio export file import (`/etc/mango/stremio-export.json`)  
- Continue rail: **Stremio library first**, mango mpv resume second  
- Finish → write-back to Stremio library (best-effort)  
- Progress backup cron or on-exit  

---

## N5 — AI catalogs

- Persisted named catalogs (`/etc/mango/ai-catalogs/`)  
- Max 3 on home; frozen vs live per catalog  
- Orchestrator tools: `create_catalog`, `list_catalogs`, `search_titles`, `play_title`  

---

## N6 — YouTube

- yt-dlp resolve + mpv play  
- Separate YouTube rail; voice `play_youtube`  
- Deprecate Kodi YouTube tile when gate passes  

---

## N7 — 4K + ship

- mpv: `hwdec`, 4K HDMI mode verification, audio sync  
- Stremio desktop fallback on stream exhaustion  
- systemd units for full stack  
- Merge criteria to `main`  

---

## Foreground contract (target)

| State | Visible | Hidden | Input owner | ⌂ behavior |
|-------|---------|--------|-------------|------------|
| `launcher` | Chromium mango UI | mpv, Stremio, Kodi | `mango-tv-pad.py` | noop / already home |
| `mpv` | mpv fullscreen | launcher (below) | pad → mpv IPC (N1+) | stop/pause mpv → `launch-launcher.sh` |
| `fallback_stremio` | Stremio player | launcher | pad → Stremio | ⌂ → launcher; hide Stremio |

Full spec: `docs/FOREGROUND.md` (created in N0).

---

## References

- [`NATIVE_EXPERIENCE.md`](NATIVE_EXPERIENCE.md) — product + architecture decisions  
- [`PHASE2.md`](PHASE2.md) — voice pipeline (keep on reset)  
- [`PHASE0.md`](PHASE0.md) — Pi ops (partially superseded by N0)  
- [`DECISIONS.md`](DECISIONS.md) — updated in N0  
