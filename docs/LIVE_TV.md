# Live TV (IPTV) — NexoTV spike

Wire **NexoTV** as a self-hosted Stremio addon on the Pi. Browse live channels via the addon graph; play in **mpv** with `--live` probe semantics.

**Test sources (legal):** [IPTV-org](https://github.com/iptv-org/iptv) sports category and M3U playlists. Bring your own M3U/Xtream credentials via profiles when ready.

## Quick start (Pi)

```bash
cd ~/mango && git pull

# 1. Docker + NexoTV
bash scripts/phase-n3d/bootstrap-docker.sh   # once
cp deploy/nexotv/.env.example deploy/nexotv/.env
# edit CONFIG_SECRET: openssl rand -hex 32
bash scripts/phase-live/install-nexotv.sh

# 2. Profile (IPTV-org sports by default)
bash scripts/phase-live/nexotv-config.sh init-profiles
bash scripts/phase-live/nexotv-config.sh list-profiles
bash scripts/phase-live/nexotv-config.sh apply iptv-org-sports
bash scripts/phase-live/nexotv-config.sh wire-export

# 3. Restart catalog if enabled
# MANGO_CATALOG=1 bash scripts/mango-stack.sh restart

# 4. Gate
bash scripts/phase-live/gate-live-iptv.sh
bash scripts/phase-live/probe-live-catalog.sh
MANGO_LIVE_PLAY=1 bash scripts/phase-live/gate-live-iptv.sh
```

## Profiles

Copy and edit `~/.config/mango/nexotv-profiles.json` from `config/nexotv-profiles.example.json`.

| Profile | Use |
|---------|-----|
| `iptv-org-sports` | Worldwide sports channels (free, legal) |
| `iptv-org-sports-in` | India sports filter |
| `m3u-sports` | Direct sports.m3u from IPTV-org |
| `m3u-custom` / `xtream-custom` | Your provider credentials |
| `area69-xtream` | AREA69IPTV Xtream (use `apply-area69`) |

## AREA69IPTV

When your subscription email arrives:

```bash
cp config/area69.credentials.example ~/.config/mango/area69.credentials
chmod 600 ~/.config/mango/area69.credentials
# edit XTREAM_URL, XTREAM_USER, XTREAM_PASS

bash scripts/phase-live/nexotv-config.sh apply-area69
bash scripts/phase-live/nexotv-config.sh wire-export
bash scripts/phase-live/probe-live-catalog.sh
MANGO_LIVE_PLAY=1 bash scripts/phase-live/gate-live-iptv.sh
```

Until then, gate with `apply iptv-org-sports` (free legal test source).

## Sports discovery

```bash
bash scripts/phase-live/probe-live-catalog.sh
```

## Architecture

```
NexoTV :7000  →  stremio-export.json  →  catalog-service (optional)
                                              ↓
                                         mpv --live
```

NexoTV catalog type is **`tv`** / `iptv_channels`. Launcher live rails are a follow-up (N8).

## Next

- `live` tab in launcher + `catalog.yaml` rails (`content_type: tv`)
- `POST /play` with `{type:"tv", id:"…", live: true}`
