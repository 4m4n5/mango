# Troubleshooting

Start here when the box misbehaves. Do not delete databases, rewrite
credentials, rsync the repo, or enter controller pairing mode unless a
named diagnostic says the bond is gone.

## First readback

On the Pi:

```bash
cd ~/mango
git rev-parse HEAD
git status --short
bash scripts/mango-stack.sh status
bash scripts/pi-pre-couch-gate.sh
```

On the workstation, confirm you are on `main` and that the Pi SHA matches
the revision you intended. Current recorded proof: [STATUS.md](STATUS.md).

## Common failures

| Symptom | First check | Do not |
|---------|-------------|--------|
| No pad input | BlueZ link supervisor vs evdev router; press a button after power-on | Pairing mode, stack wipe |
| Connected in Bluetooth, no focus | Current `Pro Controller` event node; `pad-health` | Unpair “to refresh” |
| Black screen after Play | Playback generation; launcher should remain until mpv advances | Restart mid-probe |
| Empty Detail streams | Addon credentials and AIOStreams health; household entitlements | Paste signed URLs into issues |
| Stale YouTube rails | OAuth token and `youtube-refresh-cache.sh` | Re-import Takeout as a first fix |
| Deploy refused | Branch is `main`, fetch succeeded, tree is clean, AIOMetadata opt-in | `rsync`, force-push |
| Accidental 10-minute blank | Transitional Xorg DPMS | Treat it as finished sleep |
| For You missing | Sparse ratings → labelled Top Picks is correct | Force a false For You |
| Nightly / grow deferred | Couch activity marker; wait for idle | Kill playability.db |
| Voice / librarian silent | `voice.env`, companion TLS, trusted LAN | Expose `/stream` |

Logs: `$HOME/.cache/mango/catalog-service.log`, `orchestrator.log`,
`mpv-play.log`. Never paste secrets, OAuth tokens, or signed URLs.

## Conservative repair

Safe:

```bash
bash scripts/mango-stack.sh restart
bash scripts/m1-foundation/pad/controller-link-diagnose.sh
```

Unsafe unless you have a backup and an explicit reason:

- deleting `/etc/mango/*.db`
- rewriting AIOStreams `userData`
- `git reset --hard` on the Pi
- copying a Mac `.venv` onto the device

Backup before migrations: `scripts/m6-ship/backup-library-state.sh`.

## Getting help

- Setup and bugs: GitHub issues — no secrets
- Security: [../SECURITY.md](../SECURITY.md)
- Support policy: [../SUPPORT.md](../SUPPORT.md)
