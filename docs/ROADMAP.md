# mango — implementation roadmap

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md) · **Current truth:** [STATUS.md](STATUS.md)

This file describes remaining outcomes and their dependency order. Completed
implementation detail belongs in [STATUS.md](STATUS.md) and subsystem docs;
exact historical proof belongs in task reports.

## At a glance

| Milestone | Outcome | State |
|-----------|---------|-------|
| M1 Foundation | Pi service stack, kiosk shell, pad routing, base gates | Shipped |
| M2 Browse | Real Movies/TV/Live rails and D-pad launcher | Shipped |
| M3 Play | Native mpv, Detail/episodes, playability index, grow | Shipped; reliability hardening continues |
| M4 Addons | Self-hosted AIOStreams and AIOMetadata integration | Shipped |
| M5 Voice + AI | Phone librarian, AI catalogs, companion, living memory | Implemented; full couch acceptance open |
| M6 Ship | Mango library, YouTube, recommendations, reliability, target-TV fidelity, setup | In progress |

## What is already in the product

### M1–M4 — native couch loop

- Raspberry Pi OS Desktop with X11/Openbox and one Chromium launcher at idle.
- Search, Movies, TV Shows, Live, and YouTube surfaces navigated by the 8BitDo
  Micro through `mango-tv-pad.py`.
- `catalog-service` owns rails, Detail, exact episodes, local library state,
  playability, stream resolution, playback sessions, Search, YouTube, and
  Reliability Center.
- AIOStreams is the intended sole stream-capable VOD aggregate in the exported
  manifest graph; Cinemeta, AIOMetadata, Bharat Binge, and optional Live addons
  have catalog/metadata/Live roles. AIO's configured
  indexers and transports contribute behind that boundary. Catalog-service
  still contains an optional legacy direct MediaFusion thin-pool supplement
  keyed by Pi-local state; remove it or make the exception explicit, gated, and
  observable before calling the runtime topology single-aggregate.
- mpv is the only supported daily player. Deferred foreground commit prevents
  failed probes from replacing the launcher with a black screen.
- Playback includes the cinematic HUD, minimal pause/buffering states,
  five-choice Streams drawer, validation before switching, contextual Undo,
  exact-session progress, and exact return focus.
- `playability.db` supplies verified-only browse pools. Maintenance works in an
  isolated database and publishes atomically, preserving the last-good couch
  snapshot on abort or failure.

### M5 — phone librarian and AI catalogs

- Text and push-to-talk companion with Deepgram speech recognition.
- Tool-mediated search/open, Save/Unsave, AI-catalog management, YouTube, Live,
  and living-librarian memory contracts.
- Voice and phone actions open Detail; the controller's **B** remains the
  playback confirmation boundary.
- Structured phone result cards and a TV HUD mirror. Replies are text-only;
  TTS, wake word, proactive push, and voice autoplay are not current features.

### M6 implemented foundations

- Mango-owned local library: Continue/resume, Saved, history, finished state,
  Fire/Water ratings, feedback, attribution, and normalized YouTube history.
- Native YouTube metadata/search/subscriptions/Takeout/history, local cached
  rails, OAuth setup, and `yt-dlp` → mpv playback.
- Unified progressive Search and exact Search → Detail → playback restoration.
- Reliability Center, nightly proof ledger, safe repair, resource limits,
  controller link/router split, and Git-only deployment.
- Household recommendation v2 source: content-only StoryDNA enrichment,
  deterministic local story graph, up to three taste threads, six-card VOD For
  You rails, provenance-gated YouTube rails, atomic generations, and independent
  `off|shadow|serve` flags.

## Remaining sequence

### P0 — establish one current deploy/proof baseline

Before promotion work, first harden the deployment helpers, then deploy the
exact intended branch revision through Git,
inventory and preserve Pi-owned state, and record:

- fail-closed enforcement of `feat/native-experience`, a successful origin
  fetch, and exact requested-SHA pin/readback on Mac and Pi;
- removal or default-disable of the implicit AIOMetadata rail mutation from
  ordinary deploy; any explicit state workflow must use private temp files,
  cleanup, redacted output, explicit authorization, and non-masked failures;
- source SHA, Pi SHA, feature modes, schema versions, and service health;
- AIOStreams stateful configuration drift separately from repository deploy;
- gate-lite plus the relevant Search, YouTube, UX, recommendation, controller,
  and reliability gates;
- screenshots and a short physical-TV observation matrix.

No report from an older SHA or superseded card/rail contract closes this step.

### P1 — deploy and accept the latest-only recommenders

Target `772b3d5` leaves exactly one executable recommendation architecture per
domain and closes the source rollout blockers. VOD uses progressive content
profiles and the Household Story Frontier;
YouTube uses authoritative subscription/history provenance and local v2
generations. `off` and `shadow` no longer revive old recommenders: `off`
disables the domain and `shadow` builds the latest architecture without a
public recommendation rail. The latest recorded Pi snapshot predates this
contract, so runtime generation health and couch quality remain unknown.

Required outcomes:

1. Preserve the focused source proof already passing for YouTube off ownership,
   exact VOD active-mode Saved, disabled/public Shuffle, active/previous/public
   pointers, migrations, publication, rollback, and playability schema 14.
2. Deploy the exact accepted successor through the reviewed manual path while
   the unattended-wrapper blocker remains open,
   keeping VOD in shadow, the global teacher disabled, and the bounded frontier
   off. Add or confirm migrations 15–16 upgrade/preservation/rollback;
   frontier-specific
   lease expiry/retry/max-attempt/rolling-window/coalescing/concurrency/restart;
   TMDB failure/rate-limit/credential-file/TV-series; progressive-mode
   activation/staleness integration. Do not resume
   unbounded one-title online backfill on the Pi.
   Before service start, require verified Pi-local SQLite online backups of
   both library and playability state; the current library backup helper's
   plain-copy fallback is not acceptable migration proof.
3. Reach complete, auditable corpus accounting without leaking household state
   to the content teacher or blocking Home on AI/network work.
4. Run the deterministic offline evaluation, strengthen or supplement its
   current absolute minimum with accepted quality evidence, and complete
   uncertainty/coverage, latency/restart/offline, and shadow diagnostics.
5. Promote VOD shadow → serve only after thresholds pass. Operational rollback
   is `serve` → `shadow`/`off`; code rollback uses a reviewed older Git revision.
   Neither path deletes preserved historical rows.
6. Refresh authoritative YouTube subscription/history inputs, enable YouTube
   v2 independently, prove quota-free Home/**X**, provenance isolation,
   last-good behavior, and Takeout safety.
7. Finish with human relevance, diversity, familiarity, surprise, stale-state,
   and explanation-free 10-foot acceptance—not just offline ranking metrics.
8. Decide from measured progressive coverage, quality, and teacher cost whether
   any future bulk artifact/importer is justified. It is absent, not a rollout
   prerequisite, and must not reintroduce a corpus-wide online teacher loop.

Current design: [FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md) ·
[YOUTUBE.md](YOUTUBE.md). The older
[bulk-work prompt](tasks/RECOMMENDATIONS_STORYDNA_BULK_WORK_AGENT_PROMPT.md) is
planning input only until progressive measurements justify that architecture.

### P2 — implement intentional display sleep

The design is locked and must replace accidental Xorg blanking:

- Settings choices: Off, 15 min, **30 min default**, 60 min, 2 hours.
- Only D-pad and companion activity reset idle.
- Playback by mpv always inhibits sleep.
- Sleep sends DPMS Off and HDMI-CEC standby.
- Wake sends DPMS On and HDMI-CEC power-on, then restores the correct Mango
  foreground/focus without pairing mode or app restart.
- Remove/override the observed accidental Xorg 600-second timeout.

Acceptance requires real Pi/TV tests for idle, active browse, active playback,
paused playback, companion activity, controller wake, reboot persistence, CEC
enabled/disabled TVs, and failure fallback. This is not closed by the current
display-wake helper, which only forces the display on/disables automatic DPMS.

### P3 — harden everyday reliability

#### Playback and streams

- Prove the exact-ID clean-empty recovery and deferred foreground contract on
  titles/episodes that previously showed fail → fail → play or black → Detail →
  late play.
- Keep retry classification strict: clean/proven-transient aggregate empty
  only; no blind retries for 429, auth/configuration, permanent errors,
  cancellation, expired deadlines, Live, Detail lists, or picker refresh.
- Add runtime topology proof that AIOStreams and intended nested providers are
  configured and contributing without exposing URLs or credentials.
- Decide and close the legacy direct MediaFusion thin-supplement path: remove
  the bypass in favor of AIO-only resolution, or explicitly feature-gate and
  prove its latency, deadline, credential, and contribution behavior.
- Keep launch/validation single-flight, bounded, cancelable, cache coherent,
  and generation-scoped through switch/Undo/failure.

#### Library grow and nightly work

- Demonstrate repeated unattended, publishable maintenance cycles rather than
  relying on old one-run corpus counts.
- Improve source yield for thin TV/India rails without weakening theme or
  playability eligibility.
- Preserve last-good rails and surface target shortfalls as operator evidence;
  never interrupt active couch use or rebuild durable state as a repair.
- Verify persistent timer catch-up, overlap guards, idle gates, WAL checkpoint,
  recommendation jobs, and proof recording as one observable chain.

#### Controller and Reliability Center

- Close five physical normal-power-on reconnect cycles without entering
  pairing mode.
- Reconcile the backend `controller_repair` action with the launcher Settings
  surface before documenting it as a visible button.
- Make intentionally disabled/unconfigured Live neutral in Reliability Center;
  current source incorrectly makes `live_config_ready=false` overall red. Add an
  explicit Live-off test while retaining red for configured Live without usable
  current/stale cache.
- Fix the committed playability migration marker (`14` in the migration table
  versus `13` from `/playability/status`) and make API/reporting tests
  authoritative.
- Harden deploy around an idle couch, inventoried dirty Pi state, exact branch/
  SHA pinning, fail-closed fetch, and explicit state mutation; deployment
  restarts the stack and can stop active playback.
- Replace the current trusted-LAN-only companion/WSS assumption with per-device
  pairing/authentication, origin/session validation, revocation, and bounded
  abuse handling; TLS plus a catalog allowlist is not client identity.

### P4 — close target-TV fidelity honestly

The native daily architecture supports a verified 4K SDR HEVC path, while
HDR through X11/mpv is not a supported ship claim. A separate Kodi/GBM HDR
experiment is parked, not integrated.

Required outcomes:

- publish a final source/codec/resolution/HDR/audio support matrix;
- prove visible picture, output mode, HDR state where applicable, dropped
  frames, audio route, lip sync, subtitles, seek, resume, and launcher restore
  on the target TV/soundbar;
- retain source-matched smooth 1080p as the safe fallback;
- either integrate and fully orchestrate a credible HDR engine or explicitly
  ship native Mango without HDR. Hardware capability alone is not acceptance.

### P5 — finish product acceptance and first boot

- Run the consolidated current [COUCH_TEST.md](COUCH_TEST.md) against one exact
  release revision: browse/Detail, Search, playback/HUD/Streams, ratings and
  recommendation quality, YouTube, Live, controller, phone/voice, offline and
  restart behavior, display sleep, and target-TV fidelity.
- Resolve only evidence-backed defects without loosening security, state,
  identity, eligibility, or proof contracts.
- Build the M6.4 installer/first-boot wizard for network, controller,
  display/audio, companion certificate, provider configuration, and health
  confirmation without SSH.
- Re-run release gates and couch acceptance, then merge to `main`.

## Milestone exit criteria

| Milestone | Exit criterion still open |
|-----------|---------------------------|
| M3 | Repeated grow/source-yield proof and final target-TV playback matrix |
| M5 | Comprehensive phone/voice/memory couch pass on the release revision |
| M6.2 | VOD and YouTube recommendation v2 backfill, promotion, rollback, and human quality verdict |
| M6.3 | Honest integrated display/audio/quality acceptance; no unsupported HDR claim |
| M6.4 | No-SSH first boot and recovery workflow |
| M6.5 | Whole-product visual/focus/state acceptance on the final revision |

## Risk register

| Risk | Control |
|------|---------|
| Source-complete is mistaken for shipped | Maintain source/deployed/Pi-gated/couch-observed columns in STATUS and reports |
| StoryDNA enrichment is slow or expensive | Deterministic progressive base profiles + off-by-default bounded frontier; add a bulk artifact/importer only if measured coverage/quality/cost gaps justify it |
| Recommendation metrics look good but the couch feels generic | Human comparative rails test after offline/shadow gates; fast rollback |
| Native HDR is overclaimed | Evidence matrix; 1080p safe path; no promotion from codec capability alone |
| Resolver fan-out is slow or contradictory | AIO-only target, close the legacy direct-MediaFusion exception, single flights, classified retries, shared deadline, provider topology diagnostics |
| Thin rails starve | Source-yield accounting and targeted curation without weakening theme/playability contracts |
| Deploy disrupts active viewing or operator state | Idle preflight, dirty-state inventory, Git-only pull, stateful config handled separately |
| Deploy helper selects/moves the wrong revision | Enforce `feat/native-experience`, fail closed on fetch, pin requested SHA, read back origin/Mac/Pi hashes |
| Ordinary deploy mutates AIOMetadata private state | Remove/default-disable implicit sync; explicit human-authorized workflow with secure temp, cleanup, redaction and surfaced failure |
| Optional Live makes a Live-off box falsely red | Neutral disabled state plus configured-no-cache red regression tests |
| Automatic repair destroys useful evidence/state | Safe repair allowlist; never routine DB/cache/history/credential deletion |
| Controller reconnect falls back to pairing | Root BlueZ supervisor + evdev router; physical normal-wake acceptance |
| Old reports become product truth | Historical labels and exact-SHA proof boundaries |

## Standard release gates

From the home Mac, **after the current deploy blockers above are fixed and
tested**:

```bash
bash scripts/pi-deploy.sh --fast --gate
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
```

Add the subsystem gates named in [STATUS.md](STATUS.md) and complete the human
checks in [COUCH_TEST.md](COUCH_TEST.md). Live remains explicitly opt-in.
