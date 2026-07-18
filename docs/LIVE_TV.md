# Live TV (IPTV)

**Status:** Shipped on `feat/native-experience` — **Live** browse tab, sport rails, mpv `--live`.

Wire **NexoTV** (Stremio addon) on the Pi. AREA69 and the curated free
IPTV-org sports, news, and cartoons inventories run as separate local
instances. `catalog-service` classifies six thin rails from structured channel,
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
                    launcher Live tab → POST /play → mpv --live
```

| Addon name (export) | Instance | Default profile |
|---------------------|----------|-----------------|
| `mango Live TV` | `:7000` | `area69-xtream` (paid) |
| `mango Live Free` | `:7001` | `iptv-org-sports` (legal free) |
| `mango Live News` | `:7002` | `iptv-org-news` (India + US + UK) |
| `mango Live Cartoons` | `:7003` | curated English/Hindi IPTV-org kids |

Rails (6, fixed order): **FIFA World Cup**, **cricket**, **soccer**, **Formula
1**, **news**, **cartoons**. Empty qualified rails are hidden. See
`config/catalog-live.example.yaml`.

---

## Pi setup (once)

```bash
cd ~/mango && git pull

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

`wire-export` appends both manifests to `/etc/mango/stremio-export.json` without overwriting the paid URL.

---

## Couch UX

| Behavior | Detail |
|----------|--------|
| Tab | **movies · series · live** — L/R shoulders or browse bar |
| Refresh / ↻ | Live tab **does not** pass `reshuffle=1` (avoids NexoTV rate limits) |
| Native Live search | `GET /voice/search?tab=live&q=` searches full local AREA69 + free/news/cartoons inventories, independent of rail curation. Ordinary voice Live intent uses the same path. |
| Search proof | Fresh successful plays/probes return immediately; known failures are suppressed. At most one free and one AREA69 unknown top match validate concurrently for up to 2 s. Slow proof continues asynchronously and is eligible only on a later search. |
| Cache | Memory + disk `~/.cache/mango/live-rails-cache.json`; only policy-compatible stale non-empty cache may be fallback. Old broad-policy caches are rejected. |
| Health state | `~/.cache/mango/live-channel-health.json`, operator-owned and credential-safe. Real play/probe success promotes; resolve/reachability/play-start failure demotes until the existing Live cache horizon expires. |
| Play | Detail → **watch live** · `POST /play` with `live: true`; canonical variants form one quality-ordered ladder and fail over within the existing play deadline. No external app handoff. |
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

Curated M3U profiles enable NexoTV EPG where supported. World Cup, India
cricket, and soccer rails are hybrid: current qualifying matchups rank first,
then exact standing brands from the curated sports M3U fill remaining slots.
Standing fills never broaden into arbitrary sports keywords and still reject
known wrong-event, foreign-cricket, MLS-only, replay, studio, preview, ended,
and placeholder rows. World Cup current-event admission understands AREA69
shapes (`2026 FIFA World Cup … Team vs Team`, `World Cup 01 : Team vs Team`)
without requiring a `LIVE |` prefix; `End |` / `NEXT |` titles stay out.
Cartoons keep the exact classics allowlist and admit
missing/unknown language metadata, while rejecting known non-English/Hindi
metadata. Missing target news/cartoon channels shrink the rail instead of
admitting generic substitutes.

AREA69 event inventory is the versioned search index written by
`nexotv-config.sh apply-area69` (`~/.local/share/mango/nexotv/data/area69-live-search.json`).
Rebuild it before or during major match days — a stale index only has yesterday's
PPV titles, so today's World Cup match cannot appear even when qualification is correct.

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

`/health` exposes operator-only Live diagnostics without reshuffling Live:
config readiness, source addon names, disk cache compatibility and per-rail
counts, last rebuild error, plus qualified, verified, failed, queued, unknown,
and stale search candidates.

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
| FIFA World Cup | Current senior men's World Cup matches first; remaining slots may use exact curated FIFA+/FIFA+ United States fills only. No qualifiers, women's/club/adjacent FIFA events, generic sports brands, replays, or ended rows |
| Cricket | Current India-participant cricket matches first; remaining slots may use exact curated Star Sports / Willow / DD Sports / Cricket Gold fills. `West Indies` and incidental `Indian` text do not qualify; foreign matchups on standing brands stay rejected |
| Soccer | Current Premier League, La Liga, Bundesliga, Serie A, Ligue 1, UCL, or UEL matches first; remaining slots may use exact curated beIN Sports fills only. MLS-only and generic sports brands stay rejected |
| Formula 1 | Up to four exact F1 TV, Sky Sports F1, DAZN F1, and Viaplay F1 variants only |
| News | Exact 4 Indian English + 4 Indian Hindi + 4 global English target identities; missing rows are not substituted |
| Cartoons | Up to eight classics-first allowlisted families; missing/unknown language metadata is admitted, known non-English/Hindi metadata is rejected |

---

## Manual checks (opt-in)

After a reviewed deploy and cache rebuild on the home Mac/Pi, confirm rail
membership without claiming inventory from the work Mac:

```bash
curl -s 'http://127.0.0.1:3020/rails/items?tab=live' | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print([(r.get('label'),len(r.get('items')or[])) for r in d.get('rails',[])])"
bash scripts/live/audit-live-rails.sh
```

Expect non-zero World Cup, cricket, soccer, and cartoon rails only when their
free M3U/NexoTV sources are healthy. If profiles drift, the operator must
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
