# mango — Pi operations

**Pi:** `aman@10.0.0.174` · SSH `mango` primary, `mango-mdns` fallback via `mango.local` · `~/mango` · **Branch:** `feat/native-experience`

| | |
|--|--|
| **Display** | X11 + Openbox · `DISPLAY=:0` |
| **Launcher** | `http://127.0.0.1:3000/` · Chromium `mango-launcher` |
| **Gamepad** | 8BitDo Micro · MAC `E4:17:D8:EB:00:44` |
| **Stack** | `bash scripts/mango-stack.sh restart` |

**Deploy:** [DEPLOY.md](DEPLOY.md) (git only — never rsync) · **Pad:** [HARDWARE.md](HARDWARE.md)

---

## Bring-up

**After crash or unknown state:**

```bash
cd ~/mango && git pull --ff-only
bash scripts/mango-stack.sh restart
```

**From Mac** (after commit + push):

```bash
bash scripts/pi-deploy.sh --fast
bash scripts/pi-deploy.sh --fast --gate
```

If the static IP alias times out but mDNS works, use the `mango-mdns` SSH alias
for `aman@mango.local` and keep using the same git-only wrappers:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'
MANGO_SSH_HOST=mango-mdns bash scripts/pi-deploy.sh --fast --gate
```

If that alias does not exist on the Mac, add it to `~/.ssh/config` with the
Mango key and `HostName mango.local`. Do not `scp`, `rsync`, or hand-copy repo
files as an SSH workaround.

**After reboot** (press pad button if BT is slow):

```bash
cd ~/mango && git pull --ff-only
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
update the activity file. Launcher process startup does not count as user
activity: Mango may be on overnight and still run grow when no one has actively
used it recently. Maintenance uses a 30 minute idle threshold by default
(`MANGO_COUCH_IDLE_SEC` for tests only).

When couch mode starts, Mango disables X11 DPMS/screensaver blanking and forces
the display on during UI start. Controller input also runs the same display wake
helper, throttled to a few seconds, as the low-latency recovery path:

```bash
bash scripts/lib/mango-display-wake.sh --focus-launcher-if-idle
```

The helper restores launcher focus only when mpv is not active.

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

### Target-TV Stage 2

Stage 2 keeps Chromium lightweight at `1920x1080@60` and enables source-matched
1080p mpv playback for the TV. The profile is reversible and writes only
user-owned runtime config under `~/.config/mango`.

```bash
cd ~/mango
bash scripts/m6-ship/apply-4k-hdr-profile.sh apply
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh
bash scripts/diag/pi-resource-snapshot.sh
```

If the TV/soundbar path only advertises unstable 4K modes, Mango must not use
them as the couch fallback. The Stage 2 wrapper keeps mpv on source-matched
1080p until a visible-picture 4K gate passes. Fix the HDMI path before
requiring 4K: use a direct HDMI 2.0/2.1 TV input, enable the TV's
enhanced/deep-color input mode for that exact port, or bypass the soundbar until
`xrandr` lists stable 4K film modes and the visible-picture test passes.

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

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Desktop wallpaper after ⌂ | `bash scripts/launch-launcher.sh` · see [ARCHITECTURE.md](ARCHITECTURE.md) foreground |
| Pad waiting | `pad-health: waiting for controller` means Mango is alive; turn the Micro on normally. The link supervisor retries indefinitely and pairing mode is not needed. |
| Pad dead | Open Settings → Reliability Center → **Repair controller** while idle; then run `bash scripts/m1-foundation/pad/controller-link-diagnose.sh`. Use pairing recovery only if diagnostics show the pairing record is absent. |
| Voice HUD missing | `MANGO_VOICE=1` in env · `bash scripts/m5-voice/stack/verify-voice-ready.sh` |
| YouTube tab empty | `curl localhost:3020/youtube/state` · configure `/etc/mango/youtube-api.key` · run `bash scripts/m6-ship/gate-m6-youtube-smoke.sh` |
| YouTube account not connected | Companion → YouTube connect · verify `/etc/mango/youtube-oauth-client.json` and `/etc/mango/youtube-auth.json` permissions |
| YouTube playback 403/429/CAPTCHA | Update `yt-dlp`; reconnect account/cookies; pick another video; metadata cache should remain visible |
| Catalog error appears after exiting a successful play | Inspect `~/.cache/mango/playback-session.json`; `ever_ready=true` means the launcher must treat the play as successful. Check catalog logs for a pre-frame failure only; do not invalidate title metadata from a late HTTP timeout. |
| Same title will not immediately replay | `curl localhost:3020/play-session/<request_id>` when the request ID is known; inspect `~/.cache/mango/play-cancel.epoch` and `~/.cache/mango/mpv.pid`. A stale prior exit monitor is generation-gated and must not stop the new PID. |
| YouTube recommendations stale | Full refresh: `bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly`; YouTube-only: `bash scripts/m6-ship/youtube-refresh-cache.sh --reason operator`; then inspect `curl localhost:3020/youtube/state` and `refresh.phase_results` |
| YouTube Live Now partial error | Check `refresh.phase_results.live_now`; Search Queries quota can exhaust while cached VOD rails and Popular still work because Popular uses `videos.list` |
| Unified Search degraded row | Run `bash scripts/m6-ship/gate-m6-search-smoke.sh`; diagnostic mode is cache-only and does not write history or spend quota |
| Reliability badge yellow/red | Open Settings → Reliability Center; or `curl localhost:3020/reliability/state` |
| No TV output after moving Pi | SSH in and force the safe launcher mode: `DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority xrandr --output HDMI-1 --mode 1920x1080 --rate 60`; then `bash scripts/launch-launcher.sh` |
| Target-TV gate fails film cadence | Keep Mango fallback at `1920x1080@60`; verify `xrandr` exposes `1920x1080 23.98/24.00` |
| 4K playback blue/unstable | Keep the safe Stage 2 profile applied; 4K stream/output is experimental until a visible-picture gate passes |
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

Playability timers do not run a couch-disruptive `OnBootSec` catch-up by
default, and there is no daytime auto-retry timer for failed nightlies. After a
reboot or a yellow Reliability proof, use the explicit operator catch-up only
when the couch is idle:

```bash
bash scripts/m3-play/playability/playability-catch-up.sh nightly
systemctl --user list-timers 'mango-playability*' 'mango-companion*'
```

Scheduled maintenance (local time):

| Time | Timer | Job |
|------|-------|-----|
| 03:00 | `mango-playability-indexer.timer` | Nightly stale → grow → YouTube → proof |
| 06:00 | `mango-companion-nightly.timer` | Companion consolidate (skips if grow lock held) |
| every ~3 min | `mango-watchdog.timer` | Narrow health repair |

---

## Fire/Water ratings and For You

The current branch source contains the profile-aware recommendation
implementation, but this documentation pass supplies no Pi evidence. Do not
record deployment, screenshots, or couch PASS until the exact branch revision
is pulled and observed at home.

Migration 4 creates one WAL-consistent online backup before changing
`/etc/mango/library.db`:

```bash
test -f /etc/mango/library.db.pre-fire-water-v4.bak
curl -fsS http://127.0.0.1:3020/recommendations/state | python3 -m json.tool
curl -fsS http://127.0.0.1:3020/personalization/state | python3 -m json.tool
curl -fsS -X POST http://127.0.0.1:3020/recommendations/refresh \
  -H 'content-type: application/json' -d '{}'
```

Migrations 5–6 add profiles/signals; library migrations 7–11 add attribution,
profile metrics, opaque served slates, profile watch state, and exact served
context. Progress migration 2 adds profile-exact Continue/resume and migrates
legacy unscoped rows only to Household. These migrations do not delete or
recreate ratings, Saved, history, YouTube cache, progress, or recommendation
snapshots. Verify versions non-destructively:

```bash
sqlite3 /etc/mango/library.db \
  "SELECT group_concat(version, ',') FROM (SELECT version FROM library_migrations WHERE version BETWEEN 4 AND 11 ORDER BY version);"
sqlite3 /etc/mango/progress.db \
  "SELECT group_concat(version, ',') FROM (SELECT version FROM progress_migrations ORDER BY version);"
sqlite3 /etc/mango/library.db \
  "SELECT name FROM pragma_table_info('profile_recommendation_served_slates') WHERE name='context_id';"
```

Expected library versions include `4,5,6,7,8,9,10,11`, progress includes `2`,
and the final query returns `context_id`. Profiles have no PIN or startup
chooser. Creating one does not activate it; activation is a separate action and
clears session mood:

```bash
curl -fsS -X POST http://127.0.0.1:3020/personalization/profiles \
  -H 'content-type: application/json' -d '{"action":"create","name":"Couch test"}'
curl -fsS -X POST http://127.0.0.1:3020/personalization/activate \
  -H 'content-type: application/json' -d '{"profile_id":"<profile-id>"}'
curl -fsS -X POST http://127.0.0.1:3020/personalization/mood \
  -H 'content-type: application/json' -d '{"mood":"comfort","ttl_ms":3600000}'
```

Use a disposable named profile only when the human tester approves adding it;
there is deliberately no delete action. Rename keeps the stable profile ID.
Household retains legacy seed/state and blends recommendation/history activity,
but an exact Not-for-me from any profile vetoes that title in Household. Exact
Continue/resume never blends: play the same title to different positions as
Alice and Bob, then verify each profile resumes its own position and a new
profile starts clean. Personal state must never leak between personal profiles.
Switch once through the companion and confirm the TV updates on the immediate
`profile_changed` acknowledgement path; separately leave the TV idle and prove
the 30-second fallback poll converges without a page restart.

Seed manifests are validated and imported on the Pi only after every row has
an explicit approved/excluded disposition and unique stable identity:

```bash
cd ~/mango/src/catalog-service
npm run ratings:seed -- dry-run /path/to/fire-water-seed-v1.json
npm run ratings:seed -- validate /path/to/fire-water-seed-v1.json
MANGO_LIBRARY_DB_PATH=/etc/mango/library.db npm run ratings:seed -- import /path/to/fire-water-seed-v1.json
```

Run import twice; the second result must report `noop: true`. Never copy a Mac
DB to the Pi, clear runtime state, or place raw sheet captions/URLs in the
manifest. `MANGO_FIRE_WATER_RATINGS=0`, `MANGO_FOR_YOU=0`, and
`MANGO_RECOMMENDATIONS_AI=0` are reversible visibility/enrichment rollbacks;
none deletes ratings or last-good snapshots. Ranking uses a worker by default
so CPU-heavy scoring/MMR cannot monopolize catalog HTTP;
`MANGO_RECOMMENDATION_RANK_WORKER=0` is a diagnostic-only opt-out and
`MANGO_RECOMMENDATION_RANK_TIMEOUT_MS` defaults to 30000. A worker failure or
deadline retains the previous complete snapshot.

Before the couch verdict, verify the following without clearing any state:

- Every visible Movies/TV For You rail shows exactly six currently verified
  cards: 4 close, 1 adjacent, and 1 bounded surprise. If reserve healing cannot
  satisfy that contract, the rail is absent rather than partial. Completed
  titles stay absent except for a sparse cooled rewatch.
- Setting/clearing an explicit mood changes only bounded attribution/session
  ranking; switching profiles clears mood. AI or network failure leaves the
  last-good local slate usable.
- Profile Not for me disappears immediately, Undo restores it, and the same
  action neither hides nor changes another personal profile's state.
- YouTube orders For You, Subscriptions, History, Saved before at most three
  adaptive rails; every visible rail has four cards. History and Saved remain
  stable across X. Healthy For You supply yields 28/8/4 over ten slates; if not,
  inspect the honest fallback diagnostic rather than claiming that mix:
  `sqlite3 /etc/mango/youtube.db "SELECT value FROM youtube_state WHERE key='for_you_lane_fallback:last';"`
- Save four distinct YouTube videos: the complete Saved anchor remains stable
  and none of those exact videos appears in For You. After a successful full
  refresh, `sqlite3 /etc/mango/youtube.db "SELECT count(*) FROM youtube_for_you_candidates;"`
  must remain at or below 1000; successful generations replace/prune the shared
  reservoir while preserving retained profile exposure state.
- Record `refresh.search_calls_today` and `refresh.api_calls_today` from
  `/youtube/state`, press X several times, then read them again. Both values must
  be unchanged; X is cache-only.
- Start representative 1080p and known-safe 4K recommendations and run the
  existing playback proof. Recommendation changes must not alter the resolver,
  display-mode, first-frame, progress, or dropped-frame contracts.

Record relevance, adjacent/surprise quality, multilingual fit, Household
fairness, reversibility, and latency as human verdicts. Until those checks run
on the Pi/TV, all of them remain **DEFERRED**.

### Episode says “stream not found”, then later succeeds

A series play must resolve the exact `tt…:season:episode` ID. One automatic VOD
Play now confirms a clean AIOStreams HTTP-200 empty (or proven-transient
error-only result) at most twice after 1.2-second bounded delays inside the same
single flight and absolute deadline. It stops immediately on a playable result,
so the observed empty → empty → playable sequence completes from the first B.
Confirmed 429s, provider HTTP failures/timeouts, cancellation, malformed media,
permanent provider/account errors, and authoritative no-stream results are not
retried. Detail lists, Live, and picker refresh do not inherit the policy. Cache
state is written only after the logical request settles.

On the Pi, capture the exact episode before diagnosing; never probe `:1:1` as a
stand-in and never clear runtime databases/caches:

```bash
cd ~/mango
bash scripts/m4-addons/aiostreams-config.sh diff
bash scripts/m4-addons/aiostreams-config.sh apply
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
An AIO target-policy change is stateful: git deploy alone does not apply it, so
the explicit `diff` → `apply` → `verify` sequence above is mandatory.

---

## Legacy fallback apps

Not started at idle. Opt-in only:

| App | Env |
|-----|-----|
| Stremio desktop | `MANGO_FALLBACK_STREMIO=1` |
| Legacy Kodi YouTube | `MANGO_LEGACY_YOUTUBE=1` |

Fallback apps are not part of normal gate-lite; use them only when explicitly diagnosing a native playback gap.

---

## Scripts index

[../scripts/README.md](../scripts/README.md)
