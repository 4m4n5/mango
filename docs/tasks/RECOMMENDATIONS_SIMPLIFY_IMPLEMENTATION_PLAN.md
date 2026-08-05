# Mango VOD Recommendations v2 — Progressive Story Frontier

Status: implemented and cleaned to one executable architecture on
`feat/native-experience`; Pi and human couch proof remain deferred.

This document supersedes the corpus-wide StoryDNA design. The bulk StoryDNA
work-agent prompt is retained only as historical planning input and is already
marked superseded.

## Product contract

- Movies and TV each expose one cached, six-card `For You` rail.
- Every served title is poster-bearing and currently verified playable.
- Fire/Water, Saved, and meaningful Mango VOD viewing are the only taste
  inputs. Fire/Water above 2.5 is dominant positive evidence. Low ratings do
  not penalize related titles; the exact rated title is ineligible.
- Profiles and mood do not enter ranking. Existing data remains recoverable;
  personal recommendation evidence is dormant, but Saved currently blends
  preserved profile rows in `shadow` and must be fixed or accepted before
  rollout.
- Home and X perform no synchronous metadata, provider, graph, or ranking work;
  a low-water check may asynchronously enqueue a full-rank recovery after the
  response.
- YouTube remains isolated and uses only its provenance-gated v2 architecture.

## Progressive content intelligence

The active contracts are:

- composite profile: `vod-content-profile-v2`
- deterministic compiler: `vod-content-compiler-v1`
- ranker: `vod-story-frontier-v1`
- ontology: `story-dna-core-v1`
- optional immutable overlay: compatible `story-dna-v1`

Every verified title is compiled locally from stable catalog evidence. The
semantic hash includes normalized synopsis, genres, keywords, language,
country, runtime, format, people, certification evidence, release identity,
stable external IDs, and fixed curated-pool evidence. Retrieval timestamps,
posters, playability, source refreshes, and visible rail placement do not
invalidate semantic artifacts.

Each family distinguishes `observed`, `known_absent`, and `unknown`. Ordinal
zero remains observed. Known absence creates no similarity edge. Exact
metadata wins single-choice conflicts; inferred multi-value edges merge by
node and confidence. Awards are not ranking evidence.

The deterministic compiler emits exact metadata edges and only a small,
audited exact-phrase ruleset for controlled story engines, themes, dynamics,
and tones. It uses no embedding, cosine, KNN, MMR, BM25, fuzzy-title match,
popularity, charts, provider ordering, or genre-only inference of endings,
relationships, moral ambiguity, or emotional facets.

A title may serve without StoryDNA when it has artwork, verified playability,
two independent evidence families with confidence mass at least 1.5, and one
content-bearing family. Thinner titles are stored as `sparse_unresolved`, fully
accounted for, and unservable until evidence improves.

Compatible existing StoryDNA is loaded by stable identity and semantic
evidence hash, regardless of which compatible Companion model produced it.
Model changes affect new work only. Invalid or mismatched overlays detach but
are never deleted.

## Taste, ranking, and serving

The deterministic Bayesian graph ranker fits one to three household taste
threads per media type. Explicit positive evidence is:

```text
positive(r) = (max(0, r - 2.5) / 2.5)^2

anchor_strength =
  0.75 * max(positive(Fire), positive(Water))
  + 0.25 * min(positive(Fire), positive(Water))
```

Saved has strength 0.8, meaningful partial viewing 0.55, and completion 1.0.
Viewing qualifies at `min(25% of duration, 5 minutes)`, or two minutes without
duration, and has a 180-day half-life. Ratings do not decay. Explicit evidence
owns 85% of affinity when present.

Observed profile edges contribute confidence-weighted posterior lift. Unknown
families contribute prior expectation and uncertainty, never false evidence.
The score contract remains:

```text
predicted_axis = 2.5 + 2.5 * positive_support
holistic = 0.75 * max(predicted_fire, predicted_water)
         + 0.25 * min(predicted_fire, predicted_water)
rank_score = blended_affinity - 0.5 * posterior_standard_deviation
```

The dealer uses strongest-fit `2/2/2`, `3/3`, or six-card thread allocation,
weighted draws using `1 / rank^1.5`, and four-slate repeat avoidance. It
revalidates eligibility at load time and retains the prior valid slate when a
six-card replacement cannot be healed.

## Fixed calibration panel

A stable-ID-selected panel reuses compatible existing StoryDNA and is frozen
per compiler/reference version independently of current taste. Masked/base
scores are compared with full-overlay scores under the exact fitted local
taste model. Directional split-conformal residual bands are stored at nominal
90% coverage. Small strata back off to a wider pooled band.

Historical rows without trustworthy selection provenance are explicitly
reported as provisional. Provisional or insufficient bands are never called
calibrated and do not replace the conservative posterior uncertainty for
frontier acquisition. The panel stores residual quantiles and diagnostics,
not learned weights or a prediction model.

## Optional metadata and semantic frontier

TMDB gap filling is optional and exact-ID-only. One detail request uses
`append_to_response`; local facts are preserved, mismatched identities are
quarantined, and failures do not block local ranking. The client is limited to
four workers, five requests per second, bounded `Retry-After`, and 250 inputs
per invocation. Popularity, discovery, charts, and recommendation endpoints
are forbidden. Settings carries the required TMDB attribution.

Companion teacher work is controlled by:

```text
MANGO_STORY_DNA_WORKER_MODE=off|frontier
```

It defaults to `off`. The durable frontier prioritizes positive anchors,
unsupported implicit threads, thread shortages, reserve-boundary overlap,
fit-floor uncertainty, and a small stable audit sample. It is bounded to the
top 48 candidates per thread, one request in flight, batches of four, 12 Movies
and 12 TV titles per 24 hours, and 96 titles total in a rolling 30 days. Provider
calls may batch up to four titles. All
requests count, including repair. Work coalesces for 15 minutes, stops after 15
minutes, rate limiting, or two transport failures, and retries a semantic hash
at most three times with durable backoff.

The payload is content-only. No rating, save, watch, profile, mood, Companion
conversation, memory, or rank field is sent. A full-corpus teacher loop is not
part of the progressive path.

## Persistence, publication, and diagnostics

Schema migrations are additive. They retain historical Story Graph and v4 rows and
add progressive generations, profiles, family coverage, graph edges, semantic
and availability revisions, frontier leases, metadata cache, reference
membership, calibration bands, and provider usage.

Full scans page every verified movie/show and require:

```text
scored_count + excluded_count == verified_count
unscored_count == 0
coverage == 1
```

They publish after at least 200 eligible titles, preserve last-good state, and
reject stale corpus, taste, or semantic revisions. Exact newly known titles
are evicted after their source mutation commits. Rating, save, and watch
changes perform only local profile/taste/rank work before any separately
coalesced frontier job.

Reliability diagnostics expose profile mode, complete accounting, reserve
depth, base/enriched/sparse counts, per-family and edge-source coverage,
compiler/semantic/reference revisions, uncertainty, calibration status,
frontier queue/budgets/retries/usage, optional TMDB state, and last-good/stale
state.

## Verification and rollout

Required automated proof covers metadata-only serving, sparse accounting,
state semantics, immutable overlay reuse, semantic versus operational churn,
zero teacher calls in local refresh, deterministic bounded frontier behavior,
restart-safe budgets/leases, optional exact-ID TMDB behavior, complete large
corpus accounting, cached X behavior, and YouTube isolation.

The following are **supplemental release requirements from this plan, not the
implemented current promotion gate**. Current source implements only its
absolute minimum evaluator; these stronger comparison, recall, calibration,
teacher-cost, and slice gates must be implemented or explicitly revised before
they can be used as automated promotion evidence:

- progressive nDCG@6 no more than 2% below full StoryDNA on the frozen panel;
- frontier recall at least 95% for full-profile top 200 and 98% for top 24;
- nominal 90% bands achieve at least 90% held-out coverage;
- no populated media/language/decade/sparsity slice loses over five recall
  points;
- at least 90% fewer new teacher calls than corpus-wide backfill;
- deterministic five-fold frontier evaluation with acceptable per-axis
  concordance and low-low intrusion guardrails;
- Pi cached-service p95 at or below 250 ms.

Roll out VOD independently: deploy through git in shadow with both metadata and
teacher work off; build local profiles and validate accounting/replay; enable
the locked frontier only after shadow gates; promote to serve only after Pi
runtime gates. Retain historical v4/strict data and two previous progressive
generations, but do not retain executable legacy loaders, rankers, or fallback
acquisition. Rollback is configuration-off plus a reviewed Git revision, never
data deletion. Human acceptance remains five plausible cards of six with
recognizable taste threads across ten shuffles.

Cold-start clarification: supervised five-fold nDCG is unavailable by
definition when a media type has too few stratified Fire/Water labels, including
the approved Saved/watch-only case. That absence must remain visible and must
never be repaired with synthetic ratings. A full generation may nevertheless
be operationally serve-authorized when its only evaluation gaps are
`insufficient_stratified_ratings` and/or `ndcg_unavailable`, while verified
accounting, determinism, cached p95, reserve/slate, and every measurable
concordance/intrusion guard pass. Diagnostics report this provisional path as
`serve_basis=evidence_cold_start` with `promotion_eligible=false`; the human
couch verdict remains mandatory.

## Latest-only cleanup contract

The post-implementation cleanup removes the v4 semantic-hash/cosine/KNN/MMR
engine, strict complete-StoryDNA serving mode, autonomous corpus teacher loop,
legacy recommendation worker, and legacy YouTube Fresh/Popular/generic
For You/Because/AI-home acquisition and scoring. The runtime exposes only the
progressive VOD service and provenance-gated YouTube v2 service.

No cleanup migration drops or rewrites data. Historical schemas remain so old
rows can be audited and a prior Git revision can read them. Existing StoryDNA
continues as immutable overlay evidence. The destructive YouTube fresh-start
endpoint and reservoir clearing API are removed. Tests explicitly assert both
latest-only source ownership and preservation of historical database rows.

No Pi deployment, runtime promotion, or human couch result is claimed by this
Mac implementation.
