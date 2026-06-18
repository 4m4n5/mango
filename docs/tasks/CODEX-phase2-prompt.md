# Codex prompt — Phase 2 voice pipeline

Copy everything below the line into Codex. Attach or reference [`phase2-voice-pipeline.md`](phase2-voice-pipeline.md).

---

## Prompt

Implement **Phase 2 slices 2.2–2.5 — voice pipeline** for the **mango** repo (`~/Documents/personal/projects/mango` on Mac · `~/mango` on Pi `10.0.0.174`).

### Skill (required)

Invoke **`$mango-tv-box-expert`** at the start of your session:

1. Load the skill KB and run the literature sweep (secure context / mic, orchestration, kiosk reliability).
2. Read mango context before writing code.
3. Update the skill KB + `research-log.md` when you learn something novel from this implementation.

### Read before coding

| Doc | Why |
|-----|-----|
| **[`docs/tasks/phase2-voice-pipeline.md`](phase2-voice-pipeline.md)** | **Full task spec — follow all deliverables** |
| [`docs/PHASE2.md`](../PHASE2.md) | Current Phase 2 canonical doc |
| [`docs/PHASE0.md`](../PHASE0.md) | Pi ops — do not break pad/launcher |
| [`docs/DECISIONS.md`](../DECISIONS.md) | Locked choices (HTTPS, ports, hide-not-kill) |
| [`docs/DESIGN.md`](../DESIGN.md) | Voice latency, overlay, success criteria |
| [`mango/AGENTS.md`](../../AGENTS.md) | Agent entry |
| [`config/config.example.yaml`](../../config/config.example.yaml) | Ports, audio, LLM config |

### Existing code (Phase 2.1 scaffold)

- `src/orchestrator/orchestrator/main.py` — FastAPI + WS `/ws`, `ptt_start`/`ptt_end` stub
- `src/companion/` — PTT button, no mic yet
- `src/overlay/src/main.ts` — connects `ws://127.0.0.1:8765/ws`, JSON status
- `scripts/phase2/` — deps, start, mkcert skeleton

### Your job

1. **Think first** — read the spec and existing code; choose the best TLS/mixed-content strategy (§3.1); write a short plan in your response before coding.
2. Implement **all §4 deliverables** in [`phase2-voice-pipeline.md`](phase2-voice-pipeline.md): companion mic capture, orchestrator STT/LLM/TTS pipeline, HTTPS serving, overlay on Pi, scripts, docs.
3. **Principled design** — orchestrator owns voice state; fail to idle; async heavy work; lazy model load; Phase 1 pad/launcher untouched.
4. Verify what you can locally (orchestrator health, companion build, protocol with mock LLM if no API key).
5. Document Pi + phone setup in `docs/PHASE2.md` even if you cannot SSH.

### Hard rules

- No secrets in git. No Phase 3 media tools. No gamepad/input stack changes.
- Vanilla TypeScript (no React). Match existing bash/Python patterns.
- Solve **HTTPS + WSS mixed content** — do not ship a companion that cannot connect from a phone browser.

### When done

- Repo builds cleanly (`companion` `npm run build`, orchestrator imports).
- Update `docs/PHASE2.md`, `DECISIONS.md` if needed, `AGENTS.md`.
- Summary: files changed, TLS approach, Pi commands, phone CA steps, unverified items.

Do not ask clarifying questions unless blocked — document assumptions in `PHASE2.md`.

---
