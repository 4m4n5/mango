# Operations

Git-only deploy and Pi operations. Current SHA and proof live in
[STATUS.md](STATUS.md).

## Hosts

| Role | Value |
|------|-------|
| SSH alias | `mango` primary, `mango-mdns` / `mango.local` fallback |
| Repo | `$HOME/mango` |
| Branch | `main` |

Numeric LAN addresses are not durable truth. Set `MANGO_PI_HOST` and
`MANGO_PI_USER` on the workstation.

## Forbidden

| Never | Why |
|-------|-----|
| `rsync` / `scp` / tar the repo to the Pi | Breaks git identity and venvs |
| `git reset --hard` on the Pi without approval | Destroys device-only edits |
| Commit secrets or runtime DBs | They belong in `/etc/mango` |
| Delete DBs, caches, or credentials as recovery | Repair is conservative |

## Deploy wrappers

`pi-deploy.sh` and `pi-exec-gate.sh` fail closed: they require `main`, a
successful `git fetch`, matching expected SHAs, and a clean tree unless
`MANGO_DEPLOY_ALLOW_DIRTY=1`. AIOMetadata rail sync is off unless
`MANGO_SYNC_AIOMETADATA=1`.

```bash
# Workstation after push
git fetch origin main
test "$(git branch --show-current)" = main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
bash scripts/pi-deploy.sh --fast
```

`--fast` is the diagnose/fix loop. Use `--full` when lockfiles change. Confirm
the Pi read-back SHA before any gate.

If this workstation cannot SSH to the Pi, push from here and deploy from a
machine on the Pi LAN. Do not invent a second copy method.

## Stack

```bash
cd ~/mango
git rev-parse HEAD
git status --short
bash scripts/mango-stack.sh status
bash scripts/mango-stack.sh restart   # stops playback
bash scripts/pi-pre-couch-gate.sh
```

Do not add `git pull` to a restart shortcut. A source update also requires
catalog-service, launcher, and companion builds.

## Daily loop

1. Diagnose on the Pi (`pi-exec.sh`, logs, gates).
2. Fix on the workstation. Run local tests for the touched package.
3. Commit when asked, then `git push origin main`.
4. Deploy with `pi-deploy.sh --fast`.
5. Verify gates against the read-back SHA. Mac tests are not Pi proof.

## Troubleshooting

| Symptom | First check |
|---------|-------------|
| No pad input | BlueZ link supervisor vs evdev router separately; ordinary power-on, not pairing |
| Black screen after Play | Playback generation ownership; launcher should remain until mpv advances |
| Stale YouTube rails | OAuth token and `youtube-refresh-cache.sh`; see [features/youtube.md](features/youtube.md) |
| Deploy refused | Branch, fetch, dirty tree, or AIOMetadata opt-in |
| Accidental 10-minute blank | Transitional Xorg DPMS; intentional sleep is not implemented |

Logs: `$HOME/.cache/mango/catalog-service.log`, `orchestrator.log`,
`mpv-play.log`. Never paste secrets or signed URLs.

## Backup

Use `scripts/m6-ship/backup-library-state.sh` before schema work. Runtime
DBs, AIOStreams `userData`, and YouTube OAuth stay on the device.
