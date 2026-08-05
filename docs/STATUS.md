# mango — current status

**Branch:** `feat/native-experience` · **Roadmap:** [ROADMAP.md](ROADMAP.md) · **Acceptance:** [COUCH_TEST.md](COUCH_TEST.md)

Latest recommendation deployment target: **2026-08-05**,
`c8cfe72154eb7732a41f78417f3a63b164835078`. It is source/Mac-test truth, not
Pi/deployment/couch truth. Use `git status`, `git rev-parse HEAD`, and the Pi
commands below before acting.

## How to read this page

| Evidence | What it proves |
|----------|----------------|
| Source-complete | Code/configuration exists at the audited source revision |
| Local-pass | Named tests/builds passed on that revision and machine |
| Pi-deployed | Pi was observed at an exact Git SHA and feature mode |
| Pi-gated | Named automated runtime checks passed on that exact deployment |
| Couch-observed | A human observed the physical TV/controller/audio behavior |
| Deferred | The named evidence does not exist yet or belongs to an older contract/SHA |

Green in Reliability Center means that the sampled runtime was healthy at that
moment. It is not a permanent product certification. Historical task reports
prove only their exact revision and contract.

## Executive status

| Area | Source | Latest recorded runtime/proof | Remaining |
|------|--------|-------------------------------|-----------|
| Native launcher, Detail, Search, D-pad | Complete | Deployed and repeatedly Pi-gated on earlier revisions; later UX rounds have partial couch evidence | Final exact-revision whole-product couch pass |
| Native mpv playback | Complete | Deferred-foreground and single-B playback were proven on selected titles on earlier revisions | Current-SHA regression matrix, failure cases, target-TV/audio proof, legacy direct-MediaFusion topology decision |
| HUD and Streams drawer | Complete | Local fixture/source gates; home-agent deployment work recorded | Current exact-SHA screenshots and 4K dropped-frame/no-regression couch pass |
| Mango library and Fire/Water input | Complete | Library/ratings base deployed; earlier Fire/Water UI was couch-tuned under a superseded 12-card recommender | Recommendation-v2 served quality and current six-card acceptance |
| VOD recommendations | `c8cfe72` bounded progressive profiles + Household Story Frontier; v17 priors/checkpoints, paged worker, couch preemption, liveness watchdog, guarded memory defaults; data preserved | Pi last reported at `9425b1f`, VOD off, 1,096 StoryDNA rows preserved after an 1100M `MemoryHigh` restart | Exact-SHA shadow deploy; two-cycle 1280M/1536M stability, accounting, latency, serve, couch verdict |
| Native YouTube base | Complete | Previously deployed/Pi-gated | Current exact-SHA revalidation and account-specific proof |
| YouTube recommendations | `c8cfe72` authoritative subscription/history v2; conditional alternate-seed/exact-channel More Like with stage funnels, data preserved | Pi last reported at `9425b1f`, YouTube off; prior More Like reserve empty | Independent shadow/serve, quota/provenance and couch proof; omission is valid only with `not_applicable` |
| Voice/phone companion | Complete for trusted-LAN development contract | Automated corpus/memory/UX gates on earlier revisions; partial couch work | Full V1–V12/current coherence plus per-device client auth/pairing before appliance release |
| Reliability Center/nightly proof | Implemented with a known optional-Live defect | Deployed on earlier revisions | Current-SHA proof, make intentionally disabled Live neutral, controller-action UI mismatch, repeated unattended evidence |
| Controller reconnect | Source-complete | Automated gate exists; normal-wake behavior partially exercised | Five physical power-on reconnect cycles without pairing mode |
| Display sleep | **Not implemented** | Recorded Pi still exposed accidental Xorg 600-second DPMS values | Implement locked Settings/idle/mpv/DPMS/CEC contract and prove on TV |
| Library grow | Complete, hardening | Large verified corpus exists; older successful/aborted runs are recorded | Repeated unattended publishability and thin-rail source yield |
| 4K SDR / HDR | 4K SDR path implemented; native HDR unsupported | Older experiment proved smooth source-matched 4K SDR HEVC; HDR/X11 was not usable | Final-TV SDR/audio matrix; either credible HDR integration or explicit no-HDR ship boundary |
| Deployment | Git-only contract; current wrappers unsafe for unattended agents | Older deployments exist | Enforce/pin branch+SHA, fail closed on fetch, remove/default-disable and harden implicit AIOMetadata mutation |
| First boot | Not implemented | Operator-installed system | M6.4 no-SSH installer/wizard |

## Recorded source and Pi baseline

### Source audit

- `c8cfe72154eb7732a41f78417f3a63b164835078` is the exact executable recommendation rollout target. It keeps the
  latest-only architecture and preserves historical database rows and schemas.
- VOD retains deterministic `vod-content-profile-v2`, compatible immutable
  StoryDNA overlays, local Household taste/ranking, full-corpus generations,
  cached six-card slates, optional exact-ID TMDB, and an opt-in bounded frontier.
  It removes semantic-hash v4, cosine/KNN/MMR, the legacy rank worker/snapshot
  fallback, strict complete-StoryDNA publication, corpus-wide teacher backfill,
  and the old comparison evaluator.
- YouTube retains only authoritative subscription/history acquisition,
  provenance-gated atomic v2 generations, and cached recommendation rails. It
  removes Popular, Fresh Finds, Because You Watched, profile/mood/companion
  scoring, generic reservoirs, AI Home rails, chart/legacy-live acquisition,
  and destructive fresh-start/reset APIs. Search and user-created AI catalog
  seeds remain separate and cannot establish recommendation provenance.
- The catalog-service build and full test suite pass locally at this revision
  (`881/881`), as do 86 launcher deterministic tests and the launcher and
  companion production builds. The
  cleanup intentionally removed a large legacy implementation/test surface, so
  Pi migration/state-preservation proof, mode-aware gates, generated reserve
  health, and human quality remain mandatory rather than inferred from test
  count alone.
- Migrations 15–17 retain the additive progressive/overlay/runtime schema, and
  playability migration 14 remains. Focused runtime proof is still needed for
  upgrade/preservation/rollback, frontier lease/retry/rolling-window/
  coalescing/concurrency/restart behavior, TMDB failure/rate/credential/series
  cases, and exact Pi activation/staleness behavior.
- One orphaned compatibility surface remains outside the catalog recommender:
  the orchestrator still exposes `/recommendations/enrich`, although the
  latest catalog architecture no longer consumes the legacy v4 enrichment
  path. Treat removal or repurposing as cleanup work; do not expose it as a
  supported product recommendation architecture.

### Confirmed source inconsistencies and blockers

- **Deploy is not fail-closed.** `pi-deploy.sh` and `pi-exec-gate.sh` derive the
  Pi branch from the Mac checkout rather than enforcing
  `feat/native-experience`; the deploy prefetch may fail open, and both helpers
  pull an unpinned branch. `pi-deploy.sh` also unconditionally invokes
  `sync-aiometadata-rail-catalogs.sh || true`. With a live service and private
  import that can POST configuration, rewrite AIOMetadata credentials/export,
  print a secret install URL, leave `/tmp/aiometadata-save.json`, and mask a
  failure. The local skip variable is not forwarded. Both wrappers are blocked
  for unattended agents until fixed and regression-tested.
- **Playability schema diagnostics remain reconciled at `c8cfe72`.** Current source
  inserts migration `14`, reports `schema_version=14`, and has a focused test
  tying the public status value to the latest applied migration. Pi readback is
  still required after deployment.
- **Routine state backup is not fail-closed.**
  `scripts/m6-ship/backup-library-state.sh` prefers SQLite's online backup API,
  but on `DatabaseError` falls back to `shutil.copy2` of the main file, which can
  omit live WAL state. It also does not back up `playability.db`. Do not use the
  helper alone as migration proof; successor rollouts require explicit online
  backups and verification of both library and playability databases until the
  helper is hardened and tested.
- **Optional Live currently poisons overall reliability.** Product policy makes
  Live optional and excludes it from default gates, but the Reliability model
  marks `live_config_ready=false` red and folds that component into overall red.
  There is no intentionally-disabled-Live regression test. Until fixed, a
  Live-off box can be falsely reported as not couch-ready.
- **Resolver DTO sanitization is incomplete.** URL-less nested AIO error rows are
  now normalized into credential-free category placeholders before URL
  validation, so they participate in retry/backoff accounting. However, loopback
  `/stream` diagnostics can still expose raw addon fetch error details even
  though the launcher does not render them and the companion proxy blocks the
  route. Treat those DTOs as operator-only; sanitize them before widening access.
- **Recommendation source blockers are closed at `c8cfe72`.** YouTube off now
  returns exact active-profile utilities without a false 409; VOD shadow and
  serve both read exact Household Saved; off/shadow cannot advance or falsely
  report Shuffle; and diagnostics distinguish newest rows from active/previous,
  promotion, and public pointers. Focused mode/migration/publication tests pass.
  Pi/runtime proof is still required before promotion.
- **Heavy VOD refresh ownership is now bounded and recoverable in source.** A
  single worker scores deterministic 128-title pages from compact priors and
  positive anchors; taste-only changes reuse complete content generations and
  persisted priors. Jobs checkpoint phase/cursor/revisions, publish memory
  diagnostics, and yield at a page boundary when authoritative couch/playback
  activity begins. Pi two-cycle stability remains unproven.
- **YouTube More Like is conditional rather than a false rollout blocker.** It
  tries alternate meaningful-history seeds, then exact-channel fallback. Four
  thematic cards render `More Like`, four fallback cards render `More from …`,
  and insufficient honest supply records `not_applicable` and omits the rail.
  Required For You/Beyond supply and provenance purity still block serving.
- **VOD serving authorization and supervised evaluation are separate.** A
  complete deterministic cached generation may use the narrow
  `evidence_cold_start` basis when its only missing evidence is stratified
  explicit-rating/nDCG coverage. This is how approved Saved/meaningful-watch
  cold start remains possible without inventing ratings. Accounting,
  determinism, p95, concordance, and intrusion failures still block and retain
  last-good. The supervised promotion gate itself remains only an absolute
  minimum: it requires
  at least 15 eligible ratings/five folds, non-null nDCG, per-axis concordance
  at least 0.5 only where that axis has measurable pairs, low-low intrusion at
  most one third, complete
  accounting, deterministic replay, and cached p95 at most 250 ms. It has no
  accepted-baseline uplift/CI, reserve/calibration/teacher-cost, or worker-
  latency threshold. Treat `promotion_eligible` as supervised quality evidence,
  `serve_eligible` as operational authorization, and neither as the human couch
  verdict.

### Latest repository-recorded recommendation runtime snapshot

The newest home handoff records the Pi contained at `9425b1f` with:

```text
MANGO_VOD_RECS_V2=off
MANGO_YOUTUBE_RECS_V2=off
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

It records 1,096 preserved StoryDNA rows. Its final attempted Movies refresh
crossed the operator `MemoryHigh=1100M` boundary by about 2.2 MiB, changed the
catalog invocation, and did not complete cleanly; YouTube generated For
You/Beyond but no More Like reserve. Both domains and StoryDNA/frontier/TMDB
work were returned to `off`. These are dated runtime observations for
`9425b1f`, not evidence for `c8cfe72`. The current target bounds/reuses VOD work
and makes More Like conditional; both changes still require exact-target Pi
proof.

### Older objective playback/runtime evidence

- A historical home report passed gate-lite and 877 catalog tests, verified
  AIOStreams as the only configured **exported** VOD provider, and played the
  exact Alliance episode on one press on its recorded SHA. It did not prove the
  Pi-local direct MediaFusion trigger absent.
- A later full-couch report recorded The Internet's Own Boy starting in one
  attempt with roughly 5.9 s resolver TTFF and 11.8 s B-to-ready on that run,
  without the previously seen black → Detail → late-play sequence.
- Those reports also left full-gate, current recommendation v2, display sleep,
  physical controller cycles, target-TV quality/audio, and broad subjective UX
  proof open. They must not be promoted to current-HEAD verdicts.

See [tasks/RECOMMENDATIONS_HOME_PI_REPORT.md](tasks/RECOMMENDATIONS_HOME_PI_REPORT.md),
[tasks/FULL_COUCH_UX_HOME_ACCEPTANCE_REPORT.md](tasks/FULL_COUCH_UX_HOME_ACCEPTANCE_REPORT.md),
and [tasks/RECOMMENDATIONS_STORYDNA_BULK_WORK_AGENT_PROMPT.md](tasks/RECOMMENDATIONS_STORYDNA_BULK_WORK_AGENT_PROMPT.md).

## Runtime stack

```text
Raspberry Pi OS Desktop · X11/Openbox · launcher fixed at 1920x1080@60
├── Chromium kiosk / mango-ui-server       :3000
├── catalog-service                         :3020
│   ├── library/progress/playability/YouTube state
│   ├── Search, Detail, streams, play sessions
│   └── Reliability Center and recommendation jobs
├── AIOStreams                              :3035
├── AIOMetadata                             :3036
├── mpv + IPC                               foreground player
├── mango-tv-pad.py                         launcher/player input owner
├── orchestrator (optional voice)           WSS :8765
├── launcher voice HUD (loopback)           :8766
├── companion HTTPS PWA (optional voice)    LAN :3001
└── NexoTV (optional Live)                  :7000/:7001 family
```

The supported daily foregrounds are launcher and mpv. Kodi/Stremio artifacts
remain in legacy scripts, diagnostics, configuration, and research, but there
is no current executable automatic fallback path that should be promised to a
viewer. Idle health expects neither to be running.

## Browse and Search

| Feature | Current implementation |
|---------|------------------------|
| Surfaces | Search magnifier, Movies, TV Shows, Live, YouTube |
| Layout | Normal VOD rails use six posters; normal YouTube/landscape rails use four cards |
| Input | L/R change tabs; B selects; Y backs out; X is owned by the visible context |
| Home X | Advances only the current published recommendation/discovery slate; Continue, Saved, YouTube History, and YouTube Saved stay stable |
| Search X | Tap deletes one character; hold at least 600 ms clears |
| Search execution | Immediate local/cached results plus isolated explicit external VOD, unknown Live, YouTube, and optional structured-AI phases |
| Search persistence | Recents/selection/SafeSearch in `library.db`; YouTube query cache in `youtube.db`; bounded jobs in memory |
| Restoration | A versioned compact snapshot restores Search/Home, focus, and origin after Detail/playback |

Search does not autoplay, impersonate a chatbot, introduce a fifth browse tab,
or let a failed external phase erase usable local results. Detail:
[SEARCH.md](SEARCH.md).

## Playback and stream ladder

| Area | Current contract |
|------|------------------|
| Player | `pi5-x11-mpv-hifi`; mpv is the only supported daily player |
| Start | Idempotent asynchronous play session; accepted before foreground work |
| Resolve | Coalesced exact-title/episode single flight with a shared absolute deadline |
| Clean-empty recovery | Source/release defaults are initial automatic Movie/Episode Play plus two 1.2 s confirmation passes in the same exact-ID flight/deadline. Runtime knobs permit 0–3 attempts and 0–10 s for explicit rollback/experiments; record the loaded values |
| No resolve confirmation | Detail list, Live, picker refresh, 429, auth/configuration, permanent provider error, cancellation, invalidated work, expired deadline, or sibling episode |
| Stale cached transport | Auto play may invalidate a cached stream pool and perform one fresh resolve inside the same deadline when candidate errors classify as stale transport and at least 5 s remains |
| Candidate ladder | Candidate-local probe/launch failures fall through the bounded ladder; pipeline-fatal errors stop. This is distinct from provider resolve confirmation |
| Candidate policy | Capability/identity tiers are lexicographic; known-risky cannot outrank identity-safe smooth/unknown paths through cache or scalar bonuses |
| Foreground | Resolve and probe are display-neutral; launcher hides only after advancing media is proven |
| Failure | Original launcher/Detail remains authoritative; stale cleanup cannot stop a newer generation |
| Progress | One logical watch/progress session through retry, switch, Undo, and return |
| HUD | Clean startup; safe-area cinematic panel; elapsed/negative remaining; proven technical line; 4/6 s contextual feedback; minimal paused badge; delayed buffering; no false Live timeline |
| Streams | Five-choice 58%-height bottom drawer; current pinned first; best usable alternative focused; unavailable disabled; validation before explicit switch; revisioned X Undo |

### Resolver topology

AIOStreams is intended to be the sole **stream-capable VOD aggregate/path** in
Mango's exported addon graph. The full graph also includes Cinemeta,
AIOMetadata, Bharat Binge, and optional Live addons for their catalog, metadata,
or Live roles.
Torrentio, Comet, and optional MediaFusion are intended to be indexers behind
AIOStreams; Real-Debrid, TorBox, and Easynews are configured transports/services
behind it. The current catalog-service nevertheless retains an optional legacy
direct MediaFusion thin-pool supplement: when AIO returns at most one cacheable
stream and `MANGO_MEDIAFUSION_MANIFEST` or
`~/.config/mango/mediafusion.manifest` resolves to a URL, it can perform one
serial direct request (bounded to 8 s and the shared play deadline). A direct
MediaFusion manifest in the exported graph suppresses that supplement.

The latest reports proved no direct MediaFusion **exported addon**, but did not
prove that the Pi-local secret-file trigger was absent. Therefore “AIO-only
runtime fan-out” is **not yet proven**. The principled target is still one
aggregate; hardening must either remove the bypass or explicitly feature-gate,
diagnose, and accept its latency/security behavior.

Repository deployment deliberately does not overwrite AIOStreams `userData`.
The current `aiostreams-config.sh diff/apply` implementation is a hardening gap:
it exposes full state and `apply` leaves/prints fixed
`/tmp/aiostreams-put.json`. Do not run it from an agent until private temp,
cleanup, and redaction are implemented. Human Configure UI plus fixed-field
`verify` is the interim boundary. AIOMetadata's headless import has the same
class of unresolved issue: it leaves fixed `/tmp/aiometadata-save.json` and
prints the secret manifest URL. Keep both mutation helpers out of agent and
unattended flows until hardened; this is an operations-security blocker. The
current `pi-deploy.sh` nevertheless calls the AIOMetadata rail sync implicitly,
so the deploy wrapper itself is also blocked for unattended agents; Git-only is
the intended transport contract, not proof that this implementation is safe.

The latest recorded home snapshot had Torrentio and Comet contributing,
RD/TorBox/Easynews configured,
and the MediaFusion preset present but disabled because its manifest returned
404. That is a dated runtime finding, not a permanent configuration choice.

That same home report observed the separately exported Bharat Binge regional
catalog manifest returning HTTP 403. The deploy helper ensures the repository
URL is present; it does not prove the remote catalog healthy. Reverify it before
counting regional supply, and keep its outage distinct from AIO stream health.

### Quality boundary

The launcher always returns to 1080p60. Current hifi policy can prefer proven
4K SDR HEVC/REMUX paths, keeps 4K HDR/DV out of main/verified tiers and behind
smooth candidates in last resort, and retains smooth 1080p fallbacks when
providers supply them. It does not output supported native HDR. Older target-TV measurements demonstrated a usable
source-matched 4K SDR HEVC path, while X11/mpv HDR tone-mapping dropped too many
frames to ship as HDR. A Kodi/GBM HDR experiment proved hardware/display
feasibility but is parked because it is not integrated with Mango's HUD,
controller, progress, lifecycle, and security contracts.

Detail: [PLAYABILITY.md](PLAYABILITY.md) · [HARDWARE.md](HARDWARE.md).

## Mango-owned state

| Store | Ownership and durability |
|-------|--------------------------|
| `/etc/mango/library.db` | Durable Saved, history, finished, Fire/Water, feedback, attribution, current context, normalized YouTube history/import audit, recommendation state |
| `/etc/mango/progress.db` | Durable profile-exact Continue/resume and playback position |
| `/etc/mango/playability.db` | Durable verified-title/path evidence and rail pools; staged maintenance publishes atomically |
| `/etc/mango/youtube.db` | Rebuildable metadata, reservoirs, published generations, query cache, quota and refresh state |
| `/etc/mango/reliability/proofs.jsonl` | Local 30-day operator proof ledger |

The latest VOD recommender is Household-only whenever active (`shadow` or
`serve`). Existing personal-profile/mood rows remain durable and recoverable,
but current ranking code does not read them. `off` disables VOD recommendations;
it does not revive legacy ranking. Stremio export is addon-manifest
configuration, not user-library sync.

Never treat database deletion, cache/history clearing, or credential rewriting
as routine deploy or repair.

## Fire/Water and VOD recommendation v2

| Mode | Public behavior |
|------|-----------------|
| `off` | VOD recommendations disabled; no For You rail and no latest-architecture refresh. Continue, Saved, and curated rails remain |
| `shadow` | Build and diagnose only the latest Household Story Frontier; no For You rail is public |
| `serve` | Expose only a promotion-eligible published Household Story Frontier generation. If none exists, For You is absent; there is no legacy fallback |

The following table is the **serve contract**. The latest recorded Pi snapshot
predates this latest-only implementation, so its visible rail is historical.

| Area | V2 serve implementation |
|------|-------------------------|
| Rating | Fire and Water each require an exact 0–5 value in 0.5 steps; movies are title-level and series are show-level |
| Identity | Household-only served experience; preserved personal data remains dormant |
| Content model | Always `vod-content-profile-v2`: deterministic metadata/rule profiles plus immutable compatible StoryDNA overlays |
| AI boundary | Stateless content teacher sees canonical title evidence only; no Household/companion state and no score/rank/publish authority |
| Ranker | Deterministic local uncertainty-aware story graph with up to three positive taste threads |
| Signals | Fire/Water dominates; Saved and meaningful viewing support sparse/cold start; ratings ≤2.5 do not create thematic negative propagation |
| Eligibility | Current verified-playable, poster-bearing titles only; exact rated, Saved, meaningful watch, hidden, blocked, and Not-for-me are excluded |
| Rail | One six-card For You rail per Movies/TV tab after Continue/Saved; allocation 6, 3+3, or 2+2+2 across active threads |
| Removed behavior | No executable 4/1/1 buckets, forced surprise, bridge, semantic-hash v4, cosine/KNN/MMR, cooled rewatch lane, or strict-only publication path |
| Serving | Atomic current/previous generations, cached slates, stale/tamper-safe opaque attribution, last-good fallback, cache-only X response with separately observable asynchronous low-water recovery |
| Rollout | `MANGO_VOD_RECS_V2=off\|shadow\|serve`, independent of YouTube |

### Progressive profile source state

`vod-content-profile-v2` is the only executable content-profile architecture.
The compiler builds factual metadata and tightly controlled rule edges locally,
then applies any compatible StoryDNA document as an optional immutable overlay.
A profile serves only when it contains a content-bearing family, at
least two substantive families, and at least 1.5 total substantive confidence;
sparse/unrankable profiles remain excluded.

`MANGO_STORY_DNA_WORKER_MODE=off|frontier` defaults to `off`. The opt-in
frontier selects positive/implicit anchors, thread shortages, reserve-boundary
uncertainty, and a two-title stable audit. Source defaults cap it at 12 titles
per media type/day and 96 titles total per rolling 30 days; provider calls batch
up to 4 titles, with 15 minutes/run, three
attempts, and a 15-minute coalescing delay. Corresponding overrides are
`MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE`,
`MANGO_STORY_DNA_FRONTIER_ROLLING_30D`, `MANGO_STORY_DNA_FRONTIER_BATCH`,
`MANGO_STORY_DNA_FRONTIER_RUN_MS`, and
`MANGO_STORY_DNA_FRONTIER_COALESCE_MS`.

Exact-ID TMDB enrichment is credential-gated and may be disabled with
`MANGO_TMDB_METADATA=off`; credentials come from `MANGO_TMDB_API_TOKEN`,
`MANGO_TMDB_API_KEY`, or the device-owned
`MANGO_TMDB_API_KEY_FILE` (default `/etc/mango/tmdb.key`).
`MANGO_TMDB_REQUESTS_PER_SECOND` defaults to and is clamped at five/second
(range 1–5). The newest Pi report has these provider controls off; target-SHA
runtime readback remains **DEFERRED**.

### Open promotion work

- Re-prove migrations 15–17 and code rollback on the Pi against preserved
  runtime state. Focused Mac upgrade/preservation/flags-off rollback tests pass.
  Add remaining frontier-specific lease/retry/rolling-window/coalescing/
  concurrency/restart and TMDB failure/rate/credential/TV-series integration
  coverage before enabling the worker.
- Complete corpus/exclusion accounting and refresh/retry backlog.
- Pass the implemented absolute evaluator, accounting/replay, cached p95,
  restart/offline/resource, migration, and shadow-diff gates. Before calling
  promotion a quality win, add or deliberately approve a baseline/uplift and
  uncertainty policy; the deleted comparison evaluator no longer supplies it.
- Promote shadow → serve only after those pass, then obtain a human relevance,
  diversity, familiarity, and surprise verdict. Operational rollback disables
  exposure; reviewed Git rollback restores older code without deleting data.
- Measure progressive coverage and teacher cost before deciding whether the
  still-absent offline bulk artifact/importer is required.

Detail: [FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md).

## Native YouTube

### Base

- Official Data API for metadata, search, subscriptions, and refresh.
- Google device OAuth from the companion; operator-owned token at
  `/etc/mango/youtube-auth.json` mode 0600.
- Safe Takeout ZIP/JSON/HTML normalization into durable local history; raw
  upload data is discarded after import.
- `yt-dlp` resolves playback URLs for mpv; cached playback does not require a
  fresh Data API metadata call.
- Voice searches/opens; **B** plays.

### Recommendation v2 source

| Mode | Public behavior |
|------|-----------------|
| `off` | YouTube recommendation acquisition/generation disabled; no recommendation rails. History and Saved utility rails remain when populated |
| `shadow` | Build and diagnose only the authoritative Household v2 generation; recommendation rails remain hidden |
| `serve` | Expose only the authoritative Household v2 generation; there is no legacy recommendation fallback |

The latest recorded Pi mode was `off` under older code. The following rails
describe current `serve`; the dated visible UI is not evidence for this contract.

| Rail | Contract |
|------|----------|
| For You | 60/40 decayed qualifying history/subscription affinity, renormalized when one side is absent |
| Beyond Your Subscriptions | Topic/channel discovery excluding subscribed creators |
| More Like… | Daily-stable recent meaningful-watch seed |
| History | Stable chronological normalized history |
| Saved | Stable explicit Saved; zero recommendation weight |
| From Your Subscriptions | Conditional newest unwatched authoritative uploads |
| Live Now | Conditional currently live subscribed-channel streams only |

Only authoritative complete subscription snapshots and qualifying
Takeout/Mango-local history may create recommendation provenance. Search,
generic cache, Saved, profiles, mood, VOD, companion state, AI catalogs, and
global charts cannot leak into ranking. Normal rows contain four cards; Live
Now contains one to four. Home and X use published local reservoirs without
quota/network work; History/Saved never shuffle.

`MANGO_YOUTUBE_RECS_V2=off|shadow|serve` controls this independently. Source-
complete does not mean served or couch-observed. The current non-Household
`off` ownership mismatch above must be fixed before rollback is accepted.
Public API routes cannot reproduce the proprietary native YouTube home feed.

Detail: [YOUTUBE.md](YOUTUBE.md).

## Live TV

Live is optional and excluded from default gates. Current browse configuration
is four thin source-qualified rails: cricket, Formula 1/racing, news, and
cartoons. The larger AREA69/NexoTV index supports Search/voice, not indiscriminate
Home injection. Browse is cache-first; a failed/empty rebuild never overwrites
a non-empty last-good cache. Per-channel health is credential-safe and Live
uses a separate immediate playback path with no VOD clean-empty retry.

Detail: [LIVE_TV.md](LIVE_TV.md).

## Voice and companion

| Capability | Current state |
|------------|---------------|
| Input | Phone text and PTT; Deepgram `nova-3` with Hinglish support for voice |
| Role | Search, clarify, curate, remember, save, and open Detail; never autoplay |
| TV/phone coherence | Shared current tab/title/playing context plus structured phone picks and launcher HUD action copy |
| Memory | Local profile/journal, completed-watch signals, 90-day rollup, compiled notes, nightly consolidation |
| Output | Text on phone; no TTS/speaking lock |
| Network trust | TLS and exact catalog capability allowlist, but no per-device client auth/pairing; any reachable trusted-LAN client can submit companion/WSS actions |
| Open proof | Full current-revision V1–V12 phone/voice/memory couch matrix |

Detail: [VOICE.md](VOICE.md) · [AI_LAYER.md](AI_LAYER.md).

## Playability grow and nightly maintenance

- Active rails target fresh `+20` new-to-rail verified titles per pass. This is
  an operator SLA target, not a reason to discard otherwise usable completed
  work unless strict mode is explicitly selected.
- Grow writes a work DB; publish is atomic. Failed, aborted, or crashed runs
  retain the previous visible snapshot.
- Theme gates, orphan repair, overlap caps, rejection memory, and runtime
  source-yield weights constrain candidate pollution.
- The current verified corpus is materially larger than old June snapshots;
  do not copy old 1,054-title counts into current status.
- Remaining hardening is repeated unattended completion and better yield on
  thin TV/India sources—not merely another one-off top-up.

The 03:00 playability/recommendation/YouTube/proof timer and 06:00 companion
timer are persistent calendar timers. A missed event can run after boot, subject
to playback/idle/overlap guards. There is no separate uncontrolled daytime
retry watcher.

Detail: [PLAYABILITY.md](PLAYABILITY.md) · [OPS.md](OPS.md).

## Reliability and controller

Reliability Center evaluates launcher, catalog, controller, library,
playability/rail growth, Live, YouTube, optional voice, processes, locks,
maintenance, and recent proof. It records Green/Yellow/Red JSONL evidence with
30-day retention and samples served titles. Home remains quiet except for a
degraded Settings badge.

Current implementation diverges from the optional-Live product contract:
`live_config_ready=false` becomes a red component and therefore overall red.
Treat this as a model defect, not proof that optional Live must be configured.

Safe repair is idle-only and state-preserving. The controller architecture is
a root BlueZ link supervisor plus a user evdev router; normal controller power
on—not pairing mode—is the happy path. The backend exposes
`controller_repair`, but the current launcher Settings renderer does not expose
the corresponding action; docs must call it API/backend-only until code is
reconciled. Five physical normal-wake cycles remain an acceptance gate.

Detail: [RELIABILITY.md](RELIABILITY.md) · [OPS.md](OPS.md).

## Display sleep gap

Current source's display wake helper disables screensaver/DPMS and forces the
panel on. A home inspection nevertheless found Xorg Standby/Suspend/Off values
at 600 seconds. Neither behavior is the intended product.

Locked replacement:

| Setting | Contract |
|---------|----------|
| Presets | Off · 15 min · **30 min default** · 60 min · 2 h |
| Activity | Reset only by D-pad and companion activity |
| Inhibit | Never sleep while mpv is playing |
| Sleep | DPMS Off + HDMI-CEC standby |
| Wake | DPMS On + HDMI-CEC power-on, preserving correct foreground/focus |

Implementation and physical Pi/TV proof are **DEFERRED**. Accidental 600-second
blanking must not be documented as the happy path.

## Deployment and state boundary

- Mac repository is source authority; Pi deploy is Git pull only. Never rsync,
  scp, or hand-copy repository files.
- Use SSH alias `mango`; use `mango-mdns`/`mango.local` as discovery fallback.
  An observed LAN IP is not durable documentation.
- Deploy restarts the Mango stack and can stop mpv/indexers. Require an idle
  couch and inventory dirty Pi files before pulling; preserve operator-owned
  changes and stop for direction rather than stash/reset them by default.
- Repository deploy does not overwrite AIOStreams `userData`, seed imports, or
  runtime databases. However, the current wrapper can implicitly mutate
  AIOMetadata config/credentials/export and is blocked for unattended agents.
- `pi-deploy.sh`/`pi-exec-gate.sh` do not enforce or pin the required branch/SHA.
  Freshly fetch and compare branch, origin, Mac and post-deploy Pi hashes; fix the
  helpers before agent automation.
- Root controller policy changes only when explicitly installed with
  `MANGO_CONTROLLER_LINK_INSTALL=1`.

Detail: [DEPLOY.md](DEPLOY.md) · [DEPLOY-SPLIT-MACHINE.md](DEPLOY-SPLIT-MACHINE.md).

## Current priority queue

1. Fix and test deploy branch/SHA enforcement plus the implicit AIOMetadata
   mutation/security path; then deploy/prove one exact revision.
2. Fix the optional-Live reliability mismatch; the playability schema marker is
   reconciled in the target.
3. Deploy `c8cfe72` through the reviewed exact-SHA manual path; update the
   preserved operator drop-in to 1280M/1536M and prove two complete VOD shadow
   cycles meet the bounded memory, invocation, accounting, latency, and
   preemption gates before any promotion.
4. Prove YouTube off ownership on the Pi, refresh authoritative inputs in
   shadow, then promote YouTube independently.
5. Implement and prove intentional display sleep/CEC.
6. Close resolver/provider topology, repeated grow, and nightly proof gaps.
7. Close five-cycle controller reconnect and full phone/TV couch acceptance.
8. Publish the final target-TV SDR/HDR/audio support boundary.
9. Build the no-SSH first-boot wizard and merge only after release acceptance.

## Verification

### Source/Mac

Run the subsystem's documented local tests. For catalog-service changes:

```bash
cd src/catalog-service
npm test
```

Build launcher or companion when their source changes. Source tests do not
replace Pi proof.

### Pi baseline

```bash
cd ~/mango
git -C ~/mango rev-parse HEAD
git -C ~/mango status --short
grep -E '^(export[[:space:]]+)?(MANGO_VOD_RECS_V2|MANGO_YOUTUBE_RECS_V2|MANGO_STORY_DNA_WORKER_MODE|MANGO_TMDB_METADATA)=' ~/.config/mango/voice.env 2>/dev/null || true
bash scripts/pi-pre-couch-gate.sh
bash scripts/m6-ship/gate-m6-reliability-proof.sh
```

### Release/full

```bash
cd ~/mango
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
bash scripts/m6-ship/gate-m6-search-smoke.sh
bash scripts/m6-ship/gate-m6-youtube-smoke.sh
bash scripts/m6-ship/gate-m6-ux-smoke.sh
bash scripts/m5-voice/ai/gate-m5-companion-couch.sh
bash scripts/m5-voice/ai/gate-m5-companion-memory.sh
bash scripts/m6-ship/gate-m6-controller-reconnect.sh
```

Then perform [COUCH_TEST.md](COUCH_TEST.md). Screenshots prove pixels; the human
owns readability, focus feel, physical controller/CEC/audio behavior, perceived
latency, and recommendation quality.
