# mango documentation

**Product:** [PRODUCT.md](PRODUCT.md) · **Current truth:** [STATUS.md](STATUS.md) ·
**Plan:** [ROADMAP.md](ROADMAP.md) · **Runtime:** [ARCHITECTURE.md](ARCHITECTURE.md)

Mango is a native, couch-first TV experience for Raspberry Pi 5. The launcher,
catalog and library services, companion, controller router, Reliability Center,
and mpv playback path are Mango-owned. Stremio-compatible addons supply
metadata and streams.

## Evidence levels

Mango is developed on a workstation and runs on a home Pi. These labels are
not interchangeable:

| Label | Meaning |
|-------|---------|
| **Source-complete** | Code or configuration exists at the audited revision |
| **Local-pass** | Named tests or builds passed on that revision and machine |
| **Pi-deployed** | The Pi was observed at an exact Git SHA and feature mode |
| **Pi-gated** | Named automated runtime checks passed on that exact deployment |
| **Couch-observed** | A person observed the physical TV, controller, or audio |
| **Deferred** | The named evidence does not yet exist |

[STATUS.md](STATUS.md) is the only document that states the current deployed
SHA, generation counts, or “Pi serves” claims.

## Read this if you want to

| Goal | Doc |
|------|-----|
| Understand the product and limits | [PRODUCT.md](PRODUCT.md) |
| See what is implemented vs proven | [STATUS.md](STATUS.md) |
| See remaining work | [ROADMAP.md](ROADMAP.md) |
| Install from a clean clone | [INSTALL.md](INSTALL.md) |
| Configure env, addons, and secrets | [CONFIGURATION.md](CONFIGURATION.md) |
| Understand processes and ownership | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Deploy or operate the Pi | [OPERATIONS.md](OPERATIONS.md) |
| Run tests or couch acceptance | [TESTING.md](TESTING.md) |
| Use playback, ratings, grow | [features/content-and-playback.md](features/content-and-playback.md) |
| Use native YouTube | [features/youtube.md](features/youtube.md) |
| Use Search or the phone librarian | [features/search-and-librarian.md](features/search-and-librarian.md) |
| Operate optional Live TV | [features/live-tv.md](features/live-tv.md) |
| Check pad and display contracts | [HARDWARE.md](HARDWARE.md) · [DECISIONS.md](DECISIONS.md) |

Reference configuration lives in [reference/](reference/). Agent invariants
live in [`../AGENTS.md`](../AGENTS.md).
