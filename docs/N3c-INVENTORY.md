# N3c inventory — verified catalog / playability index

Last updated: 2026-06-19

## Scope

Phase N3c adds a persistent playability index between upstream Stremio catalogs
and launcher rails. `GET /rails/:id/items` now serves verified DB session items
only; upstream addon catalog order is no longer rendered directly.

Per user direction on 2026-06-19, minimum pool depth is non-blocking while the
rest of the tooling is finished. Empty or underfilled rails may return fewer
cards, but never unverified cards.

## Implemented

- SQLite schema/status API: `GET /playability/status`
- Single-title verify: `playability-indexer.ts verify --type movie --id ...`
- Capped and sequential top-up: `top-up --rail ...`, `top-up --all`
- Global dedupe refresh: `refresh --all --mode stale|full` (N3c-M Tier 1)
- Maintenance wrapper: `scripts/phase-n3c/playability-maintenance.sh`
- Persistent mpv probe pool: `mpv-probe-pool.sh` + `mpv-probe-ipc.sh` (maintenance only)
- Verified-only rail serve with per-process session rotation
- `AiCatalogListSource` stub for `/etc/mango/ai-catalogs/*.json`
- Localhost invalidation: `POST /playability/invalidate`
- Play-failure invalidation from `POST /play`
- Opt-in stack warmup: `MANGO_PLAYABILITY_TOPUP_ON_START=1`
- Timer installer: `scripts/phase-n3c/install-playability-timer.sh` (runs maintenance @ 03:00)
- Gate: `scripts/phase-n3c/gate-n3c-verified-rails.sh` (default: 2 plays/rail; `MANGO_GATE_FULL=1` for all)
- Status report: `scripts/diag/playability-status.py`

## Pi evidence so far

- `tt0111161` single-title verify passed with `--min-duration-sec 600`.
- `trending-india`: 24 verified from 97 upstream candidates; target 60 is not
  reachable from that single upstream page.
- `popular-global`: capped run reached 20 verified served candidates.
- `popular-india`: current upstream catalog returned 0 candidates.

## Verification checklist

- Local: `cd src/catalog-service && npm run build`
- Local syntax:
  - `bash -n scripts/mango-stack.sh`
  - `bash -n scripts/pi-pre-couch-gate.sh`
  - `bash -n scripts/phase-n3c/gate-n3c-verified-rails.sh`
  - `python3 -B -m py_compile scripts/diag/playability-status.py`
- Pi after deploy:
  - `cd ~/mango && git pull --ff-only`
  - `cd src/catalog-service && npm run build`
  - `MANGO_CATALOG=1 bash scripts/mango-stack.sh restart`
  - `python3 scripts/diag/playability-status.py`
  - `bash scripts/phase-n3c/gate-n3c-verified-rails.sh`

## Known follow-ups

- Broaden/fallback list sources before restoring `pool_target: 60`.
- Run full `pi-pre-couch-gate.sh` with `MANGO_N3C_REQUIRE_MIN_DISPLAY=1` once pools filled.
- `popular-india`: upstream catalog may return 0 candidates — needs alternate source.
- Subscribe ElfHosted private per [`ELFHOSTED.md`](ELFHOSTED.md).

## Audit fixes (2026-06-19)

- Partial rail sessions rebuild when expired titles shrink below display target.
- `display_low` / `pool_low` enqueue triggers + debounced background top-up.
- Rail items cache skips when `low_water`; bust on invalidate/play failure.
- Gate: mpv `playback-time > 0`; optional `MANGO_N3C_REQUIRE_MIN_DISPLAY=1`.
