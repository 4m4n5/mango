# Recommendation architecture cleanup record

## Result

Mango now has one executable recommendation architecture per domain:

- VOD: deterministic progressive content profiles, Household Bayesian taste
  threads, full verified-corpus rank generations, and cached six-card dealing.
- YouTube: authoritative subscription/history provenance, atomic local
  generations, and cached v2 rails.

## Removed executable code

VOD no longer contains the semantic-hash-v4 engine, cosine/KNN/MMR dealer,
legacy rank worker, v4 snapshot loader/fallback, strict complete-StoryDNA
publication mode, corpus-wide teacher backfill, or old evaluation comparison
path. The strict StoryDNA schema/teacher remains only for immutable overlays
and the bounded frontier.

YouTube no longer contains generic Popular, Fresh Finds, Because You Watched,
profile/mood/companion taste scoring, generic For You reservoirs, AI Home rails,
chart acquisition, legacy live acquisition, or destructive fresh-start/reset
APIs. Search and user-created AI catalog seed acquisition remain separate
product features and cannot create recommendation provenance.

## Preserved data and compatibility

No data deletion migration was added. Existing ratings, Saved, watch history,
profiles, playability, semantic evidence, StoryDNA documents, rank generations,
served-slate attribution, YouTube cache/provenance, and provider ledgers remain.
Historical tables, columns, indexes, and migration records also remain intact.
Their legacy runtime CRUD is not exported, but an older reviewed Git revision
can still read the rows if code rollback is required.

Loaders preserve public card, rail, attribution-token, and HTTP 202 job shapes.
Off/shadow/serve flags are rollout controls, not selectors for deleted ranking
implementations. `off` disables recommendations; `shadow` builds only the
latest architecture; `serve` exposes its published generations.

## Proof boundary

Local catalog tests and launcher build validate source behavior. Pi exact-SHA,
database backup, generation health, reserve depth, cached latency, provider
silence, D-pad/focus, launch success, and human thematic satisfaction must be
proved on the home Pi using
[`RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md`](RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md).

## Post-commit audit blockers

The cleanup record is not deployment authorization. A source audit at
`345535d` found: YouTube `off` ownership can 409 for a non-Household profile;
VOD shadow and serve disagree on Saved ownership; launcher Shuffle reports
success in VOD off/shadow without a public For You slate; diagnostics do not
prove active/previous serving pointers; YouTube AI-catalog management no longer
maps to Home rendering; and focused service/mode/migration/publication tests
must replace coverage deleted with the old engines. The linked runbook is
blocked until a tested successor SHA closes these gaps.
