# Configuration

Public examples live in [`config/`](../config/) and [`deploy/*/`](../deploy/).
Runtime secrets and databases live on the Pi only.

## Device paths

| Path | Role |
|------|------|
| `/etc/mango/` | Device-owned secrets, catalog YAML, SQLite DBs, YouTube auth |
| `$HOME/.config/mango/` | Voice env, TLS certs, optional MediaFusion manifest |
| `$HOME/.cache/mango/` | Logs, sockets, playback session, HUD routing |
| `$HOME/.local/share/mango/` | Addon Docker data (AIOStreams, AIOMetadata, NexoTV) |
| `$HOME/mango` | Git clone |

Never commit those runtime directories. Backup with
`scripts/m6-ship/backup-library-state.sh` before migrations.

## Supported environment variables

Classify a `MANGO_*` variable before adding another.

| Class | Examples | Public? |
|-------|----------|---------|
| Public configuration | `MANGO_PI_HOST`, `MANGO_PI_USER`, `MANGO_GAMEPAD_BT_MAC`, `MANGO_CATALOG_URL`, `MANGO_VOD_RECS_V2`, `MANGO_YOUTUBE_RECS_V2` | Yes — document defaults |
| Deploy / gate | `MANGO_DEPLOY_SHA`, `MANGO_DEPLOY_ALLOW_DIRTY`, `MANGO_SYNC_AIOMETADATA`, `MANGO_GATE_FULL`, `MANGO_LIVE_GATE` | Yes |
| Internal implementation | `MANGO_PLAY_EPOCH`, `MANGO_HUD_INSTANCE`, cache sockets | No — scripts own them |
| Deprecated aliases | Historical `MANGO_VLC_*` seek names | Keep until tests prove unused |

### Operator defaults

| Variable | Default | Purpose |
|----------|---------|---------|
| `MANGO_PI_HOST` | `mango.local` | SSH / discovery host |
| `MANGO_PI_USER` | current user | Pi login and unit user |
| `MANGO_SSH_HOST` | `mango` | SSH config alias |
| `MANGO_REPO_DIR` | `$HOME/mango` | Checkout path |
| `MANGO_GAMEPAD_BT_MAC` | unset (required) | 8BitDo Bluetooth address |
| `MANGO_VOD_RECS_V2` | operator-set | `off` / `shadow` / `serve` |
| `MANGO_YOUTUBE_RECS_V2` | operator-set | `off` / `shadow` / `serve` |
| `MANGO_SKIP_OVERLAY` | `1` | Retired Chromium overlay stays off |
| `MANGO_PLAYBACK_OSD_BACKEND` | `lua` | In-mpv HUD |
| `MANGO_SYNC_AIOMETADATA` | unset | Opt-in rail mutation during deploy |
| `MANGO_LIVE_GATE` | unset | Opt-in Live IPTV gates |

A generated inventory of remaining `MANGO_*` names is not a public contract.
Prefer the tables above and the example YAML comments.

## Example files

See [config/README.md](../config/README.md). Copy examples to `/etc/mango`
once, then edit on the device.

Recommendation modes are independent. `off` hides rails, `shadow` builds
without exposing them, and `serve` publishes the accepted generation. There
is no executable legacy ranker.

## Secrets

Place keys in `/etc/mango` (`tmdb.key`, `youtube-api.key`,
`youtube-oauth-client.json`, `youtube-auth.json`, `stremio.json`). Voice keys
belong in `$HOME/.config/mango/voice.env` from `config/voice.env.example`.

Do not put debrid tokens, OAuth refresh tokens, or live playlist URLs in Git.
