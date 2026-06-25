# Library Grower — ops & SLA

Nightly grow runs log structured events to `~/.cache/mango/ops/events.jsonl`.
Human report:

```bash
python3 scripts/diag/ops-report.py              # yesterday PDT
python3 scripts/diag/ops-report.py --date 2026-06-21
python3 scripts/diag/ops-report.py --json
```

## Live monitoring (grow pass)

Baseline is written automatically at the start of each **grow** phase
(`playability-maintenance.sh --mode grow` or nightly phase 2).

```bash
# Snapshot baseline manually (optional)
python3 scripts/diag/grow_monitor.py baseline

# Live pool deltas vs baseline (works while catalog-service is down)
python3 scripts/diag/grow_monitor.py status
python3 scripts/diag/grow_monitor.py status --json

# Poll every 30s (Pi or Mac via pi-exec)
python3 scripts/diag/grow_monitor.py watch --interval 30 --max-polls 40

# Post-run SLA from latest refresh JSON
python3 scripts/diag/grow_monitor.py assess
```

Mac → Pi:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && python3 scripts/diag/grow_monitor.py status'
bash scripts/m3-play/playability/playability-grow.sh --status
```

Controller entrypoint:

```bash
bash scripts/m3-play/playability/grow-run-control.sh start --mode grow --preset quick
bash scripts/m3-play/playability/grow-run-control.sh benchmark   # MANGO_GROW_PER_PASS defaults to 5
bash scripts/m3-play/playability/grow-run-control.sh status
bash scripts/m3-play/playability/grow-run-control.sh watch --interval 30
bash scripts/m3-play/playability/grow-run-control.sh assess
bash scripts/m3-play/playability/grow-run-control.sh abort
```

`benchmark` is a real grow with a smaller target and budget for iteration:
`MANGO_GROW_PER_PASS=5`, `MANGO_GROW_WALL_MS=180000`, and
`MANGO_GROW_MAX_ATTEMPTS=200` by default. It also sets
`MANGO_GROW_FAIL_FAST=1`, so a benchmark stops after the first strict-short
rail. Override those env vars explicitly when a benchmark needs
production-sized patience or all-rail diagnostics.

Maintenance grow also bounds catalog fetch latency separately from couch
serving: `MANGO_CATALOG_FETCH_TIMEOUT_MS` defaults to `8000` and
`MANGO_CATALOG_COMPOSITE_FETCH_CONCURRENCY` defaults to `8` inside
`playability-maintenance.sh`. Override them explicitly for slow-source
forensics; do not let normal grows spend the full rail wall inside catalog
fetches before verification starts.

Grow reports include a bounded `candidate_audit` sample per rail
(`MANGO_GROW_CANDIDATE_AUDIT_LIMIT`, default 80). Each entry records the
candidate's original/normalized ID, source, title/year, action, stage, and
reason. Use it to distinguish theme rejects, recent-failure tombstones,
unresolved external IDs, and real stream probe failures without re-running the
same candidate by hand.

Baseline file: `~/.cache/mango/grow-baseline.json` (schema v2 — `grow_rail_ids` + per-rail verified counts).

Status counts **grow-pass rails only** (yaml browse + `ai-*` slots), excludes legacy pool entries like `popular-global`. All grow rails are always listed (including `ai-horror` while pending). During an active staged grow, status reads the isolated `playability-work-<run>.db` and labels it as `staged work DB`; after publish, abort, or idle it falls back to the live DB. The header also reports global orphan count and rail overlap health so pool hygiene is visible during long runs.

Use `~/.cache/mango/grow-run-state.json` and
`~/.cache/mango/source-grow/latest.json` as the active heartbeat during long
verify batches. `playability-grow.log` can be quiet while probe batches commit
or while the indexer is between rail phases; stale log mtime alone is not a
hang signal.

## Grow presets

| Preset | Wall | Max probes | Use |
|--------|------|------------|-----|
| `quick` | 10 min | 200 | Daily `--mode grow`, manual top-up |
| `nightly` | 90 min | 500 | Nightly timer phase 2 (stale + grow) |

The `benchmark` controller command still uses the `quick` preset, but overrides
per-rail wall/probe budgets through `MANGO_GROW_WALL_MS` and
`MANGO_GROW_MAX_ATTEMPTS` unless the operator already set them. It also enables
`MANGO_GROW_FAIL_FAST` by default; production quick/nightly grows do not.

Defaults when `MANGO_GROW_PRESET` is unset:

- `playability-grow.sh --mode grow` → **quick**
- `playability-maintenance.sh --mode nightly` → **nightly** (grow phase only)

```bash
# Daily quick grow (15:00 timer — install once on Pi)
bash scripts/m3-play/playability/install-playability-daily-grow.sh

# Manual quick grow
bash scripts/m3-play/playability/playability-grow.sh --mode grow --preset quick --detach

# Full backfill (nightly timer at 03:00 — stale then grow)
bash scripts/m3-play/playability/install-playability-timer.sh
```

## Source hit-rate weights

**Quick grow** (`--mode grow`, `--preset quick`):

- Skips preflight when `~/.cache/mango/source-hitrate/latest.json` is **< 24h** old (uses cached weights).
- Otherwise runs a **1 probe/source** sample while catalog is still up.
- If the cached report is fresh but missing newly configured sources, probes only
  those missing source keys and merges them back into the cached report.
- Progress appears in `playability-grow.log` and `grow_monitor.py status` (`phase: preflight`).

**Nightly grow** (timer phase 2, after stale + cooldown):

- Skips preflight when `~/.cache/mango/source-hitrate/latest.json` is **< 24h** old (uses cached weights).
- Otherwise runs full preflight (**3 probes/source**) immediately before the grow pass.
- Briefly restarts catalog-service for probes, then stops it for indexing.
- Force a fresh nightly source sample with `MANGO_SOURCE_HITRATE_FORCE=1`.

```bash
# Tune skip window / sample sizes
MANGO_SOURCE_HITRATE_FRESH_HOURS=24
MANGO_SOURCE_HITRATE_QUICK_PER_SOURCE=1
MANGO_SOURCE_HITRATE_NIGHTLY_PER_SOURCE=3
```

Grow reads the report and scales composite/AI catalog source weights (`MANGO_GROW_HITRATE_WEIGHTS=1`, default on). Python hit-rate reports use seconds timestamps; the TypeScript loader normalizes seconds/milliseconds before applying `MANGO_SOURCE_HITRATE_MAX_AGE_MS`. Each grow also writes runtime-only source outcomes to `~/.cache/mango/source-grow/latest.json`: scanned, queued, verified, theme-rejected, catalog errors, rate limits, exhaustion, and multiplier. These weights are advisory cache state only; catalog YAML and theme profiles are never edited automatically.

Demoted sources keep a probation path: the weighted allocator still reserves at least one fetch slot per configured source, and multipliers are clamped to a small floor (`MANGO_GROW_SOURCE_PROBATION_MULTIPLIER`, default 0.08). Catastrophic zero-yield sources drop to probation after bounded evidence (`MANGO_GROW_SOURCE_PROBATION_MIN_SAMPLES`, default 12). If a rail previously met target under weighted selection and later regresses, the runtime multipliers for that rail's touched sources reset to neutral.

Disable: `MANGO_SOURCE_HITRATE_PREFLIGHT=0` and/or `MANGO_GROW_HITRATE_WEIGHTS=0`.

Monitor phase file: `~/.cache/mango/grow-run-state.json` (also appended to `playability-grow.log`).

During the TypeScript grow loop this file is refreshed after each rail loop
with the active rail, target progress, attempts, candidates scanned,
rail-rejection skips, and any source suppressions. This is a silent operator
surface only; couch UI continues to serve the previous stable rail snapshot
unless the strict grow run succeeds.

Stage-level heartbeats are also written for preflight, candidate ingest,
verification, grow-safe retheme finalization, and publish. If a run is aborted through
`grow-run-control.sh abort`, the abort is idempotent: owned grow/indexer
processes and locks are cleared, a structured `ok:false` refresh JSON is
written, and the couch stack is restored.

## Global link pass (optional bonus)

When `MANGO_GROW_LINK_MAX` > 0, each rail grow session may link globally verified titles
(same content type, not yet in that rail pool) **before** catalog ingest — zero probes.
These links appear in `linked_global` / `linked_existing` but **do not** count toward the grow target.
Default: `MANGO_GROW_LINK_MAX=0` (off). Force off: `MANGO_GROW_GLOBAL_LINK=0`.

## Grow quota semantics

| Metric | Meaning |
|--------|---------|
| `unique_verified` | **Distinct** active verified titles in `titles` table (true library size) |
| `unique_verified_delta` | Net new unique titles since grow baseline / refresh start |
| `pool slots` / `verified_pool` | Per-rail pool entries summed — same title in 3 rails counts **3** |
| `fresh_verified` / `probe_verified` | New probe-verified titles this pass per rail — **counts toward target** |
| `new_to_rail_verified` | Strict SLA alias for the same fresh new-to-rail probe count |
| `linked_existing` | Verified titles linked from library without probing — metrics only |
| `pool_growth` | Verified pool delta per rail (fresh + links) — informational |

The grow loop exits when `new_to_rail_verified >= grow_target`, not when pool reshuffles alone.
Grow monitor header shows **unique titles** separately from **pool slots**. It
also shows orphan count and overlap caps; those are hygiene checks and do not
replace the per-rail fresh quota.

After every strict successful grow, finalization runs a grow-safe retheme pass:
active verified orphans are scored against rail themes and attached to best-fit
rails or anchor fallback, while existing pooled titles use a lightweight
overlap-only cap. Full metadata retheme remains a manual repair tool; it is not
run on every grow. Orphan attachments and overlap removals do **not** count
toward the fresh quota.

## Head tombstone advance

On the first ingest loops, when `skipped_recent_failed` dominates the page (default ≥50%),
cursors advance by `MANGO_GROW_HEAD_ADVANCE_PAGES` (default 5) without consuming deep-page reset cycles.
Tune: `MANGO_GROW_HEAD_TOMBSTONE_RATIO`, `MANGO_GROW_HEAD_ADVANCE_MAX_CYCLES`.

## Rejection ledger and source circuits

Grow writes rail-specific negative memory to `rail_candidate_rejections`:

| Reason | Default TTL | Effect |
|--------|-------------|--------|
| `theme_mismatch` / `theme_probe_skip` | 7 days | Do not probe/link this title for that rail until the theme window expires |
| `no_stream` / `title_mismatch` | ~7 days | Avoid re-testing the same stream miss during long strict grow windows |
| `unresolved_external_id` | 7 days | Avoid probing catalog rows that could not map from external IDs to verifiable IMDb IDs |
| other probe failures | 24h | Keep bounded negative memory without making failures permanent |

Tune: `MANGO_GROW_THEME_REJECTION_TTL_MS`,
`MANGO_GROW_NO_STREAM_REJECTION_TTL_MS`, `MANGO_GROW_REJECTION_TTL_MS`.
Normal grow does not bypass recent `no_stream` / `title_mismatch` tombstones
during deep cursor cycles. Use `MANGO_GROW_BYPASS_RECENT_FAILED=1` only for
explicit debug reprobes; user/voice search remains the intentional bypass path.

Within a rail run, source circuits suppress a source after bounded evidence of
rate limits, catalog errors, zero verified yield, extreme theme rejection, or
low stream hit-rate. Catalogs dominated by unresolved external IDs are treated
as source exhaustion, not stream outages. Suppression is in-memory for the active rail run; longer
term promotion/demotion still comes from runtime source-grow weights in
`~/.cache/mango/source-grow/latest.json`.
Defaults favor moving on once evidence is clear: zero-yield suppression starts
after 60 scanned candidates and low stream hit-rate suppression after 20
stream samples. Tune with `MANGO_GROW_SOURCE_NO_VERIFY_SCAN_LIMIT`,
`MANGO_GROW_SOURCE_FAIL_MIN_SAMPLES`, and `MANGO_GROW_SOURCE_FAIL_RATIO`.
Benchmark grows lower the in-memory stream and theme sample floors in proportion
to `MANGO_GROW_PER_PASS`, while production `+20` grows keep the configured
sample floors.

Audit runtime source health after grows:

```bash
python3 scripts/diag/source-grow-audit.py
python3 scripts/diag/source-grow-audit.py --rail series-india-picks
python3 scripts/diag/source-grow-audit.py --json
```

The audit reports rail-specific verified/min, theme reject rate, unresolved-ID
rate, no-stream rejection rate, duplicate pressure, cursor depth, and
probation/recovery state.

For a manual overlap repair that matches strict-grow finalization without
metadata calls or theme relocation:

```bash
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --overlap-only
```

## SLA section (PR6)

The **Library Grower SLA** block summarizes the latest **grow** phase per browse rail.

| Metric | Rule |
|--------|------|
| Per-rail target | `grow_per_pass` from catalog yaml (default **20**) |
| Thin rail signal | Rails below `display_limit` are reported, but the strict target remains `grow_per_pass` |
| Count toward target | **Fresh probe-verified** (`fresh_verified` / `probe_verified`) |
| Pool delta | `pool_growth` — includes links; **not** used for SLA pass |
| Program pass | **All active grow rails** met target (`12/13` is FAIL) |
| 80% line | Warning context only, not pass criteria |
| Exhaustion below target | FAIL with a classified cause and repair suggestion |
| AI compose escalation | Logged per rail (`compose_escalated`, `compose_fallback_level`) |

Failure categories:

| Category | Meaning |
|----------|---------|
| `rate_limited` | Addon/catalog rate limit blocked source fetch or catalog boot |
| `source_exhausted` | Configured sources returned no usable candidates |
| `theme_rejected` | Candidates were rejected by strict rail theme profiles |
| `low_stream_hit_rate` | Candidates resolved poorly during verification |
| `same_theme_fallback_exhausted` | Same-theme source space was tried but could not fill the target |
| `time_budget_exceeded` | Grow wall time or probe attempt budget ended first |
| `catalog_boot_failed` | Required VOD catalog boot failed before rails ran |

Structured failed refresh JSON is valid report input:

```bash
python3 scripts/diag/grow_monitor.py assess --refresh-json ~/.cache/mango/ops/refresh-<run>.json
```

Refresh JSON also carries benchmark target, orphan before/after, overlap
summary, duplicate candidate count, wasted candidate ratio, and retheme
finalization counters when available.

### Event sources

- `playability_maintenance` — Pi timer (`mode=nightly` grow phase, or `--mode grow`)
- `playability_growth` — catalog-service refresh when `mode=grow`

Stale-only passes do not appear in the SLA table.

## Regression gate

After grow pipeline changes:

```bash
bash scripts/m3-play/playability/gate-m3-library-grow.sh
```

## Current diagnostics — 2026-06-24

Use this as context before another strict nightly grow investigation.

- Source expansion can be **catalog-rich but not playable-rich**. The 2026-06-24
  Pi grow showed `series-miniseries` reach `0/20` after 74 no-stream probe
  failures; its source audit was dominated by probation/no-stream or
  theme-rejected MDBList catalogs. `series-india-picks` similarly showed Bharat
  regional series catalogs with poor/no stream yield despite valid catalog
  supply.
- Hit-rate preflight must cover every active source. Commit `7dc282a` made
  stale reports invalid when configured sources are missing. Commit `167a1bb`
  then fixed source-hitrate reports to keep zero-sample catalog error rows so
  failed catalogs do not disappear from coverage and force preflight forever.
- Probation must be a **small budget**, not one fetch per demoted source per
  page. Commit `167a1bb` changed composite allocation so active sources get most
  fetch slots while probation sources are sampled through a rotating 5-10%
  budget.
- The grow state heartbeat used to be rail-loop scoped only. It now writes
  stage-level progress for preflight, candidate ingest, verification,
  grow-safe retheme, and publish. If status stalls, inspect the reported stage
  before killing the process.
- Orphans are possible because the global `titles` table is independent of
  `rail_pool`. A title can be verified globally without a rail attachment after
  stale pruning, failed/theme-rejected linking, manual retheme dry-runs, or
  workflows that verify/search outside a rail. Strict successful grow
  finalization now runs best-fit orphan attachment automatically; use
  `rail-pool-retheme.sh apply --include-orphans` for manual repair.
- Current hardening defaults skip recent `no_stream` / `title_mismatch` grow
  misses for about seven days and remove the previous deep-page bypass unless
  `MANGO_GROW_BYPASS_RECENT_FAILED=1` is set for debug.
- Remaining source-design question: add stronger India OTT service-specific
  sources (SonyLIV, ZEE5, Hotstar/JioCinema style catalogs if available through
  Stremio-compatible metadata) and keep promoting them only after measured
  verified thematic yield.

## Related scripts

| Script | Use |
|--------|-----|
| `scripts/m3-play/playability/grow-run-control.sh` | Single operator path for start, benchmark, status, watch, assess, abort |
| `scripts/m3-play/playability/playability-grow.sh` | Manual grow / stale / nightly (`--status` → grow_monitor) |
| `scripts/diag/grow_monitor.py` | Baseline, live status, watch, assess |
| `scripts/diag/ops_grow_sla.py` | SLA logic (imported by ops-report + grow_monitor) |
| `scripts/diag/playability-status.py` | Live pool snapshot via catalog API (couch up) |
