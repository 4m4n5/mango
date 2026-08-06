# mango — native YouTube

**Milestone:** M6.2 · **Status:** the native YouTube base was previously
Pi-deployed/gated. Commit `772b3d58b53208a278da4e9d5281b46f88054b8e` makes authoritative subscription/history v2
the sole executable recommendation architecture behind an independent
`off|shadow|serve` flag. The current v2.3 source adds post-auth account/sync
truth, complete bounded subscription coverage, official metadata evidence,
source/seed portfolio constraints, and uploads-playlist-backed conditional
More Like recovery. Exact Pi runtime proof is recorded in [STATUS.md](STATUS.md).

Mango treats YouTube as a first-class content source while preserving the voice
safety contract: voice can search/open/save, but playback starts only when the
user presses **B** on a YouTube video detail.

Earlier nine-card and four-anchor/adaptive results are superseded historical
evidence. They are not an executable fallback in current source. The controller may show
"waiting for controller" when the 8BitDo is off; that means the router is alive
and the link supervisor is attempting normal wake recovery. Five physical
power-cycle proofs remain open, so do not guarantee reconnection from that
message alone.

## Recommendation rollout semantics

| `MANGO_YOUTUBE_RECS_V2` | Refresh work | Public rails |
|--------------------------|--------------|--------------|
| `off` | Recommendation refresh disabled | No recommendation rails; History and Saved utility rails remain when populated |
| `shadow` | Latest authoritative v2 acquisition/generation | Recommendation rails hidden; History and Saved utility rails remain |
| `serve` | Latest authoritative v2 acquisition/generation | Household v2 logical positions and supply rules documented below |

No mode selects a deleted allocator. Operational rollback is `serve` →
`shadow`/`off`; older behavior requires a reviewed Git rollback. VOD and
YouTube modes are independent.

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
| `library.db` | Saved, normalized Takeout/Mango-local watch history, exact Not-for-me, finished state, import batches, and current context; personal profile rows are preserved but do not influence the latest recommender |
| YouTube Data API | Exact authorized-channel identity, metadata/search/subscriptions, and channel upload playlists |
| `yt-dlp -> mpv` | Playback resolution/rendering via the Mango wrapper; no Data API quota use |

`youtube.db` is rebuildable. `library.db` is durable user state. The latest
recommender is Household-owned whenever active (`shadow` or `serve`): profiles
and mood have zero acquisition/ranking effect, while their existing rows remain
intact and recoverable. `off` disables recommendation work rather than
activating a personal-profile ranker.

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

The India household uses discovery region `IN` and relevance language `en`.
These are independent controls: `MANGO_YOUTUBE_REGION` changes regional
discovery context, while `MANGO_YOUTUBE_LANGUAGE` changes query relevance. The
account country is not inferred from OAuth because the authorized channel may
omit it.

The full deploy helper runs `scripts/m6-ship/ensure-youtube-yt-dlp.sh` to keep
`yt-dlp` fresh in the user venv. The catalog calls
`scripts/m6-ship/youtube-yt-dlp.sh`, which prefers that venv and only falls back
to system `yt-dlp` if the venv is absent. This is intentional: YouTube playback
extraction changes faster than Debian packages.

The current full deploy wrapper itself is blocked for unattended agents by the
branch/SHA and implicit AIOMetadata-mutation issues in [DEPLOY.md](DEPLOY.md).
That blocker does not change the `yt-dlp` ownership contract.

---

## Public API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/youtube/state` | Localhost-only operator config/auth/cache/refresh diagnostics |
| `POST` | `/youtube/auth/start` | Localhost-only operator device-code OAuth |
| `GET` | `/youtube/auth/poll?session_id=` | Localhost-only operator OAuth poll |
| `POST` | `/youtube/auth/disconnect` | Localhost-only operator token removal |
| `GET` | `/youtube/companion/status` | Sanitized connection, channel title/avatar, authoritative subscription count, locale, and sync state |
| `POST` | `/youtube/companion/auth/start` | Sanitized device-flow code, URLs, session, and timing |
| `GET` | `/youtube/companion/auth/poll?session_id=` | Sanitized status plus account/sync state after automatic authoritative refresh |
| `POST` | `/youtube/companion/auth/disconnect` | Sanitized `{ "ok": true }` only |
| `POST` | `/youtube/refresh` | Enqueue metadata/cache refresh; returns HTTP 202 and a durable job ID |
| `GET` | `/youtube/rails` | History/Saved utility rails in off/shadow; five ordered v2 logical positions plus conditional subscriptions/live in serve |
| `GET` | `/youtube/rails?reshuffle=1` | Advance cached recommendation/discovery/subscription/live slates; History/Saved stay stable; no API, acquisition, or ranking work |
| `POST` | `/youtube/takeout/import` | Localhost-only streamed ZIP/JSON/HTML history import; stores normalized events/diagnostics and discards raw input |
| `POST` | `/youtube/impressions` | Validate opaque served tokens and record exact rendered membership against the server-owned Household generation/context; never URLs |
| `GET` | `/youtube/search?q=` | Grouped Videos / Channels / Playlists |
| `GET` | `/youtube/detail?kind=&id=` | Video detail or channel/playlist video list |
| `POST` | `/youtube/not-interested` | Household exact-video Not-for-me; reversible and never expanded to a creator/topic penalty |
| `POST` | `/youtube/play` | Resolve video with `yt-dlp`, start mpv, write local history |

Compatibility rule: only YouTube videos can be Saved. Channels/playlists open
detail lists but are not Saved entities in M6.2. In active modes, Saved videos
remain in Household's stable Saved rail until explicit Unsave. Saved has zero
recommendation weight. Not-for-me suppresses that exact video only and offers
Undo instead of deleting history.

In `off`, the service and route agree on the exact active personal owner and
return only that owner's History/Saved utilities. In `shadow` and `serve`, both
use exact Household ownership. Focused mode/owner/HTTP tests cover the former
non-Household 409 regression before YouTube is used as a rollback or promotion
path.

The phone reaches the four `/youtube/companion/*` routes only through the HTTPS
companion's exact capability allowlist. Catalog accepts those upstream calls
from loopback only. The status DTO includes configuration/auth booleans plus
`sync_status`, channel title/avatar, authoritative subscription count,
region/language, and last successful sync time. It contains no channel ID.
Detailed operator
state, raw provider errors, token-file paths, expiry/scopes, command paths,
cache state, quota counters, and refresh phases remain on localhost-only
`/youtube/state` and never cross the LAN proxy.

Device OAuth is not declared ready at token receipt. Companion resolves the
authorized channel, enumerates the complete subscription snapshot, scans every
channel's official uploads playlist in deterministic 24-channel pages with at
most six playlist reads in flight, and publishes a fresh generation. Failure
keeps the token and last-good data but reports `attention`; operational `off`
reports an authenticated-but-`paused` state.

## Scheduled refresh

The native YouTube cache is refreshed by the nightly library wrapper after the
movie/TV playability maintenance attempt:

```bash
bash scripts/m3-play/playability/install-playability-timer.sh
```

That installs the persistent `mango-playability-indexer.timer` for the **03:00**
calendar event. The service runs
`nightly-library-refresh.sh --mode nightly --preset nightly`, which executes
playability stale+grow first and then calls `POST /youtube/refresh` through
`scripts/m6-ship/youtube-refresh-cache.sh`. This is also the preferred manual
"run everything" workflow: one command refreshes movie/TV library state and then
YouTube. A missed calendar event can run after reboot because the timer is
`Persistent=true`, subject to the same idle/overlap guards. There is no separate
uncontrolled daytime retry watcher; use `playability-catch-up.sh nightly` only
for an explicit idle operator catch-up.

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
channels indefinitely. OAuth completion performs one bounded full uploads
coverage pass; later refreshes rotate 24 channels while retaining generation-
scoped coverage diagnostics. Official video category, default language/audio
language, and tags are cached as private thematic evidence. They can strengthen
a multi-signal relation but cannot create provenance or leak into public cards.
The YouTube step still runs when playability returns a
quota/source/error failure, but it is skipped while another playability
maintenance lock is active.

The old Popular, Fresh Finds, Because You Watched, generic live-search/generic
For You, AI Home rail, and chart-backed acquisition phases are removed from the
current recommendation runtime. Historical tables/cache rows remain, but no
current mode warms or serves those paths. Search and user-created AI catalog
seed acquisition remain separate product tools and cannot create recommendation
provenance. A reviewed older Git revision—not an environment flag—is required
to execute an old allocator.

AI catalog management still accepts YouTube slots and retains YouTube seed/
adapter code, but `/youtube/rails` no longer composes those slots into the Home
tab. Until the product either restores an explicitly non-recommendation custom
rail surface or removes the unsupported target, tools must not claim a YouTube
AI catalog is visible on TV merely because its slot exists.

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
Like attempts, and eight subscribed-channel live probes. More Like topic work
uses `search.list`; exact-channel fallback uses the channel's official uploads
playlist and can publish a coherent hybrid of one same-channel card plus
thematic cards. It tries alternate meaningful seeds and otherwise records
`not_applicable` honestly. `For You` requires both history and subscription
sources when both have eligible supply, limits a single creator or seed before
deterministic shortage relaxation, and `Beyond` caps a seed at two cards.
`Live Now` admits only
currently live streams from the authoritative subscription snapshot; it never
runs a generic live search. OAuth loss serves an explicitly stale last-good
snapshot. Ordinary Home loads and X never initiate any phase.

Manual equivalents:

On the Pi, from the repository root:

```bash
cd ~/mango
bash scripts/m3-play/playability/playability-catch-up.sh nightly
bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
bash scripts/m6-ship/youtube-refresh-cache.sh --reason manual
```

Controls: `MANGO_NIGHTLY_YOUTUBE_REFRESH=0` disables the chained nightly step,
`MANGO_YOUTUBE_REFRESH_CACHE=0` skips the refresh helper, and
`MANGO_YOUTUBE_REFRESH_TIMEOUT_SEC` controls the endpoint timeout.
`MANGO_YOUTUBE_RECS_V2=off|shadow|serve` controls YouTube v2 independently from
`MANGO_VOD_RECS_V2`. Shadow builds hide recommendation rails while still
building the latest Household generation. In serve, recommendation/discovery/
subscription/live rows read the published v2 generation and keep last-good
state on failure; History and Saved are assembled from current local library
state and can update independently of publication.

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

Search, Detail, Save, playback, and the native tab exist independently of the
recommendation mode. The ordered/supply-constrained behavior below is the
`serve` contract. In `off`/`shadow`, recommendation rails are absent and only
eligible utility rails remain. Exact active-personal ownership in `off` is
source-tested at the target and remains a Pi rollback check.

- Browse tabs are **Movies · TV Shows · Live · YouTube**.
- Five visually equal logical core positions are ordered **For You → Beyond Your
  Subscriptions → More Like … → History → Saved**. A normal row renders only
  when it has exactly four globally unique landscape cards, so thin supply can
  omit any position (including History/Saved). **From Your Subscriptions**
  follows when an authenticated authoritative snapshot has enough supply, and
  **Live Now** follows when subscribed channels have live content.
- `Live Now` may contain one to four cards instead of receiving unrelated filler.
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
- More Like samples a daily-stable ordering without replacement from the
  twenty most recent meaningful watches. Triggered refresh spends at most
  three searches and nightly at most four: two bounded thematic seed queries,
  then exact-channel fallback(s). Four thematic cards render as **More Like …**;
  otherwise four same-channel cards render as **More from <channel>**; otherwise
  the rail is honestly omitted with `not_applicable`. Per-query diagnostics are
  counts plus opaque seed references. With subscriptions but no history its
  fallback remains **More from channels you follow**.
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

## Serve rail cache summary

| Rail | Role | Source of truth | X behavior |
|------|------|-----------------|------------|
| For You | Core | Published rank from history + subscriptions only | Advance cached slate |
| Beyond Your Subscriptions | Core | Provenance-gated history/subscription topic acquisition; subscribed creators excluded | Advance cached slate |
| More Like … | Conditional core position | Alternate daily-stable meaningful-history seeds; thematic four, exact-channel four, or honest omission | Advance cached slate |
| History | Core utility | Normalized Takeout + resolvable Mango-local launches, including bare starts, in `library.db` | Never shuffled |
| Saved | Core utility | Explicit Household state in `library.db`; zero rank influence | Never shuffled |
| From Your Subscriptions | Conditional | Newest unwatched uploads from the authoritative snapshot | Advance cached slate |
| Live Now | Conditional | Currently live streams from subscribed channels only | Advance cached slate; 1–4 cards allowed |

Specialized rails allocate first, then For You fills, while the display order
above remains fixed. Global dedupe runs across all rails. Exact rendered
impressions resolve opaque tokens without trusting caller identity or persisting
URLs/secrets.

### Current rollout boundary

The base YouTube product and the latest recommendation model have different
proof status. Base metadata/search/OAuth/Takeout/`yt-dlp` behavior has older Pi
evidence. The latest recorded runtime is contained at `9425b1f`; the rail
contract above is tested source behavior at `c8cfe72` awaiting account-specific
refresh, shadow diagnostics, serve promotion, and current couch observation. A
Saved-only or otherwise thin account is a valid setup state; documentation and
tests must not assume five visible rails.

## Serve recommendation constraints

Mango does not expose or scrape an exact "native YouTube home" rail. The official
YouTube Data API no longer provides `search.list relatedToVideoId`, and the
`activities.list home` parameter is deprecated. A literal native-home rail would
need an unofficial/scraping path and must be added as an explicit experimental
operator opt-in, separate from the supported official API cache.

YouTube v2 uses only authoritative subscriptions plus normalized
Takeout/Mango-local meaningful history for recommendation acquisition and ranking. Search, Saved,
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
The latest-only cleanup removed a large legacy service-test surface; before Pi
promotion, add focused HTTP tests for every mode/identity combination, utility
rail ownership, refresh failure/last-good behavior, generation publication,
quota-free reshuffle, and the intended absence of removed acquisition paths.

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
