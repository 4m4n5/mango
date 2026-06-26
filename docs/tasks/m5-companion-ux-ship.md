# M5.5 — AI companion contract + post-YouTube UX

**Milestone:** M5 (Voice + AI) for safety contract; M6.5 for final polish · **Blocks:** M6 ship merge
**Depends on:** M5 voice librarian ✓ · AI catalogs ✓ · bootstrap ✓ · living librarian (memory + conversation policy) ◐  
**Partner skill:** `$ux-design-expert` (phone surfaces) · `$mango-tv-box-expert` (TV HUD + couch acceptance)

---

## Why this exists

mango's north star is **plug-and-play AI TV box** — *ask or browse in mango, watch in mpv*. The companion is half of that promise. Infrastructure (STT, tools, memory store, AI catalogs) can pass gates while the **felt experience** still fails: dumb discover→open, opaque tool cards, no proactive opt-in, TV HUD that fights the launcher, or phone/TV surfaces that disagree.

**M5.5 is split deliberately.** M5.5a is the explicit voice safety contract before more surfaces land. M5.5b is the final cross-surface companion/HUD polish after native YouTube, so Mango validates one coherent UX across Movies, Series, Live, and YouTube.

**Invariant (unchanged):** voice **opens** detail; pad **B** plays. No `mango_play`.

---

## Scope

### M5.5a — Voice safety contract

#### 1. Capability review & tool manifest

| Work | Detail |
|------|--------|
| Tool audit | Every `mango_*` tool: schema text, error shapes, when-not-to-call |
| Policy alignment | `persona.md` + `persona.py` tool policy match open/clarify matrix |
| Hinglish corpus | Fixed utterance set: discover, clear open, ambiguous, ordinal, curate, memory, corrections |
| Integration tests | Expand opt-in `MANGO_VOICE_LLM_INTEGRATION=1` scenarios; document couch corpus in repo |
| Deferred tools | Explicit out-of-scope list updated (play, YouTube play, live TV, multi-profile) |

**Exit:** manifest + persona reviewed; corpus in `scripts/m5-voice/ai/fixtures/`; integration script covers R1–R8.

#### 2. Conversation agent quality

| Work | Detail |
|------|--------|
| Discover lane | Vague recs → chat/clarify; **never** search literal question as title |
| Open lane | Clear title → search → single winner → `tv_seq` ack; multi-hit → list, no open |
| Ordinals | "doosra wala" after list opens correct hit |
| Curate lane | AI catalog suggest+confirm; overflow (replace/merge) explained once on phone; no AI write to Saved |
| Memory lane | "what do you know about me?" → readable summary, not yaml dump |
| Now-playing | Inject mpv context when active; don't hallucinate playback state |
| Reflection | Post-PTT light reflect + nightly consolidate — non-blocking |

**Exit:** M5 policy/memory/gardener gates PASS; couch R1–R8 PASS.

#### 3. Cross-surface coherence

| Work | Detail |
|------|--------|
| Open ack | Phone claims "opened" only when `ok:true` + `tv_seq` |
| Async catalogs | "Building rail..." until `visible_on_tab` |
| Title switch | Open from detail/settings without asking user to press home |
| Bootstrap jobs | AI catalog bootstrap jobs — phone status matches launcher |

#### 4. Gates & acceptance

| Gate | Role |
|------|------|
| Existing M5 gates | voice · ai-catalogs · bootstrap · reserve · policy · memory · gardener |
| **`gate-m5-companion-couch.sh`** (new) | discover-no-open + clear-open mock paths |
| **`MANGO_VOICE_LLM_INTEGRATION=1`** | Opt-in full LLM corpus before M5 sign-off |

**Couch — M5.5a safety bar (C-V1–C-V8):** discover no TV jump · clear open ≤8s · ambiguous list · AI catalog confirm · memory summary · proactive off by default · no `play_youtube`/`mango_play_youtube` · 10 min idle stable.

### M5.5b — Post-YouTube product polish

Run after M6.2 native YouTube so the companion/HUD does not get polished against an incomplete content model.

#### 1. Phone companion UX (`src/companion/`)

| Work | Detail |
|------|--------|
| PTT affordance | Hold/active state, 30s cap copy, reconnect, secure-context errors |
| Chat layout | User/assistant/tool cards; partial streaming readable |
| Tool transparency | Creating catalog / opening on TV — human summaries |
| Ambiguous picks | List 2–4 titles; ordinal follow-up clear on phone |
| Settings strip | **Proactive opt-in** (`proactive_opt_in`); connection + CA trust hint |
| Memory view | On-demand formatted "what mango knows" (no raw yaml editor V1) |
| Errors | Couch-safe copy; never API keys or addon rate-limit text |

#### 2. TV voice HUD (`src/launcher/src/voice-hud.ts`)

| Work | Detail |
|------|--------|
| Ephemeral card | listening → thinking → speaking → idle dismiss ≤12 s |
| Leanback safe area | Card never permanently obscures browse focus row |
| Proactive (opt-in) | Max 1/day suggestion on HUD when opted in; home-only |
| Error dwell | ~4 s then dismiss |
| Coherence | HUD text matches phone assistant reply (same turn), including YouTube open/search turns |

#### 3. Post-YouTube acceptance

Companion and HUD must cover Movies, Series, Live, and YouTube with the same open/ack/copy rules before M6.5 merge.

---

## Out of scope

Voice play/pause · `play_youtube` / `mango_play_youtube` · TV Piper TTS (M6.3) · live TV voice · multi-profile · wake word.

---

## M5 complete when

1. **Living librarian** memory + conversation infrastructure  
2. **M5.5a** this doc — capability review + voice safety contract (C-V1–C-V8)
3. **M5.5b** remains an M6.5 merge requirement after native YouTube
