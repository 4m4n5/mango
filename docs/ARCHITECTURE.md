# mango — architecture

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md)

Stack layers, foreground contract, and API boundaries. Policy lives here — not duplicated in task docs.

---

## Layer model

```
Launcher (:3000)  →  catalog-service (:3020)  →  addons (Stremio protocol)
                              ├→ Mango library state
                              ├→ YouTube API/cache
                              └→ mpv play orchestrator
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **AIOStreams** (`:3035`) | Aggregate indexers + debrid, dedup, SEL, formatter | Lab 1080p cap, mpv probe, auto-play |
| **AIOMetadata** (`:3036`) | mdblist catalog adapters | Stream resolve |
| **catalog-service** | Rails YAML, Mango library state, YouTube cache/API, play orchestrator, stream metadata, playability, voice `/voice/*` | Indexer credentials, debrid keys, Google secrets |
| **Launcher** | Browse UI, detail, picker, voice command poll | Stream ranking (trust upstream + filters) |
| **mpv** | Decode + render | Catalog metadata |
| **orchestrator** | STT · LLM · launcher dispatch | Catalog data · mpv IPC |

**Rule:** Push dedup, junk keywords, debrid order, and row limits **upstream** into AIOStreams. Keep probe-time policy, lab quality cap, and auto-play tiers in **catalog-service**.

### Couch activity and maintenance boundary

Silent maintenance depends on a shared activity marker at
`~/.cache/mango/couch-activity.json`. Real couch activity means pad input,
launcher key/clicks, voice turns, mpv play/stop, and playback progress; launcher
process startup alone is not activity. Maintenance checks the marker before
disruptive phases and writes operator JSON when deferred; no TV surface shows
grow/debug state.

Display anti-sleep is part of couch mode: X11 DPMS and screensaver blanking are
disabled, and controller input wakes the display through
`scripts/lib/mango-display-wake.sh`. Launcher focus is restored only when mpv is
not active.

Launcher display mode is separate from playback stream policy. Couch mode
applies a lightweight launcher mode through `scripts/lib/mango-display-mode.sh`;
the default is `1920x1080@60` so browse/focus stays smooth on the Pi. The
compatibility entrypoint remains `mpv-play.sh`, but target-TV couch playback can
use `MANGO_PLAYBACK_BACKEND=vlc` for every resolution. In that mode Mango stops
the Chromium launcher while fullscreen video is active, disables `xcompmgr` to
avoid tearing, source-matches the TV display mode, and returns to the launcher
mode on stop.

### Playability layer

`playability.db` has two related but distinct surfaces:

| Surface | Role |
|---------|------|
| `titles` | Global verified/failed state and TTLs for unique playable titles |
| `rail_pool` | Thematic per-rail membership used by couch-visible browse sessions |

The theme gate (`rail-theme-gate.ts`) enforces `config/rail-theme-profiles.yaml` on grow/link/verify pool writes. Grow runs operate on an isolated work DB and publish the live DB after a completed publishable run; per-rail `+20` shortfalls are operator warnings by default, while failed or aborted runs preserve the previous couch snapshot. Finalization attaches verified orphans and caps unpinned overlap without full metadata retheme. See [PLAYABILITY.md](PLAYABILITY.md).

### Mango library state

Mango is the user-library source of truth. `progress.db` remains the M6.1
Continue/resume source for compatibility, while `/etc/mango/library.db` owns
explicit Saved rows, automatic history, finished state, current TV context, and
dormant hidden/blocked fields. Playback updates Continue/history but never
auto-saves. Existing user-facing Pins import once into Saved; `/pins` stays as
a compatibility API over Saved. Internal playability rail-curation pins remain
operator policy and are not user library state.

`/etc/mango/stremio-export.json` remains an addon-manifest graph only, not a
Stremio user-library sync source.

### YouTube cache and user state

Native YouTube is a first-class source but not a second user library. The
rebuildable `/etc/mango/youtube.db` caches YouTube metadata, rail membership,
recommender reservoirs, refresh/quota state, and temporary OAuth sessions.
Durable user state stays in `/etc/mango/library.db` with `source="youtube"` for
Saved videos, history, finished state, current detail context, and local Not
Interested feedback.

The YouTube Data API is used for metadata/search/subscription refresh only.
Playback resolves through `yt-dlp -> mpv`; API quota does not govern cached
playback, but `yt-dlp` failures such as 403/429/CAPTCHA are surfaced as
couch-safe playback errors. Channels and playlists open detail lists; only
videos can be Saved in M6.2.

YouTube rail reservoirs are intentionally few and rebuildable: For You targets
1,000 candidates; Fresh Finds and Popular target 300 each; Because You Watched
targets 240 per latest meaningful seed; Live Now targets 120 short-TTL live
candidates; New From Subscriptions keeps up to 160 unwatched upload candidates.
`GET /youtube/rails?reshuffle=1` samples from those caches plus Mango-local
History and does not call YouTube at couch time.

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
src/catalog-service/    Stremio-compatible bridge · Mango library · YouTube · play · playability · AI catalogs
src/mango-ui-server/    serve.py — static + health + launch API + catalog proxy
src/orchestrator/       voice hub (FastAPI)
src/companion/          phone PWA
scripts/mango-stack.sh  native base stack supervisor
scripts/mango-health-repair.sh  watchdog repair: stale locks · pad · catalog · launcher
```

### Reliability Center

`catalog-service` owns the Reliability Center because it can see catalog,
playability, YouTube, and runtime health in one place. The launcher only renders
Settings cards and proxies `/api/catalog/reliability/*`.

Reliability state is computed on demand from catalog `/health`, launcher
`/api/health`, pad health, couch activity, process counts, stale lock checks,
playability status, YouTube state, and optional voice health. Proof records are
append-only JSONL under `/etc/mango/reliability/proofs.jsonl` and are pruned to
30 days.

The status model is Green/Yellow/Red:

| Status | Contract |
|--------|----------|
| `green` | Ready for couch use |
| `yellow` | Usable but needs attention or proof is stale/partial |
| `red` | Couch path is broken or maintenance is blocked |

Mutating Reliability APIs are localhost-only. Safe repair is intentionally
narrow and delegates to `scripts/mango-health-repair.sh`; it never rebuilds DBs
or clears caches. Detail: [RELIABILITY.md](RELIABILITY.md).

---

## Foreground contract

`mango-stack.sh` owns the base stack. At idle: launcher Chromium + pad + (optional) voice. **No** Stremio, Kodi, mpv, or overlay Chromium.

| State | Visible | Hidden | Input owner | ⌂ behavior |
|-------|---------|--------|-------------|------------|
| `launcher` | Chromium mango UI | playback stopped | `mango-tv-pad.py` | noop / present launcher |
| `playback` | mpv or VLC fullscreen | launcher below or stopped | pad → player stop/home routing | stop playback → launcher <300 ms |
| `fallback_stremio` | Stremio player | launcher below | pad → Stremio | present launcher |

### Input routing

| Foreground | B (`304`) | Y (`308`) | Home (`316`/`311`) |
|------------|-----------|-----------|---------------------|
| `launcher` | select | back / settings | noop |
| `playback` | play/pause where supported | stop → launcher | stop → launcher |
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

## Library API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/library/state` | Saved/latest/finished state for `type` + `id`, or `current=true` |
| `GET` | `/library/saved` | Saved rows, optional `tab` and `limit` |
| `POST` | `/library/saved` | Explicit Save by user/voice; accepts type/id/title/poster/tab/source |
| `DELETE` | `/library/saved` | Explicit Unsave by type/id/source |
| `GET` | `/library/history` | Read-only recent history |
| `GET` | `/library/context` | Current launcher detail context |
| `POST` | `/library/context` | Localhost launcher update for current-context voice tools |
| `DELETE` | `/library/context` | Localhost cleanup/restore hook for gates |

`GET/POST/DELETE /pins` remains for compatibility and delegates to Saved. There
is no public hide/unhide API in M6.1; hidden fields are schema-only for the
later UX pass.

## YouTube API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/youtube/state` | Enabled/configured/auth/cache/refresh state |
| `POST` | `/youtube/auth/start` | Start Google device-code OAuth |
| `GET` | `/youtube/auth/poll?session_id=` | Poll companion-first OAuth completion |
| `POST` | `/youtube/auth/disconnect` | Remove local auth token |
| `POST` | `/youtube/refresh` | Fill/update cache and recommender rails |
| `GET` | `/youtube/rails` | YouTube tab rails with stale-cache status |
| `GET` | `/youtube/search?q=` | Grouped videos/channels/playlists |
| `GET` | `/youtube/detail?kind=&id=` | Video detail or channel/playlist video list |
| `POST` | `/youtube/not-interested` | Persistent local feedback; excludes rails |
| `POST` | `/youtube/play` | `yt-dlp -> mpv`; writes YouTube history/progress |

Detail: [YOUTUBE.md](YOUTUBE.md).

## Reliability API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/reliability/state` | Current Green/Yellow/Red state, component cards, action availability, latest proof |
| `GET` | `/reliability/proofs` | Recent 30-day local proof records |
| `POST` | `/reliability/proof/run` | Localhost-only proof write |
| `POST` | `/reliability/repair` | Localhost-only safe repair when idle |
| `POST` | `/reliability/stack/restart` | Localhost-only detached stack restart when idle |
| `POST` | `/reliability/refresh/run` | Localhost-only detached nightly movie/TV + YouTube refresh when idle |

Detail: [RELIABILITY.md](RELIABILITY.md).

---

## Voice stack (M5)

```
Phone companion (:3001) ──WSS──► orchestrator (:8765)
                                      ├─► catalog-service /voice/*
                                      └─► launcher POST /api/voice/command
Launcher voice-hud ◄── WS loopback :8766
```

**Rule:** Voice opens detail/results and can Save/Unsave explicit library state
only — playback stays on pad **B**. No `mango_play` or `play_youtube` in
manifest. YouTube uses `mango_youtube_search` + `mango_open_youtube` under the
same contract.

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
| `gate-m6-youtube-smoke.sh` | Native YouTube state/rails/search/detail and optional playback |
| `gate-m6-reliability-proof.sh` | Reliability Center proof; fails red, warns yellow |

See [STATUS.md](STATUS.md#gates).

---

## Launcher API (serve.py)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | launcher, chromium, pad |
| `GET` | `/api/info` | hostname, IP, ports |
| `*` | `/api/catalog/reliability/*` | Proxy → Reliability Center in `:3020` |
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
