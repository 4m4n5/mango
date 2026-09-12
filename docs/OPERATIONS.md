# Operations

Git-only deploy and Pi operations. Current SHA and proof live in
[STATUS.md](STATUS.md).

## Hosts

| Role | Value |
|------|-------|
| SSH alias | `mango` primary, `mango-mdns` / `mango.local` fallback |
| Repo | `$HOME/mango` |
| Branch | `feat/native-experience` |

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

`pi-deploy.sh` and `pi-exec-gate.sh` fail closed: they require `feat/native-experience`, a
successful `git fetch`, matching expected SHAs, and a clean tree unless
`MANGO_DEPLOY_ALLOW_DIRTY=1`. AIOMetadata rail sync is off unless
`MANGO_SYNC_AIOMETADATA=1`.

```bash
# Workstation after push
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
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
3. Commit when asked, then `git push origin feat/native-experience`.
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

Shell maintenance reports keep full detail in `~/.cache/mango/ops/reports/`.
The append-only `events.jsonl` ledger retains its 1 MB per-event limit. Oversized
events contain a bounded summary and a reference to the full, atomically written
report; the report must exist before that reference is appended. Report size
must not prevent an otherwise valid staged grow from reaching publication.

## Backup

Use `scripts/m6-ship/backup-library-state.sh` before schema work. Runtime
DBs, AIOStreams `userData`, and YouTube OAuth stay on the device.

## One-night recovery window

`scripts/m3-play/playability/overnight-recovery.py` runs bounded, coordinated
stale-reverification and discovery passes with an operator-specified absolute
admission cutoff and finish target. Use explicit timezone-offset datetimes for
`--admission-stop-at` and `--finish-at`; inspect `--dry-run` before launching it
as a detached `systemd-run --user` service. Keep the Pi and network powered.

The default allocation is 80% stale recovery by elapsed pass time. Required
short verification probes remain enabled; playback gates, source benchmarks,
and YouTube refresh are disabled. Existing identity rules and retry queues
remain authoritative. The supervisor temporarily guards competing scheduled
services while leaving their persistent timers active, avoiding morning
catch-up. Runtime guards expire by clock even if the supervisor fails.

Receipts live under `~/.cache/mango/ops/overnight-recovery-*.json`, alongside
the existing per-pass maintenance receipts. Treat startup, verified-title yield,
safe publication, and terminal completion as separate evidence. The finish
time is a graceful target, not permission to kill SQLite publication; a stalled
publication can exceed it and requires operator inspection.

## Expiry-only visibility recovery

`scripts/m6-ship/restore-expiry-only-visibility.py` defaults to a read-only
comparison of `--database` and a preserved pre-sweep `--baseline`. It admits only
unchanged prior verification with one later expiry sweep, no intervening attempt,
no conflicting retry evidence, and no episode-as-show or dual-type identity.
It tags `expired_stale`; it never renews verification timestamps or restores a
whole database. Ordinary failures must pass reverification instead.

Deploy the visibility-aware schema first. Review the dry-run count and digest,
stop catalog/worker/watchdog for the apply window, then pass `--apply`, that
`--expected-count` and `--expected-digest`, a new `--rollback-snapshot` path,
and the stable `--maintenance-lock` path. The tool holds the lock and applies
transactionally after creating and checking its private rollback snapshot.
Always restore services afterwards, refresh recommendation publications, and
verify fresh counts separately from visible last-known-good counts.
