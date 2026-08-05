# Configure AIOStreams for mango

Run these on the Pi after `bash scripts/m4-addons/install-aiostreams.sh` or
`bash scripts/m4-addons/enable-aiostreams-service.sh` reports healthy.

**Full knob map + optimal profile:** [`docs/reference/aiostreams-profile.md`](../../docs/reference/aiostreams-profile.md)

**Current headless blocker:** `diff` exposes the full user delta and `apply`
writes its potentially secret-bearing API response to fixed
`/tmp/aiostreams-put.json`, prints it, and leaves it behind. Do not run either
path from an agent or unattended workflow until the helper uses a private
temporary file, trap cleanup, and redacted output. Use the Configure UI for an
explicit human-reviewed mutation. `verify` emits fixed policy summaries but
does not inspect the exported addon graph or the catalog-service direct
MediaFusion trigger.

```bash
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
| MediaFusion | optional preset must exist; keep disabled unless its override manifest is currently healthy and a measured trial is authorized |

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
| MediaFusion | Preset present; optional/disabled is valid when manifest is unhealthy |
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

Use AIOStreams Groups so Easynews results are included only when primary cached
supply is thin and later-group waits can end early. AIOStreams begins fetching
all groups in parallel, so this is **not** proof that Easynews was never queried;
conditions decide inclusion/discard/early exit as results arrive. Configure it
after TorBox, Real-Debrid, Easynews Search, Torrentio, and Comet are installed.

| Group | Addons | Condition |
|-------|--------|-----------|
| Primary | Torrentio + Comet, service-wrapped through TorBox + Real-Debrid | always |
| Easynews fallback | Easynews Search | `count(cached(previousStreams)) < 3` |

Steps:

1. Open **Addons → Groups**.
2. Create `Primary` and put both Torrentio and Comet stream addons in it.
3. Create `Easynews fallback` and put Easynews Search in it.
4. Set the Easynews group condition to:

```text
count(cached(previousStreams)) < 3
```

5. Save / update the user.

Verify with:

```bash
bash scripts/m4-addons/aiostreams-config.sh get \
  | python3 -c "import json,sys; g=json.load(sys.stdin)['data']['userData'].get('groups'); assert g, 'groups still null'; print(json.dumps(g, indent=2))"
```

If the GET output is stable, save a redacted copy as
`config/aiostreams-groups.example.json`. Do not guess internal addon IDs and do
not commit credentials.

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
