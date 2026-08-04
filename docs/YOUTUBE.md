# mango — native YouTube

**Milestone:** M6.2 · **Status:** the native YouTube base was previously
Pi-gated and Recommendations v2 source is complete on this branch. Its real
history import, reservoir acquisition, generation publication, deployment, Pi
diagnostics, screenshots, and TV behavior are **DEFERRED** until this exact
pushed revision passes the offline gate and is deployed and observed at home.

Mango treats YouTube as a first-class content source while preserving the voice
safety contract: voice can search/open/save, but playback starts only when the
user presses **B** on a YouTube video detail.

Earlier nine-card and four-anchor/adaptive probe results describe superseded
rail contracts and are not v2 evidence. The controller may show
"waiting for controller" when the 8BitDo is off; that means the stack is polling
and will reconnect when the controller wakes.

---

## Architecture

```
Launcher YouTube tab
  └─ /api/catalog/youtube/*
       ├─ youtube.db      rebuildable metadata/cache
       ├─ library.db      durable source="youtube" Saved/history/feedback
       ├─ YouTube Data API metadata/search/subscriptions
       └─ yt-dlp -g → mpv playback
```

| Layer | Owns |
|-------|------|
| `youtube.db` | Cached videos/channels/playlists, authoritative subscription generations, explicit candidate provenance, published rail generations, refresh/quota counters, auth sessions |
| `library.db` | Household Saved, normalized Takeout/Mango-local watch history, exact Not-for-me, finished state, import batches, and current context; old profile rows remain dormant |
| YouTube Data API | Metadata/search/subscriptions only |
| `yt-dlp -> mpv` | Playback resolution/rendering via the Mango wrapper; no Data API quota use |

`youtube.db` is rebuildable. `library.db` is durable user state. Recommendation
v2 is Household-only: profiles and mood have zero acquisition/ranking effect,
while their existing rows remain intact and recoverable.

Playback tries the configured high-quality split video/audio selector first.
If mpv rejects that direct transport before the first frame, Mango performs one
fresh `yt-dlp` resolve with that exact selector excluded, allowing a combined
format fallback. It never loops formats at couch time and this fallback uses no
YouTube Data API quota.

---

## Operator config

All live credentials are operator-owned under `/etc/mango`; never commit them.

| Path | Purpose |
|------|---------|
| `/etc/mango/youtube-api.key` | YouTube Data API key for anonymous search/metadata/refresh |
| `/etc/mango/youtube-oauth-client.json` | Google OAuth client for device-code login |
| `/etc/mango/youtube-auth.json` | Stored OAuth token, written `0600` |
| `/etc/mango/youtube.db` | Rebuildable YouTube cache |
| `/etc/mango/library.db` | Durable Saved/history/feedback |
| `/etc/mango/youtube-cookies.txt` | Optional `yt-dlp` cookies file |
| `~/.local/share/mango/ytdlp-venv/` | User-owned updatable `yt-dlp` venv for playback resolution |

Repo-safe examples:

- `config/config.example.yaml`
- `config/youtube-oauth-client.example.json`

`scripts/pi-deploy.sh` runs `scripts/m6-ship/ensure-youtube-yt-dlp.sh` to keep
`yt-dlp` fresh in the user venv. The catalog calls
`scripts/m6-ship/youtube-yt-dlp.sh`, which prefers that venv and only falls back
to system `yt-dlp` if the venv is absent. This is intentional: YouTube playback
extraction changes faster than Debian packages.

---

## Public API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/youtube/state` | Localhost-only operator config/auth/cache/refresh diagnostics |
| `POST` | `/youtube/auth/start` | Localhost-only operator device-code OAuth |
| `GET` | `/youtube/auth/poll?session_id=` | Localhost-only operator OAuth poll |
| `POST` | `/youtube/auth/disconnect` | Localhost-only operator token removal |
| `GET` | `/youtube/companion/status` | Sanitized companion booleans only |
| `POST` | `/youtube/companion/auth/start` | Sanitized device-flow code, URLs, session, and timing |
| `GET` | `/youtube/companion/auth/poll?session_id=` | Sanitized status and optional interval only |
| `POST` | `/youtube/companion/auth/disconnect` | Sanitized `{ "ok": true }` only |
| `POST` | `/youtube/refresh` | Enqueue metadata/cache refresh; returns HTTP 202 and a durable job ID |
| `GET` | `/youtube/rails` | Five ordered core rails plus conditional From Your Subscriptions and Live Now, from the published local generation only |
| `GET` | `/youtube/rails?reshuffle=1` | Advance cached recommendation/discovery/subscription/live slates; History/Saved stay stable; no API, acquisition, or ranking work |
| `POST` | `/youtube/takeout/import` | Localhost-only streamed ZIP/JSON/HTML history import; stores normalized events/diagnostics and discards raw input |
| `POST` | `/youtube/impressions` | Validate opaque served tokens and record exact rendered membership against the server-owned Household generation/context; never URLs |
| `GET` | `/youtube/search?q=` | Grouped Videos / Channels / Playlists |
| `GET` | `/youtube/detail?kind=&id=` | Video detail or channel/playlist video list |
| `POST` | `/youtube/not-interested` | Household exact-video Not-for-me; reversible and never expanded to a creator/topic penalty |
| `POST` | `/youtube/play` | Resolve video with `yt-dlp`, start mpv, write local history |

Compatibility rule: only YouTube videos can be Saved. Channels/playlists open
detail lists but are not Saved entities in M6.2. Saved videos remain in the
Household's stable Saved rail until explicit Unsave. Saved has zero recommendation
weight. Not-for-me suppresses that exact video only and offers Undo instead of
deleting history.

The phone reaches the four `/youtube/companion/*` routes only through the HTTPS
companion's exact capability allowlist. Catalog accepts those upstream calls
from loopback only. The status DTO is exactly `api_key_configured`,
`oauth_configured`, `authenticated`, and `needs_attention`; detailed operator
state, raw provider errors, token-file paths, expiry/scopes, command paths,
cache state, quota counters, and refresh phases remain on localhost-only
`/youtube/state` and never cross the LAN proxy.

## Scheduled refresh

The native YouTube cache is refreshed by the nightly library wrapper after the
movie/TV playability maintenance attempt:

```bash
bash scripts/m3-play/playability/install-playability-timer.sh
```

That installs `mango-playability-indexer.timer` for **03:00 only**. The service runs
`nightly-library-refresh.sh --mode nightly --preset nightly`, which executes
playability stale+grow first and then calls `POST /youtube/refresh` through
`scripts/m6-ship/youtube-refresh-cache.sh`. This is also the preferred manual
"run everything" workflow: one command refreshes movie/TV library state and then
YouTube. Daytime auto-retry of this chain is retired; use
`playability-catch-up.sh nightly` when idle after a failed nightly.

`/youtube/refresh` enqueues a durable job and returns HTTP 202. Poll that job at
`/recommendations/jobs/:job_id`; aggregate state exposes only a bounded recent
window and is not an exact-job authority. The nightly and
manual wrapper polls that exact job to a terminal state before reporting
success, then reads `/youtube/state` for phase and quota diagnostics. The job
is a phase-isolated coordinator. In v2 it refreshes one
complete authoritative subscription-channel snapshot, bounded subscription
uploads/live probes, bounded history-derived topic/channel acquisition, and
then atomically publishes the ranked rail generation. A phase failure is
reported independently in `/youtube/state` and never clears the prior complete
subscription snapshot or last-good rail generation. A later successful complete
subscription pagination replaces the snapshot rather than merging stale
channels indefinitely. The YouTube step still runs when playability returns a
quota/source/error failure, but it is skipped while another playability
maintenance lock is active.

The old Popular, Fresh Finds, generic live-search, generic For You, custom-AI,
and chart-backed acquisition phases are retired from v2. Their cached metadata
may remain available to Search/detail and rollback, but cannot acquire
recommendation provenance or enter a v2 rail.

Quota boundary: couch shuffle and cached rail rendering never call YouTube.
Playback resolution through `yt-dlp -> mpv` does not use the YouTube Data API.
Playback also does not call `videos.list` to refill missing metadata; the
launcher card/cache supplies display metadata and `yt-dlp` resolves transport.
`/youtube/state` reports both `search_calls_today` and `api_calls_today` so
operators can distinguish scarce search work from cheap metadata calls.
Unified launcher Search additionally admits quota centrally before dispatch:
the Pacific-day general metadata budget is 10,000 units with 2,500 protected
for interactive use. `search.list` has a separate 100-call daily bucket, with
25 calls protected for couch Search. Background refresh stops before entering
either applicable reserve. Ordinary metadata list requests cost 1 general unit.
Query responses are keyed by query/kinds/SafeSearch/region/language, cached for
24 hours, and pruned LRU to 200 keys. See [SEARCH.md](SEARCH.md).
A triggered history acquisition burst is capped at five `search.list` calls and
coalesces for 15 minutes. Nightly permits at most eight Beyond queries, four More
Like queries, and eight subscribed-channel live probes. `Live Now` admits only
currently live streams from the authoritative subscription snapshot; it never
runs a generic live search. OAuth loss serves an explicitly stale last-good
snapshot. Ordinary Home loads and X never initiate any phase.

Manual equivalents:

```bash
bash scripts/m3-play/playability/playability-catch-up.sh nightly
bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
bash scripts/m6-ship/youtube-refresh-cache.sh --reason manual
```

Controls: `MANGO_NIGHTLY_YOUTUBE_REFRESH=0` disables the chained nightly step,
`MANGO_YOUTUBE_REFRESH_CACHE=0` skips the refresh helper, and
`MANGO_YOUTUBE_REFRESH_TIMEOUT_SEC` controls the endpoint timeout.
`MANGO_YOUTUBE_RECS_V2=off|shadow|serve` controls YouTube v2 independently from
`MANGO_VOD_RECS_V2`. Shadow builds never replace the legacy served surface;
serve reads only a published v2 generation and keeps last-good state on failure.

### Google Takeout history bootstrap

Reliability Center exposes **Import YouTube history** with a CLI fallback. The
importer accepts a Takeout ZIP or extracted watch-history JSON/HTML, validates
archive paths plus bounded input/expansion, streams parsing, normalizes video
ID/title/channel/watch time, and deduplicates idempotently by video and
materially distinct timestamp. It stores batch counts, format, timestamp, and
errors, then discards the uploaded
archive and raw source documents. Missing metadata is resolved asynchronously
within quota. Imported watches contribute meaningful-watch strength and use a
90-day ranking half-life; Mango-local completions may contribute full strength.
Mango-local bare starts are ignored: known-duration watches qualify at
`min(25% of duration, 5 minutes)`, and unknown-duration watches require two
minutes.

```bash
cd src/catalog-service
npm run youtube:takeout -- /path/to/takeout.zip
```

Takeout is a manual bootstrap, not continuous Google account-history sync. The
supported Data API does not expose account watch history. Streaming, path-safety,
idempotency, and raw-data-discard behavior must pass the local promotion suite;
this document is not runtime proof.

---

## Launcher behavior

- Browse tabs are **Movies · TV Shows · Live · YouTube**.
- Five visually equal core rails appear in this order: **For You → Beyond Your
  Subscriptions → More Like … → History → Saved**. **From Your Subscriptions**
  follows when an authenticated authoritative snapshot exists, and **Live Now**
  follows when subscribed channels have live content.
- Normal rails contain four globally unique landscape cards. `Live Now` may
  contain one to four instead of receiving unrelated filler.
- History is newest-first across normalized Takeout and resolvable Mango-local
  launches, including bare starts. Only meaningful watches seed or exclude from
  recommendations. Saved is explicit utility state. Both rails are
  chronological/stable and neither affects recommendation scoring.
- For You weights decayed history affinity 60% and subscription affinity 40%,
  renormalizing when only one source exists. It excludes exact watched, Saved,
  Short, and live items and caps creators.
- Beyond Your Subscriptions uses bounded topics derived only from subscriptions
  and decayed history, excludes subscribed channels, and admits at most one card
  per creator.
- More Like chooses a daily-stable seed from the twenty most recent meaningful
  watches, then combines its channel with bounded topic/format acquisition. It
  prefers one same-channel card and three related creators. With subscriptions
  but no history its thematic fallback is **More from channels you follow**.
- From Your Subscriptions shows newest unwatched uploads with at most one card
  per channel when supply permits. Live Now contains only currently live streams
  from subscribed channels. Shorts never appear in recommendation rails. The
  cached item shape has no aspect ratio, so v2 conservatively treats every
  video at or below 180 seconds (or explicitly tagged `#shorts`) as a Short;
  this can exclude a landscape clip but fails closed against vertical Shorts.
- X advances only published recommendation/discovery/subscription/live slates.
  History and Saved remain stable; focus position and scroll are preserved; no
  provider, quota, acquisition, enrichment, corpus scan, or ranking work runs.
- Subscription and qualifying history acquisition writes explicit provenance:
  `subscription_upload`, `subscription_live`, `history_channel`, or
  `history_topic`. Generic Search/detail/AI/chart cache entries are ineligible
  without one of those records.
- Subscriptions with no history still produce For You/Beyond and the thematic
  fallback. History with no subscriptions omits subscription/live rails. With
  neither, the tab shows a connect/import/watch setup card rather than Popular
  or a regional starter feed.
- Search still returns grouped Videos / Channels / Playlists and falls back to
  cached metadata when quota/rate limits prevent a fresh request.
- Video detail supports Play, Save/Unsave, exact reversible Not for me, and Back;
  channel/playlist detail opens a D-pad list. Not-for-me never expands to a
  creator or topic penalty.
- An opaque server token binds immutable Household, rail, generation, and exact
  membership. Scores, provenance, internal context, and ranking internals stay
  private; cards use the same visual treatment and show no technical reasons.
- Companion account connect uses only the HTTPS same-origin
  `/api/catalog/youtube/companion/*` capabilities; broad operator state/auth
  paths are neither requested by the browser nor admitted by the proxy.

## Rail cache summary

| Rail | Role | Source of truth | X behavior |
|------|------|-----------------|------------|
| For You | Core | Published rank from history + subscriptions only | Advance cached slate |
| Beyond Your Subscriptions | Core | Provenance-gated history/subscription topic acquisition; subscribed creators excluded | Advance cached slate |
| More Like … | Core | Daily-stable meaningful-history seed and provenance-gated channel/topic candidates | Advance cached slate |
| History | Core utility | Normalized Takeout + Mango-local meaningful watches in `library.db` | Never shuffled |
| Saved | Core utility | Explicit Household state in `library.db`; zero rank influence | Never shuffled |
| From Your Subscriptions | Conditional | Newest unwatched uploads from the authoritative snapshot | Advance cached slate |
| Live Now | Conditional | Currently live streams from subscribed channels only | Advance cached slate; 1–4 cards allowed |

Specialized rails allocate first, then For You fills, while the display order
above remains fixed. Global dedupe runs across all rails. Exact rendered
impressions resolve opaque tokens without trusting caller identity or persisting
URLs/secrets.

## Recommendation constraints

Mango does not expose or scrape an exact "native YouTube home" rail. The official
YouTube Data API no longer provides `search.list relatedToVideoId`, and the
`activities.list home` parameter is deprecated. A literal native-home rail would
need an unofficial/scraping path and must be added as an explicit experimental
operator opt-in, separate from the supported official API cache.

Mango uses only authoritative subscriptions plus normalized Takeout/Mango-local
meaningful history for recommendation acquisition and ranking. Search, Saved,
profiles, mood, VOD, companion memory, AI catalogs, and global charts are
explicitly isolated. Refresh may use bounded official search/detail metadata to
resolve those approved seeds, then serves the last-good generation if later work
fails. Cloud AI and unofficial sources are never recommendation dependencies.

---

## Voice behavior

Tools:

- `mango_youtube_search`
- `mango_open_youtube`
- `mango_save_title` / `mango_unsave_title` for current YouTube video or exact video result

Non-goals:

- No `mango_play_youtube`
- No autoplay
- No channel/playlist save
- No hide/unhide

---

## Gates

Local:

```bash
cd src/catalog-service && npm run test:gate
cd src/catalog-service && npm test
cd src/launcher && npm run build
cd src/companion && npm run build
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
```

Pi smoke:

```bash
bash scripts/m6-ship/gate-m6-youtube-smoke.sh
MANGO_YOUTUBE_PLAY=1 bash scripts/m6-ship/gate-m6-youtube-smoke.sh
```

The smoke gate verifies the configured `yt-dlp` command, skips API search when
no API key is configured, and skips playback unless `MANGO_YOUTUBE_PLAY=1`.

---

## External contracts

- Google limited-input OAuth device flow:
  <https://developers.google.com/identity/protocols/oauth2/limited-input-device>
- YouTube Data API quota:
  <https://developers.google.com/youtube/v3/determine_quota_cost>
- YouTube search API:
  <https://developers.google.com/youtube/v3/docs/search/list>
- YouTube videos API:
  <https://developers.google.com/youtube/v3/docs/videos/list>
- YouTube Data API revision history:
  <https://developers.google.com/youtube/v3/revision_history>
- YouTube activities API:
  <https://developers.google.com/youtube/v3/docs/activities/list>
- `yt-dlp` FAQ:
  <https://github.com/yt-dlp/yt-dlp/wiki/FAQ>
