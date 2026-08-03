# Full couch UX — home acceptance report

**Date:** 2026-08-03 (UTC) · **Agent:** home Mac on Pi LAN  
**Branch:** `feat/native-experience`  
**Environment:** Raspberry Pi 5 TV box + physical TV + 8BitDo Micro (no pairing-mode entries this session)

## 1. Identity

| Role | SHA |
|------|-----|
| **Pi starting SHA** (pre-range) | `b4d4f8772c9f16993a12a90085fd372c276ed5c7` |
| **Assignment ancestry marker** | `450581c24536c6e2a4d5d662dde7b10ea7404470` |
| **Final tip** (Mac = origin = Pi) | `f0a0f95f89e1a6d03ab964b3ce73abc8cd3c8a60` |

Ancestry proved: `PI_START` ⊂ tip; `450581c` ⊂ tip. No pending commit skipped.

### Ordered pending range `b4d4f87..f0a0f95`

1. `240d7c5` docs(ux): add full couch acceptance handoff  
2. `393a206` fix(playback): make ladder handoff atomic  
3. `f286f33` docs(ux): make home acceptance automation-first  
4. `450581c` docs(deploy): require full pending branch range  
5. `4f66391` fix(launcher): thaw before Chromium GL restart *(home-agent)*  
6. `f0a0f95` fix(diag): run playback-ladder-health without jq *(home-agent)*

### Subsystem map (range)

| Area | Paths / effect |
|------|----------------|
| Playback ladder / ownership | `play-orchestrator`, `playback-ownership`, `play-error-classify`, `resolve-metrics`, `mpv-play.sh`, tests |
| Launcher power / freeze | `launcher-power.sh` — thaw-then-restart (kill-while-frozen reverted) |
| Diag | `scripts/diag/playback-ladder-health.sh` (python3, no jq) |
| Docs / contract | ARCHITECTURE, PLAYABILITY, COUCH_TEST, STATUS, OPS, DECISIONS, acceptance specs |

## 2. Deploy and gates

Commands:

```bash
bash scripts/pi-deploy.sh --full --gate   # tip f0a0f95
bash scripts/pi-exec-gate.sh              # final regression (this session)
```

| Gate | Result |
|------|--------|
| `--full --gate` (post-reboot tip) | **PRE-COUCH: PASS** (M5 voice PASS; gate-lite PASS; reliability PASS w/ 2 yellow warnings) |
| Chromium FreezerState | `running` after approved reboot recovery |
| Search smoke / stream-picker | PASS |
| AIO policy (TB uncached retained; RD uncached excluded) | PASS |
| Final `pi-exec-gate` (2026-08-03T00:39Z) | **PRE-COUCH: PASS** · M6 playback/4K/stream-picker PASS · reliability **yellow** (usable) · throttle `0x0` · mem avail ~5639 MB |

### Home-agent patches

| SHA | Subject | Why | Rollback |
|-----|---------|-----|----------|
| `4f66391` | thaw before Chromium GL restart | Kill-while-frozen left unit permanently `FreezerState=frozen`; SPA owns snapshot durability | revert commit |
| `f0a0f95` | playback-ladder-health without jq | Pi has no `jq`; diag must run URL-free on box | revert commit |

## 3. S2 — Screenshot / state traversal

Pad-nav HTTP traversal + `capture-tv.sh` (1920×1080). Distinct checksums prove input landed.

| Label (UTC) | Checksum (sha256 prefix) | Foreground / expected | Inspection |
|-------------|--------------------------|-----------------------|------------|
| `launcher-home-clean-20260803T003106Z` | `1c33e992…` | Home rails; Search tab focus | Brand, rails, safe area OK; Search focus visible |
| `home-rails-20260803T003206Z` | `71baf695…` | Home after restart | Same composition; distinct bytes vs clean |
| `search-surface-20260803T003249Z` | `ee14441e…` | Search; focus on `Q` | OSK + recent list readable; focus ring clear |
| `home-after-search-back-20260803T003251Z` | `2e088761…` | Home after Y/back | Distinct from Search |
| `detail-surface-20260803T003255Z` | `5e10a586…` | Detail (*A Cinderella Story*); Play focused | Synopsis/actions/related OK; streams “finding…” |
| `home-after-detail-back-20260803T003257Z` | `f6d9eaa3…` | Home; focus restored to *A Cinderella Story* on saved | Focus restore PASS |

**HUD fixtures** (`/tmp/mango-hud-fixtures`, 13 PNGs, distinct checksums): buffering, confirmation, live, paused, playing, seek, streams-\*, volume — rendered on Pi; not committed.

Screenshots stay on Pi `/tmp` only (not committed; may include library posters).

## 4. S3 — `tt3268458` playback ownership

Title: **The Internet's Own Boy** (`tt3268458`).

### Cancel during load

- Start `/play-session` → cancel after ~1.5s → state `cancelled`, `ever_ready=false`
- Watched ~7s post-cancel: **no late autonomous play**; marker cleared; Chromium stayed `FreezerState=running`
- **PASS** — cancel is terminal

### Full play to ready

- B→ready ≈ **11.8 s**; `ttff_ms` 5885; `total_ms` 10613; **attempts: 1**
- Winner: `1080p_hevc_cached` / AIOStreams Easynews Search 1080p / `proven_smooth`
- During resolve: Detail ownership until handoff; freeze only after playback marker + near ready (`resolving`→`playing` with `FreezerState=frozen`)
- After `mpv-stop`: freeze thawed, marker gone, mpv gone, session `stopped` with `ever_ready=true`
- **PASS** — no black→Detail→late play on this automated path

### Ladder / topology (URL-free)

`bash scripts/diag/playback-ladder-health.sh movie tt3268458`

- `configured_stream_providers.aiostreams=1`; torrentio/mediafusion/comet direct = 0 (correct aggregate)
- Catalog display for this title: **10 streams, all Easynews** (natural for this title; not a config fail)
- Last user contributions (sanitized): `indexers.other=12` (Easynews attributed as other); `debrid.torbox=1`, `realdebrid=0`, `other=11`
- Fan-out: aiostreams only (39/39 success)

## 5. S4 — Automated regression bundle

- Services: launcher Chromium active + running freezer; catalog ready; pad device present (`tv_pad` ok)
- Pad-nav heartbeat/session healthy; synthetic pad-nav Search↔Detail traversal succeeded
- Resources (post-proof): ~2.2 GiB used / 5.6 GiB avail; load ~0.4–1.5; no playback marker; no mpv
- Display: Monitor On; **Xorg DPMS still shows Standby/Suspend/Off 600s** — intentional Mango 30m sleep/CEC **not implemented** (see DEFERRED)
- Voice/M5 covered by prior full gate PASS after Chromium recovery
- 4K dropped-frame / physical audio / CEC / pairing-cycle: **held for S5** (need human eyes/ears)

## 6. S5 — Human residual (minimal)

Automation baseline is green. Remaining items need the physical TV + Micro:

1. Home focus/readability + fast rail scrub from couch distance  
2. Search → Detail → Back feel  
3. **The Internet's Own Boy**: B-to-picture, HUD, Streams open/switch/Undo, cancel-no-late-start  
4. One Micro power cycle idle + one during launcher↔playback (no pairing mode)  
5. One voice open-detail; confirm pad B plays (not voice)  
6. One 4K/audio sample: picture, motion, sound, lip sync  
7. Display sleep/CEC only with explicit approval (product still DEFERRED)

## 7. DEFERRED

| Item | Reason | Owner | Next action |
|------|--------|-------|-------------|
| Intentional display sleep + CEC | Locked product work; Xorg still exposes 600s DPMS | home | Implement per OPS §9; then human matrix |
| MediaFusion | Share URL 404; manifest quarantined | ops | New ElfHosted URL |
| Bharat Binge | Manifest HTTP 403 | ops | Credential/host fix |
| TMDB Read Access Token | `tmdbApiAvailable` false without token | ops | Set token if needed |
| Easynews → `indexer.other` | Attribution bucket | catalog metrics | Map Easynews indexer label |
| Live mpv HUD/Streams TV perception | Fixtures rendered; human judges legibility/motion | S5 | Couch rows 3–6 |
| Physical Micro reconnect timings | Automation avoids pairing; cycles need human | S5 | Row 4 |
| Concatenated recent-search label | Observed `Internet Own BoyThe Office` in Search shot | launcher Search | Repro + fix if sticky |

## 8. Privacy / safe state

- No credentials, signed URLs, or provider payloads in this report  
- No screenshots committed  
- Box left: TV path On (DPMS Monitor On), playback stopped, Chromium running/unfrozen, pad health ok  
- **Note:** 30-minute intentional timeout not yet Mango-owned; Xorg DPMS 600s still present (DEFERRED)

## 9. Verdict

**Automated deploy + S1–S4 baseline: PASS** at tip `f0a0f95`.  
**Full definition-of-done:** blocked only on **S5 human residual** (+ display-sleep DEFERRED as pre-existing locked work).
