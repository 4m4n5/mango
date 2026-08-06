# Pi deploy runbook (git only)

**Binding for agents and humans.** Mac is source of truth. The Pi is a **git clone** — never a rsync target.

| | |
|--|--|
| **Host** | SSH alias `mango` primary; `MANGO_SSH_HOST=mango-mdns` fallback via `mango.local` (numeric LAN addresses are not durable truth) |
| **Repo** | `~/mango` · [github.com/4m4n5/mango](https://github.com/4m4n5/mango) |
| **Branch** | `feat/native-experience` (native stack) |
| **Split machine** | Work Mac: push only · Home Mac (Pi LAN): deploy — [`DEPLOY-SPLIT-MACHINE.md`](DEPLOY-SPLIT-MACHINE.md) |

---

## Forbidden

| Never | Why |
|-------|-----|
| `rsync` repo tree to Pi | Breaks git state; host-mismatched venvs (orchestrator `.venv` shebangs) |
| `scp` / hand-copy `src/`, `scripts/`, `config/` | Same — bypasses version control |
| `tar` deploy of working tree | Unreviewable drift on Pi |
| `git reset --hard` on Pi without user approval | Destroys intentional Pi-only edits |
| Commit secrets | `/etc/mango/*`, `keys/`, `.env` stay on device |

**Stateful exception:** an explicitly reviewed installer may copy a repository
**example/template** into `/etc/mango/`, after which the device-owned file is
operator state. Secrets, export URLs, credentials, seeds, AIOStreams `userData`,
and runtime databases are never copied from a work tree as deployment.

---

## Agent loop (diagnose → fix → deploy → verify)

> **Unattended-deploy blocker at the audited source revision.**
> `pi-deploy.sh` and `pi-exec-gate.sh` do not enforce
> `feat/native-experience`: both derive a branch from the Mac checkout and pull
> that branch unpinned. `pi-deploy.sh` also ignores a local fetch failure and
> unconditionally runs `sync-aiometadata-rail-catalogs.sh || true`; when the Pi
> has a running AIOMetadata service and private import, that step may POST new
> configuration, rewrite its credential/export files, print the secret install
> URL, and leave `/tmp/aiometadata-save.json`. A local
> `MANGO_SKIP_AIOMETADATA_SYNC=1` is not forwarded into the remote step. Until
> the scripts default-skip/require explicit opt-in, use private secure temp files
> with redacted output, fail closed on fetch/branch/SHA, and have regression
> coverage, **agents must not invoke either wrapper unattended**. A human-reviewed
> exception must explicitly accept the state mutation and complete every hash
> check below; otherwise fix the helpers before deploying.

### 1. Diagnose the Pi (run from the home Mac)

`pi-exec.sh` and `pi-exec-gate.sh` are Mac-side SSH wrappers. Do not try to run
them from inside the Pi checkout.

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse --short HEAD && bash scripts/mango-stack.sh status'
bash scripts/pi-exec.sh 'cd ~/mango && git status --short'
# logs:
bash scripts/pi-exec.sh 'tail -40 ~/.cache/mango/orchestrator.log'
bash scripts/pi-exec.sh 'tail -40 ~/.cache/mango/catalog-service.log'
```

### 2. Fix (Mac)

Edit in `~/Documents/personal/projects/mango`. Run local checks:

```bash
cd src/catalog-service && npm run test    # when touching catalog-service
```

### 3. Commit + push (Mac)

Only when the user asks (or deploy task includes ship). Never push secrets.

```bash
bash scripts/lib/pi-sync-check.sh path/to/changed/files…   # optional pre-push
git push origin feat/native-experience

git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
```

### 4. Pull + build + restart (Pi)

The intended post-hardening flow uses **`--fast`** for diagnose/fix loops and
**`--full`** when a lockfile changes. The current wrapper is blocked for
unattended agents by the warning above. The following commands are retained as
the **human-reviewed exception / future post-hardening interface**, not an agent
authorization.

**Hard preconditions:** the couch is idle, no mpv playback is active, the
intended SHA is pushed, and Pi dirty state has been inventoried/preserved.
`pi-deploy.sh` restarts the stack and can stop mpv/indexers; it does not prove
that every Pi-only edit is safe to overwrite, does not pin the requested commit,
and currently may mutate AIOMetadata state.

From Mac:

```bash
bash scripts/pi-deploy.sh --fast           # default — skip npm ci when lock unchanged
bash scripts/pi-deploy.sh --fast --gate   # fast + pre-couch gate
bash scripts/pi-deploy.sh --full          # always npm ci (deps / first boot)
bash scripts/pi-deploy.sh --full --gate   # full + gate (release handoff)
```

If the primary `mango` alias times out but mDNS resolves the Pi, validate the
fallback alias first. Do not use that as a reason to bypass the deploy blocker:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse --short HEAD'
```

The fallback alias should resolve `mango.local` as user `aman` with the Mango
SSH key. It is a transport fallback only; it does not change the deploy rule:
commit/push on Mac, `git pull` on Pi, never `rsync`/`scp` repo files.

Fast path uses `scripts/lib/pi-npm-deps.sh` (SHA-256 of each `package-lock.json` under `~/.cache/mango/`).

The following are **non-addon-mutation build/restart diagnostics for an already selected exact
Pi revision**, not equivalent deployment paths. They intentionally omit the
repository-owned config sync, addon export checks, systemd installation,
`yt-dlp` maintenance, and playback-aware launcher restart performed by
`pi-deploy.sh`. Until the wrapper blocker is fixed, select and read back the Pi
revision through a separately reviewed Git-only step, then use these only as an
explicit manual recovery path; do not silently claim parity with a full deploy.

Manual dependency-aware rebuild:

```bash
cd ~/mango
git rev-parse HEAD
bash scripts/lib/pi-npm-deps.sh build src/catalog-service
bash scripts/lib/pi-npm-deps.sh build src/launcher
bash scripts/lib/pi-npm-deps.sh build src/companion
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

Manual clean dependency rebuild:

```bash
cd ~/mango
git rev-parse HEAD
npm --prefix src/catalog-service ci && npm --prefix src/catalog-service run build
npm --prefix src/launcher ci && npm --prefix src/launcher run build
npm --prefix src/companion ci && npm --prefix src/companion run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
# voice (MANGO_VOICE=1 in ~/.config/mango/voice.env):
bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh
bash scripts/m5-voice/stack/start-voice-stack.sh
```

### 5. Verify (Pi)

Before gates, compare all three identities. The wrapper's preflight alone is not
exact-SHA proof because its fetch may fail open and its Pi pull is branch-based:

```bash
git fetch origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
expected="$(git rev-parse origin/feat/native-experience)"
test "$(git rev-parse HEAD)" = "$expected"
bash scripts/pi-exec.sh 'cd ~/mango && test "$(git branch --show-current)" = feat/native-experience && git rev-parse HEAD'
# Visually/explicitly compare the Pi hash to $expected before continuing.
```

```bash
bash scripts/pi-pre-couch-gate.sh
bash scripts/m4-addons/gate-m4-self-hosted.sh   # when MANGO_SELF_HOSTED_ADDONS=1
bash scripts/m3-play/playability/gate-m3-verified-rails.sh
bash scripts/m5-voice/stack/verify-voice-ready.sh      # when MANGO_VOICE=1
bash scripts/m6-ship/gate-m6-youtube-smoke.sh          # after YouTube/API/launcher rail changes
bash scripts/m6-ship/gate-m6-search-smoke.sh           # after unified Search/API/input changes
bash scripts/m6-ship/gate-m6-reliability-proof.sh      # final couch-readiness proof
```

**Do not hand off** after Mac-only tests. Gates must pass **on the Pi**.

---

## Pi dirty tree

If `git pull --ff-only` fails on Pi:

1. Run `git status --short` and `git diff --stat` on the Pi; record every path.
2. Classify each change as operator-owned state, intentional source work, or
   known stale deploy debris. Preserve it and stop for direction when uncertain.
3. Only an explicit user-approved recovery may stash or reset a precise known
   source change. Never use those as the default deploy fix.
4. **Never** rsync to “fix” — commit source on Mac, push, pull on Pi.

---

## What not to rsync (even if tempted)

| Path | Instead |
|------|---------|
| `src/orchestrator/.venv` | `bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh` on Pi |
| `src/catalog-service/node_modules` | `npm ci` on Pi after pull |
| `src/launcher/node_modules` | `npm ci` on Pi after pull |
| Whole `~/mango` | `git pull` |
| AIOStreams `userData` | Preserve; current `diff/apply` helper is blocked for agents because it exposes sensitive state and leaves a fixed `/tmp` response; use human Configure UI plus fixed-field `verify` until hardened |
| AIOMetadata import/config/export | Preserve; direct mutation and the implicit deploy sync are blocked for unattended agents because they may rewrite private state, print a secret URL, leave fixed `/tmp` output, and mask failure |
| `/etc/mango/*.db`, `~/.cache/mango/*`, history | Preserve in place; use documented migrations/diagnostics |
| API/OAuth/debrid/cookie files | Provision locally through their operator workflow; never copy from Git |

YouTube playback resolver: `bash scripts/m6-ship/ensure-youtube-yt-dlp.sh`
installs/updates an isolated user venv under `~/.local/share/mango/ytdlp-venv`.
This is allowed operator-owned runtime state; do not commit or copy it.

---

## Quick reference

| Action | Command |
|--------|---------|
| Mac → Pi command | `bash scripts/pi-exec.sh '…'` |
| Mac deploy | Current wrapper blocked for unattended agents; see blocker and reviewed manual path above |
| Pi gate | Run `pi-pre-couch-gate.sh` on the already selected/read-back exact Pi SHA |
| Pre-push check | `bash scripts/lib/pi-sync-check.sh <paths>` |

See also: [`../AGENTS.md`](../AGENTS.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md)

Live IPTV: [`LIVE_TV.md`](LIVE_TV.md) — gates opt-in only.

Recommendation rollout is deployed at executable target
`a60d1c0c25d2bbe3b2cc1cd7704da20325039630`, which retains bounded/reusable VOD
refresh work, v17 checkpoints and priors, couch preemption, liveness-safe
repair, guarded 1280M/1536M defaults, cyclic cached VOD shuffle, and YouTube
v2.4 account/subscription/metadata/portfolio improvements plus cached History
serving and a rolling 30-day exact-video rewatch cooldown. The
Pi currently serves both domains with provider work off, preserved data,
complete accounting, preserved state, and cached latency proof. The
deploy/gate wrappers are
still blocked by the independent exact-SHA and implicit AIOMetadata issues
above, so future agents must use the reviewed manual target path in
[tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md](tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md).
Before any future re-promotion from `shadow` to `serve`, re-prove
explicit fail-closed SQLite online backups for both library and playability
state (the routine helper's plain-copy fallback is insufficient), two complete
Movies+TV cycles under the documented invocation/cgroup/RSS/pressure gates,
complete profile/corpus accounting, active/previous serving pointers, offline
evaluation, couch preemption, cached serving latency, mode/code rollback, and
frontier-off behavior, then run
the TV checks in
[FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md). A seed manifest is an optional,
idempotent way to bootstrap explicit ratings; when one is supplied, dry-run,
validate, import, and re-import it. A populated seed manifest is private
household taste input, not a deployable repository artifact: never commit it or
copy a runtime database. Import only from a Pi-local file provisioned through a
separately authorized private-state workflow; this Git deploy runbook does not
define or imply that transfer authority.
