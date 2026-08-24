# Install

Mango is a Raspberry Pi 5 kiosk, not a generic desktop app. You can build
and test services on macOS or Linux. Playback, pad, and display proof
happen only on the Pi.

This is a **manual alpha**. There is no no-SSH first-boot wizard. If a
command fails, stop and read [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
rather than inventing a copy method.

## Prerequisites

| Item | Supported |
|------|-----------|
| Host | Raspberry Pi 5, 8 GB recommended |
| OS | Raspberry Pi OS Desktop, 64-bit |
| Display stack | X11 + Openbox or the default PIXEL session. Wayland is unsupported |
| Packages | git, Node.js 20+, Python 3.11+, Chromium, mpv, BlueZ |
| Optional | Docker (AIOStreams / AIOMetadata / NexoTV) |
| Controller | 8BitDo Micro in Switch Bluetooth mode, or an equivalent D-pad |
| Workstation | macOS or Linux with SSH to the Pi |

You also supply, as needed: Stremio-compatible addon manifests, YouTube
Data API + OAuth TV client, LLM/Deepgram keys, and any Live playlist you
are allowed to use. The repository does not include those.

## Workstation smoke

Need Node.js 20+.

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
git checkout main
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build && npm test
cd ../companion && npm ci && npm run build
```

Expected: all three packages install; catalog and launcher tests pass;
companion builds. This is local-pass only.

Optional voice orchestrator — create the venv **on the machine that will
run it**. Do not copy a workstation `.venv` to the Pi.

```bash
python3 -m venv src/orchestrator/.venv
src/orchestrator/.venv/bin/pip install -r src/orchestrator/requirements.txt
```

## Raspberry Pi 5

### 1. Operating system

1. Flash Raspberry Pi OS Desktop.
2. Boot, finish first-run setup, and enable SSH.
3. Switch the session to X11 if the image defaulted to Wayland.
4. Confirm you can open a terminal on the desktop.

### 2. Packages

```bash
sudo apt update
sudo apt install -y git chromium mpv python3 python3-venv python3-pip \
  bluetooth bluez
# Node.js 20 via the method you already trust for the Pi (NodeSource, nvm, or distro)
node -v   # expect v20.x
```

Install Docker only if you will run the example compose files in `deploy/`.

### 3. Clone

```bash
git clone https://github.com/4m4n5/mango.git "$HOME/mango"
cd "$HOME/mango"
git checkout main
```

Expected: `git rev-parse --abbrev-ref HEAD` prints `main`.

### 4. Configuration

Copy examples once, then edit on the device. Never commit the populated
files.

```bash
sudo mkdir -p /etc/mango
sudo cp -n config/config.example.yaml /etc/mango/config.yaml
# plus catalog YAML, keys, and addon export as described in CONFIGURATION.md
mkdir -p "$HOME/.config/mango" "$HOME/.cache/mango" "$HOME/.local/share/mango"
```

Set workstation env before the first deploy helper:

| Variable | Typical value |
|----------|----------------|
| `MANGO_PI_HOST` | `mango.local` |
| `MANGO_PI_USER` | your Pi login |
| `MANGO_GAMEPAD_BT_MAC` | the controller Bluetooth address |

```bash
bash scripts/setup-mac-pi-ssh.sh
```

Expected: `ssh mango` opens a shell without a numeric LAN address baked
into the repo.

Details: [CONFIGURATION.md](CONFIGURATION.md) · [HARDWARE.md](HARDWARE.md).

### 5. Build and first start

On the Pi:

```bash
cd ~/mango
cd src/catalog-service && npm ci && npm run build
cd ../launcher && npm ci && npm run build
cd ../companion && npm ci && npm run build
bash scripts/mango-stack.sh start
bash scripts/pi-pre-couch-gate.sh
```

Expected:

- `mango-stack.sh status` shows the UI server, catalog-service, and
  launcher job
- Chromium kiosk is up at 1920×1080
- `pi-pre-couch-gate.sh` reports named checks for this SHA
- `/etc/mango` still contains only files you created

Install user systemd units only after that manual start succeeds:

```bash
bash scripts/m1-foundation/ui/install-systemd-units.sh
```

Units use `%h` and `%u`. They do not assume a household username.

### 6. Controller

Pair the 8BitDo Micro in Switch mode (hold START+Y). Set
`MANGO_GAMEPAD_BT_MAC`, then:

```bash
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check
sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply
```

Ordinary power-on is the happy path. Pairing mode is recovery only.

### 7. Optional integrations

| Integration | What you supply | Where |
|-------------|-----------------|-------|
| AIOStreams / AIOMetadata | Docker + operator credentials | `deploy/` |
| YouTube | Data API key, OAuth TV client, optional Takeout | `/etc/mango` |
| Voice | Deepgram and LLM keys | `$HOME/.config/mango/voice.env` |
| Live IPTV | Your own M3U or NexoTV profile | `deploy/nexotv*` examples |
| Regional catalogs | Your own Stremio-compatible manifest URL | catalog YAML |

Repo playlists and compose files are examples. They do not grant media
rights.

## Rollback

| Situation | Action |
|-----------|--------|
| First start fails | `bash scripts/mango-stack.sh stop`. Do not enable systemd yet |
| Bad config | Restore the example file you copied; keep `/etc/mango/*.db` |
| Bad Git revision | Check out the last known-good `main` SHA and rebuild. Never rsync |
| Want the previous library | Restore from `scripts/m6-ship/backup-library-state.sh` |

Later updates use Git only: [OPERATIONS.md](OPERATIONS.md).

## What this install does not prove

A green local or Pi gate is not couch proof. Picture, audio, lip-sync,
controller feel, and recommendation relevance stay
[STATUS.md](STATUS.md) / human observation.
