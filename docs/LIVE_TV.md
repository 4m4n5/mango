# Live TV (IPTV)

**Status:** Source-shipped on `feat/native-experience` as an **optional** Live
browse/search path with mpv `--live`. Inventory, credentials, event availability,
and playback health are Pi/runtime facts; Live remains outside default gates.

Wire **NexoTV** (Stremio addon) on the Pi. AREA69 and the curated free
IPTV-org sports, news, and cartoons inventories run as separate local
instances. `catalog-service` classifies four thin rails from structured channel,
programme, category, and language fields; launcher playback stays native Mango
through mpv.

---

## Architecture

```
NexoTV AREA69  :7000 ─┐
NexoTV free    :7001 ─┤
NexoTV news    :7002 ─┼→ stremio-export.json → catalog-service (:3020)
NexoTV cartoons:7003 ─┘         ↓
                    GET /rails/items?tab=live
                               ↓
                    launcher Live tab → POST /play-session → mpv --live
```

| Addon name (export) | Instance | Default profile |
|---------------------|----------|-----------------|
| `mango Live TV` | `:7000` | `area69-xtream` (paid) |
| `mango Live Free` | `:7001` | `iptv-org-sports` (legal free) |
| `mango Live News` | `:7002` | `iptv-org-news` (India + US + UK) |
| `mango Live Cartoons` | `:7003` | curated English/Hindi IPTV-org kids |

Rails (4, fixed order): **cricket** (India sources), **Formula 1**, **news**,
**cartoons**. Empty qualified rails are hidden. Live has no shuffle (cached to
avoid NexoTV rate limits). See `config/catalog-live.example.yaml`.

---

## Pi setup (once)

Deploy the intended repository revision through the normal Git-only flow in
[DEPLOY.md](DEPLOY.md) first. Then, from the already-built Pi checkout:

```bash
cd ~/mango

bash scripts/m4-addons/bootstrap-docker.sh   # once
cp deploy/nexotv/.env.example deploy/nexotv/.env
cp deploy/nexotv-free/.env.example deploy/nexotv-free/.env
# CONFIG_SECRET in each: openssl rand -hex 32

bash scripts/live/install-nexotv.sh
bash scripts/live/install-nexotv-free.sh

bash scripts/live/nexotv-config.sh init-profiles
```

### Paid (AREA69 Xtream)

```bash
cp config/area69.credentials.example ~/.config/mango/area69.credentials
chmod 600 ~/.config/mango/area69.credentials
# XTREAM_URL, XTREAM_USER, XTREAM_PASS

bash scripts/live/nexotv-config.sh apply-area69
```

### Free sports (IPTV-org)

```bash
bash scripts/live/nexotv-config.sh apply-free iptv-org-sports
```


### News (IPTV-org — India + US + UK)

```bash
bash scripts/live/install-nexotv-news.sh
bash scripts/live/nexotv-config.sh apply-news iptv-org-news
```

### Cartoons (IPTV-org — explicit English/Hindi metadata)

```bash
bash scripts/live/install-nexotv-cartoons.sh
bash scripts/live/nexotv-config.sh apply-cartoons m3u-cartoons
```

### Wire + restart

```bash
bash scripts/live/nexotv-config.sh wire-export
# optional: sudo cp config/catalog-live.example.yaml /etc/mango/catalog-live.yaml
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

`wire-export` rewrites the managed Live entries without overwriting the paid
URL: paid plus whichever of free, news, and cartoons are configured (up to four
Live manifests).

---

## Couch UX

| Behavior | Detail |
|----------|--------|
| Tab | **Movies · TV Shows · Live · YouTube** (plus Search magnifier) — L/R shoulders or browse bar |
| Refresh / ↻ | Live tab **does not** pass `reshuffle=1` (avoids NexoTV rate limits) |
| Native Live search | `GET /voice/search?tab=live&q=` searches full local AREA69 + free/news/cartoons inventories, independent of rail curation. Ordinary voice Live intent uses the same path. |
| Search proof | Fresh successful plays/probes return immediately; known failures are suppressed. At most one free and one AREA69 unknown top match validate concurrently for up to 2 s. Slow proof continues asynchronously and is eligible only on a later search. |
| Cache | Memory + disk `~/.cache/mango/live-rails-cache.json`; a playback-yielding, rate-limited background tick rebuilds when config is ready and cache is stale. A new Home generation publishes only after every configured curated source contributes; an outage retains the last policy-compatible complete cache and retries the partial source pool quickly. Old broad/partial-policy caches are rejected. |
| Health state | `~/.cache/mango/live-channel-health.json`, operator-owned and credential-safe. Real play/probe success promotes; resolve/reachability/play-start failure demotes until the existing Live cache horizon expires. |
| Play | Detail → **watch live** · accepted `POST /play-session` with `live: true`; canonical variants form one quality-ordered ladder and fail over within the existing play deadline. No VOD clean-empty confirmation and no external app handoff. |
| Ordering | Eligibility and proof first; then nominal resolution (2160p = 4K, only 4320p/explicit 8K = 8K), English/Hindi, codec, measured health. |

---

## Config

| File | Pi path | Purpose |
|------|---------|---------|
| `config/catalog-live.example.yaml` | `/etc/mango/catalog-live.yaml` (optional) | Sport rails, sources, cache |
| `config/nexotv-profiles.example.json` | `~/.config/mango/nexotv-profiles.json` | M3U / Xtream profiles |
| `~/.config/mango/nexotv.credentials` | paid token + manifest | from `apply-area69` |
| `~/.config/mango/nexotv-free.credentials` | free token + manifest | from `apply-free` |

Key flags in `catalog-live.yaml`:

| Field | Shipped value | Why |
|-------|---------------|-----|
| `verify_streams` | `false` | Avoid broad browse-time NexoTV `/stream/` probing; search performs only bounded playback-start proof |
| `cache_ttl_sec` | `1800` | Reduce catalog rebuild churn |
| `sources[].pages` | `1` in the example | Each local curated inventory is already thin; AREA69 full search comes from its separate versioned index |

Curated M3U profiles enable NexoTV EPG where supported. The current browse
contract is deliberately narrow: India-participant cricket, Formula 1/racing,
balanced news, and English/Hindi cartoons. Current qualifying events rank ahead
of exact standing-channel fills; broad sports keywords, foreign-cricket-only,
replay, studio, preview, ended, placeholder, and adjacent-motorsport rows stay
out. Cartoons keep the exact classics allowlist and admit
missing/unknown language metadata, while rejecting known non-English/Hindi
metadata. Missing target news/cartoon channels shrink the rail instead of
admitting generic substitutes.

AREA69 event inventory is the versioned search index written by
`nexotv-config.sh apply-area69` (`~/.local/share/mango/nexotv/data/area69-live-search.json`).
Rebuild it before or during major event days. The full index feeds Search/voice;
it does not create World Cup or soccer Home rails in the current four-rail
configuration.

---

## Rate limits (operational)

NexoTV returns `ratelimit_error` metas and `https://example.com/ratelimited` stream URLs when hammered.

**Do not** run live gates/probes during deploy — they are **opt-in only**:

```bash
MANGO_LIVE_GATE=1 bash scripts/live/gate-live-iptv.sh
MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh
```

**Recovery:** restart both NexoTV containers, wait ~1 min, browse Live tab once (no reshuffle).

```bash
cd ~/mango/deploy/nexotv && docker compose restart
cd ~/mango/deploy/nexotv-free && docker compose restart
```

### Health-only diagnostics

`/health` exposes operator-only Live diagnostics without reshuffling Live.
`live.config_ready` means config loaded, `live.cache_fresh` means the memory/disk
snapshot is within TTL, and `live.serving_stale` means a compatible non-empty
stale snapshot remains available while refresh retries. `live.ready` and
top-level `live_ready` remain backward-compatible config-readiness aliases.
The refresh attempt/success/error ledger persists beside the cache at
`live-rails-cache.json.status.json`, so a catalog restart does not erase the
last failure signal. Diagnostics also include source addon names, per-rail
counts, and qualified, verified, failed, queued, unknown, and stale search
candidates.

```bash
bash scripts/live/live-diagnostics.sh
bash scripts/live/live-diagnostics.sh --json
bash scripts/live/gate-live-diagnostics.sh
MANGO_LIVE_REQUIRE_STALE_FALLBACK=1 bash scripts/live/gate-live-diagnostics.sh
```

The cache contract is conservative but policy-versioned: a compatible non-empty
stale Live cache is better than an empty Live tab. An older broad-membership
cache is incompatible and must not silently return.

---

## Curated membership contract

| Rail | Admission |
|------|-----------|
| Cricket | Current India-participant cricket matches first; remaining slots may use exact curated Star Sports / Willow / DD Sports / Cricket Gold fills. `West Indies` and incidental `Indian` text do not qualify; foreign matchups on standing brands stay rejected |
| Formula 1 | Up to four exact F1 TV, Sky Sports F1, DAZN F1, and Viaplay F1 variants only |
| News | Exact 4 Indian English + 4 Indian Hindi + 4 global English target identities; missing rows are not substituted |
| Cartoons | Up to eight classics-first allowlisted families; missing/unknown language metadata is admitted, known non-English/Hindi metadata is rejected |

---

## Manual checks (opt-in)

After a reviewed deploy and cache rebuild on the home Mac/Pi, confirm rail
membership without claiming inventory from the work Mac:

```bash
curl -s 'http://127.0.0.1:3020/rails' | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print([(r['id'],r.get('seed_count'),r.get('merge_target')) for r in d['rails'] if r.get('tab')=='live' and r.get('type')=='ai_catalog'])"
curl -s 'http://127.0.0.1:3020/rails/items?tab=live' | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print([(r.get('label'),len(r.get('items')or[])) for r in d.get('rails',[])])"
sudo sed -n '1,220p' /etc/mango/ai-catalogs/slots/cricket-channels.yaml
bash scripts/live/audit-live-rails.sh
```

An unfiltered `/rails` Live AI entry with `sources: []` is seed-driven, not an
empty VOD rail: `seed_count` reports its slot inventory and `merge_target`
names the YAML Live rail that receives those seeds. Probe the rendered result
with `/rails/items?tab=live`; do not use `/rails/ai-*/items`, which is the VOD
playability path.

Expect only the configured cricket, Formula 1, news, and cartoon rails, and only
when their M3U/NexoTV sources are healthy. If profiles drift, the operator must
re-apply the curated profiles with `bash scripts/live/nexotv-config.sh apply-*`
before interpreting empty counts. These are Pi-only confirmation steps and
were not run on the work Mac.

```bash
MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh
MANGO_LIVE_GATE=1 MANGO_LIVE_PLAY=1 bash scripts/live/gate-live-iptv.sh
bash scripts/live/gate-live-diagnostics.sh
curl -s http://127.0.0.1:3020/health | python3 -m json.tool   # includes live diagnostics
curl -s 'http://127.0.0.1:3020/rails/items?tab=live' | python3 -c "import json,sys;d=json.load(sys.stdin);print([(r['label'],len(r.get('items')or[])) for r in d.get('rails',[])])"
curl -sG 'http://127.0.0.1:3020/voice/search' --data-urlencode 'tab=live' --data-urlencode 'q=BBC News' | python3 -m json.tool
```

---

## Open items

- Optional `verify_streams: true` when NexoTV limits are raised
- Runtime confirmation of provider EPG completeness and representative fallback ladders is Pi-only; see `COUCH_TEST.md`
