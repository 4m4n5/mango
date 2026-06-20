# Pi deploy runbook (git only)

**Binding for agents and humans.** Mac is source of truth. The Pi is a **git clone** — never a rsync target.

| | |
|--|--|
| **Host** | SSH `mango` → `aman@10.0.0.174` |
| **Repo** | `~/mango` · [github.com/4m4n5/mango](https://github.com/4m4n5/mango) |
| **Branch** | `feat/native-experience` (native stack) |

---

## Forbidden

| Never | Why |
|-------|-----|
| `rsync` repo tree to Pi | Breaks git state; host-mismatched venvs (orchestrator `.venv` shebangs) |
| `scp` / hand-copy `src/`, `scripts/`, `config/` | Same — bypasses version control |
| `tar` deploy of working tree | Unreviewable drift on Pi |
| `git reset --hard` on Pi without user approval | Destroys intentional Pi-only edits |
| Commit secrets | `/etc/mango/*`, `keys/`, `.env` stay on device |

**Allowed outside git:** `sudo cp` repo **examples** → `/etc/mango/` (secrets, export URLs). AIOStreams credentials in `~/.config/mango/`.

---

## Agent loop (diagnose → fix → deploy → verify)

### 1. Diagnose (Pi)

```bash
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse --short HEAD && bash scripts/mango-stack.sh status'
bash scripts/pi-exec-gate.sh    # or phase-specific gates
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
```

### 4. Pull + build + restart (Pi)

**Agents:** use **`--fast`** for diagnose/fix loops (~30–45s). Use **`--full`** when `package-lock.json` changes or native deps misbehave. Use **`--gate`** before couch handoff.

From Mac:

```bash
bash scripts/pi-deploy.sh --fast           # default — skip npm ci when lock unchanged
bash scripts/pi-deploy.sh --fast --gate   # fast + pre-couch gate
bash scripts/pi-deploy.sh --full          # always npm ci (deps / first boot)
bash scripts/pi-deploy.sh --full --gate   # full + gate (release handoff)
```

Fast path uses `scripts/lib/pi-npm-deps.sh` (SHA-256 of each `package-lock.json` under `~/.cache/mango/`).

Or on Pi (manual fast path):

```bash
cd ~/mango && git pull --ff-only
bash scripts/lib/pi-npm-deps.sh build src/catalog-service
bash scripts/lib/pi-npm-deps.sh build src/launcher
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

Full deps on Pi:

```bash
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm ci && npm run build
cd ../launcher && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
# voice (MANGO_VOICE=1 in ~/.config/mango/voice.env):
bash scripts/phase2/ensure-orchestrator-venv.sh
bash scripts/phase2/start-voice-stack.sh
```

### 5. Verify (Pi)

```bash
bash scripts/pi-pre-couch-gate.sh
bash scripts/phase-n3d/gate-n3d-self-hosted.sh   # when MANGO_SELF_HOSTED_ADDONS=1
bash scripts/phase-n3c/gate-n3c-verified-rails.sh
bash scripts/phase2/verify-voice-ready.sh      # when MANGO_VOICE=1
```

**Do not hand off** after Mac-only tests. Gates must pass **on the Pi**.

---

## Pi dirty tree

If `git pull --ff-only` fails on Pi:

1. `git status` on Pi — compare to Mac.
2. If Pi edits are stale (from old rsync): `git stash push -u -m 'pi-local'` or user-approved `git reset --hard origin/feat/native-experience`.
3. **Never** rsync to “fix” — commit on Mac, push, pull on Pi.

---

## What not to rsync (even if tempted)

| Path | Instead |
|------|---------|
| `src/orchestrator/.venv` | `bash scripts/phase2/ensure-orchestrator-venv.sh` on Pi |
| `src/catalog-service/node_modules` | `npm ci` on Pi after pull |
| `src/launcher/node_modules` | `npm ci` on Pi after pull |
| Whole `~/mango` | `git pull` |

---

## Quick reference

| Action | Command |
|--------|---------|
| Mac → Pi command | `bash scripts/pi-exec.sh '…'` |
| Mac deploy | `bash scripts/pi-deploy.sh` |
| Mac gate | `bash scripts/pi-exec-gate.sh` |
| Pre-push check | `bash scripts/lib/pi-sync-check.sh <paths>` |

See also: [`../AGENTS.md`](../AGENTS.md) · [`STACK-PRINCIPLES.md`](STACK-PRINCIPLES.md)

Live IPTV: [`LIVE_TV.md`](LIVE_TV.md) — gates opt-in only.
