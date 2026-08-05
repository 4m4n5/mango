# Starter prompt — work agent (StoryDNA bulk corpus + incremental couch path)

Paste into a **fresh work-Mac** agent session on `feat/native-experience`.

Home Pi paused live one-at-a-time teacher spend. Existing Pi StoryDNA tags must
be preserved. Do **not** SSH to the Pi; ship code + offline tooling + import
contract for the home agent to apply later via git-only deploy.

```text
Work in the mango repo on branch feat/native-experience.

Mission: stop treating StoryDNA as a couch-time LLM marathon. Build a bulk /
offline path that can tag the current verified-playable VOD library once, then
wire Mango so the Pi / companion couch path only teachers NEW titles that enter
the playable library (plus cheap local rank/taste refresh). Preserve any
already-tagged StoryDNA already present on the household Pi.

Context (home Pi, paused 2026-08-05; do not treat as live authority without
re-check by home agent):

- APPROVED_SHA (immutable ship baseline for that home deploy):
  c1f76e36ebbbd43c17c903f919abf2248da25b5f
- TARGET_SHA currently on Pi after teacher reliability fix:
  20d10fc65330178b0de21999c5e41a6bdc4a0183
- Modes left safest-proven: MANGO_VOD_RECS_V2=shadow,
  MANGO_YOUTUBE_RECS_V2=off, MANGO_STORY_DNA_AUTONOMOUS_BACKFILL=0
- Durable teacher cache table: recommendation_features where
  feature_version='story-dna-v1' and provenance='ai'
- Pi pause snapshot (aggregates): ~1096 story-dna feature rows;
  latest generation complete_count ~545 movies / ~439 series against
  ~5452 / ~3794–3904 verified titles. Backlog remaining is large.
- Live Pi one-at-a-time backfill was stopped because provider cost/latency make
  full-corpus teacher work unsuitable on the couch box.

══════════════════════════════════════════════════════════════════
HARD BOUNDARIES
══════════════════════════════════════════════════════════════════

- Branch: feat/native-experience only. No force-push, no main switch.
- No Pi SSH, no rsync/scp of DBs or secrets, no printing API keys / voice.env /
  raw ratings / Takeout / household history.
- Do not purge playability rail_pool / verified library when changing rails.
- Do not invent a second ontology. StoryDNA schema/ontology/prompt versions in
  src/catalog-service/src/recommendations/story-dna.ts and
  src/orchestrator/orchestrator/recommendation_enrich.py must stay aligned.
- Teacher remains content-only: no household ratings, Saved/watch, profiles,
  mood, companion memory, popularity, or predicted enjoyment in teacher input.
- Local graph/thread/rank/deal/publish stays deterministic and local.
- Preserve merge semantics for already-tagged titles: never wipe
  recommendation_features story-dna-v1 rows just to make a gate green.

══════════════════════════════════════════════════════════════════
PRODUCT INTENT (locked by human)
══════════════════════════════════════════════════════════════════

1) Bulk / offline (work agent owns design + implementation):
   Tag the current verified-playable movie+series corpus with strict
   story-dna-v1 documents efficiently (batched provider calls, retries,
   resumable progress, deterministic validation). Output must be importable
   onto the Pi without hand-editing Pi source.

2) Couch / companion incremental path (work agent owns wiring):
   After the bulk corpus exists, the Pi must NOT re-teacher the whole library
   on refresh. On playability verify / library growth, only missing or
   evidence-changed titles may be queued for StoryDNA. Rank/taste/reserve
   refresh stays local and cheap.

3) Home agent later:
   Imports the bulk artifact(s) via a documented git-deployed tool, merges with
   existing Pi tags, re-runs local rank generations in shadow, then continues
   promotion gates. You design that import contract; you do not run it on Pi.

══════════════════════════════════════════════════════════════════
PHASE A — UNDERSTAND CURRENT CONTRACT
══════════════════════════════════════════════════════════════════

Read and summarize (briefly, in your plan):

- story-dna.ts / recommendation_enrich.py teacher schema + provenance hashes
- refreshStoryDnaTeacherCache + recommendation_features persistence (ai.ts)
- story-graph-service teacher batching, backlog, autonomous backfill flags
- How input_hash / evidence_hash / model_version / prompt_version gate cache hits
- Why live Pi backfill stalled / burned money (batch=1..4, serialized orch,
  ~9k titles, flaky ontology slips) — fix the architecture, not just knobs

══════════════════════════════════════════════════════════════════
PHASE B — DESIGN (ask human only if blocked)
══════════════════════════════════════════════════════════════════

Propose and then implement (after a short plan the human can skim):

A. Offline bulk teacher runner (work-Mac capable)
   - Input: export of verified-playable catalog evidence only (type/id/title/year
     + canonical content evidence fields already used by storyDnaRequestItem).
     No household private tables in the export.
   - Throughput: large provider batches where schema allows; resumable cursor;
     per-title success/failure ledger; coerce/retry for known teacher slips
     (pipe-strings, none-cooccurrence, unknown tokens) without inventing labels.
   - Output artifact: versioned, privacy-safe StoryDNA document pack + manifest
     (counts, model/prompt/ontology versions, content-id coverage, failures).
   - Must be able to skip ids already present in an optional “already tagged”
     id list so home can avoid re-paying for the ~1096 Pi cache hits.

B. Pi import / merge tool (shipped in repo; home runs later)
   - Merge into recommendation_features story-dna-v1 without deleting good rows.
   - Recompute/refresh vod story-graph generations from cache (local only).
   - Refuse to import mismatched schema/ontology/prompt versions.
   - Idempotent re-import.

C. Incremental couch wiring
   - Default: MANGO_STORY_DNA_AUTONOMOUS_BACKFILL off for full-corpus grind.
   - On newly verified / evidence-changed titles only: enqueue bounded teacher
     work (small batch, rate-limited).
   - Ordinary /recommendations/refresh and nightly playability must not attempt
     full-corpus LLM backfill when coverage is already “bulk-complete”.
   - Document the exact flags and code paths.

D. Tests
   - Unit/contract tests for export shape, import merge, skip-already-tagged,
     incremental enqueue only for missing ids, and no household fields in teacher
     payloads (exact-SHA privacy tests where the repo already has them).

══════════════════════════════════════════════════════════════════
DELIVERABLES
══════════════════════════════════════════════════════════════════

1) Implementation on feat/native-experience (commits you create as needed).
2) Operator docs: how home exports evidence (or uses an agreed sanitized
   snapshot), runs/receives bulk pack, imports on Pi, verifies coverage counts.
3) A short handoff note for the home agent: flags to keep, import commands,
   what “bulk-complete” means, and what remains for shadow→serve promotion.
4) Do not claim public v2 rails from shadow. Do not promote serve yourself.

When design choices conflict (provider choice, pack format, where bulk runs),
prefer: cheapest correct ontology-bound documents, resumable, merge-safe on Pi,
and a couch path that only pays for new playable titles.
```

## Home status when this prompt was written

| Item | Value |
|------|-------|
| Pi git | `20d10fc65330178b0de21999c5e41a6bdc4a0183` |
| VOD mode | `shadow` |
| YouTube mode | `off` |
| Autonomous StoryDNA backfill | `0` (paused) |
| StoryDNA feature cache rows | ~1096 |
| Latest gen complete (movie/series) | ~545 / ~439 |
| Live backfill driver | stopped; tags preserved |

Home agent must re-verify aggregates on the Pi before import; do not delete Pi
`recommendation_features` story-dna rows while waiting for the bulk pack.
