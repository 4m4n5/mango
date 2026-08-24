# Documentation

**Product:** [PRODUCT.md](PRODUCT.md) · **Claims:** [PUBLIC_CLAIMS.md](PUBLIC_CLAIMS.md) ·
**Current truth:** [STATUS.md](STATUS.md)

Mango is one living-room surface you own, built for Raspberry Pi 5. The
launcher, catalog, library, companion, controller routing, Reliability
Center, and playback path are Mango-owned. Stremio-compatible addons
supply metadata and streams.

## Evidence levels

These labels are not interchangeable:

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

## By audience

### Evaluate

| Doc | Use |
|-----|-----|
| [PRODUCT.md](PRODUCT.md) | Promise, capabilities, non-goals |
| [PUBLIC_CLAIMS.md](PUBLIC_CLAIMS.md) | Approved and forbidden public wording |
| [LAUNCH_CAROUSEL.md](LAUNCH_CAROUSEL.md) | Social card copy and alt text |
| [STATUS.md](STATUS.md) | Implemented versus proven |
| [ROADMAP.md](ROADMAP.md) | Remaining work |

### Install

| Doc | Use |
|-----|-----|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Fastest path from clone to a running box |
| [INSTALL.md](INSTALL.md) | Manual alpha setup, expected results, rollback |
| [HARDWARE.md](HARDWARE.md) | Pi, display, audio, and pad map |
| [CONFIGURATION.md](CONFIGURATION.md) | Env, secrets, example files |

### Use

| Doc | Use |
|-----|-----|
| [USER_GUIDE.md](USER_GUIDE.md) | Couch loop, buttons, library, librarian |
| [features/content-and-playback.md](features/content-and-playback.md) | Streams, playability, grow |
| [features/youtube.md](features/youtube.md) | Native YouTube |
| [features/search-and-librarian.md](features/search-and-librarian.md) | Search and phone librarian |
| [features/live-tv.md](features/live-tv.md) | Optional Live |

### Operate

| Doc | Use |
|-----|-----|
| [OPERATIONS.md](OPERATIONS.md) | Git-only deploy and daily loop |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | First checks for common failures |
| [TESTING.md](TESTING.md) | Local, Pi, and couch gates |

### Contribute and maintain

| Doc | Use |
|-----|-----|
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How to change Mango |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Processes, ports, ownership |
| [DECISIONS.md](DECISIONS.md) | Locked choices |
| [../AGENTS.md](../AGENTS.md) | Agent invariants |

Reference configuration lives in [reference/](reference/).
