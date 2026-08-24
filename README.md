# mango

[![CI](https://github.com/4m4n5/mango/actions/workflows/ci.yml/badge.svg)](https://github.com/4m4n5/mango/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/4m4n5/mango?include_prereleases)](https://github.com/4m4n5/mango/releases)

A household-owned TV experience for Raspberry Pi 5.

Browse movies, shows, YouTube, and optional live television on the TV, inspect
a title, press **B**, and watch in native mpv. Mango owns the launcher, library,
playback chrome, recommendations, controller routing, and operational proof.
You supply the hardware, accounts, addon manifests, and media entitlements.

<p align="center">
  <img
    src="https://aaam.dev/mango/images/tv-home-960.webp"
    alt="Mango Movies Home on a television: poster rails, local library chips, and a focused title"
    width="960"
  />
</p>

This is a **self-hosted public alpha**, not a retail appliance. Native HDR,
no-SSH first boot, intentional display sleep, and whole-product couch sign-off
are still open. Runtime evidence lives only in
[docs/STATUS.md](docs/STATUS.md).

## What it does

- One 10-foot Chromium launcher: Search, Movies, TV Shows, optional Live, YouTube
- Fullscreen mpv with a cinematic HUD and a five-choice Streams drawer
- Local Continue, Saved, history, Fire/Water ratings, and household rails
- Optional phone librarian (text / push-to-talk) that opens Detail; **B** still plays
- Git-only Pi deploy; runtime databases and secrets stay on the device

## Alpha boundary

Mango does **not** ship movies, IPTV, debrid, or studio accounts. It does not
reproduce YouTube Home, speak, autoplay from voice, or output native HDR.
Reliability Center green and GitHub CI are not a living-room picture or
controller-feel certificate.

Public claims and forbidden wording:
[docs/PUBLIC_CLAIMS.md](docs/PUBLIC_CLAIMS.md).

## Requirements

- Raspberry Pi 5 (8 GB recommended) · Raspberry Pi OS Desktop · X11 · Openbox
- Node.js 20+ · Python 3.11+ · Chromium · mpv · BlueZ
- An 8BitDo Micro or equivalent D-pad controller
- Operator-supplied addon, YouTube, LLM, and optional Live credentials

## Five-minute local smoke

Works on macOS or Linux. This proves source and tests, not TV playback.

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build && npm test
cd ../companion && npm ci && npm run build
```

Pi installation: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) ·
[docs/INSTALL.md](docs/INSTALL.md).

## Documentation

| If you want to | Read |
|----------------|------|
| Understand the product | [docs/PRODUCT.md](docs/PRODUCT.md) |
| Install on a Pi | [docs/INSTALL.md](docs/INSTALL.md) |
| Watch from the couch | [docs/USER_GUIDE.md](docs/USER_GUIDE.md) |
| Configure secrets and addons | [docs/CONFIGURATION.md](docs/CONFIGURATION.md) |
| Operate and deploy | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| See what is proven | [docs/STATUS.md](docs/STATUS.md) |
| Report a problem | [SUPPORT.md](SUPPORT.md) · [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| Change the source | [CONTRIBUTING.md](CONTRIBUTING.md) |

Full map: [docs/README.md](docs/README.md).

## Legal

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [SECURITY.md](SECURITY.md).

Mango is not affiliated with YouTube, Stremio, debrid services, IPTV
providers, or any studio or broadcaster. This repository does not grant
rights to third-party media.
