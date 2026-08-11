# mango — native YouTube

**Milestone:** M6.2 · **Status:** the native YouTube base and
`youtube-household-v2.7` are deployed on final Pi SHA `04171bb`; exact revision
evidence is in [STATUS.md](STATUS.md). V2.7 uses deeper quality-gated reservoirs
and independent weighted cached shuffles. Automated Pi proof is current;
subjective recommendation quality and physical-TV behavior are not yet
couch-observed.
The latest model keeps authoritative subscription/history v2
as the sole executable recommendation architecture behind an independent
`off|shadow|serve` flag and replaces the lifetime exact-watch veto with a
rolling 30-day cooldown. The current source also includes post-auth account/sync
truth, complete bounded subscription coverage, official metadata evidence,
source/seed portfolio constraints, and an up-to-ten-seed thematic More Like
reserve with uploads-playlist-backed sparse-history recovery. The latest
recorded India account snapshot is Ready with 55 subscriptions.
Its watch-history HTML import produced 2,872 normalized events covering 2,548
unique videos. Those official Takeout events plus the OAuth subscription
snapshot are the only taste/acquisition inputs. The one-time Household reset
removed 986 Mango-local YouTube history rows without changing Takeout, Saved,
progress, ratings, profiles, VOD history, or StoryDNA. Search-history HTML was not imported and cannot affect
recommendations. Exact Pi runtime proof is recorded in [STATUS.md](STATUS.md).

The current Pi runs v2.7 generation 22 with 1,441 candidates: 512 For You, 405
From Subscriptions, 274 Beyond, 250 More Like, and 0 Live, with 55 authoritative
subscriptions. Fifty cached X requests preserved generation, quota counters,
and History at p50 58.83 ms / p95 174.66 ms; Saved was absent in this snapshot,
so no stability claim is invented for it. The protected 25-call interactive
Search reserve remained intact. Cross-shuffle repeats are valid.

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
| `library.db` | Saved, normalized Takeout and Mango-local watch history, exact Not-for-me, finished state, import batches, and current context; only Takeout history may teach the recommender, while personal profile rows remain preserved |
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
| `GET` | `/youtube/state` | Localhost-only, privacy-safe aggregate config/auth/cache/refresh/recommendation diagnostics |
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
Localhost-only `/youtube/state` exposes a broader but still redacted operator
projection: booleans and a classified `yt-dlp` command kind, bounded aggregate
cache/quota/acquisition counts, categorized refresh phases/errors, and opaque
revision/seed references. It never returns command or token-file paths, raw
provider errors, scope strings, IDs, titles, URLs, queries, credentials, or raw
provenance references, and it never crosses the LAN proxy.

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
then atomically publishes the ranked rail generation. A source or publication
failure is reported independently in `/youtube/state`, marks the prior
generation explicitly stale, and never replaces that last-good generation. A
successful complete subscription pagination is authoritative immediately; if
later upload/discovery/publication work fails, the prior served generation
continues against its own published non-Live membership snapshot while Live
remains current-membership and TTL fenced. Complete pagination replaces the
channel snapshot rather than merging stale channels indefinitely. OAuth
completion performs one bounded full uploads
coverage pass; later refreshes rotate 24 channels while retaining generation-
scoped coverage diagnostics. Official video category, default language/audio
language, and tags are cached as private thematic evidence. They can strengthen
a multi-signal relation but cannot create provenance or leak into public cards.
A conclusively missing uploads playlist is counted as covered-but-unavailable
with zero candidates; auth, quota, transport, and other failures remain partial.
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
A triggered history acquisition burst coalesces for 15 minutes and is capped at
12 Search calls. Nightly computes its background allowance from the configured
daily Search budget minus calls already used and the protected 25-call
interactive reserve. It preserves up to eight subscribed-channel Live probes,
then adaptively spends only remaining background capacity. With sufficient
official history, More Like tries up to ten deterministic distinct seeds with
50 results per topic query, seeks at least eight contributing topics, and keeps
using that bounded seed budget toward the 512-item rail cap. Beyond expands
through as many as 32 diverse base seeds and deterministic explained,
documentary, and analysis variants while useful supply remains. Acquisition
stops at the rail cap, the 90-second wall, quota reserve, source exhaustion, or
eight consecutive queries yielding fewer than four new eligible candidates.
Reaching the 90-second acquisition wall is a clean bounded stop: a response
arriving after it is discarded, candidates accepted before it remain eligible
for atomic publication, and diagnostics add no query failure. An ordinary
eight-second request timeout or provider error is a source failure.
Background HTTP work has an eight-second request deadline; interactive Search
keeps its existing result size. More Like topic work uses `search.list`; exact-
channel fallback runs only when thematic work cannot fill four cards and uses
the channel's official uploads playlist. It can publish a coherent hybrid of
one same-channel card plus thematic cards. A shortfall never weakens relation,
provenance, Short/live, cooldown, or duplicate filters and otherwise records
`not_applicable` honestly. Rejected background search tails are not persisted as
recommendation items. `For You` requires both history and subscription
sources when both have eligible supply, limits a single creator or seed before
deterministic shortage relaxation, and `Beyond` caps a seed at two cards.
`Live Now` admits only
currently live streams from the authoritative subscription snapshot; it never
runs a generic live search. OAuth loss serves an explicitly stale last-good
snapshot. A partial authoritative subscription, discovery, or Live source pass
or a publication failure cannot advance the generation; a clean zero-result
source and the clean 90-second bounded stop may. Publication failure is exposed
as the fixed `publication_failed` stale reason. Bounded repair
of already-imported history metadata is best-effort, while recommendation
Search enrichment itself fails closed before persistence. Nightly upload acquisition rotates through every authoritative
subscription up to a 96-channel ceiling and fetches 24 recent uploads per
channel; non-nightly work retains the bounded 24-channel/12-active policy.
Ordinary Home loads and X never initiate any phase.

Serving is snapshot-based. Exact videos meaningfully watched in the preceding
30 days, Saved videos, Not-for-me IDs, and the resolved chronological Household
History pool are primed once at catalog startup and rebuilt at meaningful-
history/import/metadata publication boundaries. Saved and feedback writes
invalidate exact exclusions before the next couch read. A watched video's most
recent qualifying watch owns the rolling cooldown; after 30 days it may return
to recommendation rails on the next generation refresh. Its durable History
entry and decayed taste contribution remain intact.
Rendered rail attribution is committed for the whole response in one SQLite
transaction. This keeps durable action ownership while avoiding repeated
multi-gigabyte library scans, thousands of history-to-metadata lookups, or one
SD-card commit per rail. Diagnostics expose cache readiness/counts only, never
the private IDs.

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
90-day ranking half-life. Mango-local viewing never contributes taste or
acquisition strength. A meaningful Mango-local watch is still withheld as an
exact output-control for 30 days after its most recent watch, while bare starts
remain chronological History/progress only. Known-duration watches enter that
cooldown at `min(25% of duration, 5 minutes)`; unknown-duration watches require
two minutes.

```bash
cd src/catalog-service
npm run youtube:takeout -- /path/to/takeout.zip
```

Takeout is a manual bootstrap, not continuous Google account-history sync. The
supported Data API does not expose account watch history. Mango deliberately
does not ingest exported YouTube Search history: Search, Saved, VOD, profiles,
mood, Companion state, and charts have zero recommendation influence. The
current import was streamed through the loopback-only application endpoint;
only normalized events and the bounded audit receipt remain, while the raw HTML
was discarded. Missing official metadata resolves gradually in bounded nightly
batches without blocking cached serving. Streaming, path-safety, idempotency,
and raw-data-discard behavior are covered by the promotion suite.

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
  launches, including bare starts. Only Takeout watches seed recommendations;
  meaningful Mango-local watches start only the rolling 30-day exact-video
  cooldown. Saved is explicit utility
  state. Both rails are
  chronological/stable and neither affects recommendation scoring.
- For You uses quality-gated official-history and subscription evidence and
  includes both source families when both have eligible supply. History
  affinity rises from 0.60 to 1.00 with decayed strength; subscription-backed
  evidence uses 1.00 rather than a separate fixed 60/40 blend. It excludes videos meaningfully
  watched within the last 30 days, plus exact Saved, Short, and live items, and
  caps creators.
- Beyond Your Subscriptions uses bounded topics derived only from subscriptions
  and decayed history, excludes subscribed channels, and admits at most one card
  per creator.
- More Like samples a daily-stable seed ordering without replacement from the
  twenty most recent meaningful watches, normally caps one channel at two
  seeds, and nightly seeks at least eight contributing topics across up to ten
  50-result thematic queries, continuing quality-gated fill toward a published
  cap of 512. The visible four-card slate prefers distinct seed and
  creator provenance before deterministic shortage relaxation. Exact-channel
  fallback is attempted only when the thematic pool cannot fill four cards.
  Four thematic cards render as **More Like …**; otherwise four same-channel
  cards render as **More from <channel>**; otherwise the rail is honestly
  omitted with `not_applicable`. Per-query diagnostics are counts plus opaque
  seed references. With subscriptions but no history its fallback remains
  **More from channels you follow**.
- From Your Subscriptions shows newest unwatched uploads with at most one card
  per channel when supply permits. Live Now contains only currently live streams
  from subscribed channels. Shorts never appear in recommendation rails. The
  cached item shape has no aspect ratio, so v2 conservatively treats every
  video at or below 180 seconds (or explicitly tagged `#shorts`) as a Short;
  this can exclude a landscape clip but fails closed against vertical Shorts.
- X advances only published recommendation/discovery/subscription/live slates.
  Each epoch is an independent deterministic quality-weighted draw. Four cards
  are sampled without replacement inside the current response, but a later X
  may legitimately repeat one; there is no exposure counter, recent-slate
  exclusion, show-once deck, or deal-through queue. History and Saved remain
  stable; focus position and scroll are preserved; no provider, quota,
  acquisition, enrichment, corpus scan, or ranking work runs.
- Subscription and qualifying history acquisition writes explicit provenance:
  `subscription_upload`, `subscription_live`, `history_channel`, or
  `history_topic`, plus nullable relation and source-position evidence. Generic
  Search/detail/AI/chart cache entries are ineligible
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

Generation quality combines relation (`direct`/`same_topic` 1.00,
`deeper_dive` 0.85, `wildcard` 0.55, unknown 0.35), source position (1.00 down
to 0.55 across ranks 0–49; legacy 0.75), decayed Takeout affinity or
subscription recency, and up to 0.12 of independent-provenance support. Scores
form tier A at 0.65+, B at 0.38+, and C at 0.20+; lower candidates are rejected.
Publication takes all A/B candidates up to 512, then at most 64 C candidates if
capacity remains. Serving multiplies A/B/C by 1.00/0.55/0.25 and a 0.75–1.25
within-tier percentile factor before the deterministic exponential race. This
protects relevance without making the highest-ranked head deterministic and
keeps a positive path to the eligible tail.

## Serve rail cache summary

| Rail | Role | Source of truth | X behavior |
|------|------|-----------------|------------|
| For You | Core | Published rank from history + subscriptions only | Independent cached weighted draw |
| Beyond Your Subscriptions | Core | Provenance-gated history/subscription topic acquisition; subscribed creators excluded | Independent cached weighted draw |
| More Like … | Conditional core position | Up to ten daily-stable official-history seeds, seek eight contributing topics, and continue bounded quality-gated fill toward cap 512; thematic four, sparse-history exact-channel four, or honest omission | Independent cached weighted draw |
| History | Core utility | Normalized Takeout + resolvable Mango-local launches, including bare starts, in `library.db` | Never shuffled |
| Saved | Core utility | Explicit Household state in `library.db`; zero rank influence | Never shuffled |
| From Your Subscriptions | Conditional | Newest unwatched uploads from the authoritative snapshot | Independent cached weighted draw |
| Live Now | Conditional | Currently live streams from subscribed channels only | Independent cached weighted draw; 1–4 cards allowed |

Specialized rails allocate first, then For You fills, while the display order
above remains fixed. Global dedupe runs across all rails. Exact rendered
impressions resolve opaque tokens without trusting caller identity or persisting
URLs/secrets; they are attribution/analytics evidence only and are never read by
the shuffle selector.

### Current rollout boundary

The base product and v2.7 model are deployed at exact Pi SHA `04171bb`.
YouTube migration 17 passed `quick_check`; the nightly-class refresh completed
all six phases and published generation 22. The standard pre-couch gate passed
at `2a93582`, then cache and Reliability-only follow-ups received final targeted
YouTube/library smoke and real Movie + Series lite playback. The first full N3c
attempt stopped at 31/36 and was not rerun, so this is not a final-SHA full-gate
PASS. A Saved-only or otherwise thin account is valid; documentation and tests
must not assume five visible rails. Human relevance, focus/Back, offline, and
physical picture/audio observation remain deferred.

## Serve recommendation constraints

Mango does not expose or scrape an exact "native YouTube home" rail. The official
YouTube Data API no longer provides `search.list relatedToVideoId`, and the
`activities.list home` parameter is deprecated. A literal native-home rail would
need an unofficial/scraping path and must be added as an explicit experimental
operator opt-in, separate from the supported official API cache.

YouTube v2 uses only authoritative subscriptions plus normalized official
Takeout history for recommendation acquisition and ranking. Mango-local viewing
is limited to History/progress and the 30-day exact-video cooldown. Search, Saved,
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

The smoke gate executes only a recognized system `yt-dlp` binary or Mango
wrapper descriptor, skips a genuinely missing command, and fails closed on a
redacted custom-command descriptor that it cannot safely execute. It skips API
search when no API key is configured and skips playback unless
`MANGO_YOUTUBE_PLAY=1`. Focused
source tests cover mode/identity combinations, utility ownership, refresh
failure/last-good behavior, generation publication, quota-free weighted
reshuffle, and the intended absence of removed acquisition paths. Final Pi
runtime proof covers successful v2.7 publication and quota-free cached
reshuffle; forced failure/last-good retention remains source-tested rather than
claimed from the successful runtime refresh.

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
