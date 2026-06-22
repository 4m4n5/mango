# mango — implementation roadmap

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md) · **Shipped detail:** [STATUS.md](STATUS.md)

This is the **single implementation plan**. Older `N0`–`N7` and `Phase 0–2` labels are kept only as script/gate aliases — see [Legacy aliases](#legacy-aliases).

---

## At a glance

```
M1 Foundation     ████████████████████  shipped
M2 Browse         ████████████████████  shipped
M3 Play           ████████████████████  shipped
M4 Addons         ████████████████████  shipped
M5 Voice + AI     █████████████████░░░  mostly shipped (N5c polish remains)
M6 Ship           ░░░░░░░░░░░░░░░░░░░░  next — 4K HDR · library · YouTube · plug-and-play
```

| Milestone | Outcome | Status |
|-----------|---------|--------|
| **M1** Foundation | Pi stack · pad · launcher kiosk · voice HUD · gates | ✓ |
| **M2** Browse | `catalog-service` rails · Movies / Series / Live tabs · 9-up grid | ✓ |
| **M3** Play | mpv orchestrator · picker · episodes · progress · playability pools | ✓ |
| **M4** Addons | Self-hosted AIOStreams + AIOMetadata on Pi | ✓ |
| **M5** Voice + AI | Phone librarian · Hinglish STT · AI catalog slots · living librarian | ◐ |
| **M6** Ship | Library sync · YouTube · **4K HDR** · soundbar · TTS · first-boot wizard | planned |

---

## Current stack

```
Pi 5 · X11 + Openbox
├── mango-stack.sh              start/stop base stack
├── serve.py :3000              launcher static + API
├── Chromium kiosk              mango-launcher (one instance at idle)
├── mango-tv-pad.py             pad: launcher · mpv · fallback
├── catalog-service :3020       stremio-core · rails · play · voice tools
├── mpv                         primary player
├── orchestrator :8765          voice (when MANGO_VOICE=1)
├── companion :3001             phone PWA (HTTPS)
├── AIOStreams :3035            stream aggregator (self-hosted)
├── AIOMetadata :3036           mdblist / regional catalogs
├── NexoTV Docker :7000/:7001   live IPTV (optional)
└── Stremio / Kodi              fallback only (opt-in env)
```

---

## M1 — Foundation ✓

**Was:** Phase 0–2 on `main` + native **N0**

- X11 + Openbox Pi bring-up · 8BitDo pad · Chromium kiosk
- `mango-stack.sh` — one Chromium at idle · no Stremio/Kodi/mpv at idle
- Voice pipeline shell (orchestrator + companion + launcher HUD)
- Foreground contract: `launcher | mpv | fallback_stremio`
- Gates: `gate-m1.sh` · `gate-lite.sh` · `pi-pre-couch-gate.sh`

**Ops:** [OPS.md](OPS.md) · **Pad:** [HARDWARE.md](HARDWARE.md)

---

## M2 — Browse ✓

**Was:** **N1** catalog spike + **N2** / **N2b** browse UI

- `catalog-service` on `:3020` with `@stremio/stremio-core-web`
- `config/catalog.yaml` rails — addon catalogs, mdblist, Cinemeta charts
- Launcher tabs: **Movies · Series · Live**
- 9-up poster grid · L/R tab shoulders · ↻ shuffle
- `GET /rails` · proxy via `serve.py` `/api/catalog/*`

**Gate:** `scripts/m2-catalog/browse/gate-m2-browse.sh`

---

## M3 — Play ✓

**Was:** **N3a** orchestrator · **N3b** picker/progress · **N3c** playability · **N3e** episodes · Track B UX

| Capability | Notes |
|------------|-------|
| Play ladder | `config/catalog-filters.json` tiers · parallel resolve · 90 s wall |
| Stream picker | `GET /stream` enriched rows · tap to play |
| Continue watching | `progress.db` + mpv position watcher |
| Episode picker | Per-episode streams · next-up overlay · cancel-on-Y |
| Playability index | Verified pools · quick/nightly/overnight grow jobs |
| Browse UX | Thin verified rails · empty rails hidden · rate-limit safe |

**Gates:** `gate-m3-play-ladder.sh` · `gate-m3-detail.sh` · `gate-m3-episodes.sh` · `gate-m3-verified-rails.sh` (full: `MANGO_GATE_FULL=1`)

**Couch:** [COUCH_TEST.md](COUCH_TEST.md)

---

## M4 — Self-hosted addons ✓

**Was:** **N3d**

- AIOStreams `:3035` — dedup, debrid order, formatter (policy upstream)
- AIOMetadata `:3036` — mdblist + regional catalogs
- Export contract: Cinemeta + AIOStreams + AIOMetadata only
- Stream + catalog gate corpus in `config/stream-gate-fixtures.json`

**Gate:** `scripts/m4-addons/gate-m4-self-hosted.sh`  
**Deep dive:** [reference/aiostreams-profile.md](reference/aiostreams-profile.md) · [reference/addon-stack.md](reference/addon-stack.md)

---

## M5 — Voice + AI ◐

**Was:** **N5a** · **N5b** · **N5d** (compose/bootstrap) · **N5c** (partial)

| Slice | Status | Notes |
|-------|--------|-------|
| Voice librarian (N5a) | ✓ | Search · open detail · Hinglish STT · librarian notes |
| AI catalog slots (N5b) | ✓ | Max 3/tab · voice CRUD · playability pools |
| Living librarian (N5c) | ◐ | Companion memory · profile · conversation policy |
| AI catalog bootstrap (N5d) | ✓ | Compose · reserve · async bootstrap · in gate-lite |

**Voice:** [VOICE.md](VOICE.md) · **Gate:** `scripts/m5-voice/ai/gate-m5-voice.sh`

---

## M6 — Ship (next)

**Was:** **N4** · **N6** · **N7** · Phase 5 install wizard

Target: **world-class 4K HDR plug-and-play AI TV box** on Pi 5 (or documented hardware upgrade path).

### M6.1 — Library sync (was N4)

- Stremio export import as source of truth for library rail
- Merge Continue: Stremio library → mango resume
- Finished → write-back to Stremio library (best-effort)
- Progress backup on exit / cron

### M6.2 — YouTube (was N6)

- yt-dlp resolve → mpv play
- Dedicated YouTube rail · voice `play_youtube`
- Deprecate Kodi YouTube tile when gate passes

### M6.3 — 4K HDR living room (was N7)

**Dev lab constraint:** Pi 5 + X11 + `hwdec=auto-safe` blanks on REMUX/DV/10-bit HEVC — validated on 1080p monitor.

**Ship deliverables:**

| Area | Work |
|------|------|
| Physical | 4K TV + soundbar (HDMI eARC) |
| HDMI | 4K mode · EDID verification |
| mpv profile | `v4l2m2m-copy` · `--gpu-context=x11egl` · stream rank for WEB-DL 4K |
| Audio | Default sink = TV/bar · enable Piper TTS smoke |
| Filters | Relax lab `max_quality` / `exclude_remux` only on ship profile |
| Fallback | Stremio desktop on exhaustion |
| Persistence | systemd units for full stack |
| Gate | 4K smoke — **picture-visible** assert, not just TTFT |

### M6.4 — Plug-and-play

- `install.sh` + first-boot wizard (no SSH required for household setup)
- Merge criteria to `main`
- Optional: NVMe / USB DAC evaluation in [HARDWARE.md](HARDWARE.md)

### Live TV (shipped, opt-in gates)

NexoTV dual instance · sport rails · excluded from default deploy gate. [LIVE_TV.md](LIVE_TV.md)

---

## Gate strategy

| Command | When |
|---------|------|
| `bash scripts/pi-exec-gate.sh` | **Default** before couch — gate-lite on Pi |
| `bash scripts/pi-deploy.sh --fast --gate` | After Mac push — deploy + gate |
| `MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh` | Release handoff — per-rail play sweep |
| `MANGO_LIVE_GATE=1 bash scripts/live/gate-live-iptv.sh` | Live IPTV only — never in gate-lite |

Details: [STATUS.md](STATUS.md#gates) · [ARCHITECTURE.md](ARCHITECTURE.md#gates)

---

## Legacy aliases

Scripts and git history use older phase IDs. Map them here — **do not create new N-letter sub-phases.**

| Alias | Milestone | Meaning |
|-------|-----------|---------|
| Phase 0–2 | M1 | Pi foundation · launcher · voice on `main` |
| N0 | M1 | Native foundation reset |
| N1 | M2 | catalog-service + mpv spike |
| N2, N2b | M2 | Browse UI + thematic rails |
| N3a | M3 | Play orchestrator |
| N3b | M3 | Stream picker + progress |
| N3c | M3 | Playability index |
| N3d | M4 | Self-hosted addons |
| N3e | M3 | Episode picker |
| Track B | M3 | Verified rails browse UX |
| N4 | M6.1 | Library sync |
| N5a | M5 | Voice tools |
| N5b | M5 | AI catalog slots |
| N5c | M5 | Living librarian |
| N5d | M5 | AI catalog bootstrap |
| N6 | M6.2 | YouTube |
| N7 | M6.3 | 4K HDR ship |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| 4K HEVC/DV on Pi 5 X11 | Ship profile + stream rank; document hardware limits |
| Phone mic on HTTP | mkcert HTTPS companion |
| Refocus fail → wallpaper | Always restore launcher |
| RAM: Chromium + mpv + voice | One Chromium; mpv exits on ⌂ |
| stremio-core on ARM | Proven in M2 — monitor on addon upgrades |
| yt-dlp breakage | Pin version; Kodi emergency fallback |
| False watchdog restart | `tv_pad` health signal |

---

## References

| Doc | Use |
|-----|-----|
| [VISION.md](VISION.md) | Product principles |
| [STATUS.md](STATUS.md) | Feature inventory · config · ops commands |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layer boundaries · API contracts |
| [DEPLOY.md](DEPLOY.md) | Pi deploy (git only) |
| [archive/](archive/) | Superseded docs |
