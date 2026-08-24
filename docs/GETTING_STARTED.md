# Getting started

Use this page to decide whether Mango fits, smoke-test the source, and start
a first Pi install. The exact manual setup is [INSTALL.md](INSTALL.md).

## Does this fit?

Mango is a good match if you:

- have (or will buy) a Raspberry Pi 5 and a small D-pad controller
- already have, or can create, addon / YouTube / optional Live credentials
- are comfortable with SSH, systemd user units, and editing example config
- want one household-owned TV surface instead of an app switcher

It is a poor match if you want a plug-and-play box, bundled movies, native
HDR, or a no-SSH installer. Those are non-goals for this alpha.

## Local smoke (about five minutes)

On macOS or Linux, with Node.js 20+:

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build && npm test
cd ../companion && npm ci && npm run build
```

Expected result: catalog tests pass, launcher builds and tests pass, companion
builds. This is **local-pass** only. It does not prove TV picture, audio, or
the controller.

Optional voice orchestrator (do not copy this venv to the Pi):

```bash
python3 -m venv src/orchestrator/.venv
src/orchestrator/.venv/bin/pip install -r src/orchestrator/requirements.txt
```

## First Pi install (shortest path)

1. Flash Raspberry Pi OS Desktop on an 8 GB Pi 5 and enable X11, not Wayland.
2. Install Chromium, mpv, Node.js 20, Python 3, BlueZ, git, and Docker if you
   will run AIOStreams locally.
3. Clone this repository to `$HOME/mango` on `main`.
4. Copy examples from `config/` into `/etc/mango` and `$HOME/.config/mango`.
   See [CONFIGURATION.md](CONFIGURATION.md).
5. Set `MANGO_PI_HOST`, `MANGO_PI_USER`, and `MANGO_GAMEPAD_BT_MAC` on the
   workstation. Run `bash scripts/setup-mac-pi-ssh.sh` once.
6. Build and start:

```bash
cd ~/mango
cd src/catalog-service && npm ci && npm run build
cd ../launcher && npm ci && npm run build
cd ../companion && npm ci && npm run build
bash scripts/mango-stack.sh start
bash scripts/pi-pre-couch-gate.sh
```

Expected result: the launcher is reachable on the Pi, the pre-couch gate
prints pass/fail for the current SHA, and no secrets were committed.

If a step fails, stop and read [TROUBLESHOOTING.md](TROUBLESHOOTING.md). Do
not rsync, reset databases, or enter controller pairing mode as a first fix.

## Next

- Couch buttons and library: [USER_GUIDE.md](USER_GUIDE.md)
- Later updates: [OPERATIONS.md](OPERATIONS.md)
- What is proven on a device: [STATUS.md](STATUS.md)
