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

1. TV shows **mango launcher** (Movies / Series / Live tabs)
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

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Desktop wallpaper after ⌂ | `bash scripts/launch-launcher.sh` · see [ARCHITECTURE.md](ARCHITECTURE.md) foreground |
| Pad dead | `pgrep -af mango-tv-pad` · reboot pad (Pro Controller mode) |
| Voice HUD missing | `MANGO_VOICE=1` in env · `bash scripts/m5-voice/stack/verify-voice-ready.sh` |
| Empty rails | `curl localhost:3020/health` · playability status script |
| Grow seems hung | `python3 scripts/diag/grow_monitor.py status --verbose` · inspect stage/source before killing |
| Orphans or overlap drift | `rail-pool-retheme.sh dry-run --orphans-only` or `--overlap-only`; see [PLAYABILITY.md](PLAYABILITY.md) |
| Chromium duplicate | `bash scripts/mango-kill-strays.sh` |

Logs: `~/.cache/mango/mango.log` · `journalctl --user -u mango-stack` (if systemd)

Grow operator state: `~/.cache/mango/grow-run-state.json`, `~/.cache/mango/ops/refresh-*.json`, `~/.cache/mango/source-grow/latest.json`.

---

## Legacy fallback apps

Not started at idle. Opt-in only:

| App | Env |
|-----|-----|
| Stremio desktop | `MANGO_FALLBACK_STREMIO=1` |
| Kodi YouTube | `MANGO_LEGACY_YOUTUBE=1` |

Fallback apps are not part of normal gate-lite; use them only when explicitly diagnosing a native playback gap.

---

## Scripts index

[../scripts/README.md](../scripts/README.md)
