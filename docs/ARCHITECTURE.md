# mango — architecture

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md)

Stack layers, foreground contract, and API boundaries. Policy lives here — not duplicated in task docs.

---

## Layer model

```
Launcher (:3000)  →  catalog-service (:3020)  →  addons (Stremio protocol)
                              ├→ Mango library state
                              └→ mpv play orchestrator
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **AIOStreams** (`:3035`) | Aggregate indexers + debrid, dedup, SEL, formatter | Lab 1080p cap, mpv probe, auto-play |
| **AIOMetadata** (`:3036`) | mdblist catalog adapters | Stream resolve |
| **catalog-service** | Rails YAML, Mango library state, play orchestrator, stream metadata, playability, voice `/voice/*` | Indexer credentials, debrid keys |
| **Launcher** | Browse UI, detail, picker, voice command poll | Stream ranking (trust upstream + filters) |
| **mpv** | Decode + render | Catalog metadata |
| **orchestrator** | STT · LLM · launcher dispatch | Catalog data · mpv IPC |

**Rule:** Push dedup, junk keywords, debrid order, and row limits **upstream** into AIOStreams. Keep probe-time policy, lab quality cap, and auto-play tiers in **catalog-service**.

### Couch activity and maintenance boundary

Silent maintenance depends on a shared activity marker at
`~/.cache/mango/couch-activity.json`. Pad input, launcher activity, voice
turns, mpv play/stop, and playback progress writes update only timestamp,
source, hint, and pid. Maintenance checks the marker before disruptive phases
and writes operator JSON when deferred; no TV surface shows grow/debug state.

Display anti-sleep is part of couch mode: X11 DPMS and screensaver blanking are
disabled, and controller input wakes the display through
`scripts/lib/mango-display-wake.sh`. Launcher focus is restored only when mpv is
not active.

Launcher display mode is separate from playback stream policy. Couch mode
applies a lightweight launcher mode through `scripts/lib/mango-display-mode.sh`;
the default is `1920x1080@60` so browse/focus stays smooth on the Pi. mpv owns
playback and may later opt into its own display mode via `MANGO_MPV_DISPLAY_*`
after 4K decode/display gates prove it reliable.

### Playability layer

`playability.db` has two related but distinct surfaces:

| Surface | Role |
|---------|------|
| `titles` | Global verified/failed state and TTLs for unique playable titles |
| `rail_pool` | Thematic per-rail membership used by couch-visible browse sessions |

The theme gate (`rail-theme-gate.ts`) enforces `config/rail-theme-profiles.yaml` on grow/link/verify pool writes. Grow runs operate on an isolated work DB and publish the live DB after a completed publishable run; per-rail `+20` shortfalls are operator warnings by default, while failed or aborted runs preserve the previous couch snapshot. Finalization attaches verified orphans and caps unpinned overlap without full metadata retheme. See [PLAYABILITY.md](PLAYABILITY.md).

### Mango library state

Mango is the user-library source of truth. `progress.db` owns resume today; M6.1 extends that with Mango-owned saved/watchlist, history, finished, hidden/blocked, and taste/profile state. `/etc/mango/stremio-export.json` remains an addon-manifest graph only, not a Stremio user-library sync source.

---

## Module graph

```
                    ┌─────────────┐
                    │  companion  │─── HTTPS :3001
                    └──────┬──────┘
                           │ WSS :8765
                    ┌──────▼──────┐
                    │ orchestrator│─── loopback :8766 → launcher HUD
                    └──┬───┬───┬──┘
           ┌───────────┘   │   └───────────┐
           ▼               ▼               ▼
   catalog-service      mpv IPC      fallback apps
   (:3020)              (player)     (Stremio/Kodi)
           │
           ▼
   stremio-core + addons (Cinemeta, AIOStreams, AIOMetadata)
```

### Repo layout

```
src/launcher/           TV UI + voice-hud.ts + voice-commands.ts
src/catalog-service/    Stremio-compatible bridge · Mango library · play · playability · AI catalogs
src/mango-ui-server/    serve.py — static + health + launch API + catalog proxy
src/orchestrator/       voice hub (FastAPI)
src/companion/          phone PWA
scripts/mango-stack.sh  native base stack supervisor
scripts/mango-health-repair.sh  watchdog repair: stale locks · pad · catalog · launcher
```

---

## Foreground contract

`mango-stack.sh` owns the base stack. At idle: launcher Chromium + pad + (optional) voice. **No** Stremio, Kodi, mpv, or overlay Chromium.

| State | Visible | Hidden | Input owner | ⌂ behavior |
|-------|---------|--------|-------------|------------|
| `launcher` | Chromium mango UI | mpv stopped | `mango-tv-pad.py` | noop / present launcher |
| `mpv` | mpv fullscreen | launcher below | pad → mpv IPC | stop mpv → launcher <300 ms |
| `fallback_stremio` | Stremio player | launcher below | pad → Stremio | present launcher |

### Input routing

| Foreground | B (`304`) | Y (`308`) | Home (`316`/`311`) |
|------------|-----------|-----------|---------------------|
| `launcher` | select | back / settings | noop |
| `mpv` | play/pause | stop → launcher | stop → launcher |
| `fallback_stremio` | select | Escape | launcher |

Pad layout: [HARDWARE.md](HARDWARE.md)

### Must never happen

- Wallpaper/desktop with no launcher after Home
- More than one Chromium at idle
- Stremio or Kodi running at idle after `mango-stack.sh start`
- Launcher up while catalog rails/live readiness or the current pad event owner is unhealthy
- Second orchestrator listener on `:8766`

Fallback env: `MANGO_FALLBACK_STREMIO=1` · `MANGO_LEGACY_YOUTUBE=1`

---

## Stream API

`GET /stream/{type}/{id}` — series episodes: `series/tt12004706:1:1`

| Query | Mode |
|-------|------|
| `language` | Hard filter |
| `preferred_language` | Soft rank boost |
| `max_quality` / `min_quality` | Lab cap / floor |
| `include_uncached` | Debug only |

Enriched fields: `display_label`, `release_group`, `encode`, `size_gb`, `languages`, `debrid_service`, `cache_status`.

`POST /play` — orchestrator with ladder tiers · optional `{ url }` from picker.

---

## Voice stack (M5)

```
Phone companion (:3001) ──WSS──► orchestrator (:8765)
                                      ├─► catalog-service /voice/*
                                      └─► launcher POST /api/voice/command
Launcher voice-hud ◄── WS loopback :8766
```

**Rule:** Voice opens detail/results only — playback stays on pad **B**. No `mango_play` or `play_youtube` in manifest.

Detail: [VOICE.md](VOICE.md)

---

## Stremio addon graph

```
Catalog addons  →  title IDs in rails / lists
Meta (Cinemeta) →  poster, plot, seasons
Stream (via AIOStreams) →  playable URLs
```

mango does **not** reindex torrents. It runs the same protocol Stremio uses for addon catalogs, metadata, and streams; Mango-owned library/progress state stays separate.

---

## Compute budget (Pi 5 · 8 GB)

| At idle | Target |
|---------|--------|
| Chromium | **1** (`mango-launcher`) |
| Stremio / Kodi / mpv | **0** |
| Python (orchestrator) | **1** when voice on |
| Node (companion + catalog) | when voice / catalog on |

Chromium is **UI only** — never decode 4K in the browser. mpv owns playback.

| Milestone | Display | Notes |
|-------|---------|-------|
| M1–M5 (lab/couch) | 1080p60 launcher · headphones | `max_quality: 1080p` in filters |
| M6 (ship) | 4K TV · soundbar eARC | mpv 4K profile · relax filters |

---

## Gates {#gates}

| Gate | When |
|------|------|
| `gate-lite.sh` | Default deploy (~2 min) |
| `MANGO_GATE_FULL=1` | Full gate (~5–8 min, 3 plays/rail) |
| `gate-m4-self-hosted.sh` | Self-hosted addons |
| `gate-live-iptv.sh` | Opt-in live only |

See [STATUS.md](STATUS.md#gates).

---

## Launcher API (serve.py)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | launcher, chromium, pad |
| `GET` | `/api/info` | hostname, IP, ports |
| `POST` | `/api/activity/touch` | localhost-only couch activity timestamp |
| `POST` | `/api/perf` | localhost-only launcher timing log |
| `POST` | `/api/launch/launcher` | Home · debounced 2 s |
| `POST` | `/api/voice/command` | Orchestrator → launcher dispatch |
| `GET` | `/api/voice/commands` | Launcher poll |
| `*` | `/api/catalog/*` | Proxy → `:3020` |

Fallback launch endpoints (`/api/launch/stremio`, `/api/launch/kodi`) — opt-in only.

---

## References

| Doc | Use |
|-----|-----|
| [STATUS.md](STATUS.md) | Shipped features |
| [reference/addon-stack.md](reference/addon-stack.md) | Operator addon setup |
| [reference/aiostreams-profile.md](reference/aiostreams-profile.md) | AIOStreams headless profile |
| [DECISIONS.md](DECISIONS.md) | Locked implementation choices |
