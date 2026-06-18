# mango — Implementation Plan

**Hardware:** Pi 5 8GB · 128GB SD · 8BitDo Micro · phone · TV  
**Branch:** `feat/native-experience` — **native TV experience**  
**Canonical ops:** [PHASE0.md](PHASE0.md) · [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) · [NATIVE_EXPERIENCE.md](NATIVE_EXPERIENCE.md)

---

## Current stack (native branch)

```
Pi 5 · Pi OS Desktop · X11 + Openbox
├── mango-stack.sh          daily start/stop
├── serve.py :3000          launcher + voice HUD embed + launch API
├── Chromium kiosk          mango-launcher (one Chromium at idle)
├── mango-tv-pad.py         pad owner: launcher · mpv (N1) · fallback apps
├── orchestrator :8765      WSS phone · loopback :8766 TV HUD
├── companion :3001         HTTPS PWA · PTT + chat
├── catalog-service :3020   N1 — stremio-core + addons → mpv
├── mpv                     N1 primary player (fullscreen)
└── Stremio / Kodi          fallback only (opt-in env)
```

| Layer | Shipped | In progress |
|-------|---------|-------------|
| Lean base stack (N0) | ✓ | — |
| Voice pipeline (Phase 2) | ✓ | Piper TTS on HDMI (optional) |
| Pad routing (B/Y/⌂/D-pad) | ✓ | mpv + ⌂ home (N1) |
| **catalog-service + mpv** | — | **N1** ← now |
| Browse rails (N2) | — | catalog.yaml |
| LLM media tools (N3+) | — | after rails |

**Repo layout:**

```
src/launcher/           TV UI + voice-hud.ts
src/catalog-service/    Stremio-core bridge (N1)
src/orchestrator/       voice hub
src/companion/          phone PWA
src/mango-ui-server/    serve.py
scripts/mango-stack.sh  native base stack
scripts/phase-n0/       gates
scripts/phase-n1/         mpv + catalog spikes
scripts/phase0/         pad, Kodi, Stremio fallback
scripts/phase1/         UI bring-up
scripts/phase2/         voice stack
```

---

## Timeline

```
Phase 0–2    Pi foundation + launcher + voice           ✓ shipped
Phase 1.5    Couch launch polish                        ✓ 2026-06-18
N0           Foundation reset (lean stack, HUD, gates)  ✓
N1           catalog-service + one title → mpv          ← now
N2           Browse rails (catalog.yaml)
N3           Stream picker + progress
N4           Library + Continue watching
N5–N7        AI catalogs · YouTube · 4K ship
Phase 5      install.sh + first-boot wizard (ongoing)
```

**Native phases:** [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) · **Vision:** [NATIVE_EXPERIENCE.md](NATIVE_EXPERIENCE.md)

---

## Phase 1.5 — Launch polish ✓ (archive)

Historical couch sign-off on `main` before native fork. Matrix: [phase0-checklist.md](phase0-checklist.md) · session `20260618-013528`.

Rules (still binding): hide-not-kill · refocus failure → launcher · pad stays grabbed on ⌂.

---

## Phase 2 — Voice ✓

Phone PTT → Deepgram → Haiku → launcher HUD. [PHASE2.md](PHASE2.md)

Media tools deferred to native N3+ (not Phase 3 stremio-service as originally planned).

---

## Native N0 ✓

One Chromium · overlay removed · `mango-stack.sh` · `gate-n0.sh`. [N0-INVENTORY.md](N0-INVENTORY.md)

---

## Native N1 ← now

**Goal:** Prove addon graph → resolved stream → mpv fullscreen from couch.

| Spike | Proves |
|-------|--------|
| S0 | mpv HTTP IPC |
| S1 | stremio-core-web boots with export addons |
| S2–S6 | catalog-service · stack · pad · gate |

**Spec:** [tasks/phase-n1-catalog-play-spike.md](tasks/phase-n1-catalog-play-spike.md) · **Inventory:** [N1-INVENTORY.md](N1-INVENTORY.md)

**Gate:** `bash scripts/phase-n1/gate-n1-smoke.sh`

---

## N2–N7 (planned)

| Phase | Outcome |
|-------|---------|
| N2 | Real browse rails from `catalog.yaml` |
| N3 | Stream picker · watch progress |
| N4 | Library sync · Continue watching |
| N5 | LLM tool calling against catalog |
| N6 | YouTube path (Kodi or native) |
| N7 | 4K · polish · ship |

---

## Module graph (target)

```
                    ┌─────────────┐
                    │  companion  │─── HTTPS :3001
                    └──────┬──────┘
                           │ WSS :8765
                    ┌──────▼──────┐
                    │ orchestrator│─── loopback :8766 → launcher HUD
                    └──┬───┬───┬──┘
           ┌───────────┘   │   └───────────┐
           ▼               ▼               ▼
   catalog-service      mpv IPC      fallback apps
   (:3020)              (player)     (Stremio/Kodi)
           │
           ▼
   stremio-core + addons (Cinemeta, Torrentio, AIOStreams)
```

---

## Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| Phone mic blocked on HTTP | High | mkcert HTTPS companion |
| App switch kills sibling | High | hide-not-kill (locked) |
| Refocus fail → wallpaper | High | restore launcher |
| stremio-core WASM on Pi | Medium | spike S1 before full service |
| mpv stream resolve latency | Medium | cache meta; progress UI in N3 |
| RAM: Chromium + mpv + voice | Medium | one Chromium; mpv exits on ⌂ |
| Stremio .deb breaks on apt | Low | fallback only; hold package |
| False watchdog restart | Medium | `tv_pad` health |

---

## References

| Doc | Use |
|-----|-----|
| [PHASE0.md](PHASE0.md) | Pi ops |
| [FOREGROUND.md](FOREGROUND.md) | launcher \| mpv \| fallback |
| [PHASE1.md](PHASE1.md) | Launcher API |
| [PHASE2.md](PHASE2.md) | Voice |
| [DESIGN.md](DESIGN.md) | V1 historical spec |
| [DECISIONS.md](DECISIONS.md) | Locked choices |
| [HARDWARE.md](HARDWARE.md) | Pad layout |
