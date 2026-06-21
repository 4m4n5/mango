# mango documentation

**Vision:** [NATIVE_EXPERIENCE.md](NATIVE_EXPERIENCE.md) · **Roadmap:** [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) · **Branch:** `feat/native-experience`

---

## Start here

| Task | Doc |
|------|-----|
| Product direction | [NATIVE_EXPERIENCE.md](NATIVE_EXPERIENCE.md) |
| What's shipped / next | [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) · [N3-INVENTORY.md](N3-INVENTORY.md) · [N5-INVENTORY.md](N5-INVENTORY.md) |
| Live TV / sports IPTV | [LIVE_TV.md](LIVE_TV.md) |
| Self-hosted addons + rails | [N3d-INVENTORY.md](N3d-INVENTORY.md) |
| Pi day-to-day | [PHASE0.md](PHASE0.md) · [DEPLOY.md](DEPLOY.md) |
| Stack boundaries + gates | [STACK-PRINCIPLES.md](STACK-PRINCIPLES.md) |
| Voice / phone PTT | [PHASE2.md](PHASE2.md) |
| Foreground contract | [FOREGROUND.md](FOREGROUND.md) |
| Gamepad | [HARDWARE.md](HARDWARE.md) |

---

## Native phases (status)

| Phase | Status | Reference |
|-------|--------|-----------|
| N0 foundation | ✓ | [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) |
| N1 catalog + mpv | ✓ | `scripts/phase-n1/` |
| N2 browse + tabs | ✓ | movies · series · **live** |
| N3a play orchestrator + ladder | ✓ | [N3-INVENTORY.md](N3-INVENTORY.md) |
| N3c playability index | ✓ | `scripts/phase-n3c/` |
| N3d self-hosted addons | ✓ | [N3d-INVENTORY.md](N3d-INVENTORY.md) |
| Track B verified rails UX | ✓ | thin rows · library refresh |
| N3b stream picker + progress | **partial** | C1 picker on detail · C2 Continue rail |
| Live TV (NexoTV) | ✓ | [LIVE_TV.md](LIVE_TV.md) |
| N5a voice tools | ✓ | [N5-INVENTORY.md](N5-INVENTORY.md) · browse/open · Hinglish STT |
| N3e episode picker | design | `tasks/` (series UX) |
| N5b AI catalogs | planned | 3 home slots · create/list catalogs |
| N4–N7 | planned | library write-back · YouTube · 4K ship |

**Default pre-couch gate:** `bash scripts/pi-pre-couch-gate.sh` → `gate-lite` (~1–2 min). Live IPTV gates are **excluded** (opt-in only).

```bash
bash scripts/pi-pre-couch-gate.sh
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh   # slow per-rail play sweep
```

---

## Foundation (still valid)

[PHASE0.md](PHASE0.md) · [PHASE1.md](PHASE1.md) · [PHASE2.md](PHASE2.md) · [DECISIONS.md](DECISIONS.md)

**Archive:** [DESIGN.md](DESIGN.md) (V1 Stremio/Kodi spec) · [PLAN.md](PLAN.md) (full timeline) · [tasks/archive/](tasks/archive/)

**Agents:** [../AGENTS.md](../AGENTS.md) · **Deploy:** [DEPLOY.md](DEPLOY.md) (git only — never rsync)
