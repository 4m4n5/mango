# mango launcher — surfaces & states inventory

Exhaustive, code-derived inventory of every user-visible surface and state in the mango TV launcher (Chromium kiosk, TypeScript + vanilla DOM, Vite), for the UI/UX polishing round.

**Scope note:** inventory only — no design recommendations. All paths are relative to `/Users/aman.shrivastava/Documents/personal/projects/mango`. Line numbers are approximate (source at time of audit); re-check before editing.

**Source files audited:** `src/launcher/index.html`, `src/launcher/src/{main,home,detail,search,saved,settings,reliability,toast,next-prompt,voice-hud,focus,pad-nav,layout,poster,activity,refresh,ui-flags,catalog,catalog-errors,playback-return,playback-reconciliation,stream-list-recovery,types,voice-commands}.ts`, `src/launcher/src/style.css` (spot-checked for state-driven classes).

---

## Table of contents

1. [Top-level navigation structure](#1-top-level-navigation-structure)
2. [Boot / first paint](#2-boot--first-paint)
3. [Shell chrome — browse bar](#3-shell-chrome--browse-bar)
4. [Home — browse tabs](#4-home--browse-tabs)
5. [Home — catalog rails container](#5-home--catalog-rails-container)
6. [Rail card variants](#6-rail-card-variants)
7. [Apps rail / Settings tile](#7-apps-rail--settings-tile)
8. [Library refresh / shuffle (browse-bar button)](#8-library-refresh--shuffle-browse-bar-button)
9. [Search — compose mode](#9-search--compose-mode)
10. [Search — results mode](#10-search--results-mode)
11. [Detail page — hero](#11-detail-page--hero)
12. [Detail page — streams panel (movies)](#12-detail-page--streams-panel-movies)
13. [Detail page — episodes panel (series)](#13-detail-page--episodes-panel-series)
14. [Detail page — YouTube video list variant](#14-detail-page--youtube-video-list-variant)
15. [Detail page — related titles rail](#15-detail-page--related-titles-rail)
16. [Next-episode prompt (overlay)](#16-next-episode-prompt-overlay)
17. [Toast](#17-toast)
18. [Voice HUD](#18-voice-hud)
19. [Settings — Pi connection panel](#19-settings--pi-connection-panel)
20. [Settings — Reliability Center](#20-settings--reliability-center)
21. [Settings — Search settings](#21-settings--search-settings)
22. [Settings — Library refresh levels](#22-settings--library-refresh-levels)
23. [Focus ring / selection treatment (cross-cutting)](#23-focus-ring--selection-treatment-cross-cutting)
24. [Poster placeholder / image fallback (cross-cutting)](#24-poster-placeholder--image-fallback-cross-cutting)
25. [Feature flags (ui-flags.ts)](#25-feature-flags-ui-flagsts)
26. [Catalog/network error taxonomy (cross-cutting)](#26-catalognetwork-error-taxonomy-cross-cutting)
27. [Playback-return restoration (cross-cutting transition, not a surface)](#27-playback-return-restoration-cross-cutting-transition-not-a-surface)
28. [Full text-string index by surface](#28-full-text-string-index-by-surface)
29. [Notable inconsistencies / unfinished-looking areas](#29-notable-inconsistencies--unfinished-looking-areas)

---

## 1. Top-level navigation structure

There is **no persistent left-nav / bottom-nav rail**. The launcher is a single `#app.shell` with five mutually-exclusive full-screen `<section class="view">` panels toggled via `.hidden`, plus three always-mounted overlays (toast, voice HUD, next-episode prompt).

```1:140:src/launcher/index.html
<main id="app" class="shell" aria-label="mango">
  <section id="home-view" class="view home">…</section>
  <section id="search-view" class="view search hidden">…</section>
  <section id="detail-view" class="view detail hidden">…</section>
  <section id="next-episode-prompt" class="next-prompt hidden">…</section>
  <div id="toast" class="toast">…</div>
  <aside id="voice-hud" class="voice-hud">…</aside>
  <section id="settings-view" class="view settings hidden">…</section>
</main>
```

Within `home-view`, a **browse-tabs strip** (not full-screen views) switches catalog content: `movies` → `series` (label "tv shows") → `live` → `youtube` (`BROWSE_TAB_ORDER` in `home.ts:29`). "Settings" and "Search" are reached via tiles/buttons, not tabs. There is no distinct "Saved" top-level tab — saved items surface as a `saved` rail inside Movies/Series/YouTube tabs (`SAVED_RAIL_ID` in `main.ts:35`), and no distinct "Reliability Center" tab — it lives inside Settings.

**One-line summary:** `Home(browse tabs: movies · tv shows · live · youtube) + Search + Detail + Settings(incl. Reliability Center + Search settings + Library refresh) — Saved is a rail, not a tab.`

---

## 2. Boot / first paint

- **DOM/CSS:** `body` inline style `background:#07080a` (`index.html:8`) painted before any JS runs — this is the literal first frame.
- **File:line:** `index.html:8`, `main.ts:193-220` (`init()`).
- **What the user sees:** black/near-black screen → `home-view` renders synchronously with `renderHome()` (`main.ts:198`), which immediately shows the catalog-loading state (see §5) because `catalogState` starts as `{status:"loading"}` (`main.ts:75`). Browse bar (brand "mango", search button, tabs, shuffle) appears instantly since it doesn't depend on data.
- **States:**
  - Pre-JS paint: solid dark background only.
  - JS init, catalog not yet fetched: browse bar + "Loading catalog…" message (§5).
  - Playback-return short-circuit: if a `playback-return` snapshot exists in `localStorage`/`sessionStorage` (e.g. Chromium was restarted mid-play for 4K display matching), `loadCatalog()` is skipped entirely on boot in favor of restoring the detail/tab-home surface (`main.ts:215-218`, `tryRestorePlaybackReturnOnBoot`) — i.e. boot can land directly back on the Detail page instead of Home.
  - `/api/info` populates Settings' Pi-connection fields asynchronously (`loadInfo()`, `main.ts:1173-1190`); falls back to hardcoded `mango` / `10.0.0.174` values silently on failure (no visible error — see §19).
- **Entry/exit:** N/A (automatic).
- **Flags:** none.

---

## 3. Shell chrome — browse bar

- **DOM/CSS:** `.browse-bar` (`index.html:11-22`) — always visible while `home-view` is not hidden.
- **File:line:** `index.html:11-22`; wiring `main.ts:196-197, 303-334`.
- **What the user sees**, left to right:
  1. `.browse-brand` — static text **"mango"** (`index.html:12`, `aria-hidden`, not focusable/clickable).
  2. `#search-entry.browse-search` — button, icon glyph **"⌕"** + label **"search"** (`index.html:13-16`), `aria-label="Search Mango"`.
  3. `#browse-tabs.browse-tabs` — dynamically built tab list (§4).
  4. `#library-refresh.browse-shuffle` — icon **"↻"** + label **"shuffle"** (`index.html:18-21`), `aria-label="Shuffle library"`.
- **States:**
  - Shuffle button is **hidden** (`hidden` attribute) whenever `activeBrowseTab === "live"` — live channels don't reshuffle (`main.ts:306-307`).
  - Shuffle button gets `.browse-shuffle--active` class while a reshuffle request is in flight (`main.ts:852,865`).
  - Rails container gets `.rails--refreshing` (opacity 0.62, `style.css:829`) during reshuffle and `.rails--refresh-settled` (fade back to 1, 320ms) right after (`main.ts:853-854,866-868`).
  - Focused state on any of the three interactive chrome elements: `.focused` / `:focus-visible` (`style.css:146-147,188-189,224-225`).
- **Entry/exit:** Search button → B/Enter/click opens Search (§9). Shuffle → B/Enter/click or gamepad "shuffle" action (`pad-nav.ts`) or **F5** key triggers `libraryRefresh()` (`main.ts:557-561`). Browse tabs → L/R shoulder buttons or F6/F7 cycle tabs (`cycleBrowseTab`, `main.ts:439-452`), or direct click.
- **Flags:** none directly, but see §25 for poster label flag affecting cards below this bar.

---

## 4. Home — browse tabs

- **DOM/CSS:** `<nav id="browse-tabs" class="browse-tabs">` populated by `buildBrowseTabs()`.
- **File:line:** `home.ts:31-57`.
- **What the user sees:** one `<button class="browse-tab">` per tab, label text = `id === "series" ? "tv shows" : id` → **"movies"**, **"tv shows"**, **"live"**, **"youtube"** (`home.ts:29,40`).
- **States:**
  - Active tab: `.browse-tab--active` (`home.ts:44`), with its own focused-state override (`style.css:203-204`).
  - Focused (D-pad landed on it, not necessarily active): `.focused`.
  - Inactive/unfocused: base `.browse-tab` style.
- **Entry/exit:** Click or D-pad-select on a tab button → `handleBrowseTabChange()` (`main.ts:428-437`); L/R shoulder or F6/F7 cycles without opening a picker; voice command `onTab` (`main.ts:232-243`) also switches tabs and forces tab-row focus.
- **Flags:** none.

---

## 5. Home — catalog rails container

- **DOM/CSS:** `#rails.rails` (`index.html:23`) holds one `.rails__tab` container per active tab (only one mounted at a time; `main.ts:403-426` `mountRailsView`) plus the always-present apps section.
- **File:line:** `appendCatalogSections()` — `home.ts:130-193`; render orchestration `main.ts:303-334,354-388,872-968`.
- **What the user sees (ready state):** stacked `<section class="rail rail--catalog">` blocks, each with an `<h2 class="rail-title">` (title-cased rail label via `formatRailLabel`, `home.ts:234-240`) and a horizontally-scrolling `.rail-track.rail-track--posters` of cards (§6). Known rail ids include `continue-watching` and `saved` (`main.ts:34-35`), plus provider/AI-catalog rails from the backend (labels are server-driven, not hardcoded).
- **Every state:**
  | State | Trigger | DOM | Copy |
  |---|---|---|---|
  | `loading` | `catalogState.status==="loading"` (initial load, tab switch w/o cache) | single `.rail.rail--empty[data-rail-id="catalog"]` message block | Heading **"Catalog"**; title **"Loading catalog…"**; body **"posters will appear here when the Pi responds."** (`home.ts:137,204-232`) |
  | `error` | fetch failure, no usable cache | same `.rail--empty` block | Heading **"Catalog"**; title **"catalog offline"**; body = raw/derived error message (see §26), fallback **"catalog temporarily unavailable"** (`home.ts:141-144`, `main.ts:944-947`) |
  | `ready`, rail has cards | normal | `.rail--catalog` with poster track | rail label from backend |
  | `ready`, rail has **zero** cards | e.g. an AI catalog with nothing resolved | `.rail--catalog` with `<p class="rail-empty">nothing resolved yet</p>` instead of a track (`home.ts:157-163`) — no cards, no track, no focus row |
  | `ready`, whole tab has 0 total items | catalog fetch succeeded but returned no posters | no toast; status line (reused as toast only if failure copy) reports **"catalog loaded with no posters"** (`main.ts:927,931`) — this message is silently dropped because `setStatus()` only surfaces failure-shaped strings as a toast (`main.ts:1192-1199`), so this state is **effectively invisible to the user** (see §29) |
  | reshuffling | shuffle button / F5 / `mango:library-refresh` event | `.rails--refreshing` opacity dim on `#rails` | none (or **"refreshing…"** if not quiet) |
  | retry-after-error | error + cached rails unavailable, not returning from playback | none new | status becomes retryable text (§26), auto-retries every 5s (`catalogRetryTimer`, `main.ts:959-961`) |
  | tab-cached instant swap | switching to a previously-loaded tab | cached DOM reused (`tabRenderCache`), no loading flash | — |
  | live tab "frozen session" | `liveCatalogSessionCached` true | rails reused verbatim, no refetch | — |
- **Entry/exit:** entered automatically on Home mount / tab change; exited by opening Search, Detail, or Settings (all hide `home-view`).
- **Flags:** `MINIMAL_VOD_POSTER_LABELS` affects card rendering inside this container (§6, §25).

---

## 6. Rail card variants

All cards are `<button class="card card--poster …">` built by `createPosterCard()` (`home.ts:255-344`) or, for search "More" cards, `createMoreCard()` (`search.ts:806-847`), or related-title cards in Detail (`detail.ts:803-845`).

- **File:line:** `home.ts:255-344` (base), `home.ts:242-253` (landscape/live-pill predicates), `poster.ts` (image fallback).
- **Layout variants:**
  - **Portrait** (`card--portrait`) — default for movies/series/YouTube-channel-ish content. Structure: `poster-image` → `poster-shade` gradient → `poster-content` (title + subtitle spans) → optional `poster-progress` bar → optional `card-live-pill`.
  - **Portrait, minimal** (`card--poster-minimal`, added only when `MINIMAL_VOD_POSTER_LABELS` flag is on **and** card is portrait **and** tab is movies/series, `home.ts:267-273`) — hides `.poster-content` and `.poster-shade` entirely (`style.css:1079-1082`), i.e. **no title/subtitle text overlay at all**, relying on poster art alone.
  - **Landscape** (`card--landscape`) — used for `live`/`youtube` tabs, `tv` type, `youtube_*` types, or any card with a `liveStatus` (`home.ts:242-249`). Structure: `poster-frame` (image + optional progress bar + optional live pill) → `poster-content`.
  - **App tile** (`card--app`, §7) — distinct structure, kicker + title only.
  - **Related card** (`card--related`, §15) — portrait-only variant, always shows title/subtitle (ignores the minimal-label flag).
  - **"More" card** (search results only, §10) — arrow glyph **"→"**, title **"More"**, subtitle = group label.
- **States:**
  - **Saved**: `.card--saved` → CSS `::after` renders a **★** badge top-right (`home.ts:275-277`, `style.css:988-992`).
  - **Live pill**: small **"live"** badge shown when `card.liveStatus === "live"` or (tab is `live` and type is `tv`) (`home.ts:251-253,301-309`).
  - **Progress bar**: `poster-progress` shown whenever `progressPct > 0`, width driven by CSS var `--progress` (`home.ts:315-321,335-341`).
  - **Poster fallback / broken image**: see §24.
  - **Focused**: `.focused`/`:focus-visible` (§23).
  - **Empty rail**: no cards rendered at all — see §5 table (`rail-empty` text "nothing resolved yet").
- **Entry/exit:** click / B-select → `onContentSelect` → opens Detail (§11) with `railLabel` and (for Home) `browseTab` context; for Search results, opens Detail with `surface:"search"` origin.
- **Flags:** `MINIMAL_VOD_POSTER_LABELS` (see §25).

---

## 7. Apps rail / Settings tile

- **DOM/CSS:** `<section class="rail rail--apps">` appended after the active catalog tab (`home.ts:105-128`, `main.ts:336-346,399-426`) — always mounted, shared across tab switches.
- **File:line:** `home.ts:105-128,346-372`.
- **What the user sees:** heading **"apps"**, one `<button class="card card--app">` — kicker **"system"**, title **"settings"** (`DEFAULT_APP_CARDS`, `home.ts:25-27`).
- **States:**
  - Default.
  - Focused (`.focused`).
  - **Health badge**: `<span class="card-health-badge hidden" data-settings-health>` overlaid on the tile (`home.ts:364-369`). Hidden by default; shown with text **"needs repair"** (red reliability) or **"check health"** (yellow), never rendered for green (`reliabilityBadgeText()`, `settings.ts:265-269`). Refreshed ~500ms after each render and after Settings closes (`scheduleReliabilityBadge`/`refreshReliabilityBadge`, `main.ts:744-769`).
- **Entry/exit:** click/select → `handleAppSelect` → `showSettings()` (§19) if `app.action === "settings"` (`main.ts:722-726`). Currently the **only** app tile that exists — the rail architecture supports more but none are defined.
- **Flags:** none.

---

## 8. Library refresh / shuffle (browse-bar button)

Covered structurally in §3; behavior/state detail here since it drives a distinct interaction.

- **File:line:** `libraryRefresh()` — `main.ts:841-870`.
- **States / copy:**
  - Tab is `live`: **"this tab refreshes from its own source."** (non-quiet only) — no actual refresh happens (`main.ts:845-850`).
  - In-flight, non-quiet: status **"refreshing…"**.
  - In-flight, quiet (triggered by `mango:library-refresh` custom event from Settings, `main.ts:211,331`): no status text.
  - Success, non-quiet: **"updated — keep browsing"**.
  - Guarded no-op: while Detail or Settings is open, or another refresh is already in flight (`main.ts:842`).
- **Entry/exit:** click, B-select, gamepad "shuffle" action, or **F5** key (only when Detail closed and Home visible, `main.ts:557-561`).

---

## 9. Search — compose mode

- **DOM/CSS:** `#search-view.view.search` (`index.html:26`), rendered entirely in JS by `SearchController.render()` when `!submitted` → `.search--compose` class (`search.ts:502-580`).
- **File:line:** `search.ts:502-627` (keyboard), `629-713` (starters/suggestions).
- **What the user sees, top to bottom:**
  1. `.search-atmosphere` — decorative, `aria-hidden`.
  2. `.search-head` — query pill (icon + text, placeholder **"Search Mango"** when empty, blinking caret span while composing) + edit button (hidden while composing) + `.search-scopes` chip row: **all / movies / tv shows / live / youtube** (`SCOPES`, `search.ts:85-91`).
  3. `.search-compose-body` containing:
     - `.search-keyboard` — heading **"Keyboard"**, hint **"X delete · hold to clear"**, QWERTY-ish rows (`1234567890` / `qwertyuiop` / `asdfghjkl` / `zxcvbnm`, `search.ts:92-97`) each key uppercased, plus an actions row: **space / delete / clear / search** (search button has a magnifier icon prefixed).
     - `.search-starters.search-discovery` — heading toggles **"Suggestions"** (when typed query ≥2 chars has matches) vs **"Recent"** (query empty, showing recents + starters) (`search.ts:670`). Each item shows an icon (search/clock/play), title, and meta line via `contentTypeLabel()` — **"YouTube"**, **"TV show"**, **"Live channel"**, **"Movie"**, **"From your library"**, or **"Recent search"** (`search.ts:155-161,650`).
- **Every state:**
  - Query empty: placeholder text, no caret hidden (caret always shows while composing), starters = recents + starters.
  - Typing, <2 chars: no suggestions fetched (`shouldClearSuggestions`, `search.ts:107-109`), starters still show recents/starters.
  - Typing, ≥2 chars: 120ms-debounced `/api/catalog/search/suggestions` call; starters panel switches to "Suggestions" heading and swaps content.
  - **Empty starters, no query**: `.search-starter-empty` — icon + **"Type to see suggestions."** (`search.ts:705`).
  - **Empty starters, has query but no suggestions**: same block, copy **"No local suggestions yet."** (`search.ts:705`).
  - Scope chip active: `.search-chip--active`, `aria-pressed="true"` (`search.ts:557-558`).
  - `/api/catalog/search/state` fetch failure on open: non-blocking `onStatus` — **"Search is ready. Recent activity is temporarily unavailable."** (`search.ts:291`).
  - Query length capped at 120 chars (`search.ts:399`).
- **Entry/exit:** Entered via `#search-entry` click/B or Search key command (`openSearch()`, `main.ts:620-632`), which also sets status **"Type with the D-pad. X deletes; hold X clears. B selects."**. Typing a character (soft-keyboard, physical keyboard passthrough, or gamepad key-buttons) doesn't submit; **Enter/B on the search button, or Enter key** submits (`submit()`, `search.ts:440-467`) → transitions to Results mode (§10). **X (secondary tap)** deletes last char, **hold-X** clears query (`search.ts:339-345`); **Escape/Y** or Home closes back to origin (`close()`, `search.ts:318-325`, restoring either Home or Detail depending on how Search was entered).
- **Flags:** none.

---

## 10. Search — results mode

- **DOM/CSS:** same `#search-view`, now `.search--results` class, `renderResults()` (`search.ts:715-804`).
- **File:line:** `search.ts:715-804` (results/toolbar), `849-870` (YouTube retry).
- **What the user sees:**
  1. Header unchanged (query pill now shows submitted text with an edit-pencil button, no caret; scope chips still switchable — re-submits on change, `search.ts:546-556`).
  2. `.search-results-toolbar` (only rendered if it has children) containing, conditionally: a **"Searching"** progress indicator (animated mark + text, shown while `!snapshot.complete`), a degraded-phase note, and/or a **"retry YouTube"** button.
  3. `.search-results.rails` — one `.rail` block per non-empty result group (Mango/movies/series/live/YouTube), built via the same `buildCatalogRails()` used on Home, so cards/landscape rules match Home exactly. Each group can end in a **"More"** trailing card (§6) when more results exist beyond the current page window (`searchGroupPageWindow`). Page size is derived from `railColumns()` — two poster rows or three landscape rows — so a revealed page always lands on whole rows; it was formerly the literals 9 and 12, which fitted the old 9-poster/6-landscape grid and went stale when that grid was resized.
- **Every state:**
  | State | Condition | Copy |
  |---|---|---|
  | pending, zero groups yet | `!snapshot.complete` and no groups with items | `.search-message` — heading **"Searching"**, body **"Checking Mango, Live and YouTube."** (`search.ts:764-768`) |
  | complete, zero results | `snapshot.complete` and no groups with items | heading **"No results"**, body **"Try another title, channel or topic."** |
  | degraded phase | any phase status `degraded`/`failed` with a message | `.search-degraded` note text = server-provided phase message (`search.ts:774-782`) |
  | YouTube phase failed/degraded, search complete | `youtubePhase.status` in `{degraded,failed}` | **"retry YouTube"** button appears in toolbar and as a focusable row (`search.ts:786-799`) |
  | YouTube retry in-flight | click retry | status **"Retrying YouTube…"** |
  | YouTube retry success | | status **"YouTube results updated."** |
  | YouTube retry still failing | | status **"YouTube is still unavailable. Other results are ready."** |
  | submit validation fail | query <2 chars trimmed | status **"Type at least 2 characters."** (no request sent) |
  | submit network fail | fetch throws | status = server error message or **"Search is temporarily unavailable."** |
  | search in progress (initial) | after successful submit | status **"Search complete."** or **"Searching every source…"** depending on `response.complete` |
  | long-poll complete | poll resolves with `complete:true` | status **"Search complete."** or **"No matches. Try another title, channel, or topic."** |
- **Entry/exit:** submit from compose mode; **edit** button or re-typing returns to compose (clears `submitted`/`snapshot`, `search.ts:533-537`). Selecting a result → `openResult()` persists `SearchRestoreState` and opens Detail with `origin:"search"` (so Detail's back/Y restores Search results exactly, including scroll/focus/page windows — `search.ts:918-940`). Closing Search (Y/Escape/Home) restores whichever Home tab/position was active when Search was opened.
- **Flags:** none.

---

## 11. Detail page — hero

- **DOM/CSS:** `#detail-view.view.detail` (`index.html:28-73`); controller `DetailController` (`detail.ts:55-1821`).
- **What the user sees, structurally:**
  - Full-bleed `.detail-backdrop` blurred/darkened image behind everything.
  - `.detail-hero`: poster (`.detail-poster-wrap > img.detail-poster`) + copy column:
    - `.eyebrow` — rail label the user came from (title-cased), e.g. "Trending", "Search", "Continue Watching", "Voice" → but "voice" origin hides the *related-context* line specifically (not the eyebrow itself, `detail.ts:787`).
    - `<h1>` title.
    - `.detail-meta` — subtitle line: for `tv` type, release info / subtitle / **"live"**; otherwise `year · runtime · type` joined by " · " (`detailMetaLine`, `detail.ts:1685-1695`).
    - `.verify-badge` (hidden by default) — see states below.
    - `.detail-description` — synopsis text.
    - `.detail-actions` — up to 4 buttons: **Play** (`.detail-button--primary`, contains a spinner span + label span), **Save**, **Not interested** (hidden unless YouTube), **Back**.
  - `.detail-related` section below hero (§15).
  - Right-hand `.detail-side` column holds Streams (§12) and Episodes (§13) panels, hidden/shown based on content type.
- **Every state:**
  - **Initial paint on `show()`**: description placeholder **"loading details…"** (`detail.ts:273`, also default `index.html:42`) until `loadFullMeta()` resolves; poster resolved from card data immediately, then possibly swapped for richer meta poster.
  - **Meta load success**: title/meta/description overwritten from `/api/catalog/meta/...`; description falls back to card's own description, then to **"no synopsis available"** if server has nothing (`detail.ts:1558`).
  - **Meta load failure**: description falls back to card description or **"details unavailable"** (`detail.ts:1571`); poster keeps card-resolved fallback if not already set.
  - **Verify badge** (`updateVerifyBadge`, `detail.ts:1059-1076`): hidden (no badge) / **"in library"** (`data-state="in_library"`) / **"queued"** (`data-state="queued"`, meaning queued for library verification).
  - **Play button label** (`updatePlayButtonLabel`, `detail.ts:1093-1117`): **"select video"** + disabled (YouTube channel/playlist, not directly playable) / **"watch live"** (tv type or live tab, or YouTube live status) / **"resume"** (has resume position) / **"play"** (default).
  - **Play button busy/progress** (during resolve, `detail.ts:417-454,522-526`, label swaps live): **"resuming…"** → **"starting YouTube…"** / **"starting stream…"** / **"tuning in…"** / **"finding stream…"** → (2s) **"resolving YouTube…"** / **"connecting to channel…"** / **"still finding a playable stream…"** → (10s) **"still finding a playable stream…"** → (20s) **"this is taking longer than usual…"**. Busy state adds `.detail-button--busy` which reveals an animated `.detail-button-spinner` ring (`style.css:1967-1989`).
  - **Play failure toast**: server/couch-safe message, or fallback **"couldn't start playback. try another title."** (`detail.ts:521-526`).
  - **Save button**: label toggles **"save"** / **"unsave"**, `aria-pressed` toggles; disabled when card isn't saveable (YouTube channel/playlist) — clicking anyway (e.g. via stale focus) shows toast **"only YouTube videos can be saved."** (`detail.ts:1085-1091,1119-1147`). Save success toast **"saved — find it in your Saved rail."**; unsave toast **"removed from saved."**; failure toast = server error or **"could not update saved"**.
  - **Not-interested button**: only visible for YouTube-sourced cards (`detail.ts:283`). Success closes Detail and toasts **"removed from YouTube recommendations."**; failure toasts server error or **"could not update YouTube recommendations"**.
  - **Resolving/cancel state**: while play or streams are in flight, Y/Back cancels the resolve instead of closing Detail (`isResolving()`, `detail.ts:118-121,190-212`) — all action buttons + stream/episode buttons get `disabled` during an active play attempt (`detail.ts:397-403,541-547`).
  - **Focused** action button: `.focused` (§23).
- **Entry/exit:** Entered from a rail card, search result, related-title card, voice command (`openVoiceDetail`), or playback-return restoration. Exits via Back button, Y/Escape/Backspace, or Home (`voice onBack`) → `restoreFromDetail()` returns to Home or Search depending on `origin.surface`.
- **Flags:** none directly (poster minimal-label flag doesn't apply inside Detail).

---

## 12. Detail page — streams panel (movies)

Movies/tv-type only — series **never** shows this panel (explicit guard, `detail.ts:1384-1389,1459-1467`).

- **DOM/CSS:** `#detail-streams.detail-panels.detail-streams` (`index.html:63-66`), label `.detail-streams-label`, list `#detail-stream-list`.
- **File:line:** `loadStreamList` / `renderStreams*` — `detail.ts:1384-1547`.
- **Every state (label text + panel content):**
  | State | Label text | Content |
  |---|---|---|
  | finding | **"streams · finding…"** | empty list, panel visible |
  | ready, has streams (verified mix) | **"streams"** | one `.detail-stream` bubble per stream |
  | ready, all streams unverified/floor-tier | **"streams · unverified"** (panel gets `.detail-streams--unverified`, muted color, `style.css:2138-2141`) | bubbles, each also flagged (see below) |
  | ready, zero streams | **"streams · none found"** | empty list |
  | timeout → recovered | (transparent to user — `recoverTimedOutStreamList` joins the existing in-flight request instead of erroring, `stream-list-recovery.ts`) | same as ready/none |
  | fetch error (non-timeout) | **"streams · unavailable — Play retries"** | empty list |
- **Stream bubble** (`createStreamButton`, `detail.ts:1501-1547`): resolution badge (**4K / 1440p / 1080p / 720p / SD / auto**, `streamResolutionLabel`), quality chips (tier: **REMUX/BluRay/WEB-DL/WEBRip/HDTV/DVD/CAM**; codec: **HEVC/AV1/H.264**; HDR: **DV/HDR10+/HDR10/HLG/HDR**; **cached** chip), secondary line = language codes (e.g. `EN · HI`, +N overflow) or **"audio n/a"**, plus size (`X MB`/`X.X GB`) and, if unverified, a trailing **"unverified"** flag chip. Unverified bubbles get `.detail-stream--unverified`.
  - Per-bubble hard-fail hide: after a picker play attempt fails on a specific stream URL, that stream is hidden from the list for ~30 minutes (`hiddenStreamUntil`, `detail.ts:61,514-519`) — no user-visible message, the bubble just disappears from the re-rendered list.
- **Entry/exit:** panel populates automatically when Detail opens for a playable movie/tv card; clicking a bubble calls `play(stream.url, stream.ladder_step)` directly (bypasses auto-resolve ladder).
- **Flags:** none.

---

## 13. Detail page — episodes panel (series)

- **DOM/CSS:** `#detail-episodes.detail-panels.detail-episodes` (`index.html:67-71`); label `.detail-episodes-label` (text toggles "episodes"/"videos", `setListLabel`, `detail.ts:1078-1083`); `#detail-season-list.detail-season-list` (chips) + `#detail-episode-list.detail-episode-list` (rows).
- **File:line:** `loadEpisodeList`, `renderEpisodes`, `renderSeasonChips`, `renderActiveSeasonEpisodes`, `createEpisodeButton` — `detail.ts:1168-1365`.
- **What the user sees:** season chips row (only rendered/visible when >1 season, `renderSeasonChips`, `detail.ts:1293-1312`) with active chip marked `.detail-season-chip--active`; below, the episode list for the active season only (episodes from other seasons are not in the DOM until you switch — `renderActiveSeasonEpisodes` replaces children per season). Each episode row: label **"S{season} E{episode} · {title}"** (`episodeRowLabel`, `detail.ts:1674-1676`), progress text = rounded percent (e.g. `"42%"`) or empty if no progress (`episodeProgressLabel`), and a stream-status badge.
- **Every state:**
  | State | Trigger | Visual |
  |---|---|---|
  | episode list load failure | `/episodes` fetch throws | whole episodes panel + season list + (leftover) streams panel hidden (`detail.ts:1188-1196`) — series detail can show **no side panel at all** |
  | zero episodes returned | `flatCount === 0` | episodes panel + season list hidden, focus falls back to actions |
  | selected episode | `episode.id === selectedEpisodeId` | `.detail-episode--selected` |
  | playable === true | server playability hint | `.detail-episode--has-streams`, badge hidden |
  | playable === false | server playability hint | `.detail-episode--no-streams` (opacity 0.55, `style.css:1801-1803`) + visible badge text **"tap to retry"** — still clickable, re-runs `/play` (never a dead-end) |
  | post-play-attempt success | after a Play call resolves | badge cleared, class flips to `--has-streams` (`setEpisodeStreamBadge(id, true)`) |
  | post-play-attempt failure | after a Play call throws | class flips to `--no-streams`, badge reset to **"tap to retry"** |
  | season switch | shoulder buttons / F6-F7 / season-chip click while a chip or episode is focused | active season re-rendered, focus follows to same-index episode or the season chip |
  | resume episode auto-focus | on open / after playback return | focuses+selects the resume/default episode automatically |
  | next-episode-prompt cross-reference | see §16 | focus jumps to the newly-unlocked "next" episode across season boundaries if still on Detail |
- **Entry/exit:** loads automatically for `card.type === "series"` on `show()`. Left-arrow/D-pad-left from an episode always escapes to the action-button column rather than season chips (explicit spatial-nav carve-out, `detail.ts:673-683`).
- **Flags:** none.

---

## 14. Detail page — YouTube video list variant

Reuses the same `#detail-episodes` DOM region for a different content shape when the opened card is a YouTube channel/playlist.

- **File:line:** `loadYoutubeList`, `renderYoutubeList` — `detail.ts:1199-1248`.
- **What the user sees:** label switches to **"videos"**; each row shows title + subtitle (no season/progress semantics, no stream badge). Clicking a video **re-opens Detail on that video** (`this.show(video, "YouTube", "youtube", …)`) rather than playing inline — i.e. a nested detail push, not a play action, since the parent card (channel/playlist) itself isn't directly playable.
- **States:** loading (empty list momentarily), zero videos → panel hidden, error → panel hidden + list cleared (`detail.ts:1210-1218`).
- **Entry/exit:** entered automatically when `isYoutubeCard(card) && !playable` (`detail.ts:289-293`).
- **Flags:** none.

---

## 15. Detail page — related titles rail

- **DOM/CSS:** `#detail-related.detail-related` (`index.html:54-60`), head with `#detail-related-label` and `#detail-related-context`, track `#detail-related-track`.
- **File:line:** `loadRelated`, `renderRelated`, `createRelatedCard` — `detail.ts:754-845`.
- **What the user sees:** heading **"related titles"**, optional context line **"from {rail label lowercased}"** (e.g. "from trending") — suppressed for the synthetic "voice" origin or empty labels (`detail.ts:786-793`). Up to 7 portrait cards (`RELATED_DISPLAY_LIMIT`, `detail.ts:31`), each always showing title+subtitle (this rail is **not** subject to the minimal-label poster flag).
- **States:** hidden entirely when zero related results resolve (both the initial empty render and any later empty result, `detail.ts:779-782,800`); falls back to a locally-shuffled subset of the cards visible on the originating rail if the backend related-items call fails or returns nothing (`pickRelatedFallback`, `catalog.ts:304-311`) — silent fallback, no error shown to user.
- **Entry/exit:** loads async after Detail opens; clicking a related card re-opens Detail in place for that title (stacks conceptually, but Detail has no "back to previous title" — Back/Y goes all the way out to Home/Search, not to the prior related title).
- **Flags:** none.

---

## 16. Next-episode prompt (overlay)

- **DOM/CSS:** `#next-episode-prompt.next-prompt.hidden` (`index.html:75-85`), card `.next-prompt-card`.
- **File:line:** `NextEpisodePrompt` class — `next-prompt.ts:9-134`; polling trigger `detail.ts:1581-1636` (`startNextPromptPoll`/`checkNextPrompt`).
- **What the user sees:** small centered card — eyebrow **"next up"**, `<h2>` = series name (or card title fallback), meta line **"S{n} E{n} · {title}"**, two buttons: **"play next"** (primary) and **"not now"**.
- **States:**
  - Hidden (default) — `aria-hidden="true"`.
  - Shown — only after returning from playback of a series episode that finished (backend-confirmed via short poll, up to 12 attempts × 750ms ≈ 9s window, `detail.ts:1583-1594`); never appears mid-watch.
  - Focus toggles between the two buttons (`.focused` class swap, index 0/1).
  - Play-next in flight: both buttons disabled, status **"starting next episode…"**.
  - Play-next success: dismisses, status **"playing next episode. ⌂ returns home."**
  - Play-next failure: buttons re-enabled, status = server error or **"couldn't start next episode."**
  - Dismiss ("not now" / Y / Backspace / Escape): hides, returns focus/status to Detail (**"B to play. Y to go back."**).
- **Entry/exit:** appears automatically (never user-invoked); Y/Escape/Backspace or "not now" dismisses; B/Enter or "play next" starts playback of the next episode directly from the overlay (does not require going back into the episode list).
- **Flags:** none.

---

## 17. Toast

- **DOM/CSS:** `#toast.toast` (`index.html:87`), `data-visible` attribute drives visibility, `pointer-events:none` (non-interactive by design).
- **File:line:** `toast.ts` (whole file, 25 lines).
- **What the user sees:** a single-line, auto-dismissing (3000ms default) message, `aria-live="polite"`.
- **States:** hidden (`data-visible="false"`) / visible (`data-visible="true"`). No severity variants in code — every toast uses the same visual treatment regardless of whether it's a success confirmation ("saved — find it in your Saved rail.") or a failure ("couldn't start playback…"); severity is implied only by copy, not styling (see §29).
- **Callers / full message set:** see §28 (Toast row). Notably, `main.ts`'s generic `setStatus()` helper (used by Detail/NextPrompt/Search/etc. for routine status copy) **only forwards to the toast when the message matches a failure-shaped regex** (`/couldn|failed|unavailable|timed? out|try again|no playable|not start/i`, `main.ts:1192-1199`) — all other "status" strings (e.g. "D-pad to browse. L/R shoulders switch tabs. B to select.") are computed but **never actually displayed anywhere** because the launcher has no persistent status strip (comment confirms this is intentional, `main.ts:1193-1195`).
- **Entry/exit:** triggered programmatically by `showToast()` calls; no user dismiss action (times out only), though any subsequent toast trigger resets the timer.
- **Flags:** none.

---

## 18. Voice HUD

- **DOM/CSS:** `#voice-hud.voice-hud` (`index.html:89-107`), `data-state` (idle/listening/thinking/speaking) and `data-visible` attributes.
- **File:line:** `voice-hud.ts` (whole file, 238 lines).
- **What the user sees:** small card, header = colored dot (`#voice-dot`, state-coded) + state label (`#voice-state`, default text **"mango"**), up to three optional lines: **"you: {text}"** (`.voice-line.user`), **"mango: {text}"** (`.voice-line.reply`), **"tool: {text}"** (`.voice-line.tool`), and a static hint **"hold on phone to talk"** (`.voice-hint`, `index.html:106`).
- **Every state:**
  | `data-state` | Label shown | Trigger |
  |---|---|---|
  | `idle` (hidden) | — | default / explicit idle status / socket closed/reconnecting |
  | `listening` | **"listening…"** | orchestrator status message |
  | `thinking` (variant: hearing) | **"hearing you…"** | user chat message arrives, or status text starts with "transcribing" |
  | `thinking` (generic) | **"thinking…"** or server-provided tool summary | tool-phase message, or assistant partial reply |
  | `speaking` | **"mango"** | assistant final (non-partial) reply |
  | error | reply line shows error message, state forced to `speaking`/"mango", auto-dismiss after 4000ms | `{type:"error"}` message |
- **Auto-dismiss safety net:** a hard 12-second wall-clock cap (`MAX_VISIBLE_MS`, `voice-hud.ts:26`) force-dismisses the HUD even if the orchestrator never sends an idle status — explicit anti-stuck-HUD measure.
- **Reconnect behavior:** on socket close, HUD dismisses and a reconnect is scheduled (250ms if never opened this attempt, else 2000ms), cycling through candidate WS URLs (`ws://127.0.0.1:8766/ws` and `ws://{hostname}:8766/ws`, or `wss://{hostname}:8765/ws` over HTTPS) — entirely silent to the user; no "voice offline" indicator exists.
- **Entry/exit:** not directly D-pad driven — appears/disappears based on the phone-companion voice session over WebSocket; purely presentational otherwise (doesn't intercept focus).
- **Flags:** none (env-driven WS URL override via `VITE_ORCH_WS`, not a UI flag).

---

## 19. Settings — Pi connection panel

- **DOM/CSS:** `#settings-view.view.settings` top section, `.masthead` + `dl.info-list` (`index.html:109-135`).
- **File:line:** static markup `index.html:109-134`; population `loadInfo()` — `main.ts:1173-1190`.
- **What the user sees:** `#back-button` labeled **"back"**; eyebrow **"settings"**, `<h1>pi connection</h1>`; a definition list: **hostname**, **ip address**, **launcher** (URL), **companion** (URL); static note **"Voice keys live in /etc/mango on the Pi."**; then the dynamically built `#settings-refresh` region (§20-22).
- **States:** values populate from `/api/info`; on fetch failure, silently falls back to hardcoded defaults (`mango`, `10.0.0.174`, `http://10.0.0.174:3000`, `https://10.0.0.174:3001`) with **no error indication** to the user (`main.ts:1184-1189`) — indistinguishable from a genuinely-correct read.
- **Entry/exit:** Settings tile (§7) or voice `onSettings` command → `showSettings()` (`main.ts:728-742`); Back button / Y / Escape / Backspace / Home → `showHome()`.
- **Flags:** none.

---

## 20. Settings — Reliability Center

- **DOM/CSS:** inside `#settings-refresh`, built by `buildReliabilityCenter()` (`settings.ts:143-170`).
- **File:line:** `settings.ts:143-269`; data types `reliability.ts`.
- **What the user sees:**
  1. Heading **"Reliability center"**.
  2. `.reliability-summary.reliability-summary--{status}` — status word (**green/yellow/red**, raw enum value used as visible text, `createReliabilitySummary`, `settings.ts:172-187`) + copy: `"{state.summary} Last proof: {status|none}. Couch: {idle|active Ns ago}."`
  3. `.reliability-grid` of `.reliability-card.reliability-card--{status}` — one per component, each showing label + one-line summary (`createReliabilityCard`, `settings.ts:189-203`).
  4. Action row (`.settings-actions-row`) with up to 4 buttons in fixed order **repair → proof → stack_restart → refresh** (only those present in the server's `actions` array render, `settings.ts:212-231`); each shows a title (server-provided label) and a meta line: **"idle only"** / **"safe anytime"** when enabled, or the server's `reason` string when disabled.
- **Every state:**
  | State | Copy |
  |---|---|
  | fetch failure | fallback note **"Reliability status unavailable — catalog-service may be starting."** |
  | action disabled | button `disabled`, meta shows server `reason` (e.g. "requires idle couch") |
  | action running | button disabled immediately; status **"running proof…"** (proof) or **"starting {action words}…"** (others) |
  | action success | status = `"{result.message} (pid {pid})"` if a pid was returned, else just the message |
  | action failure | status = server error or **"reliability action failed"** |
  | action cooldown | button stays disabled for 3000ms after completion regardless of outcome |
  | settings badge sync | on Settings close/reopen, the apps-rail health badge (§7) is refreshed from the same endpoint |
- **Entry/exit:** rendered every time Settings opens/rebuilds; clicking an action button triggers `runReliabilityButton()`; D-pad navigation within Settings is a flat `[data-settings-focus]` list (`settingsFocusables`, `settings.ts:347-349`), not a 2D grid — Up/Down and Left/Right both move through the same linear sequence (`main.ts:269-279`).
- **Flags:** none (server-driven visibility of individual actions).

---

## 21. Settings — Search settings

- **DOM/CSS:** inside `#settings-refresh`, `buildSearchSettings()` (`settings.ts:50-102`).
- **File:line:** `settings.ts:50-141`.
- **What the user sees:** heading **"Search"**; intro **"SafeSearch applies to fresh YouTube search. Clear activity removes recent queries and local selection learning."**; a `.settings-actions-row` with three SafeSearch choice buttons — **Moderate / Strict / Off** (ids `moderate/strict/none`) — plus a **"Clear search activity"** button (meta: "recents and local learning").
- **Every state:**
  - Active SafeSearch choice: `.settings-action--selected`, meta text becomes **"selected"**; inactive choices show meta **"YouTube SafeSearch"**.
  - Fetch failure (preferences unavailable): fallback note **"Search settings unavailable — catalog-service may be starting."**
  - Preference update success: status **"Search SafeSearch set to {moderate|strict|off}."**, then the whole Settings panel is rebuilt.
  - Preference update failure: status = server error or **"could not update Search"**.
  - Clear-activity in flight: button disabled.
  - Clear-activity success: status **"Search activity cleared."**
  - Clear-activity failure: status = server error or **"could not clear Search activity"**.
- **Entry/exit:** part of the same linear Settings focus list as §20/§22.
- **Flags:** none.

---

## 22. Settings — Library refresh levels

- **DOM/CSS:** inside `#settings-refresh`, tail section of `buildSettingsRefresh()` (`settings.ts:17-48`).
- **File:line:** `settings.ts:26-48,271-345`.
- **What the user sees:** heading **"Library refresh"**; intro **"Shuffle re-picks verified titles on Movies, TV Shows, and YouTube. Live channels stay cached — no reshuffle."**; a primary **"refresh library"** button (meta **"~5 sec · diverse re-pick · TV stays on"**, `createShuffleButton`, `settings.ts:289-299`); then subheadings **"quick"**, **"standard"**, **"overnight"** (only rendered if that category has levels, `appendLevelGroup`, `settings.ts:271-287`), each containing server-defined `RefreshLevel` buttons showing label, `estimated_label`, optional **" · pauses TV UI"** / **" · runs in background"** suffixes, and a body description line (`createRefreshButton`, `settings.ts:301-316`).
- **Every state:**
  | State | Copy |
  |---|---|
  | levels fetch failure | fallback note **"Refresh options unavailable — catalog-service may be starting."** |
  | refresh start | status **"starting {level words}…"**, button disabled |
  | inline-mode success | status **"library refreshed — shuffle on the pad or browse bar to reshuffle"**; dispatches a `mango:library-refresh` window event that triggers a quiet Home reshuffle |
  | background-mode success | status **"{level words} running ({estimated label}). TV pauses until done."** |
  | already-running conflict | status **"a library job is already running"** |
  | other failure | status = server error or **"refresh failed"** |
  | cooldown | button disabled for 3000ms post-completion |
- **Entry/exit:** same linear focus list as §20/§21; refresh triggers are independent of the browse-bar shuffle button (§8) though the shuffle button is the "instant"/quickest level surfaced twice (once in the bar, once as the "refresh library" primary action here).
- **Flags:** none.

---

## 23. Focus ring / selection treatment (cross-cutting)

- **Mechanism:** a shared `.focused` class (mirrored by native `:focus-visible`) is toggled by three independent focus managers — `FocusGrid` (Home + Search, `focus.ts`), `DetailController`'s custom spatial-nav (`detail.ts:632-741`), and a flat linear list in Settings (`main.ts:771-784`) — plus a two-item manual toggle in the Next-Episode Prompt (`next-prompt.ts:87-93`).
- **Where styled:** dozens of per-component `.focused`/`:focus-visible` rules in `style.css` (browse chrome, browse tabs, search controls/keys/starters, generic `.card`/`.card--landscape`, settings actions, detail buttons/season-chips/episodes/streams, back button — see the grep list gathered during this audit, e.g. `style.css:146,188,203,224,388,477,516,554,845-851,972,981,1033,1044,1230,1717,1725,1757,1818,1825,2017,2154,2236`).
- **Behavior notes:**
  - Only one element is focused at a time per active surface; switching surfaces (Home→Search→Detail→Settings) fully tears down and rebuilds the relevant focus row set — there is no shared/global focus manager.
  - Detail's focus uses real geometric spatial navigation (`getBoundingClientRect` distance scoring, `detail.ts:659-741`) rather than a row/col grid, with several hand-carved exceptions (episode→left always goes to action buttons; horizontal moves from an episode never land on season chips/other episodes).
  - Home/Search's `FocusGrid` remembers a `preferredKey` + `fallbackPosition` per tab so returning to a tab (or from Search/Detail) tries to restore the exact previously-focused card (`main.ts:86-87,315-318`, `focus.ts:14-39`).
- **States:** focused / unfocused / (per-surface) disabled-and-skipped (disabled buttons are filtered out of the focusable set, e.g. `detail.ts:618-626,648-650`).
- **Flags:** none.

---

## 24. Poster placeholder / image fallback (cross-cutting)

- **File:line:** `poster.ts` (whole file, 59 lines); consumed by `home.ts` (rail cards), `detail.ts` (hero poster, backdrop, related cards, YouTube rows).
- **Behavior:**
  - `resolveCardPosterUrl()` prefers an explicit poster URL; if absent, derives a Cinemeta CDN fallback URL from an IMDb-style id (`tt\d+`) at `medium`/`large` size; otherwise empty string.
  - `bindPosterImage()` attaches an `error` listener (and a `queueMicrotask` check for an already-empty `src`) that, on failure/absence, adds `.poster-image--missing` (opacity 0, `style.css:2221-2223`) and injects a `.poster-fallback` span showing **1-2 letter initials** derived from the title (`posterInitials()`, e.g. "The Matrix" → "TM", single word → first two letters uppercased, empty title → **"?"**).
  - Fallback host resolution walks up to the nearest `.poster-frame`, `.card--poster`, or `.detail-poster-wrap` — so landscape cards, portrait cards, and the Detail hero poster all get a consistently-placed initials badge.
- **States:** image loaded normally / image missing-or-broken → initials badge. No distinct "loading" placeholder (no skeleton/shimmer) — a not-yet-loaded image is visually just an empty/browser-default state until it resolves or errors.
- **Flags:** none.

---

## 25. Feature flags (ui-flags.ts)

- **File:line:** `ui-flags.ts` (whole file, 6 lines).
- **Current flags:**
  | Flag | Value | Effect |
  |---|---|---|
  | `MINIMAL_VOD_POSTER_LABELS` | `true` | Adds `.card--poster-minimal` to portrait cards on the **movies** and **series** tabs only (not live/youtube, not related-titles, not search results' reuse of `buildCatalogRails` — wait: search results also call `buildCatalogRails`, and that function is shared, so the flag **does** apply to Search results' movies/series groups too, since `options.browseTab` isn't set there — see §29). Hides the title/subtitle overlay (`.poster-content`) and gradient shade (`.poster-shade`) entirely, relying on poster art alone (`style.css:1079-1082`). |
- **Only one flag currently defined** — this is the sole "conditional/flagged variant" in the codebase at inventory time; no others exist in `ui-flags.ts` (comment header confirms it's meant to be the single toggle point for reverting launcher UI experiments).

---

## 26. Catalog/network error taxonomy (cross-cutting)

- **File:line:** `catalog-errors.ts` (whole file, 61 lines); consumers `catalog.ts:749-786`, `main.ts:1137-1150`.
- **Sanitization rules** (`couchSafeCatalogMessage`):
  | Raw signal | Shown copy |
  |---|---|
  | rate-limit patterns (429, "too many requests", "rate limit", provider-specific rate-limit URLs) | **"catalog is busy — try again in a moment"** |
  | message already mentions "youtube" | passed through verbatim |
  | message already says "temporarily unavailable" or "timed out" | passed through verbatim |
  | raw `HTTP 5xx` / `HTTP 429` | **"catalog temporarily unavailable"** |
  | anything else | **"catalog temporarily unavailable"** (default/fallback) |
- **Play-path specific** (`playErrorMessage`): trusts server-provided couch-safe messages; only re-sanitizes if the text looks like raw infra leakage (`HTTP [45]xx`, `fetch failed`, `ECONN`, `socket`, addon internals like `AIOStreams:`/`Cinemeta:`). Empty message → **"catalog temporarily unavailable"**.
- **Timeout-specific:** `CatalogTimeoutError`/`PlayTimeoutError` both render as **"catalog timed out — try again"**.
- **Home-rail retry copy** (`catalogRetryStatus`, `main.ts:1137-1150`): re-derives a slightly different phrasing set for the toast-eligible status line — **"catalog temporarily unavailable — retrying…"**, **"catalog is busy — try again in a moment."**, **"refreshing…"** (if this was a reshuffle), or **"catalog is reconnecting…"** (generic fallback) — auto-retries every 5s regardless of which message is shown.
- **Note:** because `setStatus()` only shows a toast for failure-shaped copy (§17), most of these strings **do** reach the toast (they contain "unavailable"/"busy"/"reconnecting" etc.), but the exact matching regex is a separate, hand-maintained list (`main.ts:1196`) from the message-generation logic — a source of possible drift if new phrasings are introduced without updating the regex (see §29).

---

## 27. Playback-return restoration (cross-cutting transition, not a surface)

Not a visual surface itself, but materially changes what the user sees on app-focus/visibility-change/boot, so documented for completeness.

- **File:line:** `playback-return.ts` (whole file); orchestration `main.ts:970-1135`.
- **Trigger conditions:** window `focus` event, `visibilitychange` → visible, or app boot — all call `handlePlaybackReturn()`/`restorePlaybackSurfaceIfNeeded()`.
- **Two return surfaces:**
  - **`detail`** (movies, series, YouTube, or any Search-originated title) — reopens Detail directly on the same card (and, for series, the same episode, with progress refreshed and the next-episode-prompt re-checked).
  - **`tab_home`** (live TV channels) — skips Detail entirely and returns straight to the Home tab the channel lives in.
- **Persistence:** snapshot stored in both `localStorage` and `sessionStorage` (survives an intentional Chromium restart for 4K display-mode switches; 6-hour max age) under key `mango.playback-return.v1`.
- **Fallback:** if no local snapshot exists, falls back to asking the backend for the last-known "library context" (`fetchLibraryContext`) before giving up silently.
- **User-visible effect:** the launcher can appear to "skip" Home entirely after playback and land straight back on a Detail page or a specific Live tab — worth flagging for the polish round since it's a non-obvious state transition that could look like a bug if not understood.

---

## 28. Full text-string index by surface

Every literal user-facing label, empty-state string, or error/status message found in source, grouped by owning surface. (Server-driven strings — rail labels, reliability component summaries/labels, refresh-level labels/descriptions, search phase messages — are noted as "(server-provided)" since their text lives in the backend, not the launcher.)

**Shell / browse bar** (`index.html`, `main.ts`)
- "mango" (brand)
- "search" / aria "Search Mango"
- "shuffle" / aria "Shuffle library"
- "movies", "tv shows", "live", "youtube" (tab labels)
- "D-pad to browse. L/R shoulders switch tabs. B to select." (status only — never shown as toast, see §17)
- "Type with the D-pad. X deletes; hold X clears. B selects."
- "Search restored. X deletes; hold X clears."
- "this tab refreshes from its own source."
- "refreshing…"
- "updated — keep browsing"
- "catalog loaded with no posters" (status only, never surfaced — §29)
- "Opening {title}…" (voice open)

**Home rails / empty & error states** (`home.ts`)
- "Catalog" (rail heading for loading/error placeholder)
- "Loading catalog…" / "posters will appear here when the Pi responds."
- "catalog offline" / (dynamic error message, see §26)
- "nothing resolved yet" (empty rail)
- "apps" (apps rail heading)
- "settings" / kicker "system"
- "live" (live-pill badge)

**Catalog error taxonomy** (`catalog-errors.ts`, `main.ts`)
- "catalog is busy — try again in a moment" / "…try again in a moment."
- "catalog temporarily unavailable" / "…— retrying…"
- "catalog timed out — try again"
- "catalog is reconnecting…"

**Search — compose** (`search.ts`)
- "Search Mango" (placeholder)
- "all", "movies", "tv shows", "live", "youtube" (scope chips)
- "Keyboard" / "X delete · hold to clear"
- "space", "delete", "clear", "search" (key actions)
- "Suggestions" / "Recent"
- "Recent search", "YouTube", "TV show", "Live channel", "Movie", "From your library" (type labels)
- "Type to see suggestions." / "No local suggestions yet."
- "Search is ready. Recent activity is temporarily unavailable."
- "Type at least 2 characters."
- "Search is temporarily unavailable."

**Search — results** (`search.ts`)
- "Searching" (toolbar progress + pending message heading)
- "Checking Mango, Live and YouTube."
- "No results" / "Try another title, channel or topic."
- "More" (trailing card title) + group label subtitle
- "retry YouTube"
- "Retrying YouTube…" / "YouTube results updated." / "YouTube is still unavailable. Other results are ready." / "YouTube is temporarily unavailable."
- "Search complete." / "Searching every source…" / "No matches. Try another title, channel, or topic."
- (server-provided) degraded-phase note text

**Detail — hero/actions** (`detail.ts`)
- "loading details…" / "no synopsis available" / "details unavailable"
- "in library" / "queued" (verify badge)
- "select video" / "watch live" / "resume" / "play" (play button idle labels)
- "resuming…" / "starting YouTube…" / "starting stream…" / "tuning in…" / "finding stream…" / "resolving YouTube…" / "connecting to channel…" / "still finding a playable stream…" / "this is taking longer than usual…" (play progress ladder)
- "save" / "unsave"
- "not interested"
- "back"
- "couldn't start playback. try another title."
- "only YouTube videos can be saved."
- "removed from saved." / "saved — find it in your Saved rail." / "could not update saved"
- "removed from YouTube recommendations." / "could not update YouTube recommendations"
- "related titles" / "from {rail label}"
- "next up: S{n} E{n} · {title}" (status when next-prompt hint arrives while still on Detail)

**Detail — streams panel** (`detail.ts`)
- "streams" / "streams · finding…" / "streams · unverified" / "streams · none found" / "streams · unavailable — Play retries"
- "unverified" (bubble flag chip)
- "audio n/a"
- resolution labels: "4K", "1440p", "1080p", "720p", "SD", "auto"
- tier chips: "REMUX", "BluRay", "WEB-DL", "WEBRip", "HDTV", "DVD", "CAM" (+ raw uppercase fallback)
- codec chips: "HEVC", "AV1", "H.264" (+ raw uppercase fallback)
- HDR chips: "DV", "HDR10+", "HDR10", "HLG", "HDR"
- "cached"

**Detail — episodes panel** (`detail.ts`)
- "episodes" / "videos" (panel label)
- "S{season} E{episode} · {title}" (episode row label)
- "{n}%" (episode progress)
- "tap to retry" (episode retry badge)

**Next-episode prompt** (`next-prompt.ts`, `index.html`)
- "next up"
- "S{n} E{n} · {title}"
- "play next" / "not now"
- "B to play next episode. Y to stay on detail."
- "B to play. Y to go back."
- "starting next episode…"
- "playing next episode. ⌂ returns home."
- "couldn't start next episode."

**Voice HUD** (`voice-hud.ts`, `index.html`)
- "mango" (default state label)
- "hold on phone to talk"
- "listening…" / "hearing you…" / "thinking…" / (server tool summary)
- "you" / "mango" / "tool" (line tags)

**Settings — shell** (`index.html`)
- "back"
- "settings" / "pi connection"
- "hostname" / "ip address" / "launcher" / "companion" (dl terms)
- "Voice keys live in /etc/mango on the Pi."

**Settings — Reliability Center** (`settings.ts`, `reliability.ts`)
- "Reliability center"
- "green" / "yellow" / "red" (status word shown verbatim)
- "Last proof: {status|none}. Couch: {idle|active Ns ago}."
- "needs repair" / "check health" (badge text for red/yellow — green shows nothing)
- "idle only" / "safe anytime"
- "Reliability status unavailable — catalog-service may be starting."
- "running proof…" / "starting {action}…"
- "reliability action failed"
- (server-provided) action labels/reasons, component labels/summaries, proof summaries

**Settings — Search settings** (`settings.ts`)
- "Search"
- "SafeSearch applies to fresh YouTube search. Clear activity removes recent queries and local selection learning."
- "Moderate" / "Strict" / "Off"
- "selected" / "YouTube SafeSearch"
- "Clear search activity" / "recents and local learning"
- "Search settings unavailable — catalog-service may be starting."
- "Search SafeSearch set to {moderate|strict|off}." / "could not update Search"
- "Search activity cleared." / "could not clear Search activity"

**Settings — Library refresh** (`settings.ts`)
- "Library refresh"
- "Shuffle re-picks verified titles on Movies, TV Shows, and YouTube. Live channels stay cached — no reshuffle."
- "refresh library" / "~5 sec · diverse re-pick · TV stays on"
- "quick" / "standard" / "overnight" (subheadings)
- "Refresh options unavailable — catalog-service may be starting."
- "starting {level}…"
- "library refreshed — shuffle on the pad or browse bar to reshuffle"
- "{level} running ({estimate}). TV pauses until done."
- "a library job is already running" / "refresh failed"
- " · pauses TV UI" / " · runs in background" (suffixes)
- (server-provided) level labels/descriptions/estimated labels

---

## 29. Notable inconsistencies / unfinished-looking areas

Observations only — no proposed fixes, per scope.

1. **Silent "no status strip" architecture with a brittle safety net.** `main.ts`'s `setStatus()` (`main.ts:1192-1199`) discards any message that doesn't match a hardcoded regex of failure keywords, and there is no persistent status/toast for the majority of routine navigation copy (e.g. "D-pad to browse…" strings are computed dozens of times but never rendered anywhere visible). Any future status message must independently match that regex to ever reach the user — an easy silent-failure trap for new copy.
2. **`"catalog loaded with no posters"` is unreachable.** (`main.ts:927,931`) — a genuinely useful diagnostic state (catalog responded but has zero items) is computed and then dropped by the regex filter above, so a fully-empty tab currently looks identical to a tab quietly finishing a normal load.
3. **`MINIMAL_VOD_POSTER_LABELS` likely leaks into Search results unintentionally.** The flag's condition checks `options.browseTab === "movies" || options.browseTab === "series"` (`home.ts:267-273`), but Search's call to the shared `buildCatalogRails()` (`search.ts:744-755`) never sets `browseTab` in its options — meaning the condition evaluates false there regardless of the group's actual content type, so movies/series poster cards in Search results always show titles (inconsistent with Home's minimal treatment). Worth double-checking against actual rendered behavior since this cross-file coupling is easy to get wrong when either file changes independently.
4. **Same panel, three different content shapes with no shared naming.** The right-side "episodes" panel is reused for series episodes, YouTube videos ("videos" label), and is fully hidden for movies — a single DOM region silently changes semantics based on card type, which is efficient but means any polish to episode-row styling has three very different real-world payloads to account for.
5. **No skeleton/shimmer loading state anywhere.** Every loading state in the app (catalog rails, streams panel, episode list, search results) is a plain text message ("Loading catalog…", "streams · finding…", "Searching") — there is no placeholder/skeleton UI for posters or list rows, unlike most modern TV launchers.
6. **Toast has no severity styling.** Success ("saved — find it in your Saved rail.") and failure ("couldn't start playback…") toasts are visually identical (`toast.ts`) — tone is copy-only.
7. **Settings uses a flat linear focus list, not a 2D grid**, unlike every other surface (Home/Search use `FocusGrid`, Detail uses spatial nav) — Up/Down and Left/Right are aliased to the same "next/prev in list" behavior (`main.ts:269-279`), which may feel inconsistent coming from any other surface.
8. **Detail has no "back to previous title" for nested navigation.** Clicking a related-title card or a YouTube sub-video re-opens Detail in place (no push/pop stack) — Back/Y from there exits all the way to Home/Search, skipping the title you came from.
9. **Boot can skip Home entirely** if a playback-return snapshot exists (§27) — first paint after certain restarts (e.g. matched 4K display mode swaps) lands directly on Detail or a specific Live tab rather than Home, which is a surprising (if intentional) first-frame state for anyone unfamiliar with the mechanism.
10. **Settings info panel fails silently.** If `/api/info` errors, hardcoded placeholder Pi connection info is shown with zero visual difference from a real successful fetch (`main.ts:1184-1189`) — a broken info panel is indistinguishable from a working one.
11. **Reliability status text is a raw enum ("green"/"yellow"/"red")** rendered directly as the summary's headline word (`settings.ts:178`), rather than a couch-friendly phrase — inconsistent with the rest of the app's copy voice (lowercase, descriptive, e.g. "needs repair").
12. **Two different "shuffle" entry points with different copy/placement**: the browse-bar shuffle button (§8, icon+label "shuffle") and Settings' "refresh library" primary button (§22) both trigger the same underlying quick reshuffle action but are presented as unrelated controls in unrelated places.
