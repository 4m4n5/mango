# ElfHosted fallback for mango

**N3d default:** mango uses self-hosted AIOStreams and AIOLists on the Pi. See
[`N3d-INVENTORY.md`](N3d-INVENTORY.md) and
[`tasks/phase-n3d-self-hosted-addon-stack.md`](tasks/phase-n3d-self-hosted-addon-stack.md).

ElfHosted is now a **paid fallback** if Pi-local addon hosting becomes too
fragile. Do not put public ElfHosted addon URLs in the hot path; public shared
instances are rate-limited under burst load.

## Paid fallback subscriptions

| Product | Link | Price | mango role |
|---------|------|-------|------------|
| **AIOMetadata** | [store.elfhosted.com/product/aiometadata](https://store.elfhosted.com/product/aiometadata/) | $9/mo · $1 / 7-day trial | Fallback catalog rails |
| **AIOStreams** | [store.elfhosted.com/product/aiostreams](https://store.elfhosted.com/product/aiostreams/) | $9/mo · $1 / 7-day trial | Fallback stream URLs + TorBox/RD formatting |
| **Stremio Addons Bundle** | [store.elfhosted.com/product/stremio-addons-bundle](https://store.elfhosted.com/product/stremio-addons-bundle/) | $29/mo · $1 / 7-day trial | Managed bundle if self-hosting is abandoned |

Docs: [Stremio addons overview](https://docs.elfhosted.com/stremio-addons/) · [Pricing & trials](https://docs.elfhosted.com/pricing/) · [AIOStreams app guide](https://docs.elfhosted.com/app/aiostreams/)

**Not included:** TorBox / Real-Debrid — paid directly to those providers.

Optional later (N7 / 4K proxy): [AIOStreams + MediaFlow 4K](https://store.elfhosted.com/product/aiostreams-mediaflowproxy/) · [2×4K booster](https://store.elfhosted.com/product/aiostreams-2x4k-booster/) (+$9/mo)

## If you choose the fallback

1. Open **My Account** on ElfHosted and copy your **private manifest URLs** for AIOMetadata and AIOStreams.
2. On the Pi, edit `/etc/mango/stremio-export.json` and replace local manifest URLs with your private instance URLs.
3. Restore matching addon names in `/etc/mango/catalog.yaml` and `/etc/mango/catalog-filters.json`; do not mix `AIOLists` yaml with `AIOMetadata` manifests.
4. Restart: `MANGO_CATALOG=1 bash ~/mango/scripts/mango-stack.sh restart`
5. Verify: `curl -sf http://127.0.0.1:3020/health` and load the launcher — no “rate limit exceeded” on home.

Or re-export from Stremio desktop (Settings → Export) after installing private addons, then:

```bash
bash ~/mango/scripts/phase-n1/setup-stremio-export.sh /path/to/stremioExport.json
```

## What subscription fixes vs N3c playability

| Issue | Private ElfHosted | N3c `playability.db` |
|-------|-------------------|----------------------|
| Rate limit on browse | **Yes** | Reduces repeat calls |
| Posters / catalog load | **Yes** (faster, dedicated) | Serves verified subset |
| Play actually works | **No** | **Yes** — probe before show |

N3c playability remains required. Private ElfHosted improves addon availability;
it does not prove a shown poster will play.

## Code mitigations (public instances)

Even without subscribing, mango reduces burst load:

- Rail response cache (45 min TTL on Pi)
- Cinemeta rails load before heavy catalog addons
- Staggered heavy catalog fetches (launcher + catalog-service)
- Couch-safe errors (no raw “rate limit exceeded” on screen)

See `src/catalog-service/README.md` env vars `MANGO_RAIL_*`.
