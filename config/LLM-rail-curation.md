# Optional thematic-rail curation

This is an operator tool for redesigning the static MDBList/Cinemeta source mix
in `config/catalog.example.yaml`. It is **not** Mango's Household Story Graph
recommendation system, does not read Fire/Water ratings, and must not mutate a
live Pi automatically.

Canonical runtime policy and current source-yield challenges live in
[`docs/features/content-and-playback.md`](../docs/features/content-and-playback.md). The tagged catalog inventory is
`config/mdblist-inventory.json`.

## Measure and export evidence

Run on the Pi only when catalog-service is healthy and the couch is idle:

```bash
cd ~/mango
bash scripts/m4-addons/rail-curate.sh couch-measure
```

This writes a dated, runtime-only context file at
`~/.cache/mango/mdblist-llm-context.json`. A measurement is evidence for a
curation proposal; it is not permission to rewrite YAML or loosen a theme gate.

## Review a proposal

The checked-in `v2_3-full.json` is a historical example, not a current rollout
target. Prefer a newly named proposal whose sources and weights are traceable to
the latest measurements.

```bash
MANGO_REPO_DIR="$PWD" bash scripts/m4-addons/rail-curate.sh plan config/rail-proposals/my-rail.json
MANGO_REPO_DIR="$PWD" bash scripts/m4-addons/rail-curate.sh apply config/rail-proposals/my-rail.json --write
```

`plan` is the review step. `apply --write` changes repository policy and should
run only on the source-authority Mac after human review; deploy the resulting
commit through Git, never by copying the file to the Pi.

## AIOMetadata coverage

The AIOMetadata import/check flow is implemented. Before deploying a proposal,
prove that every referenced `mdblist.*` catalog is present in the approved
export:

```bash
bash scripts/m4-addons/mdblist-catalog-pipeline.sh check-import
bash scripts/m4-addons/aiometadata-config.sh check ~/.config/mango/aiometadata-import.json
```

Importing configuration can affect live catalog supply. Keep credentials and
the export outside Git, preserve the existing Pi configuration, and follow
[`scripts/m4-addons/configure-aiometadata.md`](../scripts/m4-addons/configure-aiometadata.md).
