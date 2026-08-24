# mango

[![CI](https://github.com/4m4n5/mango/actions/workflows/ci.yml/badge.svg)](https://github.com/4m4n5/mango/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/4m4n5/mango?include_prereleases)](https://github.com/4m4n5/mango/releases)

**reclaim your TV.**

Stream movies, shows, YouTube, and live television on a Raspberry Pi 5
you own — not five apps. Across sources, in one place. Mango adds no
ads of its own. Progress, Saved, and taste stay on the device.

You bring the Pi, the accounts, and the rights to what you watch.
Mango brings the product: search, streams, recommendations, and a
phone librarian if you want one.

<p align="center">
  <img
    src="https://aaam.dev/mango/images/tv-home-960.webp"
    alt="Mango Movies Home on a television: poster rails, local library chips, and a focused title"
    width="960"
  />
</p>

This is a **self-hosted public alpha**, not a retail appliance. Native HDR,
a no-SSH first boot, display sleep, and whole-product couch sign-off are
still open. Runtime evidence lives only in
[docs/STATUS.md](docs/STATUS.md).

## Why mango

**It is all here.** Across sources, in one place. Movies, shows, YouTube,
and live television share one launcher. Mango adds no ads of its own.

**Find anything.** One query. Every mango surface you configured.

**Watch it at its best.** Mango picks for your hardware, or you choose.
Quality, audio, and language at a glance.

**Rate with fire and water.** Mango learns your taste, one title at a time.
Continue, Saved, and history stay on the Pi.

**Your content librarian.** Talk from your phone. Describe. Discuss.
Discover. Your final pick opens on the TV.

**YouTube, built in.** Your regulars, subscriptions, and history —
organized on the device you own.

**Yours to run.** Apache-2.0. Git-only updates. Secrets and library state
never leave the household unless you send them.

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

How to watch from the couch: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

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
