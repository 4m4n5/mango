# mango — AI layer

**Milestone:** [M5](ROADMAP.md) · **Rule (unchanged):** voice **opens**, pad **B** plays — no voice playback, on every tab including Live.

---

## Why this exists

The AI companion should make mango feel like a next-gen AI TV box — look up titles, make suggestions, track vibe, personalize, and curate recommendation rails across **all four tabs** (Movies · Series · Live · YouTube), not just Movies/Series. Today the AI is Movies/Series-centric with only shallow YouTube reach and almost no Live reach. This doc captures the audit, the ideal UX, the locked decisions, and the phased plan.

---

## Current AI coverage (audit)

| Capability | Movies | Series | YouTube | Live |
|------------|--------|--------|---------|------|
| Search | ✓ | ✓ | ✓ `mango_youtube_search` | ✓ merged in `mango_search` |
| Open on TV | ✓ | ✓ | ✓ `mango_open_youtube` | ✓ `mango_open_title` type tv |
| Save/Unsave | ✓ | ✓ | ✓ video only | ✓ type tv |
| Create AI rail | ✓ | ✓ | ✓ | ✓ |
| Personalization into rails | ~ gardener | ~ gardener | ✓ profile steering | — |
| What's-on-now/EPG | n/a | n/a | ~ Live Now rail | ✓ now-playing after pad B; EPG deferred |
| Subscriptions/channels | n/a | n/a | read-only | n/a |

*Phases 0–3 shipped on `feat/native-experience`. M5.5b/M6.5 round code shipped Pi `8eeb239` (2026-07-05).*

Structural facts:

1. YouTube already has a rich server-built rail system (For You, Fresh Finds, New From Subs, Popular, Live Now, Because You Watched) but it's disconnected from the companion profile and the AI can't steer it.
2. Live is IPTV — a tune-to-channel model (no stream ladder), fundamentally different from VOD, so it needs its own AI contract.

The `CatalogTab` type already includes `'live'` and `'youtube'` — plumbing exists, AI logic doesn't use it.

---

## Current architecture

Four runtimes: phone companion PWA (PTT + chat) → orchestrator (Deepgram STT → Anthropic tool loop) → catalog-service (`:3020` `/voice/*`) + launcher (`:3000`, voice command queue, long-poll).

| Store | Role |
|-------|------|
| `companion/profile.yaml` | Taste, familiarity, facts, proactive opt-in |
| `companion/journal.jsonl` | Turn-by-turn voice events |
| `companion/compiled-notes.md` | Human-readable memory summary |
| `voice/library-notes` | Persistent librarian notes, full replace |
| `ai-catalogs/*.yaml` | Up to 3 AI rails per movies/series tab |
| `library.db` | Saved, history, Not Interested — durable user state |
| `playability.db` | Verified pools incl. AI slots |

Request flow: Phone PTT (WSS `:8765`) → orchestrator (Deepgram STT → Anthropic tool loop) → catalog-service `:3020` `/voice/*` + `serve.py` `:3000` voice command queue (long-poll) → launcher; loopback WS `:8766` → launcher HUD; `tv_seq` ack confirms opens.

### Tool inventory (`mango_*`)

| Group | Tools |
|-------|-------|
| Discovery | `mango_search` · `mango_search_external` · `mango_youtube_search` · `mango_library_overview` · `mango_library_browse` |
| TV control | `mango_open_title` · `mango_open_youtube` · `mango_navigate` · `mango_now_playing` |
| Curation | `mango_create/update/delete/refresh_ai_catalog` · `mango_ai_catalog_status` · `mango_list_ai_catalogs` · `mango_library_shuffle` · `mango_save_title` · `mango_unsave_title` · `mango_playability_refresh` |
| Memory | `mango_read/patch_profile` · `mango_companion_summary` · `mango_append_session_notes` · `mango_read/update_librarian_notes` |
| Blocked by design | `mango_play` · `play_youtube` · hide/unhide · volume · pause |

---

## Lean & flexibility assessment

| Area | Verdict | Note |
|------|---------|------|
| Tool manifest centralization | Good | Single `buildVoiceToolManifest` |
| Tool execution | Brittle | 3-file/2-language duplication per tool: `tools.ts` schema + `catalog.py` wrapper + `runner.py` switch |
| Intent policy | Over-engineered | Regex `open_intent.py` + persona `_TOOL_POLICY` + `agent.py` guards can contradict |
| Memory model | Good schema/weak ingestion | Profile rich but reflect/gardener are regex + token-overlap |
| AI catalog pipeline | Good bones | Async bootstrap + playability works |
| Compose intelligence | Needs overhaul | Keyword table ≠ conversational vibe |
| Companion UX | Round shipped — structured picks · HUD safe-area · chat-first phone; couch sign-off pending |
| TV command transport | Excellent | Long-poll + seq + ack — keep |
| Cross-surface state | Missing | No shared "what's on TV" context |

---

## Ideal UX

> Ask mango anything about what to watch. It knows your taste, sees what's on the TV, curates your home across every tab, and opens titles — you press B to play.

### 1. Knows you

- Long-term profile + ephemeral session vibe
- Watch-aware context
- Phone memory view

### 2. Sees the room

- Companion mirrors current tab/focus/open detail/now-playing incl. live channel

### 3. Acts on TV

- Navigate, focus/shuffle rails, create/update AI rails, save/unsave — all four tabs
- Voice opens, pad plays

### 4. Curates home

- Conversation → rail via LLM-assisted composition
- Gardener top-ups from taste

### 5. Feels alive

- Proactive opt-in, default off, max 1/day
- Home-only HUD card

### 6. Safe & trustworthy

- Discover never jumps TV turn 1; open only on clear single match/ordinal
- Phone claims "opened" only on `ok` + `tv_seq`
- Rail claims "on TV" only on `visible_on_tab`

---

## Locked decisions

| Decision | Choice |
|----------|--------|
| Sequencing | YouTube first, then Live |
| Live playback contract | Voice opens, pad B plays — Live included, no voice-tune exception |
| Live depth | Full: **full-catalog** channel search via `mango_search` + open; AI-composed live rails; now-playing; EPG deferred |
| YouTube rail model | Both — steer existing recommender with profile+seeds AND allow custom YT rails |
| YouTube subscriptions | Read-only for v1; surface/open, no write |
| Rail-creation architecture | Generalize ONE tab-agnostic AI-rail engine with per-tab source adapters: mdblist/Cinemeta for VOD, YouTube API for YT, NexoTV for Live |
| EPG | Deferred — not available today; only paid Xtream could serve it, variable reliability; ship the rest of Live first |

---

## Phased plan

| Phase | Work |
|-------|------|
| 0 — Spine | Refactor movies/series `compose.ts` + `bootstrap.ts` + `topUpRail` into a tab-agnostic AI-rail engine with per-tab source adapters (VOD adapter = existing behavior, regression-gated to zero change for movies/series); add unified `GET /ai/context` snapshot (current tab, open detail, now-playing incl. live channel, across all four tabs) injected into the agent each turn |
| 1 — YouTube AI (first) | YouTube source adapter → custom YT rails via the engine (`mango_create_ai_catalog` gains `tab: youtube`); recommender steering (profile taste + conversation seeds into For You/discovery); personalization (loves/avoids bias YT seeds); subscriptions read-only; phone/HUD reflect YT rail creation + open |
| 2 — Live AI | Live source adapter → AI-composed live rails (keyword/source over NexoTV, feasible today); channel search + open ("put on cricket" opens channel, pad B tunes); now-playing-live awareness; EPG deferred |
| 3 — Cross-surface + safety + text | ✓ **Shipped** — see below |

Each phase ends with Pi deploy + gate + couch proof.

---

## Phase 3 — shipped (2026-07-04)

| Sub | Status | Delivered |
|-----|--------|-----------|
| **3a Text** | ✓ | `chat_send` WS · shared `run_agent_turn` · companion composer |
| **3b Mirror** | ✓ | `/ai/context` poll · collapsible YouTube/On TV chips · tool status |
| **3c HUD + navigate** | ✓ | Launcher tool action line · `mango_navigate` includes `youtube` tab |
| **3d Safety** | ✓ | EN + Hinglish corpus · `gate-m5-companion-couch.sh` · persona live-TV policy |

**Companion UX (post-3):** chat-first phone layout · text-only replies (no TTS / no speaking lock) · full NexoTV live search in `mango_search`.

**Defaults:** Enter sends · Shift+Enter newline · ~500 char max · text and voice share reflect/session-notes path.

**Couch gate:** `bash scripts/m5-voice/ai/gate-m5-companion-couch.sh` · opt-in LLM: `MANGO_VOICE_LLM_INTEGRATION=1`

### M5.5b / M6.5 round (2026-07-05) ✓ code

| Deliverable | Status |
|-------------|--------|
| Structured pick cards + `pick_select` | ✓ |
| Detail 2D FocusGrid | ✓ |
| HUD safe-area + ux-smoke gate | ✓ |
| Living librarian watch signals + journal rollup | ✓ |
| YouTube AI rail 9-cap | ✓ |

Manual COUCH_TEST V1–V12 + U1–U9 pending. Detail: [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md)

---

## Phase 3 — locked decisions (reference)

| Decision | Choice |
|----------|--------|
| Text pipeline | Shared agent path — text skips STT; same tools, policy, TV dispatch, conversation thread as voice |
| Phone text UX | Persistent composer bar + send below chat; PTT remains |
| Text → TV feedback | HUD tool line + phone tool cards; no speaking dwell blocking next message |
| Text TTS | None — text bubble on phone; idle immediately after reply (Piper off until M6.3) |
| Companion mirror | Rich — collapsible YouTube/On TV chips · chat log · tab/open/playing/tool status |
| Room state source | Hybrid (Phase 0) — server last nav/open + now playing; pad-only navigation still blind until launcher instrumentation |
| Safety gate | Automated mock gate + expanded corpus; full LLM integration opt-in (`MANGO_VOICE_LLM_INTEGRATION=1`) |
| Scope | Full — text + mirror + HUD + safety + `mango_navigate` youtube tab; proactive HUD stays off/default |

### Phase 3 sub-phases

| Sub | Work |
|-----|------|
| **3a — Text input** | Orchestrator `chat_send` WS message; refactor shared `run_agent_turn`; companion composer UI; no TTS on text; `voice_lock` mutual exclusion with PTT |
| **3b — Rich mirror** | Phone status strip fed from `/ai/context` + last open; tool card summaries for create/open/search across tabs; memory view on demand |
| **3c — TV HUD + navigate** | HUD renders tool action cards (not just chat); 4-tab open/ack copy; add `youtube` to `mango_navigate` tab enum |
| **3d — Safety** | Hinglish + EN corpus scenarios for YT/Live (R1–R8 + tab-specific); `gate-m5-companion-couch.sh`; extend policy tests |

**Tactical defaults (no fork):** Enter sends · Shift+Enter newline · ~500 char max · text turns run same reflect/session-notes path as voice.

---

## References

[STATUS.md](STATUS.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [VOICE.md](VOICE.md) · [YOUTUBE.md](YOUTUBE.md) · [LIVE_TV.md](LIVE_TV.md) · [DECISIONS.md](DECISIONS.md) · [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)
