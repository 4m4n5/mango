# Fire & Water ratings and For You

**Branch:** `feat/native-experience`
**State:** `vod-story-graph-v1` is implemented behind `off|shadow|serve` rollout
control and covered by local deterministic gates. It has **not** been deployed
by this work session. StoryDNA backfill on the real corpus, the frozen offline
promotion result, Pi/runtime proof, screenshots, and human couch judgment are
**DEFERRED**.

## Product contract

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
2. B enters an axis at 2.5 when unset.
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
and refresh-job tables without rewriting v4 snapshots. During v2 serve,
Household activation is idempotent; personal-profile activation/creation and a
non-null mood return typed `household_only`. Old profile rows and companion
functions remain intact for rollback. Exact resume positions never blend.

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
the same owner. Ownership 409s trigger state reconciliation and never use the
legacy unowned rail fallback.

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
a generation change. Missing-artwork, missing-StoryDNA, and exact eligibility
failures are indexed with reasons, so complete accounting is
`scored + excluded == verified`. Only poster-bearing verified rows serve.

`story-dna-v1` is a closed content description covering controlled story
engines, themes, dynamics, tone, setting, structure, emotional arc, and fifteen
ordinal facets, plus deterministic language/country/decade/creator and compound
graph edges. Every family is present; legitimate absence is `none` or zero.
Canonical synopsis, genres, people, runtime, identifiers, curated-pool
membership, source, retrieval time, evidence hash, per-family confidence, and
teacher provenance remain stored. Fire/Water, household activity, popularity,
quality, and predicted enjoyment are forbidden StoryDNA fields.

Mango Companion's configured model is a stateless content teacher only. Its
separate localhost endpoint receives stable identity and canonical evidence—
never ratings, Saved/history, profiles, mood, conversations, or memory. Sparse
evidence can trigger bounded structured addon lookup; there is no broad
scraping. Strict ID, enum, schema, prompt/model, and evidence-hash validation
rejects partial or mismatched output while retaining valid siblings. Household
mutations rebuild taste/ranks but never StoryDNA.

The local worker fits one to three deterministic Bayesian household threads.
Categorical families use Dirichlet-multinomial posteriors; ordinal families use
regularized distributions. Candidate/thread fit is an equal-family posterior
predictive likelihood ratio against the complete verified corpus, with capped
rare-node lift and confidence shrinkage. There is no embedding, cosine/KNN,
title-to-title comparison, MMR, or cloud ranking path.

Only positive rating evidence propagates:

```text
positive(rating) = (max(0, rating - 2.5) / 2.5)^2
anchor_strength  = 0.75 * max(positive(Fire), positive(Water))
                 + 0.25 * min(positive(Fire), positive(Water))
predicted_axis   = 2.5 + 2.5 * positive_support
holistic         = 0.75 * max(predicted_fire, predicted_water)
                 + 0.25 * min(predicted_fire, predicted_water)
rank_score       = blended_affinity - 0.5 * posterior_standard_deviation
```

Ratings at or below 2.5 do not penalize related titles. Fire/Water is permanent
and origin/age independent; Saved has strength 0.8; meaningful partial viewing
has 0.55; completion has 1.0; VOD viewing has a 180-day half-life. A meaningful
watch is `min(25% of duration, 5 minutes)`, or two minutes when duration is
unknown. Bare starts are ignored. With explicit evidence it owns 85% of final
affinity and Saved/watch owns at most 15%; implicit evidence renormalizes for
cold start. Rated, Saved, meaningfully watched, hidden, blocked, and exact
Not-for-me titles never serve, but low ratings create no semantic negative.

The reserve begins serving at 200 eligible ranked rows and grows toward the
complete corpus while the prior complete generation remains active. Three
supported threads deal 2/2/2 cards, two deal 3/3, and one deals all six. Within
a thread, deterministic weighted sampling without replacement uses
`1 / rank^1.5`; the prior four rendered slates are avoided when supply permits.
Load-time DB revalidation checks verified state, artwork, uniqueness, and exact
exclusions. If six cannot be healed, Mango retains the previous valid slate.
Home and X perform no network, enrichment, graph, or ranking work.

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

## Optional seed R&D snapshot

The supplied Sheet1 was read-only and is not a runtime dependency. Current
source audit:

| Measure | Value |
|---------|------:|
| Non-empty movie rows | 56 |
| Clean numeric Fire + Water pairs | 54 |
| Rows requiring explicit human disposition | 2 |
| Mean Fire among clean rows | 3.093 |
| Mean Water among clean rows | 2.676 |
| Year range | 1975–2026 |

Unresolved rows are intentionally not guessed:

- `The idea of you` (2024): both values blank.
- `La Cocina` (2024): both cells contain ranges.

Fire distribution for the 54 clean rows: `0.5:1, 1:6, 1.5:1, 2:5,
2.5:5, 3:11, 3.5:5, 4:12, 4.5:4, 5:4`. Water distribution: `0:5,
0.5:5, 1:7, 1.5:2, 2:4, 2.5:3, 3:4, 3.5:6, 4:4, 4.5:5, 5:9`.

An approved manifest may contain normalized private taste tags and a caption
hash, but the validator rejects raw captions and sheet URLs. Every source row
must be explicitly approved or excluded. Approval requires one unique exact
title/year stable-ID match; weaker matches stay in review. Couch-authored
history always blocks later seed overwrite, including after clear.

If the operator supplies an approved manifest, run only after its reconciliation:

```bash
cd src/catalog-service
npm run ratings:seed -- dry-run /path/to/fire-water-seed-v1.json
npm run ratings:seed -- validate /path/to/fire-water-seed-v1.json
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
# Idempotence proof: repeat the exact import; this invocation must be a no-op.
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
```

The second import must report `noop: true`.

## Evaluation boundary

Deterministic local tests cover strict content-only StoryDNA, malformed-sibling
isolation, graph/worker parity, positive-only rating math, 85/15 evidence
ownership, 180-day viewing decay, distinct threads, 2/2/2–3/3–6 portfolios,
rank-weighted cached dealing, full-corpus pagination/accounting, stale
publication rejection, exact exclusions, and no graph/ranking work on X.

Promotion uses a frozen deterministic five-fold comparison against v4:
holistic nDCG@6 is primary; per-axis concordance for ratings at least 4,
both-axes-low top-six intrusion, coverage, determinism, worker latency, and
cached-service p95 are guardrails. V2 requires at least 10% relative nDCG@6
improvement, a paired 90% bootstrap interval above zero, no more than two
percentage points of guardrail regression, complete verified-corpus accounting,
and cached p95 at most 250 ms. Sparse ratings keep the model in shadow; the gate
is never weakened.

Real-corpus StoryDNA coverage and evaluation, Pi latency/restart/offline proof,
screenshots, target-TV launches, and human couch relevance remain **DEFERRED**
until the authorized home rollout. Offline promotion is necessary, not proof of
the final couch experience.

Home acceptance is in [COUCH_TEST.md](COUCH_TEST.md). Deployment remains
git-only per [DEPLOY.md](DEPLOY.md); never rsync, copy runtime databases, or
delete history/cache.
