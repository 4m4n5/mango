# Configure AIOMetadata for mango

Run after `bash scripts/m4-addons/install-aiometadata.sh`.

Replaces self-hosted **AIOLists** on port **3036**. Catalog ids use
`mdblist.<listId>` (same shape as legacy ElfHosted aiometadata).

## Prerequisites

1. `deploy/aiometadata/.env` with `TMDB_API_KEY` and `MDBLIST_API_KEY`
2. Container healthy: `curl -sf http://127.0.0.1:3036/health`

## Headless import (currently blocked for agents)

Your configure export has many catalogs. Mango first imports AIOMetadata rows
referenced by `config/catalog.example.yaml`, including MDBList and the three
`custom.in_rdata_indiastreams.*` IDs; only when that YAML yields no AIOMetadata
rows does it fall back to `config/aiometadata-rail-catalogs.json`. Bharat Binge
is a separate addon and is not imported into AIOMetadata by this helper.

The current `import` path writes its response to fixed
`/tmp/aiometadata-save.json`, leaves it behind, and prints the secret manifest
URL. Do not run it from an agent or unattended workflow until it uses private
temporary storage, trap cleanup, and redacted output. An operator can safely
audit an existing private export without mutation:

```bash
# Pi — operator-provided export already outside the repo
IMPORT="${MANGO_AIOMETADATA_EXPORT:-$HOME/.config/mango/aiometadata-import.json}"
test -s "$IMPORT"
bash scripts/m4-addons/aiometadata-config.sh check "$IMPORT"
```

Use the Configure UI for current human-reviewed state setup. Restore headless
`import`/`wire-export` to the runbook only after the helper is hardened.

The export can contain API/account configuration. Never commit it or route it
through the Git deployment. Generate/place it through the home operator's
credential workflow, preserve the previous live configuration, and do not
invent values when it is absent.

`MANGO_AIOMETADATA_IMPORT_MODE=mango` (default) keeps the YAML-referenced
AIOMetadata catalogs. The import can supply IndiaStreams custom IDs only when
the operator export actually contains them; verify manifest/catalog yield.

## Manual configure UI

```bash
ssh -L 3036:127.0.0.1:3036 mango
```

Then open:

```text
http://127.0.0.1:3036/configure
```

## Add MDBList catalogs

In **MDBList Integration**, add each custom list from
`scripts/m4-addons/map-mdblist-catalogs.md`. AIOMetadata assigns catalog ids
as `mdblist.<numeric-id>` (e.g. list `88302` → `mdblist.88302`).

You do **not** need unrelated TMDB/TVDB/Trakt catalogs for mango rails. Keep the
MDBList index in `config/aiometadata-rail-catalogs.json` and AIOMetadata custom
rows in `config/catalog.example.yaml` coherent; the normal helper derives its
requested set from YAML first.
TMDB key is still required by the addon.

## Export manifest

Copy the generated Stremio addon URL into `/etc/mango/stremio-export.json`:

```json
{
  "name": "AIOMetadata",
  "manifestUrl": "http://127.0.0.1:3036/stremio/<userUUID>/<compressedConfig>/manifest.json"
}
```

Keep the addon name exactly `AIOMetadata` (must match `catalog.yaml`).

Optional: save the URL to `~/.config/mango/aiometadata.manifest`.

## Review catalog policy

The repository example already uses `AIOMetadata` + `mdblist.*` ids. Compare it
with installed policy before an authorized deploy; routine addon setup must not
silently overwrite operator-owned runtime config:

```bash
IMPORT="${MANGO_AIOMETADATA_EXPORT:-$HOME/.config/mango/aiometadata-import.json}"
diff -u /etc/mango/catalog.yaml config/catalog.example.yaml || true
bash scripts/m4-addons/aiometadata-config.sh check "$IMPORT"
```

The normal Git deploy runs `scripts/lib/sync-etc-mango-config.sh`. If a manual
policy sync is explicitly approved, follow [`docs/DEPLOY.md`](../../docs/DEPLOY.md)
and re-run the catalog/addon gates on the exact revision.

## Verify

```bash
bash scripts/m4-addons/aiometadata-catalogs.sh
# expect mdblist.88302, mdblist.83666, … for all rails

MANIFEST="$(python3 -c "import json; print(next(a['manifestUrl'] for a in json.load(open('/etc/mango/stremio-export.json'))['addons'] if a['name']=='AIOMetadata'))")"
BASE="${MANIFEST%/manifest.json}"
curl -sf "${BASE}/catalog/movie/mdblist.88302.json" | jq '.metas | length'
# expect ≥ 1 when MDBList key is valid
```

## Deployment policy

| Setting | Value |
|---------|-------|
| Port | 3036 (maps to container 3232) |
| MDBList | Required via `.env` + configure UI; verify live before use |
| Catalog ids | `mdblist.<id>` per mapping doc |
| Cinemeta | Still from cloud in stremio-export (composite rails) |
| AIOLists | Retired — do not run both on :3036 |
