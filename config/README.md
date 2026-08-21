# Configuration files

Copy examples to `/etc/mango` or `$HOME/.config/mango`. Populated files are
device state and must stay out of Git.

| File | Class | Notes |
|------|-------|-------|
| `config.example.yaml` | example | Top-level stack config |
| `catalog.example.yaml` | example | Rails and addon graph |
| `catalog-live.example.yaml` | example | Optional Live tab |
| `catalog-filters*.example.json` | example | Stream filter profiles |
| `catalog-filters.example.json` | example | Default filter set |
| `catalog-gate-rails.json` | required policy | Gate rail ids |
| `playability-policy.json` | required policy | Grow / verify policy |
| `rail-compose.schema.json` | schema | AI rail compose |
| `rail-theme-profiles.yaml` | policy | Theme labels |
| `rail-curation-overrides.example.yaml` | example | Local theme overrides |
| `ai-catalog-reserve.json` | policy | AI catalog slots |
| `ai-catalogs.example/` | example | Sample slot YAML |
| `aiometadata-rail-catalogs.json` | policy | AIOMetadata catalog ids |
| `aiostreams-target-patch.json` | policy | AIOStreams patch |
| `bharat-binge-manifest.url` | example | Placeholder regional manifest |
| `bharat-binge-rail-catalogs.json` | policy | Catalog ids only |
| `nexotv-profiles.example.json` | example | Live helper profiles |
| `youtube-oauth-client.example.json` | example | TV OAuth client shape |
| `voice.env.example` | example | Voice keys |
| `stt.key.example` | example | STT placeholder |
| `area69.credentials.example` | example | Optional Live helper |
| `stremio-export.example.json` | example | Addon export shape |
| `stream-gate-fixtures.json` | test fixture | Synthetic streams |
| `live-*.m3u` | example | Placeholder playlists |
| `companion.example/` | example | Fictional librarian profile |
| `systemd/` | install units | Addon helper units |
| `catalog-rail-curation.md` | docs | Rail source notes |
| `LLM-rail-curation.md` | docs | AI rail notes |
| `mdblist-inventory.json` | generated snapshot | Operator inventory; do not treat as live proof |
| `rail-proposals/` | historical examples | Not loaded at runtime |

Private at runtime only: `*.key`, OAuth JSON, `*.db`, AIOStreams `userData`,
companion journals, UX-harness fixtures.
