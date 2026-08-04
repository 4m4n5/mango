# Fire & Water ratings and For You

**Branch:** `feat/native-experience`
**State:** profile-aware deterministic recommendation code is implemented and
covered by local deterministic gates. It has **not** been claimed deployed by
this work session. Seed reconciliation,
Pi/runtime proof, screenshots, and human couch-quality verdict are **DEFERRED**.

## Product contract

- Fire measures fun, energy, tension, pace, and spectacle.
- Water measures emotional depth, heart, authenticity, and resonance.
- Both axes are required, use 0–5 in 0.5 increments, and treat 0 as a real rating.
- Movies are rated per title; series are rated once at show level.
- Household retains the imported seed ratings. Optional personal profiles start
  clean and own later couch ratings; clear removes only current state and keeps
  append-only history.
- Movies and TV Shows each own one stable **For You** rail. It does not consume the three user-created AI-catalog slots.
- Each visible For You rail contains exactly six currently verified-playable
  cards: four close, one adjacent, and one bounded surprise. If its reserve
  cannot heal all six slots, Mango omits the rail.
- The TV attributes personalization to the active profile and explicit mood,
  but never displays content IDs, predictions, scores, raw captions, private
  tags, or AI jargon.

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
only to Household. Profiles require no PIN and Mango does
not show a startup chooser. Create never activates; rename keeps the stable ID;
activation is explicit and clears the temporary mood. Onboarding is guided but
skippable and becomes complete only through an explicit TV/companion action.
`mango_manage_viewer_profile` exposes list/create/rename/activate/onboarding to
the companion. Personal profiles begin clean; Household preserves legacy data
and blends recommendation/history activity while treating any exact Not-for-me
as a veto. Exact resume positions never blend across viewers.

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

## Deterministic recommendation model

Candidate generation starts with Mango's globally active verified movie/series
corpus. Rated, hidden, blocked, active-profile Not-for-me, invalid, and
unverified titles are removed before scoring; load-time revalidation omits the
entire rail if the 4/1/1 visible contract cannot be healed. A current verified
row is not a substitute for target-TV playback proof. Household aggregates exact dislikes as vetoes. Saved and watch
events are confidence-weighted supporting evidence, not replacements for
explicit Fire/Water. A completed VOD can return only through the rare internal
rewatch lane after its cooldown.

Metadata features are dependency-light hashed vectors. The runtime predicts
Fire and Water independently from at most 12 neighbors with cosine similarity
at least 0.15. Weight is squared similarity times feature confidence and domain
weight. Each axis shrinks toward the active viewer/domain mean with prior weight
2.0, and very low evidence is pulled toward the neutral editorial prior. TV
cold-start accepts movie evidence at weight 0.6, decaying linearly to zero at
12 series ratings; Movies never borrow series evidence.

```text
holistic = 0.75 × max(predicted_fire, predicted_water)
          + 0.25 × min(predicted_fire, predicted_water)
```

This admits a strong single-axis match while rewarding high-high balance. The
visible selection is **4 close + 1 adjacent + 1 bounded surprise**. A 75%
affinity / 25% diversity MMR pass, global cluster caps, profile-scoped exact
vetoes, and deterministic rotation prevent one source theme or prolific viewer
from dominating Household. Short-horizon session/mood signals respond quickly;
long-horizon ratings, saves, completions, and cooled rewatches preserve durable
taste. An early exit is never a negative signal.

AI enrichment is asynchronous and optional: it can attach versioned semantic
features, confidence, and provenance to candidates, but it cannot decide
eligibility or publish a slate. The local versioned ranker owns scoring and
diversity. Cached documents are loaded in bounded SQL batches, semantic
features for watched/Saved preference anchors are retained, and feature writes
share one prepared transaction. CPU-heavy scoring/MMR runs in a
deadline-bounded worker rather than the catalog HTTP event loop. Couch reads
use the last complete local snapshot and never wait for cloud AI. UI
attribution names the active profile/mood and uses honest rail context;
numerical scores and technical generation reasons remain private.

`MANGO_RECOMMENDATION_RANK_WORKER=0` is a diagnostic opt-out only; the default
is worker-on. `MANGO_RECOMMENDATION_RANK_TIMEOUT_MS` defaults to 30 seconds and
retains the last-good snapshot on timeout.

Accepted rating/watch changes enqueue a captured-profile refresh through one
serialized, coalescing queue against cached verified candidates. Nightly
companion work skips both the playability lock and active foreground playback,
then atomically refreshes snapshots after optional LLM/gardener work. Any
failure retains the previous complete snapshot.

Feature flags are reversible and never delete state:

```bash
MANGO_FIRE_WATER_RATINGS=0
MANGO_FOR_YOU=0
MANGO_RECOMMENDATIONS_AI=0
```

## Seed R&D snapshot

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

Run only after reconciliation:

```bash
cd src/catalog-service
npm run ratings:seed -- dry-run /path/to/fire-water-seed-v1.json
npm run ratings:seed -- validate /path/to/fire-water-seed-v1.json
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
```

The second import must report `noop: true`.

## Evaluation boundary

Deterministic local tests prove half-step validation, identity collapse,
revision conflicts, couch-over-seed precedence, append-only clear history,
profile isolation and Household aggregation, prompt eligibility, independent
axes, high-single-axis qualification, high-high bonus, TV transfer decay,
deterministic 4/1/1 slates, cooled rewatch admission, duplicate removal, rail
order, immutable served attribution, profile-exact progress, and no raw source
text in public rating state. Deterministic leave-one-out Fire/Water/affinity MAE
is implemented and persisted per active profile/tab; slate diagnostics cover
recall, nDCG, diversity, calibration, typed-universe coverage, and profile gaps.

Real reconciled-seed metric values, held-out/top-24 human review, stable-ID match
evidence, metadata/AI feature coverage, Pi latency, offline/restart survival,
screenshots, target-TV playback of visible recommendations, and human couch
recommendation quality are **DEFERRED** until the reconciled seed is available
and the home agent observes the target TV. Offline metrics alone will not be
treated as proof of recommendation quality.

Home acceptance is in [COUCH_TEST.md](COUCH_TEST.md). Deployment remains
git-only per [DEPLOY.md](DEPLOY.md); never rsync, copy runtime databases, or
delete history/cache.
