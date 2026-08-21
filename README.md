# mango

A couch-first TV experience for Raspberry Pi 5. Browse or search on the TV,
inspect a title, press **B**, and watch in native mpv. Mango owns the launcher,
library, playback chrome, recommendations, controller routing, and operational
proof. Stremio-compatible addons supply metadata and streams.

This is an **alpha self-hosted project**, not a finished appliance. HDR,
no-SSH first-boot, and whole-product couch sign-off remain open. Current
deployed evidence lives only in [docs/STATUS.md](docs/STATUS.md).

## What it does

- 10-foot Chromium launcher: Search, Movies, TV Shows, optional Live, YouTube
- Fullscreen mpv with a cinematic HUD and five-choice Streams drawer
- Local Continue, Saved, history, Fire/Water ratings, and household rails
- Optional phone librarian (text / push-to-talk) that opens Detail on the TV
- Git-only Pi deploy; runtime databases and secrets stay on the device

## Requirements

- Raspberry Pi 5 (8 GB recommended) with Raspberry Pi OS Desktop, X11, Openbox
- Node.js 20+, Python 3.11+, mpv, Chromium
- An 8BitDo Micro or equivalent D-pad controller
- Operator-supplied addon, YouTube, LLM, and optional Live credentials

## Quick start

```bash
git clone https://github.com/4m4n5/mango.git
cd mango
# Mac or Linux development
cd src/catalog-service && npm ci && npm test
cd ../launcher && npm ci && npm run build
cd ../companion && npm ci && npm run build
```

Pi installation, configuration, and Git-only deploy:

- [docs/INSTALL.md](docs/INSTALL.md)
- [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- [docs/OPERATIONS.md](docs/OPERATIONS.md)

## Documentation

| Doc | Audience |
|-----|----------|
| [docs/README.md](docs/README.md) | Map and evidence levels |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Promise, limits, non-goals |
| [docs/STATUS.md](docs/STATUS.md) | Current source / Pi / couch truth |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Processes, ports, ownership |
| [docs/TESTING.md](docs/TESTING.md) | Local, Pi, and human proof |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to change Mango |

## Legal

Apache-2.0. See [LICENSE](LICENSE), [NOTICE](NOTICE), and
[SECURITY.md](SECURITY.md).

Mango is not affiliated with YouTube, Stremio, debrid services, IPTV
providers, or any studio or broadcaster. You bring your own accounts,
manifests, and media entitlements. This repository does not grant rights to
third-party media.
