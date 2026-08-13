# Unified launcher Search

**Status:** source-implemented and previously Pi/UX-gated. Final proof belongs to
the exact current deployment and consolidated [COUCH_TEST.md](COUCH_TEST.md);
older screenshots/SHAs do not close current focus, restoration, or latency.

Mango Search is a temporary launcher surface entered from the magnifier before
Movies. It is not a fifth browse tab and it is not the companion chatbot. Search
shows cards only, never prose, never autoplays, and performs no network work
while the user types.

## Couch contract

- Open Search from the magnifier. It starts blank with a 10-column QWERTY
  keyboard focused, scope chips, up to 12 recent explicit queries, and local
  Saved/history starters.
- Scopes are All, Movies, TV Shows, Live, and YouTube. All includes YouTube
  videos only; YouTube scope can also show Channels and Playlists.
- Local suggestions use the verified Mango index plus cached Live and YouTube
  metadata. Submit is explicit.
- Submitted results arrive progressively as Top Results, Movies, TV Shows,
  Live, YouTube, More Movies & Shows, and optional Related to Your Search.
- Page sizes are derived from the rendered column count so a group always fills
  whole rows: poster groups are six-wide over two rows (12 per page), landscape
  and YouTube groups four-wide over three rows (12 per page), and the Top Results
  summary is capped at 8. When more cached results remain, the final slot becomes
  an in-grid More tile. More reveals the next local snapshot page without another
  provider or YouTube request.
- B opens Detail. Playback remains a second explicit B action in Detail.
- Y from Detail restores the exact Search result and focus. Playback return
  restores that Detail and then Search, including Live and YouTube. Y from
  Search restores the originating Home tab and focus.
- X tap deletes one character; X held for at least 600 ms clears the query.
  Outside Search, X remains the current-tab shuffle action.
- Empty results are successful empty state. A failed source is isolated and
  cannot replace usable rows with a global catalog error. Partial provider
  failures are silent: only successful groups render. If the whole request
  fails, the last usable result snapshot remains; without one, Search shows the
  same neutral **No results** state as a successful empty query.

## Visual and focus contract

Search uses Mango's cinema-dark visual language, not a form or settings layout.
The blank state is one open workspace: a dominant query and Home-matching
scope chips above a 10-column D-pad keyboard, with Recent or Suggestions in
the right column. It has no redundant Search title, nested panel cards, boxed
search field, or decorative copy. The submitted state gives the screen back to
content.

- Empty compose shows a leading caret before the placeholder (`| search mango`).
  After the first character the caret trails the typed text. The caret stays
  visually subordinate so the focused key remains the strongest signal.
- Letter keys share equal geometry in a 10-column rectangle. Delete, space,
  clear, and search fill the leftover A/Z cells so every row is the same width
  and Down/Up stay in the same column. Scope chips match Home browse tabs.
- The band under the keyboard is an editorial stage for the highlighted
  suggestion: stable height, borderless composition, poster or landscape art at
  its native ratio, title plus useful metadata. Recents without art keep a
  typographic fallback so the stage never collapses. Preview swaps only after
  ~180ms dwell, with artwork preload and a short opacity crossfade. No entrance
  animation, parallax, autoplay, shimmer, blur, or layout movement.
- The focused keyboard key uses the same amber ring and soft fill as Home tabs.
  The submit key stays neutral until focused. Amber marks focus, not a filled
  keycap.
- Query, scope, keyboard, starter rows, and their transformed focus rings
  remain inside the outer 5% TV safe area and readable at 1080p couch distance.
  Focus never depends on color alone.
- Recent queries and library starters are vertical, individually focusable
  rows with a source/type label. Right from a keyboard row enters the aligned
  starter row; Left returns to the keyboard. An empty panel is guidance, not an
  error.
- Submitted results keep a compact pinned header: typed query as the page
  anchor, Edit as a restrained secondary action, scopes beneath, one
  hairline/fade into content, and no redundant “Search results” title. Rail
  titles and empty-state copy use the 24–28px TV scale. Progress, starter icons,
  empty-state art, and More cards stay neutral so amber remains the focus language.
- Focused result artwork can tint the full-bleed atmosphere after ~180ms dwell
  at very low opacity under strong static scrims. Header focus clears or freezes
  it. A compositor-cheap scroll-aware fade appears under the pinned head only
  after content has scrolled.
- Results retain one editorial hierarchy: Top Results first in landscape
  geometry, then source rows in their native landscape/poster geometry.
- A small Searching mark appears only before the first useful cards. It
  disappears as soon as any group arrives; source degradation, diagnostics,
  and retry controls never occupy the couch surface. Empty Search uses a
  composed neutral state rather than a catalog-error toast.
- Every More tile is the final item in its own rail's focus grid. Down moves
  through visual rows and into the next rail; pagination controls are never
  collected into detached action rows after the content.
- Typing updates only query text. Existing suggestions remain visible through
  the debounce and are replaced once as a subtree when the next set is ready;
  the header and keyboard are never rebuilt or refocused.
- Progressive revisions reconcile groups by rail ID. Unchanged rails, decoded
  artwork, focused nodes, and scroll state remain mounted. Search state writes
  are coalesced after navigation settles; Detail entry and surface exit still
  flush immediately for restart-safe restoration.
- On an ordinary Chromium self-heal, a valid persisted Search session reopens
  automatically at its query, scope, page, and focus. A playback-return snapshot
  takes precedence and restores Detail first.
- Search has no entrance animation. D-pad focus feedback stays immediate, and
  `prefers-reduced-motion` also removes nonessential transitions.

## Ownership

`catalog-service` owns indexing, adapters, ranking, progressive jobs, caches,
quota admission, and APIs. The launcher owns the active Search session,
D-pad focus, local pagination, and a restart-safe six-hour compact snapshot.

| State | Owner |
|-------|-------|
| Verified VOD and playability state | `playability.db` |
| Search recents, selection tie-breaks, SafeSearch | `/etc/mango/library.db` |
| Rebuildable YouTube query responses | `/etc/mango/youtube.db` |
| Progressive query jobs | `catalog-service` memory; max 32, six-hour retention |
| Launcher query, pages, scroll/focus, origin | `localStorage`, versioned, six-hour expiry |

The local index is atomically rebuilt from distinct verified VOD, cached
YouTube items, and cached Live entries. A stale index keeps serving while a
replacement builds; source checks are throttled to once per 30 seconds.

## Ranking and phases

Normalization uses Unicode decomposition, diacritic removal, lowercase,
punctuation-to-space, and whitespace collapse. Submitted normalized queries
must be 2 to 120 characters.

Literal match classes are strict: exact, prefix, complete-token/contains, then
related. Local selection learning is age-decayed and bounded to a tie-break
inside a match class. It cannot outrank an exact match or promote Related into
Top Results.

| Phase | Deadline | Behavior |
|-------|----------|----------|
| Local verified/cached | immediate | First snapshot; previous index remains available during rebuild |
| External VOD | 2.5 s | No automatic queueing; unverified cards stay in More Movies & Shows |
| Live | 2.5 s | At most one unknown candidate is validated |
| YouTube | 2.5 s | Query cache first, then at most one shared interactive `search.list` request |
| AI expansion | 4 s total | Optional no-tools/no-history JSON expansion; max three alternate queries |

Identical external, Live, and YouTube work is joined in flight. A superseded
launcher session is cancelled, late phase output is ignored, and one source
failure does not fail the job.

AI expansion runs only for descriptive queries or fewer than three strong
literal matches. It searches verified/cached content and external VOD; it
never multiplies YouTube API calls or Live probes.

## YouTube quota and cache

YouTube query-cache keys include normalized query, requested kinds, SafeSearch,
region, and language. Results remain fresh for 24 hours; the table is pruned
expired/LRU to 200 keys and can retain up to 50 results per query for local
pagination.

Mango accounts the current official quota buckets before dispatch:

- General metadata budget: 10,000 units on the Pacific-day boundary, with
  2,500 units protected for interactive metadata.
- Search budget: 100 `search.list` calls per Pacific day, with 25 calls
  protected for interactive couch Search.
- Background work stops before entering either applicable reserve.
- `search.list`: one call from the separate Search Queries bucket.
- `videos.list`, `channels.list`, playlist/subscription metadata: 1 unit per
  request.

Repeated queries join an in-flight request or use cache. Normal Search has no
cache-bypass control because a miss already refreshes the 24-hour cache.
Provider failures remain internal; the next explicit search may use or refresh
the cache normally. Couch pagination, shuffle, and `yt-dlp -> mpv` playback do
not spend Data API quota.

## External VOD verification

External cards are isolated from verified Mango rows. Opening one uses the
existing Detail stream-list resolver. Only a successful, conclusive empty
stream result from a Search-origin card queues `search_unavailable` into the
existing playability trigger pipeline. Timeout, provider failure, focus,
metadata load, AI expansion, and ordinary Search result display never queue a
title.

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/search/state` | Recents, starters, preferences, source/index and YouTube cache/quota readiness |
| `GET` | `/search/suggestions?q=&scope=&limit=` | Local-only suggestions |
| `POST` | `/search/query` | Start progressive search; `202` with initial snapshot |
| `GET` | `/search/query/{id}?after_revision=&wait_ms=` | Bounded long-poll for a newer full snapshot |
| `POST` | `/search/query/{id}/cancel` | Suppress a superseded session |
| `POST` | `/search/query/{id}/youtube/retry` | Localhost-only retry of a completed degraded YouTube phase |
| `POST` | `/search/selection` | Record bounded local selection affinity |
| `POST` | `/search/external/queue` | Localhost-only confirmed-empty VOD queue |
| `DELETE` | `/search/history` | Localhost-only clear of recents and learning |
| `GET/PUT` | `/search/preferences` | Read/update YouTube SafeSearch |
| `POST` | orchestrator `/search/expand` | Localhost-only optional structured expansion |

The launcher reaches these through the existing `/api/catalog/*` proxy.
Operator state and secrets remain under `/etc/mango`; no runtime DB is
committed.

## Gates

```bash
cd src/catalog-service && npm run test:gate && npm test
cd src/launcher && npm run build
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
bash scripts/m6-ship/gate-m6-ux-smoke.sh
bash scripts/m6-ship/gate-m6-search-smoke.sh
```

`gate-m6-search-smoke.sh` uses diagnostic mode: local/cached retrieval only,
no recent-query write, no YouTube quota spend, no Live validation, no external
provider work, no AI call, and no playback side effect.

Human acceptance is in [COUCH_TEST.md](COUCH_TEST.md).
