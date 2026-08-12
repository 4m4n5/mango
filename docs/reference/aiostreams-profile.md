# AIOStreams profile for Mango

**Branch:** `feat/native-experience` · **Service:** loopback `:3035`
**State boundary:** AIOStreams `userData` and credentials are Pi-owned runtime
state. Repository deployment never overwrites them.

Mango requires AIOStreams **v2.32.0 or newer**. That release added date-based
series discovery and matching; older releases can return zero streams for daily
shows even when their indexers find date-named releases. The compose default is
the reviewed stable `v2.32.1`, overridable only through the explicit
`MANGO_AIOSTREAMS_IMAGE_TAG` operator setting. Treat `/api/v1/status` as runtime
truth and advance the stable tag deliberately after gate validation.

## Target role and current exception

AIOStreams is Mango's intended **sole stream-capable VOD aggregate/path**. The
full exported graph also contains catalog/metadata and optional Live addons,
but calls only one VOD stream manifest through AIO, while `catalog-service` owns identity, path
capability, automatic ladder, probing, play-session lifecycle, and mpv. It
should not also fan out directly to nested indexers/transports.

Current source has one legacy exception: when the AIO result has at most one
cacheable stream, a Pi-local `MANGO_MEDIAFUSION_MANIFEST` value or
`~/.config/mango/mediafusion.manifest` file can trigger a direct MediaFusion
supplement. It is skipped after an empty primary hard-timeout and bounded by an
8-second cap plus the shared deadline. Export/topology checks do not prove the
secret-file trigger absent. Treat strict AIO-only runtime as an unclosed
hardening outcome until that path is removed or explicitly feature-gated and
proven.

```text
catalog-service
  └── AIOStreams
       ├── indexers: Torrentio, Comet, optional healthy MediaFusion
       └── services/transports: TorBox, Real-Debrid, Easynews
```

| Concern | AIOStreams | Mango catalog-service |
|---------|------------|-----------------------|
| Nested provider fan-out | Yes | Target is AIO only; legacy optional direct MediaFusion supplement remains in source |
| Dedup/junk/service/result limits | Yes | Defensive error/identity filtering |
| Secrets/debrid credentials | Pi AIO state | Never reads/returns them |
| Exact movie/episode identity | Formatter evidence only | Authoritative validation |
| Path capability/risk | No | Device/profile-specific hard tiers |
| Automatic play/probes/deadline | `autoPlay` off | Authoritative |
| Stream picker | Supplies candidate metadata | Sanitizes/ranks/bounds to five and validates switch |
| Verified library | No | `playability.db` |
| Display/output/HUD | No | mpv/Mango |

## Source-owned target policy

[`config/aiostreams-target-patch.json`](../../config/aiostreams-target-patch.json)
is a secret-free merge patch. It intentionally omits the `services` array so an
apply cannot replace live provider keys with placeholders.

### Hygiene and cache

| Setting | Target |
|---------|--------|
| Dedup | Enabled; `infoHash`, smart detect, filename; single result per cached/uncached/P2P identity |
| Uncached global | Allowed so TorBox cache-in/fallback remains possible |
| Uncached Real-Debrid | Excluded |
| Junk | Exclude CAM/SCR/TS/TC, 3D, camrip/hdcam/telesync/screens/workprint/sample/sidecars |
| Season packs | Excluded |
| Episode matching | Enabled for series/anime series |
| Error visibility | Stream errors visible to Mango; catalog/meta/subtitle errors hidden |

Visible stream-resource error rows are diagnostic inputs, not candidates. Mango
filters them from playback/drawer/launcher and uses fixed credential-free
copy/counters on couch surfaces. URL-less nested errors are normalized into
credential-free internal category placeholders before URL validation. Current
loopback `/stream` diagnostics can still retain raw addon-fetch details; the
companion proxy denies this route. Keep it operator-only and sanitize the
remaining DTO details before broader exposure.

### Preference and limits

| Setting | Target |
|---------|--------|
| Resolution preference | 2160p → 1440p → 1080p → lower; no upstream resolution exclusion |
| Quality | BluRay REMUX → BluRay → WEB-DL → WEBRip → lower |
| Languages | English, Hindi |
| Encodes | HEVC, AVC |
| Sort | cached → service → library → language → resolution → quality → size → expression/regex |
| Result limit | Conjunctive: service 2, resolution 2, release group 1, global 12 |
| Formatter | `lightgdrive` |
| Poster | none; Mango uses Cinemeta/AIOMetadata art |

Do not add a large TorBox scalar boost: it can fill conjunctive slots and hide
unique Real-Debrid coverage. TorBox-first behavior comes from service order and
sorting. RD WEBRip/WEB-DL/AMZN exclusions and a BluRay/WEBRip scored preference
remain in the target patch.

### Service behavior

| Setting | Target |
|---------|--------|
| `autoPlay.enabled` | **false**—Mango owns selection/deadline/foreground |
| Service Wrap | enabled |
| NZB failover | enabled |
| Cache and Play | enabled for usenet only |
| Check owned/library | enabled |
| Precache next episode | disabled |

## Operator-owned services and indexers

Configure actual accounts only in the AIOStreams UI/API on the Pi. Never paste
credentials or generated manifest URLs into Git or logs.

| Item | Current target | Notes |
|------|----------------|-------|
| TorBox | Enabled | Cached and eligible uncached/cache-in paths according to Mango ladder |
| Real-Debrid | Enabled | Uncached excluded; secondary service |
| Easynews | Enabled | Usenet fallback; cache-and-play scoped to usenet |
| Torrentio | Enabled, stream resource only | One instance; avoid multiplying public hits |
| Comet | Enabled, stream resource only | Secondary indexer; no direct Mango export |
| MediaFusion | Enabled target, stream-only movie/series | Use AIO's non-secret HTTPS base integration with existing TorBox/RD services, cached-search-only; never retain an expired secret share-manifest override |
| Other addons | Disabled unless a measured, reviewed need exists | Preserve sole-AIO topology |

The latest recorded home snapshot had Torrentio/Comet contributing and
TorBox/RD/Easynews configured. That is a dated runtime observation. Use
credential-safe contribution counters and current AIO state to make present-tense
claims.

## AIO groups

Groups condition whether Easynews is queried when cached primary supply is
healthy. Mango uses AIOStreams' explicit `sequential` behavior; its parallel
behavior starts all group fetches before evaluating result inclusion.

| Group | Members | Condition |
|-------|---------|-----------|
| Primary | Torrentio/Comet/MediaFusion through TorBox + Real-Debrid | Always |
| Easynews fallback | Easynews Search | `count(cached(previousStreams)) < 3` |

Internal addon IDs are Pi/version-specific. The credential-safe helper derives
them from current user state, reads the result back, and rolls back on mismatch;
never invent or commit them. Group drift is an operator optimization signal,
not the mpv Streams drawer contract.

## Mango quality boundary

AIOStreams deliberately keeps full upstream resolution/REMUX coverage. Mango's
loaded filter/profile decides what can be attempted on the actual renderer:

- Base example defaults to a 90-second automatic wall and conservative 1080p.
- The current `4k-hifi` profile uses a 120-second wall, accepts compatible 4K
  SDR HEVC/REMUX, and keeps HDR/DV/software-decoded 4K behind smooth paths.
- Native HDR is not supported by the current X11/mpv product path. Upstream 4K
  or HDR availability does not prove visible/smooth/HDR playback.
- Source-matched 1080p remains the safe fallback; launcher is always 1080p60.

## Mango stream surfaces

The loopback-only `GET /stream/{type}/{id}` response used by the launcher and
playback policy includes the playable URL alongside enriched fields such as
resolution, release tier/group, codec, size, language, debrid service, cache
status, HDR tags, readiness, and a couch-safe display label. Never render, log,
persist, screenshot, or forward those signed URLs. The URL-free guarantee
applies to the active in-mpv Streams snapshot and designated diagnostics—not to
this internal playback response. Broader DTO sanitization remains a hardening
surface.

The in-mpv Streams drawer is **not** an AIO group UI:

- active snapshot is URL-free and includes at most five choices with current
  always included;
- current is pinned first, best usable alternative initially focused, and
  unavailable rows are last/disabled;
- B triggers isolated Mango validation; AIO never auto-switches;
- a successful switch/Undo preserves the one logical progress/session contract.

A configured detail-list cap or AIO global result limit is not the drawer card
count. Do not revive older eight-row/center-modal documentation.

## Export contract

`/etc/mango/stremio-export.json` should contain one AIOStreams manifest named
`AIOStreams`, plus Cinemeta and AIOMetadata for their metadata/catalog roles.
Standalone Torrentio/RD/TorBox/MediaFusion stream manifests duplicate work,
weaken single-flight reasoning, and bypass the aggregate policy.

The generated AIO manifest URL is secret-bearing operator state. Verify its
reachability without printing it.

## Stateful workflow

The headless helper now hides `diff` values, holds request/response state only in
private temporary files with cleanup traps, emits fixed summaries, reads policy
back after mutation, and restores the original user object on verification
failure. `get` remains a deliberate full secret-bearing export and must not be
logged.

```bash
bash scripts/m4-addons/aiostreams-config.sh verify
bash scripts/m4-addons/aiostreams-config.sh enable-mediafusion
```

`verify` fails when required TorBox/RD/Easynews service policy,
Torrentio/Comet stream presets, Service Wrap, uncached rules, or error visibility
drift. It inspects AIOStreams `/api/v1/user` only: it does **not** validate
`/etc/mango/stremio-export.json` or the catalog-service direct MediaFusion
trigger. MediaFusion enablement validates the public base manifest first and
uses AIO's native credential injection rather than a secret share-manifest URL.

Audit the two missing topology surfaces without printing URLs:

```bash
jq -c '[.addons[].name]' /etc/mango/stremio-export.json
if [[ -s ~/.config/mango/mediafusion.manifest ]]; then
  echo 'direct MediaFusion file trigger: present'
else
  echo 'direct MediaFusion file trigger: absent'
fi
if grep -Eq '^[[:space:]]*(export[[:space:]]+)?MANGO_MEDIAFUSION_MANIFEST=' \
    ~/.config/mango/voice.env 2>/dev/null; then
  echo 'direct MediaFusion environment trigger: present'
else
  echo 'direct MediaFusion environment trigger: absent'
fi
```

Presence is not a credential leak, but the file/value itself is secret and
must never be printed. `gate-m4-streams.sh` proves response shape and rejects
some direct duplicate addons; it does not close this Pi-state audit by itself.

Then run:

```bash
bash scripts/m4-addons/gate-m4-streams.sh
bash scripts/m4-addons/gate-m4-stream-language.sh
bash scripts/diag/playback-ladder-health.sh movie tt3268458
```

Use exact requested episode IDs for series diagnosis. Never substitute S1E1,
clear cache/databases, or print URLs to make a contribution check pass.

## Current operational challenges

| Challenge | Required evidence |
|-----------|-------------------|
| Nested provider drift | Interactive sensitive diff, fixed-summary verify, sanitized export/direct-trigger audit, and credential-safe contribution counters on representative movie/episode corpus |
| 429/error classification | Fixed-category health counters and no error-placeholder caching/leakage |
| Thin regional supply | Before/after exact-ID yield and playable winner, not catalog count alone |
| MediaFusion | Fresh manifest 2xx, bounded latency/errors, incremental regional yield, no duplicate direct export |
| Detail vs Play timing | Detail late-join must not start a duplicate fan-out; Play keeps its independent deadline |
| Clean-empty recovery | Empty→empty→playable succeeds inside one exact-ID B press only for eligible clean/transient aggregate results |
| Daily/date-based series | `/api/v1/status` reports >=2.32.0 and the Alliance tail fixture returns an exact requested-episode candidate |
| 4K/HDR | Provider labels are not proof; record actual output/decode/drops/audio on target TV |

## References

- [AIOStreams configuration](https://docs.aiostreams.viren070.me/configuration/options/)
- [AIOStreams groups](https://docs.aiostreams.viren070.me/guides/groups/)
- [AIOStreams scored sorting](https://docs.aiostreams.viren070.me/guides/scored-sorting/)
- [AIOStreams API](https://docs.aiostreams.viren070.me/apis/)
- [Mango addon stack](addon-stack.md)
- [Mango playability](../PLAYABILITY.md)
- Operator UI guide: [`scripts/m4-addons/configure-aiostreams.md`](../../scripts/m4-addons/configure-aiostreams.md)
