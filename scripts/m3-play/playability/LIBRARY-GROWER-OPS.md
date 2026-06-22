# Library Grower — ops & SLA

Nightly grow runs log structured events to `~/.cache/mango/ops/events.jsonl`.
Human report:

```bash
python3 scripts/diag/ops-report.py              # yesterday PDT
python3 scripts/diag/ops-report.py --date 2026-06-21
python3 scripts/diag/ops-report.py --json
```

## SLA section (PR6)

The **Library Grower SLA** block summarizes the latest **grow** phase per browse rail.

| Metric | Rule |
|--------|------|
| Per-rail target | `grow_per_pass` from catalog yaml (default **20**) |
| Sparse tier | When `verified_before < display_limit` (9), target is **2×** (40) |
| Count toward target | **Probe-verified only** (`probe_verified`) |
| Program pass | **≥80%** of rails met target |
| Exhaustion below target | **WARN** in report; nightly gate still passes |
| AI compose escalation | Logged per rail (`compose_escalated`, `compose_fallback_level`) |

### Event sources

- `playability_maintenance` — Pi timer (`mode=nightly` grow phase, or `--mode grow`)
- `playability_growth` — catalog-service refresh when `mode=grow`

Stale-only passes do not appear in the SLA table.

## Related scripts

| Script | Use |
|--------|-----|
| `scripts/m3-play/playability/playability-grow.sh` | Manual grow / stale / nightly |
| `scripts/diag/ops_grow_sla.py` | SLA logic (imported by ops-report) |
| `scripts/diag/playability-status.py` | Live pool snapshot |
