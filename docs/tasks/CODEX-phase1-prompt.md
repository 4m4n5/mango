# Codex prompt — Phase 1 launcher

Copy everything below into Codex (or Cursor) as the task prompt.

---

## Prompt

Implement **Phase 1 — UI shell** for the **mango** repo (`~/Documents/personal/projects/mango` or `~/mango` on Pi).

**Read and follow the full task spec:** [`docs/tasks/phase1-ui-shell.md`](phase1-ui-shell.md)

Also skim before coding:

- [`docs/PHASE0.md`](../PHASE0.md) — Pi + gamepad context
- [`docs/DECISIONS.md`](../DECISIONS.md) — Vite + vanilla TS, X11, gamepad layout
- [`docs/DESIGN.md`](../DESIGN.md) — launcher tiles, overlay, success criteria #1 #2 #10
- [`config/config.example.yaml`](../../config/config.example.yaml) — ports 3000 / 3002

### Your job

1. Read the spec end-to-end.
2. Implement all §5 deliverables (launcher, overlay stub, Python UI server, launch scripts, phase1 start/autostart scripts, `docs/PHASE1.md`).
3. **Reuse** existing Phase 0 scripts via thin `scripts/launch-*.sh` wrappers — do not duplicate Stremio/Kodi/gamepad logic.
4. Verify locally what you can (build, keyboard nav in dev server).
5. Document Pi verification steps in `docs/PHASE1.md` even if you cannot SSH to the Pi.

### Hard rules

- No secrets in git. No `keys/`. No changes to gamepad evdev codes (304/308) without explicit approval.
- Vanilla TypeScript only (no React). stdlib-first Python server if possible.
- `set -euo pipefail` on bash scripts.
- Do **not** implement voice, companion, orchestrator, or stremio-service.

### When done

- Ensure the repo builds cleanly.
- Update `AGENTS.md` and `src/README.md`.
- Leave a short summary: files added, how to run on Pi (`git pull` + commands), anything you could not verify.

Do not ask clarifying questions unless blocked — make reasonable choices per the spec and document them in `docs/PHASE1.md`.

---
