# Phase N1 — Catalog + play spike

**Status:** ✓ Shipped (couch sign-off 2026-06-19)  
**Branch:** `feat/native-experience`  
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md)  
**Codex prompt:** [`CODEX-phase-n1-prompt.md`](CODEX-phase-n1-prompt.md)  
**Prerequisite:** N0 gate passes (`bash scripts/phase-n0/gate-n0.sh` exit 0) · pad routes launcher · voice HUD ok

---

## 1. Objective

Prove the **native playback path** on the Pi before any browse UI:

```
Cinemeta meta ID → stremio-core addon graph → RD HTTP stream URL → mpv fullscreen
```

N1 is a **spike + contract lock**, not a product surface. Success is one automated gate and a documented inventory — not pretty launcher rails (N2).

### Success definition

An agent can SSH to `mango`, run **one gate script**, and get:

| Artifact | Requirement |
|----------|-------------|
| `docs/N1-INVENTORY.md` | Spike results, pinned title ID, TTFF ms, waiver table (empty or signed) |
| `catalog-service` | `GET /health` 200; `GET /meta/movie/:id`; `GET /stream/movie/:id`; `POST /play` |
| mpv | Plays RD HTTP stream fullscreen; IPC socket documented |
| Pad | ⌂ from mpv restores launcher &lt; 300 ms (measured best-effort) |
| Stack | `mango-stack.sh` starts catalog-service when `MANGO_CATALOG=1` |
| N0 regression | `gate-n0.sh` still passes after N1 changes |

---

## 2. Non-goals

| Out of scope | Phase |
|--------------|-------|
| Launcher browse rails / posters UI | N2 |
| `catalog.yaml` rail config | N2 |
| Stream picker UI (2–5 options) | N3 |
| `progress.db` / resume | N3 |
| Stremio library import / Continue | N4 |
| AI catalogs / voice `play_title` | N5 |
| yt-dlp YouTube | N6 |
| 4K tuning / hwdec matrix | N7 |
| Stremio desktop as **N1 gate pass** | Never — fallback is N7 |

**Do not** add in-browser `<video>` playback in Chromium.

---

## 3. Design principles (binding)

Apply **`$mango-tv-box-expert`** for this phase:

| Principle | N1 meaning |
|-----------|------------|
| **Spike before integrate** | No `catalog-service` feature code until S0–S2 pass on Pi |
| **Single playback owner** | One mpv process + one IPC socket; catalog-service is the only launcher |
| **Foreground contract** | States: `launcher` \| `mpv` only; pad is input owner in both |
| **Chromium = UI shell** | Decode only in mpv ([Pi 5 browser HEVC limits](https://gist.github.com/schickling/089f4faf412b5267508f758408f0645f)) |
| **Fail closed** | Stream resolve failure → log + exit non-zero; no silent Stremio UI |
| **Git-only Pi deploy** | Commit + push; `git pull` on Pi; never rsync |
| **Secrets** | `/etc/mango/` only; never commit |

### Orchestration analog

Android **MediaSession** separates playback from UI ([background playback](https://developer.android.com/media/media3/session/background-playback)). mango analog:

- `catalog-service` = session controller (resolve + play command)
- `mpv` = player surface
- `mango-tv-pad.py` = hardware controller
- Chromium launcher = idle shell (unchanged UI in N1)

---

## 4. Mandatory spike sequence (do not reorder)

Each spike **must pass on Pi** before the next begins. Record output in `docs/N1-INVENTORY.md`.

### S0 — mpv HTTP smoke (no Stremio)

**Purpose:** Validate Pi decode path independent of addon graph.

```bash
bash scripts/phase-n1/spike-mpv-http.sh
```

| Assert | Pass |
|--------|------|
| `mpv` installed | `command -v mpv` |
| HTTP MP4 plays 10 s | Known public URL (Big Buck Bunny) |
| Process exits cleanly | No zombie mpv after script |
| Optional hwdec | Log `hwdec` active; warn if software-only |

**Script:** `scripts/phase-n1/spike-mpv-http.sh`  
**Exit:** 0 only if playback starts within 5 s.

### S1 — stremio-core ARM boot

**Purpose:** Prove `@stremio/stremio-core-web` runs on Pi 5 aarch64 with your addon set.

```bash
bash scripts/phase-n1/spike-stremio-core.sh
```

| Assert | Pass |
|--------|------|
| Node ≥ 20 | `node --version` |
| WASM module loads | No import/runtime crash |
| Addon manifests load | Cinemeta + Torrentio + aiostreams URLs from export |
| Health log line | `stremio-core ready` or equivalent |

**Config input:** `/etc/mango/stremio-export.json` (user paste from Stremio; template in repo `config/stremio-export.example.json`).

**Decision tree if S1 fails** — document in inventory; do **not** skip to Stremio desktop:

| Step | Action |
|------|--------|
| 1 | Pin older `@stremio/stremio-core-web` version; retry |
| 2 | Reduce addon set to Cinemeta + Torrentio only; retry |
| 3 | Spike `stremio-addon-sdk` per-addon HTTP bridge (degraded; document limitations) |
| 4 | **Waiver** — mark N1 blocked; owner sign-off in inventory |

### S2 — Meta + stream resolve (pinned title)

**Purpose:** One known `tt…` ID returns meta + ≥1 playable HTTP URL via RD/aiostreams.

| Assert | Pass |
|--------|------|
| `GET /meta/movie/:id` | Title + year + poster URL |
| `GET /stream/movie/:id` | ≥1 stream with `url` field (HTTP/S) |
| Latency logged | Wall ms for stream resolve |

**Pinned title:** Agent selects **one** movie that resolves on **this** household's addons + RD. Document ID in `N1-INVENTORY.md` (default suggestion: `tt0111161` — change if blocked).

### S3 — RD stream in mpv

**Purpose:** Stream URL from S2 plays in mpv fullscreen on TV.

```bash
bash scripts/phase-n1/mpv-play.sh --url '<url from S2>'
```

| Assert | Pass |
|--------|------|
| First frame | ≤ 15 s from script start (log TTFF; target 5 s aspirational) |
| Video visible | `xdotool search --class mpv` or window name contains `mpv` |
| Audio | No silent failure; log sink used |

### S4 — catalog-service integration

Wire S2+S3 behind HTTP API (see §5).

### S5 — Pad + home contract

| Assert | Pass |
|--------|------|
| `foreground_app()` returns `mpv` when mpv focused | Unit log or diag script |
| ⌂ from mpv | mpv stopped or paused; launcher visible; &lt; 300 ms best-effort |
| D-pad in mpv | Maps to mpv keys (arrow / space / esc) via IPC or xdotool-to-mpv |
| N0 pad launcher fix preserved | `foreground_app: launcher` on home |

### S6 — Master gate

```bash
bash scripts/phase-n1/gate-n1-smoke.sh
```

Includes N0 regression subset (chromium count, no idle Stremio).

---

## 5. catalog-service contract

**Path:** `src/catalog-service/`  
**Port:** `3020` (loopback `127.0.0.1` only in N1)  
**Runtime:** Node 20+ · TypeScript preferred · `@stremio/stremio-core-web`

### Endpoints (N1 minimum)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/health` | `{ "ok": true, "core": "ready", "addons": N }` |
| `GET` | `/meta/:type/:id` | `{ id, type, name, year, poster, … }` |
| `GET` | `/stream/:type/:id` | `{ streams: [{ url, title?, quality? }] }` |
| `POST` | `/play` | Body `{ "type", "id" }` or `{ "url" }` → starts mpv; `{ "ok", "ttff_ms" }` |

### Config

| File | Purpose |
|------|---------|
| `/etc/mango/stremio-export.json` | Addon manifest URLs + auth blobs from Stremio export |
| `/etc/mango/config.yaml` | Debrid provider preference (RD/TorBox); keys for addons that need them |
| `MANGO_SMOKE_TITLE_ID` | Optional env override for gate (default in inventory) |

### Process model

- Single Node process; no cluster.
- Loads stremio-core once at boot; caches addon descriptors.
- Stream resolve errors return HTTP 502 with `{ "error": "…" }` — never empty 200.

---

## 6. mpv contract

**Socket:** `$XDG_RUNTIME_DIR/mango-mpv.sock` or `~/.cache/mango/mpv.sock`  
**Launcher script:** `scripts/phase-n1/mpv-play.sh`

### mpv flags (N1 baseline)

```
--fs
--idle=yes
--keep-open=no
--input-ipc-server=<socket>
--hwdec=auto-safe
--msg-level=all=v
```

### Singleton rules

| Rule | Rationale |
|------|-----------|
| One mpv at a time | Avoid dual-audio / focus fights |
| `POST /play` stops previous instance | Clean handoff |
| `mango-stack.sh stop` kills mpv | Stack owns lifecycle |
| IPC JSON only | [`mpv IPC`](https://github.com/mpv-player/mpv/blob/master/DOCS/man/ipc.rst) |

### Stop / home

`scripts/phase-n1/mpv-stop.sh` or `mpv-play.sh --stop`:

1. IPC `{"command":["quit"]}`  
2. `pkill -x mpv` fallback after 500 ms  
3. `launch-launcher.sh` with `MANGO_SKIP_PAD_STOP=1`

---

## 7. Deliverables

### D1 — Spike scripts

| File | Purpose |
|------|---------|
| `scripts/phase-n1/spike-mpv-http.sh` | S0 |
| `scripts/phase-n1/spike-stremio-core.sh` | S1 |
| `scripts/phase-n1/mpv-play.sh` | S3+ play helper |
| `scripts/phase-n1/mpv-stop.sh` | Home / stack stop |
| `scripts/phase-n1/mpv-ipc.sh` | Send JSON command to socket |

### D2 — catalog-service

| File | Purpose |
|------|---------|
| `src/catalog-service/package.json` | deps + start script |
| `src/catalog-service/src/index.ts` | HTTP server + core bridge |
| `src/catalog-service/src/core.ts` | stremio-core load + resolve |
| `src/catalog-service/src/mpv.ts` | spawn / IPC wrapper |

### D3 — Stack integration

| ID | Task | Acceptance |
|----|------|------------|
| D3.1 | `MANGO_CATALOG=1` in `voice.env` or stack | `ss -tlnp \| grep 3020` when stack up |
| D3.2 | `mango-stack.sh start` starts catalog-service | status prints catalog health |
| D3.3 | `mango-stack.sh stop` stops mpv + catalog | no mpv/catalog after stop |

### D4 — Pad / foreground

| ID | Task | Acceptance |
|----|------|------------|
| D4.1 | `foreground_app()` detects mpv | `xdotool` / wmctrl class `mpv` |
| D4.2 | ⌂ routes to `mpv-stop.sh` + launcher | FOREGROUND.md row satisfied |
| D4.3 | B/Y/dpad in mpv | basic transport (pause, back=stop→launcher in N1) |

### D5 — Gates & docs

| File | Purpose |
|------|---------|
| `scripts/phase-n1/gate-n1-smoke.sh` | Master N1 gate |
| `docs/N1-INVENTORY.md` | Spike log + metrics |
| `config/stremio-export.example.json` | Documented export shape |
| `docs/FOREGROUND.md` | Update mpv rows if behavior changes |
| `AGENTS.md` | N1 gate commands |

---

## 8. Validation gates

### Gate N1-A — Spikes only

```bash
bash scripts/phase-n1/spike-mpv-http.sh
bash scripts/phase-n1/spike-stremio-core.sh
```

### Gate N1-B — API + play

```bash
curl -sf http://127.0.0.1:3020/health
curl -sf "http://127.0.0.1:3020/meta/movie/${MANGO_SMOKE_TITLE_ID}"
curl -sf "http://127.0.0.1:3020/stream/movie/${MANGO_SMOKE_TITLE_ID}" | head -c 500
curl -sf -X POST http://127.0.0.1:3020/play \
  -H 'content-type: application/json' \
  -d "{\"type\":\"movie\",\"id\":\"${MANGO_SMOKE_TITLE_ID}\"}"
```

### Gate N1-C — N0 regression

```bash
bash scripts/phase-n0/gate-n0.sh
```

### Gate N1-D — Process hygiene

| Check | Pass |
|-------|------|
| `pgrep -c mpv` after stop | 0 |
| `pgrep stremio` at idle | 0 |
| `chromium_process_count` | ≤ 1 |

### Gate N1-E — Couch note (manual)

Document in `N1-INVENTORY.md`:

1. `curl POST /play` from Mac SSH → film plays on TV  
2. ⌂ → mango home visible  
3. Voice PTT still works (N0 regression)  
4. No Stremio window appeared  

---

## 9. Failure-mode table

| Failure | Symptom | Detection | Recovery |
|---------|---------|-----------|----------|
| stremio-core WASM crash | S1 exit 1 | spike log | Decision tree §4 S1 |
| RD token expired | empty streams | `/stream` 502 | User refreshes export; gate warns |
| mpv EBUSY socket | play fails | play log | `mpv-stop.sh` then retry |
| Dual mpv | audio echo | `pgrep -c mpv` > 1 | gate fail; fix singleton |
| Pad sees `other` during mpv | ⌂ dead | diag foreground | wmctrl class `mpv` |
| Chromium steals focus | black screen | screenshot | `mpv --fs` + focus check |
| catalog-service OOM | 3020 down | health fail | log RSS; reduce addon set |

---

## 10. Couch acceptance — N1-SMOKE

| # | Test | Pass |
|---|------|------|
| 1 | `gate-n1-smoke.sh` | exit 0 |
| 2 | `POST /play` pinned title | video on TV ≤ 15 s |
| 3 | ⌂ from mpv | launcher &lt; 300 ms |
| 4 | `gate-n0.sh` | exit 0 |
| 5 | Idle after stop | 0 mpv, 0 Stremio, ≤1 Chromium |

---

## 11. File change checklist

```
src/catalog-service/                    NEW (full service)
scripts/phase-n1/spike-mpv-http.sh      NEW
scripts/phase-n1/spike-stremio-core.sh  NEW
scripts/phase-n1/mpv-play.sh            NEW
scripts/phase-n1/mpv-stop.sh            NEW
scripts/phase-n1/mpv-ipc.sh             NEW
scripts/phase-n1/gate-n1-smoke.sh       NEW
scripts/mango-stack.sh                  EDIT — catalog + mpv lifecycle
scripts/phase0/mango-tv-pad.py          EDIT — mpv foreground + home
config/stremio-export.example.json      NEW
docs/N1-INVENTORY.md                    NEW (filled on Pi)
docs/FOREGROUND.md                        EDIT — mpv behavior
AGENTS.md                                 EDIT
```

---

## 12. Deploy protocol

1. Mac: commit + push `feat/native-experience`  
2. Pi: `cd ~/mango && git pull`  
3. Pi: `cd src/catalog-service && npm ci && npm run build`  
4. Pi: ensure `/etc/mango/stremio-export.json` exists (user)  
5. Pi: `MANGO_CATALOG=1 bash scripts/mango-stack.sh restart`  
6. Pi: `bash scripts/phase-n1/gate-n1-smoke.sh`  
7. Fill `docs/N1-INVENTORY.md`; commit if doc-only updates  

---

## 13. Exit criteria

- [ ] S0–S3 spikes pass on Pi  
- [ ] `catalog-service` endpoints implemented  
- [ ] `gate-n1-smoke.sh` exit 0  
- [ ] `gate-n0.sh` still exit 0  
- [ ] `N1-INVENTORY.md` with TTFF + pinned title  
- [ ] Pad ⌂ from mpv verified  
- [ ] No secrets in git  

---

## 14. Handoff to N2

N2 agent reads:

- `N1-INVENTORY.md` — proved title ID, stream shape, TTFF  
- `catalog-service` API — extend with `/rails`  
- `config/catalog.example.yaml` — rail definitions  

First N2 task: **home rail fetches real posters for one Bollywood TMDB list**.
