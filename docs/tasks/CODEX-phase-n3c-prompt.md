# Codex prompt — Phase N3c playability index

Copy everything below the line into Codex on branch `feat/native-experience`.

---

## Context

mango is a Pi 5 TV box: `catalog-service` (Node + stremio-core) serves launcher rails from `catalog.yaml`. N3a play orchestrator exists but random rail hit rate is ~50–60%. **Product rule: if a poster is shown, Play must work.**

Implement **N3c — verified catalog / playability index** per [`docs/tasks/phase-n3c-playability-index.md`](phase-n3c-playability-index.md).

### Locked design choices

- **Tiered verify:** `filterStreamsForPlay` → `selectAutoPlayCandidates` → `mpv-play.sh --probe` (12s, min-duration 600)
- **Verified-only rails:** never return unverified items from `GET /rails/:id/items`
- **Session rotation:** 70% stable (high score, 7-day cooldown) + 30% random from verified pool each boot
- **Unified ListSource:** same pipeline for yaml `addon_catalog` and future `ai_catalog` (stub reader for `/etc/mango/ai-catalogs/*.json`)

## Hard constraints

- **Git-only deploy** — no SCP; commit → push → Pi pull
- **TypeScript** in `src/catalog-service/`
- Reuse existing: `filterStreamsForPlay`, `selectAutoPlayCandidates`, `play-orchestrator` patterns, `mpv-play.sh`
- **Do not** show unverified posters with disabled Play
- **Do not** change gamepad / launcher focus code unless required for empty-rail edge case
- **Do not** commit secrets; `playability.db` lives on Pi at `/etc/mango/playability.db`
- Couch-safe: launcher never sees raw mpv errors (unchanged)
- Match existing commit message style; one logical commit per slice if splitting

## Read first

1. [`docs/tasks/phase-n3c-playability-index.md`](phase-n3c-playability-index.md)
2. [`src/catalog-service/src/core.ts`](../src/catalog-service/src/core.ts) — `railItems`, `streams`, `rawStreams`
3. [`src/catalog-service/src/stream-filters.ts`](../src/catalog-service/src/stream-filters.ts)
4. [`src/catalog-service/src/play-orchestrator.ts`](../src/catalog-service/src/play-orchestrator.ts)
5. [`scripts/phase-n1/mpv-play.sh`](../scripts/phase-n1/mpv-play.sh)
6. [`config/catalog.example.yaml`](../config/catalog.example.yaml)
7. [`docs/NATIVE_EXPERIENCE.md`](../NATIVE_EXPERIENCE.md) § AI catalogs

## Implementation slices (do in order)

### N3c-S0 — Schema + status API

- Add `src/catalog-service/src/playability/db.ts` — SQLite via `better-sqlite3` or Node `node:sqlite` (Node 22+); migrations table
- Implement tables: `titles`, `rail_pool`, `rail_session`, `recently_shown`, `verify_log` (see spec §5)
- `GET /playability/status` — pool depths per rail, last indexer run, pending/stale counts
- `npm run build` passes

### N3c-S1 — ListSource + single-title verify

- `src/catalog-service/src/playability/list-source.ts` — interface + `AddonCatalogListSource`, `StaticIdsListSource`
- `src/catalog-service/src/playability/verify.ts` — tiered verify for one `(type,id)` calling existing core stream resolution
- CLI: `scripts/phase-n3c/playability-indexer.ts` with subcommand `verify --type movie --id tt0111161`
- Record result in DB

### N3c-S2 — Batch indexer + rail pool

- Indexer subcommand `top-up --rail trending-india` — ingest `limit × ingest_multiplier` candidates from ListSource, verify sequentially, fill `rail_pool` until `pool_target` verified or candidates exhausted
- Parse optional `playability:` block on rails in `rails.ts` (defaults: display_limit 12, min_display 8, ingest_multiplier 5, pool_target 60)
- Update `config/catalog.example.yaml` with documented defaults

### N3c-S3 — Verified rail serve + session rotation

- Modify `core.railItems` to read from `playability.db` session rotation (70/30 algorithm in spec §7)
- Only return items with `status=verified` and not expired
- Populate `playability` meta on response
- On boot / new session_id: compute rotation, write `rail_session` + `recently_shown`
- Stub `AiCatalogListSource` (read json ids, no home exposure yet)

### N3c-S4 — Triggers

- `POST /playability/invalidate` (localhost) — mark title stale, remove from active session
- Hook play failure in `index.ts` `POST /play` catch path to invalidate
- Indexer respects: `pool_low`, `display_low`, `stale` queue
- `scripts/phase-n3c/install-playability-timer.sh` — systemd user timer daily + OnBootSec=5min
- `mango-stack.sh` — after catalog healthy, fire background `playability-indexer top-up --all` (non-blocking)

### N3c-S5 — Gates + diag

- `scripts/phase-n3c/gate-n3c-verified-rails.sh` — N/N play on every served item per rail
- `scripts/diag/playability-status.py` — human-readable pool report
- Wire `scripts/pi-pre-couch-gate.sh` to run `gate-n3c` when `MANGO_CATALOG=1`
- `docs/N3c-INVENTORY.md` — plan + metrics template

## Verification on Pi

```bash
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
# Initial index (slow — run in tmux)
npx tsx scripts/phase-n3c/playability-indexer.ts top-up --all
bash scripts/phase-n3c/gate-n3c-verified-rails.sh
bash scripts/pi-pre-couch-gate.sh
```

## Success criteria

- Every item returned by `GET /rails/*/items` passes `gate-n3c-verified-rails.sh` (100%)
- Session rotation: second stack restart changes ~30% of ids (manual check)
- `GET /playability/status` shows `verified_pool >= min_display` per rail after top-up
- N0 gate still passes
- No secrets committed

## Out of scope

- Stream picker UI (N3b)
- LLM create_catalog tools (N5)
- Parallel mpv probes
- Launcher visual redesign
