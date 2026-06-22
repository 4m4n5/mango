# Live TV (IPTV)

**Status:** Shipped on `feat/native-experience` — **Live** browse tab, sport rails, mpv `--live`.

Wire **NexoTV** (Stremio addon) on the Pi. Paid Xtream (AREA69) + free IPTV-org sports run as **two Docker instances**. `catalog-service` builds sport rails from `catalog-live.yaml`; launcher plays with `{ type: "tv", live: true }`.

---

## Architecture

```
NexoTV paid  :7000  ─┐
                     ├→ stremio-export.json → catalog-service (:3020)
NexoTV free  :7001  ─┘         ↓
                    GET /rails/items?tab=live
                               ↓
                    launcher Live tab → POST /play → mpv --live
```

| Addon name (export) | Instance | Default profile |
|---------------------|----------|-----------------|
| `mango Live TV` | `:7000` | `area69-xtream` (paid) |
| `mango Live Free` | `:7001` | `iptv-org-sports` (legal free) |
| `mango Live News` | `:7002` | `iptv-org-news` (India + US + UK) |

Rails (5): **cricket**, **football & soccer**, **racing**, **news** — see `config/catalog-live.example.yaml`.

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
| Cache | Memory + disk `~/.cache/mango/live-rails-cache.json` (30 min TTL); stale fallback if rebuild empty |
| Play | Detail → **watch live** · `POST /play` with `live: true` |
| Ordering | Paid (AREA69) channels sort before free per rail |

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
| `verify_streams` | `false` | Stream probes hit NexoTV `/stream/` rate limit (~60/min) |
| `cache_ttl_sec` | `1800` | Reduce catalog rebuild churn |
| `sources[].pages` | 6 paid / 4 free | Catalog pagination (100 per page) |

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

---

## Known coverage (2026-06)

| Rail | Paid (AREA69) | Free |
|------|---------------|------|
| Football & soccer | ✓ PRIME / sport genres | backup |
| Racing | ✓ F1 / NASCAR (paid) | ✓ Rally, Sky Racing, FloRacing (free) |
| News | ✓ CNN / NBC / BBC / Bloomberg (paid national) | ✓ Indian + US via `:7002` |
| Cricket | sparse in AREA69 catalog pages | ✓ Star Sports, Willow-class channels |

Paid cricket may require more catalog pages or provider-side genre browsing — not a launcher bug.

---

## Manual checks (opt-in)

```bash
MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh
MANGO_LIVE_GATE=1 MANGO_LIVE_PLAY=1 bash scripts/live/gate-live-iptv.sh
curl -s http://127.0.0.1:3020/health | python3 -m json.tool   # live_rails: 3
curl -s 'http://127.0.0.1:3020/rails/items?tab=live' | python3 -c "import json,sys;d=json.load(sys.stdin);print([(r['label'],len(r.get('items')or[])) for r in d.get('rails',[])])"
```

---

## Next

- Paid cricket: deeper AREA69 catalog scan or genre-specific fetch
- Optional `verify_streams: true` when NexoTV limits are raised
- EPG / “now playing” subtitles from NexoTV `releaseInfo`
- Voice: `play live cricket` tool (M5, deferred)
