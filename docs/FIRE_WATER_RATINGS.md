# Fire & Water ratings and For You

**Branch:** `feat/native-experience`
**State:** deterministic ratings and recommendation core complete locally;
seed reconciliation, AI-enriched feature evaluation, Pi proof, screenshots,
and couch-quality verdict are **DEFERRED**.

## Product contract

- Fire measures fun, energy, tension, pace, and spectacle.
- Water measures emotional depth, heart, authenticity, and resonance.
- Both axes are required, use 0–5 in 0.5 increments, and treat 0 as a real rating.
- Movies are rated per title; series are rated once at show level.
- The household can edit or clear ratings. Clear removes only current state; the event history remains.
- Movies and TV Shows each own one stable **For You** rail. It does not consume the three user-created AI-catalog slots.
- The TV never displays predictions, scores, explanations, raw captions, or AI jargon.

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

Ratings use canonical `movie|series` plus stable ID identity rather than addon
source. Series episode identities collapse internally, while couch API calls
must use the bare show ID. Half-steps are stored as integers 0–10. Writes use an
expected revision; stale writes return 409. Rating persistence commits before
reranking, so recommendation failure can never lose a valid rating.

Routes:

```text
GET    /library/ratings?type=&id=
PUT    /library/ratings
DELETE /library/ratings?type=&id=&expected_revision=
POST   /library/rating-prompts/dismiss
GET    /recommendations/state
POST   /recommendations/refresh
```

Movie prompts become eligible at Mango's existing 90% finish threshold. Series
prompts become eligible after three distinct completed episodes; the persistence
path also accepts the explicit `season_finale_finished` event when episode
metadata proves a finale. The invitation appears on return in Detail, never
opens automatically, and never takes focus.

## Deterministic recommendation model

Candidate generation starts with Mango's globally active verified movie/series
corpus. Rated, hidden, blocked, Not Interested, invalid, and unverified titles
are removed. Saved, started, and completed titles are used only if fewer than
six untouched candidates survive.

Metadata features are dependency-light hashed vectors. The runtime predicts
Fire and Water independently from at most 12 neighbors with cosine similarity
at least 0.15. Weight is squared similarity times feature confidence and domain
weight. Each axis shrinks toward the household mean with prior weight 2.0. TV
cold-start accepts movie evidence at weight 0.6, decaying linearly to zero at
12 series ratings; Movies never borrow series evidence.

```text
holistic = 0.75 × max(predicted_fire, predicted_water)
          + 0.25 × min(predicted_fire, predicted_water)
```

This admits a strong single-axis match while rewarding high-high balance. Rail
selection targets 8 close matches, 3 adjacent discoveries, and 1 deterministic
daily exploration card. A 75% affinity / 25% diversity MMR pass and cluster
caps prevent one source theme from dominating. The launcher receives 12 plain
cards from a 40-item last-good reserve. Snapshot scores and reasons remain
private in SQLite.

Immediate rating changes recompute against cached verified candidates. Nightly
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
prompt eligibility, independent axes, high-single-axis qualification, high-high
bonus, TV transfer decay, deterministic 8/3/1 replay, duplicate removal, rail
order, and no raw source text in public rating state.

Leave-one-out MAE, held-out top-10 diagnostics, top-24 human review, stable-ID
match evidence, metadata/AI feature coverage, Pi latency, offline/restart
survival, screenshots, actual playability of visible recommendations, and human
couch recommendation quality are **DEFERRED** until the reconciled seed is
available and the home agent observes the target TV. Offline seed metrics alone
will not be treated as proof of recommendation quality.

Home acceptance is in [COUCH_TEST.md](COUCH_TEST.md). Deployment remains
git-only per [DEPLOY.md](DEPLOY.md); never rsync, copy runtime databases, or
delete history/cache.
