> **Archived spec** — superseded by [ROADMAP.md](../../ROADMAP.md) / [STATUS.md](../../STATUS.md).
> Shipped status may differ from this doc. Do not implement from here without checking STATUS.

# Phase N5c — Living Librarian (memory + conversation agent)

**Status:** Spec locked · **not shipped**  
**Branch:** `feat/native-experience`  
**Depends on:** N5a (voice tools) ✓ · N5b (AI catalogs) ✓  
**Inventory:** extends [`../N5-INVENTORY.md`](../N5-INVENTORY.md)  
**Related:** [`phase-n5b-ai-catalogs.md`](phase-n5b-ai-catalogs.md) · [`phase-n5-voice-tools.md`](phase-n5-voice-tools.md)

---

## Goal

Turn mango's voice agent into a **living librarian** — a warm, film-literate couch friend that:

1. **Converses first** when intent is vague (no dumb search-and-open).
2. **Acts directly** when instructions are clear ("Toy Story kholo").
3. **Remembers** taste and interactions across sessions (profile + journal).
4. **Expresses memory on home** via N5b AI catalogs, hints, and compiled notes.
5. **Never starts playback** — user presses **B** on the pad (unchanged).

**North star:** *The TV gets smarter about you; you don't manage it.*

---

## Problem statement (verified)

Today the agent often feels "dumb" on discover queries (e.g. "what are some good Hindi movies"):

| Failure | Root cause (code) | Evidence |
|---------|-------------------|----------|
| Searches literal phrase "good hindi movie" | `_fast_path_open` uses utterance as query | `agent.py` `_fast_path_open` |
| Opens random title without asking | `pick_auto_open_hit` + auto-open after `mango_search` when `nav_intent` | `agent.py` L205–218, `voice_nav.py` |
| Bypasses LLM entirely on "short" phrases | `_bare_title_request` treats 1–6 word non-questions as title nav | `open_intent.py` — e.g. "good hindi movies" (3 words) |
| LLM still search→open on questions | Prompt + `nav_intent` after search when phrasing slips through | e.g. "what are some good hindi movies" — no fast path, but prompt may still over-act |
| Prompt over-indexes search → open | `SYSTEM_PROMPT` OPEN FLOW | `agent.py` |

**Design fix:** remove **code paths that open without LLM reasoning**; replace with **prompt-led agent** + **optional safety rails**; add **persistent companion memory**.

---

## Locked design decisions

Consolidated from structured design sessions (Sets 1–7 + conversation Set A + open/clarify refinement).

### Identity & personality

| Decision | Choice |
|----------|--------|
| Character | **mango / "your librarian"** — no separate character name |
| Warmth | **Warm from day one**; familiarity stages progress **in background** |
| Familiarity stages | **stranger → regular → friend** via sessions + completed watches |
| Preference questions | **Gentle regular** (~one soft question every few sessions) |
| Film chat depth | **On request** ("why this?", director, etc.) |
| Reply length | **Contextual** — short for nav/open; longer for rec chat |
| Language | **Mirror user** (Hinglish / Hindi / English) |
| Phone TTS | **Text only** V1 |

### Memory & storage

| Decision | Choice |
|----------|--------|
| Root path | **`/etc/mango/companion/`** — all companion artifacts |
| Shape | **SQLite `companion.db`** (journal/events) + **`profile.yaml`** (human-readable taste) |
| Git | **`config/companion.example/`** in repo only — **never commit live Pi profile** |
| Deploy | **Sync example + ensure Pi dir** (like `catalog.yaml`) |
| Household | **Single profile V1** |
| Kids/family mode | **Not V1** |
| Taste granularity | **Hybrid** — genres/moods + **title loves capped ~50** |
| Journal retention | **Raw events 90 days** → roll up to summaries |
| Librarian notes | **Compiled nightly from profile** + **agent appends ≤5 bullets/session** |
| LLM chat history | **~3 turns** + injected profile/journal summaries |
| Memory transparency | **On demand** — "what do you know about me?" → phone chat summary |
| Forget/correct | **Voice immediate** for explicit corrections |
| Wrong rec (no explicit words) | **Silent learn** from watch/abandon signals |
| Watch vs voice weight | **Equal** |
| Now-playing | **Auto-inject** when mpv active |

### Learning loops

| Decision | Choice |
|----------|--------|
| Reflection | **Light per-PTT extract + nightly Sonnet consolidation** |
| Reflection model | **Same Sonnet** as chat |
| Proactive default | **Off until phone settings opt-in** |
| Proactive (when on) | **Phone + TV HUD text**, max **1/day**, **home updates only** |

### Home & AI catalogs (N5b integration)

| Decision | Choice |
|----------|--------|
| Create catalogs | **Suggest + confirm** |
| Naming | **User's phrase** when possible |
| After create on TV | **Silent pool growth** |
| Nightly gardener | **Hints only** (`llm_hints`) — no autonomous pool removal |
| "I love this" | **Seed into best-matching AI catalog** |
| Yaml rails | **Suggest yaml edits in journal** + **use themes to seed AI catalogs** |

### Playback & scope

| Decision | Choice |
|----------|--------|
| Voice play | **B-only forever** |
| Live TV companion | **Out of scope V1** |
| Heavy tool confirm | **Never confirm** — undo via voice/phone (note: aligns with removing `requires_confirm` on refresh when N5c ships — document in CHANGELOG) |

### Conversation agent (Set A + open/clarify)

| Decision | Choice |
|----------|--------|
| Auto-open | **No regex/word-match auto-open** — agent **reasons**; opens on **clear inferred intent** |
| Discover queries | **Chat first** — clarify before search when vague |
| Intent router V1 | **Prompt-led** (no Haiku classifier) — **but remove code bypasses** |
| First turn | **Tools when confident** — else clarify in text |
| After listing recs | **Open on ordinal/follow-up only** unless explicit open/kholo |
| Clear direct open | **One turn** — e.g. "Toy Story kholo" → search → **single clear winner** → open |
| Ambiguous search results | **Ask** — list options; **do not open** |
| Post-search clarify | **Allowed** — search may inform a clarifying question |

### Defaults (tunable constants)

| Constant | Default |
|----------|---------|
| `title_loves_cap` | 50 |
| `regular_stage` | ~5 voice sessions |
| `friend_stage` | ~20 sessions + ~5 completed watches |
| `session_note_bullets_max` | 5 |
| `profile_inject_max_tokens` | ~500 |
| `compiled_notes_max_tokens` | ~300 |

---

## Architecture

### Layer boundaries (mandatory)

```
┌─────────────────────────────────────────────────────────────────┐
│ Phone companion (:3001) — PTT, chat UI, settings (proactive, etc.)│
└────────────────────────────┬────────────────────────────────────┘
                             │ WSS
┌────────────────────────────▼────────────────────────────────────┐
│ Orchestrator — STT, agent loop, persona inject, reflection jobs   │
│  · Does NOT store canonical profile (reads/writes via catalog HTTP)│
│  · Session: chat turns + VoiceBrowseContext (recent hits)         │
└────────────┬───────────────────────────────┬────────────────────┘
             │ HTTP /voice/*                   │ POST /api/voice/command
┌────────────▼───────────────────────────────▼────────────────────┐
│ catalog-service — tools, companion store, library, AI catalogs    │
│  · /etc/mango/companion/  profile.yaml + companion.db             │
│  · /etc/mango/ai-catalogs/  N5b slots                            │
│  · playability + progress DB — watch signals (read-only to agent) │
└────────────┬──────────────────────────────────────────────────────┘
             │ ack
┌────────────▼────────────────────────────────────────────────────┐
│ Launcher — open detail, tabs; voice HUD for proactive text (opt)  │
└───────────────────────────────────────────────────────────────────┘
```

| Layer | Owns | Must not own |
|-------|------|--------------|
| **catalog-service** | Profile, journal, compiled notes, tool manifest, search, AI catalog CRUD | LLM inference, TV dispatch |
| **orchestrator** | Agent loop, prompt assembly, reflection scheduler, browse context | Direct file writes to `/etc/mango/companion/` (go through catalog API) |
| **launcher** | TV navigation, mpv stop on title switch | Taste memory |

### Companion directory layout

```
/etc/mango/companion/
  profile.yaml          # canonical structured taste (patchable)
  companion.db          # SQLite — journal events, session summaries, familiarity score
  compiled-notes.md     # generated digest for LLM (replaces ad-hoc cache JSON over time)
  persona.md            # tone + examples (from config/companion.example/)
  examples.md           # few-shot conversation patterns (optional)

config/companion.example/   # repo — schema + empty profile + persona template
```

### Agent context injection (each PTT)

Order matters — **static first, dynamic last**:

1. `persona.md` (static)
2. **Tool policy** — conversation-first, open/clarify matrix (static)
3. `profile.yaml` summary (dynamic)
4. `compiled-notes.md` excerpt (dynamic)
5. Session summary (if multi-turn PTT thread)
6. **Now-playing** snapshot if mpv active (dynamic)
7. User transcript + ~3 turn history

---

## Conversation agent contract (binding)

### Intent lanes

| Lane | Trigger examples | Tools | TV open |
|------|------------------|-------|---------|
| **CHAT** | "why is Interstellar confusing?" | None / read profile on request | Never |
| **DISCOVER** | "good Hindi movies", "kuch light de" | After clarify: notes, overview, search | Never on turn 1 |
| **OPEN** | "Toy Story kholo", "doosra wala" | search → open | Yes, with `tv_seq` |
| **CURATE** | "make cozy nights rail" | AI catalog tools (confirm) | Silent home |
| **MEMORY** | "what do you know about me?" | read profile / compile | Never |

### Open / clarify decision table

| Situation | Behavior |
|-----------|----------|
| Clear title + open verb | Search → **one strong match** → `mango_open_title` same turn |
| Clear title + **multiple** matches | List 2–4 + **one question** — **no open** |
| Clear title + **no** match | Say so; external search or clarify — **no open** until pick |
| Discover / vague | Clarify or chat; **no search** until direction clearer (unless high confidence) |
| Listed options + ordinal | Open from **remembered hits** only |
| Search done, results ambiguous | **Stop** — clarify; do not open best guess |

### Hard rules (prompt + enforcement)

1. **Never** pass user's full question string as `mango_search` query (use title names / normalized queries).
2. **`mango_open_title` only** when OPEN lane + unambiguous target (or ordinal after list).
3. **Only claim open** if tool result has `ok:true` + launcher `tv_seq`.
4. **Max one clarifying question** per ambiguous turn ([HAX disambiguate before acting](https://www.microsoft.com/en-us/haxtoolkit/pattern/g10-a-disambiguate-before-acting/)).
5. **B-only play** — never `mango_play`.

### Code changes required (N5c.1 conversation)

| Remove / change | File | Why |
|-----------------|------|-----|
| **`_fast_path_open` default path** | `agent.py` | Bypasses reasoning |
| **Auto-open after `mango_search` / `mango_search_external`** | `agent.py` L205–218 | Search ≠ open |
| **`_open_best_from_hits` from tool loop** | `agent.py` | Same |
| **Narrow `_bare_title_request`** | `open_intent.py` | Block genre phrases |
| **Expand `_RECOMMEND_ONLY`** | `open_intent.py` | good, hindi, movies, best, batao, … |
| **Optional: open guard** | `agent.py` or `runner.py` | Block `mango_open_title` if last search had ≥2 plausible hits and no ordinal/explicit pick |

**Keep:** ordinal pick helpers (`pick_hit_from_utterance`), title switch without ⌂, `mango_open_title` via agent tool call, follow-up "doosra wala".

---

## Memory system

### profile.yaml (canonical)

```yaml
version: 2
updated_at: ISO8601
familiarity:
  stage: stranger   # stranger | regular | friend
  score: 0.0        # continuous 0–1
  sessions: 0
  completed_watches: 0

identity:
  languages: [hinglish]
  reply_style: contextual

taste:
  loves: []         # genres, moods, themes
  avoids: []
  title_loves: []   # max 50 { type, id, title? }
  title_avoids: []
  mood_defaults:
    weeknight: null
    weekend: null

facts: []           # explicit user statements
open_questions: []    # agent wants to learn

behavior:
  proactive_opt_in: false
```

### Journal events (SQLite)

| `event_type` | Source |
|--------------|--------|
| `voice_turn` | orchestrator post-PTT |
| `tool_call` | name + summary (no secrets) |
| `title_opened` | launcher ack |
| `play_started` / `play_completed` / `play_abandoned` | progress DB nightly import |
| `catalog_created` / `catalog_updated` | N5b |
| `explicit_feedback` | user correction |
| `profile_patch` | reflection job |

### Reflection pipeline

**Per-PTT (light):** if transcript ≥3 words OR any tool use → extract facts/patches → append journal → optional note bullets.

**Nightly (deep):** roll journal → update familiarity → merge profile → regenerate `compiled-notes.md` → feed N5b `topup_suggestions` where appropriate.

### Librarian notes migration

| Phase | Behavior |
|-------|----------|
| N5c.1 | `GET/POST /voice/library/notes` **delegates** to compiled-notes + append API |
| Deprecate | Full-replace `mango_update_librarian_notes` with **append-only** or **patch profile** |

---

## HTTP / voice tools (new & changed)

### New catalog routes (localhost writes)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/voice/companion/profile` | Read profile + familiarity |
| PATCH | `/voice/companion/profile` | Field-level patch |
| GET | `/voice/companion/summary` | On-demand "what do you know" (phone) |
| GET | `/voice/companion/journal` | Recent events (debug / power user) |
| POST | `/voice/companion/reflect` | Trigger light reflect (internal / test) |

### New voice tools (orchestrator manifest)

| Tool | Layer | Purpose |
|------|-------|---------|
| `mango_read_profile` | catalog | Taste + facts + familiarity |
| `mango_patch_profile` | catalog | Patch fields (not full replace) |
| `mango_companion_summary` | catalog | On-demand memory summary |
| `mango_append_session_notes` | catalog | ≤5 bullets after session |

**Changed tool descriptions:** `mango_search`, `mango_open_title` — embed open/clarify policy in schema text.

---

## Implementation plan (think twice — order matters)

Ship as **one milestone N5c.1** (conversation + memory bundled), but **implement in this order** to avoid regressions:

### Phase 0 — Tests & gates first (no behavior change)

1. Add `open_intent` tests: "good hindi movies", "what are some good hindi movies", "Toy Story kholo".
2. Add `gate-n5c-conversation-policy.sh` **skeleton** (unit tests only).
3. Document baseline: run `gate-voice-tools.sh` + `gate-n5b` — **must pass before any agent change**.

### Phase 1 — Conversation fix (orchestrator only)

1. Remove `_fast_path_open` call path (or `MANGO_VOICE_FAST_PATH=0` default off, then delete).
2. Remove auto-open hooks after search tools.
3. Rewrite `SYSTEM_PROMPT` + add `config/companion.example/persona.md`.
4. Expand `open_intent.py` recommend/discover patterns.
5. **Update** `validate-voice-orchestrator-open.sh` to test **agent tool loop** with `MANGO_LLM_MOCK` or scripted tool sequence — not `_open_best_from_hits` directly.
6. Run **regression gates** (see Validation).

### Phase 2 — Companion store (catalog-service)

1. `src/catalog-service/src/companion/` — profile YAML, SQLite journal, patch API.
2. Migrate read path for librarian notes → compiled-notes.
3. Unit tests + `gate-n5c-companion-memory.sh`.

### Phase 3 — Wire agent to memory

1. Orchestrator: fetch profile/summary before agent loop; inject into system blocks.
2. Post-PTT async reflect (same process or background task).
3. Nightly job script: `scripts/phase-n5/companion-nightly-consolidate.sh` (cron on Pi).

### Phase 4 — Polish & docs

1. Phone companion: proactive toggle, optional memory view later.
2. Update `N5-INVENTORY.md`, `AGENTS.md`, `PLAN.md`.
3. Pi deploy + full gate-lite.

### Deferred sub-phases (N5c.2+)

| Sub-phase | Scope |
|-----------|--------|
| **N5c.2** | Proactive phone + HUD (opt-in) |
| **N5c.3** | Catalog gardener automation from profile |
| **N5c.4** | Phone memory editor UI |
| **N5c.5** | TV TTS (N7 tie-in) |

---

## Validation & gates (do not break couch)

### Principle

**Every orchestrator behavior change must:**

1. Add or extend **unit tests** (no LLM API in default gates).
2. Pass **existing N5a gates** (title switch, TV ack, STT config).
3. Pass **new N5c gates** before merge.

### Gate matrix

| Gate | When | What it protects |
|------|------|------------------|
| `gate-voice-tools.sh` | gate-lite `MANGO_VOICE=1` | Manifest, search, launcher ack, **title switch**, orchestrator open |
| `gate-n5b-ai-catalogs.sh` | gate-lite | AI catalog store |
| **`gate-n5c-conversation-policy.sh`** (new) | gate-lite | `open_intent` + mock agent policy tests |
| **`gate-n5c-companion-memory.sh`** (new) | gate-lite | profile round-trip, journal, compile notes |
| `gate-lite-unit.sh` | gate-lite | catalog-service unit slice |
| **`validate-voice-discover-no-open.sh`** (new) | N5c | discover utterances never call launcher dispatch |
| **`validate-voice-clear-open.sh`** (new) | N5c | "Toy Story kholo" mock path still opens with ack |

### Unit tests (required files)

| File | Covers |
|------|--------|
| `src/orchestrator/tests/test_open_intent_discover.py` | discover vs open utterances |
| `src/orchestrator/tests/test_agent_open_policy.py` | mock tool loop: no open on discover; open on clear |
| `src/catalog-service/src/companion/profile.test.ts` | yaml patch, caps, familiarity |
| `src/catalog-service/src/companion/journal.test.ts` | append, 90d rollup stub |
| `src/catalog-service/src/companion/compile-notes.test.ts` | profile → compiled markdown |

### Regression checklist (manual couch — agent runs after gates)

| # | Utterance | Pass criteria |
|---|-----------|---------------|
| R1 | "What are some good Hindi movies?" | No TV change; clarifying or chat reply |
| R2 | "Toy Story kholo" | Detail opens; `tv_seq`; no wrong franchise |
| R3 | "Toy Story kholo" (ambiguous library) | Lists options; **no open** |
| R4 | "Doosra wala" after list | Opens second hit |
| R5 | Title switch Shawshank → Godfather | No ⌂; mpv stopped; gate still passes |
| R6 | "What do you know about me?" | Summary in phone chat; no yaml dump |
| R7 | "I hate horror" then ask for rec | No horror suggestions |
| R8 | Create AI catalog voice flow | N5b suggest+confirm still works |

### LLM integration tests (opt-in only)

```bash
# Mac/Pi — requires Anthropic API key; NOT in gate-lite
MANGO_VOICE_LLM_INTEGRATION=1 bash scripts/phase-n5/validate-voice-llm-conversation.sh
```

Scenarios: discover, clear open, ambiguous franchise, ordinal pick.

---

## Couch acceptance — living librarian

### Timing budget

| Step | Target |
|------|--------|
| PTT end → first text | < 4s (no tool) |
| PTT end → open clear title | < 8s (search + open + ack) |
| Profile inject overhead | < 200ms local HTTP |

### Must never happen

- [ ] Open TV on discover/question without user pick
- [ ] Search literal question string as title
- [ ] Claim "opened" without `tv_seq`
- [ ] Ask user to press ⌂ home
- [ ] Voice starts playback
- [ ] Full profile replace wipes user corrections

---

## Red-team / risk register (pre-implementation)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Removing fast-path **breaks** clear opens | High | Keep agent `mango_open_title`; update `validate-voice-orchestrator-open.sh`; R2/R3 couch tests |
| Prompt-only policy **flakes** | Medium | Unit tests + optional open guard on multi-hit search |
| Profile **PII on Pi** | Medium | Local-only; no git commit; on-demand transparency |
| Reflection job **blocks PTT** | Medium | Async queue; skip light reflect on <3 words |
| Notes migration **breaks** N5a tools | Medium | Dual-read period; gate librarian notes endpoints |
| **`requires_confirm` removal** on refresh | Low | Document behavior change; user opted for never confirm |
| Sonnet reflection **cost** | Low | Skip when no-op; nightly batch cap |
| **3-turn history** too short for multi-step discover | Medium | Session summary injected; browse context for ordinals |

### Claims verified against repo (audit 2026-06-20)

- `_fast_path_open` exists and runs before LLM — **Confirmed** (`agent.py` L103–120).
- Auto-open after search when `nav_intent` — **Confirmed** (`agent.py` L205–218).
- "good hindi movies" triggers `_bare_title_request` — **Confirmed** (`open_intent.py` L107–117, 3 words, no `_QUESTION`).
- N5b AI catalogs shipped — **Confirmed** (`ai-catalogs/` module, gate-n5b).
- `validate-voice-orchestrator-open.sh` uses `_open_best_from_hits` directly — **Confirmed** (must update in N5c.1).

---

## Files touched (expected)

### New

- `docs/tasks/phase-n5c-living-librarian.md` (this file)
- `config/companion.example/*`
- `src/catalog-service/src/companion/*`
- `scripts/phase-n5/gate-n5c-conversation-policy.sh`
- `scripts/phase-n5/gate-n5c-companion-memory.sh`
- `scripts/phase-n5/validate-voice-discover-no-open.sh`
- `scripts/phase-n5/validate-voice-clear-open.sh`
- `scripts/phase-n5/companion-nightly-consolidate.sh`
- `scripts/phase-n5/sync-companion-example.sh` (optional, mirror catalog sync)

### Modified

- `src/orchestrator/orchestrator/llm/agent.py`
- `src/orchestrator/orchestrator/llm/open_intent.py`
- `src/orchestrator/orchestrator/main.py` (reflect hook)
- `src/catalog-service/src/voice/tools.ts`
- `src/catalog-service/src/index.ts`
- `src/catalog-service/src/voice/librarian-notes.ts` (delegate)
- `scripts/phase-n5/validate-voice-orchestrator-open.sh`
- `scripts/gate-lite.sh` (add N5c gates)
- `docs/N5-INVENTORY.md`, `AGENTS.md`, `PLAN.md`

---

## Out of scope (N5c)

- Voice play / pause / seek (B-only forever)
- Live TV voice
- Streaming STT / streaming agent (not priority)
- Multi-profile / kids mode
- TV Piper TTS (N7)
- Wake word

---

## Acceptance (N5c.1 ship criteria)

- [ ] All **Locked design decisions** implemented or explicitly deferred with doc note
- [ ] `gate-voice-tools.sh` **PASS** (13 checks including title switch)
- [ ] `gate-n5b-ai-catalogs.sh` **PASS**
- [ ] `gate-n5c-conversation-policy.sh` **PASS**
- [ ] `gate-n5c-companion-memory.sh` **PASS**
- [ ] Regression R1–R8 pass on Pi couch
- [ ] `pi-deploy.sh --fast --gate` PASS on `feat/native-experience`

---

## References

- [Android TV — Design for TV](https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv)
- [Microsoft HAX — Disambiguate before acting](https://www.microsoft.com/en-us/haxtoolkit/pattern/g10-a-disambiguate-before-acting/)
- [Android TV app quality — TV-VS voice search](https://developer.android.com/develop/adaptive-apps/quality-guidelines/tv-app-quality)
- N5b task doc: [`phase-n5b-ai-catalogs.md`](phase-n5b-ai-catalogs.md)
