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
