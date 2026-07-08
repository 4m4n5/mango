# Split-machine deploy (work Mac → home Mac → Pi)

**Audience:** Cursor/Codex agent on the **home Mac** — the machine on the same LAN as the mango Pi and with SSH access to it.

**Context:** Code is edited and pushed from a **work Mac** that can reach GitHub but **cannot SSH to the Pi**. Deploy always runs from the **home Mac** after `git pull`.

| Machine | Role | Network |
|---------|------|---------|
| **Work Mac** | Edit · commit · `git push` | GitHub only (no Pi SSH) |
| **Home Mac** | `git pull` · `pi-deploy.sh` · gates | GitHub + Pi (`10.0.0.174` / `mango.local`) |
| **Pi** | `git pull` (via deploy script) · build · restart | Couch TV box |

**Binding rules (unchanged):** git only — never `rsync`, `scp`, or hand-copy repo files to the Pi. Full runbook: [`DEPLOY.md`](DEPLOY.md).

---

## One-time: SSH setup on the home Mac

Run these on the **home Mac** in the mango repo.

### 1. Generate key + SSH config

```bash
cd ~/Documents/personal/projects/mango   # or your clone path
bash scripts/setup-mac-pi-ssh.sh
```

This creates `~/.ssh/id_ed25519_mango` and appends a `Host mango` block to `~/.ssh/config`:

| Setting | Value |
|---------|--------|
| Host alias | `mango` (also `mango-pi`, `pi`) |
| User | `aman` |
| HostName | `10.0.0.174` |
| IdentityFile | `~/.ssh/id_ed25519_mango` |

The work Mac may already have its **own** mango key authorized on the Pi. The home Mac needs **its** public key added separately (unless you intentionally copy the same private key — not recommended).

### 2. Authorize the home Mac on the Pi (one time)

The setup script prints a one-liner. From any session that can reach the Pi (home Mac with password, or physical keyboard on the Pi):

```bash
ssh aman@10.0.0.174
# paste the mkdir/chmod/echo/authorized_keys line printed by setup-mac-pi-ssh.sh
```

Or append the home Mac public key manually:

```bash
cat ~/.ssh/id_ed25519_mango.pub   # run on home Mac — copy output
# on Pi:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo '<paste pub key>' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### 3. Verify passwordless SSH

```bash
bash scripts/pi-exec.sh 'hostname && cd ~/mango && git rev-parse --short HEAD'
```

Expected: Pi hostname + short commit hash, no password prompt.

### 4. mDNS fallback (optional)

If `10.0.0.174` times out but `mango.local` resolves, add to `~/.ssh/config` on the home Mac (same key as above):

```
Host mango-mdns
    HostName mango.local
    User aman
    IdentityFile ~/.ssh/id_ed25519_mango
    IdentitiesOnly yes
    ConnectTimeout 10
    StrictHostKeyChecking accept-new
```

Use for all deploy commands:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-deploy.sh --fast
```

---

## Repo on the home Mac

Clone (if missing):

```bash
git clone https://github.com/4m4n5/mango.git ~/Documents/personal/projects/mango
cd ~/Documents/personal/projects/mango
git checkout feat/native-experience
```

| Item | Value |
|------|--------|
| Remote | `https://github.com/4m4n5/mango` |
| Active branch | `feat/native-experience` |
| Pi repo path | `~/mango` (user `aman`) |

---

## Split workflow (every ship)

### Work Mac (no Pi SSH)

1. Edit code locally.
2. Run local checks when relevant (e.g. `cd src/launcher && npm run build`, `cd src/catalog-service && npm run test`).
3. Commit (only when user asks).
4. Push:

```bash
git push origin feat/native-experience
```

5. Tell the home Mac agent (or human): **branch + short commit** to deploy, e.g. `feat/native-experience @ abc1234`.

**Do not** run `pi-deploy.sh`, `pi-exec.sh`, or `pi-exec-gate.sh` from the work Mac — they require Pi SSH.

### Home Mac (deploy agent)

**Preconditions** ( `pi-deploy.sh` enforces these):

- Home Mac repo **matches `origin/feat/native-experience`** (not behind remote).
- Working tree **clean** (no uncommitted changes).

**Standard deploy loop:**

```bash
cd ~/Documents/personal/projects/mango
git fetch origin feat/native-experience
git checkout feat/native-experience
git pull --ff-only origin feat/native-experience
git rev-parse --short HEAD    # confirm matches commit user pushed from work Mac

bash scripts/pi-deploy.sh --fast
```

**Before couch handoff** (user testing on TV):

```bash
bash scripts/pi-deploy.sh --fast --gate
```

**When `package-lock.json` changed** (deps / first boot on Pi after lock bump):

```bash
bash scripts/pi-deploy.sh --full --gate
```

### What `pi-deploy.sh` does (via SSH)

Remotely on the Pi — you do not run these by hand unless debugging:

1. `cd ~/mango && git pull --ff-only`
2. Sync config scripts (etc-mango, rail catalogs, yt-dlp, …)
3. Build `catalog-service`, `launcher`, `companion` (fast path skips `npm ci` when lock unchanged)
4. `MANGO_CATALOG=1 bash scripts/mango-stack.sh restart`
5. Restart launcher Chromium if not mid-playback
6. Voice stack steps when `MANGO_VOICE=1` in `~/.config/mango/voice.env`

With `--gate`: runs `pi-exec-gate.sh` → Pi `git pull` + `pi-pre-couch-gate.sh`.

---

## Verify deploy landed

```bash
# Home Mac — compare hashes
git rev-parse --short HEAD
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse --short HEAD'

# Stack status
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'

# Full pre-couch gate (if not already run with --gate)
bash scripts/pi-exec-gate.sh
```

**Do not hand off to couch testing** until gate passes on the Pi or failures are explained. See [`COUCH_TEST.md`](COUCH_TEST.md).

---

## Agent checklist (home Mac)

```
- [ ] SSH works: bash scripts/pi-exec.sh 'echo ok'
- [ ] git pull — home Mac at intended commit (matches work Mac push)
- [ ] git status clean
- [ ] bash scripts/pi-deploy.sh --fast   (or --full if lockfiles changed)
- [ ] Optional: --gate before user couch test
- [ ] Pi HEAD matches home Mac HEAD
- [ ] Never rsync/scp repo files to Pi
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot SSH to mango without a password` | Run `bash scripts/setup-mac-pi-ssh.sh`; authorize pub key on Pi |
| `Mac is behind origin/...` | `git pull --ff-only origin feat/native-experience` on home Mac |
| `Mac has uncommitted changes` | Commit, stash, or discard local edits on home Mac before deploy |
| `git pull --ff-only` fails **on Pi** | SSH to Pi: `cd ~/mango && git status`; stash Pi-only junk or user-approved reset — never rsync |
| Static IP timeout | `MANGO_SSH_HOST=mango-mdns bash scripts/pi-deploy.sh --fast` |
| Deploy skipped launcher restart | Normal if mpv is playing — finish playback or restart launcher manually after |
| Voice broken after deploy | On Pi: `bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh && bash scripts/m5-voice/stack/start-voice-stack.sh` |

---

## Related docs

| Doc | Use |
|-----|-----|
| [`DEPLOY.md`](DEPLOY.md) | Full Pi deploy runbook · forbidden ops |
| [`AGENTS.md`](../AGENTS.md) | Agent entry · branch · gamepad locks |
| [`OPS.md`](OPS.md) | Pi bring-up · daily use · logs |
| [`COUCH_TEST.md`](COUCH_TEST.md) | Manual TV verification after gate |
