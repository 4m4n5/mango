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

Grow reads the report and scales composite/AI catalog source weights (`MANGO_GROW_HITRATE_WEIGHTS=1`, default on).

Disable: `MANGO_SOURCE_HITRATE_PREFLIGHT=0` and/or `MANGO_GROW_HITRATE_WEIGHTS=0`.

Monitor phase file: `~/.cache/mango/grow-run-state.json` (also appended to `playability-grow.log`).

## Global link-first pass

Each rail grow session links globally verified titles (same content type, not yet in that rail pool)
**before** catalog ingest — zero probes. Counts toward `linked_global` / `linked_existing`.
Disable: `MANGO_GROW_GLOBAL_LINK=0`.

## Head tombstone advance

On the first ingest loops, when `skipped_recent_failed` dominates the page (default ≥50%),
cursors advance by `MANGO_GROW_HEAD_ADVANCE_PAGES` (default 5) without consuming deep-page reset cycles.
Tune: `MANGO_GROW_HEAD_TOMBSTONE_RATIO`, `MANGO_GROW_HEAD_ADVANCE_MAX_CYCLES`.

## SLA section (PR6)

The **Library Grower SLA** block summarizes the latest **grow** phase per browse rail.

| Metric | Rule |
|--------|------|
| Per-rail target | `grow_per_pass` from catalog yaml (default **20**) |
| Sparse tier | When `verified_before < display_limit` (9), target is **2×** (40) |
| Count toward target | **Pool growth** (`pool_growth` / verified pool delta) |
| Program pass | **≥80%** of rails met target |
| Exhaustion below target | **WARN** in report; nightly gate still passes |
| AI compose escalation | Logged per rail (`compose_escalated`, `compose_fallback_level`) |

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
