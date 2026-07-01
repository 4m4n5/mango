# mango — Pi operations

**Pi:** `aman@10.0.0.174` · SSH `mango` · `~/mango` · **Branch:** `feat/native-experience`

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

If LAN DNS/IPv4 is down, set `MANGO_SSH_HOST` for the wrapper instead of copying files by hand:

```bash
MANGO_SSH_HOST='aman@<pi-address>' bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'
```

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
| L/R (`310`/`311`) | Tab − / + |
| ↻ (`317`) | Shuffle rail |
| ⌂ (`316`) | Home |

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
stays in `/etc/mango/catalog-filters.json` and the mpv profile.

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
| Pad waiting | `pad-health: waiting for controller` means Mango is alive and polling; turn on / press any button on the Micro |
| Pad dead | `bash scripts/m1-foundation/pad/pad-health.sh --repair` · reboot pad in Pro Controller mode if no event appears after wake |
| Voice HUD missing | `MANGO_VOICE=1` in env · `bash scripts/m5-voice/stack/verify-voice-ready.sh` |
| YouTube tab empty | `curl localhost:3020/youtube/state` · configure `/etc/mango/youtube-api.key` · run `bash scripts/m6-ship/gate-m6-youtube-smoke.sh` |
| YouTube account not connected | Companion → YouTube connect · verify `/etc/mango/youtube-oauth-client.json` and `/etc/mango/youtube-auth.json` permissions |
| YouTube playback 403/429/CAPTCHA | Update `yt-dlp`; reconnect account/cookies; pick another video; metadata cache should remain visible |
| YouTube recommendations stale | Full refresh: `bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly`; YouTube-only: `bash scripts/m6-ship/youtube-refresh-cache.sh --reason operator`; then check `curl localhost:3020/youtube/state` |
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

Playability timers do not run a couch-disruptive `OnBootSec` catch-up by
default. After a reboot, use the explicit operator catch-up only when the couch
is idle:

```bash
bash scripts/m3-play/playability/playability-catch-up.sh nightly
systemctl --user list-timers 'mango-playability*'
```

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
