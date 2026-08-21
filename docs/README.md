# mango documentation

**Product:** [VISION.md](VISION.md) · **Current truth:** [STATUS.md](STATUS.md) · **Plan:** [ROADMAP.md](ROADMAP.md) · **Runtime:** [ARCHITECTURE.md](ARCHITECTURE.md)

Mango is a native, couch-first TV experience for Raspberry Pi 5. The launcher,
catalog and library services, companion, controller router, Reliability Center,
and mpv playback path are all Mango-owned. Stremio-compatible addons supply
metadata and streams. Kodi/Stremio artifacts remain as legacy research and
rollback material, but current source has no supported automatic viewer
fallback; launcher ↔ mpv is the daily product path.

## Read this first: evidence levels

Mango changes on a development Mac but runs on a home Pi. Documentation uses
these terms deliberately:

| Label | Meaning |
|-------|---------|
| **Source-complete** | Code/configuration exists at the audited source revision |
| **Local-pass** | Named tests/builds passed on that revision and machine |
| **Pi-deployed** | The Pi was observed at an exact Git SHA with the named feature mode/configuration |
| **Pi-gated** | Named automated runtime checks passed on that exact deployment |
| **Couch-observed** | A person observed the physical TV/controller/audio behavior |
| **Deferred** | The named evidence does not yet exist or belongs to an older contract/revision |
| **Historical** | Valid only for the report's SHA and contract; not evidence for later code or redesigned UX |

Source code, a successful Mac test, an old screenshot, and a current couch
verdict are not interchangeable. The latest repository-recorded home snapshot
must be re-read from [STATUS.md](STATUS.md) before deployment; it is not a live
probe performed by this documentation audit.

## Current product snapshot

| Area | Current state |
|------|---------------|
| TV shell | Search · Movies · TV Shows · Live · YouTube in a 1080p60 Chromium/Openbox launcher; D-pad-only navigation |
| Playback | mpv with deferred foreground commit, cinematic HUD, five-choice Streams drawer, exact-episode identity, bounded clean-empty recovery, and scoped progress/return ownership |
| Resolver topology | The full addon graph also contains catalog/metadata and optional Live addons; AIOStreams is the intended sole stream-capable VOD aggregate. An optional legacy direct MediaFusion thin-pool supplement remains in catalog-service and is a current hardening gap; its Pi-local trigger state is not proven by Git config |
| Library | Mango-owned Continue, Saved, history, finished state, Fire/Water ratings, feedback, attribution, and normalized YouTube history. Pi migration 18 repaired 12 misclassified tabs to zero while preserving user-state keys/counts; runtime purity was Movies 6 / Series 8 / wrong-tab 0. The physical Dune-from-TV-Search couch check remains deferred |
| Voice/phone | Text/PTT librarian that searches and opens Detail; **B** still starts playback; no TTS in the current couch contract |
| Operations | Reliability Center, nightly proof ledger, safe repair, controller link/router split, and a Git-only deploy contract; `pi-deploy.sh` / `pi-exec-gate.sh` fail closed on branch, SHA, and fetch, and AIOMetadata rail sync is opt-in |
| VOD recommendations | `fb20baa` is Pi-served: precise Household Story Frontier `For You`, full-corpus positive-weight Explore, trusted weighted category/AI rails, atomic all-rail tab deals, and StoryDNA-first Detail Related. Complete 5,930/3,974 accounting and 720/675 rank reserves pass. Forty X presses per tab exposed 2,121/1,897 unique cards at p95 121.9/119.5 ms with no provider/rank work. Human thematic judgment remains open |
| YouTube recommendations | Pi `04171bb` serves v2.7 generation 22 with 1,441 candidates: For You 512, Subscriptions 405, Beyond 274, More Like 250, and Live 0, from 55 authoritative subscriptions. Fifty independent cache-only X draws held generation/quota and History fixed at p50 58.83 ms / p95 174.66 ms; cross-shuffle repeats remain valid, Saved was absent in this snapshot, and the 25-call interactive Search reserve stayed protected. Human relevance and physical-TV behavior remain deferred |
| Display sleep | The intentional Settings-driven policy is locked but not implemented/proven. A recorded Pi inspection still found accidental Xorg 600-second DPMS values |
| Stateful addon helpers | AIO diff/apply and AIOMetadata import/sync currently leave or expose secret-bearing state when invoked directly; deploy no longer runs AIOMetadata sync unless `MANGO_SYNC_AIOMETADATA=1` |
| 4K/HDR | 1080p is the safe fallback; compatible 4K SDR HEVC is integrated and older-proven but needs the current exact-TV matrix; native HDR is unsupported on the current X11/mpv path |
| First boot | M6.4 installer/wizard remains planned; the box is not yet no-SSH household setup |

## Documentation map

| I want to… | Read |
|-------------|------|
| Understand the product and its limits | [VISION.md](VISION.md) |
| See implemented, deployed, proven, and open work | [STATUS.md](STATUS.md) |
| See milestone order and exit criteria | [ROADMAP.md](ROADMAP.md) |
| Understand processes, ports, state, APIs, and ownership | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Operate or deploy the Pi | [OPS.md](OPS.md) · [DEPLOY.md](DEPLOY.md) · [DEPLOY-SPLIT-MACHINE.md](DEPLOY-SPLIT-MACHINE.md) |
| Install an independent Pi with a transferred verified library | [NEW_PI_SETUP.md](NEW_PI_SETUP.md) |
| Verify readiness or perform couch acceptance | [RELIABILITY.md](RELIABILITY.md) · [COUCH_TEST.md](COUCH_TEST.md) |
| Understand playback, streams, verified rails, and grow | [PLAYABILITY.md](PLAYABILITY.md) |
| Understand Fire/Water and VOD recommendations | [FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md) |
| Understand native YouTube and its recommender | [YOUTUBE.md](YOUTUBE.md) |
| Use unified launcher Search | [SEARCH.md](SEARCH.md) |
| Use the phone/voice librarian | [VOICE.md](VOICE.md) · [AI_LAYER.md](AI_LAYER.md) |
| Operate optional Live TV | [LIVE_TV.md](LIVE_TV.md) |
| Check controller/display hardware contracts | [HARDWARE.md](HARDWARE.md) · [DECISIONS.md](DECISIONS.md) |
| Write public copy, screenshots, or launch posts | [MARKETING.md](MARKETING.md) · [INSTAGRAM_LAUNCH_CAROUSEL.md](INSTAGRAM_LAUNCH_CAROUSEL.md) · [`../assets/brand/BRAND.md`](../assets/brand/BRAND.md) |

Task specs and reports under [`tasks/`](tasks/) are implementation and
acceptance records. They can contain superseded card counts, SHAs, modes, or
test results. Use them for exact historical evidence, not as the current
product specification. Their lifecycle index is
[`tasks/README.md`](tasks/README.md). Superseded planning material lives in
[`archive/`](archive/).

## Milestones

| Milestone | State |
|-----------|-------|
| M1 Foundation | Shipped |
| M2 Browse | Shipped |
| M3 Play | Shipped; resolver/grow/target-TV reliability still hardening |
| M4 Addons | Shipped |
| M5 Voice + AI | Implemented; comprehensive phone/voice couch sign-off remains |
| M6 Ship | In progress: recommendation couch acceptance, display sleep, target-TV fidelity, final whole-product acceptance, and first-boot wizard |

## Standard pre-couch gates

From the home Mac:

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
bash scripts/pi-exec.sh 'cd ~/mango && git branch --show-current && git rev-parse HEAD'
# Explicitly compare the Pi full SHA to origin before any gate.
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/pi-pre-couch-gate.sh'
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
```

`pi-exec-gate.sh` is omitted because its current implementation checks out and
pulls a Mac-derived, unpinned branch. Run it only after that blocker is fixed.

Run subsystem gates after touching their contracts:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-youtube-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-search-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/ai/gate-m5-companion-couch.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/ai/gate-m5-companion-memory.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-ux-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh'
```

Live IPTV is intentionally opt-in. See [LIVE_TV.md](LIVE_TV.md).

## Documentation ownership

| Source of truth | Owns |
|-----------------|------|
| [VISION.md](VISION.md) | Product promise, experience model, and non-goals |
| [STATUS.md](STATUS.md) | Current source/runtime/proof matrix and open challenges |
| [ROADMAP.md](ROADMAP.md) | Remaining sequence and exit criteria |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime topology, state, interfaces, and ownership |
| [DECISIONS.md](DECISIONS.md) | Locked implementation and UX choices |
| [MARKETING.md](MARKETING.md) | Public copy, capture plan, contact landing, launch posts |
| [INSTAGRAM_LAUNCH_CAROUSEL.md](INSTAGRAM_LAUNCH_CAROUSEL.md) | Eight-card launch copy, caption, visual system, alt text, and capture requirements |
| [`../assets/brand/BRAND.md`](../assets/brand/BRAND.md) | Voice, anti-positioning, tagline and palette lock |
| Subsystem docs | Detailed behavior, operation, and subsystem-specific proof |
| Task reports | Exact historical evidence for a named revision/acceptance run |

Reference configuration: [reference/addon-stack.md](reference/addon-stack.md) ·
[reference/aiostreams-profile.md](reference/aiostreams-profile.md) ·
[reference/elfhosted.md](reference/elfhosted.md). Script layout:
[../scripts/MILESTONES.md](../scripts/MILESTONES.md). Agent entry point:
[../AGENTS.md](../AGENTS.md).
