# mango — Pi operations

**Pi:** SSH alias `mango` primary, `mango-mdns`/`mango.local` discovery fallback · `~/mango` · **Branch:** `feat/native-experience`

Do not treat a previously observed numeric LAN address as durable truth. Resolve
through the configured SSH aliases and inventory the actual Pi before acting.

| | |
|--|--|
| **Display** | X11 + Openbox · `DISPLAY=:0` |
| **Launcher** | `http://127.0.0.1:3000/` · Chromium `mango-launcher` |
| **Gamepad** | 8BitDo Micro · MAC `E4:17:D8:EB:00:44` |
| **Stack** | `bash scripts/mango-stack.sh restart` |

**Deploy:** [DEPLOY.md](DEPLOY.md) (git only — never rsync) · **Pad:** [HARDWARE.md](HARDWARE.md)

> **Current deploy blocker:** `pi-deploy.sh`/`pi-exec-gate.sh` do not enforce or
> pin `feat/native-experience`, and deploy can implicitly run a mutating
> AIOMetadata sync that emits sensitive output and leaves a fixed `/tmp` file.
> They are blocked for unattended agents until hardened. See the evidence and
> reviewed exception/manual path in [DEPLOY.md](DEPLOY.md).

---

## Bring-up

**After crash or unknown state:** first prove the couch is idle, record the Pi
SHA/status, and preserve any operator-owned changes. `mango-stack restart` stops
active mpv/indexers; do not run it during viewing.

```bash
cd ~/mango
git rev-parse HEAD
git status --short
# Continue only when dirty state is understood and preserved.
bash scripts/mango-stack.sh restart
```

That sequence restarts the already built checkout. Do not insert a bare
`git pull`: source updates require the catalog/launcher build performed by
the reviewed deploy/manual path in [DEPLOY.md](DEPLOY.md).

**From Mac** (after commit + push), preflight the exact source first:

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
```

Stop there for unattended automation. The intended `pi-deploy.sh --fast` and
`--fast --gate` interfaces remain blocked at the audited revision; use the
human-reviewed exception/manual path in [DEPLOY.md](DEPLOY.md), or harden the
wrapper first.

If the primary alias times out but mDNS works, use the `mango-mdns` SSH alias
for `aman@mango.local` to inspect the Pi. This does not bypass the deploy
blocker:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'
```

If that alias does not exist on the Mac, add it to `~/.ssh/config` with the
Mango key and `HostName mango.local`. Do not `scp`, `rsync`, or hand-copy repo
files as an SSH workaround.

**After reboot** (press pad button if BT is slow):

```bash
cd ~/mango
bash scripts/m1-foundation/ui/bootstrap-after-reboot.sh
```

---

## Daily use

1. TV shows **mango launcher** (Movies / Series / Live / YouTube tabs)
2. **B** select · **Y** back · **⌂** home · D-pad navigate
3. Phone **PTT** when `MANGO_VOICE=1` — HUD on launcher
4. **B** on detail → mpv fullscreen · **⌂** returns home

| Control | Action |
|---------|--------|
| D-pad | Move focus |
| B (`304`) | Select / play |
| Y (`308`) | Back |
| X (`307`) | Home: current-tab shuffle. Search: tap deletes one character; hold 600 ms clears |
| − / + (`314` / `315`) | Volume down / up |
| L/R (`310`/`311`) | Tab − / + |
| ⌂ (`316`) | Home |

### Companion HTTPS boundary

The phone UI at `:3001` exposes a small named catalog capability set, not the
catalog service wholesale. Verify the three read-only companion paths and a
representative blocked private path without changing runtime state:

```bash
for path in ai/context voice/companion/summary youtube/companion/status; do
  curl -sk -o /dev/null -w "$path %{http_code}\n" \
    "https://127.0.0.1:3001/api/catalog/$path"
done
curl -sk -o /dev/null -w "recommendations/state %{http_code}\n" \
  https://127.0.0.1:3001/api/catalog/recommendations/state
curl -sk -o /dev/null -w "voice/companion/journal %{http_code}\n" \
  https://127.0.0.1:3001/api/catalog/voice/companion/journal
curl -sk -o /dev/null -w "youtube/state %{http_code}\n" \
  https://127.0.0.1:3001/api/catalog/youtube/state
```

With the catalog and voice stack healthy, the first three return `200`; all
three private/operator paths return `403`. Companion status contains only
`api_key_configured`, `oauth_configured`, `authenticated`, and
`needs_attention`; it never returns the raw reason for attention. A blocked
response must be produced before any
loopback request and must not include internal upstream details. Add a new
companion capability only when the shipped phone UI genuinely consumes it, and
pair that exact method/path with proxy tests.

### Pad + Chromium tuning (D-pad latency)

D-pad browse latency was tuned in three tiers (A: pad hot path, B: periodic-lag
fix, C: GPU rasterization + pad-nav API). Relevant env vars:

| Env var | Default | Effect |
|---------|---------|--------|
| `MANGO_PAD_DPAD_DEBOUNCE_SEC` | `0.05` | D-pad debounce (vs `0.12` for face buttons) |
| `MANGO_PAD_LAUNCHER_WID_TTL_SEC` | `2.0` | Cache TTL for launcher window-id lookup |
| `MANGO_PAD_FOREGROUND_LAUNCHER_TTL_SEC` | `2.0` | Cache TTL for "foreground is launcher" |
| `MANGO_PAD_COUCH_ACTIVITY_THROTTLE_SEC` | `0.5` | Throttle for async couch-activity touches |
| `MANGO_PAD_NAV_API` | `1` | Pad POSTs nav to `/api/pad/nav`; `0` forces the xdotool rollback path |
| `MANGO_PAD_NAV_TIMEOUT_SEC` | `0.75` | HTTP timeout per pad-nav POST attempt |
| `MANGO_PAD_NAV_RETRIES` | `3` | POST attempts before give-up (no xdotool while API is on) |
| `MANGO_PAD_NAV_RETRY_BACKOFF_SEC` | `0.03` | Sleep between pad-nav POST retries |
| `MANGO_PAD_SECONDARY_HOLD_SEC` | `0.6` | X hold threshold for Search clear; shorter presses are tap/delete |
| `MANGO_CHROMIUM_DISABLE_GPU` | `0` | `1` = force software compositing (rollback for GPU rasterization regressions) |

The pad-nav API is enabled in `mango-tv-pad.service` by default. While it is on,
launcher presses retry over HTTP and **never** fall back to xdotool (synthetic
keys are often ignored by Chromium kiosk). Set `MANGO_PAD_NAV_API=0` only as a
temporary rollback and restart the pad. The TV launcher registers
`POST /api/pad/session` and is the only consumer whose ack drains the queue;
`gate-m6-ux-smoke.sh` uses `"probe": true` so gates do not move couch focus.
Verify Chromium GPU rasterization on the Pi via `chrome://gpu` (launch Chromium
briefly with `--remote-debugging-port=9222` and open the URL from a host
browser); "Hardware accelerated" should appear under Rasterization.

### Couch activity and display

Mango couch mode is silent: no maintenance, grow, or debug status is shown on
the TV. Activity is recorded only as a timestamp/source/hint in
`~/.cache/mango/couch-activity.json`.

```bash
bash scripts/diag/couch-activity-status.sh
bash scripts/lib/couch-activity.sh touch operator inspect
```

Pad input, launcher key/clicks, voice turns, mpv play/stop, and progress flushes
update the **maintenance** activity file. Launcher process startup does not
count as user activity: Mango may be on overnight and still run grow when no
one has actively used it recently. Maintenance uses a 30 minute idle threshold by default
(`MANGO_COUCH_IDLE_SEC` for tests only).

Current source disables X11 DPMS/screensaver blanking and forces the display on
during UI start. Controller input applies an equivalent throttled inline `xset`
wake sequence; it does **not** currently call the helper below:

```bash
bash scripts/lib/mango-display-wake.sh --focus-launcher-if-idle
```

The helper restores launcher focus only when mpv is not active. The duplicate
helper/pad ownership must be consolidated by the intentional-sleep refactor so
one state machine owns idle, inhibition, sleep, and wake. This is a temporary
implementation, not the desired sleep feature. A recorded Pi inspection still
found Standby/Suspend/Off at 600 seconds.

The locked replacement is Settings-driven Off/15/30(default)/60/120 minutes,
with idle reset **only** by D-pad and companion input, mpv playback inhibition,
DPMS Off + CEC standby for sleep, and DPMS On + CEC power-on for wake. It is not
implemented or Pi/TV-proven. Do not use the maintenance activity file as the
sleep policy wholesale: voice/progress/background activity has different
semantics. See [STATUS.md](STATUS.md#display-sleep-gap).

The launcher is intentionally a lightweight 60 Hz surface. By default Mango
applies `1920x1080@60` before launching the kiosk browser:

```bash
bash scripts/lib/mango-display-mode.sh status
bash scripts/lib/mango-display-mode.sh launcher
```

Override only for device validation:

```bash
MANGO_LAUNCHER_DISPLAY_MODE=3840x2160 MANGO_LAUNCHER_DISPLAY_RATE=60 \
  bash scripts/lib/mango-display-mode.sh launcher
```

This display mode does not change stream filters. 4K stream/playback policy
stays in catalog filters and the mpv profile.

**Playback HDMI + OSD contract:** `mpv-play.sh` keeps the launcher visible while
the candidate buffers and commits foreground ownership only after mpv proves
real, advancing, feature-length playback. It then hides the launcher, suppresses
desktop chrome (including pcmanfm wallpaper), paints the X root black, and
source-matches HDMI before first reveal when the video profile is known. Failed
candidates and probes are display-neutral. Never match while Chromium is still
mapped. The playback OSD and pad never call
`playback-auto` / display-ensure during steady play (operator-only:
`MANGO_PLAYBACK_DISPLAY_ENSURE=1`). OSD defaults to 4s visible, scales to a
constant physical size (1080p reference), redraws ~1 Hz only while visible,
and starts with no chrome. Normal feedback lasts 4s; track/error feedback lasts
6s. Pause settles to a persistent small badge, and a real mpv cache pause shows
`Buffering…` only after a 1s anti-flicker delay. Pad **↑** is the sole subtitle
control (show-first, then force-on + cycle); **A** is show-first for audio.
4K+audio smoothness requires `--blend-subtitles=no`
(default in `mpv-play.sh`); `blend-subtitles=yes` causes sustained ~2.5 frame
drops/s on Pi 5 even with healthy cache and audio on. Probe with
`scripts/diag/playback-smoothness-probe.sh`. During a 4K play, prove HDMI + decode path with:

```bash
bash scripts/diag/playback-4k-proof.sh
# or: bash scripts/diag/playback-4k-proof.sh --watch
```

Audit the active resolver graph and URL-free contribution evidence for a title:

```bash
bash scripts/diag/playback-ladder-health.sh movie tt3268458
```

During movie/series playback, **X** opens the mpv-native 58%-height Streams
drawer. It uses the localhost active-stream API and URL-free
`~/.cache/mango/active-streams.json`; opening it performs no provider resolve.
The current source is first in a maximum-five roster; unavailable rows are last
and cannot be selected. **Up/Down** moves, **B** validates/selects, and **Y**
closes the panel. A successful switch temporarily maps X to Undo; a failed switch keeps/reopens the
drawer and leaves the original playing. Live and YouTube ignore X. Disable
only for rollback with `MANGO_STREAM_PICKER=0` in
`~/.config/mango/voice.env`, then restart catalog and pad.

```bash
curl -sf http://127.0.0.1:3020/play-session/active/streams | jq
bash scripts/m6-ship/gate-m6-stream-picker-source.sh # Mac-safe, no Pi access
bash scripts/m6-ship/gate-m6-stream-picker-smoke.sh
# Pi-only visual fixture proof (actual mpv/libass rendering):
bash scripts/m6-ship/render-mpv-hud-fixtures.sh /tmp/mango-hud-fixtures
```

`ensure-launcher` (alias `launcher`) is called on stack boot, home, present,
stop, deploy, and display-wake so browse never drifts to 4K HDMI by accident.

### Target-TV fidelity boundary

The current hifi profile keeps Chromium at `1920x1080@60`, source-matches mpv,
and can select proven-compatible 4K SDR HEVC/REMUX paths. Older TV evidence
showed smooth source-matched 4K SDR HEVC, while native HDR through X11/mpv was
not smooth enough to support an HDR ship claim. The safe fallback remains
source-matched 1080p. The profile is reversible and writes only user-owned
runtime config under `~/.config/mango`.

```bash
cd ~/mango
bash scripts/m6-ship/apply-4k-hdr-profile.sh apply
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh
bash scripts/diag/pi-resource-snapshot.sh
```

If the TV/soundbar path only advertises unstable 4K modes, Mango must not use
them as the couch fallback. Keep mpv on source-matched 1080p until a
visible-picture 4K SDR gate passes. Fix the HDMI path before requiring 4K: use a
direct HDMI 2.0/2.1 TV input, enable the TV's
enhanced/deep-color input mode for that exact port, or bypass the soundbar until
`xrandr` lists stable 4K film modes and the visible-picture test passes.

The script name retains historical `4k-hdr` wording, but applying it does not
prove native HDR. Acceptance must record picture, actual mode/transfer, dropped
frames, audio/lip sync, subtitles, seek/resume, and launcher restoration. A
separate Kodi/GBM HDR experiment is parked and is not the current Mango player.

Rollback:

```bash
bash scripts/m6-ship/apply-4k-hdr-profile.sh revert
```

Safe transfer to the 4K TV:

```bash
cd ~/mango
bash scripts/mango-stack.sh stop
sync
sudo shutdown -h now
```

Wait until SSH drops and the Pi storage/activity LED is idle before unplugging
power. Move the Pi, connect HDMI to the TV or soundbar/TV path, then connect
power. After boot, press a controller button and run:

```bash
cd ~/mango
bash scripts/mango-stack.sh restart
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh
bash scripts/audio/list-sinks.sh
```

Keep Piper/TTS disabled until the TV/soundbar sink is explicitly validated.

If `scripts/audio/list-sinks.sh` shows only `Dummy Output` but `aplay -l` shows
`vc4-hdmi-0`, bypass PipeWire for mpv:

```bash
bash scripts/audio/set-default-sink.sh 'alsa/hdmi:CARD=vc4hdmi0,DEV=0'
MANGO_AUDIO_TEST_TONE=1 bash scripts/audio/set-default-sink.sh 'alsa/hdmi:CARD=vc4hdmi0,DEV=0'
```

---

## Gates

```bash
bash scripts/m1-foundation/gate/gate-m1.sh
bash scripts/pi-pre-couch-gate.sh          # gate-lite (~1–2 min)
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
```

When catalog enabled:

```bash
bash scripts/m2-catalog/service/check-m2-prereqs.sh
```

When YouTube enabled:

```bash
bash scripts/m6-ship/gate-m6-youtube-smoke.sh
MANGO_YOUTUBE_PLAY=1 bash scripts/m6-ship/gate-m6-youtube-smoke.sh
```

Reliability proof:

```bash
curl -s http://127.0.0.1:3020/reliability/state | python3 -m json.tool
bash scripts/m6-ship/reliability-proof.sh --reason operator
bash scripts/m6-ship/gate-m6-reliability-proof.sh
```

Target-TV Stage 2:

```bash
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh
bash scripts/diag/pi-resource-snapshot.sh
```

YouTube setup uses operator-owned files:

```bash
sudo install -m 0600 /path/to/youtube-api.key /etc/mango/youtube-api.key
sudo install -m 0600 /path/to/youtube-oauth-client.json /etc/mango/youtube-oauth-client.json
```

Then open the companion and use the YouTube connect panel. Full details:
[YOUTUBE.md](YOUTUBE.md).

Successful Connect must show the authorized channel title/avatar, authoritative
subscription count, and `ready`. `connected · recommendations paused` is valid
only when `MANGO_YOUTUBE_RECS_V2=off`; `sync needs attention` means the token was
kept but the authoritative refresh did not complete. For the India household,
verify `/youtube/state` is configured with `region_code=IN` and
`relevance_language=en`.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Desktop wallpaper after ⌂ | `bash scripts/launch-launcher.sh` · see [ARCHITECTURE.md](ARCHITECTURE.md) foreground |
| Pad waiting | `pad-health: waiting for controller` means the router is alive; turn the Micro on normally. The link supervisor retries indefinitely and should recover without pairing, but five-cycle physical proof remains open. Enter pairing only if diagnostics prove the bond is absent. |
| Pad dead | Run `bash scripts/m1-foundation/pad/controller-link-diagnose.sh`; the backend/API has a `controller_repair` action, but the current launcher Settings surface does not render that button. Use pairing recovery only if diagnostics prove the pairing record is absent. |
| Voice HUD missing | `MANGO_VOICE=1` in env · `bash scripts/m5-voice/stack/verify-voice-ready.sh` |
| YouTube tab empty | `curl localhost:3020/youtube/state` · configure `/etc/mango/youtube-api.key` · run `bash scripts/m6-ship/gate-m6-youtube-smoke.sh` |
| YouTube account not connected | Companion → YouTube connect · verify `/etc/mango/youtube-oauth-client.json` and `/etc/mango/youtube-auth.json` permissions |
| YouTube connected but not ready | Inspect sanitized Companion sync state, then localhost-only `.recommendations_v2.subscription_acquisition` and refresh phases. Never delete the token or cache merely to clear an error; repair the failing phase and preserve last-good state. |
| YouTube playback 403/429/CAPTCHA | Update `yt-dlp`; reconnect account/cookies; pick another video; metadata cache should remain visible |
| Catalog error appears after exiting a successful play | Inspect `~/.cache/mango/playback-session.json`; `ever_ready=true` means the launcher must treat the play as successful. Check catalog logs for a pre-frame failure only; do not invalidate title metadata from a late HTTP timeout. |
| Same title will not immediately replay | `curl localhost:3020/play-session/<request_id>` when the request ID is known; inspect `~/.cache/mango/play-cancel.epoch` and `~/.cache/mango/mpv.pid`. A stale prior exit monitor is generation-gated and must not stop the new PID. |
| YouTube recommendations stale | Full refresh: `bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly`; YouTube-only: `bash scripts/m6-ship/youtube-refresh-cache.sh --reason operator` (waits for its HTTP 202 job to finish); then inspect `curl localhost:3020/youtube/state` and `refresh.phase_results` |
| YouTube Live Now partial error | In `serve`, inspect `curl -s localhost:3020/youtube/state \| jq '.refresh.phase_results[] \| select(.phase == "v2_live_acquisition")'`; quota failure must retain the explicitly stale last-good subscription/live generation. Popular/Fresh/legacy-live acquisition is removed and must not appear in any current mode. |
| Unified Search degraded row | Run `bash scripts/m6-ship/gate-m6-search-smoke.sh`; diagnostic mode is cache-only and does not write history or spend quota |
| Reliability badge yellow/red | Open Settings → Reliability Center; or `curl localhost:3020/reliability/state` |
| No TV output after moving Pi | SSH in and force the safe launcher mode: `DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority xrandr --output HDMI-1 --mode 1920x1080 --rate 60`; then `bash scripts/launch-launcher.sh` |
| Target-TV gate fails film cadence | Keep Mango fallback at `1920x1080@60`; verify `xrandr` exposes `1920x1080 23.98/24.00` |
| 4K playback blue/unstable | Fall back to source-matched 1080p. Prove 4K SDR picture/mode/drops/audio on this TV; do not treat current X11/mpv as native HDR-capable |
| Soundbar silent | `bash scripts/audio/list-sinks.sh` · set HDMI/TV/bar sink with `scripts/audio/set-default-sink.sh`; if PipeWire shows only Dummy Output, use `scripts/audio/set-default-sink.sh 'alsa/hdmi:CARD=vc4hdmi0,DEV=0'` |
| Nightly proof missing/stale | `bash scripts/m6-ship/reliability-proof.sh --reason operator` · inspect `/etc/mango/reliability/proofs.jsonl` |
| Empty rails | `bash scripts/mango-health-repair.sh` · `curl localhost:3020/health` · playability status script |
| Live tab empty after source error | `bash scripts/live/live-diagnostics.sh` · stale cache should remain available |
| Grow seems hung | `python3 scripts/diag/grow_monitor.py status --verbose` · inspect stage/source before killing |
| Maintenance did not run | `bash scripts/diag/couch-activity-status.sh` · check deferred JSON in `~/.cache/mango/ops/` and `~/.cache/mango/nightly-library-refresh.log` |
| Orphans or overlap drift | `rail-pool-retheme.sh dry-run --orphans-only` or `--overlap-only`; see [PLAYABILITY.md](PLAYABILITY.md) |
| Chromium duplicate | `bash scripts/mango-kill-strays.sh` |

Logs: `~/.cache/mango/mango.log` · `journalctl --user -u mango-stack` (if systemd)

Watchdog repair is narrow: it clears stale locks and known maintenance/debug
strays, repairs the current pad event owner, restarts catalog-service when
rails/live readiness fails, and restarts launcher units only when UI health is
still bad. Use `bash scripts/mango-stack.sh restart` for a deliberate clean
full-stack reset.
During playability maintenance, the watchdog must skip repair entirely while the
maintenance lock/process is active; the watchdog systemd service must not
`Wants=` launcher/catalog units because systemd starts wanted units before the
repair script can check the maintenance lock.

Grow operator state: `~/.cache/mango/grow-run-state.json`, `~/.cache/mango/ops/refresh-*.json`, `~/.cache/mango/source-grow/latest.json`.
Reliability proof state: `/etc/mango/reliability/proofs.jsonl`.

The 03:00 and 06:00 calendar timers are `Persistent=true`: a missed event can
run after boot, but every job must still respect playback, couch-idle, and
overlap guards. There is no separate uncontrolled daytime retry watcher for a
failed nightly. After a yellow proof, use explicit operator catch-up only when
the couch is idle and no persistent catch-up/job is already active:

```bash
bash scripts/m3-play/playability/playability-catch-up.sh nightly
systemctl --user list-timers 'mango-playability*' 'mango-companion*'
```

Scheduled maintenance (local time):

| Time | Timer | Job |
|------|-------|-----|
| 03:00 | `mango-playability-indexer.timer` | Stale/grow → VOD recommendation jobs → session bookkeeping → YouTube → WAL checkpoint → proof |
| 06:00 | `mango-companion-nightly.timer` | Companion consolidate (skips if grow lock held) |
| every ~3 min | `mango-watchdog.timer` | Narrow health repair |

---

## Household recommendations

Target `a60d1c0` contains one executable architecture per domain: progressive
Household VOD and provenance-gated YouTube v2. The Pi currently serves both
with complete accounting and automated gates. Reverify live state before
relying on any mode or count, and do not record screenshots or human couch PASS
until directly observed on the exact revision.

One-title-at-a-time autonomous StoryDNA backfill was stopped for cost/latency.
Current VOD refresh compiles `vod-content-profile-v2` locally for the verified
corpus and retains an opt-in bounded new/evidence-changed frontier. The old v4,
strict-only publisher, legacy rank worker/snapshot fallback, and corpus-wide
teacher are removed from execution; their data is preserved. A separate
offline/bulk artifact/importer is absent and is not a rollout prerequisite.

Migration 4 creates the existing WAL-consistent ratings backup. Migrations
5–11 preserve profiles/signals and add attribution, metrics, served-slate, and
watch-state support. Migration 12 additively adds StoryDNA, ontology, taste,
rank, cached-slate, and refresh-job state; migration 13 durably adds normalized
Takeout history and import audit; migration 14 generation-scopes cached VOD
slates and persists low-water repair requests. Library migration 15 adds
profiles/frontier/calibration/usage; library migration
16 adds immutable StoryDNA overlays keyed by content plus semantic-evidence hash;
library migration 17 adds immutable priors and resumable bounded refresh state;
playability migration 14 adds semantic revisions. Progress migration 2
remains profile-exact.
None rewrites historical snapshots or deletes ratings, Saved, history, profiles,
progress, StoryDNA, provenance, or last-good state.

The routine `scripts/m6-ship/backup-library-state.sh` is not fail-closed
migration proof: if SQLite online backup raises `DatabaseError`, it falls back
to a plain copy of the main DB file, and it does not cover `playability.db`.
Before migrations 15–17/playability 14 on a live Pi, use and verify explicit
SQLite online backups for both `/etc/mango/library.db` and
`/etc/mango/playability.db`; reject any plain-copy fallback.

```bash
test -f /etc/mango/library.db.pre-fire-water-v4.bak
sqlite3 /etc/mango/library.db \
  "SELECT group_concat(version, ',') FROM (SELECT version FROM library_migrations ORDER BY version);"
sqlite3 /etc/mango/playability.db \
  "SELECT group_concat(version, ',') FROM (SELECT version FROM playability_migrations ORDER BY version);"
sqlite3 /etc/mango/progress.db \
  "SELECT group_concat(version, ',') FROM (SELECT version FROM progress_migrations ORDER BY version);"
curl -fsS http://127.0.0.1:3020/recommendations/state | python3 -m json.tool
curl -fsS http://127.0.0.1:3020/youtube/state | python3 -m json.tool
curl -fsS http://127.0.0.1:3020/personalization/state | python3 -m json.tool
```

At target `7a8bc1b`, library versions include `4` through `17`, playability
includes migration `14`, and progress includes `2`. Match expectations to the exact
committed SHA; never start a dirty checkout against live databases merely to
advance a migration marker.
In **VOD** `shadow` and `serve`, Household is the global recommendation identity:
Household
activation and null mood clearing are idempotent; non-Household create/activate
and non-null mood writes return typed `household_only`. Shadow therefore changes
live identity even though it hides For You; it is not a compute-only no-op. Do
not create, merge,
clear, or migrate personal rows for this rollout. Prove with before/after counts
that their ratings, Saved/history/progress, snapshots, and events retain their
original stable owner.

Seed manifests remain idempotent and are imported on the Pi only after every
row has an explicit approved/excluded disposition and unique stable identity:

```bash
cd ~/mango/src/catalog-service
npm run ratings:seed -- dry-run /path/to/fire-water-seed-v1.json
npm run ratings:seed -- validate /path/to/fire-water-seed-v1.json
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
```

`MANGO_VOD_RECS_V2=off|shadow|serve` and
`MANGO_YOUTUBE_RECS_V2=off|shadow|serve` are independent rollout controls;
`MANGO_FIRE_WATER_RATINGS=0` and `MANGO_FOR_YOU=0` remain reversible visibility
controls. `off` disables that domain's recommendations, `shadow` builds only
the latest architecture while hiding its recommendation rails, and `serve`
exposes only its published current architecture. No mode invokes a deleted
ranker. None deletes data. Story Graph ranking runs off-thread; failures and
deadlines retain the previous complete generation. Refresh endpoints return
HTTP 202 job IDs; poll the durable exact-job route
`/recommendations/jobs/:job_id`. Use `/recommendations/state` and
`/youtube/state` for aggregate diagnostics rather than inferring a specific
job's fate from their bounded recent-job windows.

The current controls are:

```text
MANGO_STORY_DNA=0|1                                  # global teacher kill switch; 0 disables refresh + frontier
MANGO_STORY_DNA_WORKER_MODE=off|frontier             # off default
MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE=12
MANGO_STORY_DNA_FRONTIER_ROLLING_30D=96
MANGO_STORY_DNA_FRONTIER_BATCH=4
MANGO_STORY_DNA_FRONTIER_RUN_MS=900000
MANGO_STORY_DNA_FRONTIER_COALESCE_MS=900000
MANGO_TMDB_METADATA=off                              # explicit disable
MANGO_TMDB_REQUESTS_PER_SECOND=5                     # clamped to 1–5
```

The frontier also caps attempts at three. Optional exact-ID TMDB enrichment is
credential-gated through `MANGO_TMDB_API_TOKEN`, `MANGO_TMDB_API_KEY`, or
`MANGO_TMDB_API_KEY_FILE` (default `/etc/mango/tmdb.key`), with requests capped
by `MANGO_TMDB_REQUESTS_PER_SECOND` at five/second. Keep all credentials
device-owned. `MANGO_STORY_DNA=0` is the global containment control: it disables
both normal teacher refresh and the frontier independently of worker mode.
Existing focused tests cover exact-ID/no-fuzzy TMDB mapping and the worker-off/
per-type daily-budget path. Leave the worker `off` and global teacher `0` for the
first shadow deploy until migrations 15–16 upgrade/preservation/rollback,
frontier-specific lease expiry/retry/max-attempt/rolling-window/coalescing/
concurrency/restart, TMDB failure/rate-limit/credential-file/TV-series,
mode-aware activation/staleness and active-pointer diagnostics pass. The removed
`MANGO_VOD_CONTENT_PROFILE` and `MANGO_STORY_DNA_AUTONOMOUS_BACKFILL` keys are
obsolete; remove those keys from operator configuration without touching data.

Target `7a8bc1b` reports library/playability schema versions `17`/`14`, matching
the applied migrations; both Pi databases pass `quick_check`. Future deploys
must re-prove the migration table and public status. The source remains blocked
from unattended wrapper deployment by the independent helper-safety defects.

Recommendation source blockers are closed at the target:

- `/recommendations/state` separates the newest diagnostic row from per-domain
  active, previous complete, promotion, and public pointers/epochs. Re-prove the
  relationships on real Pi generations; never print household rows.
- The current absolute VOD evaluator does not compare against an accepted
  baseline or gate reserve depth, calibration, teacher cost, worker latency, or
  uplift confidence. `promotion_eligible` means supervised rating evaluation
  passed. Separately, `serve_eligible` may use `evidence_cold_start` only when
  stratified-rating/nDCG coverage is the sole unavailable evidence and every
  measured operational guard passes. This supports real Saved/watch cold start
  without synthetic ratings. Neither field is a human relevance verdict.
- In YouTube `off`, service and route use the exact active personal owner; in
  shadow/serve they use Household. Focused tests cover the former 409 regression.
- Launcher X/Shuffle is available for non-empty mutable discovery rails. On
  Movies/TV it advances `For You` when served and every category rail in only
  the active tab; Continue/Saved remain stable. Off/shadow can shuffle category
  rails without inventing a public recommendation epoch. Success requires an
  actual discovery membership/order change.
- Playability uses an 8,192-page WAL autocheckpoint (roughly 32 MiB at the
  current page size) because tab-wide category session writes can otherwise
  trigger SQLite's 1,000-page checkpoint inside a burst of X presses. The
  existing idle/nightly `checkpoint-wal-dbs.sh` remains the explicit truncate
  boundary; do not grow this threshold in response to unrelated latency.

Grow/nightly playability maintenance performs that polling itself: after the
new corpus is published, it waits for the exact Movies and TV refresh job IDs
to become `complete` or `coalesced` before reporting maintenance complete. A
missing, failed, or timed-out job makes the maintenance command fail while the
last-good recommendation generation remains active. The bounded wait defaults
to 900 seconds and is configurable with
`MANGO_VOD_RECOMMENDATION_REFRESH_TIMEOUT_SEC`.

Before the couch verdict, verify without clearing state. Run the VOD bullets
only when VOD is promotion-eligible `serve`, and the YouTube v2 bullets only
when YouTube is `serve`; otherwise mark those checks DEFERRED and record the
actual no-recommendation/utility-only surface instead.

- Every visible Movies/TV For You rail has six currently verified cards
  allocated `6`, `3/3`, or `2/2/2` across supported Household threads. Rated,
  Saved, meaningfully watched, hidden, blocked, and exact Not-for-me titles stay
  absent. There is no forced exploration or cooled rewatch.
- Profile and mood controls are absent; rejected writes do not mutate dormant
  rows. StoryDNA teacher/network failure leaves last-good local slates usable.
- Household exact Not for me disappears immediately, Undo restores it, and it
  creates no semantic penalty for related titles, creators, or topics.
- YouTube orders logical positions For You, Beyond Your Subscriptions, More Like
  …, History, Saved, then conditional From Your Subscriptions and Live Now.
  Normal rows render only with exactly four cards and can be absent under thin
  supply; Live Now may have one to four. Rendered History/Saved stay stable.
- Save four distinct YouTube videos: Saved remains stable, none enters For You,
  and acquisition/affinity do not change except for exact output exclusion.
- Read `refresh.search_calls_today` and `refresh.api_calls_today`, press X
  several times, and prove both remain unchanged. VOD X must return from cached
  state without waiting for enrichment, graph, corpus scan, ranking, or network
  work. Record asynchronous low-water work separately; it may be enqueued after
  the cached read and must not be mistaken for response-path blocking.
- Start representative 1080p and known-safe 4K recommendations and run the
  existing playback proof. Recommendation work must not alter resolver,
  display-mode, first-frame, progress, or dropped-frame contracts.

Record taste-thread coherence, Beyond novelty, More Like thematic depth,
multilingual fit, reversibility, and latency as human verdicts. Until those
checks run on the Pi/TV, all remain **DEFERRED**.

### Episode says “stream not found”, then later succeeds

A series play must resolve the exact `tt…:season:episode` ID. At release
defaults, one automatic VOD Play confirms a clean AIOStreams HTTP-200 empty (or
proven-transient error-only result) twice after 1.2-second bounded delays inside
the same single flight and absolute deadline. The source permits 0–3 attempts
and 0–10-second delays as explicit rollback/experiment overrides; record the
loaded runtime values. It stops immediately on a playable result, so the
observed empty → empty → playable sequence completes from the first B at the
release defaults.
Confirmed 429s, provider HTTP failures/fetch timeouts, cancellation, malformed
media, permanent provider/account errors, and authoritative no-stream results
do not enter the clean-empty **resolve-confirmation** loop. Detail lists, Live,
and picker refresh do not inherit that policy. Separately, candidate-local
mpv/network failures may advance to another ladder candidate, and eligible
stale cached transport may cause one fresh resolve inside the same request wall.
Cache state is written only after the logical request settles.

On the Pi, capture the exact episode before diagnosing; never probe `:1:1` as a
stand-in and never clear runtime databases/caches. Do not use the current
`aiostreams-config.sh diff/apply` paths from an agent: `diff` exposes full state,
while `apply` prints and leaves a potentially secret-bearing fixed `/tmp`
response. Use fixed-field `verify`; an authorized human can review/change AIO
state through the Configure UI until the helper is hardened.

```bash
cd ~/mango
bash scripts/m4-addons/aiostreams-config.sh verify
curl -sf "http://127.0.0.1:3020/series/<bareSeriesId>/episodes" | jq '.seasons'
bash scripts/diag/playback-ladder-health.sh series <exactEpisodeId>
curl -sf http://127.0.0.1:3020/health \
  | jq '.resolver | {stream_resolve_retries,stream_resolve_retry_recoveries,stream_resolve_retry_exhaustions,last_contributions}'
journalctl --user -u mango-catalog.service --since '-10 min' --no-pager \
  | grep -E '"event":"(provider_fanout|stream_resolve_retry|resolve_flight)"'
```

The repo patch proves the recovery state machine, not which nested provider
failed on the TV. Attribute Torrentio, Comet, MediaFusion, TorBox, RD, or
Easynews only from the live, credential-safe contribution counters and Pi logs.
An AIO target-policy change is stateful: Git deploy alone does not apply it.
The fixed-field `verify` is diagnostic only; after an authorized human UI
change, verify again and use credential-safe contribution counters.

---

## Legacy player artifacts

Legacy Kodi/Stremio environment examples, installers, diagnostics, and research
remain in the repository, but current source has no supported executable
automatic fallback path. Do not enable or document these as the normal recovery
experience. The daily foreground contract is launcher ↔ mpv; diagnose native
playback failures in place and preserve state/evidence.

---

## Scripts index

[../scripts/README.md](../scripts/README.md)
