# Fire & Water ratings and For You

**Branch:** `feat/native-experience`
**State:** VOD ranking baseline `7a8bc1bd6f08928270ff092a8a9dad26c02419bf`,
currently deployed with active-tab category Shuffle at recommendation target
`f24fcda240581758bf70ec9cb045973e2570c3e6`,
makes progressive Household VOD the sole executable
recommendation architecture. It contains `vod-content-profile-v2`, immutable
compatible StoryDNA overlays, `vod-story-frontier-v2`, cached six-card dealing,
an optional bounded frontier, exact-ID TMDB enrichment, and additive schema
migrations. The prior semantic-hash v4, cosine/KNN/MMR, strict-only publication,
legacy rank worker/snapshot fallback, corpus-wide teacher backfill, and v4
comparison evaluator are no longer executable. Historical rows remain intact.

The Pi currently serves VOD and YouTube from the current target while
StoryDNA/teacher/TMDB work remains off and all 1,096 StoryDNA rows remain
preserved. Full verified-corpus accounting, bounded memory, cyclic cached
`For You`, cache-only category Shuffle, and automated pre-couch gates pass.
Screenshots and human ten-shuffle
thematic judgment remain **DEFERRED**. The offline bulk artifact/importer is
absent and is not a rollout prerequisite.
See [STATUS.md](STATUS.md).

## Rollout semantics

| `MANGO_VOD_RECS_V2` | Refresh work | Public Movies/TV For You | Identity/UI |
|----------------------|--------------|--------------------------|-------------|
| `off` | No recommendation refresh | No For You recommendation rail | Personal profile/mood state remains usable outside recommendation ranking |
| `shadow` | Build/diagnose only the latest progressive Story Frontier | No For You recommendation rail | Household recommendation identity and exact Household Saved; personal rows preserved |
| `serve` | Latest progressive Story Frontier only | Six strongest supported fits in `6`, `3+3`, or `2+2+2`; absent if no serve-authorized generation | Household-only; personal profile/mood rows preserved and dormant |

Serve authorization is not the same as claiming an offline quality promotion.
With enough stratified ratings, `promotion_eligible=true` authorizes the
generation. With too few labels, a complete generation may instead report
`serve_basis=evidence_cold_start` only when missing stratified-rating/nDCG
coverage is the sole gap and all measured accounting, determinism, latency,
concordance, and intrusion guards pass. This keeps Saved/meaningful-watch cold
start functional without creating ratings. Human couch relevance remains a
separate acceptance gate.

No mode selects a deleted recommender. Operational rollback is `serve` →
`shadow`/`off`; code rollback requires a reviewed older Git revision. Neither
path deletes historical state. “Source-complete” must never be read as “the
Household rail is currently served.”

Deployed rollout contract at `7a8bc1b`:

- Shadow and serve both use exact Household Saved while leaving all personal
  rows intact.
- Off/shadow expose no public recommendation shuffle epoch or `For You` rail.
  Movies/TV category rails remain independently shuffleable from their cached
  verified pools, and the launcher reports success only after an actual
  discovery membership/order change.
- `/recommendations/state` reports each domain's active and previous complete
  rank pointers, active story/taste/model/status/publication, public epoch, and
  promotion linkage separately from the newest attempted row.
- Focused mode/HTTP/ownership/publication/migration/rollback replacements pass,
  as do the full catalog and launcher suites. Pi runtime/accounting/latency/
  launch proof now passes; human thematic judgment remains separate.

## Serve product contract

- Fire measures fun, energy, tension, pace, and spectacle.
- Water measures emotional depth, heart, authenticity, and resonance.
- Both axes are required, use 0–5 in 0.5 increments, and treat 0 as a real rating.
- Movies are rated per title; series are rated once at show level.
- Recommendations have one identity: Household. Existing personal-profile
  ratings, saves, history, progress, snapshots, and events remain dormant and
  recoverable; v2 neither merges nor deletes them. Rating clear removes only
  current state and keeps append-only history.
- Movies and TV Shows each own one stable **For You** rail. It does not consume the three user-created AI-catalog slots.
- Each visible For You rail contains exactly six currently verified-playable
  strongest fits distributed across up to three supported household taste
  threads. There are no close/adjacent/surprise buckets or rewatch lane.
- Profile and mood controls are hidden while v2 serves. The rail never displays
  predictions, scores, StoryDNA values, thread labels, raw evidence, or AI
  jargon.

## Visual language

The household reference is authoritative: Fire renders as five `🔥` marks and
Water as five `🌊` marks. Filled marks retain their saturated native orange/blue
color; unused marks use a neutral grayscale treatment. A `.5` value clips the
colored foreground across exactly half of the next gray mark. Compact detail
chips and the full rating sheet use the same renderer, with explicit Fire/Water
labels and numeric values so color and emoji are never the only meaning.

The bottom sheet stays inside the 5% safe area. Its two slider rows use a 4px
white focus ring, minimum 28px essential copy, and explicit adjustment mode:

1. Up/Down chooses an axis or action.
2. B enters an axis at the neutral `2.0` when unset.
3. Left/Right changes exactly 0.5.
4. B confirms that axis.
5. Save enables only after both axes were deliberately confirmed.
6. Y cancels. On an existing rating, X opens an inline clear confirmation; B
   clears and Y keeps it.

## Durable state and API

Migration 4 extends `/etc/mango/library.db` with current ratings, append-only
events, prompt state, idempotent seed imports, versioned features/taste, and
atomic recommendation snapshots. Before the first migration, catalog-service
uses SQLite's online backup API to create:

```text
/etc/mango/library.db.pre-fire-water-v4.bak
```

All pending `library.db` schema changes, backfills, and migration markers are
then committed in one immediate SQLite transaction. A failed later migration
rolls the entire pending graph back instead of leaving partially created tables
or an ambiguous version boundary.

Ratings use canonical `movie|series` plus stable ID identity rather than addon
source. Series episode identities collapse internally, while couch API calls
must use the bare show ID. Half-steps are stored as integers 0–10. Writes use an
expected revision; stale writes return 409. Rating persistence commits before
reranking, so recommendation failure can never lose a valid rating.

Migrations 5–6 add the permanent Household profile, optional personal profiles,
profile-scoped ratings/prompts/snapshots, durable saves/watch mappings/Not-for-me,
and a typed recommendation-event ledger. Migrations 7–11 add exact attribution
outcomes, per-profile diagnostics, opaque served-slate tokens, profile watch
state, and immutable YouTube context. `progress.db` migration 2 adds
profile-exact Continue/resume; legacy unscoped progress/watch state migrates
only to Household. Migration 12 adds additive StoryDNA, ontology edge, taste
thread, full-corpus rank generation, active/previous generation, cached slate,
and refresh-job tables without rewriting older snapshots. Those historical rows
remain durable but are not current ranking inputs. While VOD recommendations
are active (`shadow` or `serve`), Household activation is idempotent;
personal-profile activation/creation and a non-null mood return typed
`household_only`. Personal rows remain recoverable for an `off` posture or a
reviewed older-code rollback. Exact resume positions never blend.

Recommendation actions carry an opaque server-issued token bound to the served
profile, domain, rail, revision, exact membership, source revision, and bounded
context. Detail, play, Save/Unsave, rating, and feedback reject stale or injected
proof with 409. Ordinary Search, voice, and non-recommendation actions remain
valid without a token. Public cards retain opaque content IDs required to act,
but never URLs, credentials, scores, prompts, or private feature text.

The ordinary Detail action path is owner-bound too. Rating read/set/clear,
prompt dismissal, Save/Unsave, Not-for-me/Undo, current Detail context,
playback acceptance, playback-return restore, and next-episode reads all carry
the immutable profile ID and personalization revision captured when Detail
opened. The service checks and echoes that pair; a stale action fails with 409
even when it has no recommendation attribution token.

VOD rails, Continue, Saved, Search Detail's Saved marker, and Settings
hidden-title state also receive the launcher's captured
profile ID and personalization revision; the service validates and echoes that
pair around assembly. Hidden-title restore carries the same immutable pair.
The browser commits only an exact response and stores rail/Saved caches under
the same owner. Ownership 409s trigger state reconciliation and never use an
unowned rail fallback.

Routes:

```text
GET    /library/ratings?type=&id=&expected_profile_id=&expected_personalization_updated_at=
PUT    /library/ratings
DELETE /library/ratings?type=&id=&expected_revision=
POST   /library/rating-prompts/dismiss
GET    /recommendations/state
GET    /recommendations/jobs/:job_id
POST   /recommendations/refresh
POST   /recommendations/impressions
POST   /recommendations/action
GET    /library/not-interested?expected_profile_id=&expected_personalization_updated_at=
POST   /library/not-interested
DELETE /library/not-interested
GET    /personalization/state
POST   /personalization/profiles
POST   /personalization/activate
POST   /personalization/mood
```

Movie prompts become eligible at Mango's existing 90% finish threshold for the
owning profile. Series prompts become eligible after three distinct episodes
completed by that same profile; the persistence
path also accepts the explicit `season_finale_finished` event when episode
metadata proves a finale. The invitation appears on return in Detail, never
opens automatically, and never takes focus.

## Story Graph recommendation model

The candidate authority is every current `titles.status='verified'` movie or
series, paged deterministically without the old 2,000/1,200 limits. A scan
captures the monotonic playability-corpus generation and cannot publish across
a generation change. Missing artwork/profile evidence and exact eligibility
failures are indexed with reasons, so complete accounting is
`scored + excluded == verified`. Only poster-bearing verified rows serve.

The sole content profile is `vod-content-profile-v2`: deterministic metadata
facts and narrowly controlled rules produce a base profile, while a compatible
`story-dna-v1` document may enrich it as an immutable overlay. StoryDNA's closed
content description covers controlled story engines, themes, dynamics, tone,
setting, structure, emotional arc, and fifteen ordinal facets; it is not a
separate strict publication mode. A profile needs a content-bearing family, at
least two substantive families, and at least 1.5 confidence mass to serve;
sparse/unrankable rows stay excluded. Fire/Water, household activity,
popularity, quality, and predicted enjoyment remain forbidden content-profile
inputs.

Mango Companion's configured model is a stateless content teacher only. Its
separate localhost endpoint receives stable identity and canonical evidence—
never ratings, Saved/history, profiles, mood, conversations, or memory. Sparse
evidence can use bounded structured addon lookup and optional exact-ID TMDB
metadata; there is no broad scraping. Strict identity, schema, provenance, and
evidence-hash validation rejects mismatched output while retaining valid
siblings. Household mutations rebuild taste/ranks but never content evidence.

`MANGO_STORY_DNA_WORKER_MODE=off|frontier` defaults off. The opt-in frontier
selects positive/implicit anchors, thread shortages, reserve-boundary
uncertainty, and two stable audit titles. Defaults are 12 titles/type/day and 96
titles total/rolling 30 days; provider calls batch up to 4, with 15 minutes/run,
three attempts, and 15-minute
coalescing. Overrides use the `MANGO_STORY_DNA_FRONTIER_*` variables documented
in [OPS.md](OPS.md). Keep it off until committed migrations 15–16 have upgrade/
rollback/preservation proof; frontier lease expiry/retry/max-attempt/rolling-
window/coalescing/concurrency/restart, TMDB failure/rate-limit/credential-file/
TV-series, and mode-aware activation/staleness still need focused proof.
Existing tests cover worker-off/per-type daily budget and exact-ID/no-fuzzy
TMDB mapping; the corrected activation lookup accepts
`vod-story-frontier-v2`; Pi activation and cached serving are now observed.

The local worker fits one to three deterministic Bayesian household threads.
Categorical families use Dirichlet-multinomial posteriors; ordinal families use
regularized distributions. Candidate/thread fit is an equal-family posterior
predictive likelihood ratio against the complete verified corpus, with capped
rare-node lift and confidence shrinkage. There is no embedding, cosine/KNN,
title-to-title comparison, MMR, or cloud ranking path.

Only positive rating evidence propagates:

```text
positive(rating) = (max(0, rating - 2) / 3)^2
anchor_strength  = 0.75 * max(positive(Fire), positive(Water))
                 + 0.25 * min(positive(Fire), positive(Water))
predicted_axis   = 2 + 3 * positive_support
holistic         = 0.75 * max(predicted_fire, predicted_water)
                 + 0.25 * min(predicted_fire, predicted_water)
rank_score       = blended_affinity - 0.5 * posterior_standard_deviation
```

Ratings below `1` are negative labels, ratings from `1` through `2` are
neutral, and ratings above `2` contribute quadratically increasing positive
preference. Negative ratings exclude the exact title but do not become broad
semantic penalties. Fire/Water is permanent and origin/age independent; Saved has strength 0.8; meaningful partial viewing
has 0.55; completion has 1.0; VOD viewing has a 180-day half-life. A meaningful
watch is `min(25% of duration, 5 minutes)`, or two minutes when duration is
unknown. Bare starts are ignored. With explicit evidence it owns 85% of final
affinity and Saved/watch owns at most 15%; implicit evidence renormalizes for
cold start. Rated, Saved, meaningfully watched, hidden, blocked, and exact
Not-for-me titles never serve. The offline intrusion guard counts a title as a
true negative only when both Fire and Water are below `1`.

Each newly published rank generation becomes eligible at 200 ranked rows and
progresses toward complete-corpus accounting while the prior complete
generation remains active. A taste mutation may first publish a priority
bootstrap drawn from a default roughly 240-row reserve, then publish a separate
full-corpus follow-up generation. The dealer
precomputes up to 32 cached six-card slates. Three supported threads deal 2/2/2
cards, two deal 3/3, and one deals all six. Browse v3 replaces rank-only
sampling with `1 + 31q²` relevance weighting above the 2.5 fit floor and caps a
franchise at two cards; the prior four rendered slates remain avoided when
supply permits. One atomic active-tab X deal also recency-shuffles Continue and
Saved (Continue also weights remaining progress), re-deals every trusted category and AI catalog, and fills Explore last
from every eligible verified title. Global same-page deduplication applies.
Load-time DB revalidation checks verified state, artwork, uniqueness, and exact
exclusions. If a complete tab deal cannot be persisted, Mango retains the
previous active deal and returns a typed failure. Home and X never wait for
network, metadata, enrichment, graph, corpus scan, or ranking work.

Detail `Related Titles` is `vod-related-v1`: compatible StoryDNA/content-profile
semantic edges own 65%, factual content matches 25%, and Household affinity is
only a 10% tie-break. A semantic plus an independent shared family is required;
the rail omits instead of substituting random same-rail cards.

Writes commit first and enqueue one serialized, coalescing job per media type.
The refresh response is HTTP 202 with job ID, trigger reasons, and captured
revisions. Startup, rating set/edit/clear, Save/Unsave, meaningful/completed
viewing, playability publication, manual refresh, and nightly decay/backfill can
trigger work. Stale corpus/taste/feature work cannot overwrite a newer
generation.

Rollout flags are reversible and never delete state:

```bash
MANGO_VOD_RECS_V2=off|shadow|serve
MANGO_YOUTUBE_RECS_V2=off|shadow|serve
MANGO_FIRE_WATER_RATINGS=0
MANGO_FOR_YOU=0
```

## Seed-rating outcome and import

The original Google Sheet was a read-only R&D input, never a runtime dependency.
Its ambiguous rows were explicitly reconciled during the historical home
acceptance: **The Idea of You** was excluded, and **La Cocina** was approved at
Fire `3.0` / Water `1.5`. The seed-v2 manifest was validated, imported, and a
repeat import proved a no-op on that recorded Pi revision.

An approved manifest may contain normalized private taste tags and a caption
hash, but the validator rejects raw captions and sheet URLs. Every source row
must have an explicit approved/excluded disposition. Approval requires one
unique exact title/year stable-ID match; weaker matches remain in review.
Couch-authored history always blocks later seed overwrite, including after
clear.

For a new database or explicitly authorized re-import, run on the Pi only after
manifest reconciliation and preserve the DB:

```bash
cd ~/mango/src/catalog-service
npm run ratings:seed -- dry-run /path/to/fire-water-seed-v1.json
npm run ratings:seed -- validate /path/to/fire-water-seed-v1.json
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
# Idempotence proof: repeat the exact import; this invocation must be a no-op.
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
```

The second import must report `noop: true`. The historical seed proof is not a
current recommendation-v2 quality verdict; see
[tasks/FIRE_WATER_HOME_ACCEPTANCE_REPORT.md](tasks/FIRE_WATER_HOME_ACCEPTANCE_REPORT.md).

## Current enrichment and promotion boundary

The latest recorded Pi snapshot had roughly 1,096 StoryDNA feature rows and a
latest StoryDNA generation `complete_count` around 545 movies/439 series against
verified corpora around 5,452 movies and 3,794–3,904 series. Rank coverage was
still partial. Reverify those counts before using them operationally. The live
one-title-at-a-time teacher was stopped for cost and latency.

Target `772b3d5` compiles the verified corpus locally and can selectively teach
only a bounded uncertainty frontier, rather than requiring whole-corpus model
completion. It is Mac-tested but not Pi-deployed or couch-accepted. The
older bulk-work prompt remains design input for a possible privacy-safe,
versioned artifact/importer, not the automatic next step. First measure
progressive profile coverage, calibration, recommendation quality, teacher
cost, and recovery; build a bulk importer only if those results leave a real
coverage or quality gap.

## Evaluation boundary

At `772b3d5`, deterministic local tests cover content-only StoryDNA,
malformed-sibling isolation, progressive profiles, graph/worker parity,
positive-only rating math, 85/15 evidence ownership, 180-day viewing decay,
distinct threads, 2/2/2–3/3–6 portfolios, rank-weighted dealing, large-corpus
accounting, attribution fencing, frontier containment, and exact-ID TMDB.
Focused replacements also cover mode/HTTP ownership, exact Saved policy,
disabled/public Shuffle behavior, migration preservation, active versus newest
publication, and flags-off rollback. Restart and resource behavior still
require Pi proof before promotion.

Promotion now uses an absolute deterministic five-fold latest-architecture
evaluation, not a comparison against deleted v4. It records holistic nDCG@6,
per-axis concordance for ratings at least 4, both-axes-low top-six intrusion,
complete verified accounting, deterministic replay, worker latency, and cached
service p95. It blocks on fewer than 15 eligible ratings/fewer than five folds,
unavailable nDCG, below-chance measured concordance, intrusion above one third,
incomplete accounting, nondeterminism, unmeasured cached p95, or cached p95 over
250 ms. Offline eligibility is a minimum safety gate, not evidence that the
ranking beats an accepted baseline or feels good on the couch.

Partial predecessor StoryDNA/rank coverage exists in the latest recorded shadow
runtime. Complete latest-architecture coverage/accounting, evaluation, serve promotion,
current-SHA Pi latency/restart/offline/resource proof, screenshots, target-TV
launches, and human couch relevance remain **DEFERRED**. Offline promotion is
necessary, not proof of the final couch experience.

Home acceptance is in [COUCH_TEST.md](COUCH_TEST.md). Deployment remains
git-only per [DEPLOY.md](DEPLOY.md); never rsync, copy runtime databases, or
delete history/cache.
