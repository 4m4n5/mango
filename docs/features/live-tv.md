# Live TV

Live is optional. Default deploy and pre-couch gates do not require it.
Opt in with `MANGO_LIVE_GATE=1` or `MANGO_LIVE_PROBE=1`.

## What Mango ships

- Launcher Live tab and catalog-service live rails
- Example M3U files under `config/live-*.m3u` with placeholder URLs
- Optional NexoTV Docker profiles under `deploy/nexotv*`

Mango does not grant rights to broadcast streams. Replace example playlists
with sources you are allowed to use.

## Operator steps

1. Copy an example playlist or NexoTV compose file.
2. Point catalog live YAML at your playlist or addon.
3. Prove health before treating a rail as couch-ready.
4. Keep credentials and full playlists off Git.

Health-only diagnostics: `scripts/live/gate-live-diagnostics.sh`.
Full IPTV gate: `scripts/live/gate-live-iptv.sh`.
