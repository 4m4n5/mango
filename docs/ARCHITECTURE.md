# mango — architecture

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md)

Stack layers, foreground contract, and API boundaries. Policy lives here — not duplicated in task docs.

---

## Layer model

```
Launcher (:3000)  →  catalog-service (:3020)  →  addons (Stremio protocol)
                              ↓
                         mpv play orchestrator
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **AIOStreams** (`:3035`) | Aggregate indexers + debrid, dedup, SEL, formatter | Lab 1080p cap, mpv probe, auto-play |
| **AIOMetadata** (`:3036`) | mdblist catalog adapters | Stream resolve |
| **catalog-service** | Rails YAML, play orchestrator, stream metadata, playability, voice `/voice/*` | Indexer credentials, debrid keys |
| **Launcher** | Browse UI, detail, picker, voice command poll | Stream ranking (trust upstream + filters) |
| **mpv** | Decode + render | Catalog metadata |
| **orchestrator** | STT · LLM · launcher dispatch | Catalog data · mpv IPC |

**Rule:** Push dedup, junk keywords, debrid order, and row limits **upstream** into AIOStreams. Keep probe-time policy, lab quality cap, and auto-play tiers in **catalog-service**.

### Playability layer

`playability.db` has two related but distinct surfaces:

| Surface | Role |
|---------|------|
| `titles` | Global verified/failed state and TTLs for unique playable titles |
| `rail_pool` | Thematic per-rail membership used by couch-visible browse sessions |

The theme gate (`rail-theme-gate.ts`) enforces `config/rail-theme-profiles.yaml` on grow/link/verify pool writes. Strict grow runs operate on an isolated work DB and publish the live DB only after every active rail reaches its fresh quota; failed or partial runs preserve the previous couch snapshot. Finalization attaches verified orphans and caps unpinned overlap without full metadata retheme. See [PLAYABILITY.md](PLAYABILITY.md).

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
src/catalog-service/    Stremio-core bridge · play · playability · AI catalogs
src/mango-ui-server/    serve.py — static + health + launch API + catalog proxy
src/orchestrator/       voice hub (FastAPI)
src/companion/          phone PWA
scripts/mango-stack.sh  native base stack supervisor
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

**Rule:** Voice opens detail only — playback stays on pad **B**. No `mango_play` in manifest.

Detail: [VOICE.md](VOICE.md)

---

## Stremio addon graph

```
Catalog addons  →  title IDs in rails / lists
Meta (Cinemeta) →  poster, plot, seasons
Stream (via AIOStreams) →  playable URLs
```

mango does **not** reindex torrents. It runs the same protocol Stremio uses.

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
| M1–M5 (lab) | 1080p monitor · headphones | `max_quality: 1080p` in filters |
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
