# mango — native YouTube

**Milestone:** M6.2 · **Status:** implemented and deploy-gated; Pi credential/playback smoke required before couch sign-off.

Mango treats YouTube as a first-class content source while preserving the voice
safety contract: voice can search/open/save, but playback starts only when the
user presses **B** on a YouTube video detail.

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
| `library.db` | YouTube Saved videos, watch history, finished state, current context, Not Interested feedback |
| YouTube Data API | Metadata/search/subscriptions only |
| `yt-dlp -> mpv` | Playback resolution/rendering via the Mango wrapper; no Data API quota use |

`youtube.db` is rebuildable. `library.db` is durable household state.

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
| `GET` | `/youtube/state` | Config/auth/cache/refresh status |
| `POST` | `/youtube/auth/start` | Start Google device-code OAuth |
| `GET` | `/youtube/auth/poll?session_id=` | Poll OAuth completion |
| `POST` | `/youtube/auth/disconnect` | Remove local auth token |
| `POST` | `/youtube/refresh` | Refresh metadata/cache |
| `GET` | `/youtube/rails` | 9-up Saved, History, For You, subscriptions, Fresh Finds, Because You Watched, Live Now, Popular |
| `GET` | `/youtube/rails?reshuffle=1` | Re-sample History from Mango-local watched videos and cached discovery rails for the launcher shuffle button |
| `GET` | `/youtube/search?q=` | Grouped Videos / Channels / Playlists |
| `GET` | `/youtube/detail?kind=&id=` | Video detail or channel/playlist video list |
| `POST` | `/youtube/not-interested` | Exclude from YouTube rails via local feedback |
| `POST` | `/youtube/play` | Resolve video with `yt-dlp`, start mpv, write local history |

Compatibility rule: only YouTube videos can be Saved. Channels/playlists open
detail lists but are not Saved entities in M6.2. Saved videos remain in the
Saved rail until explicit Unsave; Not Interested only affects discovery rails.

## Scheduled refresh

The native YouTube cache is refreshed by the nightly library wrapper after the
movie/TV playability maintenance attempt:

```bash
bash scripts/m3-play/playability/install-playability-timer.sh
```

That installs `mango-playability-indexer.timer` for 03:00. The service runs
`nightly-library-refresh.sh --mode nightly --preset nightly`, which executes
playability stale+grow first and then calls `POST /youtube/refresh` through
`scripts/m6-ship/youtube-refresh-cache.sh`. This is also the preferred manual
"run everything" workflow: one command refreshes movie/TV library state and then
YouTube.

`/youtube/refresh` is a phase-isolated coordinator. It updates `popular`,
`subscriptions`, `fresh_finds`, `live_now`, `because_you_watched`,
`for_you_discovery`, then rebuilds `for_you_reservoir`. A phase failure is
recorded in `/youtube/state.refresh.phase_results` and as a partial
`last_error`, but it does not abort the remaining phases or clear existing
cached rails. The YouTube step still runs when playability returns a
quota/source/error failure, but it is skipped if another playability
maintenance lock is still active so cache refreshes do not overlap the indexer.

`live_now` is the time-sensitive exception to the long stale-cache posture:
Mango keeps a short-TTL live reservoir and hides expired live candidates instead
of showing day-old "live" cards. Normal `/youtube/refresh` refreshes it, and a
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
- YouTube rails are capped at 9 cards, matching Movies/TV Shows.
- YouTube VOD discovery rails keep stale cached results visible with refresh
  status; Live Now uses a short live TTL and hides expired streams.
- History is Mango-local only: the latest view shows 9 unique YouTube videos
  watched in Mango, and shuffle samples 9 random videos from the full local
  YouTube watch set.
- The shuffle button is available on YouTube and re-samples History, For You,
  and cached discovery rails without couch-time API calls.
- First-run with credentials fills Fresh Finds and Popular instead of showing an empty tab.
- Search normally uses the Data API when configured, but falls back to cached
  metadata with a couch-safe response when quota/rate limits make the API fail.
- New From Subscriptions is a creator-following inbox: refresh uses OAuth
  subscriptions ordered by activity, rotates through subscribed channels over
  time, fetches uploads through channel upload playlists instead of `search`,
  and renders unwatched non-live/non-Short videos with channel diversity.
- Search returns grouped Videos / Channels / Playlists.
- Video detail supports Play, Save/Unsave, Not Interested, Back.
- Channel/playlist detail opens a D-pad list of videos.
- Not Interested removes the card from discovery rails and persists a local downrank/exclusion.
- Live videos are kept in Live Now instead of dominating For You / Because You Watched.
- Live Now is Mango's "worth watching live right now" rail: refresh builds a
  rebuildable short-TTL reservoir from subscribed-channel live probes plus
  official live searches across news/events, sports, music/performance, gaming,
  culture/talks, and wildcard lanes. It filters Not Interested, Shorts,
  non-live/ended streams, and low-signal 24/7 loop/camera/radio-style cards,
  then renders a diverse 9-card row with a 6-hour exposure cooldown.
- For You is served from a rebuildable local reservoir in `youtube.db`: Mango
  watches/Saved are strongest, subscriptions are light, topic discovery broadens
  the pool, Popular is fallback only, and each render samples a diverse 9-card
  set with 7-day exposure cooldown.
- Fresh Finds is the broad-discovery rail, not a second For You: refresh builds
  a rebuildable candidate pool from quality-fresh, taste-adjacent,
  emerging-creator, zeitgeist-light, and wildcard official-API searches; couch
  shuffle samples a fresh 9-card set from that cache and never calls YouTube.
- Fresh Finds hides when empty. When populated, it filters watched Mango
  YouTube videos, Not Interested, live videos, Shorts, and recent Fresh Finds
  exposure, then prefers unseen channels outside Saved and subscriptions when
  at least 9 alternatives exist.
- Because You Watched is a seed-scoped session-continuity rail. It follows the
  latest meaningful Mango-local YouTube watch, stores follow-up candidates in a
  rebuildable `youtube.db` reservoir, filters watched/live/Shorts/Not Interested
  and low-signal videos, and samples a diverse 9-card row from same-channel,
  same-topic, deeper-dive, and wildcard follow-ups. Same-channel contributes a
  familiar anchor, but the rendered row keeps max-one creator when enough
  distinct creators exist. Shuffle never calls YouTube. Playback and
  manual/nightly refresh opportunistically top up this reservoir with bounded
  official Data API searches.
- Companion account connect uses the HTTPS companion same-origin `/api/catalog/*`
  proxy; direct browser calls to `:3020` are not required.

## Recommendation constraints

Mango does not currently expose an exact "native YouTube home" rail. The official
YouTube Data API no longer provides `search.list relatedToVideoId`, and the
`activities.list home` parameter is deprecated. A literal native-home rail would
need an unofficial/scraping path and must be added as an explicit experimental
operator opt-in, separate from the supported official API cache.

Fresh Finds uses the same supported boundary: official YouTube search/detail
metadata only, scored locally. Refresh spends a bounded discovery budget
(`search.list` plus batched `videos.list` and optional `channels.list`) during
manual/nightly refresh, then serves stale cached results if a later refresh
fails. The TV UI does not show reason labels; score breakdowns and source
buckets stay internal for diagnostics.

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
- YouTube Data API revision history:
  <https://developers.google.com/youtube/v3/revision_history>
- YouTube activities API:
  <https://developers.google.com/youtube/v3/docs/activities/list>
- `yt-dlp` FAQ:
  <https://github.com/yt-dlp/yt-dlp/wiki/FAQ>
