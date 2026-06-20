# LLM rail curation — couch test runbook

Operator: `bash scripts/phase-n3d/rail-curate.sh` · Inventory: `config/mdblist-inventory.json`

## Couch session — test tonight

On the Pi (catalog-service up):

```bash
cd ~/mango
bash scripts/phase-n3d/rail-curate.sh couch-measure
```

Writes `~/.cache/mango/mdblist-llm-context.json` with measured hit rates.

## Compose v2.3 (after measure)

```bash
bash scripts/phase-n3d/rail-curate.sh plan config/rail-proposals/v2_3-full.json
bash scripts/phase-n3d/rail-curate.sh apply config/rail-proposals/v2_3-full.json --write
```

## Import

Self-hosted AIOMetadata uses `aiometadata-config.sh import` — next chunk extends mango import to pull catalogs from inventory.
