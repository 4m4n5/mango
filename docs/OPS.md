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
| X (`307`) | Shuffle rail |
| − / + (`314` / `315`) | Volume down / up |
| L/R (`310`/`311`) | Tab − / + |
| ⌂ (`316`) | Home |

### Pad + Chromium tuning (D-pad latency)

D-pad browse latency was tuned in three tiers (A: pad hot path, B: periodic-lag
fix, C: GPU rasterization + pad-nav API). Relevant env vars:

| Env var | Default | Effect |
|---------|---------|--------|
| `MANGO_PAD_DPAD_DEBOUNCE_SEC` | `0.05` | D-pad debounce (vs `0.12` for face buttons) |
| `MANGO_PAD_LAUNCHER_WID_TTL_SEC` | `2.0` | Cache TTL for launcher window-id lookup |
| `MANGO_PAD_FOREGROUND_LAUNCHER_TTL_SEC` | `2.0` | Cache TTL for "foreground is launcher" |
| `MANGO_PAD_COUCH_ACTIVITY_THROTTLE_SEC` | `0.5` | Throttle for async couch-activity touches |
| `MANGO_PAD_NAV_API` | `0` | `1` = pad POSTs nav to `/api/pad/nav` instead of xdotool keys (xdotool fallback on any HTTP failure) |
| `MANGO_PAD_NAV_TIMEOUT_SEC` | `0.15` | HTTP timeout for pad-nav POST before fallback |
| `MANGO_CHROMIUM_DISABLE_GPU` | `0` | `1` = force software compositing (rollback for GPU rasterization regressions) |

To enable the pad-nav API on the Pi, set `MANGO_PAD_NAV_API=1` in the pad
service environment (`scripts/m1-foundation/ui/systemd/mango-tv-pad.service` or
the stack env) and restart the pad. The `gate-m6-ux-smoke.sh` pad-nav probe runs
only when this is `1`. Verify Chromium GPU rasterization on the Pi via
`chrome://gpu` (launch Chromium briefly with `--remote-debugging-port=9222` and
open the URL from a host browser); "Hardware accelerated" should appear under
Rasterization.

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

When couch mode starts, Mango disables X11 DPMS/screensaver blanking. Controller
input also runs the display wake helper, throttled to a few seconds:

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

**Playback HDMI + OSD contract:** `mpv-play.sh` hides the launcher, suppresses
desktop chrome (including pcmanfm wallpaper), paints the X root black, then
source-matches HDMI before first reveal when the video profile is known. Never
match while Chromium is still mapped. The playback OSD and pad never call
`playback-auto` / display-ensure during steady play (operator-only:
`MANGO_PLAYBACK_DISPLAY_ENSURE=1`). OSD defaults to 4s visible, scales to a
constant physical size (1080p reference), redraws ~1 Hz, and TTL-caches meta
IPC. Pad **↑** is the sole subtitle control (show-first, then force-on + cycle);
**A** is show-first for audio. During a 4K play, prove HDMI + decode path with:

```bash
bash scripts/diag/playback-4k-proof.sh
# or: bash scripts/diag/playback-4k-proof.sh --watch
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
| Pad waiting | `pad-health: waiting for controller` means Mango is alive and polling indefinitely; turn on / press any button on the Micro |
| Pad dead | `bash scripts/m1-foundation/pad/pad-health.sh --repair` · reboot pad in Pro Controller mode if no event appears after wake |
| Voice HUD missing | `MANGO_VOICE=1` in env · `bash scripts/m5-voice/stack/verify-voice-ready.sh` |
| YouTube tab empty | `curl localhost:3020/youtube/state` · configure `/etc/mango/youtube-api.key` · run `bash scripts/m6-ship/gate-m6-youtube-smoke.sh` |
| YouTube account not connected | Companion → YouTube connect · verify `/etc/mango/youtube-oauth-client.json` and `/etc/mango/youtube-auth.json` permissions |
| YouTube playback 403/429/CAPTCHA | Update `yt-dlp`; reconnect account/cookies; pick another video; metadata cache should remain visible |
| YouTube recommendations stale | Full refresh: `bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly`; YouTube-only: `bash scripts/m6-ship/youtube-refresh-cache.sh --reason operator`; then inspect `curl localhost:3020/youtube/state` and `refresh.phase_results` |
| YouTube Live Now partial error | Check `refresh.phase_results.live_now`; Search Queries quota can exhaust while cached VOD rails and Popular still work because Popular uses `videos.list` |
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
