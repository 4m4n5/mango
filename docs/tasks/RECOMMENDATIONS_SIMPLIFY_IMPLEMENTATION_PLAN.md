# Mango Couch Recommendations v2 — Story Graph Revision

> Implementation baseline (2026-08-04): `feat/native-experience` was fetched
> and fast-forward checked at `d3114de9eb0e21f2a8db1686bbd064e2c5a4c5f1`;
> the remote tip did not move. Existing untracked ops task documents are
> preserved. The original research session authorized no writes; a subsequent
> explicit implementation-and-push request authorized the source work. Pi
> deployment and couch proof remain delegated to the home-agent contract.

## Summary

Replace VOD's `semantic-hash-v4` cosine/KNN/MMR model with
`vod-story-graph-v1`:

- Mango Companion's configured AI becomes a stateless content teacher only. It
  never sees household signals and never scores, ranks, selects, or publishes
  recommendations.
- Each title receives a complete, strict, versioned StoryDNA profile grounded
  in catalog metadata and selective structured lookup.
- A local uncertainty-aware model learns up to three household taste threads
  from Fire/Water, Saved, and meaningful viewing.
- High Fire/Water is positive evidence; ratings at or below the midpoint create
  no related-title penalty. Exact rated titles remain ineligible.
- All six cards are strongest supported fits across household taste threads.
  There is no close/adjacent/surprise split, forced bridge, MMR, visible
  explanation, or cosine calculation.
- The existing verified-only full-corpus index, cached shuffle, YouTube design,
  dormant profile preservation, and rollout boundaries remain in force.

## VOD intelligence and ranking

### Grounded StoryDNA

Persist rich source evidence currently discarded by recommendation ingest:
synopsis, genres, language, country, runtime, release state, cast, characters,
director, writer, awards/certification where available, stable external IDs,
curated-pool memberships, source, retrieval time, and canonical evidence hash.

Create a strict `story-dna-v1` JSON Schema. Every field is required; legitimate
absence uses `none` or numeric zero rather than an invented free-form tag. The
initial controlled vocabulary covers:

- Genre/subgenre and format.
- Story engine: investigation, quest, survival, rivalry, heist, revenge,
  romance, family conflict, coming-of-age, rise/fall, transformation, workplace,
  political struggle, social issue, friendship, slice-of-life, procedural,
  anthology, biography.
- Themes: family, belonging, love, friendship, identity, ambition, power,
  justice, duty, freedom, faith, grief, redemption, class, community, survival,
  morality, obsession, legacy, prejudice, nature, technology.
- Character dynamics: lone protagonist, ensemble, found family, parent/child,
  siblings, romantic pair, rivals, mentor/student, partners, team,
  antihero/society.
- Tone: warm, hopeful, playful, witty, absurd, romantic, earnest, contemplative,
  melancholic, dark, gritty, suspenseful, frightening, cynical, triumphant.
- Setting era, geographic scope, social setting, narrative structure, and
  ending/emotional-arc class.
- Ordinal `0–4` facets for pace, action, tension, spectacle, humor, romance,
  fear, tenderness, sadness, hope, realism, narrative complexity, moral
  ambiguity, violence, and family accessibility.

Fire and Water are deliberately absent from StoryDNA: they remain household
reactions, not AI-authored content truth. Quality, popularity, charts, and
predicted enjoyment are also forbidden fields.

Use the existing companion provider/model configuration through a separate
stateless enrichment prompt and endpoint:

- Send only canonical title evidence and stable identity.
- Send no ratings, Saved/watch events, profile data, mood, companion
  conversations, or companion memory.
- Perform selective lookup only when identity is ambiguous, the synopsis is
  under 120 characters, genres are missing, or fewer than three substantive
  evidence fields exist. Prefer existing addon metadata and stable-ID
  structured providers; do not introduce broad web scraping.
- Require exact IDs, schema enums, complete fields, per-family confidence,
  prompt/model/schema versions, and evidence hash. Reject unknown enum values,
  extra fields, partial documents, or mismatched IDs.
- Persist valid siblings from a batch and retry invalid items independently.
- Low-confidence but complete profiles remain rankable; their facet
  distributions shrink toward corpus priors.
- Metadata, schema, prompt, or explicitly selected model changes create a new
  shadow StoryDNA generation. Household activity never regenerates content
  profiles.
- Preserve StoryDNA for rated, Saved, and watched anchors even when they cease
  being playable.

Build the full backfill in deterministic, theme-stratified batches. Publish VOD
v2 only after 200 eligible complete profiles exist per media type, then continue
until every verified title is profiled or has a durable retryable failure. Keep
the prior complete generation active throughout.

### Theme graph

Represent semantics as a versioned bipartite graph:

- Title nodes connect to controlled ontology values with AI
  intensity/confidence.
- Fixed ontology parent edges and fixed compound nodes capture important
  intersections such as story-engine × tone, theme × character-dynamic,
  genre × pace, and setting × conflict.
- Metadata facts such as language, country, decade, creator, and format use
  deterministic edges rather than AI inference.
- Do not generate or store AI title-to-title comparisons.
- Do not collapse the graph into one embedding or one similarity number.

Candidate/thread matching uses a posterior predictive likelihood ratio over
facet families versus the complete verified corpus. Give each family equal
total mass, divide within multi-valued fields, cap rare-node lift, and shrink
uncertain evidence toward corpus frequency. This rewards distinctive
combinations without letting generic genre overlap dominate.

### Household taste threads

For each Movies/TV domain, fit a deterministic weighted Bayesian mixture over
positive anchors:

- Fit `K=1..3` threads using Dirichlet-multinomial posteriors for categorical
  graph nodes and regularized ordinal distributions for intensity facets.
- Choose the smallest `K` within one standard error of the best deterministic
  leave-one-anchor-out posterior likelihood.
- A thread requires at least one explicit-equivalent unit of effective support;
  otherwise merge it into the closest supported thread.
- Use stable-ID-seeded initialization and deterministic convergence so the same
  captured revisions reproduce identical ranks.
- Store each thread's posterior facet distribution, effective evidence mass,
  Fire/Water uplift, uncertainty, and internal label. Do not expose thread
  labels on the couch.

Transform explicit axis ratings into positive-only strength:

```text
positive(rating) = (max(0, rating - 2.5) / 2.5)²
```

Thus `0–2.5` has no thematic propagation, while `4.5–5` dominates. For a rated
anchor:

```text
anchor_strength =
  0.75 × max(positive(Fire), positive(Water))
  + 0.25 × min(positive(Fire), positive(Water))
```

This preserves strong single-axis tastes and gives high-high titles a balance
bonus. Seed and couch ratings have identical permanent weight; only edit/clear
changes them.

Saved and viewing remain positive-only supporting evidence:

- Saved: `0.8`.
- Meaningful partial watch: `0.55`.
- Completion: `1.0`.
- Meaningful threshold: `min(25% of duration, 5 minutes)`; unknown duration
  requires two minutes.
- VOD viewing influence has a 180-day half-life.
- Bare starts are ignored.

When explicit evidence exists, it owns 85% of final affinity and Saved/watch
owns at most 15%. Without explicit evidence, implicit evidence is renormalized
for cold start. With no qualifying evidence, omit For You and retain the
existing setup state.

For each candidate and taste thread:

1. Compute graph-based posterior match and uncertainty—never cosine or nearest
   neighbors.
2. Derive Fire and Water positive-support estimates from the best supporting
   thread for each axis.
3. Preserve internal compatibility fields as:

```text
predicted_axis = 2.5 + 2.5 × positive_support
holistic = 0.75 × max(predicted_fire, predicted_water)
         + 0.25 × min(predicted_fire, predicted_water)
rank_score = blended_affinity - 0.5 × posterior_standard_deviation
```

These are local positive-appeal estimates, not AI ratings. Using the best thread
instead of averaging prevents action, family-drama, comedy, and other distinct
tastes from collapsing into a bland household centroid.

Low ratings create no graph penalty. Hidden, blocked, Not-for-me, rated, Saved,
and meaningfully watched exact titles remain eligibility exclusions, but only
exact Not-for-me is a veto.

## Indexing, serving, and interfaces

Add versioned StoryDNA, ontology-edge, taste-thread, rank-generation, and
rank-item storage without rewriting v4 snapshots. A rank row records captured
taste/feature/corpus revisions, best thread, predicted axes, implicit/explicit
support, uncertainty, rank score, feature hash, current serving eligibility,
and exclusion reason.

Keep the previously approved full-corpus behavior:

- Deterministically page through every `titles.status='verified'` movie/show;
  remove the 2,000/1,200 caps.
- Capture the monotonic playability generation and reject publication if it
  changes during a scan.
- Start serving at 200 eligible ranked titles and grow the reserve toward the
  complete verified corpus.
- Preserve active and previous complete generations; stale work cannot
  overwrite newer taste, ontology, feature, or corpus revisions.
- Rating/Save/watch writes commit first, immediately evict newly known exact
  titles, priority-rescore the active reserve, publish once 200 rows are ready,
  and then finish the full scan.
- Nightly refresh follows playability growth and refreshes watch decay, changed
  metadata, StoryDNA backlog, taste threads, and ranks.
- Removing a visible curated rail never deletes its verified pool membership or
  semantic evidence.

Replace the 4/1/1 dealer with a strongest-fit portfolio:

- Three supported threads allocate `2/2/2`; two allocate `3/3`; one allocates
  all six.
- Never reserve a bridge, adjacent, or surprise slot.
- Within each thread, draw without replacement using `1 / rank^1.5` from
  candidates above the current fit floor.
- Avoid the preceding four rendered slates, relaxing the oldest first and then
  the fit floor only as needed.
- Revalidate uniqueness, artwork, exclusions, and verified-playable status at
  load time.
- Retain the previous valid slate when six cards cannot be healed.

The TV label remains only `For You`; cards and rail expose no reasons, scores,
predicted ratings, ontology tags, or thread names. X advances only the current
tab's cached slate, preserves focus/scroll position, and performs no network,
enrichment, graph, or ranking work.

Public card and attribution-token shapes remain compatible. Change refresh to
HTTP 202 with job ID and captured revisions. Poll the durable exact job at
`GET /recommendations/jobs/:job_id`; bounded aggregate diagnostics are not an
authority for one caller's job. Extend recommendation diagnostics
with StoryDNA coverage/failures, ontology/model versions, active thread count,
full-corpus cursor/coverage, reserve depth, uncertainty summary, last-good
generation, stale reasons, and offline-evaluation results.

## YouTube and rollout

Implement the approved YouTube design unchanged and isolated from VOD
StoryDNA:

- Recommendation inputs remain authoritative subscriptions plus Takeout/
  Mango-local meaningful watch history only.
- Keep the five equal core rails—For You, Beyond Your Subscriptions, More Like,
  History, Saved—and conditional From Your Subscriptions and Live Now.
- Preserve provenance-gated acquisition, Takeout importer, global
  deduplication, Shorts/live rules, quota ceilings, cached X behavior, and
  atomic generation publication.
- VOD AI profiles, Fire/Water, Saved VOD, theme graph, companion memory,
  profiles, mood, Search, AI catalogs, and charts have zero YouTube influence.

Use independent `off|shadow|serve` flags for VOD and YouTube. Keep v4 serving
while StoryDNA backfill, full-corpus indexing, and offline evaluation run in
shadow. After the offline gate passes, switch VOD to serve while retaining v4
and both prior generations for one couch release. Post-serve couch judgment
remains a rollback/acceptance check, not the initial promotion gate.

Source implementation and push were separately authorized after this plan was
approved. Pi deployment remains governed by the home-agent contract and exact
pushed SHA.

## Test and promotion contract

Automated coverage must prove:

- StoryDNA prompts contain no household or companion state; every persisted
  document is schema-complete, ID-bound, versioned, provenance-backed, and
  strict-enum valid.
- Sparse metadata triggers bounded lookup; malformed AI output cannot corrupt
  valid siblings or the last-good generation.
- No v2 ranking, diversity, or thread code calls cosine similarity or uses the
  old hashed vector.
- Fire `5`/Water `0` and Fire `0`/Water `5` produce strong distinct positive
  threads; `5`/`5` receives the balance bonus.
- Ratings at or below `2.5` do not lower any related candidate's rank; they only
  make the exact rated title ineligible.
- Explicit evidence dominates conflicting Saved/watch evidence; rating origin
  and age do not change weight.
- Multiple disjoint tastes remain separate and produce `2/2/2`, `3/3`, or
  six-card portfolios without forced exploration.
- A 5,452-movie/3,794-series corpus publishes at 200, reaches
  `scored + excluded == verified`, survives restart/races, and never serves an
  unverified title.
- Five X presses avoid the preceding four slates when supply permits and
  produce zero network/ranking calls.
- Existing YouTube provenance, Takeout, rail-order, quota, and isolation tests
  remain green.

Create a frozen deterministic five-fold evaluation over current household
ratings, stratified by media type and Fire/Water relevance. Low ratings may be
evaluation negatives even though they do not train negative taste. Compare v2
against v4 using:

- Primary: holistic nDCG@6 from the positive-strength relevance function.
- Guardrails: per-axis pairwise concordance for ratings ≥4, top-six intrusion
  rate for titles with both axes ≤2.5, coverage, determinism, and worker latency.
- Promotion requires at least 10% relative nDCG@6 improvement, a paired 90%
  bootstrap interval above zero, no more than two percentage points of
  regression on either guardrail, complete verified-corpus accounting, and
  cached service p95 ≤250 ms.
- If the sparse rating set cannot satisfy the confidence bound, remain in
  shadow and collect additional normal household ratings; do not weaken or
  silently replace the gate.
