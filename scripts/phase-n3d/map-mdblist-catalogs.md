# N3d MDBList to AIOLists mapping

Use this as the operator checklist when importing MDBList rows into AIOLists.
The desired AIOLists catalog id keeps the old id by default. If the configure UI
generates a different id, update this table and `config/catalog.example.yaml`.

| Rail | Content | Old source | Desired AIOLists catalog id |
|------|---------|------------|------------------------------|
| `movies-india-trending` | movie | `mdblist.88302` | `mdblist.88302` |
| `movies-classics` | movie | `mdblist.83666` | `mdblist.83666` |
| `movies-comedy` | movie | `mdblist.91223` | `mdblist.91223` |
| `movies-quick-watches` | movie | `mdblist.83668` | `mdblist.83668` |
| `movies-documentaries` | movie | `mdblist.128051` | `mdblist.128051` |
| `series-india-picks` | series | `mdblist.88303` | `mdblist.88303` |
| `series-classics` | series | `mdblist.88303` | `mdblist.88303` |
| `series-comedy` | series | `mdblist.91224` | `mdblist.91224` |
| `series-comedy` | series | `mdblist.84401` | `mdblist.84401` |
| `series-miniseries` | series | `mdblist.130153` | `mdblist.130153` |
| `series-miniseries` | series | `mdblist.130152` | `mdblist.130152` |
| `series-documentaries` | series | `mdblist.128052` | `mdblist.128052` |

## India OTT mapping

`movies-india-trending` and `series-india-picks` keep a dedicated `India OTT`
source for regional freshness. Use AIOLists only as the mdblist fallback.
