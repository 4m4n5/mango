# mango — AI layer

**Milestone:** [M5](ROADMAP.md) · **Rule (unchanged):** voice **opens**, pad **B** plays — no voice playback, on every tab including Live.

**Recommendation status:** target `772b3d5` leaves one executable architecture
per domain: local progressive Household VOD and provenance-gated YouTube v2.
`off` disables recommendations, `shadow` builds only the latest architecture
without exposing recommendation rails, and `serve` exposes only its published
accepted generation. The latest repository-recorded Pi snapshot predates that
cleanup. Source rollout blockers are closed; unattended wrappers remain blocked
by documented operations gaps. Public promotion, current-SHA diagnostics and
screenshots, and human TV-quality verdicts remain **DEFERRED**. No bulk
artifact/importer exists or is required by
the current design. See [STATUS.md](STATUS.md).

---

## Why this exists

Mango uses AI for two bounded jobs: a conversational librarian that can search,
clarify, remember, curate custom rails, and open content; and a stateless
StoryDNA content teacher that enriches VOD evidence off the couch path. AI does
not own Household identity, eligibility, scores, recommendation publication,
playback, or provider truth. YouTube v2 ranking is local and uses authoritative
subscriptions/history rather than an LLM.

---

## Current AI coverage

| Capability | Source contract | Latest proof boundary |
|------------|-----------------|-----------------------|
| Cross-source search/open | Movies, series, YouTube, and full Live catalog; voice opens, B plays | Implemented; earlier automated/Pi proof, final current couch pass open |
| Save/Unsave | Exact/current movies, series, YouTube videos, and Live entries where supported | Implemented; no auto-save |
| Custom AI rails | Up to three user-created slots per rendered Movies/TV/Live tab | Implemented; YouTube management/seed code remains, but latest YouTube Home no longer composes those slots—a current contract gap |
| Conversational memory | Local profile/journal/compiled notes for librarian continuity | Implemented; full memory couch sign-off open |
| VOD recommendation | Local Household Story Frontier over verified titles; AI teaches optional content overlays only | Latest-only source; local build/tests pass; Pi deployment/promotion/couch proof open |
| YouTube recommendation | Local provenance-gated subscriptions/history model; no AI input | Latest-only source; non-Household `off` ownership regression is fixed/tested, while Pi rollback/promotion proof remains open |
| Live | Full catalog search/open plus custom rails and now-playing context; EPG absent | Optional runtime; source/config dependent |
| Viewer profiles/mood | Rows preserved through every mode; no current recommender consumes them | VOD `shadow`/`serve` switch product identity to Household and reject personal/mood mutations; `off` restores profile UI but has no recommendation rail |

The older Phases 0–3 and M5.5b/M6.5 base have historical automated/Pi evidence.
That proof does not cover the current Household recommendation redesign or the
final couch experience.

Structural facts for the latest-only contracts:

1. `library.db` is the durable recommendation-signal authority: permanent
   Household ratings, Saved, qualifying watch history, exact Not-for-me,
   normalized Takeout events/import audit, and recommendation events. Existing
   personal-profile and mood rows remain durable and recoverable. VOD
   `shadow`/`serve` uses Household; `off` restores personal state without
   starting a deleted ranker.
   `progress.db` separately preserves profile-exact Continue/resume.
2. VOD For You is locally ranked from the complete currently verified corpus.
   Every visible rail has exactly six strongest supported fits allocated across
   up to three Household taste threads; no fixed exploration bucket or cooled
   rewatch lane exists. Explicit positive Fire/Water owns 85% when present.
3. YouTube v2 uses only authoritative subscriptions and Takeout/Mango-local
   meaningful history. Its five logical core positions are For You, Beyond Your
   Subscriptions, More Like …, History, and Saved, followed by conditional From
   Your Subscriptions and Live Now. Normal rows render only with exactly four
   cards, so thin positions can be absent; X changes only cached
   recommendation/discovery/subscription/live slates.
4. Local deterministic content profiles and the uncertainty-aware theme graph
   own ranking. Mango Companion's configured AI is an optional stateless,
   versioned StoryDNA overlay teacher. It never receives Household or companion
   state and never scores, ranks, selects, or publishes. The new selective
   frontier worker is committed but defaults off; failure retains last-good.
5. Live is IPTV — a tune-to-channel model, fundamentally different from VOD —
   so it keeps its own custom-rail contract rather than pretending to share the
   Fire/Water or YouTube ranker.

---

## Current architecture

Four runtimes: phone companion PWA (PTT + chat) → orchestrator (Deepgram STT → Anthropic tool loop) → catalog-service (`:3020` `/voice/*`) + launcher (`:3000`, voice command queue, long-poll).

| Store | Role |
|-------|------|
| `/etc/mango/companion/profile.yaml` | Conversational memory/familiarity; not viewer-profile authority |
| `/etc/mango/companion/companion.db` | SQLite journal events, watch signals, and rollup inputs |
| `/etc/mango/companion/compiled-notes.md` | Human-readable compiled librarian memory; `/voice/library/notes` reads/writes this surface |
| `~/.cache/mango/voice-librarian-notes.json` | Legacy read fallback only when compiled notes are empty; not the primary durable store |
| `ai-catalogs/*.yaml` | Up to 3 declared user-created slots per tab; current YouTube declarations are not composed by its Home renderer |
| `library.db` | Household/personal profiles, mood, ratings, Saved, profile watch/history/search, Not-for-me, recommendation events, opaque served attribution |
| `progress.db` | Profile-exact Continue/resume positions; legacy unscoped state belongs only to Household |
| `playability.db` | Verified pools incl. AI slots |
| `youtube.db` | Rebuildable YouTube metadata, reservoirs, exposure/cache state |
| recommendation generations | Versioned local VOD/YouTube ranks, cached slates, and last-good state |

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
| Companion UX | Partial | Structured picks, HUD safe-area, and chat-first phone are implemented; current couch sign-off is pending |
| TV command transport | Excellent | Long-poll + seq + ack — keep |
| Cross-surface state | Partial | `/ai/context` mirrors tab/open/playing state; pad-only fine-grained focus remains intentionally limited |

---

## Product UX contract

> Ask Mango anything about what to watch. It remembers the conversation, sees
> the current TV context, curates useful discovery, and opens a title—you press
> **B** to play.

### 1. Knows the household without conflating state

- Fire/Water, Saved, and bounded meaningful watch evidence belong to local
  Household recommendations.
- Conversation history and librarian notes belong to companion memory.
- Existing personal-profile/mood data is preserved but hidden/rejected while
  VOD recommendations are active (`shadow` or `serve`); no startup chooser or
  inferred mood.
- The StoryDNA teacher receives neither category of private state.

### 2. Sees the room

- Companion mirrors current tab/focus/open detail/now-playing incl. live channel

### 3. Acts on TV

- Navigate, focus/shuffle system rails, and save/unsave across all four tabs;
  create/update AI rails only where the current tab renderer actually composes
  them. YouTube-slot visibility claims are blocked until its orphaned management
  surface is reconciled.
- Voice opens, pad plays

### 4. Curates home

- Conversation → rail via LLM-assisted composition
- Gardener top-ups from taste
- Background content enrichment with deterministic local eligibility/ranking
- Cached, atomic last-good rails; Home/X never waits for AI or network work

### 5. Stays calm

- No proactive push in the current product contract
- Home remains a content surface, not a conversation or diagnostics feed

### 6. Safe & trustworthy

- Discover never jumps TV turn 1; open only on clear single match/ordinal
- Phone claims "opened" only on `ok` + `tv_seq`
- Rail claims "on TV" only on `visible_on_tab`, except YouTube where that status
  is not sufficient until management and rendering are reconciled

---

## Locked decisions

| Decision | Choice |
|----------|--------|
| Sequencing | YouTube first, then Live |
| Live playback contract | Voice opens, pad B plays — Live included, no voice-tune exception |
| Live depth | Full: **full-catalog** channel search via `mango_search` + open; AI-composed live rails; now-playing; EPG deferred |
| YouTube recommendation model | V2 uses authoritative subscriptions plus Takeout/Mango-local meaningful history only; profiles, mood, companion memory, AI catalogs, Search, Saved, VOD, and charts have zero influence |
| YouTube subscriptions | Read-only for v1; surface/open, no write |
| Rail-creation architecture | One tab-agnostic engine with per-tab adapters; Movies/TV/Live render it. YouTube adapter/management remains but Home composition is currently disconnected and must not be claimed visible |
| EPG | Deferred — not available today; only paid Xtream could serve it, variable reliability; ship the rest of Live first |
| Viewer identities | VOD `shadow`/`serve` uses Household; `off` restores personal-profile state but has no For You recommender. Up to seven optional personal rows remain recoverable |
| Mood | Removed from current recommendation UI/ranking/generation; preserved state may be cleared idempotently, while non-null writes return `household_only` during VOD `shadow`/`serve` |
| VOD mix | In `serve`, exactly six strongest supported fits from the verified-only reserve, allocated `6`, `3/3`, or `2/2/2` across supported Household threads |
| Rewatch | Rated, Saved, and meaningfully watched exact VOD titles remain ineligible; no cooled-rewatch lane |
| AI boundary | Stateless StoryDNA content teaching runs off the couch path; the local versioned theme graph owns all scores, uncertainty, rank, and publication |
| Rank execution | Batched feature I/O plus a deadline-bounded worker thread; diagnostic inline opt-out only |
| YouTube shape | In `serve`, five ordered logical core positions For You → Beyond Your Subscriptions → More Like … → History → Saved, then conditional From Your Subscriptions and Live Now; normal rows require exactly four cards and may be absent |
| YouTube mix | For You is a renormalized 60% decayed-history / 40% subscription blend; Beyond and More Like provide bounded novelty and thematic depth |
| YouTube reservoir | Only subscription/history provenance can enter atomic generations; exact meaningful watches cool down for 30 days, Saved videos remain excluded, and OAuth failure retains explicitly stale last-good |
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

**Automated gate:** `bash scripts/m5-voice/ai/gate-m5-companion-couch.sh` uses
mock paths only; it does not call or validate a live LLM. Live configured-model
behavior remains a separate Pi/phone/human acceptance step.

### M5.5b / M6.5 round (2026-07-05) ✓ code

| Deliverable | Status |
|-------------|--------|
| Structured pick cards + `pick_select` | ✓ |
| Detail 2D FocusGrid | ✓ |
| HUD safe-area + ux-smoke gate | ✓ |
| Living librarian watch signals + journal rollup | ✓ |
| YouTube rail cap | Current `serve` uses a Household-only, supply-conditional four-card allocator; latest recorded Pi state predates the latest-only cleanup, so current couch proof is deferred |

Manual COUCH_TEST V1–V12 + U1–U9 pending. Detail: [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md)

---

## Phase 3 — locked decisions (reference)

| Decision | Choice |
|----------|--------|
| Text pipeline | Shared agent path — text skips STT; same tools, policy, TV dispatch, conversation thread as voice |
| Phone text UX | Persistent composer bar + send below chat; PTT remains |
| Text → TV feedback | HUD tool line + phone tool cards; no speaking dwell blocking next message |
| Text TTS | None — text bubble on phone; idle immediately after reply (Piper remains off until the target audio path is explicitly validated) |
| Companion mirror | Rich — collapsible YouTube/On TV chips · chat log · tab/open/playing/tool status |
| Room state source | Hybrid (Phase 0) — server last nav/open + now playing; pad-only navigation still blind until launcher instrumentation |
| Safety gate | Automated mock gate + expanded corpus; configured live-model behavior requires separate Pi/phone/human acceptance |
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
