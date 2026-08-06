# Mango catalog-service

Local HTTP service on `:3020` for Mango's catalog, library, Search,
recommendations, resolver/playback, native YouTube, voice tools, playability,
and Reliability Center. Stremio-compatible resources are one input protocol,
not the whole service or Mango's user-library authority.

Current product/status: [`docs/STATUS.md`](../../docs/STATUS.md) · runtime/state
boundaries: [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Ownership

| Service owns | Service does not own |
|--------------|----------------------|
| YAML/verified/cached rails and Detail metadata | AIO/debrid/API/OAuth credentials |
| Mango library/progress/ratings/feedback/attribution | Chromium focus/rendering |
| Search index/jobs/quota admission | Phone LAN authentication beyond the exact companion proxy |
| VOD and YouTube recommendation generations | StoryDNA model inference process or household-state teaching |
| AIO stream normalization, identity, ranking and single-flight; optional legacy direct MediaFusion thin supplement | AIOStreams nested provider fan-out/configuration |
| Play sessions, mpv launch/switch/Undo/progress ownership | Physical display/CEC/audio proof |
| Reliability model/proof APIs | Destructive repair of databases/cache/history |

AIOStreams is the intended sole **stream-capable VOD aggregate/path** in the
exported graph; catalog/metadata and optional Live addons coexist. Torrentio,
Comet, optional MediaFusion, TorBox, Real-Debrid, and Easynews should contribute
behind AIO—not as direct catalog-service peers. Current source still has one
legacy exception: a Pi-local MediaFusion manifest can trigger a direct,
deadline-bounded supplement when the primary pool is thin. Strict AIO-only
runtime is therefore an open topology-hardening decision, not a proven fact.

## Pi state

| Path | Role |
|------|------|
| `/etc/mango/stremio-export.json` | Addon manifests only; no user-library sync |
| `/etc/mango/catalog.yaml` | Home rail configuration |
| `/etc/mango/catalog-live.yaml` | Optional four-rail Live configuration |
| `/etc/mango/catalog-filters.json` | Loaded stream/capability/attempt policy |
| `/etc/mango/library.db` | Durable Saved/history/finished/ratings/feedback/attribution/normalized YouTube history/recommendations |
| `/etc/mango/progress.db` | Durable exact Continue/resume |
| `/etc/mango/playability.db` | Verified title/path evidence and rail pools |
| `/etc/mango/youtube.db` | Rebuildable YouTube metadata/reservoir/query/quota state |
| `/etc/mango/reliability/proofs.jsonl` | 30-day local proof ledger |
| `/etc/mango/youtube-*.json`, `*.key`, cookies | Operator-owned secrets/config; never repository state |

Migrations and maintenance preserve durable state. Never delete/recreate these
stores as a routine test, deploy, or repair.

## API groups

The source/router is authoritative for exact DTOs. Major public/local groups:

| Prefix | Purpose |
|--------|---------|
| `/health`, `/reliability/*` | Runtime facts, proof ledger, narrow idle-only actions |
| `/rails*`, `/meta/*`, `/series/*/episodes` | Browse/Detail/exact episode surfaces |
| `/stream/*`, `/play-session*`, compatibility `/play` | Stream list, asynchronous automatic play, active picker/switch/Undo |
| `/playability/*` | Verified-corpus and maintenance diagnostics/actions |
| `/library/*`, `/personalization/*` | Saved/history/context/ratings/prompts/feedback and preserved identity state |
| `/recommendations/*` | VOD generations, cached slates, jobs/state/impressions/actions |
| `/youtube/*` | Base YouTube, Takeout/OAuth, v2 generations, Search/Detail/play and sanitized companion capabilities |
| `/search/*` | Local index and progressive isolated Search jobs |
| `/voice/*`, `/ai/*` | Librarian tools, custom AI catalogs and cross-surface context |

The phone reaches only an exact HTTPS proxy allowlist. Full recommendation,
YouTube operator, raw error, token-file, quota, and private journal state remains
loopback-only.

## Playback contract

- Launcher accepts an idempotent asynchronous play session and remains visible
  through resolve/probe.
- Exact title/episode work is coalesced under one absolute deadline. Automatic
  Movie/Episode Play defaults to initial resolve plus two 1.2-second
  confirmations only for clean HTTP-200 empty/proven-transient aggregate output;
  explicit rollback/experiment overrides accept 0–3 attempts and 0–10-second
  delays, so runtime values are part of proof.
- Detail lists, Live, picker refresh, 429, auth/config/permanent errors,
  cancellation, malformed media, invalidation, and deadline exhaustion are not
  confirmation-retried.
- A single attempt budget spans main/last-resort/obligation/risky phases.
- Foreground/display ownership commits only after advancing media is proven;
  stale cleanup is PID/epoch scoped.
- Active movie/episode candidates persist in a URL-free, maximum-five snapshot.
  Isolated switch validation and revisioned Undo preserve one progress session.

The base filter default uses a 90-second automatic wall. The current `4k-hifi`
profile deliberately uses 120 seconds and can select compatible 4K SDR HEVC;
native HDR through X11/mpv is not a supported claim. See
[`docs/PLAYABILITY.md`](../../docs/PLAYABILITY.md).

## Library and recommendations

- Saved is explicit. Playback updates Continue/history but never auto-saves.
- Fire and Water each require 0–5 in half steps; movies are title-level and
  series collapse to show-level.
- Commit `345535d` leaves one executable recommender per domain while preserving
  personal and historical data. VOD `shadow`/`serve` uses Household ownership,
  `vod-content-profile-v2`, optional compatible StoryDNA overlays, an
  off-by-default bounded frontier, and local Story Frontier ranking. YouTube
  uses only authoritative subscriptions and qualifying Takeout/Mango history.
- In `serve`, VOD For You is exactly six current verified cards. Optional
  `MANGO_VOD_BROWSE_V3=shadow|serve` adds derived full-corpus Explore, weighted
  all-rail tab deals, and StoryDNA-first Detail Related without new teacher
  calls. YouTube normal
  rows require exactly four cards and may be absent; Live Now allows one to four.
- Serve-mode Home/X returns from cached atomic generations and does not wait for
  model/acquisition/network work. VOD low-water detection may enqueue background
  recovery after the read. Independent flags are
  `MANGO_VOD_RECS_V2=off|shadow|serve` and
  `MANGO_VOD_BROWSE_V3=off|shadow|serve` and
  `MANGO_YOUTUBE_RECS_V2=off|shadow|serve`.

`off` disables recommendations, `shadow` builds only the latest architecture
while hiding recommendation rails, and `serve` exposes only its accepted
published generation. There is no environment-selected legacy fallback. The
latest recorded Pi state predates this contract, so source completeness is not
serve/couch proof. Current blockers include YouTube non-Household `off`
ownership/HTTP 409, VOD shadow identity/Saved inconsistency, false Shuffle
success in VOD off/shadow, incomplete active-pointer diagnostics, and missing
focused replacements for removed legacy service tests. [STATUS](../../docs/STATUS.md)
owns those blockers. See
[`docs/FIRE_WATER_RATINGS.md`](../../docs/FIRE_WATER_RATINGS.md) and
[`docs/YOUTUBE.md`](../../docs/YOUTUBE.md).

## Development

```bash
cd src/catalog-service
npm ci
npm run build
npm test
npm run test:gate
```

Useful data tools:

```bash
npm run ratings:seed -- validate /path/to/approved-seed.json
npm run youtube:takeout -- /path/to/takeout.zip
```

These can touch durable state when pointed at Pi paths. Use temp/test databases
locally; on Pi require explicit authority, backups, dry-run where available, and
idempotence proof.

Pi verification is Git-only and exact-SHA. Run the relevant gates in
[`docs/STATUS.md`](../../docs/STATUS.md#verification) and complete
[`docs/COUCH_TEST.md`](../../docs/COUCH_TEST.md); local tests do not prove the TV.
