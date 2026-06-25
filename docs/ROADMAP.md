# mango — implementation roadmap

**Branch:** `feat/native-experience` · **Vision:** [VISION.md](VISION.md) · **Status:** [STATUS.md](STATUS.md)

Single plan for the native TV experience — milestones **M1–M6** only.

---

## At a glance

```
M1 Foundation     ████████████████████  shipped
M2 Browse         ████████████████████  shipped
M3 Play           ████████████████████  shipped
M4 Addons         ████████████████████  shipped
M5 Voice + AI     █████████████████░░░  in progress — living librarian + M5.5 ship bar
M6 Ship           ░░░░░░░░░░░░░░░░░░░░  planned — library sync · YouTube · 4K · TV UX · wizard
```

| Milestone | Outcome | Status |
|-----------|---------|--------|
| **M1** Foundation | Pi stack · pad · launcher kiosk · voice shell · gates | ✓ |
| **M2** Browse | Catalog rails · Movies / Series / Live · 9-up grid | ✓ |
| **M3** Play | mpv orchestrator · picker · episodes · playability/grow | ✓ hardening |
| **M4** Addons | Self-hosted AIOStreams + AIOMetadata | ✓ |
| **M5** Voice + AI | Phone librarian · AI catalogs · living librarian · companion UX ship bar | ◐ |
| **M6** Ship | Library · YouTube · 4K HDR · TV UI/UX polish · plug-and-play | planned |

---

## Stack

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

- X11 + Openbox Pi bring-up · 8BitDo pad · Chromium kiosk
- `mango-stack.sh` — one Chromium at idle · no Stremio/Kodi/mpv at idle
- Voice pipeline shell (orchestrator + companion + launcher HUD)
- Foreground contract: `launcher | mpv | fallback_stremio`
- Gates: `gate-m1.sh` · `gate-lite.sh` · `pi-pre-couch-gate.sh`

**Ops:** [OPS.md](OPS.md) · **Pad:** [HARDWARE.md](HARDWARE.md)

---

## M2 — Browse ✓

- `catalog-service` on `:3020` with `@stremio/stremio-core-web`
- `config/catalog.yaml` rails — addon catalogs, mdblist, Cinemeta charts
- Launcher tabs: **Movies · Series · Live**
- 9-up poster grid · L/R tab shoulders · ↻ shuffle
- `GET /rails` · proxy via `serve.py` `/api/catalog/*`

**Gate:** `scripts/m2-catalog/browse/gate-m2-browse.sh`

---

## M3 — Play ✓

| Capability | Notes |
|------------|-------|
| Play ladder | `catalog-filters.json` tiers · parallel resolve · 90 s wall |
| Stream picker | `GET /stream` enriched rows |
| Continue watching | `progress.db` + mpv position watcher |
| Episode picker | Per-episode streams · next-up overlay · cancel-on-Y |
| Playability index | Verified pools · quick/nightly/overnight grow · unique-library tracking |
| Thematic rails | Theme gate on pool writes · orphan repair · overlap caps · optional full retheme |
| Browse UX | Verified-only thin rails · empty hidden · rate-limit safe |

**Detail:** [PLAYABILITY.md](PLAYABILITY.md)

**Current hardening state:** strict fresh `+20` per active rail is the production contract. The system now has staged work DB publishing, VOD-only grow boot, structured failed-run JSON, 7-day grow rejection memory, source circuits, source-grow audits, orphan-only retheme, and pinned overlap semantics. It is not declared production-done until repeated full `+20` grows pass without manual repair, especially on India-series supply.

**Gates:** `gate-m3-play-ladder.sh` · `gate-m3-detail.sh` · `gate-m3-episodes.sh` · `gate-m3-verified-rails.sh` (full: `MANGO_GATE_FULL=1`, 3 plays/rail)

**Couch:** [COUCH_TEST.md](COUCH_TEST.md)

---

## M4 — Self-hosted addons ✓

- AIOStreams `:3035` — dedup, debrid order, formatter (policy upstream)
- AIOMetadata `:3036` — mdblist + regional catalogs
- Export contract: Cinemeta + AIOStreams + AIOMetadata only
- Stream + catalog gate corpus in `config/stream-gate-fixtures.json`

**Gate:** `scripts/m4-addons/gate-m4-self-hosted.sh`  
**Deep dive:** [reference/aiostreams-profile.md](reference/aiostreams-profile.md) · [reference/addon-stack.md](reference/addon-stack.md)

---

## M5 — Voice + AI ◐

| Slice | Status | Notes |
|-------|--------|-------|
| Voice librarian | ✓ | Search · open detail · Hinglish STT |
| AI catalog slots | ✓ | Max 3/tab · voice CRUD · playability pools |
| Living librarian | ◐ | Profile · journal · conversation policy · reflection |
| AI catalog bootstrap | ✓ | Compose · reserve · async bootstrap |
| **M5.5 Companion UX ship bar** | — | Capability review + phone/HUD polish — **M5 merge blocker** |

### M5.5 — AI companion UX ship bar

Half the north star is *ask in mango*. Infrastructure can pass gates while the companion still feels like a debug console. **M5.5** makes the living librarian ship-ready across phone, orchestrator, and TV HUD.

| Area | Work |
|------|------|
| Capability review | Full `mango_*` tool audit · Hinglish corpus · persona/policy alignment |
| Agent quality | Discover / open / curate / memory lanes · ordinals · no false TV opens |
| Phone companion | PTT · tool transparency · proactive opt-in · memory summary |
| TV voice HUD | Ephemeral card · safe area · opt-in proactive (≤1/day) |
| Coherence | Phone/TV agreement · `tv_seq` ack · async catalog copy |
| Acceptance | Couch C-V1–C-V8 · `gate-m5-companion-couch.sh` · opt-in LLM integration |

**Spec:** [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)

**M5 complete when:** living librarian infrastructure **and** M5.5 ship bar both pass.

**Detail:** [VOICE.md](VOICE.md) · **Gate:** `scripts/m5-voice/ai/gate-m5-voice.sh`

---

## M6 — Ship (planned)

Target: **world-class 4K HDR plug-and-play AI TV box** on Pi 5 (or documented hardware upgrade path).

### M6.1 — Library sync

- Stremio export import as source of truth for library rail
- Merge Continue: Stremio library → mango resume
- Finished → write-back to Stremio library (best-effort)
- Progress backup on exit / cron

### M6.2 — YouTube

- yt-dlp resolve → mpv play
- Dedicated YouTube rail · voice `play_youtube`
- Deprecate Kodi YouTube tile when gate passes

### M6.3 — 4K HDR living room

**Dev lab:** Pi 5 + X11 + `hwdec=auto-safe` blanks on REMUX/DV/10-bit HEVC — validated on 1080p monitor.

| Area | Work |
|------|------|
| Physical | 4K TV + soundbar (HDMI eARC) |
| HDMI | 4K mode · EDID verification |
| mpv profile | `v4l2m2m-copy` · `--gpu-context=x11egl` · stream rank for WEB-DL 4K |
| Audio | Default sink = TV/bar · Piper TTS smoke |
| Filters | Relax lab `max_quality` / `exclude_remux` on ship profile only |
| Gate | 4K smoke — **picture-visible** assert |

### M6.5 — TV UI/UX ship polish

Functional gates ≠ ship quality. Polishes the **10-foot launcher** for 3 m viewing — type, focus, safe area, couch-safe copy, latency feel.

**Spec:** [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md) · **Acceptance:** COUCH_TEST U1–U8 · `gate-m6-ux-smoke.sh`

### M6.4 — Plug-and-play

- `install.sh` + first-boot wizard (no SSH for household setup)
- Merge to `main` (requires M6.5 sign-off)
- Optional: NVMe / USB DAC — [HARDWARE.md](HARDWARE.md)

**Ship order:** M6.1 → M6.2 → M6.3 → **M6.5** → M6.4 wizard → merge.

### Live TV (shipped · opt-in)

NexoTV · sport rails · excluded from default gate. [LIVE_TV.md](LIVE_TV.md)

---

## Gates

| Command | When |
|---------|------|
| `bash scripts/pi-exec-gate.sh` | **Default** before couch (gate-lite) |
| `bash scripts/pi-deploy.sh --fast --gate` | After push — deploy + gate-lite |
| `MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh` | Release — full gate (3 plays/rail, ~5–8 min) |
| `MANGO_LIVE_GATE=1 bash scripts/live/gate-live-iptv.sh` | Live IPTV only |

Details: [STATUS.md](STATUS.md#gates) · [ARCHITECTURE.md](ARCHITECTURE.md#gates)

---

## Risk register

| Risk | Mitigation |
|------|------------|
| 4K HEVC/DV on Pi 5 X11 | Ship profile + stream rank; document limits |
| Phone mic on HTTP | mkcert HTTPS companion |
| Refocus fail → wallpaper | Always restore launcher |
| RAM: Chromium + mpv + voice | One Chromium; mpv exits on ⌂ |
| yt-dlp breakage | Pin version; Kodi emergency fallback |
| Companion feels dumb despite tools | M5.5 capability review + couch corpus |
| TV reads as dev UI at ship | M6.5 polish before merge |
| Grow passes but specific rails starve | Source-grow audit, probation weights, stronger same-theme sources |
| Verified orphans/overlap drift | Strict publish finalization + orphan-only/overlap-only repair |

---

## References

| Doc | Use |
|-----|-----|
| [VISION.md](VISION.md) | Product principles |
| [STATUS.md](STATUS.md) | Shipped inventory · config |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Layers · APIs |
| [DEPLOY.md](DEPLOY.md) | Pi deploy (git only) |
| [archive/](archive/) | Historical docs |

---

## Appendix — legacy names

Git history and some script paths still use older labels. **Do not use these in new docs or milestones.**

| Legacy | Milestone |
|--------|-----------|
| Phase 0–2 | M1 |
| N0 | M1 (foundation reset) |
| N1 | M2 (catalog + mpv) |
| N2, N2b | M2 (browse UI) |
| N3a, N3b, N3e, Track B | M3 |
| N3c | M3 (playability) |
| N3d | M4 |
| N4 | M6.1 |
| N5a–N5d | M5 slices (see STATUS) |
| N6 | M6.2 |
| N7 | M6.3 |
