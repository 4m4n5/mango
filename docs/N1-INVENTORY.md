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
| S0 mpv HTTP | 2026-06-18 | PASS | Pi TTFF 1376 ms with byte-range HTTPS Big Buck Bunny MP4; original scaffold URL returned 403 |
| S1 stremio-core | | | |
| S2 meta+stream | | | |
| S3 mpv RD | | | |
| S4 catalog-service | | | |
| S5 pad+home | | | |
| S6 gate | | | |

### Pinned smoke title

| Field | Value |
|-------|-------|
| Type | `movie` |
| Cinemeta ID | _(e.g. tt0111161)_ |
| Title | |
| Stream URL shape | RD HTTP |
| TTFF ms | |

---

## Prereq status (Pi)

| Check | Status | Notes |
|-------|--------|-------|
| SSH `mango` | PASS | verified via `scripts/pi-exec.sh` |
| `gate-n0.sh` | PASS | prior full gate pass per prompt; quick launcher/stremio checks passed 2026-06-18 |
| `mpv` + `socat` | PASS | mpv v0.40.0; socat present |
| `node` ≥ 20 | PASS | v20.19.2 |
| `/etc/mango/stremio-export.json` | PASS | 5 addons |
| `check-n1-prereqs.sh` | PASS | Pi at `95880cd`, 2026-06-18T14:45:43-07:00 |

---

## Metrics (after N1)

| Metric | Value |
|--------|-------|
| `gate-n1-smoke.sh` | |
| `gate-n0.sh` | |
| Stream resolve ms | |
| Play TTFF ms | |
| ⌂ home ms | |
| catalog-service RSS MB | |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N1-C2 couch note (manual)

- [ ] `POST /play` → film on TV
- [ ] ⌂ → mango home
- [ ] Voice PTT still works
- [ ] No Stremio window during test
