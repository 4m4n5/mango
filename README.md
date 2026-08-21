# mango

**A private, couch-first TV experience for Raspberry Pi 5.** Browse or ask on
the phone, inspect a title, press **B**, and watch in native mpv. Mango owns the
launcher, library/progress, playback chrome, recommendations, controller, and
operational proof; Stremio-compatible addons supply metadata and streams.

**Development:** `feat/native-experience` · **Start here:**
[`docs/README.md`](docs/README.md) · **Current truth:**
[`docs/STATUS.md`](docs/STATUS.md)

## Current product

| Surface | Implementation |
|---------|----------------|
| TV | Search · Movies · TV Shows · optional Live · native YouTube in a D-pad Chromium launcher |
| Playback | mpv with deferred foreground, exact episode identity, cinematic HUD, five-choice Streams drawer, progress and exact return |
| Content | Cinemeta/AIOMetadata plus configured Bharat Binge catalog/metadata inputs, AIOStreams as the intended sole stream-capable VOD aggregate, and optional NexoTV Live; live contribution must be health-proven |
| Library | Mango-owned Continue, Saved, history, finished, Fire/Water ratings, feedback and normalized YouTube history |
| Recommendations | Household Story Graph v2 and provenance-gated YouTube v2 behind independent rollout flags |
| Phone/voice | Text/PTT librarian searches, clarifies, curates and opens Detail; controller **B** still plays |
| Reliability | Settings/API health, 30-day local proof ledger, safe repair, nightly maintenance and controller supervision |

The core viewing loop is real, but Mango is not yet a finished plug-and-play
appliance. Source `345535d` has one executable recommender per domain:
progressive Household VOD and authoritative subscription/history YouTube v2.
`off` disables that domain's recommendation rail, `shadow` builds the latest
architecture without exposing it, and `serve` exposes only its accepted
published generation—there is no executable legacy ranking fallback. The
latest recorded Pi snapshot predates this cleanup, so deployment, shadow
generation health, independent VOD/YouTube promotion, and couch relevance are
still unproven. Deployment is additionally blocked by a YouTube non-Household
`off` ownership/409 defect, VOD shadow/serve ownership and Shuffle-feedback
inconsistencies, incomplete active-pointer diagnostics, and missing focused
replacement tests. Intentional display sleep/CEC is locked but unimplemented. 4K
SDR HEVC has an integrated path; native HDR through the current X11/mpv
architecture is unsupported. Final controller/couch/target-TV proof and the
no-SSH first-boot wizard remain open.
Latest recorded Bharat Binge health was HTTP 403, so configuration is not proof
of regional contribution.
The current deploy wrapper is not safe for unattended agent use: it does not
enforce or pin `feat/native-experience` and can implicitly mutate AIOMetadata
private state while leaving/printing sensitive output. See
[docs/DEPLOY.md](docs/DEPLOY.md) before any Pi update.
The exported manifest graph contains catalog/metadata and optional Live addons;
AIOStreams is intended to be its sole stream-capable VOD path. Catalog-service
still contains an optional legacy direct MediaFusion thin-pool supplement
triggered by Pi-local state; its live state must be measured, then the bypass
removed or explicitly retained and gated.

Kodi/Stremio artifacts remain in legacy research/configuration, but current
source has no supported automatic viewer fallback. The daily product path is
launcher ↔ mpv.

## Quick Pi operation

To inspect or restart the **already built** Pi checkout, first confirm the couch
is idle and inventory/preserve dirty state; restart can stop active
playback/indexers.

```bash
cd ~/mango
git rev-parse HEAD
git status --short
bash scripts/mango-stack.sh restart
bash scripts/pi-pre-couch-gate.sh
```

Do not add `git pull` to that shortcut: a source update also requires the
catalog-service and launcher build steps in [docs/DEPLOY.md](docs/DEPLOY.md).

From the home Mac after an authorized commit/push, first prove source identity:

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
```

`pi-deploy.sh` and `pi-exec-gate.sh` remain blocked for unattended agents; use
only the reviewed exception/manual flow in the
deploy runbook until their branch pinning and AIOMetadata sync are hardened.

SSH alias `mango` is primary; `mango-mdns`/`mango.local` is the discovery
fallback. A previously observed numeric LAN address is not durable truth.

Never rsync/scp/hand-copy repository files. Never delete runtime DBs, cache,
history, or credentials as routine recovery. AIOStreams `userData`, secrets,
seeds, and runtime DB state use separate explicit workflows.

## Documentation

| Doc | Owns |
|-----|------|
| [docs/VISION.md](docs/VISION.md) | Product promise and boundaries |
| [docs/STATUS.md](docs/STATUS.md) | Source/deployed/Pi/couch evidence and open challenges |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Remaining dependency order |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Runtime/state/interface ownership |
| [docs/PLAYABILITY.md](docs/PLAYABILITY.md) | Resolver, verified rails and grow |
| [docs/FIRE_WATER_RATINGS.md](docs/FIRE_WATER_RATINGS.md) | VOD ratings/recommendation v2 |
| [docs/YOUTUBE.md](docs/YOUTUBE.md) | Native YouTube and YouTube v2 |
| [docs/SEARCH.md](docs/SEARCH.md) | Unified launcher Search |
| [docs/VOICE.md](docs/VOICE.md) | Phone/voice librarian |
| [docs/RELIABILITY.md](docs/RELIABILITY.md) | Runtime health/proof/safe repair |
| [docs/OPS.md](docs/OPS.md) / [docs/DEPLOY.md](docs/DEPLOY.md) | Pi operation and Git-only deployment |
| [docs/COUCH_TEST.md](docs/COUCH_TEST.md) | Current whole-product acceptance |

Task specs/reports are exact historical records and are indexed in
[`docs/tasks/README.md`](docs/tasks/README.md). Agent instructions:
[`AGENTS.md`](AGENTS.md).

## Repository layout

```text
src/launcher/           10-foot TV UI
src/catalog-service/    catalog/library/search/recommendations/resolver/play/YouTube/reliability
src/mango-ui-server/    launcher server, pad queue and catalog proxy
src/orchestrator/       voice/tool hub
src/companion/          phone PWA
scripts/                Pi stack, deploy, gates, maintenance and diagnostics
config/                 repository-owned examples/policy; live secrets/state stay on Pi
docs/                   canonical product/operations documentation
```

`main` is the older stable branch; `feat/native-experience` is the active native
product branch. Do not merge until the current release gates and couch contract
close.
