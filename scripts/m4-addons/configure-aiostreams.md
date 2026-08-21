# Configure AIOStreams for mango

Run these on the Pi after `bash scripts/m4-addons/install-aiostreams.sh` or
`bash scripts/m4-addons/enable-aiostreams-service.sh` reports healthy.

**Full knob map + optimal profile:** [`docs/reference/aiostreams-profile.md`](../../docs/reference/aiostreams-profile.md)

The headless helper keeps credential-bearing request/response bodies in a
mode-700 temporary directory, removes them on exit, emits fixed summaries only,
and restores the original user object if post-write verification fails. `get`
is intentionally still a full secret-bearing export and must never be logged.
`verify` emits fixed policy summaries but does not inspect the exported addon
graph or the catalog-service direct MediaFusion trigger.

```bash
bash scripts/m4-addons/aiostreams-config.sh set-tvdb-key
bash scripts/m4-addons/aiostreams-config.sh enable-mediafusion
bash scripts/m4-addons/aiostreams-config.sh diff    # changed top-level keys only
bash scripts/m4-addons/aiostreams-config.sh verify  # fixed-field AIO policy summary
```

## Open Configure UI

Use the Pi browser or an SSH tunnel:

```bash
ssh -L 3035:127.0.0.1:3035 mango
```

Then open:

```text
http://127.0.0.1:3035/stremio/configure
```

## Required Providers

Add the existing paid accounts in the AIOStreams UI. Do not paste keys into git.

| Provider | Setting |
|----------|---------|
| TorBox | enable TorBox provider and cached/uncached behavior |
| Real-Debrid | enable Real-Debrid as secondary debrid |
| Easynews | enable Easynews Search |
| Torrentio | enable as a stream-only indexer through configured services |
| Comet | enable as the second required stream-only indexer |
| MediaFusion | enable through AIO's native base-URL integration; stream-only movie/series, cached-search-only, TorBox + Real-Debrid |
| TVDB metadata | configure with `set-tvdb-key`; the key is Pi-owned, read from a hidden prompt/stdin, never printed or committed |

Keep the addon name shown to mango as `AIOStreams`.

## Target topology (live verification required)

Configured via configure UI; credentials in `~/.config/mango/aiostreams.credentials`.
The table is desired policy plus previously recorded topology, not a live-state
claim. Run `aiostreams-config.sh verify` and a credential-safe topology/yield
audit on the Pi before relying on any provider; availability, account state,
nested manifests, and `userData` can drift independently of this repository.

### Service targets

| Provider | Required/conditional posture |
|----------|-------------------------------|
| TorBox | ON (API key set) |
| Real-Debrid | ON (API key set) |
| Easynews | ON (API key set) |
| Torrentio | Installed as built-in resource (stream-only) |
| Comet | Installed as built-in resource (stream-only) |
| MediaFusion | ON through the non-secret HTTPS base URL; AIO supplies its existing TorBox/RD credentials in the encoded request header |
| All others | OFF (AllDebrid, Premiumize, Offcloud, NNTP, etc.) |

### Built-in toggles

| Setting | Value | Why |
|---------|-------|-----|
| Service Wrap | ON | Torrentio resolves through your debrid locally |
| Check Library | ON | Detect streams already owned/in the provider account library; this is not Mango watch-history filtering |
| NZB Failover | ON | Easynews fallback path |
| Cache and Play | ON, **usenet only** | Fast Easynews path without torrent cache quirks |
| Auto Remove Downloads | OFF | Safer for re-watches |
| Stream errors | Visible to Mango; hidden for catalog/meta/subtitles | Lets the resolver distinguish provider failure from a genuine title miss; diagnostic rows never reach playback/UI/AI |

### Filters / quality (AIOStreams side)

| Setting | Value | Why |
|---------|-------|-----|
| Excluded resolutions | **none** | Full upstream quality for future 65" OLED |
| Preference order | 2160p → 1440p → 1080p → … | Best quality first from indexers |
| Uncached (RD/debrid) | Excluded per-provider | Avoid “still downloading” on debrid |
| Keyword filters | Junk only (cam/ts/scr) | No remux/WEB-DL/DV exclusions here |

**Mango downstream** owns device capability. The base example is conservative;
the current `4k-hifi` profile can select compatible 4K SDR HEVC/REMUX while
keeping HDR/DV/software 4K behind smooth paths. Native HDR is not supported by
the current X11/mpv product path. AIOStreams stays uncapped so Mango can decide.

### mango stream policy (catalog-service)

Separate from AIOStreams UI — `config/catalog-filters.example.json`:

- AIOStreams as the only stream-capable VOD path in the exported/target graph,
  with exact identity/path capability tiers; catalog/metadata/Live addons may
  coexist. Close or explicitly gate the catalog-service legacy direct
  MediaFusion thin-pool supplement before claiming strict runtime AIO-only
- Active hifi profile: compatible 4K SDR HEVC may precede 1080p; risky HDR/software 4K remains fallback
- `preferred_language` is a soft rank boost; `language` is a hard filter
- Stream evaluation corpus: `config/stream-gate-fixtures.json` (7 titles)

See [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) for layer boundaries.

## Groups — conditional Easynews

Use AIOStreams Groups so Easynews results are admitted only when primary cached
supply is thin. Mango explicitly selects AIOStreams' `parallel` group behavior:
all groups start together, while the condition controls fallback inclusion and
early return. This avoids adding a legitimate 18–25 second Easynews season
search after the primary wall; it is not a provider-call suppression mechanism.

| Group | Addons | Condition |
|-------|--------|-----------|
| Primary | Torrentio + Comet + MediaFusion, using TorBox + Real-Debrid | always |
| Easynews fallback | Easynews Search | `count(cached(previousStreams)) < 3` |

The transactional helper derives current Pi-owned instance IDs instead of
guessing or committing them. It verifies the bounded public base manifest,
replaces any stale secret share-manifest override, enables cached-search-only
MediaFusion, creates both groups, reads back the exact policy, and automatically
restores the original user object on mismatch:

```bash
bash scripts/m4-addons/aiostreams-config.sh enable-mediafusion
bash scripts/m4-addons/aiostreams-config.sh verify
```

## Export Manifest

After saving the AIOStreams setup, copy its generated manifest URL into
`/etc/mango/stremio-export.json`:

```json
{
  "name": "AIOStreams",
  "manifestUrl": "http://127.0.0.1:3035/stremio/<generated-user>/manifest.json"
}
```

The exact path is generated by AIOStreams. The gate validates reachability; do
not hardcode a placeholder into `/etc/mango/stremio-export.json`.

## Verify

```bash
curl -sf http://127.0.0.1:3035/api/v1/status
docker ps --filter name=aiostreams --format '{{.Status}}'
```
