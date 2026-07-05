> **Audit artifact** — read-only pass, 2026-07-05. **Phase 5 gaps closed** same day
> (`watch-signals.ts`, journal rollup, compiled-notes path) — see
> [round-m55b-m65-scope.md](round-m55b-m65-scope.md) · Pi `8eeb239`. Not a spec;
> cross-check [`docs/STATUS.md`](../STATUS.md) before acting.

# Living librarian (M5 / N5c) — completion audit

**Verdict (updated 2026-07-05):** memory hardening complete in code and gates.
Watch signals → `completed_watches`, 90-day journal rollup, and notes reconciliation
are shipped. **Remaining bar:** couch checks M1–M3 in [COUCH_TEST.md](../COUCH_TEST.md).

---

## 1. Shipped vs pending

### Shipped (code + tests exist, wired into gate-lite)

| Area | Evidence |
|------|----------|
| Conversation policy hardening | `_fast_path_open` **removed** from `agent.py` (grep found zero hits — only `_open_best_from_hits`, which now only fires for ordinal/remembered-hit picks, not blind auto-open after search). `open_intent.py` has `_RECOMMEND_ONLY` expansion + `_bare_title_request` narrowing. |
| Companion store (catalog-service) | `src/catalog-service/src/companion/{types,paths,profile,journal,reflect,nightly,gardener,compile-notes}.ts` — all present with matching `.test.ts` files (`profile`, `journal`, `reflect`, `gardener`, `compile-notes`). |
| profile.yaml canonical shape | `types.ts` matches spec almost exactly (`familiarity`, `identity`, `taste`, `facts`, `open_questions`, `behavior`) + `session_notes` (not in original spec table but implements "librarian notes append ≤5 bullets/session"). Caps enforced: `TITLE_LOVES_CAP=50`, `SESSION_NOTE_BULLETS_MAX=5`, `REGULAR_SESSIONS=5`, `FRIEND_SESSIONS=20`, `FRIEND_COMPLETED_WATCHES=5` — all match locked defaults. |
| Journal (SQLite) | `journal.ts` — `better-sqlite3`, `journal_events` table, append/list, `resetJournalForTests`. Event types used in practice: `voice_turn`, `explicit_feedback`, `profile_patch`, `session_notes`, `nightly_consolidate`, `catalog_gardener`. **Not seen:** `tool_call`, `title_opened`, `play_started/completed/abandoned`, `catalog_created/updated` as distinct journal event types from spec table — watch/play signals don't appear to be journaled yet (see gap #1 below). |
| Light per-PTT reflect | `reflect.ts::processLightReflect` — skips if <3 words and no tool use, regex-extracts love/hate/forget, bumps `familiarity.sessions`, recomputes stage, writes compiled notes. Wired via `POST /voice/companion/reflect`, called from orchestrator `companion_reflect.py::reflect_after_turn` (fire-and-forget `asyncio.create_task` in `main.py` after every tool-using turn). |
| Nightly deep consolidation | Two-phase: (1) `nightly.ts::runCompanionNightly` — rule-based familiarity/compiled-notes refresh + ops log; (2) `scripts/m5-voice/ai/companion-nightly-llm.py` — **actual Sonnet call** that reads profile+journal+compiled-notes, prompts for `append_facts/loves/avoids/open_questions/compiled_notes_addendum/catalog_hints`, patches profile via HTTP, merges into librarian notes, and updates AI catalog `llm_hints`. Orchestrated end-to-end by `scripts/m5-voice/ai/companion-nightly-consolidate.sh` (rule → optional LLM → gardener → empty-slot migrate), installed via systemd timer at 05:30 (`install-companion-nightly-timer.sh`), gated behind the playability-maintenance lock to avoid overlap. This is **beyond spec** — the archived task doc only asked for a shell script stub. |
| Gardener (N5c.3, listed as "deferred") | `gardener.ts` — **already implemented**, not deferred. Scores AI catalog slot affinity from taste loves/avoids/facts, assigns `title_loves` into best-matching slot (`add_ids`, capped 5), builds `topup_suggestions`, merges into `llm_hints` without ever touching `remove_ids` (`gardenerHintsAreSafe` explicitly enforces this). Wired via `POST /voice/companion/gardener`, gated by `gate-m5-gardener.sh`. |
| Compiled notes | `compile-notes.ts` — markdown digest (loves/avoids/title favorites/facts/recent sessions), `compiledNotesExcerpt` truncation helper for prompt injection. |
| HTTP routes | All present in `src/catalog-service/src/index.ts` (see §3). |
| Voice tool manifest | `mango_read_profile`, `mango_patch_profile`, `mango_companion_summary`, `mango_append_session_notes` registered in `voice/tools.ts` **and** dispatched in orchestrator `tools/runner.py` (both the tool-loop and `_compact` summarizer paths). |
| Persona / prompt injection | `llm/persona.py::build_system_prompt` loads persona from `MANGO_COMPANION_DIR` → `/etc/mango/companion/persona.md` → repo fallback `config/companion.example/persona.md`, concatenates the binding `_TOOL_POLICY` string (discover/open/live/youtube/memory/saved lanes, "never claim open without `tv_seq`", etc.) — this **is** the "prompt-led agent + tool policy in schema text" the spec called for. `agent.py` fetches `tool_companion_summary` and injects it into system blocks (grep confirmed at L378). |
| Example/config scaffolding | `config/companion.example/{profile.yaml,persona.md}` exists (git-tracked template, not live Pi profile) — matches "never commit live profile" rule. `sync-companion-example.sh` referenced by nightly script to keep Pi copy fresh. |
| Gate coverage | 4 dedicated N5c/M5 gates exist and are **wired into `scripts/gate-lite.sh`** (lines 57–60): `gate-m5-conversation-policy.sh`, `gate-m5-companion-memory.sh`, `gate-m5-gardener.sh`, `gate-m5-companion-llm-policy.sh`. A 5th, `gate-m5-companion-couch.sh`, runs the companion safety corpus + `test_chat_send`/`test_voice_nav`/`test_open_intent_discover` (referenced from `docs/STATUS.md` "Voice librarian" gate line, not confirmed wired into gate-lite.sh itself — see gap #3). |
| Unit tests | `test_open_intent_discover.py` covers discover-vs-open, ambiguous-blocks-open, ordinal-pick-allowed, clear-open-with-verb — functionally the same acceptance surface the spec named `test_agent_open_policy.py`, just organized differently. `test_voice_nav.py` covers auto-open-on-clear-winner, sequel/franchise disambiguation. `test_companion_llm.py` covers nightly JSON parse. `test_companion_corpus.py` + fixture JSONs (`companion-corpus-en.json`, `companion-corpus-hinglish.json`) cover safety corpus. |

### Pending / deferred (explicitly, per spec + roadmap)

| Item | Status |
|------|--------|
| N5c.2 — Proactive phone + HUD (opt-in) | `behavior.proactive_opt_in` field exists in schema and defaults `false`, but no code path found that *reads* it to push proactive messages (no phone toggle UI, no "max 1/day, home updates only" enforcement located). Deferred per doc. |
| N5c.4 — Phone memory editor UI | No `profile`/`memory` UI surface found in `src/companion/` (grep for profile/memory/proactive only matched generic style/main files, not feature code) — "what do you know about me?" is chat-only via `mango_companion_summary`, matching the locked decision ("on demand" via chat), but there's no dedicated settings/memory screen. |
| N5c.5 — TV TTS | Explicitly out of scope until N7; confirmed no change here. |
| Watch-signal journaling (`play_started/completed/abandoned`) | Spec's journal event table lists these as populated from "progress DB nightly import," but no such import job was found in the codebase search. `completed_watches` in familiarity currently has no observed writer outside manual patch — familiarity "friend" stage (needs `completed_watches >= 5`) may never trigger organically. **This looks like the single biggest functional gap.** |
| Full LLM integration test corpus (opt-in) | `MANGO_VOICE_LLM_INTEGRATION=1` scripts referenced in STATUS.md but not independently verified in this pass. |
| Live gate run confirmation | Sandbox for this audit is filesystem-read-only; could not execute `npm run build` / `node --test` / `python -m unittest` to confirm gates currently PASS (see §2). Repo docs (STATUS/VOICE) assert M5.5a gates are green but don't timestamp the last N5c-specific gate run. |
| Regression checklist R1–R8 (Pi couch) | No evidence in repo of a logged recent run; this is manual/couch-only per spec and wouldn't leave a repo artifact anyway. |

---

## 2. Gate status

Could not execute gates live — this Cursor sandbox has a **read-only filesystem**
(attempts to `npm run build` and `ls dist/` both failed with `EPERM`/"Operation not
permitted"). Status below is inferred from code presence + wiring, not a live run.

| Gate | Wired into `gate-lite.sh`? | What it covers | Inferred status |
|------|---|---|---|
| `gate-m5-conversation-policy.sh` | ✓ (L57) | `test_voice_nav` + `test_open_intent_discover` | Tests exist and appear internally consistent — likely PASS |
| `gate-m5-companion-memory.sh` | ✓ (L58) | `profile/journal/compile-notes/reflect/gardener` TS unit tests | Tests exist, code paths match — likely PASS |
| `gate-m5-gardener.sh` | ✓ (L59) | Gardener hints-only invariant | Tests exist — likely PASS |
| `gate-m5-companion-llm-policy.sh` | ✓ (L60) | `test_companion_llm` (nightly JSON parse, no API) | Tests exist — likely PASS |
| `gate-m5-companion-couch.sh` | not found in `gate-lite.sh` grep — referenced only from STATUS/VOICE docs as a standalone command | `test_companion_corpus`, `test_open_intent_discover`, `test_voice_nav`, `test_chat_send` + fixture JSON validation | Exists as a script; **not confirmed part of the automated gate-lite chain** — recommend verifying this is intentional (e.g. run separately as it needs the orchestrator venv) |

**Action for a follow-up session:** re-run `bash scripts/gate-lite.sh` (or the
individual `gate-m5-*` scripts) in a real (non-sandboxed) shell to get a live
PASS/FAIL signal before treating this audit's "likely PASS" as ground truth.

---

## 3. API routes (catalog-service, `src/index.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/voice/companion/profile` | open | Read profile |
| POST | `/voice/companion/profile` | localhost-only | Patch profile (`ProfilePatch`), rewrites compiled notes, journals `profile_patch` |
| GET | `/voice/companion/summary` | open | `profileSummary()` + compiled-notes excerpt + familiarity — used by `mango_companion_summary` tool and nightly LLM script |
| GET | `/voice/companion/journal` | open | Recent journal events (`?limit=`) |
| POST | `/voice/companion/session-notes` | localhost-only | Append ≤5-bullet session notes, rewrites compiled notes |
| POST | `/voice/companion/reflect` | localhost-only | Light per-PTT reflect (`processLightReflect`) |
| POST | `/voice/companion/consolidate` | localhost-only | Nightly rule-only consolidate (`consolidateCompanionNightly`) |
| POST | `/voice/companion/nightly` | localhost-only | Full nightly (`phases: rule\|gardener`) |
| POST | `/voice/companion/gardener` | localhost-only | Run gardener + `core.reloadAiCatalogRails()` |

All match the spec's proposed route list (`profile`, `summary`, `journal`, `reflect`)
plus **extra** routes the spec didn't originally enumerate but that the implementation
plan implied (`session-notes`, `consolidate`, `nightly`, `gardener`) — these are a
superset, not a gap.

Legacy librarian-notes routes (`GET/POST /voice/library/notes`) still exist
separately and are **not yet delegating** to compiled-notes per the spec's migration
note ("N5c.1: delegates to compiled-notes + append API") — the nightly LLM script
reads/writes `/voice/library/notes` directly as a second, parallel notes store rather
than routing through `compile-notes.ts`. Worth reconciling (see remaining tasks #2).

---

## 4. Reflection scheduler

- **Trigger point:** `src/orchestrator/orchestrator/main.py` (~L446–453) — after every
  turn where `use_tools and user_text.strip()`, fires
  `asyncio.create_task(reflect_after_turn(settings, transcript=user_text, reply=reply))`.
  Fire-and-forget, does not block the reply/TTS path.
- **Light reflect:** `companion_reflect.py::reflect_after_turn` → thread-offloaded
  `tool_companion_reflect` → `POST /voice/companion/reflect` → `processLightReflect`.
  Skips silently on <3-word, no-tool turns (matches spec). Regex-based love/avoid/forget
  extraction only — no LLM call in the light path (matches "same Sonnet" being reserved
  for nightly, keeping per-turn cost near zero).
- **Nightly deep reflect:** cron/systemd-timer driven (`mango-companion-nightly.timer`,
  05:30 daily, `RandomizedDelaySec=5min`, gated behind the playability-maintenance
  flock so it never fights the 03:00 grow job). Three phases in one script:
  rule-consolidate → optional Sonnet LLM consolidate (`MANGO_COMPANION_LLM_NIGHTLY=1`,
  skipped gracefully if no API key or venv) → gardener → empty AI-slot migration.
  Retries HTTP calls 3x with backoff; fails hard only if **both** consolidate and
  gardener fail (treats partial success as OK, which is a reasonable resilience
  choice for an unattended Pi job).
- **Gap:** no equivalent trigger for watch-completion signals (play_started/
  completed/abandoned) feeding into `familiarity.completed_watches` or `title_loves` —
  the reflection scheduler currently only reacts to voice turns, not playback events.

---

## 5. Profile / journal flows

```
PTT/text turn ──▶ orchestrator agent loop ──▶ reply
                         │
                         ▼ (async, fire-and-forget)
                 companion_reflect.reflect_after_turn
                         │ HTTP POST /voice/companion/reflect
                         ▼
        catalog-service: processLightReflect
          ├─ appendJournalEvent('voice_turn', {...})
          ├─ regex extract love/avoid/forget → patchProfile()
          ├─ familiarity.sessions += 1 → applyFamiliarityStage()
          └─ writeCompiledNotes()

05:30 daily ──▶ companion-nightly-consolidate.sh
          ├─ Phase 1: POST /voice/companion/consolidate (rule) → journal 'nightly_consolidate'
          ├─ Phase 2: companion-nightly-llm.py (Sonnet) → GET profile+journal+summary
          │            → Anthropic call → parse_consolidation_response()
          │            → POST /voice/companion/profile (patch) + POST /voice/library/notes (addendum)
          │            → POST /voice/ai-catalogs/update (catalog_hints, optional=True)
          ├─ Phase 3: POST /voice/companion/gardener → journal 'catalog_gardener'
          └─ Phase 3b: migrate empty AI-catalog slots (unrelated cross-cutting maintenance bundled in)
```

Profile writes are **always full-file YAML rewrites** (`writeProfile`) gated through
`patchProfile()`'s merge logic — there's no optimistic-concurrency/lock, so a light
reflect and a nightly LLM patch racing on the same second could clobber each other
(low real-world risk given the 05:30 exclusive window, but worth a comment in code
if not already addressed elsewhere).

Journal is unbounded SQLite (`listJournalEvents` caps read at 200, but no observed
write-side pruning) — spec calls for "raw events 90 days → roll up to summaries";
**no rollup/pruning job was found**, so `companion.db` will grow indefinitely on the
Pi. This is the most concrete "not implemented" item under Memory & storage.

---

## 6. Integration with companion UI (phone PWA, `src/companion/`)

- Grep for `profile|memory|proactive` in `src/companion/` only matched generic files
  (`style.css`, `main.ts`, `index.html`) with no feature-specific hits — i.e. there is
  **no dedicated memory/profile screen or proactive-opt-in toggle** in the phone UI.
- Memory transparency is exposed **only** via chat: user asks "what do you know about
  me?" → agent calls `mango_companion_summary` → phone chat bubble. This matches the
  locked design decision ("on demand… phone chat summary"), so it's not a gap against
  the spec, but it does mean N5c.4 (phone memory editor UI) and the M5.5b "memory
  summary" UX line item in `ROADMAP.md` are still open.
- TV HUD: `docs/STATUS.md` confirms a "Tool action line on launcher voice card" for
  Phase 3, but no living-librarian-specific HUD surface (e.g. familiarity stage,
  proactive nudges) was found — consistent with N5c.2 being deferred.

---

## 7. Top 5 remaining tasks

1. **Wire watch/playback signals into the journal + familiarity.** No `play_started/
   completed/abandoned` events are journaled from the progress DB; `completed_watches`
   has no organic writer, so the "friend" familiarity stage likely never triggers
   without a manual profile patch. This is the highest-leverage gap — it's foundational
   to "familiarity stages via sessions **+ completed watches**."
2. **Reconcile dual notes stores.** `/voice/library/notes` (legacy) and
   `compiled-notes.md` (new) are both written independently (nightly LLM appends to
   the legacy notes endpoint directly, bypassing `compile-notes.ts`). Spec called for
   the legacy endpoint to delegate to compiled-notes; currently they can drift.
3. **Add journal retention/rollup.** `companion.db` has no 90-day raw-event rollup —
   implement the "roll up to summaries" behavior from the locked design table before
   this ships to a long-running Pi (unbounded SQLite growth risk).
4. **Confirm gates green with a real (non-sandboxed) run.** This audit could not
   execute `gate-lite.sh` / individual `gate-m5-*` scripts due to sandbox
   restrictions — before declaring M5 "living librarian" done, run them for real and
   update `docs/STATUS.md`'s `◐` to `✓` with a dated note, or capture failures.
5. **Decide on N5c.2/N5c.4 scope for M5 vs M6.5.** Proactive phone/HUD nudges and a
   phone memory editor UI remain unbuilt. Either explicitly re-file them under
   M5.5b/M6.5 (where `ROADMAP.md` already hints "memory summary" belongs) or drop
   them from the "M5 complete when…" bar in `ROADMAP.md`/`VOICE.md` so the milestone
   can close without them.

---

## 8. Design questions to resolve before closing M5

- **Concurrency:** should `patchProfile`/`writeProfile` take a file lock, given light
  reflect (per-turn) and nightly LLM consolidate (Sonnet) both call it and could
  theoretically overlap if a couch session runs past 05:30?
- **Journal event taxonomy:** the shipped code only emits `voice_turn`,
  `explicit_feedback`, `profile_patch`, `session_notes`, `nightly_consolidate`,
  `catalog_gardener` — should the remaining spec'd types (`tool_call`, `title_opened`,
  `play_*`, `catalog_created/updated`) be added, or was that table intentionally
  trimmed during implementation? If trimmed, the archived spec doc should be
  annotated so future readers don't assume they exist.
- **Legacy `/voice/library/notes` endpoint:** deprecate/delegate now, or keep as a
  second parallel surface indefinitely (e.g. if it's still used by an older tool
  contract or UI path)?
- **Proactive opt-in:** is N5c.2 (phone/HUD proactive nudges) still wanted for V1, or
  should `behavior.proactive_opt_in` be removed/hidden from the schema until a
  concrete UI exists to set it (currently there's no way for a user to ever flip it
  to `true`)?
- **Familiarity "friend" stage without watch signals:** until gap #1 above is fixed,
  should `computeFamiliarityStage` temporarily relax the `completed_watches` gate
  (e.g. sessions-only) so the "friend" tier is reachable at all on a fresh Pi?
