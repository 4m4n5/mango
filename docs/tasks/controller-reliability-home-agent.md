# Home-agent runbook: Mango controller reliability

> **Historical template — not a current deploy contract.** Its placeholder SHA
> and wrapper commands must not be executed. The audited deploy helpers are
> blocked for unattended use; reconcile with [`../DEPLOY.md`](../DEPLOY.md),
> [`../STATUS.md`](../STATUS.md), and the current controller section in
> [`../COUCH_TEST.md`](../COUCH_TEST.md).

## Mission

You are the Pi-side deployment and validation agent. A separate coding agent
implemented this change but cannot access the home network. Deploy the exact
pushed commit by git only, install its Bluetooth policy, run the gates, perform
the physical tests with the user, and return measured evidence.

**Target commit:** `<REPLACE_WITH_PUSHED_SHORT_SHA>`

Success means normal 8BitDo Micro power-on reconnects silently, controller-off
is a healthy wait state, and reconnect does not interrupt launcher or playback.

## Hard rules

- Work only on `feat/native-experience`; verify with `git branch --show-current`. Do not switch branches.
- Deploy by git only. Never `rsync`, `scp`, hand-copy source files, or edit Mango repo files on the Pi.
- Never unpair, remove, or re-pair the Micro automatically. Pairing mode is explicit recovery only after diagnostics prove pairing is absent.
- Do not install, restart Bluetooth, or repair while playback or active couch use is present.
- Do not reset, clean, stash, or discard a dirty Pi worktree. Report `git status --short` and stop.
- Do not claim a check, timing, or couch test passed unless you ran it and retained the output.
- If code needs adjustment, change the home-Mac clone, test it, commit/push only when authorized, then redeploy through git. Never patch source on the Pi.

## Architecture

| Owner | Responsibility | Must not do |
|---|---|---|
| `mango-controller-link.service` | Root BlueZ connection supervisor | Read evdev or route input |
| `mango-tv-pad.service` | Root evdev router | Call `bluetoothctl`, pair, trust, or connect |
| Reliability Center | Read status; request safe repair while idle | Restart playback or alter pairing |

The supervisor uses a short retry burst after link loss, then a five-second
maintenance probe while the controller is off. Ordinary off-controller retries
never restart Bluetooth. Only adapter/daemon fault evidence can trigger one
rate-limited Bluetooth repair.

## Preflight

Run on the home Mac:

```bash
cd ~/Documents/personal/projects/mango
git fetch origin feat/native-experience
git branch --show-current
git pull --ff-only origin feat/native-experience
git rev-parse --short HEAD
git status --short
bash scripts/pi-exec.sh 'hostname; cd ~/mango; git branch --show-current; git rev-parse --short HEAD; git status --short'
```

Expected: home Mac at the target commit, home worktree clean, and SSH working.
A dirty Pi worktree is a stop condition. Ask the user to stop playback, leave
Mango idle, and turn the Micro off before the install window:

```bash
bash scripts/pi-exec.sh 'cat ~/.cache/mango/couch-activity.json 2>/dev/null || true; test ! -e ~/.cache/mango/playback-active'
```

## Deploy and install

This flag pulls the commit, applies controller installation before Mango’s
restart, builds the apps, and runs the normal deploy gate. It restarts Bluetooth
once.

```bash
cd ~/Documents/personal/projects/mango
MANGO_CONTROLLER_LINK_INSTALL=1 bash scripts/pi-deploy.sh --fast --gate
```

If it fails, capture output. Do not hand-edit Pi source. Run:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --check'
```

The installer must preserve `Paired: yes`, `Bonded: yes`, `Trusted: yes`,
`Blocked: no`, and `WakeAllowed: yes`. It may remove only a udev rule referencing
`scripts/phase0/on-pro-controller-connect.sh`.

## Automated Pi proof

With the Micro still off, run:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh'
bash scripts/pi-exec.sh 'cd ~/mango && curl -sf http://127.0.0.1:3020/reliability/controller | python3 -m json.tool'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m1-foundation/pad/controller-link-diagnose.sh'
bash scripts/pi-exec-gate.sh
```

`maintenance_retry`, `fast_retry`, and `connecting` are healthy while off.
`needs_repair`, stale status, duplicate owners, an orphan `bluetoothctl connect`,
or a Phase 0 udev hook are failures.

## Physical couch proof

Run five normal off/on cycles. Do not use pairing mode:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m1-foundation/pad/controller-link-couch-test.sh'
```

Record every millisecond result. Target median is under 3,000 ms. Verify one
cycle navigates the launcher and one cycle reconnects during active playback:
the title continues, `Y` still works, and launcher state/focus remains intact.
There must be no launcher refresh, wallpaper flash, toast, or full-stack restart.

Then run:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
```

## Failures and tuning

| Symptom | Required next action |
|---|---|
| Status missing | Run `controller-link-diagnose.sh`; verify service and Python D-Bus dependencies. |
| `needs_repair` | Ensure idle; use Settings → Reliability Center → Repair controller once; collect diagnostics. |
| Pairing fields missing | Stop. Do not auto-pair. Ask the operator for explicit pairing recovery. |
| Reconnect over 3 s | Capture five timings and diagnostics before any tuning. |
| Launcher/playback reset | Stop. Capture logs and report a regression. |
| Git pull blocked | Stop and report Pi `git status --short`. |

For evidence-backed cadence tuning only, use a systemd drop-in outside the repo,
then repeat all five cycles and gates:

```bash
sudo systemctl edit mango-controller-link.service
# Add only if needed:
# Environment=MANGO_CONTROLLER_FAST_RETRY_DELAYS_SEC=0,0.5,1,2,4
# Environment=MANGO_CONTROLLER_MAINTENANCE_RETRY_SEC=3
sudo systemctl daemon-reload
sudo systemctl restart mango-controller-link.service
```

Never set maintenance below one second or add a second reconnect process.

## Rollback

Use only with operator approval. It restores the pre-install BlueZ file only if
unchanged since installation, disables the Mango link service, and preserves
pairing.

```bash
bash scripts/pi-exec.sh 'cd ~/mango && sudo bash scripts/m1-foundation/pad/install-controller-reliability.sh --rollback'
```

## Required report

Return the home-Mac and Pi commit, worktree status, installer/deploy result,
controller gate, standard gate, Reliability proof, all five timings and median,
launcher/playback observations, any drop-in contents, and every failed/deferred
step with exact output. Do not call the feature shipped until all proof passes.
