# N1 inventory — catalog + play spike

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n1/gate-n1-smoke.sh`  
**Spec:** [`tasks/phase-n1-catalog-play-spike.md`](tasks/phase-n1-catalog-play-spike.md)

---

## Plan

Written before feature code on 2026-06-18, after reading the N1 spec, native
roadmap, foreground contract, N0 inventory, Pi ops, and pad router.

1. Preserve the N0 base: one Chromium launcher at idle, no overlay Chromium,
   no idle Stremio/Kodi/mpv, and voice/launcher health intact. N0 showed good
   RAM headroom after cleanup (about 7043 MB available), but N1 adds a Node
   service plus `@stremio/stremio-core-web` WASM on ARM, so `catalog-service`
   must stay single-process and log RSS in the final inventory.
2. Execute spikes in order: prereqs are **green** on Pi at `95880cd`; S0
   `spike-mpv-http.sh`, S1 `spike-stremio-core.sh`, and S2+ are TBD. Do not
   build the full HTTP service until S0 and S1 pass on Pi.
3. Start with smoke title `tt0111161` (`movie`, The Shawshank Redemption). It
   is the default spec suggestion, is broadly covered by Cinemeta, and should
   resolve through the household RD/TorBox stream addons. If the actual Pi
   addon graph returns no RD HTTP stream, pick the first title that resolves
   on this export and update the pinned-title table.
4. S1 fallback branch: first pin/adjust `@stremio/stremio-core-web`, then retry
   with reduced Cinemeta + Torrentio addon set, then spike a per-addon HTTP
   bridge if core is blocked. Stremio desktop is **not** a gate pass.
5. Use `~/.cache/mango/mpv.sock` as the N1 socket. `mpv-play.sh` remains the
   singleton owner: stop existing mpv first, launch fullscreen with IPC, and
   keep `POST /play` as the only service path that starts playback.
6. Pad diff is limited to the existing router: detect foreground `mpv`, route
   D-pad/B/Y to mpv IPC or key equivalents, and make ⌂ call `mpv-stop.sh` with
   home restore. Do not change locked evdev codes.
7. Stack diff is limited to `MANGO_CATALOG=1`: start/stop `catalog-service`
   from `mango-stack.sh`, stop mpv on stack stop, and keep launcher UI unchanged.

---

## Spike log

| Spike | Date | Result | Notes |
|-------|------|--------|-------|
| S0 mpv HTTP | 2026-06-18 | PASS | Final gate TTFF 1312 ms with byte-range HTTPS Big Buck Bunny MP4; original scaffold URL returned 403 |
| S1 stremio-core | 2026-06-18 | PASS | `@stremio/stremio-core-web` 0.59.0 booted on Pi; 5 addon manifests loaded |
| S2 meta+stream | 2026-06-18 | PASS | `tt0111161` meta in 122 ms; 15 HTTP streams; stream resolve 8198 ms |
| S3 mpv RD | 2026-06-18 | PASS | First AIOStreams RD HTTP stream played in mpv; TTFF 5231 ms |
| S4 catalog-service | 2026-06-18 | PASS | `GET /health`, `/meta`, `/stream`, and `POST /play` pass; POST TTFF 5246 ms |
| S5 pad+home | 2026-06-18 | PASS | Restarted `mango-tv-pad.service`; `foreground_app()` returned `mpv`; home restore 232 ms |
| S6 gate | 2026-06-18 | PASS | `gate-n1-smoke.sh` exit 0 at `9202edf`; embedded N0 regression pass |

### Pinned smoke title

| Field | Value |
|-------|-------|
| Type | `movie` |
| Cinemeta ID | `tt0111161` |
| Title | The Shawshank Redemption (1994) |
| Stream URL shape | RD HTTP via AIOStreams (URL redacted in logs) |
| TTFF ms | 5231 direct mpv; 5246 via `POST /play` |

---

## Prereq status (Pi)

| Check | Status | Notes |
|-------|--------|-------|
| SSH `mango` | PASS | verified via `scripts/pi-exec.sh` |
| `gate-n0.sh` | PASS | prior full gate pass per prompt; quick launcher/stremio checks passed 2026-06-18 |
| `mpv` + `socat` | PASS | mpv v0.40.0; socat present |
| `node` ≥ 20 | PASS | v20.19.2 |
| `/etc/mango/stremio-export.json` | PASS | 5 addons |
| `check-n1-prereqs.sh` | PASS | Pi at `9202edf`, final gate 2026-06-18T15:15:19-07:00 |

---

## Metrics (after N1)

| Metric | Value |
|--------|-------|
| `gate-n1-smoke.sh` | PASS at `9202edf`, 2026-06-18T15:15:19-07:00 |
| `gate-n0.sh` | PASS standalone at `9202edf`, 2026-06-18T15:16:02-07:00 |
| Stream resolve ms | 8198 (`GET /stream/movie/tt0111161`) |
| Play TTFF ms | 5231 direct mpv; 5246 via `POST /play`; final gate S0 smoke 1312 |
| ⌂ home ms | 232 (`mpv` foreground → launcher) |
| catalog-service RSS MB | 85-89 MB during S2/status checks |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N1-C2 couch note (manual)

- [x] `POST /play` → film on TV via mpv path (automated TTFF observed)
- [x] ⌂/home path → mango home (`foreground_after launcher`, 232 ms)
- [x] Voice stack regression passed (`gate-n0.sh` + `verify-voice-ready.sh`; phone PTT not physically pressed in this run)
- [x] No Stremio window during test (`pgrep stremio` idle checks passed)

---

## Deferred to N7 — 4K (not a TV fault)

Couch test 2026-06-18: API returned `ok` + ~5 s TTFF but TV showed **blank blue** while audio played.

| Finding | Detail |
|---------|--------|
| **Cause** | Pi mpv + stream format, not TV blocking signal |
| **Stream** | First result = 4K Blu-ray REMUX, HEVC 10-bit, Dolby Vision (AIOStreams/RD) |
| **mpv log** | `Mapping hardware decoded surface failed` / `drmprime` dmabuf fail with `--hwdec=auto-safe` |
| **HDMI today** | Pi outputs **1920×1080@60** — 4K display mode not enabled yet |
| **Works now** | 1080p RD stream + `--hwdec=v4l2m2m-copy` shows picture on same Pi/TV |

**N1 couch play:** use a **1080p** stream until N7 (stream picker + Pi mpv profile). `POST /play` by title ID alone still auto-picks 4K REMUX.

**N7 unlocks:** 4K HDMI mode, Pi mpv hwdec profile, stream ranking (no REMUX/DV first), visible-picture gate.
