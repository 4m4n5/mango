# Status

**This file is the only owner of current Pi SHA, generation, and
“Pi serves” claims.** Other docs may say “see STATUS.md”.

**Branch:** `main` · **Roadmap:** [ROADMAP.md](ROADMAP.md) ·
**Acceptance:** [TESTING.md](TESTING.md)

## How to read this page

| Evidence | What it proves |
|----------|----------------|
| Source-complete | Code exists at the audited revision |
| Local-pass | Named tests or builds passed on that machine |
| Pi-deployed | A Pi was observed at an exact Git SHA and mode |
| Pi-gated | Named runtime checks passed on that deployment |
| Couch-observed | A human watched the physical TV, controller, or audio |
| Deferred | The named evidence does not exist yet |

Green in Reliability Center is sampled machine health at that moment. It
is not a release certificate. GitHub CI is local-pass only.

## Public alpha — this source release

**Evidence level:** source-complete. Local-pass must be re-run on the
revision you check out. **Not Pi-deployed, not Pi-gated, and not
couch-observed at the public tag.**

This `main` line integrates the native launcher, mpv playback contract,
library, deterministic VOD recommendations, YouTube household rails, and
Git-only deploy wrappers. Publishing `v0.1.0-alpha.1` does **not** mean
a household TV was signed off on that tag. Do not copy a previous Pi SHA
into README, the website, or release headlines as if it were this
release.

Re-establish device proof after checkout:

```bash
git rev-parse HEAD
bash scripts/mac-gate-pr.sh
# on the Pi, after git-only deploy
bash scripts/pi-pre-couch-gate.sh
```

## Latest recorded development-Pi proof

The most recent household-Pi evidence was recorded **2026-08-21** at
`d09f4dc493e58d7575809f6e0d014340d1430384` on the then-current
development branch. That revision is **not** this public-alpha tag.

| Area | Source | That Pi record | Still open |
|------|--------|----------------|------------|
| Launcher, Detail, Search, D-pad | Complete | Pre-couch passed on that SHA | Whole-product couch pass |
| Native mpv + HUD + Streams | Complete | Targeted playback and HUD proofs on earlier SHAs | Picture, audio, lip-sync, 4K |
| Library, Fire/Water, Saved | Complete | Schema / placement readback passed | Human placement check |
| VOD recommendations | Deterministic 0/1/2 lanes, isolated worker, truthful Top Picks | Movies/Series desired revisions acknowledged; cached serve p95 in single-digit ms | Three unattended nights; couch relevance |
| YouTube | Household v3.0 rails + 1080p playback path | Nightly refresh and smoke passed | Human Regulars, latency, picture |
| Playability grow | Staged publish, last-good retention | Verified titles 9,959 → 10,170; schema 19 | Thin-rail yield; three clean nights |
| Reliability Center | Implemented | Usable-yellow for historical trend warnings | Intentional Live-off policy |
| Controller reconnect | Source-complete | Automated gate only | Five ordinary power-on cycles |
| Display sleep | **Not implemented** | Accidental Xorg 600 s DPMS observed | Locked Settings / CEC contract |
| Native HDR | Unsupported | Older Kodi/GBM research only | Explicit no-HDR ship or new engine |
| First boot | Not implemented | Operator-installed system | No-SSH wizard |
| Public tag on a Pi | — | — | Deploy `main` and record a new SHA here |

## VOD rank contract (source)

- Deterministic sparse IDF-weighted 0/1/2 taste lanes. Legacy LOAO is
  off unless `MANGO_VOD_LEGACY_LOAO_RANK=1`.
- Two lanes activate only when each has at least two anchors.
- Catalog enqueues desired revisions; `mango-vod-recs-worker` ranks
  off-process. Failed ranks retain last-good rails.
- Home shows **For You** only from an activatable generation; otherwise
  it shows labelled **Top Picks**.

## Deploy contract (source)

`pi-deploy.sh` and `pi-exec-gate.sh` require `main`, a successful fetch,
matching expected SHA, and a clean tree unless
`MANGO_DEPLOY_ALLOW_DIRTY=1`. AIOMetadata rail sync is off unless
`MANGO_SYNC_AIOMETADATA=1`. Git deploy does not overwrite AIOStreams
`userData` or runtime databases.

## Deferred for appliance release

- No-SSH first-boot and intentional display sleep
- Native HDR or an explicit permanent no-HDR boundary
- Whole-product couch sign-off: focus, Back, picture, audio, controller
  feel, recommendation relevance
- Removal or explicit feature-gate of the legacy direct MediaFusion
  thin-pool supplement
- Three clean unattended nights on a `main` SHA

Historical task reports and older SHAs prove only their recorded
revision. They are not current product spec.
