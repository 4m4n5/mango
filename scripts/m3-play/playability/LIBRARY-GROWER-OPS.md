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

Baseline file: `~/.cache/mango/grow-baseline.json` (schema v2 — `grow_rail_ids` + per-rail verified counts).

Status counts **grow-pass rails only** (yaml browse + `ai-*` slots), excludes legacy pool entries like `popular-global`. All grow rails are always listed (including `ai-horror` while pending).

## Grow presets

| Preset | Wall | Max probes | Use |
|--------|------|------------|-----|
| `quick` | 10 min | 200 | Daily `--mode grow`, manual top-up |
| `nightly` | 90 min | 500 | Nightly timer phase 2 (stale + grow) |

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
- Progress appears in `playability-grow.log` and `grow_monitor.py status` (`phase: preflight`).

**Nightly grow** (timer phase 2, after stale + cooldown):

- Always runs full preflight (**3 probes/source**) immediately before the grow pass.
- Briefly restarts catalog-service for probes, then stops it for indexing.

```bash
# Tune quick skip window / sample sizes
MANGO_SOURCE_HITRATE_QUICK_FRESH_HOURS=24   # skip quick preflight when newer
MANGO_SOURCE_HITRATE_QUICK_PER_SOURCE=1
MANGO_SOURCE_HITRATE_NIGHTLY_PER_SOURCE=3
```

Grow reads the report and scales composite/AI catalog source weights (`MANGO_GROW_HITRATE_WEIGHTS=1`, default on). Each grow also writes runtime-only source outcomes to `~/.cache/mango/source-grow/latest.json`: scanned, queued, verified, theme-rejected, catalog errors, rate limits, exhaustion, and multiplier. These weights are advisory cache state only; catalog YAML and theme profiles are never edited automatically.

Demoted sources keep a probation path: the weighted allocator still reserves at least one fetch slot per configured source, and multipliers are clamped to a small floor. If a rail previously met target under weighted selection and later regresses, the runtime multipliers for that rail's touched sources reset to neutral.

Disable: `MANGO_SOURCE_HITRATE_PREFLIGHT=0` and/or `MANGO_GROW_HITRATE_WEIGHTS=0`.

Monitor phase file: `~/.cache/mango/grow-run-state.json` (also appended to `playability-grow.log`).

During the TypeScript grow loop this file is refreshed after each rail loop
with the active rail, target progress, attempts, candidates scanned,
rail-rejection skips, and any source suppressions. This is a silent operator
surface only; couch UI continues to serve the previous stable rail snapshot
unless the strict grow run succeeds.

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
Grow monitor header shows **unique titles** separately from **pool slots**.

## Head tombstone advance

On the first ingest loops, when `skipped_recent_failed` dominates the page (default ≥50%),
cursors advance by `MANGO_GROW_HEAD_ADVANCE_PAGES` (default 5) without consuming deep-page reset cycles.
Tune: `MANGO_GROW_HEAD_TOMBSTONE_RATIO`, `MANGO_GROW_HEAD_ADVANCE_MAX_CYCLES`.

## Rejection ledger and source circuits

Grow writes rail-specific negative memory to `rail_candidate_rejections`:

| Reason | Default TTL | Effect |
|--------|-------------|--------|
| `theme_mismatch` / `theme_probe_skip` | 7 days | Do not probe/link this title for that rail until the theme window expires |
| `no_stream` / `title_mismatch` | 24h | Avoid re-testing the same stream miss during long strict grow windows |
| other probe failures | 24h | Keep bounded negative memory without making failures permanent |

Tune: `MANGO_GROW_THEME_REJECTION_TTL_MS`,
`MANGO_GROW_NO_STREAM_REJECTION_TTL_MS`, `MANGO_GROW_REJECTION_TTL_MS`.

Within a rail run, source circuits suppress a source after bounded evidence of
rate limits, catalog errors, zero verified yield, extreme theme rejection, or
low stream hit-rate. Suppression is in-memory for the active rail run; longer
term promotion/demotion still comes from runtime source-grow weights in
`~/.cache/mango/source-grow/latest.json`.

Audit runtime source health after grows:

```bash
python3 scripts/diag/source-grow-audit.py
python3 scripts/diag/source-grow-audit.py --rail series-india-picks
python3 scripts/diag/source-grow-audit.py --json
```

The audit reports rail-specific verified/min, theme reject rate, no-stream
rejection rate, duplicate pressure, cursor depth, and probation/recovery state.

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

### Event sources

- `playability_maintenance` — Pi timer (`mode=nightly` grow phase, or `--mode grow`)
- `playability_growth` — catalog-service refresh when `mode=grow`

Stale-only passes do not appear in the SLA table.

## Regression gate

After grow pipeline changes:

```bash
bash scripts/m3-play/playability/gate-m3-library-grow.sh
```

## Related scripts

| Script | Use |
|--------|-----|
| `scripts/m3-play/playability/playability-grow.sh` | Manual grow / stale / nightly (`--status` → grow_monitor) |
| `scripts/diag/grow_monitor.py` | Baseline, live status, watch, assess |
| `scripts/diag/ops_grow_sla.py` | SLA logic (imported by ops-report + grow_monitor) |
| `scripts/diag/playability-status.py` | Live pool snapshot via catalog API (couch up) |
