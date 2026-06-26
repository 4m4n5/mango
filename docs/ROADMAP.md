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
M5 Voice + AI     █████████████████░░░  in progress — living librarian + M5.5 voice safety contract
M6 Ship           ████░░░░░░░░░░░░░░░░  in progress — M6.1 library core landed; YouTube · 4K · unified UX · wizard pending
```

| Milestone | Outcome | Status |
|-----------|---------|--------|
| **M1** Foundation | Pi stack · pad · launcher kiosk · voice shell · gates | ✓ |
| **M2** Browse | Catalog rails · Movies / Series / Live · 9-up grid | ✓ |
| **M3** Play | mpv orchestrator · picker · episodes · playability/grow | ✓ hardening |
| **M4** Addons | Self-hosted AIOStreams + AIOMetadata | ✓ |
| **M5** Voice + AI | Phone librarian · AI catalogs · living librarian · voice safety contract | ◐ |
| **M6** Ship | Mango-owned library · YouTube · 4K HDR · unified TV/companion UX · plug-and-play | ◐ M6.1 shipped |

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

**Current hardening state:** fresh `+20` per active rail is the production target, not the default publish blocker. The system now has staged work DB publishing, VOD-only grow boot, structured failed-run JSON, 7-day grow rejection memory, source circuits, source-grow audits, orphan-only retheme, pinned overlap semantics, grow verification retry for transient zero-stream responses, and best-effort publishing for completed runs. It is not declared production-done until repeated unattended grows publish reliably and the `+20` target hit rate improves; the 2026-06-25 Pi evidence showed an abort/discarded nightly plus remaining source-yield blockers for `series-reality-casual` and `series-india-picks`, not couch publishing or stale config.

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
| **M5.5 Voice safety contract** | — | Capability review + open/clarify gates — **M5 merge blocker**; final companion/HUD polish after YouTube |

### M5.5 — AI companion contract + UX split

Half the north star is *ask in mango*. The implementation is split so Mango does not polish the companion twice: **M5.5a** locks the voice safety contract before more surfaces land, and **M5.5b** finishes phone/HUD polish after native YouTube exists.

| Area | Work |
|------|------|
| **M5.5a contract** | Full `mango_*` tool audit · Hinglish corpus · discover/open/curate/memory lanes · ordinals · no false TV opens |
| **M5.5a coherence** | Phone/TV agreement · `tv_seq` ack · async catalog copy · mock + opt-in LLM corpus gates |
| **M5.5b polish** | Phone tool transparency · proactive opt-in · memory summary · launcher HUD safe area, copy, and dwell |
| Acceptance | C-V1–C-V8 safety now; post-YouTube companion/HUD pass before M6.5 merge |

**Spec:** [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)

**M5 complete when:** living librarian infrastructure **and** M5.5a voice safety contract both pass. M5.5b polish is part of the post-YouTube M6.5 ship bar.

**Detail:** [VOICE.md](VOICE.md) · **Gate:** `scripts/m5-voice/ai/gate-m5-voice.sh`

---

## M6 — Ship (in progress)

Target: **world-class 4K HDR plug-and-play AI TV box** on Pi 5 (or documented hardware upgrade path).

### M6.1 — Mango-owned library ✓

- Mango is the user-library source of truth: explicit **Saved**, automatic watch history, finished state, dormant hidden/blocked fields, and taste/profile hooks
- `library.db` is durable local SQLite at `/etc/mango/library.db`, source-aware for future YouTube; `progress.db` remains the Continue/resume source in M6.1 and mirrors history/finished into the library
- The launcher shows **Saved** immediately after Continue, detail exposes Save/Unsave, and existing user-facing Pins import once into Saved; internal rail-curation pins remain operator-only playability policy
- `/library/state`, `/library/saved`, `/library/history`, and `/library/context` are first-class APIs; `/pins` remains a Saved-backed compatibility wrapper
- Voice exposes `mango_save_title` / `mango_unsave_title` for current context or exact title, without playback or hide/unhide
- AI/catalog automation cannot write to Saved; AI catalog overflow is replace/merge only
- Stremio export remains addon-manifest config only; no Stremio library sync or write-back
- Back up Mango progress + library state on stack stop/restart via `scripts/m6-ship/backup-library-state.sh`; cron/timers can call the same script

### M6.2 — YouTube

- `yt-dlp` resolve → mpv play
- Dedicated YouTube rail/search/detail with Mango-owned history/resume where practical
- Voice opens YouTube results/detail; pad **B** starts playback under the same voice contract
- Deprecate legacy Kodi YouTube fallback when the native gate passes

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

### M6.5 — Unified TV/companion UX ship polish

Functional gates ≠ ship quality. After Mango Library, native YouTube, and 4K ship surfaces exist, polish the **10-foot launcher + companion/HUD flow** for 3 m viewing — type, focus, safe area, couch-safe copy, latency feel, and voice coherence across Movies, Series, Live, and YouTube.

**Spec:** [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md) · **Acceptance:** COUCH_TEST U1–U9 · `gate-m6-ux-smoke.sh`

### M6.4 — Plug-and-play

- `install.sh` + first-boot wizard (no SSH for household setup)
- Merge to `main` (requires M6.5 sign-off)
- Optional: NVMe / USB DAC — [HARDWARE.md](HARDWARE.md)

**Ship order:** M5.5a → M6.1 Mango Library → M6.2 YouTube → M6.3 4K → M5.5b/**M6.5** unified UX → M6.4 wizard → merge.

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
| Companion feels dumb despite tools | M5.5a safety corpus now; M5.5b polish after YouTube |
| TV reads as dev UI at ship | M6.5 unified polish before merge |
| Stremio becomes product source of truth again | Keep `/etc/mango/stremio-export.json` to addon manifests only; Mango owns user library state |
| Grow passes but specific rails starve | Source-grow audit, probation weights, stronger same-theme playable sources |
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
