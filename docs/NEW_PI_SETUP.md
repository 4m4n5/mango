# New Raspberry Pi setup

Set up an independent Mango appliance on a Raspberry Pi 5 with its **own**
provider, Google, voice, and Live credentials while seeding only the donor
box's verified VOD playability library.

This is an operator installation. The M6.4 no-SSH installer does not exist yet.
Do not use `pi-deploy.sh` or `pi-exec-gate.sh` as a first-boot installer: they
are update/gate wrappers, not a replacement for the setup phases below. Current
wrappers fail closed on branch, fetch, dirty state, and expected SHA; automated
AIOMetadata mutation is opt-in.

## Result and trust boundary

The recipient gets:

- the same verified Movie/Series title pool and rail membership from
  `/etc/mango/playability.db`;
- fresh Real-Debrid, TorBox, Easynews, metadata, YouTube, Live, LLM, and STT
  credentials;
- empty personal Saved, Continue, ratings, watch history, YouTube taste, and
  companion memory.

Transfer **only** `playability.db`. Do not transfer:

- `library.db`, `progress.db`, `youtube.db`, `companion.db`, or Reliability
  proof state;
- `/etc/mango/stremio-export.json`;
- AIOStreams/AIOMetadata `userData`, manifests, `.env` files, or credentials;
- OAuth tokens, YouTube cookies, Xtream credentials, API keys, certificates,
  caches, or virtual environments.

`playability.db` contains title IDs, rail evidence, service-scoped release
fingerprints, and capability evidence. It does not contain signed playback
URLs or provider keys. Its old `cache_status`, `debrid_service`, and
`win_url_hash` values are useful hints, not proof that the recipient's new
debrid accounts can still play every release. Mango resolves fresh URLs at
play time and normal TTL maintenance revalidates the seed.

## Requirements

| Requirement | Supported setup |
|-------------|-----------------|
| Host | Raspberry Pi 5, **8 GB**, active cooling |
| Storage | 128 GB or larger A2 microSD; NVMe is optional |
| OS | Raspberry Pi OS Desktop 64-bit, X11/Openbox |
| User | **`aman`** |
| Repository | `~/mango`, branch `feat/native-experience` |
| Display | HDMI; launcher runs at 1920×1080@60 |
| Network | Wired Ethernet recommended |
| Controller | One 8BitDo Micro, Switch mode |

The `aman` username is currently mandatory. The pad launcher, pad systemd unit,
controller supervisor, and several diagnostics contain `/home/aman`. Generalize
those files before using another username.

Use a unique hostname such as `mango-recipient`; do not create a second
`mango.local` on the same network.

## Credential inventory

Every item in this table belongs to the recipient. Never copy it from the donor.

| Feature | Recipient-owned input | Runtime location |
|---------|-----------------------|------------------|
| Git | GitHub access if the repository is private | Git credential/SSH agent |
| AIOStreams | New 64-hex `SECRET_KEY` | `deploy/aiostreams/.env` |
| Debrid | Real-Debrid and TorBox API credentials | AIOStreams Configure UI |
| Usenet | Easynews credentials, if enabled | AIOStreams Configure UI |
| Stream metadata | TVDB API key | AIOStreams Configure UI/helper |
| AIOMetadata | TMDB and MDBList API keys | `deploy/aiometadata/.env` |
| YouTube | Data API key, OAuth client, OAuth login, playback cookies | `/etc/mango/youtube-*` |
| VOD enrichment | TMDB API key | `/etc/mango/tmdb.key` |
| Voice | Anthropic/OpenAI key and Deepgram key | `/etc/mango/llm.key`, `/etc/mango/stt.key` |
| Live TV | Own AREA69/Xtream URL, username, password, if paid Live is used | `~/.config/mango/area69.credentials` |
| Companion TLS | New device certificate and local CA | `~/.config/mango/certs/` |
| Controller | Recipient's 8BitDo Bluetooth MAC | BlueZ and systemd override |

Torrentio, Comet, free IPTV-org sports/news/cartoons, Cinemeta, and Bharat Binge
do not require recipient API keys. Their local manifests must still be created
on the recipient Pi.

## Phase 1 — prepare Raspberry Pi OS

During imaging:

1. Choose Raspberry Pi OS Desktop 64-bit.
2. Create user `aman`.
3. Set a unique hostname, enable SSH, and configure Ethernet/Wi-Fi.
4. Do not place secrets in the image customization fields.

On first boot:

```bash
sudo raspi-config
```

Select Desktop Autologin and the X11/Openbox desktop rather than Wayland, then
reboot. After reboot:

```bash
echo "$USER"                         # must be aman
echo "$XDG_SESSION_TYPE"             # must be x11
uname -m                             # must be aarch64
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y \
  git nodejs npm sqlite3 jq unzip openssl magic-wormhole \
  build-essential ca-certificates python3-venv python3-dbus python3-gi
node -e 'const n=+process.versions.node.split(".")[0]; if(n<20) process.exit(1)'
```

Mango requires Node 20 or newer. Stop and install a current Node release if the
last command fails.

Clone only through Git:

```bash
git clone --branch feat/native-experience --single-branch \
  https://github.com/4m4n5/mango.git ~/mango
cd ~/mango
git branch --show-current
git rev-parse HEAD
bash scripts/m1-foundation/pad/verify-system.sh
```

Never copy, tar, `rsync`, or `scp` a repository checkout from another machine.
If the system check reports Wayland:

```bash
cd ~/mango
bash scripts/m1-foundation/pad/switch-to-x11.sh
sudo reboot
```

After reboot, rerun `verify-system.sh`. Treat less than 7 GB RAM or less than
50 GB free on `/` as unsupported/insufficient headroom for this installation.

Install host and Docker dependencies:

```bash
cd ~/mango
bash scripts/m1-foundation/pad/install-base-deps.sh
bash scripts/m2-catalog/service/install-m2-prereqs.sh
bash scripts/m4-addons/bootstrap-docker.sh
```

If Docker added `aman` to the `docker` group, log out and back in, then prove:

```bash
docker info >/dev/null
docker compose version 2>/dev/null || docker-compose version
```

Build all three JavaScript services:

```bash
cd ~/mango
npm --prefix src/catalog-service ci
npm --prefix src/catalog-service run build
npm --prefix src/launcher ci
npm --prefix src/launcher run build
npm --prefix src/companion ci
npm --prefix src/companion run build
```

Create device-owned configuration, but do not start catalog-service yet:

```bash
sudo install -d -o aman -g aman -m 0750 /etc/mango
sudo install -m 0644 config/config.example.yaml /etc/mango/config.yaml
sudo install -m 0644 config/catalog.example.yaml /etc/mango/catalog.yaml
install -d -m 0700 ~/.config/mango
install -m 0600 config/voice.env.example ~/.config/mango/voice.env
python3 - <<'PY'
from pathlib import Path
p = Path.home() / ".config/mango/voice.env"
s = p.read_text()
s = s.replace("export MANGO_VOICE=1", "export MANGO_VOICE=0")
if "MANGO_SELF_HOSTED_ADDONS" not in s:
    s += "\nexport MANGO_SELF_HOSTED_ADDONS=1\n"
p.write_text(s)
PY
```

Keep VOD and YouTube recommendation modes `off` during bring-up. The recipient
has no copied household ratings or YouTube taste.

## Phase 2 — export the donor playability seed

Run this on the donor Pi from its exact pushed Git revision. SQLite's online
backup API makes a consistent snapshot while catalog-service is running.

```bash
cd ~/mango
test "$(git branch --show-current)" = feat/native-experience
SEED_DIR="$(mktemp -d /tmp/mango-playability-seed.XXXXXX)"
export SEED_DIR
python3 - <<'PY'
import json
import os
from pathlib import Path
import sqlite3
import subprocess
from datetime import datetime, timezone

root = Path(os.environ["SEED_DIR"])
source = sqlite3.connect("file:/etc/mango/playability.db?mode=ro", uri=True)
target = sqlite3.connect(root / "playability.db")
source.backup(target)
quick_check = target.execute("PRAGMA quick_check").fetchone()[0]
if quick_check != "ok":
    raise SystemExit(f"backup quick_check failed: {quick_check}")
manifest = {
    "format": "mango-playability-seed-v1",
    "created_at": datetime.now(timezone.utc).isoformat(),
    "source_sha": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip(),
    "migration": target.execute(
        "SELECT COALESCE(MAX(version), 0) FROM playability_migrations"
    ).fetchone()[0],
    "verified_titles": target.execute(
        "SELECT COUNT(*) FROM titles WHERE status='verified'"
    ).fetchone()[0],
    "rail_memberships": target.execute(
        "SELECT COUNT(*) FROM rail_pool"
    ).fetchone()[0],
    "quick_check": quick_check,
}
(root / "manifest.json").write_text(
    json.dumps(manifest, indent=2, sort_keys=True) + "\n"
)
target.close()
source.close()
PY
(
  cd "$SEED_DIR"
  sha256sum playability.db manifest.json > SHA256SUMS
)
ARCHIVE="/tmp/mango-playability-seed-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar -C "$SEED_DIR" -czf "$ARCHIVE" playability.db manifest.json SHA256SUMS
chmod 600 "$ARCHIVE"
rm -rf "$SEED_DIR"
echo "$ARCHIVE"
```

Inspect only aggregate metadata:

```bash
tar -xOf "$ARCHIVE" manifest.json | python3 -m json.tool
```

Do not inspect or transmit title rows in chat or logs.

## Phase 3 — transfer with Magic Wormhole

Magic Wormhole is the default transfer because it is packaged by Debian,
requires no accounts or inbound ports, uses a short SPAKE2-authenticated code,
and encrypts the transfer end to end. Peers on one LAN connect directly; peers
behind separate NATs fall back to an encrypted transit relay.

`croc` adds parallel streams and resume support, but it requires another binary
and trust path. The compressed playability seed is small enough that Magic
Wormhole is the simpler choice. Public relay uptime and speed are not
guaranteed; retry later or use a mutually trusted private relay if necessary.
If both Pis already have a direct trusted SSH route, transferring this one
state archive directly can be faster; the prohibition on `scp` still applies
to repository deployment, not to this explicit database export. Wormhole is
the default here because it works unchanged across separate NATs.

References: [Magic Wormhole transfer model](https://magic-wormhole.readthedocs.io/en/latest/welcome.html)
and [croc capabilities](https://github.com/schollz/croc).

On the donor:

```bash
wormhole send "$ARCHIVE"
```

Send the one-time code to the recipient over a separate authenticated channel.
Do not paste it into a public issue or repository.

On the recipient:

```bash
install -d -m 0700 ~/mango-seed
cd ~/mango-seed
wormhole receive
# Enter the donor's one-time code and accept the named archive.
tar -xzf mango-playability-seed-*.tar.gz
sha256sum -c SHA256SUMS
python3 -m json.tool manifest.json
```

Confirm source compatibility before installing the database:

```bash
SOURCE_SHA="$(python3 -c 'import json; print(json.load(open("manifest.json"))["source_sha"])')"
git -C ~/mango cat-file -e "${SOURCE_SHA}^{commit}"
test "$(git -C ~/mango rev-parse HEAD)" = "$SOURCE_SHA"
```

If the last command fails, stop. Align the recipient checkout to the donor's
pushed revision through Git, or create a new seed from the intended current
revision. Do not start older code against a newer database and do not use a hard
reset to conceal branch drift.

Install the seed before catalog-service's first start. Use Mango's restore
helper so required tables, foreign keys, strict proof rows, rail membership,
checkpoint, and final readback are validated:

```bash
systemctl --user stop mango-catalog.service 2>/dev/null || true
test ! -e /etc/mango/playability.db
cd ~/mango
python3 scripts/m3-play/playability/sqlite-publication.py restore \
  --snapshot ~/mango-seed/playability.db \
  --live /etc/mango/playability.db
chmod 600 /etc/mango/playability.db
sqlite3 /etc/mango/playability.db 'PRAGMA quick_check;'
```

The `test ! -e` guard intentionally refuses to overwrite recipient state.
Remove donor-only shuffle/session state while retaining verified titles, rail
membership, thematic evidence, and release capability evidence:

```bash
python3 - <<'PY'
import sqlite3

db = sqlite3.connect("/etc/mango/playability.db")
for table in (
    "rail_session",
    "recently_shown",
    "vod_explore_sessions_v3",
    "vod_tab_deals_v3",
):
    try:
        db.execute(f"DELETE FROM {table}")
    except sqlite3.OperationalError:
        pass
db.commit()
if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
    raise SystemExit("post-session-cleanup quick_check failed")
db.close()
PY
```

## Phase 4 — configure VOD addons with recipient credentials

### AIOStreams

```bash
cd ~/mango
umask 077
cp deploy/aiostreams/.env.example deploy/aiostreams/.env
python3 - <<'PY'
from pathlib import Path
import re
import secrets
p = Path("deploy/aiostreams/.env")
s = p.read_text()
line = f"SECRET_KEY={secrets.token_hex(32)}"
s = re.sub(r"(?m)^SECRET_KEY=.*$", line, s) if re.search(
    r"(?m)^SECRET_KEY=", s
) else s + "\n" + line + "\n"
p.write_text(s)
PY
```

This writes a new 64-hex `SECRET_KEY` without printing it. Do not commit or
display the completed file.

```bash
bash scripts/m4-addons/install-aiostreams.sh
bash scripts/m4-addons/enable-aiostreams-service.sh
```

From a trusted operator computer:

```bash
ssh -L 3035:127.0.0.1:3035 aman@<recipient-host>
```

Open `http://127.0.0.1:3035/stremio/configure` and configure:

- recipient Real-Debrid and TorBox credentials;
- recipient Easynews credentials, if used;
- Torrentio and Comet as stream-only indexers;
- MediaFusion through AIOStreams' native integration;
- Service Wrap and Check Library;
- stream errors visible to Mango;
- no broad quality exclusion—Mango owns device capability filtering.

Keep the addon name exactly `AIOStreams`. Save the generated localhost manifest
URL privately.

Set the recipient's TVDB key and verify policy:

```bash
bash scripts/m4-addons/aiostreams-config.sh set-tvdb-key
bash scripts/m4-addons/aiostreams-config.sh enable-mediafusion
bash scripts/m4-addons/aiostreams-config.sh verify
bash scripts/m4-addons/ensure-aiostreams-rate-limits.sh
```

### AIOMetadata

```bash
cd ~/mango
umask 077
cp deploy/aiometadata/.env.example deploy/aiometadata/.env
```

Set recipient `TMDB_API_KEY` and `MDBLIST_API_KEY` in that file, then:

```bash
bash scripts/m4-addons/install-aiometadata.sh
bash scripts/m4-addons/enable-aiometadata-service.sh
```

Tunnel port 3036 and use the Configure UI:

```bash
ssh -L 3036:127.0.0.1:3036 aman@<recipient-host>
```

Open `http://127.0.0.1:3036/configure`, add the MDBList catalogs named in
`scripts/m4-addons/map-mdblist-catalogs.md`, and save its generated localhost
manifest URL. Do not run `aiometadata-config.sh import`: that mutation path is
currently blocked because it exposes/leaves secret-bearing output.

### Build the recipient addon export

Do not copy the donor export. Create a new export with the two generated local
URLs:

```bash
cd ~/mango
umask 077
python3 - <<'PY'
import getpass
import json
from pathlib import Path

aio = getpass.getpass("AIOStreams manifest URL: ").strip()
meta = getpass.getpass("AIOMetadata manifest URL: ").strip()
if not aio.startswith("http://127.0.0.1:3035/"):
    raise SystemExit("AIOStreams URL must use recipient localhost:3035")
if not meta.startswith("http://127.0.0.1:3036/"):
    raise SystemExit("AIOMetadata URL must use recipient localhost:3036")
data = {
    "addons": [
        {"name": "Cinemeta",
         "manifestUrl": "https://v3-cinemeta.strem.io/manifest.json"},
        {"name": "AIOStreams", "manifestUrl": aio},
        {"name": "AIOMetadata", "manifestUrl": meta},
    ],
    "auth": {},
}
Path("/tmp/recipient-stremio-export.json").write_text(
    json.dumps(data, indent=2) + "\n"
)
PY
bash scripts/m2-catalog/service/setup-stremio-export.sh \
  /tmp/recipient-stremio-export.json
rm -f /tmp/recipient-stremio-export.json
bash scripts/m4-addons/ensure-bharat-binge-export.sh
```

## Phase 5 — configure YouTube with a new Google identity

Create a recipient Google Cloud project or credential set:

1. Enable YouTube Data API v3.
2. Create a restricted API key.
3. Create an OAuth client compatible with Google's limited-input/device flow.
4. Download the OAuth JSON in the shape documented by
   `config/youtube-oauth-client.example.json`.

Install without exposing values:

```bash
sudo install -o aman -g aman -m 0600 \
  /path/to/recipient-youtube-api.key /etc/mango/youtube-api.key
sudo install -o aman -g aman -m 0600 \
  /path/to/recipient-youtube-oauth-client.json \
  /etc/mango/youtube-oauth-client.json
sudo install -o aman -g aman -m 0600 \
  /path/to/recipient-tmdb.key /etc/mango/tmdb.key
cd ~/mango
bash scripts/m6-ship/ensure-youtube-yt-dlp.sh
```

Do not copy `youtube.db` or `youtube-auth.json`. After catalog and Companion
start, use Companion's YouTube Connect flow to create a fresh recipient
`/etc/mango/youtube-auth.json`.

For playback, export a fresh Netscape cookie jar from the recipient's own
browser/account as documented in [features/youtube.md](features/youtube.md),
then install it as:

```bash
sudo install -o aman -g aman -m 0600 \
  /path/to/recipient-youtube-cookies.txt /etc/mango/youtube-cookies.txt
bash ~/mango/scripts/m6-ship/verify-youtube-cookies.sh
```

## Phase 6 — optional Live TV with recipient credentials

Skip paid AREA69 if the recipient does not have an account. Free sports, news,
and cartoons can still be installed.

```bash
cd ~/mango
umask 077
cp deploy/nexotv/.env.example deploy/nexotv/.env
cp deploy/nexotv-free/.env.example deploy/nexotv-free/.env
python3 - <<'PY'
from pathlib import Path
import re
import secrets
for raw in ("deploy/nexotv/.env", "deploy/nexotv-free/.env"):
    p = Path(raw)
    s = p.read_text()
    line = f"CONFIG_SECRET={secrets.token_hex(32)}"
    s = re.sub(r"(?m)^CONFIG_SECRET=.*$", line, s) if re.search(
        r"(?m)^CONFIG_SECRET=", s
    ) else s + "\n" + line + "\n"
    p.write_text(s)
PY
```

For paid Live:

```bash
cp config/area69.credentials.example ~/.config/mango/area69.credentials
chmod 600 ~/.config/mango/area69.credentials
# Set recipient XTREAM_URL, XTREAM_USER, and XTREAM_PASS.
```

Install and configure:

```bash
bash scripts/live/install-nexotv.sh
bash scripts/live/install-nexotv-free.sh
bash scripts/live/install-nexotv-news.sh
bash scripts/live/install-nexotv-cartoons.sh
bash scripts/live/nexotv-config.sh init-profiles
# Paid only:
bash scripts/live/nexotv-config.sh apply-area69
bash scripts/live/nexotv-config.sh apply-free iptv-org-sports
bash scripts/live/nexotv-config.sh apply-news iptv-org-news
bash scripts/live/nexotv-config.sh apply-cartoons m3u-cartoons
sudo install -m 0644 config/catalog-live.example.yaml /etc/mango/catalog-live.yaml
bash scripts/live/nexotv-config.sh wire-export
```

`wire-export` adds this Pi's generated NexoTV manifests to its existing export.
Never insert donor NexoTV tokens.

## Phase 7 — controller, launcher, and playback

Pair the recipient's 8BitDo Micro in Switch mode and record its MAC:

```bash
bluetoothctl
# power on
# agent on
# default-agent
# scan on
# pair AA:BB:CC:DD:EE:FF
# trust AA:BB:CC:DD:EE:FF
# connect AA:BB:CC:DD:EE:FF
# quit
```

Then install the current single-owner controller stack:

```bash
cd ~/mango
PAD_MAC="AA:BB:CC:DD:EE:FF"
sudo bash scripts/m1-foundation/pad/install-pad-sudoers.sh
sudo env MANGO_GAMEPAD_BT_MAC="$PAD_MAC" \
  bash scripts/m1-foundation/pad/install-controller-reliability.sh --apply
sudo install -d -m 0755 \
  /etc/systemd/system/mango-controller-link.service.d
printf '[Service]\nEnvironment=MANGO_GAMEPAD_BT_MAC=%s\n' "$PAD_MAC" \
  | sudo tee \
    /etc/systemd/system/mango-controller-link.service.d/10-recipient-pad.conf \
    >/dev/null
sudo systemctl daemon-reload
sudo systemctl restart mango-controller-link.service
```

The drop-in is required because the committed controller unit still contains
the donor pad MAC.

Install the UI and service units:

```bash
cd ~/mango
bash scripts/m6-ship/set-playback-engine.sh mpv-hifi --no-restart
sudo bash scripts/m1-foundation/ui/install-ops-sudoers.sh
bash scripts/m1-foundation/ui/install-openbox-autostart.sh
bash scripts/m1-foundation/ui/install-systemd-units.sh
sudo loginctl enable-linger aman
bash scripts/m3-play/playability/install-playability-timer.sh
```

## Phase 8 — optional voice and phone companion

Create recipient-owned `/etc/mango/llm.key` and `/etc/mango/stt.key` with mode
`0600`. Use an editor or hidden prompt; never place the key on a command line,
in chat, or in Git.

Review `/etc/mango/config.yaml`:

- select `anthropic` or `openai`;
- keep Deepgram `nova-3`, multilingual/Hinglish settings;
- keep `audio.tts_enabled: false`;
- keep `llm.max_tokens` at least 1024.

Install voice dependencies:

```bash
cd ~/mango
bash scripts/m5-voice/stack/install-voice-deps.sh
bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh
```

Generate a new certificate for the recipient IP and hostname:

```bash
PI_IP="<recipient-LAN-IP>"
PI_HOST="$(hostname).local"
install -d -m 0700 ~/.config/mango/certs
cd ~/.config/mango/certs
mkcert -install
mkcert -cert-file mango-companion.pem \
  -key-file mango-companion-key.pem \
  localhost 127.0.0.1 "$PI_IP" "$PI_HOST"
```

Install the displayed mkcert root CA on each recipient phone through a trusted
local process. Never send the private key to the phone.

Enable voice and install units:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path.home() / ".config/mango/voice.env"
s = p.read_text().replace("export MANGO_VOICE=0", "export MANGO_VOICE=1")
p.write_text(s)
PY
chmod 600 ~/.config/mango/voice.env
cd ~/mango
bash scripts/m5-voice/stack/install-voice-systemd.sh
bash scripts/m5-voice/ai/install-companion-nightly-timer.sh
bash scripts/m5-voice/stack/verify-voice-ready.sh
```

## Phase 9 — start and verify

Restart once all required credentials and manifests exist:

```bash
cd ~/mango
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/mango-stack.sh status
curl -fsS http://127.0.0.1:3020/health >/dev/null
curl -fsS http://127.0.0.1:3000/ >/dev/null
```

Prove the transferred seed without printing title identities:

```bash
python3 - <<'PY'
import json
import sqlite3
from pathlib import Path

manifest = json.loads((Path.home() / "mango-seed/manifest.json").read_text())
db = sqlite3.connect("/etc/mango/playability.db")
actual = {
    "migration": db.execute(
        "SELECT COALESCE(MAX(version), 0) FROM playability_migrations"
    ).fetchone()[0],
    "verified_titles": db.execute(
        "SELECT COUNT(*) FROM titles WHERE status='verified'"
    ).fetchone()[0],
    "rail_memberships": db.execute(
        "SELECT COUNT(*) FROM rail_pool"
    ).fetchone()[0],
    "quick_check": db.execute("PRAGMA quick_check").fetchone()[0],
}
expected = {key: manifest[key] for key in actual}
print(json.dumps({"expected": expected, "actual": actual}, indent=2))
if actual != expected:
    raise SystemExit("playability seed mismatch")
PY
rm -f ~/mango-seed/playability.db \
  ~/mango-seed/mango-playability-seed-*.tar.gz \
  ~/mango-seed/SHA256SUMS
```

After the recipient confirms this match, delete the donor archive path printed
in Phase 2. Keep only the aggregate `manifest.json` for the installation record.

Run subsystem gates:

```bash
cd ~/mango
bash scripts/m4-addons/gate-m4-self-hosted.sh
bash scripts/m6-ship/gate-m6-youtube-smoke.sh
bash scripts/live/gate-live-diagnostics.sh          # when Live is configured
bash scripts/m5-voice/stack/verify-voice-ready.sh  # when voice is enabled
bash scripts/pi-pre-couch-gate.sh
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
```

Live playback probes are intentionally opt-in:

```bash
MANGO_LIVE_GATE=1 bash scripts/live/gate-live-iptv.sh
MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh
```

Then perform physical tests:

1. Wake/reconnect the recipient controller without pairing mode.
2. Confirm Home is populated immediately from the transferred verified rails.
3. Search and play one Movie and one exact Series episode.
4. Confirm those plays resolve through the recipient's RD/TB accounts.
5. Play one YouTube video using the recipient Google account.
6. Play one paid and one free Live channel when configured.
7. Stop playback and confirm focus returns to the same launcher position.

Do not claim all copied titles are currently playable from two successful
samples. The transferred DB avoids a cold library rebuild; it does not certify
the recipient's credentials or network.

After the first couch checks, leave the 03:00 timer installed. It performs
stale revalidation, growth, YouTube refresh, and proof while preserving the
last-good rail snapshot. A manual stale pass is optional:

```bash
bash scripts/m3-play/playability/playability-maintenance.sh --mode stale
```

It probes only due/stale evidence; it is not a full rebuild from scratch.

## Completion checklist

- [ ] Pi 5 8 GB, user `aman`, X11/Openbox, unique hostname
- [ ] Exact donor Git SHA and playability migration matched before restore
- [ ] `playability.db` checksum, `quick_check`, verified count, and rail count match
- [ ] No donor database other than `playability.db` exists on recipient
- [ ] Recipient AIOStreams and AIOMetadata manifests use `127.0.0.1`
- [ ] Recipient RD, TB, Easynews, TVDB, TMDB, and MDBList credentials configured
- [ ] Recipient Google API key, OAuth login, and cookies configured
- [ ] Recipient Live secrets/tokens generated locally, if Live is enabled
- [ ] Recipient LLM, STT, TLS, and phone trust configured, if voice is enabled
- [ ] Recipient controller MAC override installed
- [ ] M4, YouTube, Live/voice as applicable, and pre-couch gates pass
- [ ] Physical Movie, Series, YouTube, Live, controller, audio, and return-focus checks pass

## Ongoing deployment

The Pi remains a Git checkout. Future source changes move by commit/push/pull
and a dependency-aware build—never by copying repository files. Keep all
credentials, manifests, databases, cookies, certificates, and provider state
on the recipient device. Follow [OPERATIONS.md](OPERATIONS.md): its wrappers now enforce
branch/SHA/fetch preconditions and leave AIOMetadata sync disabled unless an
operator explicitly opts in.
