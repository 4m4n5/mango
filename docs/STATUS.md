# mango — current status

**Branch:** `feat/native-experience` · **Roadmap:** [ROADMAP.md](ROADMAP.md) · **Acceptance:** [COUCH_TEST.md](COUCH_TEST.md)

Latest recorded Pi deployment: **2026-08-12**,
`244812b6bcad3eeebfbc6c222f9435c658c759c8`. The runtime line includes
`0c030d8` playback/shuffle hardening plus `244812b`'s secret-safe transactional
AIOStreams TVDB setup. Playability migration 19 applied with `quick_check` OK: 77 bare
IMDb identities that were verified as both movie and series became 154 targeted
stale typed rows, with zero verified dual-type conflicts afterward. The Mac and
Pi catalog suites passed 1,022/1,022; Pi playback-SSOT and launcher/UX gates
passed. Reliability is usable-yellow and its served-card resolver sample found
16/32 legacy proof-v1 cards without a current stream response. Full N3c reached
33/36: all 18 movie samples and 15/18 series samples played; the three series
misses had zero candidate attempts. A bounded launcher-path check played My Next
Guest S1E1 and Dead Silent. The later Alliance audit proved E37 and E44 exact-main
playable, while E36, E38-E43, and E45-E48 remained current source misses. Adding
and validating TVDB corrected AIO's E41-E43 air dates but did not add an accepted
stream. The monitor was off,
so the whole-product pre-couch gate and human couch verdict remain **DEFERRED**.
Use `git status`, `git rev-parse HEAD`, and the Pi commands below before acting.

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
| Native launcher, Detail, Search, D-pad | Complete | Final SHA deployed; standard pre-couch passed at `2a93582`, with final targeted smoke after the cache/Reliability-only follow-ups | Final exact-revision whole-product couch pass |
| Native mpv playback | Complete; proof-v2 identity and exact-episode failure tracking at `aac293d` | My Next Guest and Dead Silent played; Alliance E37/E44 reached exact-main proof-v2, while the other E36+ episodes had no accepted current source result after TVDB correction | Target-TV/audio proof; proof-v2 Home admission policy after natural legacy renewal |
| HUD and Streams drawer | Complete | Local fixture/source gates; home-agent deployment work recorded | Current exact-SHA screenshots and 4K dropped-frame/no-regression couch pass |
| Mango library and Fire/Water input | Canonical Saved placement and tab-only library migration 18; ratings remain complete | Final Pi migration/readback passed: 12 misclassified tabs repaired to 0, user-state keys/counts preserved, Movies Saved 6 / Series Saved 8 / wrong-tab 0 | Human Dune-from-TV-Search placement and physical UI check |
| VOD recommendations | `fb20baa` progressive profiles + Household Story Frontier + Browse v3 + StoryDNA Related; all historical data preserved | Pi serves complete 5,930/3,974 accounting with 720/675 rank reserves. Two active atomic browse reservoirs contain 19,950 candidate rows. Forty X presses per tab yielded 2,121/1,897 unique cards at p95 121.9/119.5 ms with global dedupe and zero provider/rank work | Human For You/category/Related verdict and physical focus/picture/audio checks |
| Native YouTube base | Complete | Previously deployed/Pi-gated | Current exact-SHA revalidation and account-specific proof |
| YouTube recommendations | `youtube-household-v2.7`: quality-gated reserves up to 512 per rail and independent weighted cache-only X | Final Pi generation 22: 1,441 candidates; reserves 512 For You / 405 Subscriptions / 274 Beyond / 250 More Like / 0 Live; 55 subscriptions; 50 X p50 58.83 ms, p95 174.66 ms with quota/generation flat and History stable | Human relevance, perceived repetition, focus/Back, offline, picture/audio observation |
| Voice/phone companion | Complete for trusted-LAN development contract | Automated corpus/memory/UX gates on earlier revisions; partial couch work | Full V1–V12/current coherence plus per-device client auth/pairing before appliance release |
| Reliability Center/nightly proof | Implemented; sanitized launcher terminal outcomes and proof-version/type-conflict/episode counts added at `275ceb2` | Final Pi state is usable-yellow; terminal fixture recorded 2 playing and 2 `resolve/no_stream` failures, and the served-card sample found 16/32 legacy proof-v1 misses | Three clean nightly proofs, intentionally-disabled-Live policy, controller-action UI mismatch |
| Controller reconnect | Source-complete | Automated gate exists; normal-wake behavior partially exercised | Five physical power-on reconnect cycles without pairing mode |
| Display sleep | **Not implemented** | Recorded Pi still exposed accidental Xorg 600-second DPMS values | Implement locked Settings/idle/mpv/DPMS/CEC contract and prove on TV |
| Library grow | Complete, hardening | Ordinary nightly timer no longer enables the non-causal source-hitrate benchmark; schema 19 and the fixed 30-second user resolve budget were read back on Pi | Three clean unattended nights, causal thin-rail yield, then evidence-backed source expansion |
| 4K SDR / HDR | 4K SDR path implemented; native HDR unsupported | Older experiment proved smooth source-matched 4K SDR HEVC; HDR/X11 was not usable | Final-TV SDR/audio matrix; either credible HDR integration or explicit no-HDR ship boundary |
| Deployment | Git-only contract; current wrappers unsafe for unattended agents | Older deployments exist | Enforce/pin branch+SHA, fail closed on fetch, remove/default-disable and harden implicit AIOMetadata mutation |
| First boot | Not implemented | Operator-installed system | M6.4 no-SSH installer/wizard |

## Recorded source and Pi baseline

### Source audit

- Playback-trust hardening is source-complete at `aac293d`: immutable title/year
  identity reaches background resolution, exact metadata ID/type/year is fenced,
  fallback or identity-conflicted playback cannot certify, preserved failures
  cannot promote, and later-series episodes own independent failure/retry state.
  Launcher terminal telemetry is bounded and identity-free. The release keeps
  the 120-second total wall and 30-second user resolver budget; it does not claim
  strict proof-v2 Home admission or a permanent upstream playback guarantee.

- Deep weighted Shuffle is source-complete: Browse v3 no longer applies the
  120-title growth cap to eligibility or serving, exact typed evidence can add
  bounded source-less thematic membership, and all discovery selection uses a
  deterministic 95% relevance / 5% uniform sampler. For You deals from the
  complete fit-qualified reserve per epoch and retains only current plus four
  rendered slates. Existing APIs, databases, active/previous pointers, rail
  order, Continue, and Saved are unchanged. Exact-SHA Pi publication, latency,
  reachability, automated gates, and human couch proof remain distinct until
  recorded for the deployed revision.

- `fb20baa344daa37585141096e55f47bedb87de0e` is the historical 2026-08-06
  fully gated recommendation target. It preserves the progressive Story Frontier and all
  historical database rows/schemas while adding immutable verified browse
  reservoirs, atomic tab deals, calibrated weighted sampling, and bounded
  StoryDNA-first Related matching.
- VOD retains deterministic `vod-content-profile-v2`, compatible immutable
  StoryDNA overlays, local Household taste/ranking, full-corpus generations,
  cached six-card slates, optional exact-ID TMDB, and an opt-in bounded frontier.
  It removes semantic-hash v4, cosine/KNN/MMR, the legacy rank worker/snapshot
  fallback, strict complete-StoryDNA publication, corpus-wide teacher backfill,
  and the old comparison evaluator.
- YouTube retains only authoritative OAuth-subscription/Takeout acquisition,
  provenance-gated atomic v2 generations, and cached recommendation rails. It
  removes Popular, Fresh Finds, Because You Watched, profile/mood/companion
  scoring, generic reservoirs, AI Home rails, chart/legacy-live acquisition,
  and destructive fresh-start/reset APIs. Search and user-created AI catalog
  seeds remain separate and cannot establish recommendation provenance.
- At final release SHA `04171bb`, the catalog-service suite passes `969/969`.
  The launcher and Companion production builds passed on the feature release;
  final follow-ups touch only catalog diagnostics/cache/Reliability code. The
  final Pi also passed targeted library and YouTube smoke plus one real Movie
  and Series lite play. Historical target `fb20baa` passed all 87 launcher
  deterministic tests and both launcher and
  Companion production builds pass on the same exact revision. The
  cleanup intentionally removed a large legacy implementation/test surface, so
  Pi migration/state-preservation proof, mode-aware gates, and generated reserve
  health pass. Human quality remains mandatory rather than inferred from test
  count alone.
- Migrations 15–17 retain the additive progressive/overlay/runtime schema, and
  playability migration 15 narrows corpus invalidation to semantic/eligibility
  changes. Focused runtime proof is still needed for
  upgrade/preservation/rollback, frontier lease/retry/rolling-window/
  coalescing/concurrency/restart behavior, TMDB failure/rate/credential/series
  cases, and exact Pi activation/staleness behavior.
- Library migration 18 changes only canonical `library_items.tab` placement.
  Final Pi readback repaired 12 stale classifications to zero, preserved the
  audited user-state keys/counts, and found Movies Saved 6 / Series Saved 8 /
  wrong-tab 0. The physical Dune-from-TV-Search check remains **DEFERRED**.
- The orphaned orchestrator `/recommendations/enrich` v4 compatibility route
  and implementation are removed. Only the strict content-only StoryDNA
  teacher endpoint remains; it is off for the current couch round.

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
- **Routine state backup is fail-closed and set-based.**
  `scripts/m6-ship/backup-library-state.sh` creates atomic, verified SQLite
  online-backup sets for progress, library, playability, and YouTube state. It
  publishes only after every present database passes `quick_check`, retains the
  newest three complete sets, and has no live-WAL plain-copy fallback.
- **Optional Live currently poisons overall reliability.** Product policy makes
  Live optional and excludes it from default gates, but the Reliability model
  marks `live_config_ready=false` red and folds that component into overall red.
  There is no intentionally-disabled-Live regression test. Until fixed, a
  Live-off box can be falsely reported as not couch-ready.
- **Resolver DTO sanitization is incomplete but couch compatibility failures are
  bounded.** At `2a93582`, `POST /play` converts internal ladder details to
  fixed aggregate counts/timing/categories and gate output allowlists that
  projection instead of printing response bodies. URL-less nested AIO error rows are
  now normalized into credential-free category placeholders before URL
  validation, so they participate in retry/backoff accounting. However, loopback
  `/stream` diagnostics can still expose raw addon fetch error details even
  though the launcher does not render them and the companion proxy blocks the
  route. Treat those DTOs as operator-only; sanitize them before widening access.
- **Recommendation source/runtime blockers remain closed through `04171bb`.** YouTube off now
  returns exact active-profile utilities without a false 409; VOD shadow and
  serve both read exact Household Saved; off/shadow cannot advance a public
  recommendation epoch but can honestly reshuffle cached category rails; and
  diagnostics distinguish newest rows from active/previous,
  promotion, and public pointers. Pi serve proof now passes for both domains.
- **Heavy VOD refresh ownership is now bounded and recoverable in source.** A
  single worker scores deterministic 128-title pages from compact priors and
  positive anchors; taste-only changes reuse complete content generations and
  persisted priors. Jobs checkpoint phase/cursor/revisions, publish memory
  diagnostics, and yield at a page boundary when authoritative couch/playback
  activity begins. Two-cycle Pi stability, preemption, liveness, and cache-only
  serving passed at the deployed target under 1280M/1536M limits.
- **YouTube More Like is conditional rather than a false rollout blocker.**
  Current source tries up to ten daily-stable official-history seeds with 50
  results each, seeks at least eight contributing topics, and continues its
  bounded quality-gated fill toward the 512-item cap. Exact-channel work is
  only a sub-four fallback. Four thematic cards render `More Like`, four
  fallback cards render `More from …`, and insufficient honest supply records
  `not_applicable` and omits the rail. No named recommendation row is mandatory
  on a thin account; every row that does render must still satisfy its complete
  four-card, provenance, eligibility, and dedupe contract.
- **YouTube last-good failure semantics are source-complete.** Incomplete
  authoritative subscription/discovery/Live requests and atomic publication
  failures retain the prior generation with a fixed stale reason; non-Live
  rows remain bound to that published membership snapshot and Live stays
  current-membership/TTL fenced. The clean 90-second acquisition wall discards
  the late response and may publish earlier eligible work instead of inventing
  a source failure. The final Pi completed every v2.7 refresh phase and
  published generation 22; forced Pi failure/last-good retention remains
  **DEFERRED** rather than inferred from that successful run.
- **VOD serving authorization and supervised evaluation are separate.** A
  complete deterministic cached generation may use the narrow
  `evidence_cold_start` basis when its only missing evidence is stratified
  explicit-rating/nDCG coverage. This is how approved Saved/meaningful-watch
  cold start remains possible without inventing ratings. Accounting,
  determinism, p95, concordance, and intrusion failures still block and retain
  last-good. The supervised promotion gate itself remains only an absolute
  minimum: it requires
  at least 15 eligible ratings/five folds, non-null nDCG, per-axis concordance
  at least 0.5 only where that axis has measurable same-fold strong-vs-lower-
  preference pairs, true-negative (`Fire<1` and `Water<1`) intrusion at
  most one third, complete
  accounting, deterministic replay, and cached p95 at most 250 ms. It has no
  accepted-baseline uplift/CI, reserve/calibration/teacher-cost, or worker-
  latency threshold. Treat `promotion_eligible` as supervised quality evidence,
  `serve_eligible` as operational authorization, and neither as the human couch
  verdict.

### Prior 2026-08-11 Pi deployment

The Pi was read back at
`04171bb1c771f5fc713d192e50e0fc79e966c3cc` after a Git-only exact-SHA
fast-forward and controlled restart. The verified pre-migration online backup
set is
`/home/aman/.local/share/mango/backups/state/state-20260811T210222.463866Z`.
Library migration 18, YouTube migration 17, playability migration 17, and
progress migration 2 all applied; all four live databases passed
`quick_check`. The 12 pre-existing noncanonical library tabs became zero while
the audited Saved/watch/rating/profile keys and counts remained unchanged.

YouTube v2.7 published generation 22 with 1,441 candidates and 55 authoritative
subscriptions. Published reserves were 512 For You, 405 From Subscriptions,
274 Beyond, 250 More Like, and 0 Live. The protected interactive Search reserve
remained 25 calls. Fifty cached X requests held generation and quota counters
flat, preserved History, returned p50 58.83 ms / p95 174.66 ms, and sampled
without duplicates inside a slate. Cross-shuffle repeats are expected; Saved
was absent in this runtime snapshot, so stability was not fabricated.

The catalog suite passed 969/969. The standard pre-couch gate passed at
`2a93582`; the two later commits change only cached YouTube reads and active-rail
Reliability accounting, after which targeted library/YouTube smoke and real
Movie + Series lite plays passed at final SHA. The first full N3c attempt
reached 31/36 and failed; it was stopped and not rerun by user direction. Final
Reliability was `ok=true` yellow with only proof freshness and rail growth
yellow; all core components were green and the Library false-yellow was fixed.
No full-gate PASS, physical-TV, controller, audio, CEC, or subjective
recommendation verdict is inferred.

### Historical 2026-08-06 fully gated recommendation snapshot

The Pi was deployed at executable target
`fb20baa344daa37585141096e55f47bedb87de0e` with:

```text
MANGO_VOD_RECS_V2=serve
MANGO_VOD_BROWSE_V3=serve
MANGO_YOUTUBE_RECS_V2=serve
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

Library and playability schemas are both 17. All 1,096 historical StoryDNA
documents remain stored; 1,088 identity/evidence-compatible overlays attach to
the current compiler-v2 profiles and eight incompatible artifacts remain
detached and diagnosable. Movies generation 173 accounts for 720 ranked + 5,210
excluded = 5,930 verified titles; TV generation 174 accounts for 675 + 3,299 =
3,974. Both active/public generations use the honest `evidence_cold_start`
basis because only two Movies and one TV evaluation labels are currently
eligible; no rating was fabricated.

Browse v3 has two active and two previous tab deals, two ready reservoirs,
19,950 candidate rows, and 9,992 trusted memberships. Forty exact-SHA X presses
per tab produced 2,121 unique Movies cards and 1,897 unique TV cards, preserved
ordinary reload state, globally deduplicated every page, and caused zero
provider/rank work. Service p95 was 121.9 ms Movies and 119.5 ms TV.

YouTube generation 16 is Ready for channel `Aman` in `IN`/`en`, with 55
authoritative subscriptions plus 2,872 normalized Takeout events covering
2,548 unique videos and zero Mango-local ranking anchors. Reserves are
120 For You / 80 Beyond / 103 More Like / 120 From Subscriptions; Live is empty.
Six distinct seeds all contributed to More Like, the visible hand used four
distinct seed provenances, and no channel fallback or acquisition failure was
needed. The refresh used 20 Search-bucket calls (6 More Like, 6 Beyond, 8 live
probes), leaving 60/100 for the day and 35 background calls after the interactive
reserve. Five X calls measured p95 212.2 ms, changed More Like every time, held
History/Saved stable, preserved global dedupe, and changed no generation, API,
or quota counter.

The catalog suite passes locally (`918`) and the Pi gate's source-bound slice
passes (`530`); the launcher suite (`87`) and production builds pass. The
standard exact-target pre-couch gate passes after the existing display-wake
helper restores Monitor On, including lite Movie/TV playback, voice, Companion,
streams, UX smoke, and playback policy. Reliability remains yellow because five
curated VOD rails are thin, the last nightly growth proof was unhealthy, and
four of 32 served-title probes are broken; these warnings are not attributed to
the recommendation refresh. Catalog is stable with no restart; idle RSS is
roughly 160–190 MiB and the final gate observed more than 5 GiB available RAM.
Root disk is 35% used after the state-preserving backup-retention repair; no
backup or user data was deleted by this rollout.
Human relevance, screenshots, focus/Back, and target-TV picture/audio judgment
remain pending.

### Historical later read-only YouTube runtime observation

The Pi was subsequently read at `4a175197` with v2.6 generation 21 active:
`candidate_count=480`, four 120-title For You/Beyond/More Like/Subscriptions
reserves, 999 active provenance rows, 55 authoritative subscriptions, and 2,548
Takeout anchors. This supersedes generation 16 only as the newest observed
YouTube state. No full gate, couch verdict, or v2.7 behavior is inferred from
that read-only snapshot; `fb20baa` remains the last fully gated proof above.

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
| Home X | VOD Browse v3 advances every visible rail atomically; YouTube advances recommendation/discovery rails while History and Saved stay stable |
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
| HUD | Clean startup; translucent floating card; stable title; always-on volume; time/progress track; ↑/A language pills; 4/6 s feedback; minimal paused badge; delayed buffering; no false Live timeline |
| Streams | Five-choice inset floating sheet; current pinned first; best usable alternative focused; unavailable disabled; validation before explicit switch; revisioned X Undo |

**Runtime profile source of truth:** on the Pi, run
`bash scripts/m6-ship/set-playback-engine.sh status`; the supported daily profile
is `mpv-hifi`. Repository prose and environment-file inspection are not a
substitute for that runtime readback.

### Resolver topology

AIOStreams is intended to be the sole **stream-capable VOD aggregate/path** in
Mango's exported addon graph. The full graph also includes Cinemeta,
AIOMetadata, Bharat Binge, and optional Live addons for their catalog, metadata,
or Live roles.
Torrentio, Comet, and MediaFusion are intended to be indexers behind
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
`aiostreams-config.sh diff/apply/enable-mediafusion/set-tvdb-key` now keeps state in private
temporary files, hides values/responses, performs fixed-field readback, and
rolls back the original user object on policy failure. `get` remains an explicit
secret-bearing export and must not be logged. AIOMetadata's headless import has the same
class of unresolved issue: it leaves fixed `/tmp/aiometadata-save.json` and
prints the secret manifest URL. Keep that mutation helper out of agent and
unattended flows until hardened; the AIO half is closed but AIOMetadata remains
an operations-security blocker. The
current `pi-deploy.sh` nevertheless calls the AIOMetadata rail sync implicitly,
so the deploy wrapper itself is also blocked for unattended agents; Git-only is
the intended transport contract, not proof that this implementation is safe.

Before the current MediaFusion repair, the home snapshot had Torrentio and
Comet contributing, RD/TorBox/Easynews configured, and an expired secret
MediaFusion override returning 404. Current runtime enablement must be recorded
only after the transactional base-integration write and causal Pi readback.

At `244812b`, AIOStreams 2.32.1 validated the operator-provided TVDB key during
its full-object PUT, persisted it in Pi-owned `userData`, and matched the exact
hidden value on readback; subsequent Alliance requests emitted zero missing-key
warnings. The TVDB-backed context corrected E41-E43 to July 31/August 1/August 2
and changed the matched title to `Alliance (2026)`. A fresh E36-E48 search and
Mango-facing matrix still accepted only E37 and E44. The rerun M4 stream gate
passed with the expected soft E36 warning; one initial Breaking Bad transport
failure recovered immediately and must not be counted as a clean first-pass gate.

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

The following table is the **serve contract**. The final Pi deployment runs the
latest-only implementation; current automated proof does not replace its still
open human relevance verdict.

| Area | V2 serve implementation |
|------|-------------------------|
| Rating | Fire and Water each require an exact 0–5 value in 0.5 steps; movies are title-level and series are show-level |
| Identity | Household-only served experience; preserved personal data remains dormant |
| Content model | Always `vod-content-profile-v2`: deterministic metadata/rule profiles plus immutable compatible StoryDNA overlays |
| AI boundary | Stateless content teacher sees canonical title evidence only; no Household/companion state and no score/rank/publish authority |
| Ranker | Deterministic local uncertainty-aware story graph with up to three positive taste threads |
| Signals | Fire/Water dominates; Saved and meaningful viewing support sparse/cold start; `<1` is negative, `1–2` is neutral, and `>2` contributes quadratically increasing positive evidence. Negative ratings exclude the exact title without becoming broad thematic vetoes |
| Eligibility | Current verified-playable, poster-bearing titles only; exact rated, Saved, meaningful watch, hidden, blocked, and Not-for-me are excluded |
| Rail | One six-card For You rail per Movies/TV tab after Continue/Saved; allocation 6, 3+3, or 2+2+2 across active threads |
| Removed behavior | No executable 4/1/1 buckets, forced surprise, bridge, semantic-hash v4, cosine/KNN/MMR, cooled rewatch lane, or strict-only publication path |
| Serving | Atomic current/previous generations, cached slates, stale/tamper-safe opaque attribution, last-good fallback, cache-only X response with separately observable asynchronous low-water recovery |
| Rollout | `MANGO_VOD_RECS_V2=off\|shadow\|serve`, independent of YouTube |

Browse presentation has its own `MANGO_VOD_BROWSE_V3=off|shadow|serve` flag.
V3 keeps the precise six-card Story Frontier rail, adds full-corpus Explore,
uses positive-weight trusted category/AI deals, recency-shuffles Continue and
Saved, and persists one globally deduplicated active/previous tab deal.
Playability migration 17 keeps classification and full-corpus Explore work in
an atomic background/shadow reservoir so Home/X only deal published local
candidates. Detail
uses `vod-related-v1` StoryDNA/content-profile matching rather than random
same-rail cards. This remains deployed Pi behavior through `04171bb`; human freshness and
thematic coherence remain unproven until couch acceptance.

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

The latest Pi mode observation is `serve` on v2.7 generation 22 at `04171bb`.
The following rails are deployed and automated-runtime-proven, but not yet
couch-observed for relevance or physical-TV behavior.

| Rail | Contract |
|------|----------|
| For You | Quality-gated qualifying history/subscription evidence with both source families represented when both have supply; no separate fixed 60/40 blend |
| Beyond Your Subscriptions | Topic/channel discovery excluding subscribed creators |
| More Like… | Up to ten daily-stable recent meaningful-watch seeds; seek eight contributing topics and continue bounded quality-gated fill toward the 512-item cap |
| History | Stable chronological normalized history |
| Saved | Stable explicit Saved; zero recommendation weight |
| From Your Subscriptions | Conditional newest unwatched authoritative uploads |
| Live Now | Conditional currently live subscribed-channel streams only |

Only authoritative complete subscription snapshots and official Takeout
history may create recommendation provenance. Mango-local viewing is limited
to chronological History/progress and a 30-day exact-video cooldown. Search,
generic cache, Saved, profiles, mood, VOD, companion state, AI catalogs, and
global charts cannot leak into ranking. Normal rows contain four cards; Live
Now contains one to four. Home and X independently sample the quality-weighted
published reservoirs without quota/network work. Uniqueness is within the
visible slate only; repeats across X are valid and impressions do not influence
selection. History/Saved never shuffle.

`MANGO_YOUTUBE_RECS_V2=off|shadow|serve` controls this independently. Source-
complete does not mean served or couch-observed. Exact active-profile utility
ownership in `off` is source-tested and remains a Pi rollback check.
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

1. Complete the minimal human couch pass for Saved placement, YouTube relevance
   and perceived repetition, focus/Back, playback return, picture, and audio on
   exact final SHA `04171bb`.
2. Fix and test deploy branch/SHA enforcement plus the implicit AIOMetadata
   mutation/security path.
3. Obtain a fresh successful nightly/grow proof; keep the current usable-yellow
   Reliability state explicit until proof and rail-growth warnings clear.
4. Fix the optional-Live reliability mismatch; the playability schema marker is
   reconciled in the target.
5. Implement and prove intentional display sleep/CEC and remove the independent
   accidental Xorg 600-second path.
6. Close resolver/provider topology and repeated grow gaps.
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
