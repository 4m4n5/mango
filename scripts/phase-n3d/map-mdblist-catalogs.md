# N3d MDBList → AIOMetadata mapping

Operator checklist when adding MDBList rows in AIOMetadata `/configure`.
Catalog ids are **`mdblist.<numeric-list-id>`** (configured automatically).

Validate after export:

```bash
bash scripts/phase-n3d/aiometadata-catalogs.sh
MANIFEST="$(python3 -c "import json; print(next(a['manifestUrl'] for a in json.load(open('/etc/mango/stremio-export.json'))['addons'] if a['name']=='AIOMetadata'))")"
BASE="${MANIFEST%/manifest.json}"
curl -sf "${BASE}/catalog/movie/mdblist.88302.json" | jq '.metas | length'
```

| Rail | Content | catalog.yaml id | MDBList list |
|------|---------|-----------------|--------------|
| `movies-india-trending` | movie | `mdblist.88302` | 88302 |
| `movies-classics` | movie | `mdblist.83666` | 83666 |
| `movies-comedy` | movie | `mdblist.91223` | 91223 |
| `movies-quick-watches` | movie | `mdblist.83668` | 83668 |
| `movies-documentaries` | movie | `mdblist.128051` | 128051 |
| `series-india-picks` | series | `mdblist.88303` | 88303 |
| `series-classics` | series | `mdblist.88303` | 88303 |
| `series-comedy` | series | `mdblist.91224` | 91224 |
| `series-comedy` | series | `mdblist.84401` | 84401 |
| `series-miniseries` | series | `mdblist.130153` | 130153 |
| `series-miniseries` | series | `mdblist.130152` | 130152 |
| `series-documentaries` | series | `mdblist.128052` | 128052 |

## Operator notes

- MDBList API key in `deploy/aiometadata/.env` **and** saved in configure UI.
- Addon name in export must be `AIOMetadata`; catalog.yaml `addon:` must match.
- Legacy AIOLists ids (`aiolists-88302-L`) are **not** used with AIOMetadata.
- `movies-india-trending` / `series-india-picks` are mdblist-backed in N3d V1.

## Import from configure export

```bash
bash scripts/phase-n3d/aiometadata-config.sh check ~/.config/mango/aiometadata-import.json
bash scripts/phase-n3d/aiometadata-config.sh import ~/.config/mango/aiometadata-import.json
```

`import` uses **mango mode** by default: copies only the mdblist catalogs that
`catalog.example.yaml` rails reference (11 lists), not the full export.

## Migration from AIOLists

```bash
bash scripts/phase-n3d/migrate-aiolists-to-aiometadata.sh
# then configure + export per configure-aiometadata.md
```
