# Codex prompt — Phase N1 catalog + play spike

**Last updated:** 2026-06-18 · Pi prereqs green · branch `feat/native-experience` @ `5410c95+`

Copy everything below into Codex as the task prompt.

---

## Prompt

You are a **senior TV-box platform engineer** (embedded Linux, media pipeline, Stremio addon protocol, mpv IPC, SRE gates). Execute **Phase N1 — Catalog + play spike** for the **mango** repo end-to-end, including **on-device validation on the Raspberry Pi**.

### Pi state (already done — do not redo)

Cursor preflight on `mango` (`aman@10.0.0.174`):

| Item | Status |
|------|--------|
| Branch | `feat/native-experience` pulled |
| `bash scripts/phase-n0/gate-n0.sh` | **PASS** |
| `bash scripts/phase-n1/check-n1-prereqs.sh` | **PASS** |
| `mpv` + `socat` | installed (v0.40.0) |
| `node` | v20.19.2 |
| `/etc/mango/stremio-export.json` | **5 addons** (Cinemeta, AIOMetadata, AIOStreams, Torrentio TB, Torrentio RD) |
| `/etc/mango/config.yaml` | present |
| Pad launcher routing fix | shipped (`c775199`) |

**Stremio addon config on Pi** (either works):

- `bash scripts/phase-n1/setup-stremio-export.sh --from-local` — reads Qt WebEngine leveldb  
- `bash scripts/phase-n1/setup-stremio-export.sh /path/to/stremioExport.json` — official Settings export (nested `addons.addons[]` normalized)

**Do not** re-install prereqs or re-import export unless `check-n1-prereqs.sh` fails.

### Already scaffolded (extend, don't duplicate)

| Path | State |
|------|--------|
| `scripts/phase-n1/spike-mpv-http.sh` | exists — run S0 |
| `scripts/phase-n1/spike-stremio-core.sh` | exists — **needs** `src/catalog-service/scripts/spike-core-boot.mjs` |
| `scripts/phase-n1/mpv-play.sh` · `mpv-stop.sh` · `mpv-ipc.sh` | exists |
| `scripts/phase-n1/gate-n1-smoke.sh` | exists — will fail until service built |
| `scripts/phase-n1/import-stremio-local.py` | done |
| `src/catalog-service/` | **stub only** (`package.json` placeholders) — **you implement** |

### Think before you code (mandatory)

Spend the **first 25% of your effort** reading and writing a short **implementation plan** in `docs/N1-INVENTORY.md` §Plan **before** editing application code. The plan must include:

1. Risks from N0 inventory (RAM headroom, Node+WASM on ARM)  
2. Spike order S0→S6 — mark prereqs **green**; S0/S1/S2+ TBD  
3. Pinned smoke title ID and why (pick one that resolves on **this** household's RD/TorBox addons)  
4. stremio-core failure fallback branch (if any) — **no Stremio desktop gate pass**  
5. mpv socket path + singleton strategy (`~/.cache/mango/mpv.sock`)  
6. Pad diff for `mpv` foreground + ⌂  

**Do not** write full `catalog-service` until **S0 (mpv HTTP)** and **S1 (stremio-core boot)** pass on the Pi.

### Read first (in order)

1. **Task spec (binding):** [`docs/tasks/phase-n1-catalog-play-spike.md`](docs/tasks/phase-n1-catalog-play-spike.md)
2. **Roadmap:** [`docs/NATIVE_ROADMAP.md`](docs/NATIVE_ROADMAP.md) § N1
3. **Product architecture:** [`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)
4. **Foreground contract:** [`docs/FOREGROUND.md`](docs/FOREGROUND.md)
5. **N0 baseline:** [`docs/N0-INVENTORY.md`](docs/N0-INVENTORY.md)
6. **Pi ops:** [`docs/PHASE0.md`](docs/PHASE0.md) · [`AGENTS.md`](AGENTS.md)
7. **Pad (locked codes):** [`docs/HARDWARE.md`](docs/HARDWARE.md) · `scripts/phase0/mango-tv-pad.py`

Apply **`$mango-tv-box-expert`**: spike-before-integrate, single playback owner, sub-300 ms home from mpv, never wallpaper, git-only deploy, automated gate before human handoff.

### Branch & environment

- Work on **`feat/native-experience`** only.
- Pi: SSH **`mango`** → `aman@10.0.0.174`, repo **`~/mango`**.
- **Never rsync.** Commit + push from Mac; `git pull` on Pi.
- Secrets stay in `/etc/mango/` — **never commit** (`stremio-export.json` has RD/TorBox keys in Torrentio URLs).

### Your mission

**N1 proves one title plays in mpv via the Stremio addon graph.** No launcher browse UI. No `catalog.yaml`. No stream picker UI.

| Build | Do not build |
|-------|----------------|
| `catalog-service` on `:3020` | Launcher rails / posters UI (N2) |
| stremio-core meta + stream resolve | `progress.db` (N3) |
| mpv singleton + IPC | yt-dlp YouTube (N6) |
| `POST /play` smoke | Stremio desktop for gate pass |
| Pad `mpv` + ⌂ contract | 4K hwdec matrix (N7) |

### Spike sequence (enforce order)

```
S0  bash scripts/phase-n1/spike-mpv-http.sh          # prereq green; confirm on Pi
S1  bash scripts/phase-n1/spike-stremio-core.sh     # implement spike-core-boot.mjs first
S2  curl /meta + /stream for pinned tt… ID
S3  bash scripts/phase-n1/mpv-play.sh --url '…'
S4  catalog-service HTTP + POST /play
S5  pad mpv routing + ⌂ home
S6  bash scripts/phase-n1/gate-n1-smoke.sh
```

If S1 fails: follow decision tree in spec §4 — document waiver; **do not** pass gate with Stremio UI.

### Deliverables (all required)

Implement spec **§7 Deliverables D1–D5** and **§8 Validation gates**.

**Implement (not just scaffold):**

- `src/catalog-service/scripts/spike-core-boot.mjs` — S1 spike  
- `src/catalog-service/` — Node 20+ TypeScript, `@stremio/stremio-core-web`  
- Endpoints: `GET /health`, `GET /meta/:type/:id`, `GET /stream/:type/:id`, `POST /play`  
- `scripts/mango-stack.sh` — start/stop catalog-service when `MANGO_CATALOG=1`  
- `scripts/phase0/mango-tv-pad.py` — `foreground_app` mpv; ⌂ → `mpv-stop.sh` + launcher  
- `docs/N1-INVENTORY.md` — plan, spike logs, TTFF, pinned title  

**Extend existing scripts** where needed; do not rewrite working prereq/import tooling.

### Execution workflow (do not skip steps)

```
0. VERIFY — ssh mango; bash scripts/phase-n1/check-n1-prereqs.sh (should PASS)
1. READ — spec + N0 inventory + FOREGROUND.md
2. PLAN — write N1-INVENTORY.md §Plan (no feature code yet)
3. S0/S1 — Pi spikes; implement spike-core-boot.mjs; commit when green
4. IMPLEMENT — catalog-service + stack + pad
5. COMMIT + PUSH — feat/native-experience
6. DEPLOY Pi — git pull; cd src/catalog-service && npm ci && npm run build
7. S2–S5 — on-device play + pad
8. GATE — gate-n1-smoke.sh (must exit 0)
9. REGRESS — gate-n0.sh (must exit 0)
10. INVENTORY — complete N1-INVENTORY.md metrics
11. COMMIT + PUSH — inventory + fixes
```

If a gate fails, **fix and re-run** until pass or document explicit waiver in `N1-INVENTORY.md`.

### Hard rules

- **No launcher UI changes** except copy if unavoidable — N2 owns browse.
- **No secrets in git.** No `keys/`, no `.env` commits.
- **Do not change gamepad evdev codes** (B=304, Y=308, ⌂=316/311) without approval.
- **Do not uninstall** Stremio `.deb` or Kodi.
- **One mpv process** — singleton enforced in play/stop scripts.
- **Chromium never decodes video** — mpv only.
- `set -euo pipefail` on new bash scripts.
- mpv IPC: [`DOCS/man/ipc.rst`](https://github.com/mpv-player/mpv/blob/master/DOCS/man/ipc.rst)

### Gate thresholds (enforce in gate-n1-smoke.sh)

| Check | Pass |
|-------|------|
| `check-n1-prereqs.sh` | exit 0 |
| `spike-mpv-http.sh` | exit 0 |
| `spike-stremio-core.sh` | exit 0 |
| `GET :3020/health` | `ok: true` |
| `POST /play` smoke title | `ttff_ms` logged; mpv running |
| `pgrep stremio` at idle | 0 |
| `pgrep -c mpv` after `mpv-stop.sh` | 0 |
| `gate-n0.sh` | exit 0 |

### When done

Post a **handoff report**:

1. Spike results S0–S6 (pass/fail + ms)  
2. Pinned title ID + stream type (RD HTTP)  
3. `gate-n1-smoke.sh` + `gate-n0.sh` summary  
4. Files added/changed  
5. stremio-core version pinned  
6. Explicit **"Ready for N2"** or **"Blocked on …"**

Do not ask clarifying questions unless **blocked** — make principled choices per spec, document in `N1-INVENTORY.md`.

### Starter command block (Pi)

```bash
cd ~/mango && git fetch && git checkout feat/native-experience && git pull
bash scripts/phase-n1/check-n1-prereqs.sh
bash scripts/phase-n1/spike-mpv-http.sh
bash scripts/phase-n1/spike-stremio-core.sh   # after you add spike-core-boot.mjs
cd src/catalog-service && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n1/gate-n1-smoke.sh
bash scripts/phase-n0/gate-n0.sh
```

---

## Short paste (minimal)

```
Execute mango Phase N1 per docs/tasks/phase-n1-catalog-play-spike.md on feat/native-experience.

Pi prereqs DONE: check-n1-prereqs.sh PASS, mpv+socat+node20, /etc/mango/stremio-export.json (5 addons: Cinemeta, AIOStreams, Torrentio RD/TB). N0 gate PASS. Scaffold exists under scripts/phase-n1/ and src/catalog-service/ (stub).

Think first: write docs/N1-INVENTORY.md §Plan before feature code. Spikes S0→S6 in order. Implement spike-core-boot.mjs + catalog-service (:3020) + stack + pad mpv/⌂. No launcher UI. SSH mango, git-only deploy, gate-n1-smoke.sh + gate-n0.sh must exit 0. No Stremio desktop gate pass.

Read docs/tasks/CODEX-phase-n1-prompt.md for full binding spec.
```
