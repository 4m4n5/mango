# Configure AIOMetadata for mango

Run after `bash scripts/phase-n3d/install-aiometadata.sh` or
`bash scripts/phase-n3d/migrate-aiolists-to-aiometadata.sh`.

Replaces self-hosted **AIOLists** on port **3036**. Catalog ids use
`mdblist.<listId>` (same shape as legacy ElfHosted aiometadata).

## Prerequisites

1. `deploy/aiometadata/.env` with `TMDB_API_KEY` and `MDBLIST_API_KEY`
2. Container healthy: `curl -sf http://127.0.0.1:3036/health`

## Headless import (mango rail catalogs)

Your configure export has many catalogs; mango only needs the **11 mdblist lists**
referenced in `config/catalog.example.yaml`. Import pulls those from the export and
drops TMDB/MAL/IndiaStreams extras (lighter on the Pi).

```bash
# Mac → Pi
cat keys/aiometadata-config-2026-06-19\ \(1\).json | ssh mango 'cat > ~/.config/mango/aiometadata-import.json'

# Pi — audit export vs rails before import
bash scripts/phase-n3d/aiometadata-config.sh check ~/.config/mango/aiometadata-import.json

bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
bash scripts/phase-n3d/aiometadata-config.sh wire-export
```

`MANGO_AIOMETADATA_IMPORT_MODE=mango` (default) keeps catalogs in
`config/aiometadata-rail-catalogs.json` (mdblist + IndiaStreams custom ids).

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
`scripts/phase-n3d/map-mdblist-catalogs.md`. AIOMetadata assigns catalog ids
as `mdblist.<numeric-id>` (e.g. list `88302` → `mdblist.88302`).

You do **not** need TMDB/TVDB/Trakt for mango's N3d V1 rails — only the mdblist
lists in the mapping table. TMDB key is still required by the addon.

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

## Sync catalog.yaml

Repo example already uses `AIOMetadata` + `mdblist.*` ids:

```bash
sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml
sudo systemctl restart mango-catalog.service   # if running
```

## Verify

```bash
bash scripts/phase-n3d/aiometadata-catalogs.sh
# expect mdblist.88302, mdblist.83666, … for all rails

MANIFEST="$(python3 -c "import json; print(next(a['manifestUrl'] for a in json.load(open('/etc/mango/stremio-export.json'))['addons'] if a['name']=='AIOMetadata'))")"
BASE="${MANIFEST%/manifest.json}"
curl -sf "${BASE}/catalog/movie/mdblist.88302.json" | jq '.metas | length'
# expect ≥ 1 when MDBList key is valid
```

## Locked settings (Pi — mango N3d V1)

| Setting | Value |
|---------|-------|
| Port | 3036 (maps to container 3232) |
| MDBList | Connected via `.env` + configure UI |
| Catalog ids | `mdblist.<id>` per mapping doc |
| Cinemeta | Still from cloud in stremio-export (composite rails) |
| AIOLists | Retired — do not run both on :3036 |
