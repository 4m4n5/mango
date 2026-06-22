# mango documentation

**Product:** [VISION.md](VISION.md) · **Plan:** [ROADMAP.md](ROADMAP.md) · **Status:** [STATUS.md](STATUS.md) · **Branch:** `feat/native-experience`

---

## Start here

| I want to… | Read |
|------------|------|
| Understand the product | [VISION.md](VISION.md) |
| See what's shipped and what's next | [ROADMAP.md](ROADMAP.md) · [STATUS.md](STATUS.md) |
| Understand the stack | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Operate the Pi | [OPS.md](OPS.md) · [DEPLOY.md](DEPLOY.md) |
| Run couch tests | [COUCH_TEST.md](COUCH_TEST.md) |
| Set up voice | [VOICE.md](VOICE.md) |
| Set up live TV | [LIVE_TV.md](LIVE_TV.md) |
| Gamepad layout | [HARDWARE.md](HARDWARE.md) |
| Locked choices | [DECISIONS.md](DECISIONS.md) |

**Scripts:** [../scripts/MILESTONES.md](../scripts/MILESTONES.md) · **Agents:** [../AGENTS.md](../AGENTS.md)

---

## Milestones (quick reference)

| | Status |
|--|--------|
| M1 Foundation | ✓ |
| M2 Browse | ✓ |
| M3 Play | ✓ |
| M4 Addons | ✓ |
| M5 Voice + AI | ◐ |
| M6 Ship (4K HDR · library · wizard) | next |

Full detail: [ROADMAP.md](ROADMAP.md). Legacy `N0`–`N7` names map to these milestones in the roadmap alias table.

---

## Reference (deep dives)

| Doc | Use |
|-----|-----|
| [reference/addon-stack.md](reference/addon-stack.md) | Self-hosted AIOStreams + AIOMetadata setup |
| [reference/aiostreams-profile.md](reference/aiostreams-profile.md) | AIOStreams headless profile |
| [reference/elfhosted.md](reference/elfhosted.md) | Optional cloud addon hosting |
| [reference/kodi-youtube-fallback.md](reference/kodi-youtube-fallback.md) | Legacy Kodi YouTube fallback |

---

## Default gate (before couch)

```bash
bash scripts/pi-exec-gate.sh
# or
bash scripts/pi-deploy.sh --fast --gate
```

Live IPTV gates are **opt-in** — not in gate-lite.

---

## Archive

Superseded docs (old phase plans, inventories, task prompts): [archive/](archive/)
