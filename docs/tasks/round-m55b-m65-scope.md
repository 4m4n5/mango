# Round scope — M5.5b + M6.5 unified ship polish

**Branch:** `feat/native-experience` · **Started:** 2026-07-05 · **Code complete:** 2026-07-05 (`8eeb239`)  
**North star:** *Ask or browse in mango. Watch in mpv. Never wonder which app you're in.*  
**Merge bar:** COUCH_TEST V1–V12 + U1–U9 sign-off → M6.4 wizard → `main`

Supporting audits: `_audit-living-librarian-gap.md` (written). Companion/launcher/gates audits in this doc §2–4.

---

## 1. Systems snapshot (what exists today)

| Layer | Shipped | Round touch risk |
|-------|---------|------------------|
| **Launcher** (`src/launcher/`) | 4-tab browse, detail, episodes, settings, voice HUD, tab DOM cache | Focus UX, typography, HUD safe area, error copy |
| **Companion** (`src/companion/`) | Chat-first PTT/text, mirror chips, YouTube OAuth, memory panel via chat | Tool cards, pick UI, settings strip, error scrub |
| **Orchestrator** (`src/orchestrator/`) | Tool loop, open guards, persona policy, chat_send | Error allowlist, config deploy, optional mock corpus |
| **catalog-service** | Voice tools, companion store, live search merge, library, YouTube | Watch→journal hook, notes reconciliation |
| **Pad** (`mango-tv-pad.py`) | Single-window input, ⌂ fast path | Low — verify after launcher focus changes |
| **Gates** | gate-lite (~2 min), M5 policy/memory/gardener, M6 library/YT/reliability | Add companion-couch + ux-smoke to deploy ladder |

**Recent production lessons (must not regress):**
- Launcher `mountRailsView` DOM order (empty rails)
- Chromium GPU disable (`MANGO_CHROMIUM_DISABLE_GPU=1`)
- Voice live open: `llm.max_tokens=1024`, narrowed `_guard_open_claims`

---

## 2. Gap summary (audit synthesis)

### M5.5b — Companion + HUD

| Item | Status | Priority |
|------|--------|----------|
| PTT hold/active, secure-context errors | ✓ | — |
| Chat/tool cards, streaming partials | ✓ | — |
| Tool human summaries (`runner.py`) | ✓ | Improve live/YT copy |
| HUD state machine + 4s error dwell | ✓ | — |
| HUD ≤12s wall-clock dismiss | ✓ | — |
| HUD leanback safe area | ✓ (CSS) | Couch verify U4/U6 |
| Ambiguous pick UI (2–4 options) | ✓ structured cards | Couch verify V3/V9 |
| Proactive opt-in toggle + HUD push | ✗ (schema only) | **P2** — deferred |
| Error scrub (no API keys upstream) | ✓ | — |
| CA trust hint | ✗ | **P2** |
| Memory panel (chat-triggered summary) | ✓ | Polish copy |
| Cross-tab open/ack parity in corpus | partial | **P1** — couch pass |

### M6.5 — Launcher UX

| Item | Status | Priority |
|------|--------|----------|
| U1 focus visible (amber ring) | ✓ | Verify at 3m |
| U2 detail/settings focus | ✓ 2D FocusGrid | Couch verify |
| U3 poster aspect-ratio stability | ✓ | — |
| U4 tab vs shuffle distinct | ✓ | — |
| U5 play failure couch copy | ✓ | Extend audit |
| U6 empty rails hidden | ✓ | — |
| U7 Continue/Saved Mango-only | ✓ | — |
| U8 ⌂ <300ms | ✓ (pad path) | Re-verify |
| U9 YouTube pad-play rules | ✓ | — |
| Typography at 3m | warn (small base rem) | **No global bump** — verify U1 first |
| `gate-m6-ux-smoke.sh` | ✓ | In `pi-pre-couch-gate.sh` |

### Living librarian (M5 completion)

| Item | Status | Priority |
|------|--------|----------|
| Profile/journal/reflect/gardener | ✓ | — |
| Nightly LLM consolidate | ✓ | — |
| Watch signals → journal/familiarity | ✓ | `watch-signals.ts` + watcher hook |
| Journal 90-day rollup | ✓ | `rollUpJournalEvents()` in nightly |
| Legacy notes vs compiled-notes | ✓ | LLM addendum → session-notes; GET delegates compiled |
| Proactive (N5c.2) | deferred | design fork |

---

## 3. Proposed workstreams (pending design answers)

### WS-A — Voice reliability & gates (foundation, week 1)

**Goal:** No regressions; catch voice/HUD bugs in CI.

- Wire `gate-m5-companion-couch.sh` into gate-lite when `MANGO_VOICE=1`
- Add `test_guard_open_claims` to companion-couch gate
- Extend corpus: live + YouTube `clear-open` fixtures
- Sync `llm.max_tokens: 1024` via deploy (`sync-etc-mango-config.sh` or documented Pi merge)
- Orchestrator error scrub allowlist before phone/HUD broadcast
- HUD: 12s max visible timer (independent of `idle` message)

**Exit:** `bash scripts/pi-deploy.sh --fast --gate` green; companion-couch gate green on Mac.

### WS-B — Companion phone polish (M5.5b, week 1–2)

**Goal:** Trustworthy phone surface for 4-tab voice.

- Tool card copy pass (live ≠ "library only")
- Ambiguous pick UX (scope per design answer)
- Settings strip: connection status + optional proactive toggle (if in scope)
- PTT: optional countdown hint near 30s cap
- Error messages: couch-safe only

**Exit:** COUCH_TEST V1–V12 manual pass; V9/V10/V11 verified on Pi.

### WS-C — TV HUD + launcher polish (M6.5, week 2–3)

**Goal:** 10-foot ship quality.

- HUD safe-area CSS + couch screenshot verify
- Typography/focus pass (scope per design answer)
- Detail focus navigation (scope per design answer)
- Create `scripts/m6-ship/gate-m6-ux-smoke.sh` (DOM/CSS/pad smoke)
- Extend COUCH_TEST U1–U9 checklist in gate script where automatable

**Exit:** U1–U9 couch sign-off; ux-smoke gate in deploy ladder.

### WS-D — Living librarian closure (parallel, ~20% capacity)

**Goal:** M5 "complete when" bar honest.

- Progress watcher → journal `play_completed` (or equivalent) → `completed_watches`
- Optional: journal retention job (90d)
- Reconcile `/voice/library/notes` with compiled-notes (delegate or document)
- Update STATUS.md `◐` → `✓` with dated gate evidence

**Exit:** `gate-m5-companion-memory.sh` + watch-signal unit test green.

### Explicitly out of this round (unless you override)

- M6.4 first-boot wizard
- M6.3 full 4K TV sign-off (needs hardware)
- M3 grow +20 deep tuning
- Wake word / TTS / multi-profile
- Full proactive push subsystem (if deferred by design answer)

---

## 4. Gate ladder (do not break the couch)

Run in order after every deployable slice:

| Stage | Command | When |
|-------|---------|------|
| **L0 — unit (Mac)** | `cd src/catalog-service && npm run test:gate` | Any catalog-service change |
| | `cd src/orchestrator && .venv/bin/python -m unittest discover -s tests` | Any orchestrator change |
| | `cd src/launcher && npm run build` | Launcher TS change |
| | `cd src/companion && npm run build` | Companion change |
| **L1 — voice contract (Mac)** | `bash scripts/m5-voice/ai/gate-m5-companion-couch.sh` | Orchestrator/companion/policy |
| | `bash scripts/m5-voice/ai/gate-m5-conversation-policy.sh` | open_intent/agent changes |
| **L2 — ship smokes (Mac or Pi)** | `bash scripts/m6-ship/gate-m6-library-smoke.sh` | Library/voice save paths |
| | `bash scripts/m6-ship/gate-m6-youtube-smoke.sh` | YouTube tab changes |
| **L3 — deploy + gate-lite (Pi)** | `bash scripts/pi-deploy.sh --fast --gate` | **Required before couch handoff** |
| **L4 — UX smoke (Pi, new)** | `bash scripts/m6-ship/gate-m6-ux-smoke.sh` | After WS-C lands |
| **L5 — couch manual** | COUCH_TEST V1–V12, U1–U9, 30 min sign-off | Release candidate |
| **L6 — full (optional)** | `MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh` | Pre-merge |

**Regression watchlist:** pad focus after detail nav changes · voice open ack (`tv_seq`) · live search merge · GPU launcher · Saved rail order · YouTube shuffle without API at couch time.

---

## 5. Design decisions (locked 2026-07-05)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Proactive companion | **Defer** — no toggle/HUD push this round; schema stays dormant |
| 2 | Ambiguous picks | **Structured pick cards** — numbered tappable rows + ordinal follow-up |
| 3 | Detail D-pad | **Full 2D FocusGrid** — spatial nav like home rails (largest launcher slice) |
| 4 | Typography | **No global bump** — couch-verify U1 first; tweak only if fail |
| 5 | Living librarian | **Full memory hardening** — watch signals + notes reconcile + 90d journal rollup + companion-couch in gate-lite |

---

## 6. Revised workstreams (post-decisions)

### Phase 1 — Gates & voice foundation (days 1–3) ✓ shipped `e3a1a57`

- [x] Add `gate-m5-companion-couch.sh` + guard/couch_safe/tool_summary tests to gate-lite
- [x] HUD 12s wall-clock dismiss safety net
- [x] Orchestrator `couch_safe_error_message` before phone/HUD
- [x] Extend corpus: live clear-open fixtures (EN + Hinglish)
- [x] `sync-orchestrator-llm-config.py` on deploy; verify-voice-ready requires 1024
- [x] Tool summary: "Searching mango for …"
- [x] Gate uses repo persona via `MANGO_COMPANION_DIR` (Pi /etc lag safe)

### Phase 1.5 — YouTube AI rail 9-up ✓

- [x] Cap AI YouTube catalog rails at 9 (`constants.ts` + `ai-catalog-rails.ts`)
- [x] Isolate `MANGO_AI_CATALOGS_DIR` in `withTempState` (gate no longer hits Pi live slots)
- [x] `npm run test:gate` green (163 pass)

### Phase 2 — Companion structured picks ✓ (ship pending Pi verify)

- [x] Orchestrator `pick_options.py` — enrich search tool events with `options[]` (2–4 hits)
- [x] `pick_select` WS message — direct open from browse context (no LLM round-trip)
- [x] Companion numbered tappable pick rows + styles
- [x] `mango_youtube_search` remembers hits in `voice_browse`
- [x] `test_pick_options` in companion-couch gate
- [ ] COUCH_TEST V3/V9 manual on Pi

### Phase 3 — Detail 2D FocusGrid ✓ (ship pending Pi couch verify)

- [x] `DetailController` uses shared `FocusGrid` — row 0 actions (L/R), episodes/streams rows (U/D)
- [x] `main.ts` detail pad: Up/Down = row, Left/Right = col (matches home rails)
- [x] Season headers + disabled episode skip preserved in `listFocusables`
- [ ] COUCH_TEST #5–10, U2 on Pi

### Phase 4 — HUD + launcher polish ✓ (ship pending Pi couch verify)

- [x] HUD safe-area CSS (`env(safe-area-inset-*)`, max-height cap, horizontal inset)
- [x] `scripts/m6-ship/gate-m6-ux-smoke.sh` — dist HTML/CSS/JS contracts, source checks, pad alive
- [x] Wired into `pi-pre-couch-gate.sh` on `feat/native-experience`
- [ ] COUCH_TEST U1/U4/U5/U6 manual on Pi

### Phase 5 — Living librarian full memory ✓ (ship pending Pi verify)

- [x] mpv/progress → journal `play_started` / `play_completed` / `play_abandoned` via `watch-signals.ts`
- [x] First `play_completed` per `content_key` bumps `familiarity.completed_watches` + compiled notes
- [x] Nightly LLM addendum POSTs `/voice/companion/session-notes` (not raw `/voice/library/notes`)
- [x] `rollUpJournalEvents()` — 90-day rollup summary + prune (nightly rule phase)
- [x] `journalHasPlayCompleted()` for dedupe
- [x] `watch-signals.test.ts` + journal rollup tests; gate-m5-companion-memory extended (22 pass)
- [x] Pi deploy + L1 memory gate on device (`8eeb239` — 22/22 memory · 163/163 catalog · 9/9 ux-smoke)
- [ ] COUCH_TEST memory/familiarity manual (post comprehensive couch pass)

**Out of scope (confirmed):** proactive UI/push · global typography · M6.4 wizard · M6.3 4K sign-off · M3 grow tuning

---

## 7. Acceptance (round done when)

- [x] All design questions locked in this doc (§5)
- [x] L0–L3 gates green on Pi at `feat/native-experience` HEAD (`8eeb239`)
- [x] L4 ux-smoke exists and passes (9/9)
- [ ] COUCH_TEST V1–V12 + U1–U9 signed off (manual log in COUCH_TEST or session note)
- [ ] No P0 voice/HUD regressions (live open, empty rails, stuck HUD)
- [x] STATUS.md updated for M5.5b/M6.5 progress
