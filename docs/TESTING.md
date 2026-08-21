# Testing

Evidence levels are defined in [docs/README.md](README.md). A green Reliability
badge is sampled machine health, not a release.

## Layers

| Layer | Command | Proves | Must not claim |
|-------|---------|--------|----------------|
| Mac PR / local-fast | `bash scripts/mac-gate-pr.sh` | Source + local-pass | Pi or couch |
| Mac full | `cd src/catalog-service && npm test` plus path-triggered suites | Deep local-pass | Pi behavior |
| Pi fast | `bash scripts/pi-pre-couch-gate.sh` at the read-back SHA | Pi-gated | Picture / audio feel |
| Pi full | `MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh` | Deep Pi-gated | Human quality |
| Couch | checklist below | Couch-observed | Automated certification |

Live IPTV gates stay opt-in (`MANGO_LIVE_GATE=1`). YouTube playback signoff
uses `MANGO_YOUTUBE_PLAY=1`.

## Gate inventory

| Gate | Layer |
|------|-------|
| `scripts/lib/gate-catalog-unit.sh` | PR |
| launcher `npm test` / `npm run build` | PR |
| companion `npm run build` | PR |
| `scripts/m2-catalog/service/test_mango_hud_contract.py` | PR |
| `scripts/m6-ship/gate-m6-stream-picker-source.sh` | PR |
| `scripts/m6-ship/test-pi-deploy-hardening.sh` | PR |
| `scripts/m3-play/playability/gate-m3-library-grow.sh` | Mac full / playability paths |
| `scripts/gate-lite.sh` | Pi fast |
| `scripts/m6-ship/gate-m6-ux-smoke.sh` | Pi fast |
| `scripts/m6-ship/gate-m6-playback-ssot.sh` | Pi fast |
| `scripts/m6-ship/gate-m6-youtube-smoke.sh` | Pi fast |
| `scripts/m6-ship/gate-m6-reliability-proof.sh` | Pi fast |
| `scripts/m6-ship/gate-m6-search-smoke.sh` | Pi nightly |
| `scripts/m6-ship/gate-m6-controller-reconnect.sh` | Pi nightly; five wakes are couch |
| `scripts/live/gate-live-iptv.sh` | Opt-in |

`scripts/gate-mango.sh` is the dispatcher. `gate-lite.sh` and
`pi-pre-couch-gate.sh` remain compatibility entrypoints.

## Couch acceptance

Record source SHA, Pi SHA, recommendation modes, TV/audio route, and tester
before starting. Verdicts: PASS, FAIL, DEFERRED, N/A.

Preconditions: Git-only deploy, idle couch, preserved dirty state, no DB
wipes, no pairing-mode “fix”, no secret screenshots.

Minimum human matrix:

- Home focus, tab change, Search typing, Detail open/back
- Movie and series play from first frame with audible audio
- HUD show/hide, pause, volume, Streams change, Undo
- YouTube 1080p start, lip-sync, Back to the same card
- Controller ordinary power-on without pairing
- Continue/Saved placement after a real watch

Do not inherit PASS from older screenshots or task reports. Update
[STATUS.md](STATUS.md) only after a named SHA observation.

## Reliability Center

Settings health and the 30-day local proof ledger summarize sampled runtime.
Safe repair may clear stale locks or restart processes. It must never delete
library, progress, YouTube auth, or addon userData.
