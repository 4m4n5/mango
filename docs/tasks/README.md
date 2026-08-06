# Mango task specs and evidence

Task files are implementation contracts, rollout prompts, and exact historical
reports. They are not the current product specification. Read
[`../STATUS.md`](../STATUS.md), [`../DECISIONS.md`](../DECISIONS.md), and the
relevant subsystem doc first.

## Lifecycle

| Label | Meaning |
|-------|---------|
| Active implementation | Next source work that is not yet implemented |
| Current design record | Approved design/source rationale; runtime status still comes from STATUS |
| Rollout contract | Commands/guards for a named SHA or mode; may be superseded by later architecture |
| Historical evidence | Immutable observation for its exact SHA/config/contract only |
| Superseded UX snapshot | Useful design archaeology; not current layout/count/focus truth |

## Current source work

`a60d1c0c25d2bbe3b2cc1cd7704da20325039630` is the deployed recommendation
target: bounded progressive Household VOD and authoritative
subscription/history YouTube v2 are the sole executable recommenders;
historical data/schema remains. The catalog suite passes 895/895, launcher
deterministic tests pass 87/87, orchestrator tests pass 106/106, and launcher/
companion builds pass at executable ancestor `7a8bc1b`; focused current-target
tests cover paged-score parity, generation/prior reuse, couch maintenance,
conditional More Like, preservation, ownership, Shuffle, active pointers, and
migrations. The
Pi deployment/accounting/memory/latency/launch gates pass; the current
authenticated India YouTube account has 55 subscriptions, 2,872 Takeout watch
events, and healthy v2.4 reserves with a rolling 30-day exact-video cooldown;
VOD cyclic shuffle proof covers 100 X
presses per tab. The deploy wrappers
remain independently blocked by branch/SHA and implicit AIOMetadata-mutation
defects, so future changes still use the reviewed manual path.

## Current design records

| File | Scope |
|------|-------|
| [RECOMMENDATIONS_LATEST_ONLY_CLEANUP.md](RECOMMENDATIONS_LATEST_ONLY_CLEANUP.md) | Exact source-cleanup record for `345535d`; source truth, not Pi/couch proof |
| [RECOMMENDATIONS_SIMPLIFY_IMPLEMENTATION_PLAN.md](RECOMMENDATIONS_SIMPLIFY_IMPLEMENTATION_PLAN.md) | Approved Household Story Graph and YouTube v2 product design |
| [RECOMMENDATIONS_SIMPLIFY_WORK_AGENT_PROMPT.md](RECOMMENDATIONS_SIMPLIFY_WORK_AGENT_PROMPT.md) | Source implementation contract that produced the current redesign |
| [RECOMMENDATIONS_STORYDNA_BULK_WORK_AGENT_PROMPT.md](RECOMMENDATIONS_STORYDNA_BULK_WORK_AGENT_PROMPT.md) | Superseded whole-corpus bulk/import proposal; retain as planning input only if measured progressive coverage/quality gaps justify it |
| [m6-4k-fidelity.md](m6-4k-fidelity.md) | Detailed 4K SDR/HDR experiments and native architecture boundary |

## Rollout and acceptance records

- `RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md` and
  `RECOMMENDATIONS_PROGRESSIVE_FRONTIER_HOME_AGENT_PROMPT.md` are the current
  exact-SHA home rollout contract. They require WAL-safe library/playability
  backups, preserved state, VOD-first shadow proof, independent promotion, and
  explicit human-couch deferral. Do not substitute `345535d` or `3ef1b20`.

- `RECOMMENDATIONS_HOME_PI_CODEX_SPEC.md` is an older rollout contract whose
  sequential one-title StoryDNA backfill assumption is superseded. Its former
  mandatory bulk-next instruction is also superseded by the committed
  progressive compiler/frontier; use the successor requirements above only as
  input to a new reviewed rollout.
- `FULL_COUCH_UX_HOME_ACCEPTANCE_CODEX_SPEC.md`, controller/search/ops home-agent
  prompts, and the M5/M6 round specs remain useful for their named releases, but
  the executable current acceptance suite is [`../COUCH_TEST.md`](../COUCH_TEST.md).
- `FIRE_WATER_HOME_ACCEPTANCE_REPORT.md` proves the earlier v4 rating UI/seed
  rollout, not the current six-card v2 recommendation rail.
- `FULL_COUCH_UX_HOME_ACCEPTANCE_REPORT.md`, `RECOMMENDATIONS_HOME_PI_REPORT.md`,
  OPS reports, and Fire/Water reports are historical evidence. Preserve their
  facts; do not modernize their verdicts.

## UX round snapshots

Files under `ux-round/` document prior visual rounds. Poster/card counts,
safe-area assumptions, HUD/modal layouts, and focus behavior can be superseded.
Current truth lives in the launcher/mpv source, [`../DECISIONS.md`](../DECISIONS.md),
and [`../COUCH_TEST.md`](../COUCH_TEST.md).

## Local-only files

An operator may have untracked task prompts/specs in this directory. Their
presence does not make them branch truth. Preserve them untouched unless the
user explicitly places them in scope.

At the 2026-08-04 audit, the untracked `OPS_HEALTH_CODEX_PROMPT.md` and
`OPS_HEALTH_CODEX_SPEC.md` mixed the still-open intentional-display-sleep work
with superseded assumptions about controller recovery, single-window, voice,
and Live gaps. They were deliberately left untouched, but must not be executed
as a current contract without a fresh source reconciliation.
