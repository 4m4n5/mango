# mango — architecture

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md)

Stack layers, foreground contract, and API boundaries. Policy lives here — not duplicated in task docs.

---

## Layer model

```
Launcher (:3000)  →  catalog-service (:3020)  →  addons (Stremio protocol)
                              ├→ Mango library state
                              ├→ YouTube API/cache
                              └→ mpv play orchestrator
```

| Layer | Owns | Does not own |
|-------|------|----------------|
| **AIOStreams** (`:3035`) | Aggregate indexers + transports, dedup, service policy, formatter | Device capability tiers, mpv probe, Mango auto-play |
| **AIOMetadata** (`:3036`) | mdblist catalog adapters | Stream resolve |
| **catalog-service** | Rails YAML, Mango library state, YouTube cache/API, play orchestrator, stream metadata, playability, voice `/voice/*`; currently also an optional legacy direct MediaFusion thin supplement | AIO nested indexer/debrid credentials, Google secrets |
| **Launcher** | Browse UI, detail, picker, voice command poll | Stream ranking (trust upstream + filters) |
| **mpv** | Decode + render | Catalog metadata |
| **orchestrator** | STT · LLM · launcher dispatch | Catalog data · mpv IPC |

**Rule:** Push dedup, junk keywords, transport/service order, and aggregate row
limits **upstream** into AIOStreams. Keep identity, path capability, probe-time
policy, and the `main_ladder` / `last_resort_ladder` preference ladders in
**catalog-service**. The intended topology has AIOStreams as the only
stream-capable VOD aggregate/path (alongside non-stream catalog/metadata and
optional Live addons) and keeps Torrentio, Comet, optional MediaFusion, Real-Debrid,
TorBox, and Easynews behind it.

**Current exception:** catalog-service still loads an optional secret
MediaFusion share URL from `MANGO_MEDIAFUSION_MANIFEST` or
`~/.config/mango/mediafusion.manifest`. If the primary pool has at most one
cacheable stream, no direct MediaFusion addon is exported, and the primary did
not hard-timeout empty, it may issue one direct serial supplement bounded to
8 seconds and the request deadline. Git/configured-addon proof does not prove
that Pi-local trigger absent. This legacy bypass must be removed or explicitly
feature-gated and accepted before the runtime can be called strictly AIO-only.

### Couch activity and maintenance boundary

Silent maintenance depends on a shared activity marker at
`~/.cache/mango/couch-activity.json`. Real couch activity means pad input,
launcher key/clicks, voice turns, mpv play/stop, and playback progress; launcher
process startup alone is not activity. Maintenance checks the marker before
disruptive phases and writes operator JSON when deferred; no TV surface shows
grow/debug state.

**Current display transition.** UI start calls
`scripts/lib/mango-display-wake.sh`; controller input currently duplicates its
core `xset` wake behavior inline on a throttle. Both force the panel on and
disable automatic X11 DPMS/screensaver blanking, while the helper restores
launcher focus only when mpv is not active. This split ownership is temporary
source behavior, not the intended sleep product. A home inspection still
observed accidental Xorg 600-second DPMS values. The locked replacement—Settings presets Off/15/30(default)/60/120,
D-pad+companion idle reset only, mpv inhibition, DPMS Off + CEC standby, and
DPMS On + CEC power-on—is not implemented or Pi/TV-proven. See
[STATUS.md](STATUS.md#display-sleep-gap).

Launcher display mode is separate from playback stream policy. Couch mode
applies a lightweight launcher mode through `scripts/lib/mango-display-mode.sh`;
the default is `1920x1080@60` so browse/focus stays smooth on the Pi. mpv is
the sole couch playback engine (`mpv-play.sh`). During fullscreen playback Mango
stops the Chromium launcher, paints a true black root (lxpanel + pcmanfm desktop
off via `mango-desktop.sh`), source-matches HDMI to the stream **after** that
hide (never while Chromium is still mapped — that caused a 4K-scaled launcher
flash), accepts a short blank, then raises mpv. On stop it restores
`1920x1080@60` through `scripts/lib/restore-launcher-after-playback.sh`
(black-screen-first: HDMI downscale while the launcher stays hidden, then one
reveal at browse geometry). Shared helpers live in
`scripts/lib/mango-browse-display.sh`; `ensure-launcher` also runs on stack boot,
home, present, deploy. HDMI mode during a play session is owned only by
`mpv-play` start/stop — the playback OSD and pad must never call `playback-auto`
/ display-ensure. The mpv Lua HUD (`mango-hud.lua`) is a cinematic 1080p-reference
libass surface: a safe-area floating playback panel, persistent minimal pause
badge, delayed event-driven buffering badge, and 58%-height Streams drawer.
It starts clean, redraws progress only while visible, and polls the sanitized
stream snapshot only while Streams is open. A switch confirmation may perform
one URL-free snapshot read when X is pressed for contextual Undo. No Chromium
overlay or second steady-state HUD process is used. The catalog passes only
sanitized title/episode/playback-kind metadata into mpv; URLs, filenames, and
raw IDs never become HUD fallback copy. The pad drives mpv via IPC. **↑** is
the sole subtitle control (show-first, then force-on + cycle); **A** is
show-first for audio.
`--blend-subtitles` defaults to **no** (ASS overlay): `yes` stalls 4K present
when audio is decoded (~2.5 drops/s on Pi 5 / X11 EGL). Override only for A/B
via `MANGO_MPV_BLEND_SUBTITLES`.

**Deferred foreground handoff.** When `MANGO_MPV_DEFER_FOREGROUND=1` (default
when `MANGO_MPV_STOP_LAUNCHER=1`, set by `mpv`/`mpv-hifi` profiles), `mpv-play.sh`
keeps the Chromium launcher visible while mpv buffers. **Every non-live VOD**
(movies, series, and YouTube, including split A/V) uses the null-VO/null-AO
buffer path (`needs_vo_null_buffer`) so no browse-res frame is shown before the
panel is source-matched. Foreground ownership is committed only after mpv proves
real, advancing, feature-length playback. It then waits for
`demuxer-cache-duration` to meet a ladder-aware threshold (18s for 4K REMUX),
with a bounded time fallback for valid transports where mpv cannot report that
property, before it runs hide → black → HDMI match → **enable GPU VO and
configured/automatic AO on the matched panel** → raise mpv (never match while
the launcher is mapped). Rejected candidates and every probe remain
display-neutral; they cannot hide, repaint, mode-switch, or restore the
launcher. Enabling the VO
*before* the match is what caused the "video plays → flash → black → 4K" start on
both debrid 4K and YouTube; the SSOT gate asserts VO-enable-after-match.
`mpv-play` must not PASS/exit until that handoff completes — otherwise Node
returns while HDMI is still 1080p and 4K decode stutters. The mpv exit monitor calls `mpv-stop.sh` on
natural EOF (same black-screen-first path as pad ⌂). Prove true 4K during play
with `scripts/diag/playback-4k-proof.sh`.

**Playback session contract.** The launcher starts playback with
`POST /play-session` and receives a persisted acceptance before Chromium can be
hidden or suspended. It then reconciles `GET /play-session/{request_id}` by
version. Only `failed_before_frame` is a couch-visible play failure;
`ever_ready=true` is durable proof that playback started and prevents a late
HTTP timeout or stop event from becoming a false catalog error. The current
sanitized snapshot is written atomically to
`~/.cache/mango/playback-session.json`; signed URLs, tokens, and credentials are
never stored. Old `/play` and `/youtube/play` routes remain compatibility
wrappers.

The natural-exit monitor blocks on Linux `pidfd` rather than polling throughout
a movie. Its stop request includes the expected mpv PID and play epoch, so a
late monitor from an earlier session cannot tear down a newer playback.
Automatic retry is bounded to one fresh metadata/transport resolve after an
eligible stale-link failure; cancellation, rate limiting, and malformed media
never create retry storms.

Before the ladder begins, one logical automatic VOD Play may perform at most
two delayed confirmation passes when AIOStreams returns a clean HTTP-200 empty
or a proven-transient error-only placeholder set. This absorbs the observed
empty → empty → playable sequence inside one B press. All passes remain inside
the same title/episode single flight and absolute play deadline, reuse the exact
episode ID, and write positive/negative cache state only after the logical
request settles. Provider HTTP failures, 429s, cancellations, permanent
account/configuration errors, authoritative no-stream placeholders, invalidated
work, and exhausted deadlines are never immediately retried. Detail stream
lists, Live, and in-player picker refreshes do not inherit this retry policy.
AIOStreams therefore exposes stream-resource errors to catalog-service. Mango
filters diagnostic rows from playable/display candidates and uses fixed-category,
credential-free copy/counters on couch surfaces. This is not yet a universal DTO
sanitization guarantee: loopback `/stream` operator diagnostics may include raw
error details. URL-less nested error rows are normalized first into
credential-free internal category placeholders so they remain classifiable. The
companion proxy denies `/stream`; do not widen access until the remaining raw
DTO details are sanitized.

The automatic ladder has one attempt budget across main, last-resort,
obligation-floor, deferred-risk, and thin-candidate retry phases. Skipping a
known-bad cached fingerprint costs no network or mpv attempt. Candidate-local
transport or media failures may fall through; pipeline-wide ownership,
display/VO/handoff, cancellation, and play-deadline failures terminate the
request immediately so a second candidate cannot start after the launcher has
already been restored.

**Active stream session.** Movie and series plays publish a URL-free
`~/.cache/mango/active-streams.json` snapshot. Catalog-service remains the sole
owner of candidate identity, path-capability ranking, isolated validation, and
serialized switching; the Lua HUD renders opaque IDs only. A successful switch
hands the same watch/progress session to the replacement mpv generation at the
same absolute time. If replacement launch fails, Mango restarts the original
once; if both fail it flushes progress and marks the existing playback session
`failed_after_frame`. Live and YouTube do not register a stream picker.

### Playability layer

`playability.db` has two related but distinct surfaces:

| Surface | Role |
|---------|------|
| `titles` | Global verified/failed state and TTLs for unique playable titles |
| `rail_pool` | Thematic per-rail membership used by couch-visible browse sessions |

The theme gate (`rail-theme-gate.ts`) enforces `config/rail-theme-profiles.yaml` on grow/link/verify pool writes. Grow runs operate on an isolated work DB and publish the live DB after a completed publishable run; per-rail `+20` shortfalls are operator warnings by default, while failed or aborted runs preserve the previous couch snapshot. Finalization attaches verified orphans and caps unpinned overlap without full metadata retheme. See [PLAYABILITY.md](PLAYABILITY.md).

Target `772b3d5` includes playability migration `14` and reports the same value
through `/playability/status.schema_version`. A focused test binds the public
diagnostic to the latest applied migration; deployment still must read back both
the table and API on the Pi.

### Mango library state

Mango is the user-library source of truth. `progress.db` v2 owns profile-exact
Continue/resume, while `/etc/mango/library.db` is currently migrated through
v16. V12 was the original Story Graph milestone; later additive migrations add
Takeout, generation scoping, progressive profiles/frontier/calibration/usage,
and immutable overlays. The library mirrors profile watch state and owns
explicit Saved rows, automatic history, finished state, current TV
context, and dormant hidden/blocked fields. Legacy unscoped progress/watch rows
migrate only to Household. In VOD `shadow`/`serve`, recommendation reads only
the Household identity and never blends personal-profile evidence or exact resume positions. Playback
updates Continue/history but never auto-saves. Existing user-facing Pins import
once into Saved; `/pins` stays as
a compatibility API over Saved. Internal playability rail-curation pins remain
operator policy and are not user library state.

Fire/Water ratings add source-independent movie/show identity, integer half-step
storage, optimistic revisions, append-only events, and one-time prompt state to
the same durable DB. A guarded SQLite online backup is created once at
`library.db.pre-fire-water-v4.bak` before migration 4. Raw sheet captions and
sheet URLs are rejected by the seed importer. Couch history always supersedes
seed values, including after a rating has been cleared.
Pending library schemas, data backfills, and their version markers commit in a
single immediate SQLite transaction; any migration failure rolls the whole
pending set back to the previously marked boundary.

Personalization migrations retain one permanent **Household** profile plus up
to seven optional personal profiles. While VOD recommendations are active
(`shadow` or `serve`), recommendation identity is Household-only: profile and
mood controls are hidden, non-Household creation/activation and non-null mood
writes return typed `household_only`, and neither profile nor mood is part of
ranking, cache identity, generation context, or TV attribution.
Existing personal-profile ratings, history, progress, snapshots, and events
remain dormant and recoverable; they are not merged or deleted. In both
`shadow` and `serve`, Saved utility reads are exact Household reads rather than
a blend of preserved personal rows. Exact resume remains profile-owned in the
preserved data model. Household activation and clearing mood are idempotent.

Owned reads keep the existing end-to-end revision handshake. In VOD `shadow`
and `serve`, the recommendation owner is fixed to Household; the launcher captures that
identity plus the relevant source/generation revision, and the service validates
it around asynchronous work. A mismatch returns 409 and never falls through to
an ownerless endpoint. Continue, Saved, Search Detail, and hidden-title paths
retain their exact-owner validation for data integrity. Immutable attribution
also covers rating, Save/Unsave, exact
Not-for-me/Undo, current context, playback acceptance/return, and prompt actions.
Recommendation metrics advance only from a server-validated meaningful watch,
once per served item; client-supplied rail labels are never metric authority.

`off` disables VOD recommendations. `shadow` builds the latest Story Frontier
and hides For You; `serve` exposes only a promotion-eligible published
generation. No mode invokes the removed v4/strict rankers. Shadow is not a
purely invisible compute mode: it switches recommendation identity and
recommendation-signal ownership to Household while hiding For You. Its Saved
utility read matches serve and is exact Household; preserved personal rows are
left untouched.

Movies and TV Shows each receive one system rail (`for-you-movies` and
`for-you-series`) after Continue and Saved and before the three user AI-catalog
slots. `vod-story-frontier-v1` deterministically pages the complete verified-
title corpus. A normal generation needs at least 200 eligible titles **and
complete verified-corpus accounting** before it can publish; it does not
publish a partially accounted row and continue filling that same generation.
Taste mutations may instead publish a separate default roughly 240-row
priority-bootstrap generation, followed immediately within the same serialized
refresh/job by a distinct full-corpus generation. The prior complete generation
remains active until an eligible successor is activated.

Current source has one executable profile, `vod-content-profile-v2`. Refresh compiles factual
metadata plus narrowly controlled deterministic rules locally; an existing
compatible StoryDNA document is an optional richer overlay, not a whole-corpus
prerequisite. Serving still requires a content-bearing family, at least two
substantive families, and at least 1.5 substantive confidence mass. Sparse or
unrankable profiles remain excluded.

Within that architecture, Mango Companion's configured model is a stateless content
teacher only: its enrichment prompt receives canonical title evidence and
identity, never Household ratings, saves, watches, profiles, mood,
conversations, or companion memory. It cannot score, rank, select, or publish.
A versioned theme graph connects titles to controlled ontology facets and fixed
compound nodes. Ranking uses uncertainty-aware posterior graph matching, not
an embedding or title-to-title similarity number.

Current source also persists semantic generations, optional exact-ID TMDB
metadata, and a durable selective StoryDNA frontier. The worker defaults off
(`MANGO_STORY_DNA_WORKER_MODE=off`); `frontier` uses bounded daily/monthly,
batch, runtime, attempt, and coalescing limits. Library migration 15 adds the
progressive/frontier/calibration/usage state; library migration 16 adds immutable
StoryDNA overlays keyed by content plus semantic-evidence hash; playability
migration 14 adds semantic revisions. The exact executable target
`772b3d58b53208a278da4e9d5281b46f88054b8e` passes the recorded focused and
full Mac suites, but remains Pi-undeployed and couch-unaccepted. Runtime
rollback disables exposure (`shadow`/`off`);
older ranking code requires a reviewed Git rollback and can read preserved
historical rows.

The local model learns up to three supported Household taste threads from
positive Fire/Water, Saved, and meaningful VOD viewing. Ratings at or below 2.5
do not propagate negative taste. Where explicit evidence exists it owns 85% of
affinity; Saved (`0.8`) and meaningful partial/completed viewing (`0.55`/`1.0`)
share at most 15% and renormalize for cold start. A meaningful watch reaches
`min(25% of duration, 5 minutes)`, or two minutes when duration is unknown;
watch influence has a 180-day half-life while ratings do not decay. Rated,
Saved, meaningfully watched, hidden, blocked, exact Not-for-me,
artwork-deficient, and currently unverified titles
cannot render, although retained evidence may still inform taste where the
contract permits. A six-card cached dealer allocates strongest fits `2/2/2`,
`3/3`, or all six across the supported threads, samples within fit by
`1 / rank^1.5`, and avoids the preceding four slates when supply permits. There
is no close/adjacent/surprise slot, bridge, cooled-rewatch lane, MMR repair, or
visible explanation. If six cards cannot be healed, the prior valid slate stays
active.

Rating/Save/meaningful-watch mutations commit first, immediately evict the exact
known item, and enqueue a serialized/coalesced rescore followed by a full scan.
Manual refresh returns HTTP 202 with a job ID, captured revisions, and trigger
reasons. The X response path only reads/advances a cached slate and never waits
for enrichment, graph, scan, ranking, or network work. Low-water detection may
enqueue asynchronous reserve recovery after a cached read, so operator counters
must distinguish response-path latency from background work. The launcher shows
X/Shuffle only when the current tab contains a public shuffleable recommendation
rail, and reports success only when the returned rail membership/order changes.
Off/shadow cannot advance a public epoch or report a false success. An
opaque server-issued token binds the immutable served Household owner,
domain, rail, served revision, exact membership, source revision, and bounded
context. Public cards carry opaque content IDs needed for actions, but the TV
never renders them; predictions, private tags/prompts, URLs, credentials, and AI
output remain service-private. Stale-owner actions fail with 409. See
[FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md).

`/etc/mango/stremio-export.json` remains an addon-manifest graph only, not a
Stremio user-library sync source.

### YouTube cache and user state

Native YouTube is a first-class source but not a second user library. The
rebuildable `/etc/mango/youtube.db` caches YouTube metadata, rail membership,
recommender reservoirs, refresh/quota state, and temporary OAuth sessions.
Durable user state stays in `/etc/mango/library.db` with `source="youtube"` for
Saved videos, normalized Google Takeout and Mango-local history, finished state,
current detail context, exact Not-for-me, recommendation events, and watched
exclusions. In YouTube `shadow`/`serve`, the recommender reads the Household
identity only; preserved personal-profile state cannot affect acquisition or
ranking. `off` disables recommendation generation and `shadow` hides
recommendation rails; neither invokes a deleted allocator.

The YouTube Data API is used for metadata/search/subscription refresh only.
Playback resolves through `yt-dlp -> mpv`; API quota does not govern cached
playback, but `yt-dlp` failures such as 403/429/CAPTCHA are surfaced as
couch-safe playback errors. Channels and playlists open detail lists; only
videos can be Saved in M6.2.

In `serve`, YouTube v2 has five logical core positions in this order: **For You → Beyond Your
Subscriptions → More Like … → History → Saved**. **From Your Subscriptions** is
sixth when an authoritative authenticated subscription snapshot exists, and
**Live Now** is seventh when subscribed channels have live content. Normal rows
render only with exactly four globally unique landscape cards; therefore a
logical position can be absent when supply is thin. Live Now may contain one to
four.
History and Saved remain stable. `GET /youtube/rails?reshuffle=1` advances only
published recommendation, discovery, subscription, and live slates and performs
no API call, acquisition, or ranking work.

Recommendation acquisition and scoring accept exactly two inputs:
authoritative subscription snapshots and Google Takeout/Mango-local meaningful
watch history. Explicit provenance (`subscription_upload`,
`subscription_live`, `history_channel`, or `history_topic`) is required; a video
in the generic Search/detail/AI/chart metadata cache cannot leak into a
recommendation rail. Saved remains a utility rail and has zero ranking effect.
Profiles, mood, VOD activity, companion state, Search, AI catalogs, and global
charts likewise have zero influence. Shorts are excluded; live streams are
confined to subscribed-channel Live Now.

The Reliability Center accepts a Takeout ZIP or extracted JSON/HTML, streams and
validates it with bounded size/expansion, stores only normalized durable watch
events/import diagnostics, and discards raw uploaded data. Successful refreshes
publish complete local generations atomically; a failed phase preserves
last-good state. Ordinary Home loads and X consume only those published
reservoirs. Independent
`MANGO_VOD_RECS_V2=off|shadow|serve` and
`MANGO_YOUTUBE_RECS_V2=off|shadow|serve` switches permit isolated rollout.

Both latest-only architectures have their source rollout blockers closed at
`772b3d58b53208a278da4e9d5281b46f88054b8e`: YouTube `off` uses exact active
personal ownership, VOD active modes use exact Household Saved, off/shadow
cannot expose or falsely advance Shuffle, and diagnostics distinguish the
active/previous serving pointers from the newest attempted generation. Focused
mode/owner/publication/migration/rollback tests and the full Mac suites pass.
The Pi remains contained at `3ef1b20` with both recommendation domains and
provider work off. Exact deployment, live complete accounting, promotion, Pi
latency/restart proof, and couch judgment remain **DEFERRED**.

### Unified Search

Search is a temporary launcher surface coordinated by `catalog-service`, not a
new service or browse tab. Its atomic in-memory index contains distinct
verified VOD plus cached Live/YouTube metadata. Explicit submissions add
independent external VOD, one-unknown Live validation, fresh-or-cached YouTube,
and optional structured AI phases. Each phase has its own deadline and status;
usable rows survive another source failing.

Durable recents, bounded selection affinity, and SafeSearch live in
`library.db`. Rebuildable query responses live in `youtube.db`. Progressive
jobs are memory-only and bounded to 32 for six hours. The launcher stores a
versioned six-hour compact Search/focus snapshot so Detail and playback return
do not rerender Home or lose the originating tab.

The pad router reports `secondary:tap|hold`; it does not reshuffle catalogs.
The launcher maps secondary contextually: current-tab shuffle on Home, delete
or clear in Search. X ownership follows the visibly focused surface, so a
lingering playback marker or background mpv cannot steal Home shuffle. See
[SEARCH.md](SEARCH.md).

---

## Module graph

```
                    ┌─────────────┐
                    │  companion  │─── HTTPS :3001
                    └──────┬──────┘
                           │ WSS :8765
                    ┌──────▼──────┐
                    │ orchestrator│─── loopback :8766 → launcher HUD
                    └──────┬────┘
                     ┌─────┴─────┐
                     ▼           ▼
             catalog-service   launcher command/HUD
             (:3020)           (:3000/:8766)
                     │
                     ├──────────► mpv IPC/player
           │
           ▼
   stremio-core + addons (Cinemeta, AIOStreams, AIOMetadata,
                          Bharat Binge, optional Live)
```

### Repo layout

```
src/launcher/           TV UI + voice-hud.ts + voice-commands.ts
src/catalog-service/    Stremio-compatible bridge · Mango library · YouTube · play · playability · AI catalogs
src/mango-ui-server/    serve.py — static + health + launch API + catalog proxy
src/orchestrator/       voice hub (FastAPI)
src/companion/          phone PWA
scripts/mango-stack.sh  native base stack supervisor
scripts/mango-health-repair.sh  watchdog repair: stale locks · pad · catalog · launcher
```

### Companion LAN boundary

The HTTPS companion binds to the LAN for phone access, but it is not a generic
gateway to the loopback-only catalog service. `serve_https.py` accepts only the
exact method/path capabilities the companion UI uses:

| Method | Catalog path | Companion feature |
|--------|--------------|-------------------|
| `GET` | `/ai/context` | On-TV mirror |
| `GET` | `/voice/companion/summary` | Explicit Memory panel |
| `GET` | `/youtube/companion/status` | Minimal account/configuration booleans |
| `POST` | `/youtube/companion/auth/start` | Begin device authorization |
| `GET` | `/youtube/companion/auth/poll` | Poll the active authorization session |
| `POST` | `/youtube/companion/auth/disconnect` | Explicit account disconnect |

Matching occurs on the parsed path and is exact; query strings are forwarded
only after the method/path pair is accepted. Every other `/api/catalog/*`
request returns a generic 403 before an upstream request is created. In
particular, recommendation diagnostics, personalization/profile state, raw
history or journal data, Reliability Center state, playback, and maintenance
mutations are not exposed through `:3001`. The companion YouTube DTOs are also
field-minimized: status contains exactly four booleans, start contains only the
device-flow session/code/URLs/timing, poll contains only status/interval, and
disconnect contains only `ok`. They never include raw provider errors, auth
token paths, expiry/scopes, command paths, cache internals, or quota/refresh
diagnostics. Every upstream companion endpoint independently requires a
loopback caller so an accidental public catalog bind cannot bypass HTTPS. Do
not use forwarded client headers to recover that trust boundary: the proxy
itself is the LAN capability boundary.

This boundary minimizes data, but it is **not client authentication**. The
companion HTTPS server and orchestrator WSS bind to the LAN by default; the
WebSocket accepts a reachable client without a pairing token or origin/session
check. Any device already on the trusted LAN can therefore submit text/PTT/TV
actions and invoke the sanitized YouTube connect/disconnect capabilities.
Transport TLS and the catalog allowlist do not change that fact. Per-device
pairing/authentication, origin/session enforcement, revocation, and abuse
limits remain an appliance-security requirement.

### Reliability Center

`catalog-service` owns the Reliability Center because it can see catalog,
playability, YouTube, and runtime health in one place. The launcher only renders
Settings cards and proxies `/api/catalog/reliability/*`.

Reliability state is computed on demand from catalog `/health`, launcher
`/api/health`, pad health, couch activity, process counts, stale lock checks,
playability status, YouTube state, and optional voice health. Proof records are
append-only JSONL under `/etc/mango/reliability/proofs.jsonl` and are pruned to
30 days.

The status model is Green/Yellow/Red:

| Status | Contract |
|--------|----------|
| `green` | Ready for couch use |
| `yellow` | Usable but needs attention or proof is stale/partial |
| `red` | Couch path is broken or maintenance is blocked |

Mutating Reliability APIs are localhost-only. Safe repair is intentionally
narrow and delegates to `scripts/mango-health-repair.sh`; it never rebuilds DBs
or clears caches. Detail: [RELIABILITY.md](RELIABILITY.md).

---

## Foreground contract

`mango-stack.sh` owns the base stack. At idle: launcher Chromium + pad +
(optional) voice. **No** Stremio, Kodi, mpv, or overlay Chromium. The supported
daily foregrounds are launcher and mpv; current source has no executable
automatic Stremio/Kodi fallback that the product may promise.

| State | Visible | Hidden | Input owner | ⌂ behavior |
|-------|---------|--------|-------------|------------|
| `launcher` | Chromium mango UI | playback stopped | `mango-tv-pad.py` | noop / present launcher |
| `playback` | mpv fullscreen + transient OSD | launcher below or stopped | pad → mpv IPC, accelerated seek, stop/home routing | stop playback → launcher <300 ms |

### Input routing

| Foreground | B (`304`) | Y (`308`) | Home (`316`) |
|------------|-----------|-----------|---------------------|
| `launcher` | select | back / settings | noop |
| `playback` | play/pause + show progress | stop → launcher | stop → launcher |

During mpv playback, D-pad `←/→` stays precise at the short seek step, holding
`←/→` repeats with acceleration, and playback-only `L/R` performs the large seek
step without changing launcher tab semantics. `R` is key code `311`; it is not
the canonical Home button.

### Launcher D-pad transport (pad-nav API)

Launcher D-pad/face/tab/contextual-secondary events use the localhost HTTP path
by default (`MANGO_PAD_NAV_API=1`) instead of synthetic keyboard events:

```
pad evdev → routing_app (cached) → POST /api/pad/nav {action,direction,delta,kind}
serve.py → pad-nav queue (peek + Condition; seq persist async off POST path)
launcher → POST /api/pad/session → GET /api/pad/nav?after=&session=&wait=25
       → apply one fresh command per frame-or-50ms turn
       → POST /api/pad/ack {session,last_seq}
       ↘ POST /api/pad/heartbeat {session,render_age_ms} each second
```

Pad-nav is **peek-by-seq**, never drain-on-read. Only the active TV lease
receives pending commands and may compact via ack (`session` must match).
Registration is first-owner,
renewable by token, and may be replaced only after its heartbeat is stale, so a
debug tab or duplicate Chromium cannot steal input. Seq persistence is
asynchronous so POST never waits on SD I/O.
Gates and diagnostics POST with `"probe": true` to validate the contract
**without** enqueueing couch FocusGrid moves.

`render_age_ms` is sampled immediately before each one-second heartbeat asks
for the next animation frame. At an idle, healthy launcher it therefore sits
near the heartbeat interval (about 1000 ms); that value alone is not a stall.
Recovery remains based on an input command staying pending beyond the stall
budget. Read `pending`, fresh `heartbeat_age_ms`, and `last_ack_age_ms` together
when diagnosing input progress.

Movement/tab/context commands older than 300 ms are acknowledged without
replay; Select/Back remain eligible for 1.5 s. The client paces commands by rAF
with a 50 ms timer escape, so a suspended animation queue cannot permanently
stop the poller. `serve.py` watches progress outside Chromium: a command left
unacknowledged for three seconds restarts only
`mango-launcher-chromium.service`, once per cooldown. The same profile restores
the coalesced six-hour Search snapshot; playback continues to suppress launcher
recovery because its pad path is mpv IPC, not pad-nav.

When `MANGO_PAD_NAV_API=1` and the surface is launcher, the pad retries POST
(default timeout `0.75s`, 3 attempts) and **does not** fall back to xdotool on
failure — Chromium kiosk often ignores synthetic keys, which looked like
intermittent D-pad drops. Set `MANGO_PAD_NAV_API=0` only as a temporary rollback
to restore the xdotool path. The mpv path is unchanged (IPC). The pad-nav smoke
probe in `gate-m6-ux-smoke.sh` runs only when `MANGO_PAD_NAV_API=1`.

The launcher owns surface + focus state; the pad sends directional intents only.
X ownership is resolved once at button-down from the foreground and available
launcher/mpv windows, then retained through button-up. `handlePadNav` mirrors
`handleKeydown`'s priority chain (next-prompt → detail → settings → Search →
home).

Pad layout: [HARDWARE.md](HARDWARE.md)

### Must never happen

- Wallpaper/desktop with no launcher after Home
- More than one Chromium at idle
- Stremio or Kodi running at idle after `mango-stack.sh start`
- Launcher up while catalog rails/live readiness or the current pad event owner is unhealthy
- Second orchestrator listener on `:8766`

Legacy fallback environment examples remain in configuration for historical
rollback/research, but there is no current supported executable automatic
fallback path. The release contract must not depend on them.

---

## Stream API

`GET /stream/{type}/{id}` — series episodes: `series/tt12004706:1:1`

| Query | Mode |
|-------|------|
| `language` | Hard filter |
| `preferred_language` | Soft rank boost |
| `max_quality` / `min_quality` | Lab cap / floor |
| `include_uncached` | Debug only |

Enriched fields: `display_label`, `release_group`, `encode`, `size_gb`, `languages`, `debrid_service`, `cache_status`.

`POST /play` — compatibility synchronous play route; modes `auto` (main →
last-resort → obligation floor), `picker` (single stream), `verify` (main only).

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/play-session` | Idempotently accept an asynchronous catalog or YouTube play by `request_id` |
| `GET` | `/play-session/{request_id}` | Read or bounded-long-poll the authoritative session version |
| `POST` | `/play-session/cancel` | Cancel only the named request and flush progress |
| `GET` | `/play-session/active/streams` | Localhost-only URL-free picker snapshot; optional revision long poll |
| `POST` | `/play-session/active/streams/switch` | Serialized switch by session, revision, and opaque candidate ID |
| `POST` | `/play-session/active/streams/issue` | Downrank the current release on this path for seven days |
| `POST` | `/play-session/active/streams/issue/undo` | Undo the current session's issue report |

See [PLAYABILITY.md](PLAYABILITY.md) for play-first policy.

## Library API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/library/state` | Saved/latest/finished state for `type` + `id`, or `current=true` |
| `GET` | `/library/saved` | Saved rows, optional `tab` and `limit` |
| `POST` | `/library/saved` | Explicit Save by user/voice; accepts type/id/title/poster/tab/source |
| `DELETE` | `/library/saved` | Explicit Unsave by type/id/source |
| `GET` | `/library/history` | Read-only recent history |
| `GET` | `/library/not-interested` | Household hidden-title state in v2; accepts and echoes the captured owner/revision pair |
| `POST` | `/library/not-interested` | Reversible exact-title Not-for-me; v2 recommendation cards require complete Household served attribution |
| `DELETE` | `/library/not-interested` | Restore a hidden title; Settings supplies and validates the exact owner/revision pair |
| `GET` | `/library/context` | Current launcher detail context |
| `POST` | `/library/context` | Localhost launcher update for current-context voice tools |
| `DELETE` | `/library/context` | Localhost cleanup/restore hook for gates |
| `GET` | `/library/ratings?type=&id=` | Current Fire/Water rating plus one-time prompt eligibility |
| `PUT` | `/library/ratings` | Revision-checked atomic Fire + Water set/edit |
| `DELETE` | `/library/ratings?type=&id=&expected_revision=` | Clear current value while retaining audit history |
| `POST` | `/library/rating-prompts/dismiss` | Resolve the one-time invitation without changing manual Rate |
| `GET` | `/recommendations/state` | Rollout-aware diagnostics for the newest attempted row plus per-domain active/previous/public serving pointers, revisions, epoch, accounting, reserve, jobs, stale reasons, and offline evaluation |
| `GET` | `/recommendations/jobs/:job_id` | Localhost-only durable lookup for the exact refresh job returned by an HTTP 202 enqueue |
| `POST` | `/recommendations/refresh` | Localhost-only enqueue; HTTP 202 returns job ID, captured revisions, and trigger reasons |
| `POST` | `/recommendations/impressions` | Resolve an opaque served token and persist exact rendered VOD membership against immutable owner/rail/revision; no URLs |
| `POST` | `/recommendations/action` | Token-validate an explicit recommendation detail-open; stale owner/revision/membership returns 409 |
| `GET` | `/personalization/state` | Household recommendation identity plus preserved personal-profile state |
| `POST` | `/personalization/profiles` | In VOD `shadow`/`serve`, non-Household creation returns typed `household_only`; dormant rows are retained |
| `POST` | `/personalization/activate` | Household is idempotent; non-Household activation returns typed `household_only` in VOD `shadow`/`serve` |
| `POST` | `/personalization/mood` | Null clear is idempotent; non-null mood returns typed `household_only` in VOD `shadow`/`serve` |

`GET/POST/DELETE /pins` remains for compatibility and delegates to Saved.

## YouTube API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/youtube/state` | Localhost-only operator config/auth/cache/refresh diagnostics |
| `POST` | `/youtube/auth/start` | Localhost-only operator device-code OAuth |
| `GET` | `/youtube/auth/poll?session_id=` | Localhost-only operator OAuth poll |
| `POST` | `/youtube/auth/disconnect` | Localhost-only operator token removal |
| `GET` | `/youtube/companion/status` | Loopback upstream for the sanitized HTTPS companion status |
| `POST` | `/youtube/companion/auth/start` | Loopback upstream for sanitized device-flow start |
| `GET` | `/youtube/companion/auth/poll?session_id=` | Loopback upstream for sanitized OAuth poll |
| `POST` | `/youtube/companion/auth/disconnect` | Loopback upstream for sanitized disconnect |
| `POST` | `/youtube/refresh` | Fill/update cache and recommender rails |
| `GET` | `/youtube/rails` | Exact active-profile History/Saved in off; exact Household utilities in shadow; five ordered latest-v2 logical positions plus conditional subscriptions/live in serve |
| `POST` | `/youtube/takeout/import` | Localhost-only streaming ZIP/JSON/HTML history import; normalized events only, raw upload discarded |
| `POST` | `/youtube/impressions` | Token-validate exact rendered membership against server-owned source revision and context; no URLs |
| `GET` | `/youtube/search?q=` | Grouped videos/channels/playlists |
| `GET` | `/youtube/detail?kind=&id=` | Video detail or channel/playlist video list |
| `POST` | `/youtube/not-interested` | Reversible Household exact-video Not-for-me; no creator/topic propagation |
| `POST` | `/youtube/play` | Compatibility synchronous `yt-dlp -> mpv` route; launcher uses `/play-session` |

## Search API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/search/state` | Recents, starters, preferences, index/source and YouTube quota/cache readiness |
| `GET` | `/search/suggestions` | Local index only; never provider/API work |
| `POST` | `/search/query` | `202` plus initial local snapshot and progressive job ID |
| `GET` | `/search/query/{id}` | Revision-based bounded long-poll |
| `POST` | `/search/query/{id}/cancel` | Suppress superseded output |
| `POST` | `/search/selection` | Local bounded tie-break signal |
| `POST` | `/search/external/queue` | Localhost-only confirmed-empty VOD queue |
| `DELETE` | `/search/history` | Localhost-only recents and learning clear |
| `GET/PUT` | `/search/preferences` | YouTube SafeSearch |

The optional orchestrator `POST /search/expand` is localhost-only, has no
tools/history, validates at most three alternate queries, and has a four-second
deadline.

Detail: [YOUTUBE.md](YOUTUBE.md).

## Reliability API

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/reliability/state` | Current Green/Yellow/Red state, component cards, action availability, latest proof |
| `GET` | `/reliability/controller` | Controller link state plus pad-ready evidence |
| `GET` | `/reliability/proofs` | Recent 30-day local proof records |
| `POST` | `/reliability/proof/run` | Localhost-only proof write |
| `POST` | `/reliability/repair` | Localhost-only safe repair when idle |
| `POST` | `/reliability/controller/repair` | Localhost-only Bluetooth link repair when idle |
| `POST` | `/reliability/stack/restart` | Localhost-only detached stack restart when idle |
| `POST` | `/reliability/refresh/run` | Localhost-only detached nightly movie/TV + YouTube refresh when idle |

Detail: [RELIABILITY.md](RELIABILITY.md).

---

## Voice stack (M5)

```
Phone companion (:3001) ──WSS──► orchestrator (:8765)
     text chat_send │ PTT           ├─► catalog-service /voice/*
                                      └─► launcher POST /api/voice/command
Launcher voice-hud ◄── WS loopback :8766
```

**Rule:** Voice/text opens detail — pad **B** plays. Replies are text-only on phone (TTS off). Live channels use the native Mango/mpv path. `GET /voice/search?tab=live&q=` searches the full configured free-IPTV + AREA69 inventories, applies persistent playback health, and never hands off to another app; browse rails remain separately thin and policy-qualified.

Detail: [VOICE.md](VOICE.md) · [AI_LAYER.md](AI_LAYER.md)

---

## Stremio addon graph

```
Catalog addons  →  title IDs in rails / lists
Meta (Cinemeta) →  poster, plot, seasons
Stream (via AIOStreams) →  playable URLs
```

mango does **not** reindex torrents. It runs the same protocol Stremio uses for addon catalogs, metadata, and streams; Mango-owned library/progress state stays separate.

---

## Compute budget (Pi 5 · 8 GB)

| At idle | Target |
|---------|--------|
| Chromium | **1** (`mango-launcher`) |
| Stremio / Kodi / mpv | **0** |
| Python (orchestrator) | **1** when voice on |
| Node (companion + catalog) | when voice / catalog on |

Chromium is **UI only** — never decode 4K in the browser. mpv owns playback.
On Pi 5, Chromium runs with GPU rasterization (`--enable-gpu-rasterization
--ignore-gpu-blocklist --enable-zero-copy`, gated by `MANGO_CHROMIUM_DISABLE_GPU`;
default `0`) to keep focus-move repaints fast at 1080p60. Roll back to software
compositing by setting `MANGO_CHROMIUM_DISABLE_GPU=1` in the systemd unit.
After a matched 4K play, restore **restarts** the launcher unit (not only thaw)
so VideoCore EGL is recreated — freeze-through-xrandr otherwise leaves blank posters.
The pre-play detail/tab/episode snapshot is therefore stored durably in browser
local storage (with a session-storage fallback), consumed once on return, and
expired after six hours; a deliberate Chromium restart must not reset browse to Movies.

| Surface/path | Current boundary | Notes |
|--------------|------------------|-------|
| Launcher | 1080p60 | Always restored after playback for responsive Chromium focus/rendering |
| Native mpv | Proven 1080p and source-matched 4K SDR HEVC path | Final-TV picture/audio/dropped-frame matrix still required |
| Native HDR | Unsupported in the current X11/mpv product path | Older HDR tone-map evidence was not smooth enough to ship |
| Kodi/GBM HDR research | Hardware/display feasibility only | Parked; not integrated with Mango HUD/input/progress/lifecycle |

---

## Gates {#gates}

| Gate | When |
|------|------|
| `gate-lite.sh` | Default deploy (~2 min) |
| `MANGO_GATE_FULL=1` | Full gate (~5–8 min, 3 plays/rail) |
| `gate-m4-self-hosted.sh` | Self-hosted addons |
| `gate-live-iptv.sh` | Opt-in live only |
| `gate-m6-youtube-smoke.sh` | Native YouTube state/rails/search/detail and optional playback |
| `gate-m6-reliability-proof.sh` | Reliability Center proof; fails red, warns yellow |

See [STATUS.md](STATUS.md#verification).

---

## Launcher API (serve.py)

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/api/health` | launcher, chromium, pad |
| `GET` | `/api/info` | hostname, IP, ports |
| `*` | `/api/catalog/reliability/*` | Proxy → Reliability Center in `:3020` |
| `POST` | `/api/activity/touch` | localhost-only couch activity timestamp |
| `POST` | `/api/perf` | localhost-only launcher timing log |
| `POST` | `/api/launch/launcher` | Home · debounced 2 s |
| `POST` | `/api/voice/command` | Orchestrator → launcher dispatch |
| `GET` | `/api/voice/commands` | Launcher poll |
| `*` | `/api/catalog/*` | Proxy → `:3020` |

There are no supported Stremio or Kodi launch endpoints in the current UI
server. Legacy player scripts are research/rollback artifacts, not an API
contract.

---

## References

| Doc | Use |
|-----|-----|
| [STATUS.md](STATUS.md) | Shipped features |
| [reference/addon-stack.md](reference/addon-stack.md) | Operator addon setup |
| [reference/aiostreams-profile.md](reference/aiostreams-profile.md) | AIOStreams headless profile |
| [DECISIONS.md](DECISIONS.md) | Locked implementation choices |
