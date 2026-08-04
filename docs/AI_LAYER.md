# mango — AI layer

**Milestone:** [M5](ROADMAP.md) · **Rule (unchanged):** voice **opens**, pad **B** plays — no voice playback, on every tab including Live.

**Recommendation status:** the profile-aware VOD/YouTube implementation is
local code in this branch. Deployment, Pi diagnostics, screenshots, and human
TV-quality verdicts are **DEFERRED** until the home agent proves this revision.

---

## Why this exists

The AI companion should make mango feel like a next-gen AI TV box — look up
titles, make suggestions, accept an explicit session mood, personalize, and
curate recommendation rails across **all four tabs** (Movies · Series · Live ·
YouTube). AI assists discovery in the background; it never becomes the
couch-critical ranker or a second owner of profile state.

---

## Current AI coverage (audit)

| Capability | Movies | Series | YouTube | Live |
|------------|--------|--------|---------|------|
| Search | ✓ | ✓ | ✓ `mango_youtube_search` | ✓ merged in `mango_search` |
| Open on TV | ✓ | ✓ | ✓ `mango_open_youtube` | ✓ `mango_open_title` type tv |
| Save/Unsave | ✓ | ✓ | ✓ video only | ✓ type tv |
| Create AI rail | ✓ | ✓ | ✓ | ✓ |
| Personalization into rails | ✓ Fire/Water profile ranker | ✓ Fire/Water profile ranker | ✓ profile/mood local ranker | — custom rails only |
| Viewer profile control | ✓ `mango_manage_viewer_profile` | ✓ | ✓ | ✓ shared session identity |
| What's-on-now/EPG | n/a | n/a | ~ Live Now rail | ✓ now-playing after pad B; EPG deferred |
| Subscriptions/channels | n/a | n/a | read-only | n/a |

*The older Phases 0–3 and M5.5b/M6.5 base were previously shipped. That proof
does not cover the current profile-aware recommendation redesign.*

Structural facts:

1. `library.db` is the single viewer-profile and recommendation-signal authority:
   permanent Household, optional clean personal profiles, explicit session mood,
   ratings, Saved, watch/search signals, Not-for-me, and recommendation events.
   `progress.db` separately owns profile-exact Continue/resume; exact positions
   never blend into Household.
2. VOD For You is locally ranked from currently verified titles. Every visible
   rail has exactly six cards (4 close, 1 adjacent, 1 surprise); it is omitted
   when its reserve cannot heal the contract. Explicit Fire/Water dominates
   confidence-weighted dual-horizon usage signals.
3. YouTube anchors For You, Subscriptions, History, and Saved, then admits at
   most three adaptive rails. Every visible rail has four cards; with healthy
   supply, deterministic For You slates deliver 70/20/10 over ten rotations.
   Successful reservoir generations replace stale candidates atomically; exact
   Saved videos stay out of For You so the Saved anchor survives cross-rail
   deduplication. Empty rebuilds retain last-good, thin-supply fallback is
   recorded, and X is cache-only.
4. AI enrichment is versioned, background-only, and optional. The local ranker
   owns eligibility, diversity, and atomic last-good publication. Feature reads
   and writes are batched, while CPU-heavy scoring and MMR run in a bounded
   worker thread so catalog HTTP requests do not block the event loop; worker
   failure or deadline expiry retains last-good.
5. Live is IPTV — a tune-to-channel model, fundamentally different from VOD —
   so it keeps its own custom-rail contract rather than pretending to share the
   Fire/Water or YouTube ranker.

---

## Current architecture

Four runtimes: phone companion PWA (PTT + chat) → orchestrator (Deepgram STT → Anthropic tool loop) → catalog-service (`:3020` `/voice/*`) + launcher (`:3000`, voice command queue, long-poll).

| Store | Role |
|-------|------|
| `companion/profile.yaml` | Conversational memory/familiarity; not viewer-profile authority |
| `companion/journal.jsonl` | Turn-by-turn voice events |
| `companion/compiled-notes.md` | Human-readable memory summary |
| `voice/library-notes` | Persistent librarian notes, full replace |
| `ai-catalogs/*.yaml` | Up to 3 user-created AI rails per supported tab |
| `library.db` | Household/personal profiles, mood, ratings, Saved, profile watch/history/search, Not-for-me, recommendation events, opaque served attribution |
| `progress.db` | Profile-exact Continue/resume positions; legacy unscoped state belongs only to Household |
| `playability.db` | Verified pools incl. AI slots |
| `youtube.db` | Rebuildable YouTube metadata, reservoirs, exposure/cache state |
| recommendation snapshots | Versioned local VOD slates and last-good semantic-enrichment state |

Request flow: Phone PTT (WSS `:8765`) → orchestrator (Deepgram STT → Anthropic tool loop) → catalog-service `:3020` `/voice/*` + `serve.py` `:3000` voice command queue (long-poll) → launcher; loopback WS `:8766` → launcher HUD; `tv_seq` ack confirms opens.

### Tool inventory (`mango_*`)

| Group | Tools |
|-------|-------|
| Discovery | `mango_search` · `mango_search_external` · `mango_youtube_search` · `mango_library_overview` · `mango_library_browse` |
| TV control | `mango_open_title` · `mango_open_youtube` · `mango_navigate` · `mango_now_playing` |
| Curation | `mango_create/update/delete/refresh_ai_catalog` · `mango_ai_catalog_status` · `mango_list_ai_catalogs` · `mango_library_shuffle` · `mango_save_title` · `mango_unsave_title` · `mango_playability_refresh` |
| Memory/profile | `mango_manage_viewer_profile` · `mango_read/patch_profile` · `mango_companion_summary` · `mango_append_session_notes` · `mango_read/update_librarian_notes` |
| Blocked by design | `mango_play` · `play_youtube` · hide/unhide · volume · pause |

---

## Lean & flexibility assessment

| Area | Verdict | Note |
|------|---------|------|
| Tool manifest centralization | Good | Single `buildVoiceToolManifest` |
| Tool execution | Brittle | 3-file/2-language duplication per tool: `tools.ts` schema + `catalog.py` wrapper + `runner.py` switch |
| Intent policy | Over-engineered | Regex `open_intent.py` + persona `_TOOL_POLICY` + `agent.py` guards can contradict |
| Memory model | Split by design | `library.db` owns viewer recommendation identity; companion profile owns conversational memory |
| AI catalog pipeline | Good bones | Async bootstrap + playability works |
| Compose intelligence | Needs overhaul | Keyword table ≠ conversational vibe |
| Companion UX | Round shipped — structured picks · HUD safe-area · chat-first phone; couch sign-off pending |
| TV command transport | Excellent | Long-poll + seq + ack — keep |
| Cross-surface state | Partial | `/ai/context` mirrors tab/open/playing state; pad-only fine-grained focus remains intentionally limited |

---

## Ideal UX

> Ask mango anything about what to watch. It knows your taste, sees what's on the TV, curates your home across every tab, and opens titles — you press B to play.

### 1. Knows you

- Optional personal viewer profiles plus permanent Household; no PIN or startup chooser
- Explicit, expiring session mood; never infer mood from room/time/playback
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
- Background semantic enrichment with deterministic local eligibility/ranking

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
| Viewer identities | Household plus up to seven optional personal profiles; no PIN/startup prompt; create does not activate; stable-ID rename; activation clears mood |
| Mood | User-selected, bounded, expiring session context only |
| VOD mix | Exactly 4 close + 1 adjacent + 1 surprise from playable-only candidates; explicit Fire/Water dominates dual-horizon implicit evidence |
| Rewatch | Completed VOD may return only rarely through a cooled, explicitly marked lane |
| AI boundary | Semantic enrichment runs off the couch path; local versioned ranker owns final slate and retains last-good on failure |
| Rank execution | Batched feature I/O plus a deadline-bounded worker thread; diagnostic inline opt-out only |
| YouTube shape | Four anchors in For You → Subscriptions → History → Saved order, then at most three adaptive rails; exactly four cards each |
| YouTube mix | With healthy lane supply, deterministic ten-slate For You rotation yields 28 close, 8 adjacent, 4 surprise cards (70/20/10); thin-supply fallback is diagnosed |
| YouTube reservoir | Successful generations atomically replace stale For You candidates; exact Saved videos are excluded from For You membership; empty rebuild keeps last-good |
| YouTube X | Discovery rotation from cache only; History/Saved stable; no provider/API/quota activity |
| Attribution | Active profile, optional mood, rail, and bounded seed context only; no numerical or private-generation details |

---

## Historical cross-tab AI-rail plan

| Phase | Work |
|-------|------|
| 0 — Spine | Refactor movies/series `compose.ts` + `bootstrap.ts` + `topUpRail` into a tab-agnostic AI-rail engine with per-tab source adapters (VOD adapter = existing behavior, regression-gated to zero change for movies/series); add unified `GET /ai/context` snapshot (current tab, open detail, now-playing incl. live channel, across all four tabs) injected into the agent each turn |
| 1 — YouTube AI (first) | YouTube source adapter → custom YT rails via the engine (`mango_create_ai_catalog` gains `tab: youtube`); recommender steering (profile taste + conversation seeds into For You/discovery); personalization (loves/avoids bias YT seeds); subscriptions read-only; phone/HUD reflect YT rail creation + open |
| 2 — Live AI | Live source adapter → AI-composed live rails (keyword/source over NexoTV, feasible today); channel search + open ("put on cricket" opens channel, pad B tunes); now-playing-live awareness; EPG deferred |
| 3 — Cross-surface + safety + text | ✓ **Shipped** — see below |

Each historical phase ended with its own Pi deploy/gate boundary. The current
profile-aware recommendation changes require a fresh gate and couch proof; older
phase evidence cannot be reused.

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
| YouTube rail cap | Superseded by the current profile-aware four-card allocator; Pi/couch proof deferred |

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
