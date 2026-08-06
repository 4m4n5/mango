# Mango VOD Discovery v3 — Precise For You, Broad Shuffle, StoryDNA Related

Status: implemented behind `MANGO_VOD_BROWSE_V3=off|shadow|serve`. This is the
current design and supersedes the stable-head browsing behavior documented by
the earlier Progressive Story Frontier plan. All historical data and rollback
artifacts remain preserved.

## Product contract

Mango uses a different selection policy for each couch job:

| Surface | Job | Policy |
|---|---|---|
| For You | Accurate Household personalization | Story Frontier ranking plus bounded relevance-weighted rotation |
| Explore | Broad full-library discovery | Stateless positive-weight sampling over every eligible verified title |
| Category rails | Trustworthy thematic browsing | Source/theme classification plus moderate weighted sampling |
| AI catalogs | User-created thematic browsing | Catalog relevance with a light Household tie-break |
| Detail Related Titles | Content similarity | StoryDNA/content-profile graph matching with Household affinity only as a tie-break |
| Continue and Saved | Utility access | Recency-weighted sampling |

Movies and TV keep every configured category rail and add one `Explore` rail.
The display order is Continue, Saved, For You, Explore, system categories, then
AI catalogs. A system category with fewer than six truthful cards is omitted;
it is never padded with off-theme titles.

## Strong For You

The existing Household Story Frontier remains the sole VOD taste ranker.
Ratings use neutral `2` and nonlinear positive evidence above it:

```text
positive(r) = (max(0, r - 2) / 3)^2

anchor_strength =
  0.75 * max(positive(Fire), positive(Water))
  + 0.25 * min(positive(Fire), positive(Water))
```

Values below `1` are offline-evaluation negatives only. This release adds no
semantic negative propagation. Explicit evidence retains 85% of affinity when
available; Saved is `0.8`, a meaningful partial watch `0.55`, and completion
`1.0`, with a 180-day viewing half-life.

The six-card `2/2/2`, `3/3`, or one-thread portfolio remains. Within a thread:

```text
q = clamp((rank_score - 2.5) / (thread_q95 - 2.5), 0, 1)
weight = 1 + 31 * q^2
```

Below-floor candidates remain auditable but cannot serve. Predealt slates use
deterministic Gumbel/exponential-race sampling without replacement, four-slate
avoidance, and at most two titles from one franchise. No Explore candidate is
used to repair a weak taste thread.

## Explore, categories, and AI catalogs

Explore starts from every currently verified, poster-bearing, otherwise
eligible unseen title. Missing signals are omitted and the remaining masses are
renormalized:

```text
explore_score =
  0.35 * trusted_catalog_quality
  + 0.25 * household_taste_adjacency
  + 0.20 * semantic_profile_confidence
  + 0.20 * verified_title_novelty

explore_weight = 0.60 + 0.40 * explore_score
```

Trusted catalog quality comes only from current trusted system-category
membership, never raw provider popularity. Every eligible title retains a
finite positive weight.

System categories preserve their source rows and derive replaceable membership
classifications from pins, source position, structured metadata, and the fixed
rail theme profile:

```text
category_score =
  0.55 * trusted_source_position
  + 0.25 * category_theme_confidence
  + 0.10 * household_affinity
  + 0.10 * verified_title_novelty

category_weight = 0.35 + 0.65 * category_score
```

Sparse source evidence is retained rather than falsely rejected. Structured
off-theme evidence may reject presentation membership without mutating
`rail_pool`. AI catalog membership is never allowed to certify a system
category; its serving score is `0.85 * catalog_relevance + 0.15 * affinity`.

## Atomic tab shuffle

X produces one persisted tab deal. Continue and Saved are dealt first, then
For You, categories/AI catalogs, and Explore last; the response is rendered in
the product order above. Continue uses a 30-day half-life and Saved 180 days.
Global same-page deduplication applies across every rail.

The deal seed is the persisted per-tab epoch, so replay is deterministic and a
new X advances. Shadow/background preparation classifies source membership and
publishes one immutable active/previous reservoir per tab. Home and X read that
reservoir; they never reclassify or rewrite the corpus and perform no provider,
Companion, StoryDNA teacher, metadata enrichment, or ranking job. Ordinary
reload reuses the active deal. Current eligibility is rechecked;
newly invalid cards force healing. The database keeps active and previous
complete deals. A partial deal or concurrent epoch race returns a typed failure
and never replaces the last complete page.

Legacy `recently_shown` rows remain stored for rollback but are not read or
written by the v3 selection path.

## StoryDNA Related Titles

Detail uses `vod-related-v1` through:

```text
GET /api/v1/catalog/:type/:id/related
```

The launcher proxy maps this to the catalog service's anchor-oriented endpoint.
Matching reads the active compatible `vod-content-profile-v2` edges, including
immutable compatible StoryDNA overlays. It never calls Companion or a provider.

```text
relation_score =
  0.65 * semantic_graph_match
  + 0.25 * factual_content_match
  + 0.10 * household_affinity_tiebreak

related_weight = 1 + 15 * normalized_relation_score^2
```

Families receive equal mass and multi-value evidence divides its family mass.
Matches require at least two independent shared families and at least one
semantic family. Exact exclusions, current Home cards, and unverified titles
cannot serve. A slate permits at most two franchise siblings and otherwise one
title per creator. Sparse/factual coincidences that cannot meet this standard
omit the rail honestly; the launcher no longer substitutes random Home cards.

## Derived persistence and diagnostics

Playability migrations 16–17 add only replaceable state:

- trusted category membership and component weights;
- Explore session rows;
- active/previous atomic tab deals.
- atomic active/previous sampling reservoirs containing compact category,
  AI-catalog, and Explore candidates and weights.

Historical tables, migrations, ratings, profiles, StoryDNA documents, ranks,
slates, Saved/history, and playability evidence are untouched. Recommendation
diagnostics expose the browse and related model versions and rollout mode;
playability diagnostics expose classification, Explore-session, and deal
counts. Private weights and semantic features never enter couch payloads.

## Rollout and gates

1. `off`: existing VOD browse behavior; no v3 derived selection.
2. `shadow`: old Home returns immediately while reservoir/deal preparation runs
   asynchronously. Complete v3 deals and relevance predealt slates are built
   locally with no teacher calls.
3. `serve`: v3 Home, shuffle, and Detail related become public.

Promotion requires exact-SHA Mac tests/builds and Pi proof for schema migration,
data preservation, complete/offline deals, all-rail membership change, focus
restoration, launch, restart/offline fallback, zero network/teacher/rank work on
X, and service-side Home/X p95 at or below 250 ms. For You evaluation may not
regress holistic nDCG@6 or either axis concordance by more than two percentage
points. Human couch checks remain required for five-of-six For You plausibility,
category truth, Explore freshness, six-of-eight Related coherence, focus, and
playback.

YouTube remains unchanged and provenance-isolated.
