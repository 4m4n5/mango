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
| `scripts/lib/test_pi_npm_deps.py` | Local (native dependency cache invalidation on Node ABI/platform changes) |
| `scripts/lib/test-health-repair-live-contract.sh` / `src/mango-ui-server/test_catalog_health.py` | Local (disabled Live is optional; configured/malformed Live fails closed) |
| `scripts/m3-play/playability/gate-m3-library-grow.sh` | Mac full / playability paths |
| `scripts/m6-ship/test-youtube-pot-server-fd.sh` | Mac full (POT fd 200 closure) |
| `scripts/m6-ship/test-library-offline-compaction.sh` | Mac full (offline compaction hook) |
| `scripts/m6-ship/test_restore_expiry_only_visibility.py` | Local (backup-proven expiry restoration, failure/identity exclusion, unchanged verification evidence) |
| `scripts/m6-ship/test_prune_mango_sqlite.py` | Local (accurate internal cleanup counts; in-flight job retention) |
| `scripts/m3-play/playability/test-wait-vod-recommendation-jobs.sh` | Mac full (waiter not on grow critical path) |
| `scripts/m3-play/playability/test-coordinator-entrypoints.sh` | Mac full (default deadlines, interrupted receipts, lock contention) |
| `scripts/m3-play/playability/test-maintenance-catalog-filters.sh` | Mac full (literal-only operator profile lookup; no shell evaluation) |
| `scripts/m4-addons/test-aiometadata-opt-in-and-temp.sh` | Mac full (opt-in config sync, private temporary-file cleanup) |
| `scripts/diag/test_recommendation_refresh_receipt.py` | Mac full (exact-run recommendation evidence, missing evidence is partial) |
| `scripts/lib/test_display_wake.py` | Local regression; Pi playback SSOT gate (wake ordering and no-auto-blank policy) |
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

After a long offline period, also check current (unexpired) playability proof,
expiry-only last-known-good visibility separately, failure hide/requeue behavior,
completion of the desired VOD revisions, YouTube OAuth renewal and source
freshness, timezone/NTP and the next nightly timer, and preserved interrupted-run
receipts. A queued recommendation job is accepted work, not completed ranking.
Run concurrent catalog requests while reading Reliability Center and YouTube state to catch
diagnostic probes that block playback or browsing. Re-test ambiguous series
editions with exact season/episode IDs; dubbed audio is not proof of edition.
YouTube cold runtime probes are explicitly pending until their freshness fields
are true; a fresh negative probe is a failure, not permission to retry forever.
Allocated recommendation counts are not the same as active or available counts.
After a Node runtime change, reinstall native dependencies and verify SQLite and
the real MiniLM embedding path on the Pi before claiming runtime compatibility.

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

### Verified snapshot — 2026-08-21 (Trustworthy Recommendation Refactor)

Local and Pi evidence for the deterministic-lane + isolated-worker refactor.
Human couch quality remains separate.

| Check | Result |
|-------|--------|
| `cd src/catalog-service && npm test` | 1165/1165 |
| `cd src/launcher && npm test` | 141/141 |
| launcher / catalog-service `npm run build` | pass |
| `gate-m3-library-grow.sh` | pass |
| `test_ops_grow_sla.py` | 12/12 |
| `test_playability_refresh_decision.py` | 5/5 |
| Full staged Pi nightly at `6d5d479` | pass; 9,959 → 10,170 verified |
| Final exact-SHA Pi pre-couch at `d09f4dc` | pass |
| Final targeted YouTube smoke | pass |

Still unproven: three unattended nights and human couch
relevance/focus/playability, picture, audio, lip-sync, and controller feel.

## Reliability Center

Settings health and the 30-day local proof ledger summarize sampled runtime.
Safe repair may clear stale locks or restart processes. It must never delete
library, progress, YouTube auth, or addon userData.
