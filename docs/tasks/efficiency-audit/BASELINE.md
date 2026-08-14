# Pi efficiency baseline

Captured **read-only** on 2026-08-14. No services restarted. Deploy wrappers were not used.

## Capture metadata

| Field | Value |
|-------|-------|
| Captured at | 2026-08-14T02:31:51-07:00 (Pi local) |
| Mac HEAD | `a057a15dd870f00efcb91c8e6d8e427000b67769` |
| Pi branch / HEAD | `feat/native-experience` / `a057a15dd870f00efcb91c8e6d8e427000b67769` |
| Pi dirty tree | operator `config/companion.example/*` only |
| Capture method | `scripts/pi-exec.sh` + `scripts/diag/perf-snapshot.sh` |
| Display | HDMI-1 `1920x1080@60` |
| Temp / load | 59.3°C · load 0.07 / 0.09 / 0.32 |
| RAM | 7.9 GiB total · 2.9 GiB used · 5.0 GiB available |

Pi SHA matches Mac. Catalog RSS in `/health` was 403 MB.

## Per-service RSS / CPU (cgroup `MemoryCurrent`)

| Unit | State | MemoryCurrent | Notes |
|------|-------|---------------|-------|
| `mango-launcher-chromium.service` | active | 645 MB | GPU rasterization on; Chromium process RSS sum ≈ **890 MB** |
| `mango-catalog.service` | active | 445 MB | `node dist/index.js` RSS ≈ 392–404 MB |
| `mango-ui-server.service` | active | 21 MB | `serve.py` |
| `mango-tv-pad.service` | active | 27 MB | `mango-tv-pad.py` |
| `mango-orchestrator.service` | active | 53 MB | Voice on (`MANGO_VOICE` stack running) |
| `mango-companion.service` | active | 33 MB | HTTPS :3001 |
| `mango-controller-link.service` | **inactive** | — | Not the 4 Hz GLib tick on this boot |

## Docker (second sample; first CPU% was a spike)

| Container | Memory | CPU (2nd sample) |
|-----------|--------|------------------|
| mango-aiostreams | 365 MB / 1 GiB | 0.01% |
| mango-aiometadata | 401 MB / 7.87 GiB | 0.00% |
| mango-aiometadata-redis | 294 MB / 7.87 GiB | 0.83% |
| mango-nexotv (+ free/news/cartoons) | ~184 MB combined | 0.00% |

Idle RAM tax of the addon pair (AIOStreams + AIOMetadata + Redis) ≈ **1.06 GiB**. First `docker stats` showed AIOStreams at 13.66% CPU; the repeat sample was 0.01% — treat 13% as a spike, not a standing load.

## Idle wakeup cost

- System load stayed ~0.1 over a 10s idle window.
- Pad-nav heartbeat `render_age_ms≈998` (benign, documented).
- Voice orchestrator **HTTPS** `/health` 9 ms (HTTP :8765 timed out — TLS only, not a down service).
- Live rails cache 11.5 KB, age ~25 min in the first health blob, `cache_fresh: true`.

## Hot API latency (`perf-snapshot.sh`, 3 runs)

| Endpoint | Runs | Avg |
|----------|------|-----|
| catalog `/health` | 1 / 2 / 1 ms | 1 ms |
| `/rails` | 1 / 1 / 1 ms | 1 ms |
| `/rails/items?tab=movies` | 6 / 5 / 5 ms | **5 ms** |
| `/rails/items?tab=series` | 16 / 7 / 13 ms | 12 ms |
| `/rails/items?tab=live` | 52 / 29 / 17 ms | 32 ms |
| `/meta/movie/tt0111161` | 544 / 46 / 86 ms | 225 ms (cold then warm) |
| `/stream/movie/tt0111161` | **5891** / 50 / 95 ms | cold resolve dominates |
| launcher `/api/health` | 420 / 419 / 399 ms; later 303 / 294 / 305 ms | **~300 ms standing** |
| orchestrator HTTP | 9999 ms × 3 | measurement error (needs HTTPS) |

Home tab rails are fast when cached. Play/stream cold path is the expensive API. Launcher health is two orders slower than catalog health because it shells out (see F-018).

## SQLite (file sizes)

| DB | File | WAL | Notes |
|----|------|-----|-------|
| library.db | **418 MB** | 25 MB | 63 tables; `page_count=106925`, **`freelist_count=36515` ≈ 142 MB unused pages** |
| playability.db | 56 MB | 35 MB | pool=11796, verified=11245, pending=0 |
| youtube.db | 33 MB | 5.6 MB | |
| progress.db | 76 KB | 4.0 MB | WAL larger than the db (idle checkpoint gap) |
| companion.db | 1.1 MB | — | |

Notable library row counts: `vod_rank_items=22166`, `vod_story_dna_documents=17869`, `watch_history=15588`, `profile_recommendation_impressions=4546`, `search_history=12`, `search_selections=32`.

`EXPLAIN QUERY PLAN` for `rail_pool WHERE rail_id=? ORDER BY score DESC` uses `idx_rail_pool_rail_score` (SEARCH).

**Pragma caveat:** a Python `sqlite3` RO connection reports `cache_size=-2000`, `mmap_size=0`, `synchronous=2` on every DB. Those are **per-connection** defaults, not proof of the Node process. Journal mode WAL is file-level and confirmed. Node `openDb()` source must be used for cache/mmap/busy_timeout claims.

## Chromium / GPU

Flags in the running process: `--enable-gpu-rasterization --ignore-gpu-blocklist --enable-zero-copy --kiosk --app=http://127.0.0.1:3000/`. Matches `ARCHITECTURE.md` compute budget. Unit entered active Fri 2026-08-14 01:30:53 PDT (`NRestarts=0`).

## Notes / capture gaps

- No Search-submit main-thread profile (would need Chromium tracing during a query). F-001 duration on this Pi is still `unmeasured`; mechanism is source-proven.
- No mpv TTFF sample this capture (would start playback). Cold `/stream` 5.9 s is a lower bound on resolve, not first frame.
- `mango-controller-link.service` was inactive — 4 Hz tick (F-010) is source-real but **not running on this boot**.
- Voice + Live Docker are **on** on this Pi; code-off-state is a separate column in FINDINGS.
