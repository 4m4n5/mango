# N3c inventory — playability index

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n3c/gate-n3c-verified-rails.sh`

---

## What it does

Wide ingest → stream filter → mpv probe → SQLite. Launcher shows **verified-only** posters (`GET /rails/:id/items`).

Hit-rate promise: **100% on shown posters**, not all upstream titles (~25–40% verify yield).

---

## Commands

| Command | Purpose |
|---------|---------|
| `playability-indexer.ts refresh --all --mode full\|stale` | Global dedupe + parallel probe (maintenance) |
| `playability-indexer.ts top-up --rail <id>` | Single-rail fill (couch background) |
| `playability-maintenance.sh [--mode full\|stale]` | Stop UI, stop catalog-service, refresh, restore couch |
| `playability-status.py --all` | Pool depth per rail |
| `gate-n3c-verified-rails.sh` | Sampled play gate (2/rail default) |

---

## Maintenance window (N3c-M)

Env set by `playability-maintenance.sh` and timer @ 03:00:

| Knob | Value |
|------|-------|
| `MANGO_MAINTENANCE_MODE` | 1 |
| `MANGO_PLAYABILITY_PROBE_POOL` | 1 (persistent mpv IPC) |
| `MANGO_PLAYABILITY_BATCH_DB` | 1 |
| `MANGO_PLAYABILITY_RESOLVE_CONCURRENCY` | 8 |
| `MANGO_PLAYABILITY_PROBE_CONCURRENCY` | 3 |
| `MANGO_PLAYABILITY_PROBE_MS` | 8000 |

**Flow:** flock → resolve catalog yaml → stop Chromium → stop catalog-service → `refresh --all` → stop probe pool → `mango-refresh.sh`.

`--mode full` re-probes recently failed titles; `stale` skips failures younger than 24h. Sync `/etc/mango/catalog.yaml` from repo when they differ (maintenance uses repo example until synced).

---

## Verify locally

```bash
cd src/catalog-service && npm run test && npm run build
bash -n scripts/phase-n3c/playability-maintenance.sh
bash scripts/phase-n2b/validate-composite-rails.sh   # Pi, catalog optional
```

---

## Pi deploy

```bash
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm run build   # do not copy node_modules from Mac
sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml
cd src/launcher && npm run build
MANGO_CATALOG=1 bash scripts/mango-refresh.sh
bash scripts/phase-n3c/playability-maintenance.sh --mode full
```
