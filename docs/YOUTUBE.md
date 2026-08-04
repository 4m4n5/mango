# mango — native YouTube

**Milestone:** M6.2 · **Status:** the native YouTube base was previously
Pi-gated; the profile-aware recommendation redesign in this branch is
**local code only**. Current deployment, screenshots, Pi diagnostics, and TV
behavior are **DEFERRED** until the home agent proves this exact revision.

Mango treats YouTube as a first-class content source while preserving the voice
safety contract: voice can search/open/save, but playback starts only when the
user presses **B** on a YouTube video detail.

Earlier nine-card probe results describe the superseded rail contract and are
not evidence for the current four-card allocator. The controller may show
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
| `youtube.db` | Cached videos/channels/playlists, rail membership, recommender/rail reservoirs, refresh/quota counters, auth sessions |
| `library.db` | Viewer profiles, profile-scoped YouTube Saved/history/search/Not-for-me signals, finished state, and current context |
| YouTube Data API | Metadata/search/subscriptions only |
| `yt-dlp -> mpv` | Playback resolution/rendering via the Mango wrapper; no Data API quota use |

`youtube.db` is rebuildable. `library.db` is durable personalization state.
Household preserves legacy state and blends profile activity; a personal
profile starts clean. Profiles have no PIN and are never forced at startup.

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
| `POST` | `/youtube/refresh` | Refresh metadata/cache |
| `GET` | `/youtube/rails` | Four-card anchors in For You → Subscriptions → History → Saved order, then at most three adaptive rails |
| `GET` | `/youtube/rails?reshuffle=1` | Advance only cached discovery rails; History/Saved remain stable and no API quota is spent |
| `POST` | `/youtube/impressions` | Validate opaque served tokens and record exact rendered membership against server-owned profile/source/context; never URLs |
| `GET` | `/youtube/search?q=` | Grouped Videos / Channels / Playlists |
| `GET` | `/youtube/detail?kind=&id=` | Video detail or channel/playlist video list |
| `POST` | `/youtube/not-interested` | Profile-local exact Not-for-me; reversible through the shared library feedback action |
| `POST` | `/youtube/play` | Resolve video with `yt-dlp`, start mpv, write local history |

Compatibility rule: only YouTube videos can be Saved. Channels/playlists open
detail lists but are not Saved entities in M6.2. Saved videos remain in the
active profile's stable Saved rail until explicit Unsave; Not-for-me affects
discovery only and offers Undo instead of deleting history.

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

`/youtube/refresh` is a phase-isolated coordinator. It updates `popular`,
`subscriptions`, `fresh_finds`, `live_now`, `because_you_watched`,
`for_you_discovery`, then rebuilds `for_you_reservoir`. A phase failure is
recorded in `/youtube/state.refresh.phase_results` and as a partial
`last_error`, but it does not abort the remaining phases or clear existing
cached rails. The YouTube step still runs when playability returns a
quota/source/error failure, but it is skipped if another playability
maintenance lock is still active so cache refreshes do not overlap the indexer.
Publishing `for_you_reservoir` is an atomic bounded generation swap: stale
candidates are pruned, retained candidates keep per-profile exposure/outcome
state, and an empty or failed rebuild keeps the previous complete reservoir.

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
`popular` is deliberately cheap because it uses `videos.list(chart=mostPopular)`;
Google currently documents `videos.list` as a 1-unit method. Search-heavy phases
(`fresh_finds`, `live_now`, `because_you_watched`, and `for_you_discovery`)
spend one of the separate daily Search calls, so exhaustion can mark one phase
partial while cached VOD rails and Popular continue to work.

`live_now` is the time-sensitive exception to the long stale-cache posture:
Mango keeps a short-TTL live reservoir and hides expired live candidates instead
of showing day-old "live" cards. Normal `/youtube/refresh` refreshes it, first
from still-fresh cached live metadata and then from bounded live searches. A
non-shuffle YouTube tab load can trigger a throttled background live-only
refresh when the reservoir is older than about 90 minutes. Shuffle never calls
YouTube APIs.

Manual equivalents:

```bash
bash scripts/m3-play/playability/playability-catch-up.sh nightly
bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
bash scripts/m6-ship/youtube-refresh-cache.sh --reason manual
```

Controls: `MANGO_NIGHTLY_YOUTUBE_REFRESH=0` disables the chained nightly step,
`MANGO_YOUTUBE_REFRESH_CACHE=0` skips the refresh helper, and
`MANGO_YOUTUBE_REFRESH_TIMEOUT_SEC` controls the endpoint timeout.

---

## Launcher behavior

- Browse tabs are **Movies · TV Shows · Live · YouTube**.
- Every visible YouTube rail contains exactly four landscape cards. Global
  dedupe runs first; a lane shortage may backfill from the remaining eligible
  pool, but a row still below four is omitted rather than rendered inert/thin.
- Logical anchors are ordered **For You → Subscriptions → History → Saved**.
  An empty durable anchor can be absent; no more than three adaptive rails are
  then admitted from Because You Watched, custom AI rails, Live Now, Fresh
  Finds, and Trending for you.
- History is Mango-local, latest-first, exact-watched, and stable. Saved is
  explicit durable state and stable. Neither rail participates in X shuffle.
- An exact Saved video remains positive taste evidence but is ineligible for
  For You membership, so cross-rail dedupe cannot shrink or omit the Saved
  anchor.
- X advances a deterministic, profile-scoped discovery slate from existing
  cache only. It never pages, refreshes a provider, or calls a YouTube API.
- Cached discovery rails retain the last good result with refresh status; Live
  Now uses a short live TTL and hides expired streams.
- First-run with credentials fills Fresh Finds and the Popular source reservoir
  instead of showing an empty tab when the API quota is available.
- Search normally uses the Data API when configured, but falls back to cached
  metadata with a couch-safe response when quota/rate limits make the API fail.
- Subscriptions is a creator-following inbox: refresh uses OAuth
  subscriptions ordered by activity, scans the newest subscription set plus a
  rotating slice over time, fetches uploads through channel upload playlists
  instead of `search`, stores up to 160 rail candidates, and renders unwatched
  non-live/non-Short videos with channel diversity. Its label never implies
  that Mango has read YouTube watch history.
- Search returns grouped Videos / Channels / Playlists.
- Video detail supports Play, Save/Unsave, reversible Not for me, and Back.
- Channel/playlist detail opens a D-pad list of videos.
- Not for me removes the card from that profile's discovery rails and supports
  Undo. Household applies an exact-title veto if any personal profile marked it;
  feedback never leaks into another personal profile.
- Live videos are kept in Live Now instead of dominating For You / Because You Watched.
- Live Now is Mango's "worth watching live right now" rail: refresh builds a
  rebuildable 120-card short-TTL reservoir from still-fresh cached live metadata,
  subscribed-channel live probes, and official live searches across news/events,
  sports, music/performance, gaming, culture/talks, and wildcard lanes. It
  filters Not for me, Shorts, non-live/ended streams, and low-signal 24/7
  loop/camera/radio-style cards, then renders a diverse four-card row with a
  2-hour live TTL, about 90-minute stale threshold, and 6-hour exposure cooldown.
- Trending for you starts from Mango's rebuildable Popular chart reservoir and
  becomes a transparent local rerank for the active profile and mood. Refresh
  builds the 300-card source reservoir from official
  `videos.list(chart=mostPopular)` calls across the configured region plus
  India/US and broad categories; this uses the cheap `videos.list` quota bucket,
  not the scarce `search.list` bucket. It filters watched videos, Not for me,
  live videos, Shorts, and low-signal cards before local multilingual,
  mood-aware diversity ranking.
- For You is served from a rebuildable 1,000-card local reservoir in
  `youtube.db`. Explicit profile feedback dominates; watches and Saved provide
  dual-horizon evidence without re-recommending the exact Saved video;
  subscriptions are light, topic discovery broadens the pool, and the Popular
  reservoir is fallback only. Every successful rebuild atomically swaps this
  bounded generation and prunes stale members while preserving retained
  profile cooldown/outcome state. With healthy lane supply,
  deterministic four-card patterns deliver 70% close/familiar, 20% adjacent,
  and 10% explore allocation (28/8/4 across ten slates). Thin-supply fallback
  is recorded in `for_you_lane_fallback:last`; exposure cooldown is best-effort
  when supply cannot satisfy both freshness and a complete row.
- Fresh Finds is the broad-discovery rail, not a second For You: refresh builds
  a rebuildable 300-card candidate pool from quality-fresh, taste-adjacent,
  emerging-creator, zeitgeist-light, and wildcard official-API searches; couch
  shuffle samples a four-card set from that cache and never calls YouTube.
- Fresh Finds hides when empty. When populated, it filters watched Mango
  YouTube videos, Not for me, live videos, Shorts, and recent Fresh Finds
  exposure, then prefers unseen channels outside Saved and subscriptions when
  enough alternatives exist.
- Because You Watched is a seed-scoped session-continuity rail. It follows the
  latest meaningful Mango-local YouTube watch, stores follow-up candidates in a
  rebuildable 240-card `youtube.db` reservoir, filters watched/live/Shorts/Not for me
  and low-signal videos, and samples a diverse four-card row from same-channel,
  same-topic, deeper-dive, and wildcard follow-ups. Same-channel contributes a
  familiar anchor, but the rendered row keeps max-one creator when enough
  distinct creators exist. Shuffle never calls YouTube. Playback and
  manual/nightly refresh opportunistically top up this reservoir with bounded
  official Data API searches.
- Launcher attribution chrome names the active profile and optional explicit
  mood. An opaque server token binds immutable profile, rail, served/source
  revisions, exact membership, and the Because You Watched seed where
  applicable. The internal context map is stripped from the public rail DTO;
  stale or tampered actions fail with 409. Numerical scores, source sequence,
  and ranking internals stay private.
- YouTube rail reads carry the launcher's captured profile ID and
  personalization revision. The service checks the pair around asynchronous
  rail assembly and echoes it; the launcher commits only when the request,
  current owner, rail echo, and parallel Saved echo still match. Owner-bound
  caches cannot be reused by another profile or mood revision.
- Companion account connect uses only the HTTPS same-origin
  `/api/catalog/youtube/companion/*` capabilities; broad operator state/auth
  paths are neither requested by the browser nor admitted by the proxy.

## Rail cache summary

| Rail | Role | Source of truth | X behavior |
|------|------|-----------------|------------|
| For You | Anchor | Profile-scoped local ranker over `youtube.db` reservoir | Deterministic cached 70/20/10 slate with healthy supply; diagnosed fallback otherwise |
| Subscriptions | Anchor | OAuth upload cache | Stable within the current cache revision |
| History | Anchor | Profile-scoped Mango watch history in `library.db` | Never shuffled |
| Saved | Anchor | Profile-scoped explicit state in `library.db` | Never shuffled |
| Because You Watched | Adaptive | Latest meaningful profile watch plus cached follow-ups | Deterministic cached slate |
| Custom AI | Adaptive | Background-enriched, locally eligible cached candidates | Deterministic cached slate |
| Live Now | Adaptive | Short-TTL live reservoir | Deterministic cached slate |
| Fresh Finds | Adaptive | Broad-discovery reservoir | Deterministic cached slate |
| Trending for you | Adaptive | Official Popular reservoir, locally reranked | Deterministic cached slate |

At most three adaptive rails are admitted after the anchors. Global dedupe runs
before bounded backfill, and any remaining sub-four row is omitted. Exact
rendered impressions resolve the opaque token back to immutable profile, served
revision, source revision, rail membership, and bounded context without trusting
caller identity or persisting URLs/secrets.

## Recommendation constraints

Mango does not expose or scrape an exact "native YouTube home" rail. The official
YouTube Data API no longer provides `search.list relatedToVideoId`, and the
`activities.list home` parameter is deprecated. A literal native-home rail would
need an unofficial/scraping path and must be added as an explicit experimental
operator opt-in, separate from the supported official API cache.

Fresh Finds uses the same supported boundary: official YouTube search/detail
metadata only, scored locally. Refresh spends a bounded discovery budget
(`search.list` plus batched `videos.list` and optional `channels.list`) during
manual/nightly refresh, then serves the last good cache if a later refresh
fails. The TV shows bounded profile/mood/rail attribution; score breakdowns and
source buckets stay internal for diagnostics.

Trending for you starts with the official `videos.list` most-popular chart and
then applies only Mango's local profile, mood, multilingual, exclusion, and
diversity policy. Cloud AI and unofficial sources are never dependencies of the
couch render path.

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
