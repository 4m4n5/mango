# mango — AI layer

**Milestone:** [M5](ROADMAP.md) · **Rule (unchanged):** voice **opens**, pad **B** plays — no voice playback, on every tab including Live.

**Recommendation status:** the Household VOD/YouTube v2 source implementation
is complete on this branch. Deployment, Pi backfills, diagnostics, screenshots,
and human TV-quality verdicts are **DEFERRED** until the home agent proves the
exact pushed revision.

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
| Personalization into rails | ✓ Household Story Graph | ✓ Household Story Graph | ✓ subscriptions/history only | — custom rails only |
| Viewer profile control | Dormant/rollback only | Dormant/rollback only | No v2 influence | Preserved shared session state |
| What's-on-now/EPG | n/a | n/a | ~ Live Now rail | ✓ now-playing after pad B; EPG deferred |
| Subscriptions/channels | n/a | n/a | read-only | n/a |

*The older Phases 0–3 and M5.5b/M6.5 base were previously shipped. That proof
does not cover the current Household recommendation redesign.*

Structural facts:

1. `library.db` is the durable recommendation-signal authority: permanent
   Household ratings, Saved, qualifying watch history, exact Not-for-me,
   normalized Takeout events/import audit, and recommendation events. Existing
   personal-profile and mood rows remain dormant and recoverable in v2.
   `progress.db` separately preserves profile-exact Continue/resume.
2. VOD For You is locally ranked from the complete currently verified corpus.
   Every visible rail has exactly six strongest supported fits allocated across
   up to three Household taste threads; no fixed exploration bucket or cooled
   rewatch lane exists. Explicit positive Fire/Water owns 85% when present.
3. YouTube v2 uses only authoritative subscriptions and Takeout/Mango-local
   meaningful history. Its five core rails are For You, Beyond Your
   Subscriptions, More Like …, History, and Saved, followed by conditional From
   Your Subscriptions and Live Now. Normal rows have four cards; X changes only
   cached recommendation/discovery/subscription/live slates.
4. Mango Companion's configured AI is a stateless, versioned StoryDNA content
   teacher. It never receives Household or companion state and never scores,
   ranks, selects, or publishes. A bounded worker runs the local uncertainty-
   aware theme graph; failure retains last-good.
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
| YouTube recommendation model | V2 uses authoritative subscriptions plus Takeout/Mango-local meaningful history only; profiles, mood, companion memory, AI catalogs, Search, Saved, VOD, and charts have zero influence |
| YouTube subscriptions | Read-only for v1; surface/open, no write |
| Rail-creation architecture | Generalize ONE tab-agnostic AI-rail engine with per-tab source adapters: mdblist/Cinemeta for VOD, YouTube API for YT, NexoTV for Live |
| EPG | Deferred — not available today; only paid Xtream could serve it, variable reliability; ship the rest of Live first |
| Viewer identities | Recommendation v2 serves Household only; up to seven optional personal-profile rows remain dormant and recoverable for rollback |
| Mood | Removed from v2 recommendation UI/ranking/generation; preserved state may be cleared idempotently, while non-null writes return `household_only` during v2 serve |
| VOD mix | Exactly six strongest supported fits from the verified-only reserve, allocated `6`, `3/3`, or `2/2/2` across supported Household threads |
| Rewatch | Rated, Saved, and meaningfully watched exact VOD titles remain ineligible; no cooled-rewatch lane |
| AI boundary | Stateless StoryDNA content teaching runs off the couch path; the local versioned theme graph owns all scores, uncertainty, rank, and publication |
| Rank execution | Batched feature I/O plus a deadline-bounded worker thread; diagnostic inline opt-out only |
| YouTube shape | Five equal core rails For You → Beyond Your Subscriptions → More Like … → History → Saved, then conditional From Your Subscriptions and 1–4-card Live Now |
| YouTube mix | For You is a renormalized 60% decayed-history / 40% subscription blend; Beyond and More Like provide bounded novelty and thematic depth |
| YouTube reservoir | Only subscription/history provenance can enter atomic generations; exact watched/Saved videos are excluded and OAuth failure retains explicitly stale last-good |
| YouTube X | Discovery rotation from cache only; History/Saved stable; no provider/API/quota activity |
| Attribution | Opaque Household/domain/rail/revision/membership/context tokens only; no numerical or private-generation details |

---

## Historical cross-tab AI-rail plan

| Phase | Work |
|-------|------|
| 0 — Spine | Refactor movies/series `compose.ts` + `bootstrap.ts` + `topUpRail` into a tab-agnostic AI-rail engine with per-tab source adapters (VOD adapter = existing behavior, regression-gated to zero change for movies/series); add unified `GET /ai/context` snapshot (current tab, open detail, now-playing incl. live channel, across all four tabs) injected into the agent each turn |
| 1 — YouTube AI (first) | YouTube source adapter → custom YT rails via the engine (`mango_create_ai_catalog` gains `tab: youtube`); recommender steering (profile taste + conversation seeds into For You/discovery); personalization (loves/avoids bias YT seeds); subscriptions read-only; phone/HUD reflect YT rail creation + open |
| 2 — Live AI | Live source adapter → AI-composed live rails (keyword/source over NexoTV, feasible today); channel search + open ("put on cricket" opens channel, pad B tunes); now-playing-live awareness; EPG deferred |
| 3 — Cross-surface + safety + text | ✓ **Shipped** — see below |

Each historical phase ended with its own Pi deploy/gate boundary. The current
Household recommendation changes require a fresh gate and couch proof; older
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
