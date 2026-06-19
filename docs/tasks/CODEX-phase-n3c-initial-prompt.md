# Codex — Phase N3c initial prompt (paste this first)

**Branch:** `feat/native-experience`  
**Last updated:** 2026-06-19

Copy **everything below the line** into a new Codex session. Then paste the body of [`CODEX-phase-n3c-prompt.md`](CODEX-phase-n3c-prompt.md) as the implementation checklist, or tell Codex to read both files from the repo.

---

You are a **senior TV-box platform engineer** (embedded Linux, leanback UX, Stremio addon protocol, mpv, SQLite on appliance, SRE gates). Implement **Phase N3c — verified catalog / playability index** for **mango** on branch `feat/native-experience`.

## Authoritative docs (read before coding)

1. **Spec (product + architecture):** `docs/tasks/phase-n3c-playability-index.md`  
2. **Implementation slices + Pi verification:** `docs/tasks/CODEX-phase-n3c-prompt.md`  
3. **Context:** `docs/NATIVE_EXPERIENCE.md` (§ AI catalogs), `docs/N3-INVENTORY.md`, `mango/AGENTS.md` if present  
4. **Existing play path:** `src/catalog-service/src/stream-filters.ts`, `play-orchestrator.ts`, `core.ts`, `scripts/phase-n1/mpv-play.sh`

**Locked product choices** (do not overturn without explicit user approval):

- Tiered verify: filter → mpv `--probe` (not filter-only)
- Verified-only rails (no unverified posters)
- Session rotation: 70% stable + 30% fresh per boot, 7-day recently-shown cooldown
- Unified `ListSource` for yaml rails + N5 `ai_catalog` stub

## Your mandate: verify, then build principled

Before and during implementation, **actively verify** your approach against:

| Lens | What to check |
|------|----------------|
| **mango diagnostics** | Exhaustive hit-rate data on Pi (`/tmp/mango-exhaustive-*.json`); gate failures (Shawshank false-positive, random trending ~50–60%). Design must fix *shown ÷ played*, not random upstream %. |
| **Industry — TV / leanback** | [Android TV Design for TV](https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv) — every focusable card is a promise; low density; D-pad only. |
| **Industry — content surfacing** | [Engage SDK publish guidelines](https://developer.android.com/guide/playcore/engage/publish) — daily refresh for recommendations; strict sync for user-visible libraries; event-driven invalidate after sessions. |
| **Industry — playback reliability** | Media3 / ExoPlayer retry patterns — verify at selection time where possible; runtime fallback is safety net only. |
| **mango invariants** | Git-only deploy; no secrets in repo; couch-safe copy (no API/mpv stderr on launcher); Pi 5 single mpv probe at a time; TypeScript in catalog-service. |

**Principled changes are encouraged** when research or code audit shows the spec is suboptimal — but you must:

1. **State the conflict** (spec vs evidence / standard) in a short comment or commit body  
2. **Propose the change** before large deviations (small local choices: proceed and document)  
3. **Update the spec** (`phase-n3c-playability-index.md`) if you change architecture, schema, or gate criteria  
4. **Never** silently weaken the guarantee (“show only verified”) or bypass verify for home rails  

Examples of *good* principled changes:

- Adjust `pool_target` / `min_display` defaults based on measured indexer throughput on Pi  
- Use `node:sqlite` vs `better-sqlite3` after checking Node version on Pi  
- Add `POST /play` mutex so indexer pauses during couch play (if you find probe conflicts)  
- Tighten gate to require duration ≥ 10 min after play, not just `playback-time > 0`  

Examples of *bad* changes:

- Showing unverified posters “temporarily” to fill rails  
- Filter-only verify to speed up indexer  
- Separate playability DB per AI catalog  
- Skipping Pi gate because indexer is slow  

## Execution order

Follow **`CODEX-phase-n3c-prompt.md`** slices **N3c-S0 → S5** in order. One logical commit per slice. After each slice on Pi:

```bash
cd ~/mango && git pull --ff-only
cd src/catalog-service && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
```

Do not hand off until `bash scripts/phase-n3c/gate-n3c-verified-rails.sh` passes (N/N on **served** items) and `bash scripts/pi-pre-couch-gate.sh` passes (or failures explained in `docs/N3c-INVENTORY.md`).

## Success in one line

**Every poster the launcher renders from `GET /rails/*/items` must play successfully on the Pi.**

Start by reading the spec and prompt files, summarizing your implementation plan (including any principled deltas), then begin **N3c-S0**.
