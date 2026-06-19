# N3d MDBList to AIOLists mapping

Use this as the operator checklist when importing MDBList rows into AIOLists.
AIOLists exposes native MDBList catalogs as `aiolists-<id>-L` (user lists) or
`aiolists-<id>-E` (external lists). Validate with:

```bash
curl -sf "http://127.0.0.1:3036/<config-hash>/catalog/movie/aiolists-88302-L.json" | jq '.metas | length'
```

| Rail | Content | Old ElfHosted id | AIOLists catalog id |
|------|---------|------------------|---------------------|
| `movies-india-trending` | movie | `mdblist.88302` | `aiolists-88302-L` |
| `movies-classics` | movie | `mdblist.83666` | `aiolists-83666-L` |
| `movies-comedy` | movie | `mdblist.91223` | `aiolists-91223-L` |
| `movies-quick-watches` | movie | `mdblist.83668` | `aiolists-83668-L` |
| `movies-documentaries` | movie | `mdblist.128051` | `aiolists-128051-L` |
| `series-india-picks` | series | `mdblist.88303` | `aiolists-88303-L` |
| `series-classics` | series | `mdblist.88303` | `aiolists-88303-L` |
| `series-comedy` | series | `mdblist.91224` | `aiolists-91224-L` |
| `series-comedy` | series | `mdblist.84401` | `aiolists-84401-L` |
| `series-miniseries` | series | `mdblist.130153` | `aiolists-130153-L` |
| `series-miniseries` | series | `mdblist.130152` | `aiolists-130152-L` |
| `series-documentaries` | series | `mdblist.128052` | `aiolists-128052-L` |

## Operator notes

- MDBList API key must be saved in the configure UI (shows **Connected as …**).
- Lists may not appear in the Manage Lists UI but still resolve at the catalog
  endpoint when the numeric list id is valid for your account.
- Copy the manifest URL from the configure page into `/etc/mango/stremio-export.json`
  as `"name": "AIOLists"`.
- `movies-india-trending` and `series-india-picks` are mdblist-backed in N3d V1
  (no separate India catalog addon). Regional catalog expansion is deferred — see
  `docs/N3d-INVENTORY.md` § Source expansion (future).
