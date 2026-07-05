# mango documentation

**Product:** [VISION.md](VISION.md) · **Plan:** [ROADMAP.md](ROADMAP.md) · **Status:** [STATUS.md](STATUS.md)

---

## Start here

| I want to… | Read |
|------------|------|
| Understand the product | [VISION.md](VISION.md) |
| See what is shipped, hardening, and planned | [STATUS.md](STATUS.md) · [ROADMAP.md](ROADMAP.md) |
| Understand the stack | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Operate the Pi | [OPS.md](OPS.md) · [DEPLOY.md](DEPLOY.md) |
| Check reliability / nightly proof | [RELIABILITY.md](RELIABILITY.md) |
| Run couch tests | [COUCH_TEST.md](COUCH_TEST.md) |
| Playability · grow · thematic rails | [PLAYABILITY.md](PLAYABILITY.md) |
| M5.5 voice contract + companion UX split | [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md) |
| M6.5 post-YouTube unified UX polish | [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md) |
| Set up voice | [VOICE.md](VOICE.md) |
| Set up native YouTube | [YOUTUBE.md](YOUTUBE.md) |
| Set up live TV | [LIVE_TV.md](LIVE_TV.md) |
| Overhaul the AI layer | [AI_LAYER.md](AI_LAYER.md) |
| Gamepad | [HARDWARE.md](HARDWARE.md) |
| Locked choices | [DECISIONS.md](DECISIONS.md) |

**Scripts:** [../scripts/MILESTONES.md](../scripts/MILESTONES.md) · **Agents:** [../AGENTS.md](../AGENTS.md)

---

## Milestones

| | Status |
|--|--------|
| M1 Foundation | ✓ |
| M2 Browse | ✓ |
| M3 Play | ✓ hardening |
| M4 Addons | ✓ |
| M5 Voice + AI | ◐ Phase 3 companion shipped · M5.5a corpus/gates · living librarian pending |
| M6 Ship | ◐ M6.1 library core shipped · M6.2 YouTube deployed and Pi-gated · Reliability Center implemented |

M3 grow is in hardening. **Phase 3 AI companion** (text + voice chat, live search, safety corpus) and M6.2 YouTube are deployed on Pi. Reliability Center records nightly proof. 4K, unified UX polish, and wizard remain M6 work. See [STATUS.md](STATUS.md).

---

## Reference

| Doc | Use |
|-----|-----|
| [reference/addon-stack.md](reference/addon-stack.md) | Self-hosted addons |
| [reference/aiostreams-profile.md](reference/aiostreams-profile.md) | AIOStreams profile |
| [reference/elfhosted.md](reference/elfhosted.md) | Optional cloud hosting |

---

## Gate (before couch)

```bash
bash scripts/pi-exec-gate.sh              # gate-lite (~2 min)
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh   # full (~5–8 min, 3 plays/rail)
bash scripts/m6-ship/gate-m6-youtube-smoke.sh         # after YouTube/API/launcher rail changes
bash scripts/m5-voice/ai/gate-m5-companion-couch.sh   # Phase 3 companion safety
bash scripts/m6-ship/gate-m6-reliability-proof.sh     # red/yellow/green couch readiness proof
```

Live IPTV gates are opt-in. See [PLAYABILITY.md](PLAYABILITY.md) for grow/monitor.

---

## Doc ownership

| Source of truth | Owns |
|-----------------|------|
| [VISION.md](VISION.md) | UX north star and product invariants |
| [ROADMAP.md](ROADMAP.md) | Milestone structure and planned work |
| [STATUS.md](STATUS.md) | Current implementation state, known gaps, gates |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Runtime boundaries and API contracts |
| [AI_LAYER.md](AI_LAYER.md) | AI phases 0–3 status, tool inventory, companion contract |
| [PLAYABILITY.md](PLAYABILITY.md) | Verified library, grow SLA, theme/orphan/overlap behavior |
| [RELIABILITY.md](RELIABILITY.md) | Reliability Center, proof ledger, safe repair policy |
| [OPS.md](OPS.md) / [DEPLOY.md](DEPLOY.md) | Pi operation and git-only deployment |

---

## Archive

Superseded phase plans: [archive/](archive/) · Legacy name map: [ROADMAP.md#appendix--legacy-names](ROADMAP.md#appendix--legacy-names)
