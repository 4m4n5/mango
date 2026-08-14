# Playability — verified library & thematic rails

**Status:** [STATUS.md](STATUS.md) · **Rail sources:** [../config/catalog-rail-curation.md](../config/catalog-rail-curation.md) · **Deep ops:** [../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md)

How mango builds and maintains **verified play pools** per browse rail, keeps titles in **thematically correct** rows, and monitors growth.

---

## Current state

The grow system is implemented as a best-effort, couch-silent maintenance workflow:

- Production YAML keeps `grow_per_pass: 20`; benchmark iterations may set `MANGO_GROW_PER_PASS=5`.
- Each active browse/AI rail aims to add fresh `new_to_rail_verified` titles. Global unique growth, orphan repair, and existing verified links are metrics only and do not satisfy the per-rail target.
- Grow uses a staged work DB. Completed publishable runs publish even when some rails miss the `+20` target; failed, aborted, or crashed runs write structured diagnostics and leave the previous stable rail snapshot visible.
- Finalization attaches verified orphans to best-fit rails or anchors and caps unpinned cross-rail membership. Pins do not consume the unpinned cap, so a pinned title can still appear in two other strong thematic rails.
- Remaining hardening focus is source quality and repeatability: `series-reality-casual` and `series-india-picks` currently struggle to meet `+20` in one run from the configured sources.
- Maintenance is idle-gated. Recent pad, launcher, voice, mpv, or progress
  activity writes a structured `deferred` report and prevents disruptive
  stop/probe/publish phases from touching the couch session.

---

## Model

| Store | Path (Pi) | Role |
|-------|-----------|------|
| `titles` | `/etc/mango/playability.db` | Global verify state (verified / failed / TTL) |
| `rail_pool` | same DB | Per-rail membership + couch display snapshot |
| `stream_path_evidence` | same DB | URL-free capability, substantial-watch proof, and temporary issue memory per release/playback profile |
| Sessions | same DB | Tab/rail shuffle slots (cleared on pool changes) |

- **Browse rails** only show titles with active **verified** status in `rail_pool`.
- A title may appear in **multiple rails**; the **unique library** is distinct `type:id` in `titles` where `status=verified`.
- **Grow** adds fresh probes; optional global links are metrics only. The configured fresh target is an SLA warning, while publish safety is based on the run completing cleanly, rails staying displayable, and finalization preserving orphan/overlap hygiene.

### Deep weighted Shuffle

Browse v3 publishes a complete eligibility index rather than future pages. The
`pool_max` value remains a growth/acquisition budget and never truncates a
published or served Browse v3 corpus. Source-backed memberships require current
exact playability plus display artwork; sparse structured metadata stays
eligible, while a typed structured conflict excludes the membership. Exact
typed corpus rules may additionally derive Comedy, Documentary, India, Quick &
Easy, Miniseries, and Reality membership from `title_story_evidence`. Popular,
Classics/Highly Rated, and AI-catalog rails remain source-backed.

Every X press filters current playability, Household exclusions, the prior rail
slate, and current-page occupancy, then performs deterministic weighted sampling
without replacement across all remaining eligible titles. Five percent of the
normalized probability mass is uniform and 95% follows source position,
thematic confidence, Household affinity, and novelty. The prior slate is relaxed
only when genuine supply shortage prevents a full row. The seed binds
`deep-weighted-v1`, eligibility/rank generation, tab, epoch, rail, and title.

For You applies the same exploration mixture after its existing fit floor,
taste-thread quotas, franchise caps, playability, and Household exclusions. It
deals from the complete ranked reserve on demand, persists only the current plus
four rendered slates, and advances by compare-and-swap. Story Graph keeps the
active generation, the previous complete last-good, and any in-flight `building`
work; older DNA/rank copies are deleted after publish. Continue and Saved stay
newest-first on ordinary load and recency-weighted `deep-weighted-v1` samples on
X (Continue also weights remaining progress). Shuffle performs no provider,
metadata, graph, ranking, verification, or acquisition call.

Story Graph last-good is the active generation plus one previous complete
copy (and any in-flight `building` work). Older DNA/rank copies, unused
`vod_story_dna_edges`, expired served slates, and terminal refresh-job tails
are operator-pruned with catalog stopped via
`scripts/m6-ship/prune-mango-state.sh --vacuum`. Catalog startup only trims
cheap bookkeeping; it does not rewrite generation history. That script does
not call `mango-stack.sh` and therefore does not snapshot `library.db` into
state backups. Saved, ratings, Takeout, overlays, and watch/progress are
never deleted.

Couch X must feel instant: the HTTP response is the in-memory deal. For You
playability uses the current verified-key set rather than a bulk title lookup,
Browse v3 category/Explore deals skip `rail_session` writes, Continue/Saved are
recency-weighted samples from local progress/Saved pools (no provider or
metadata work), and library/playability persistence plus attribution run after
the body is in flight. A later X never drops while one deal is outstanding; it
queues one trailing press. Do not add `busy_timeout` to `library.db` to hide
writer stalls — the serving path must not wait on them.

This keeps Mango's candidate generation/eligibility, scoring, and final
constraint re-ranking separate, matching Google's documented recommender
architecture: <https://developers.google.com/machine-learning/recommendation/overview/types>.
The explicit exploration share is a product policy informed by Google's RecSys
2021 work connecting exploration with diversity, novelty, and serendipity:
<https://research.google/pubs/values-of-exploration-in-recommender-systems/>.
The without-replacement key construction follows Efraimidis and Spirakis:
<https://utopia.duth.gr/~pefraimi/research/data/2007EncOfAlg.pdf>.

---

## Couch play-first policy

Couch uses accepted asynchronous `POST /play-session`; compatibility
`POST /play` delegates to the same automatic policy. Playback uses **two
ladders** and three modes:

| Ladder | Role |
|--------|------|
| **`main_ladder`** | Verified-quality streams used by grow/verify and initial play expansion. Only these write `verified`. |
| **`last_resort_ladder`** | Additional playable coverage, including risky formats retained as final fallback. Never verifies into library. |

| Mode | Entry | Candidates | Library write |
|------|-------|------------|---------------|
| **auto** | Play button | full deduplicated identity-safe set, capability-tiered, within the loaded profile wall (90 s base; 120 s `4k-hifi`) | verified only if win ∈ main; else **stale** (`last_resort_play`) |
| **picker** | Detail side-list click | exactly one manually selected stream | never; fail hides ~30 min by fingerprint |
| **verify** | grow / `probeWithLadder` | **main only** | verified only on main win |

Legacy single `play_ladder` configs are split by `verified` / display membership on load.

**Evidence-based ranking:** Each identity-safe candidate is classified for the
active engine/renderer/device/display profile as `proven_smooth`, `unknown`, or
`known_risky`. This is a hard tier: cache, verified-release hints, and startup
success cannot lift a risky stream above a smooth or unknown stream. The
`pi5-x11-mpv-hifi` policy treats 4K HDR/DV and software-decoded 4K as risky
fallback, while compatible 4K SDR HEVC remains normal selection. Within the
smooth tier, fidelity wins before cache state, so compatible uncached 4K SDR
HEVC may outrank cached 1080p. A remux receives 4K preference only when its
codec, bitrate, frame rate, and observed path evidence fit the configured path.

The headless mpv inspection records width, height, frame rate, codec/profile,
hardware decoder, HDR/color transfer, duration, and bitrate where available.
A substantial watch (`min(20 minutes, 50% of duration)`) is a soft positive
inside its capability tier; a quick exit is neutral. Evidence is keyed by
stable release fingerprint plus playback profile and never stores a signed URL.

Auto play walks the full deduplicated identity-safe set under one profile-owned
hard deadline. Source defaults and the baseline filter are 90 seconds; the
active `4k-hifi` profile deliberately uses the permitted 120-second maximum for
its larger candidate/uncached-probe budget. Do not turn either value into a
universal TTFF promise. An incomplete candidate is reclassified after its existing mpv
probe; newly proven risky candidates are deferred behind remaining smooth and
unknown choices. One `auto_play_max_attempts` budget covers every phase and its
bounded thin-candidate retry; cached-bad skips do not consume it. The obligation
floor remains, so a lone risky source is still attempted last. Candidate-local
failures may advance the ladder, but a cancellation, global deadline,
foreground-ownership conflict, display/VO failure, or failed foreground handoff
is pipeline-fatal and stops all later candidates.

**Display vs play:** `GET /stream` expands **main** first. If empty, expands last-resort (and obligation floor) marked `unverified`.

**Title identity:** play and detail-list filtering start with the requested IMDb
ID plus launcher title/year, and background verification carries that same
immutable identity into resolution. Cached metadata may enrich origin country
and the exact episode title only when its declared ID/type matches the request.
The requested title and exact-ID metadata title are trusted together only when
they normalize equally or one is a bounded whole-token prefix/suffix extension
of the other (at least two significant tokens and at least half of the longer
title). An incompatible metadata title cannot broaden matching: foreground may
still try request-title streams, but it cannot certify the result; background
verification records `identity_conflict`. Explicit contradictory IMDb IDs,
remake years, and UK/US edition qualifiers remain hard rejects. Numeric episode identity is
authoritative: Mango parses `S01E03`, `1x03`, `E03`, and `EP03`; a contradictory
season/episode is rejected, a full marker outranks a bare marker, and an
otherwise matching unmarked release remains eligible at low confidence.
Localized episode-title agreement is a bonus and disagreement is a penalty,
not a rejection when numeric identity agrees. This preserves *The Office*
edition safety without dropping localized releases such as *Adarsh Baal
Vidyalaya* S1E3.

**Slow detail resolves:** the launcher keeps its bounded initial stream-list wait. If that wait expires, it performs an `existing_only=1` late join: catalog-service returns the positive cache or joins the identical in-flight user resolve, but never starts a second provider fan-out. A true empty remains honest (`streams · none found`); a failed late join stays visible as unavailable instead of silently removing the entire stream section. Play keeps its independent full search path.

**4K truth:** the Pi 5 smooth tier is 4K SDR HEVC. A title may have many nominal 4K releases but no smooth 4K choice when those releases are HDR (tone-mapped under the current X11 path) or software-decoded AV1/H.264. Those sources stay in last-resort for coverage, but smooth 1080p TorBox now precedes known-soft 4K so automatic Play does not choose resolution over watchability.

### In-playback stream picker

For movies and series, **X** opens an inset Streams sheet inside the mpv
Lua HUD. Its URL-free five-choice roster pins the current source first and
focuses the best usable alternative; unavailable rows are disabled and last.
The list/detail layout separates readiness rows from provider, size,
bitrate, release, audio, codec, and compatibility detail. **Up/Down** moves,
**B** selects an available row, and **Y** closes before normal Back can stop
playback. Video continues visibly above the local scrim. Closing removes the
one-second state poll, so no extra steady-state process or polling remains.

Pad actions use ordered in-process mpv JSON IPC. Opening the panel is
acknowledged before the router accepts the next D-pad action, preventing a fast
X-then-Down sequence from being misrouted to normal playback controls.

Selection validates in isolation for up to 8 seconds when cached or 25 seconds
when uncached. A stale URL gets one fresh title resolve and fingerprint remap.
Validation shows `Checking stream…` and serializes duplicate input. Failure
keeps the drawer and failed-row focus while the original continues; a failed
replacement launch restarts the original and reopens the drawer. Success uses the existing generation-
scoped mpv wrapper, preserves absolute time, subtitle visibility, and
audio/subtitle language-role preference, and retains one logical progress
session. The drawer closes into `Now playing · <quality> · <readiness>` and X
temporarily becomes revision-checked stream Undo; expiry or completion restores
normal X-to-Streams. The path-issue endpoints remain compatible but have no
drawer action. There is no dropped-frame monitoring, automatic stutter
detection, or automatic switching.

The picker is default-on in `mpv-hifi` and can be disabled with
`MANGO_STREAM_PICKER=0`. Live and YouTube never expose X guidance or respond to
X. Live uses a `LIVE` badge and no false timeline.

**Native Live curation and search:** Live rails admit candidates by typed event,
competition, participant, exact-channel, and language policy before dedupe or
quality ranking. They use only Mango's configured free IPTV inventories and
AREA69; sports rails use current-event rows first and exact curated standing
brands only as bounded fill, while cartoons keep the exact allowlist and admit
unknown language metadata. Full Live
search remains independent of those thin rails via
`GET /voice/search?tab=live&q=...`, but returns only fresh playback-proven
logical channels. Fresh failures are suppressed. Unknown top matches get at
most one free and one AREA69 headless mpv validation with a hard 2 s response
allowance; incomplete proof remains hidden and finishes asynchronously. No
AREA69 validation runs while foreground playback owns mpv. A real `/play`
success/failure updates operator-owned health, and canonical quality variants
fail over within the existing overall play deadline. Resolution ranks before
English/Hindi and codec only after eligibility/proof; 2160p is 4K and only
explicit 8K/4320p is 8K. See [LIVE_TV.md](LIVE_TV.md).

**Debrid garbage safety (play path):** Prefer TorBox on same-hash ties (AIO dedup + service sort). Keep RD for unique cached releases (ladder steps admit both services; uncached RD stays excluded upstream, while uncached TorBox remains a last-resort playback candidate). Error taxonomy lives in `play-error-classify.ts`: **garbage** (`debrid_copyright_block`, `debrid_status_clip`, `debrid_nfo_sidecar`) is session-blacklisted by service-scoped stable release identity plus URL hash (~45 min) and counts toward play-failure demotion; **transient** (`debrid_playback_unreadable`, timeouts, network) is retryable and not release-wide bad-cached. Preflight is an NFO-only hard gate — sniff `error`/`timeout` still proceeds to the bounded mpv probe. Couch errors map garbage failures to generic “streams are still preparing” copy — never surface “copyright infringement”.

**Rate-limit honesty:** Bare `429` digits in opaque debrid/MediaFusion URL tokens are **not** rate-limits. Path markers (`rate-limit-exceeded`, `public-rate-limit`) and status-line `HTTP 429` / “too many requests” are. Couch `requestClass: 'user'` bypasses miss negative-cache but soft-respects confirmed rate-limit (~20s, `MANGO_STREAM_USER_RATE_LIMIT_BACKOFF_MS`). **Timeouts/5xx are not rate-limits** — they do not trip busy soft-backoff (immediate couch retry). Background keeps ~90s backoff for true rate-limits.

**Stream resolve budgets:** Automatic couch Play uses
`MANGO_STREAM_RESOLVE_BUDGET_USER_MS` (default **30s**); Detail stream lists use
`MANGO_STREAM_LIST_RESOLVE_BUDGET_MS` (default **14s**); background verify/grow
uses `MANGO_STREAM_RESOLVE_BUDGET_MS` (default **12s**). After a primary
hard-timeout with an empty pool, the legacy direct MediaFusion thin supplement
is skipped (no extra ~8s dead wait).

**Resolver topology:** Mango's intended VOD graph has one stream-capable
aggregate, AIOStreams. Torrentio, MediaFusion, and Comet are indexers inside its
profile; TorBox and Real-Debrid are debrid/transport services used by those
results. MediaFusion uses AIO's native base-URL integration so AIO supplies the
existing services without persisting a second expiring secret manifest, and is
limited to cached-search movie/series results. The three indexers form the
primary AIO group; parallel-started Easynews results are admitted only when that
group returns fewer than three cached streams. The condition gates result
admission, not whether the Easynews request starts. They are not six parallel
Mango addons. Direct copies of the three
indexers in `stremio-export.json` duplicate work and bypass AIOStreams dedup and
policy. Current source also retains a separate Pi-state-triggered direct
MediaFusion supplement when the AIO pool has at most one cacheable candidate;
close or explicitly feature-gate that legacy exception before claiming strict
AIO-only runtime. Catalog-service fans all actually configured stream addons out
concurrently, coalesces identical requests, and lets Detail warm the same
positive cache that Play consumes. `/health` exposes only fixed, credential-safe
provider counts, cumulative outcomes/latency, and the latest user/background
indexer and debrid contribution counts; it never exposes manifests, URLs,
tokens, title IDs, or stream IDs.

**Series metadata freshness:** AIOMetadata must not prefer TVDB on a self-host
that has no explicit TVDB API key. Mango's config builder selects TVMaze in
that case and preserves TVDB only when a key is configured. This affects which
episode IDs reach the resolver, not stream supply itself. For an actively
airing or daily series, compare the latest numbered/aired episode in the
AIOMetadata response with the upstream metadata provider before concluding
that a missing tail episode has no streams.

**Resolve request class:** Couch play and `GET /stream` use `requestClass: 'user'`. Background verify/grow use `requestClass: 'background'`.

**Empty-result confirmation:** AIOStreams can finish successfully at the HTTP
layer while one or more internal indexer/debrid paths are still cold. At source
and release defaults, automatic VOD Play permits two 1.2-second confirmation
passes inside the same exact-title/episode single flight and existing deadline;
explicit rollback/experiment knobs accept 0–3 attempts and 0–10-second delays,
so runtime values must be recorded. This folds
the observed empty → empty → playable sequence into one B press, stops on the
first playable result, and never probes a sibling. Only a clean empty or a
sanitized error-only result proven transient is eligible. Addon fetch
timeout/5xx, confirmed 429, cancellation, permanent account/configuration error,
authoritative no-stream placeholder, invalidated work, or exhausted deadline is
terminal **for the clean-empty resolve-confirmation loop** and retains its honest
classification. This does not disable candidate-local ladder fallthrough or the
one eligible stale-cached-transport fresh resolve described above. Detail
`GET /stream` is bounded to 14 seconds and uses zero automatic confirmations;
Live and picker refresh also use zero. Cache state is written only after the logical resolve settles. AIOStreams
stream errors stay visible to catalog-service (`hideErrors=false`, only
non-stream resources hidden). Mango removes those rows from picker/ladder and
couch-visible candidates and uses safe fixed-category copy/counters there.
Loopback `/stream` diagnostics can still contain raw operator error details.
URL-less nested AIO errors are normalized first into credential-free internal
category placeholders and remain available to safe contribution/backoff
classification. The companion proxy denies `/stream`; keep the API operator-only
until the remaining raw details are sanitized.

The couch hot path is deliberately play-first: read an existing verified hint, perform one user-class provider resolve, then walk main → last-resort → obligation floor. Drift/prepare/full verify and trigger draining remain background work; they do not add a second provider resolve before playback.

**Library demotion (gradual, not instant tombstone):**

| Couch outcome | DB effect |
|---------------|-----------|
| Transient / zero-stream / opaque mpv | Enqueue `play_failure_reverify` only — no status change |
| Last-resort / floor Play success | `demoteTitle(last_resort_play)` → `stale`, keep recovery evidence but exclude from Home |
| First obligation-floor exhaustion (play fail) | `demoteTitle(play_miss)` → `stale`, keep pool/session evidence but exclude from Home |
| Second exhaustion within 24h after `play_miss` | `invalidateTitle(play_failure)` → `failed`, purge pools, reshuffle session |

Recovery: targeted cache invalidation after confirmed failure, queued/background reverify, and nightly stale reverify + grow. Background verify must not overwrite a couch `play_miss` demotion with `failed` unless `forceReprobe`.

Unified Search keeps unverified external VOD isolated in **More Movies &
Shows**. It never queues from a result, focus, metadata error, timeout, provider
failure, or AI expansion. Only a Search-origin Detail stream-list request that
finishes successfully with zero streams may enqueue the idempotent
`search_unavailable` trigger through the same playability ingest pipeline.
Existing verified/pending rows are preserved. See [SEARCH.md](SEARCH.md).

**Deferred `vo=null` scope:** every non-live VOD (movies, series, and YouTube, including split A/V) starts on the null-VO/null-AO buffer path. After the launcher is hidden and the root is black, Mango source-matches HDMI, enables GPU VO plus configured/automatic AO, and reveals mpv. Immediate live playback and deferred VOD share the same hifi tone-map, audio, subtitle, cache, and render policy; only display/audio activation is deferred.

---

## Thematic rails (shipped)

Two mechanisms share one profile file:

| Mechanism | When | Script / code |
|-----------|------|----------------|
| **Theme gate** (ongoing) | Every grow · link · verify pool write | `rail-theme-gate.ts` — on by default |
| **Pool retheme** | Manual repair + grow finalization | `rail-pool-retheme.sh` / `refreshAllRailsGrow` |

**Profiles:** `config/rail-theme-profiles.yaml` (`MANGO_RAIL_THEME_PROFILES`)

| Field | Meaning |
|-------|---------|
| `intent` | Positive keywords (tokenized like AI compose) |
| `exclude` | Strong mismatch — blocks pool membership |
| `min_fit` | Minimum score to keep title on rail (anchor rails use `3`, India rails `14`) |
| `max_runtime_minutes` | Movies only — e.g. quick-watches cap |

**Anchor rails** (`movies-global-popular`, `series-global-popular`) stay permissive — catch-all for relocated titles.

**Pins** from `rail-curation-overrides.yaml` always bypass the theme gate.

Disable gate (debug only): `MANGO_RAIL_THEME_GATE=0`

### Pool retheme

Use manually after large source reshapes or legacy overlap. Completed
publishable grow runs use a lightweight finalization path: active verified orphans are
scored to their best matching rail or anchor fallback, and existing pooled
titles are capped to two unpinned memberships by current pool score. Full
metadata retheme remains a manual/off-hours repair operation.

```bash
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --rail series-reality-casual
bash scripts/m3-play/playability/rail-pool-retheme.sh apply          # preserve titles → best-fit or anchor
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --include-orphans --limit 200
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --include-orphans   # all verified titles → best-fit or anchor
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --orphans-only      # attach orphans; do not prune/retitle current pools
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --overlap-only      # cap rail overlap without metadata retheme
bash scripts/m3-play/playability/rail-pool-retheme.sh recover         # orphans → anchor rails
```

Apply clears affected rail sessions. `--include-orphans` extends the same theme
scoring to active verified titles that are not in any rail; use `--limit` for
manual off-hours batches when addon meta limits are tight. Pins and curation
overrides are preserved and do not consume the unpinned overlap budget. A pinned
title may still appear in up to two other matching rails. `--orphans-only`
repairs orphaned verified titles without changing existing memberships.
`--overlap-only` is the grow-safe lightweight repair: it enforces the unpinned
overlap cap from current pool scores without metadata calls or theme relocation.

---

## Rail source map (current)

Curated in [catalog-rail-curation.md](../config/catalog-rail-curation.md). Highlights:

| Rail | Theme |
|------|--------|
| `movies-quick-watches` | Short / stand-up / easy - streaming, RT-short, and shorts lists; not classics overlap lists |
| `movies-india-trending` | **Indian cinema** - Bharat Binge Hindi/Tamil/Telugu/Malayalam/Kannada catalogs plus India-native MDBList pools; not generic western titles "trending in India" |
| `series-india-picks` | **Indian series** - Hindi/Tamil/Telugu/Malayalam/Kannada OTT plus India-native MDBList pools, with new regional/provider sources admitted as probation probes |
| `series-classics` | Critically acclaimed shows - IMDb anchor plus HBO/BBC depth |
| `movies-documentaries` | Documentary pools widened; weak true-crime source retained only as low-weight probation |
| `series-global-popular` | Cinemeta anchor plus `mdblist.88303` / `88434` trending-show depth; weak older daily source is low-weight probation |
| `series-reality-casual` | Reality / game shows - `mdblist.84401` plus deep `147884`; weak and broad show-chart sources stay low-weight and must pass the reality/game-show theme gate |
| `series-comedy` | Sitcom/comedy MDBList pools plus small Indian stand-up overlap where theme-fit passes |

Hit-rate tuning: `python3 scripts/diag/source-hitrate.py`

Runtime grow audit:

```bash
python3 scripts/diag/source-grow-audit.py --rail movies-india-trending
python3 scripts/diag/source-grow-audit.py --rail series-india-picks
python3 scripts/diag/source-grow-audit.py --rail series-reality-casual
```

**Historical June evidence (not current corpus size):** on 2026-06-25, an earlier Pi grow published `+280`
unique verified titles. The scheduled 03:00 nightly later staged `+3` stale
re-verifications, but the maintenance process was aborted with rc `143`; the
staged DB was discarded and the live DB remained at `1054` unique verified
titles with `0` orphans. Separate source-yield audits showed
`series-reality-casual` reaching only `+9/20` and `series-india-picks`
remaining at `+0/20` in observed strict windows, mostly due to no-stream
catalogs, duplicates, unresolved IDs, and theme-rejected broad charts.

The current repository-recorded recommendation census is materially larger
(roughly 5.4k verified movies and 3.8k+ verified series), but that snapshot is
not a fresh grow proof. Use `playability-status.py` and
`/recommendations/state` on the actual Pi; never reuse `1054` as current truth.

---

## Grow & top-up jobs

| Job | UI label | Command |
|-----|----------|---------|
| Reshuffle | Refresh library | launcher inline |
| Quick top-up | ~8 min | `playability-grow.sh --mode grow --preset quick --detach` |
| Nightly | ~60–90 min total | `playability-maintenance.sh --mode nightly` |
| Overnight | ~4 h loop | `overnight-playability-grow.sh --detach` |
| Manual grow | — | `playability-grow.sh --mode grow --detach` |
| Run control | operator | `grow-run-control.sh start/status/watch/assess/abort` |
| Explicit catch-up | operator | `playability-catch-up.sh nightly\|grow\|stale` |

**Presets:** `quick` (8 min / 100 attempts per rail) · `nightly` (25 min / 250 attempts per rail) · `overnight` (45 min / 400 attempts per rail chunk) — see [LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md)

**Grow target:** fresh **new-to-rail exact-main probe-verified** titles. Below `pool_max`, the target fills active-pool headroom up to `+20`; at/above the cap it falls to the policy's 20% breadth lane (`+4` with current defaults). Existing verified links, orphan reattachments, fallback wins, and pool reshuffles do **not** satisfy the target. Anchor rails are included by default; the old anchor diet is opt-in only (`MANGO_GROW_ANCHOR_DIET=1`). By default, target misses are warnings and usable verified work still publishes; set `MANGO_GROW_REQUIRE_TARGET=1` for strict proof runs.

### In-place hardening contract

- `/etc/mango/playability.db` remains the fixed live database. Grow/nightly use a staged DB, validate integrity/domain invariants, take a verified prepublish snapshot, publish through SQLite Online Backup, inspect the checkpoint result, restart catalog, and read back the exact publication receipt. WAL/SHM files and lock pathnames are never unlinked as cleanup.
- Verification carries an immutable request identity and run/source/rail receipt. Only an exact requested main-path win writes proof version 2; a fallback may play now but cannot certify global playability. Existing proof-version-1 rows are grandfathered until a natural touchpoint.
- Playability migration 19 quarantines only bare IMDb identities concurrently verified as both movie and series. Both typed rows become `stale/identity_type_collision`, retain their evidence/memberships/user state, and enter the existing priority retry queue for exact typed verification; it is not a corpus-wide recheck.
- Failed verification always returns `ok: false`, including when availability policy preserves an older verified row. Trigger promotion additionally requires an identity-certifiable exact-main win. Exact episode triggers can renew episode proof but never assign a Home rail.
- Exact later-episode failures own episode state rather than demoting the show: transient/infrastructure failures enqueue an exact retry; the first confirmed full-ladder miss becomes `stale/play_miss`; a second confirmed miss within 24 hours becomes `failed/play_failure`. An exact-main recovery renews that episode.
- Every asynchronous launcher Play emits one bounded `play_request_terminal` outcome (`playing`, `failed_before_frame`, or `cancelled`). `/playability/status` exposes only a rolling in-memory aggregate by outcome/failure stage; terminal records exclude title text, content IDs, URLs, provider payloads, and raw errors.
- One permanent machine-wide coordinator lease owns API, targeted, fill, startup/background, nightly, and overnight maintenance. API starts return a durable `run_id`; simultaneous starts yield one claim and one `409 active_run_id`.
- One permanent probe-pool lease owns every mpv verification process. Crash recovery relies on closing the file descriptor, never deleting a lock pathname.
- Stale work is a durable priority queue. Active play failures lead; cause-specific retries back off exponentially; default admission is at most 200 due rows. Home serves verified rows only, while Saved/Continue can retain unavailable intent outside this Home selection path.
- The nightly budget is 150 minutes from start. New candidate/page admission stops at 135 minutes so in-flight work can finish and publication/service restoration retain 15 minutes. A validated playability publish followed by VOD/YouTube failure is `partial`, with last-good downstream generations retained.
- New couch activity yields maintenance at the next candidate/page boundary; completed staged work can publish, the cursor is retained, and the run is recorded as yielded/partial before the couch stack is restored.
- `config/playability-policy.json` is the single schema-validated policy snapshot. Its hash is present in run claims and the publication configuration hash. Public-source automation defaults off.

**Monitor:**

```bash
python3 scripts/diag/grow_monitor.py status
python3 scripts/diag/grow_monitor.py watch --interval 30
python3 scripts/diag/grow_monitor.py assess
python3 scripts/diag/playability-status.py
python3 scripts/diag/ops-report.py
```

Tracks **unique verified library** size and per-rail deltas (`unique_verified`, `unique_verified_delta`) separately from per-rail target completion.
Status and assess output also include orphan count, overlap count, over-cap
titles, duplicate candidate pressure, wasted candidate ratio, and retheme
finalization results when present. During an active staged grow, status reads
the isolated work DB and labels it as `staged work DB`; couch-visible rails
switch only after a completed publishable run.

Ordinary 03:00 maintenance does not run the source-hitrate benchmark. It remains
an explicit isolated operator diagnostic (`MANGO_SOURCE_HITRATE_PREFLIGHT=1`)
and must not consume the nightly verification window by default.

### Idle-gated maintenance

The activity file is `~/.cache/mango/couch-activity.json` and stores only
timestamp, source, hint, and pid. The default idle threshold is 30 minutes.

```bash
bash scripts/diag/couch-activity-status.sh
bash scripts/lib/couch-activity.sh is-idle
```

`playability-maintenance.sh` checks this before stopping launcher/catalog and
again before the disruptive grow phase in nightly mode. If activity appears,
the report is written with `ok:false`, `failure_category:
couch_active_deferred`, `deferred:true`, and an operator repair suggestion.
Debug/operator override: `MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY=1`.

The systemd playability timers intentionally omit `OnBootSec` so a reboot does
not immediately stop a newly active couch session. There is also **no daytime
auto-retry timer** for failed nightlies — use the explicit catch-up script after
verifying the couch is idle (and after Reliability Center shows yellow/red for
playability).

---

## Manual curation

```bash
bash scripts/m3-play/playability/rail-curation.sh list
bash scripts/m3-play/playability/rail-curation.sh pin add --rail series-comedy --type series --id tt33094114
bash scripts/m3-play/playability/rail-curation.sh apply
```

---

## Rate limits & deploy hygiene

Addons (Cinemeta, AIOMetadata, AIOStreams) throttle aggressive meta/stream bursts.

| Risk | Mitigation |
|------|------------|
| Full gate played every couch item per rail (old behavior) | **Fixed:** `MANGO_GATE_FULL=1` samples **3 plays/rail** |
| `rail-pool-retheme apply` on full library | Full metadata retheme can issue thousands of sequential meta calls — run off-hours; grow finalization uses the lightweight overlap/orphan path |
| Gate-lite + deploy restart | M4 stream gate uses fixture corpus only — bounded |
| Source hit-rate benchmark | Excluded from the nightly critical path. Run explicitly with `MANGO_SOURCE_HITRATE_PREFLIGHT=1`; normal source quality comes from causal run outcomes. |
| Live/IPTV addon rate limit during VOD grow | Playability refresh boots catalog-service in VOD mode and skips optional Live manifests |
| Repeated bad candidates during long grow | Rail-specific rejection ledger skips recent theme/stream misses before probing; deep-page bypass for stream misses is debug-only |
| TMDB-only candidates that cannot map to IMDb | Grow marks them `unresolved_external_id`, skips stream probes, records a rail TTL, and demotes the source through runtime-only weights |
| One weak source burns a rail window | Runtime source circuit breakers suppress rate-limited, exhausted, theme-mismatched, or unsustainably low verified-yield sources for the current rail run |
| Transient stream-addon empty responses | Grow verification retries one zero-stream resolve before writing a `no_stream` tombstone |

Catalog env: `MANGO_META_RATE_LIMIT_BACKOFF_MS` (default 5 min) · `MANGO_RAIL_META_CONCURRENCY` (default 6) · `MANGO_CATALOG_FETCH_TIMEOUT_MS` (default 20s, hard-bounds catalog fetch and JSON body parsing) · `MANGO_STREAM_RESOLVE_BUDGET_USER_MS` (default **30s** — automatic VOD Play) · `MANGO_STREAM_LIST_RESOLVE_BUDGET_MS` (default **14s** — Detail list, aligned below the 15s launcher timeout) · `MANGO_STREAM_RESOLVE_BUDGET_MS` (default **12s** — background verify/grow) · `MANGO_STREAM_ZERO_RETRY_ATTEMPTS` / `MANGO_STREAM_ZERO_RETRY_DELAY_MS` (automatic VOD Play default **two 1.2s confirmations** — only clean/proven-transient aggregate empties; set attempts to `0` for rollback) · `MANGO_STREAM_RATE_LIMIT_BACKOFF_MS` (default **90 s** — after a confirmed stream 429 / rate-limit placeholder, background verify/grow skip re-resolving that title; couch soft-respects ~20s via `MANGO_STREAM_USER_RATE_LIMIT_BACKOFF_MS`; timeouts are miss not busy) · `MANGO_STREAM_NEGATIVE_CACHE_MS` (default 90 s — empty-miss dampening for background paths) · `MANGO_STREAM_SERIES_CROSS_PROBE_LIMIT` (default **0** — couch play never scrapes sibling episodes for title-fallback; season-0 bonus rows still always run the small documented `bonusIndexerProbeIds` S0→S{N} same-episode alias) · `MANGO_STREAM_META_CONTEXT_TIMEOUT_MS` (default 1.2s so stream lists do not wait on slow meta addons) · `MANGO_PLAYABILITY_VERIFY_ZERO_RETRY_ATTEMPTS` / `MANGO_PLAYABILITY_VERIFY_ZERO_RETRY_DELAY_MS` (default one 1.2s retry during grow verification only)

Grow negative memory is runtime-only:

- `rail_candidate_rejections` lives in `playability.db` and is scoped to `rail_id + title`.
- Theme rejects default to a 7-day rail TTL; no-stream/title-mismatch grow rejects also default to about 7 days.
- Debug-only failed-title bypass: `MANGO_GROW_BYPASS_RECENT_FAILED=1`.
- Runtime source weights and source suppressions never edit catalog YAML or theme profiles.
- After changing verification policy, run benchmarks with an isolated cache path
  when the tool supports it. If comparison absolutely requires rotating
  `~/.cache/mango/source-grow/latest.json`, obtain explicit authority and move it
  to a timestamped backup; never delete/reset it as routine recovery.
- Unresolved external catalog IDs are structural candidate failures, not playback failures; they should show up as `skipped_unresolved_external_id` and source `unresolved_external_id`, not as repeated `no_stream` probes.
- `uncached_verify_legacy` is a migration quarantine reason for older rows proven by stale cache metadata; it retries immediately by default so the current stream parser can re-verify them.
- Source hit-rate reports written by Python use seconds timestamps; the grow loader normalizes seconds/milliseconds before age checks.
- Decayed runtime source outcomes are normalized relative to productive peers. A rotating 5% exploration lane keeps weak/new sources observable; no productive source exceeds 50% when alternatives exist.
- Nonzero but unsustainable stream yield is still demoted: `MANGO_GROW_SOURCE_MIN_VERIFY_RATE` defaults to `0.05`, so sources with enough samples but <=5% verified yield stay in the small probation budget.
- Catalog short/empty pages are terminal for that source revision and raw source continuation positions persist independently of filtering/merge output. Three catalog failures or 30 eligible candidates without an exact-main win suppress the source under the current policy.
- Public catalog discovery is metadata-only and disabled by default. The client accepts only HTTPS movie/series catalog descriptors from an explicitly configured Stremio collection, pins a public DNS result for TLS, revalidates redirects, bounds time/bytes, sends no Mango credentials, and ignores stream resources. Promotion/quarantine is driven only by run-causal exact-main canary outcomes.
- Monitor state is written to `~/.cache/mango/grow-run-state.json`; it is operator-only and not shown on TV.
- Completed grow finalization attaches verified orphans and prunes unpinned overlap above two rails per title without full-library metadata rescoring. Failed or aborted grows keep the previous stable couch sessions visible.
- `playability-indexer.ts` is an internal worker and refuses direct mutation without an inherited coordinator claim. Use `playability-top-up-rail.sh` or the familiar grow/nightly/fill commands; all delegate before syncing sources, stopping services, probing, or writing.

If refresh fails, `refresh-*.json` now records `ok:false`, `stage`, `failure_category`, and `repair_suggestions`; use `python3 scripts/diag/grow_monitor.py assess --refresh-json <file>`.

---

## Gates (playability)

| Gate | Plays |
|------|--------|
| `gate-lite-play.sh` | 1 movie + 1 series smoke (attempt budget 18 = ladder + obligation floor) |
| `gate-m3-verified-rails.sh` | **3/rail** when `MANGO_GATE_FULL=1` (override: `MANGO_N3C_GATE_MAX_PER_RAIL`) |

Full gate still runs M1 · M4 self-hosted · play orchestrator checks — holistic without exhaustive per-rail play.

From the home Mac:

```bash
# After the deploy-wrapper blocker in DEPLOY.md is fixed/reviewed and Pi HEAD is read back:
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh'
```

PR regression (not gate-lite): `bash scripts/m3-play/playability/gate-m3-library-grow.sh`

---

## Latest-only serve-mode personalized-rail eligibility

This section describes the latest-only VOD `serve` mode. In `off`, Mango does
not build or expose personalized For You rails. In `shadow`, Mango builds the
latest recommendation architecture but still exposes no public For You rail;
shadow uses Household recommendation identity and exact Household Saved while
leaving preserved personal rows dormant. Only `serve` publishes the latest
personalized rails. There is no supported legacy-public-rail fallback.

Fire/Water `For You` candidates come only from the global active verified-title
corpus; recommendation enrichment cannot publish an unverified title or bypass
the normal grow/resolver ladder. Household ratings, Saved, and meaningful
viewing provide positive taste evidence, while exact rated, Saved, meaningfully
watched, hidden, blocked, Not-for-me, invalid, and duplicate titles are serving
exclusions. Personal-profile rows remain dormant and are never blended. There
is no cooled-rewatch lane.

Each visible Movies/TV For You response is exactly six titles currently marked
verified in the playability DB. The dealer allocates `6`, `3/3`, or `2/2/2`
strongest-fit portfolios across supported Household taste threads and has no
close/adjacent/surprise or bridge slot. If a new six-card slate cannot heal
after load-time revalidation, Mango retains the prior valid slate and omits the
rail only when no valid six-card slate exists. This is source-state evidence,
not unobserved target-TV playback proof. The stateless StoryDNA teacher can
enrich content evidence only in the idle/background path; the deterministic
local theme graph owns eligibility, ranking, uncertainty, and the final slate.
Generation publication is atomic, failure retains last-good, and the launcher
never waits for AI. Playing
a For You card uses the exact same play-session and playback ladder as every
curated rail, including the existing 4K policy and proof boundary.

`MANGO_VOD_BROWSE_V3` is a separate presentation rollout. Its Explore pool is
the complete current verified, unexpired, poster-bearing corpus after the same
exact-title exclusions; every eligible row has positive weight. Category and
AI-catalog deals read an atomic complete eligibility index and never mutate
source membership. The active
tab deal is persisted atomically with one previous fallback, globally
deduplicated, and revalidated before reuse. Browse-v3 Home/X performs no
provider verification, metadata enrichment, StoryDNA, or ranking work; any
failed card is healed from already-published local state or the previous deal
is retained.

At executable Pi target `fb20baa`, Browse v3 is in `serve` with two ready
reservoirs and 19,950 candidate rows. Forty X presses per tab stayed cache-only,
globally deduplicated every page, and measured p95 121.9 ms Movies / 119.5 ms
TV. Detail Related reads compatible compiler-v2/StoryDNA evidence and restricts
rotation to the strongest 64 candidates that satisfy direct thematic admission;
it never performs synchronous enrichment.

## Open items

| Item | Why it matters |
|------|----------------|
| Prove repeated unattended full `+20` grows | Target state is a constantly growing library without manual repair |
| Improve reality and India-series source yield | Current catalogs are thematically useful but often no-stream, duplicate-heavy, unresolved to IMDb, or rejected by the strict theme gate |
| Promote/demote sources from measured grow outcomes | Runtime weights should keep healthy catalogs hot and weak catalogs on small probation budgets |
| Keep diagnostics compact | Operators need exact stage/source/reason without exposing grow/debug status on TV |
| Revisit full retheme cadence | Full metadata retheme is useful but can trigger many meta calls; default grow should stay lightweight |
| Human-judge current recommendations | Automated Browse v3 accounting, latency, dedupe, all-rail rotation, and cached serving pass at `fb20baa`; ten-shuffle For You plausibility, category truth, Detail Related coherence, focus, and target-TV playback remain couch-owned |
| Prove recommendation refresh after publication | Grow completion must wait for exact VOD/YouTube jobs while preserving last-good on failure |
| Prove AIO runtime topology separately from Git | AIOStreams `userData` is Pi-owned state; resolver/indexer/transport contribution cannot be inferred from repository config |
