# Configure AIOLists for mango

Run this after `bash scripts/phase-n3d/install-aiolists.sh` or
`bash scripts/phase-n3d/enable-aiolists-service.sh` reports reachable.

## Open Configure UI

Use the Pi browser or an SSH tunnel:

```bash
ssh -L 3036:127.0.0.1:3036 mango
```

Then open:

```text
http://127.0.0.1:3036/
```

## Import mdblists

Import each MDBList URL or id from `scripts/phase-n3d/map-mdblist-catalogs.md`.
Prefer stable catalog ids that preserve the old `mdblist.<id>` suffix where the
UI allows it. If AIOLists generates different ids, update
`config/catalog.example.yaml` and the mapping doc together.

## Export Manifest

Copy the generated AIOLists manifest URL into `/etc/mango/stremio-export.json`:

```json
{
  "name": "AIOLists",
  "manifestUrl": "http://127.0.0.1:3036/<generated-config>/manifest.json"
}
```

Keep the addon name exactly `AIOLists`.

## Locked settings (Pi — 2026-06-19)

| Setting | Value |
|---------|-------|
| MDBList | Connected (`4m4n5tv-xue5kq`) |
| Metadata | Cinemeta (default) |
| Split search | Cinemeta ON |
| Anime search | Kitsu ON |
| TMDB / Trakt | Not connected |
| RPDB | Not set |

Catalog ids for mango rails use native format `aiolists-<mdblist-id>-L`
(e.g. `aiolists-88302-L` for trending movies). Manifest URL stored in
`~/.config/mango/aiolists.manifest` and `/etc/mango/stremio-export.json`.

## Verify

```bash
# Replace <hash> with your configure URL hash
curl -sf "http://127.0.0.1:3036/<hash>/catalog/movie/aiolists-88302-L.json" | jq '.metas | length'
# expect ≥ 1 when MDBList key is saved
```
