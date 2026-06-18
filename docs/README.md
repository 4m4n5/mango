# mango documentation

**Product direction:** native TV experience — [`NATIVE_EXPERIENCE.md`](NATIVE_EXPERIENCE.md)  
**Implementation plan:** [`NATIVE_ROADMAP.md`](NATIVE_ROADMAP.md) (phases **N0–N7**)  
**Branch:** `feat/native-experience`

---

## Start here

| You want to… | Read |
|--------------|------|
| Understand the vision | [**NATIVE_EXPERIENCE.md**](NATIVE_EXPERIENCE.md) |
| See what phase we're in | [**NATIVE_ROADMAP.md**](NATIVE_ROADMAP.md) · [`N2-INVENTORY.md`](N2-INVENTORY.md) |
| Operate the Pi day-to-day | [**PHASE0.md**](PHASE0.md) |
| Fix gamepad / home / wallpaper | [PHASE0.md § Troubleshooting](PHASE0.md) · [HARDWARE.md](HARDWARE.md) |
| Voice / phone PTT / HUD | [**PHASE2.md**](PHASE2.md) |
| Know what's on screen when | [**FOREGROUND.md**](FOREGROUND.md) |
| Locked technical choices | [DECISIONS.md](DECISIONS.md) |

---

## Native implementation (N0–N7)

| Phase | Outcome | Spec |
|-------|---------|------|
| **N0** ✓ | Lean base stack, voice HUD, gates | [tasks/phase-n0-foundation-reset.md](tasks/phase-n0-foundation-reset.md) |
| **N1** ✓ | catalog-service + play + stream filters | [tasks/phase-n1-catalog-play-spike.md](tasks/phase-n1-catalog-play-spike.md) |
| **N2** ← now | Real browse rails (`catalog.yaml`) | [tasks/phase-n2-browse-ui.md](tasks/phase-n2-browse-ui.md) |
| N3 | Stream picker + progress | roadmap |
| N4 | Library + Continue | roadmap |
| N5–N7 | AI catalogs, YouTube, 4K ship | roadmap |

**Gates (Pi):**

```bash
bash scripts/phase-n0/gate-n0.sh
bash scripts/phase-n1/gate-n1-smoke.sh
bash scripts/phase-n2/gate-n2-browse.sh    # after N2 ships
```

**Inventories:** [N0-INVENTORY.md](N0-INVENTORY.md) · [N1-INVENTORY.md](N1-INVENTORY.md) · [N2-INVENTORY.md](N2-INVENTORY.md)

---

## Shipped foundation (Phase 0–2)

Still accurate for pad, launcher shell, and voice. Native work **extends** this — it does not replace gamepad or voice docs.

| Doc | Covers |
|-----|--------|
| [PHASE0.md](PHASE0.md) | Pi bring-up, gamepad, architecture, troubleshooting |
| [PHASE1.md](PHASE1.md) | Launcher + `serve.py` API |
| [PHASE2.md](PHASE2.md) | Orchestrator, companion, voice HUD |
| [phase0-checklist.md](phase0-checklist.md) | Historical sign-off (`main` / Phase 1.5) |

---

## Reference & archive

| Doc | Notes |
|-----|-------|
| [PLAN.md](PLAN.md) | Full timeline — Phase 0–5 + native fork |
| [DESIGN.md](DESIGN.md) | **V1 historical spec** (Stremio/Kodi primary) — see banner |
| [HARDWARE.md](HARDWARE.md) | 8BitDo Micro |
| [kodi-youtube-setup.md](kodi-youtube-setup.md) | Legacy YouTube (`MANGO_LEGACY_YOUTUBE=1`) |
| [tasks/](tasks/) | Agent/Codex task specs |

---

## Automation

| Audience | Entry |
|----------|-------|
| Cursor / Codex | [`../AGENTS.md`](../AGENTS.md) |
| Scripts index | [`../scripts/README.md`](../scripts/README.md) |
| Source map | [`../src/README.md`](../src/README.md) |

**TV systems skill:** `$mango-tv-box-expert` · **UI polish:** `$ux-design-expert`
