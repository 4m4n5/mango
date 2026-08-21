# Install

Mango is a Raspberry Pi 5 kiosk, not a generic desktop app. You can build and
test services on macOS or Linux; playback, pad, and display proof happen on
the Pi.

## Workstation (Mac or Linux)

Need Node.js 20+ and Python 3.11+.

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build && npm test
cd ../companion && npm ci && npm run build
```

Optional voice orchestrator:

```bash
python3 -m venv src/orchestrator/.venv
src/orchestrator/.venv/bin/pip install -r src/orchestrator/requirements.txt
```

Do not copy a workstation `.venv` to the Pi. Create it on the device.

## Raspberry Pi 5

1. Install Raspberry Pi OS Desktop on an 8 GB Pi 5.
2. Enable X11 (not Wayland) and Openbox or the default PIXEL session.
3. Install Chromium, mpv, Node.js 20, Python 3, BlueZ, and git.
4. Clone this repository to `$HOME/mango`.
5. Copy example configuration into `/etc/mango` and `$HOME/.config/mango`.
   Never commit the populated files. See [CONFIGURATION.md](CONFIGURATION.md).
6. Set `MANGO_PI_HOST` (usually `mango.local`) and `MANGO_PI_USER` on the
   workstation. Run `bash scripts/setup-mac-pi-ssh.sh` once.
7. Set `MANGO_GAMEPAD_BT_MAC` to your controller address before enabling the
   link supervisor.
8. Build catalog-service, launcher, and companion on the Pi, then start the
   stack:

```bash
cd ~/mango
cd src/catalog-service && npm ci && npm run build
cd ../launcher && npm ci && npm run build
cd ../companion && npm ci && npm run build
bash scripts/mango-stack.sh start
bash scripts/pi-pre-couch-gate.sh
```

Install user systemd units from `scripts/m1-foundation/ui/systemd/` after the
first successful manual start. Units use `%h` and `%u`; they do not assume a
household username.

## Optional integrations

| Integration | What you supply |
|-------------|-----------------|
| AIOStreams / AIOMetadata | Docker + operator credentials; see `deploy/` |
| YouTube | Data API key, OAuth TV client, optional Takeout |
| Voice | Deepgram and LLM keys in `$HOME/.config/mango/voice.env` |
| Live IPTV | Your own M3U or NexoTV profile; repo playlists are examples |
| Regional catalogs | Your own Stremio-compatible manifest URL |

Git deploy after the first install is documented in
[OPERATIONS.md](OPERATIONS.md). Never rsync the repository onto the Pi.
