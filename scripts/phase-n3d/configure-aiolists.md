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
