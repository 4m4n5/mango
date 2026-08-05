# Split-machine deploy (work Mac → home Mac → Pi)

**Audience:** Cursor/Codex agent on the **home Mac** — the machine on the same LAN as the mango Pi and with SSH access to it.

**Context:** Code is edited and pushed from a **work Mac** that can reach GitHub but **cannot SSH to the Pi**. Deploy always runs from the **home Mac** after `git pull`.

| Machine | Role | Network |
|---------|------|---------|
| **Work Mac** | Edit · commit · `git push` | GitHub only (no Pi SSH) |
| **Home Mac** | `git pull` · reviewed Git-only deploy/build · gates | GitHub + Pi (`mango` alias / `mango.local`) |
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
| HostName | The Pi's current DHCP reservation or `mango.local`; do not copy an old numeric address blindly |
| IdentityFile | `~/.ssh/id_ed25519_mango` |

The work Mac may already have its **own** mango key authorized on the Pi. The home Mac needs **its** public key added separately (unless you intentionally copy the same private key — not recommended).

### 2. Authorize the home Mac on the Pi (one time)

The setup script prints a one-liner. From any session that can reach the Pi (home Mac with password, or physical keyboard on the Pi):

```bash
ssh aman@mango.local
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

If the primary alias times out but `mango.local` resolves, add this fallback to
`~/.ssh/config` on the home Mac (same key as above):

```
Host mango-mdns
    HostName mango.local
    User aman
    IdentityFile ~/.ssh/id_ed25519_mango
    IdentitiesOnly yes
    ConnectTimeout 10
    StrictHostKeyChecking accept-new
```

Use the alias for read-only inspection; the deploy wrapper remains blocked as
described below:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-exec.sh 'cd ~/mango && git branch --show-current && git rev-parse HEAD'
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

**Home-repo preconditions** (check these explicitly; the current helper does not
enforce the required branch and its fetch can fail open):

- Home Mac is on **`feat/native-experience`** and its exact HEAD matches the
  freshly fetched `origin/feat/native-experience`.
- Working tree **clean** (no uncommitted changes).

**Pi preconditions** (the operator/agent must check explicitly):

- The couch is idle and mpv is not playing; deploy restarts the stack.
- `~/mango` dirty state is inventoried and preserved. The deploy helper does not
  make unknown Pi-only edits safe to overwrite.
- AIOStreams `userData`, credentials, seeds, runtime DBs, and caches are separate
  operator state. The current deploy wrapper does not overwrite AIO `userData`,
  but it **can mutate AIOMetadata private configuration/credentials/export** via
  an implicit sync; this is an active blocker described below.

**Standard deploy loop:**

```bash
cd ~/Documents/personal/projects/mango
git fetch origin feat/native-experience
git checkout feat/native-experience
git pull --ff-only origin feat/native-experience
test "$(git branch --show-current)" = feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
git rev-parse HEAD            # record the exact expected SHA

# Unattended agents stop here. Fix the blocker below or obtain explicit human review.
```

> **Current blocker:** `pi-deploy.sh` derives the remote branch from the Mac
> checkout instead of enforcing `feat/native-experience`, pulls it unpinned, and
> unconditionally invokes an AIOMetadata rail sync. With a running service and a
> private import file, that sync may POST new config, rewrite credentials/export,
> print the secret install URL, leave `/tmp/aiometadata-save.json`, and then have
> failure masked by `|| true`. The local skip variable is not forwarded. Do not
> use this wrapper or `pi-exec-gate.sh` unattended until those paths are
> fail-closed, explicitly opted in, redacted, private-temp, cleaned, and tested.

**After the blocker is fixed and tested, before couch handoff:**

```bash
bash scripts/pi-deploy.sh --fast --gate
```

**After the blocker is fixed, when `package-lock.json` changed:**

```bash
bash scripts/pi-deploy.sh --full --gate
```

### What the current `pi-deploy.sh` actually does (via SSH)

Remotely on the Pi — you do not run these by hand unless debugging:

1. Fetch, check out the Mac-derived branch, and `git pull --ff-only`; it does not
   pin the work-agent SHA.
2. Sync repository-owned examples and runtime dependencies. It leaves AIOStreams
   `userData` alone, but can implicitly mutate AIOMetadata config, its credentials,
   and the Stremio export when a private import exists.
3. Build `catalog-service`, `launcher`, `companion` (fast path skips `npm ci` when lock unchanged)
4. `MANGO_CATALOG=1 bash scripts/mango-stack.sh restart`
5. Restart launcher Chromium if not mid-playback
6. Voice stack steps when `MANGO_VOICE=1` in `~/.config/mango/voice.env`

With `--gate`: runs `pi-exec-gate.sh`, which again derives/checks out the Mac
branch and pulls it before `pi-pre-couch-gate.sh`; it is not exact-SHA proof.

---

## Verify deploy landed

```bash
# Home Mac — compare hashes
git fetch origin feat/native-experience
git rev-parse origin/feat/native-experience
git rev-parse HEAD
bash scripts/pi-exec.sh 'cd ~/mango && git branch --show-current && git rev-parse HEAD'

# Stack status
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'

# Pre-couch gate on the already read-back exact Pi SHA; do not pull again.
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/pi-pre-couch-gate.sh'
```

**Do not hand off to couch testing** until gate passes on the Pi or failures are explained. See [`COUCH_TEST.md`](COUCH_TEST.md).

---

## Agent checklist (home Mac)

```
- [ ] SSH works: bash scripts/pi-exec.sh 'echo ok'
- [ ] git pull — home Mac at intended commit (matches work Mac push)
- [ ] git status clean
- [ ] required branch + freshly fetched origin + Home Mac HEAD all match
- [ ] current wrapper blocker fixed, or a human explicitly reviewed/accepted the exception
- [ ] Pi branch and full HEAD match the recorded origin SHA after deploy
- [ ] Pi-local gate runs on that read-back SHA
- [ ] Never rsync/scp repo files to Pi
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Cannot SSH to mango without a password` | Run `bash scripts/setup-mac-pi-ssh.sh`; authorize pub key on Pi |
| `Mac is behind origin/...` | `git pull --ff-only origin feat/native-experience` on home Mac |
| `Mac has uncommitted changes` | Inventory and preserve them; commit intentional source or stop for direction—do not discard by default |
| `git pull --ff-only` fails **on Pi** | SSH to Pi and record `git status --short`/`git diff --stat`; preserve unknown changes and ask before any precise stash/reset—never rsync |
| Primary alias timeout | Verify with `MANGO_SSH_HOST=mango-mdns bash scripts/pi-exec.sh 'echo ok'`; use the fallback only in the reviewed flow after deploy blockers are fixed |
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
