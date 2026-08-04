# Starter prompt — work agent (simplify YT + VOD recommendations)

Paste into a **fresh work-Mac** agent session on `feat/native-experience`.
This is a **design-first** mission: review → human design questions → written
plan. **Do not implement** the refactor until the human answers the design
questions and explicitly approves the plan.

```text
Work in the mango repo on branch feat/native-experience only.
You are the work agent. Prefer reading and planning over coding in this
session. Do NOT implement the recommendation refactor, delete profiles/mood,
or deploy to the Pi until the human answers the design questions and
explicitly approves an implementation plan.

Tip at prompt write time: 0ec8779 (feat/native-experience). Re-fetch tip;
if it moved, note the SHA delta in your review.

══════════════════════════════════════════════════════════════════
MISSION
══════════════════════════════════════════════════════════════════

The current Movies/TV (VOD) and YouTube recommendation systems have grown too
complex. On the couch they do not feel thematic or trustworthy enough.
Viewer profiles and mood feel like product bloat and are candidates for
complete removal.

Your job in THIS session:

1. Thorough review of both recommendation systems (VOD For You + YouTube).
2. Ask a short set of human-in-the-loop MAIN design questions (blockers only).
3. After answers: write a concrete implementation plan (no code yet unless
   the human later says "implement").

Out of scope for this session unless the human expands it:
- Implementing the refactor
- Pi deploy / couch proof
- Touching pad/input stacks, YouTube OAuth/quota knobs, or deleting runtime DBs

══════════════════════════════════════════════════════════════════
HARD CONSTRAINTS
══════════════════════════════════════════════════════════════════

- Preserve Fire & Water as the durable taste signal unless the human
  explicitly redesigns ratings in the Q&A.
- Preserve verified playability library. Removing a rail/UI surface must
  NEVER purge rail_pool / titles / verify history. (Recent mistake: horror
  AI slot delete was wrongly paired with playability purge — do not repeat.)
- VOD and YouTube recommendation systems must stay DOMAIN-DISJOINT: Fire/Water
  must not feed YouTube taste; YouTube watch/search must not feed VOD For You.
  (Cross prior was removed in 708f0b4; keep that invariant.)
- Movies and TV Shows may share one VOD ranker (including bounded movie→series
  transfer) unless the human decides otherwise.
- Git-only Pi deploy later; never rsync/scp repo trees.
- Do not invent passes. Unknowns → explicit questions or DEFERRED.

══════════════════════════════════════════════════════════════════
PHASE 0 — READ FIRST (docs + code map)
══════════════════════════════════════════════════════════════════

Docs (read, do not rewrite yet):
- docs/VISION.md
- docs/FIRE_WATER_RATINGS.md
- docs/STATUS.md (Fire/Water + For You + M6.2 YouTube sections)
- docs/ARCHITECTURE.md (relevant layers)
- docs/SEARCH.md (only if Search overlaps recommendations)
- docs/tasks/RECOMMENDATIONS_HOME_PI_REPORT.md (home Pi evidence / known issues)
- AGENTS.md (deploy + pad locks)

Code — VOD For You:
- src/catalog-service/src/recommendations/** (engine, service, ai, snapshots)
- src/catalog-service/src/library/ratings.ts (+ migrations touching profiles)
- src/launcher/src/ratings.ts, home.ts (For You rail presentation)
- Flags: MANGO_FIRE_WATER_RATINGS, MANGO_FOR_YOU, MANGO_RECOMMENDATIONS_AI

Code — YouTube discovery:
- src/catalog-service/src/youtube/service.ts (taste profile, For You reservoir,
  rails mix, Fire/Water prior removal)
- youtube DB reservoirs / candidate state
- Launcher YouTube rails (4-card contract)

Code — profiles / mood (likely bloat to remove):
- viewer profiles (Household + personal), activation, onboarding
- session mood (setViewerMood / mood tokens)
- profile-scoped ratings, snapshots, recommendation events, attribution tokens
- companion tools: mango_manage_viewer_profile and any mood surfaces
- launcher profile/mood UI if present

Recent relevant commits to understand failure modes:
- 708f0b4 disjoint YT taste + For You reserve 200
- 883b3cc era-collision horror skew + sticky adjacent bucket fix
- 0ec8779 drop ai-horror theme profile (slot already deleted on Pi)
- earlier: reserve band / cluster / 4/1/1 visible slate work

══════════════════════════════════════════════════════════════════
PHASE 1 — THOROUGH REVIEW (write this BEFORE asking questions)
══════════════════════════════════════════════════════════════════

Produce a review doc (draft in the chat; optionally save under
docs/tasks/RECOMMENDATIONS_SIMPLIFY_REVIEW.md only if useful) covering:

A. Current architecture (one diagram or bullet layers each for VOD and YT)
B. What each system optimizes for today (signals, buckets, reserves, shuffle)
C. Complexity inventory — list subsystems that feel overbuilt:
   - profiles / Household blend / personal clean slate
   - mood
   - AI semantic enrichment
   - MMR / cluster caps / affinity bands / depth fill
   - attribution tokens / served slates / diagnostics metrics
   - implicit prefs / negatives / rewatch cadence
   - movieTransfer / dual-horizon / script buckets (YT)
D. Why couch quality feels wrong (evidence from code +
   docs/tasks/RECOMMENDATIONS_HOME_PI_REPORT.md + known bugs):
   - era/type feature collapse (partially fixed)
   - empty taste_tags on seed ratings
   - adjacent-pool starvation (partially fixed)
   - large single-theme AI rails polluting candidates
   - opaque affinity when rails/tags are thin
E. What is working and must be kept (contracts worth preserving)
F. Proposed simplification directions (2–3 alternatives, not one true path)
G. Explicit non-goals / risks (quota, playability, Search, companion)

Do NOT ask the human questions until A–G are written.

══════════════════════════════════════════════════════════════════
PHASE 2 — HUMAN-IN-THE-LOOP DESIGN QUESTIONS
══════════════════════════════════════════════════════════════════

Ask ONLY main design questions (about 6–10). Each question must:
- state why it blocks the plan
- give 2–3 concrete options (not open essay prompts)
- note your recommendation and one-line rationale

Suggested question themes (adapt after Phase 1; drop any already answered
by the review):

1. Taste authority: Fire/Water only vs Fire/Water + watch/save implicit vs
   tags-required seed quality bar
2. Profiles: delete personal profiles entirely and keep only Household vs
   keep Household+personal but hide UI vs full removal including Household
   blend machinery
3. Mood: delete completely vs keep as one ephemeral companion hint
4. VOD For You shape: keep 6-card 4/1/1 vs simpler “top N thematic” vs
   multi-row
5. Thematic definition: rail membership / taste_tags / title tokens /
   LLM themes — which is primary?
6. Candidate universe: all verified titles vs curated rails only vs
   verified minus denylisted AI/test rails
7. Shuffle: rotate within deep reserve vs rebuild snapshot vs lighter
   “new six from same model”
8. YouTube For You: keep 70/20/10 four-card patterns vs simplify; keep
   reservoir rebuild-on-refresh vs thinner model
9. AI enrichment (MANGO_RECOMMENDATIONS_AI): keep optional / default off /
   remove path
10. Migration/compat: hard cut on feat/native-experience vs flags +
    one-release dual-read

WAIT for human answers. Do not invent product decisions.

══════════════════════════════════════════════════════════════════
PHASE 3 — IMPLEMENTATION PLAN (after answers only)
══════════════════════════════════════════════════════════════════

Write docs/tasks/RECOMMENDATIONS_SIMPLIFY_PLAN.md with:

1. Decisions locked (from Q&A)
2. Target architecture (simple boxes; VOD vs YT clearly separated)
3. Removals list (profiles, mood, files/tables/APIs/UI)
4. Retention list (ratings, snapshots?, playability, disjoint domains)
5. Migration / data handling (Household ratings stay; profile tables?)
6. Phased delivery (P0 contract cleanup → P1 ranker → P2 YT → P3 delete bloat)
7. Test + gate plan (catalog npm test, launcher build, Pi gate later)
8. Couch acceptance checklist (thematic feel, shuffle, no horror-skew class
   failures, YouTube quota-safe)
9. Explicit “do not touch” list

Then STOP and ask the human whether to proceed to implementation in a
follow-up session.

══════════════════════════════════════════════════════════════════
DELIVERABLES FOR THIS SESSION
══════════════════════════════════════════════════════════════════

1. Phase 1 review (chat and/or docs/tasks/RECOMMENDATIONS_SIMPLIFY_REVIEW.md)
2. Phase 2 design questions (blocking)
3. After answers: docs/tasks/RECOMMENDATIONS_SIMPLIFY_PLAN.md
4. Short status note: tip SHA reviewed, open questions remaining

Do not commit implementation. You MAY commit review/plan docs if the human
asks. Do not push unless asked.
```

## Operator note

Home Pi tip / recent recommendation work already on `origin/feat/native-experience`
through `0ec8779` (horror shelf removed; playability purge was a mistaken
home-agent action and must not be repeated). Work agent should treat profiles +
mood removal as a **design option to confirm**, not a silent delete.
