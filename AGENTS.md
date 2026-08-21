# mango — agent entry

**Branch:** `feat/native-experience`. Current deployed evidence: [docs/STATUS.md](docs/STATUS.md).
Do not copy SHA, generation, or “Pi serves” claims into other files.

## Read first

| Doc | Use |
|-----|-----|
| [docs/README.md](docs/README.md) | Doc index and evidence levels |
| [docs/PRODUCT.md](docs/PRODUCT.md) | Promise and non-goals |
| [docs/STATUS.md](docs/STATUS.md) | Implemented vs proven |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Processes and ownership |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Git-only deploy |
| [docs/TESTING.md](docs/TESTING.md) | Gates and couch checklist |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Locked choices |

## Invariants

- Git-only Pi updates. Never rsync, scp, or hand-copy repo files.
- `pi-deploy.sh` / `pi-exec-gate.sh` require `feat/native-experience`, fetch, SHA match, and a
  clean tree unless `MANGO_DEPLOY_ALLOW_DIRTY=1`.
- AIOMetadata sync is off unless `MANGO_SYNC_AIOMETADATA=1`.
- mpv is the only daily player. Overlay Chromium and Tk OSD are retired.
- Pad map is locked: **B**=`304` select · **Y**=`308` back · **X**=`307`
  secondary · **−/+**=`314`/`315` volume · **L/R**=`310`/`311` tabs ·
  **⌂**=`316` home. Do not change without user approval.
- Source, local tests, Pi gates, and couch observation are different evidence.

## Loop

1. Diagnose on the Pi.
2. Fix on the workstation; run the touched package tests.
3. Commit only when asked; push `feat/native-experience`.
4. Deploy with `bash scripts/pi-deploy.sh --fast`.
5. Gate the read-back SHA. Never hand off after Mac-only checks.

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
bash scripts/pi-deploy.sh --fast
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/pi-pre-couch-gate.sh'
```
