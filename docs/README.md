# mango documentation

**Vision:** [NATIVE_EXPERIENCE.md](NATIVE_EXPERIENCE.md) · **Roadmap:** [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) · **Branch:** `feat/native-experience`

---

## Start here

| Task | Doc |
|------|-----|
| Product direction | [NATIVE_EXPERIENCE.md](NATIVE_EXPERIENCE.md) |
| Active work / rails | [N3-INVENTORY.md](N3-INVENTORY.md) · [N3d-INVENTORY.md](N3d-INVENTORY.md) |
| Pi day-to-day | [PHASE0.md](PHASE0.md) · [DEPLOY.md](DEPLOY.md) |
| Voice / phone PTT | [PHASE2.md](PHASE2.md) |
| Foreground contract | [FOREGROUND.md](FOREGROUND.md) |
| ElfHosted / debrid | [ELFHOSTED.md](ELFHOSTED.md) |
| Stack boundaries | [STACK-PRINCIPLES.md](STACK-PRINCIPLES.md) |

---

## Native phases (status)

| Phase | Status | Reference |
|-------|--------|-----------|
| N0–N2 browse + tabs | ✓ shipped | [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) |
| N3a stream orchestrator | in progress | [N3-INVENTORY.md](N3-INVENTORY.md) · [tasks/phase-n3-stream-orchestrator.md](tasks/phase-n3-stream-orchestrator.md) |
| N3c playability index | ✓ shipped | accumulative pools · `scripts/phase-n3c/` |
| N3d self-hosted addons | ✓ shipped | [N3d-INVENTORY.md](N3d-INVENTORY.md) |
| N3b–N7 | planned | [NATIVE_ROADMAP.md](NATIVE_ROADMAP.md) |

**Pre-couch gate (Pi):**

```bash
bash scripts/pi-pre-couch-gate.sh
# or individually:
bash scripts/phase-n0/gate-n0.sh
bash scripts/phase-n3c/gate-n3c-verified-rails.sh   # when MANGO_CATALOG=1
bash scripts/phase-n3d/gate-n3d-self-hosted.sh      # when self-hosted addons enabled
```

---

## Foundation (still valid)

[PHASE0.md](PHASE0.md) · [PHASE1.md](PHASE1.md) · [PHASE2.md](PHASE2.md) · [HARDWARE.md](HARDWARE.md) · [DECISIONS.md](DECISIONS.md)

**Archive:** [DESIGN.md](DESIGN.md) (V1 Stremio/Kodi spec) · [PLAN.md](PLAN.md) (full timeline) · [tasks/archive/](tasks/archive/)

**Agent entry:** [../AGENTS.md](../AGENTS.md) · **Pi deploy:** [DEPLOY.md](DEPLOY.md) (git push/pull only — never rsync)
