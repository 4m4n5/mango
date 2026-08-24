# Architecture

Current-system overview. Policy tables: [DECISIONS.md](DECISIONS.md).
Proof: [STATUS.md](STATUS.md). Feature depth lives under
[features/](features/).

**Branch:** `main`.

## Layers

```
Launcher (:3000)  →  catalog-service (:3020)  →  addons (Stremio protocol)
                              ├→ Mango library / playability / YouTube state
                              └→ mpv play orchestrator
```

| Process | Port / unit | Owns | Does not own |
|---------|-------------|------|--------------|
| Chromium + `mango-ui-server` | `:3000` | 10-foot browse, Detail, Search | Stream ranking, decode |
| `catalog-service` | `:3020` | Rails, library, playability, YouTube, play sessions, Reliability, voice HTTP | Addon credentials, Google secrets |
| AIOStreams | `:3035` | VOD aggregate, transports, service policy | Device capability, mpv probe |
| AIOMetadata | `:3036` | Catalog adapters | Stream resolve |
| mpv + Lua HUD | user session | Decode, render, Streams drawer | Catalog metadata |
| `mango-tv-pad.py` | user unit | evdev grab and routing | Bluetooth link recovery |
| `mango-controller-link` | root unit | BlueZ reconnect | Button semantics |
| companion | `:3001` | Phone librarian TLS | Couch playback confirmation |
| orchestrator | `:8765` / `:8766` | Optional STT / LLM | Catalog data, mpv IPC |

Exactly one couch foreground is authoritative: the Chromium launcher or
mpv. Stremio and Kodi are not daily players.

## Local state

| Store | Authority |
|-------|-----------|
| `/etc/mango/library.db` | Saved, history, ratings, feedback, normalized YouTube history |
| `/etc/mango/progress.db` | Exact Continue / resume |
| `/etc/mango/playability.db` | Verified titles and thematic rail pools |
| `/etc/mango/youtube.db` | Rebuildable metadata, reservoirs, quota |
| `/etc/mango/reliability/proofs.jsonl` | 30-day local proof ledger |
| `$HOME/.cache/mango/` | Logs, sockets, URL-free playback snapshots |

`/etc/mango/stremio-export.json` is an addon-manifest graph only. Repair
never wipes these stores as a first response.

## Playback

`POST /play-session` persists acceptance before Chromium can hide.
Resolve and probe stay display-neutral. The launcher hides only after
mpv proves advancing, feature-length media. Failed candidates restore
the exact launcher state.

The HUD (`mango-hud.lua`) is inside mpv. It receives sanitized title /
episode metadata only — never URLs, tokens, or filenames. Movies and
series expose a five-choice Streams drawer; Live and YouTube do not.

Playability grow stages work in an isolated database and publishes
atomically. Couch activity (`~/.cache/mango/couch-activity.json`) defers
disruptive maintenance.

## Recommendations

VOD ranking is a deterministic sparse IDF-weighted 0/1/2-lane scorer
run by `mango-vod-recs-worker`. Catalog-service only enqueues a desired
revision. Home serves **For You** from an activatable generation or a
labelled **Top Picks** rail. YouTube rails are household-provenance
caches, not YouTube Home.

## Input

Locked pad map: **B** select, **Y** back, **X** secondary, **−/+**
volume, **L/R** tabs or large seek, **⌂** home. Do not change bindings
without an issue and maintainer approval. See [HARDWARE.md](HARDWARE.md).

## Deploy

Git only. Wrappers require `main`, a successful fetch, matching SHA, and
a clean tree unless `MANGO_DEPLOY_ALLOW_DIRTY=1`. AIOMetadata sync is
opt-in. Runbook: [OPERATIONS.md](OPERATIONS.md).

## Topology exception

Catalog-service still contains an optional direct MediaFusion thin-pool
supplement when a local manifest is present. Treat that as unresolved:
remove it or feature-gate it before calling the runtime strictly
AIO-only. Details:
[features/content-and-playback.md](features/content-and-playback.md).
