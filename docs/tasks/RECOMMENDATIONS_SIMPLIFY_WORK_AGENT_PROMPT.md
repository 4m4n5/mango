# Starter prompt — work agent (recommendation engine redesign)

Paste into a **fresh work-Mac** agent session on `feat/native-experience`.

```text
Work in the mango repo on branch feat/native-experience.

You are redesigning Mango’s recommendation experience for the living-room TV:
Movies/TV (VOD) and YouTube. The current systems feel overcomplicated and not
thematic or satisfying enough on the couch. Viewer profiles and mood feel like
bloat and are strong candidates to remove — but treat that as a design
judgment after you understand the product, not as a predetermined delete list.

This session is research + design. Do not implement a large refactor until you
have (1) formed your own understanding, (2) asked the human the few decisions
that actually need them, and (3) written a clear plan they approve.

══════════════════════════════════════════════════════════════════
HOW TO WORK
══════════════════════════════════════════════════════════════════

Do your own R&D. Do not only follow a fixed file checklist.

- Explore the mango codebase until you understand what is actually shipping:
  VOD For You, Fire/Water ratings, YouTube rails/reservoirs, launcher
  presentation, companion touchpoints, flags, and durable state.
- Read product docs that matter (VISION, STATUS, FIRE_WATER_RATINGS,
  ARCHITECTURE, PLAYABILITY, recent docs/tasks recommendation reports) — but
  use them as context, not gospel. Call out where the product and the code
  diverge, or where the docs encode complexity that should die.
- Look outward: how good TV/streamers and music products do “For You”,
  cold start, taste axes, exploration vs exploitation, shuffle, household
  living-room use, and thematic rails. Prefer principles you can defend for a
  10-foot couch product over academic recsys maximalism.
- Be opinionated. Propose what “feels correct and thematic” should mean for
  Mango specifically (India + global VOD, Fire/Water taste, verified-playable
  library, YouTube as a separate domain).

Practical repo notes (not sacred):
- Branch: feat/native-experience. Re-fetch tip; note SHA if it moved.
- Pi deploy is git-only later; this session need not deploy.
- Do not purge playability pools / verified library when removing UI rails.
- Recent pain: era-collision skew, empty taste tags, sticky shuffle slots,
  accidental playability purge when dropping an AI horror rail — learn from
  those, don’t re-litigate them forever.

══════════════════════════════════════════════════════════════════
PHASE 1 — UNDERSTANDING (you drive)
══════════════════════════════════════════════════════════════════

Build your own model of the system. Deliver a concise review that covers:

- What exists today for VOD vs YouTube recommendations (signals, ranking,
  reserves/shuffle, UI contracts).
- What is overbuilt or incoherent.
- What actually works and is worth keeping.
- External inspiration: 3–7 ideas from industry/research that fit a couch TV
  (cite sources lightly; focus on why they’d help Mango).
- 2–3 credible redesign directions (from “radical simplify” to “keep spine,
  replace guts”), with tradeoffs.

Write this before you interrogate the human.

══════════════════════════════════════════════════════════════════
PHASE 2 — HUMAN QUESTIONS (few, high-leverage)
══════════════════════════════════════════════════════════════════

Ask only the decisions you cannot responsibly make alone. Prefer a short
list with concrete options and your recommendation. Likely themes (adapt
freely):

- What “success” means on the couch for For You
- Whether profiles/mood die completely
- How thematic taste should be defined (ratings, tags, rails, behavior, AI)
- How bold vs safe exploration should feel
- How separate YouTube should stay from VOD
- Migration appetite (hard cut vs gradual)

Wait for answers.

══════════════════════════════════════════════════════════════════
PHASE 3 — PLAN (after answers)
══════════════════════════════════════════════════════════════════

Write an implementation plan the human can approve or redirect:
docs/tasks/RECOMMENDATIONS_SIMPLIFY_PLAN.md (or a better name you choose).

Include target experience, architecture sketch, removals/additions, data
migration notes, phased delivery, and how you’ll prove it on the couch.
Then stop for approval before coding the refactor.

══════════════════════════════════════════════════════════════════
NORTH STAR
══════════════════════════════════════════════════════════════════

Design a recommendation engine that feels simple, thematic, and satisfying
from the couch — not a museum of ranking features. Cleverness is fine when it
serves that feeling; complexity that doesn’t is debt.
```

## Note

Prior home/Pi recommendation work is already on `origin/feat/native-experience`.
This brief intentionally leaves the design space open so the work agent can
research and propose a stronger system rather than execute a constrained
cleanup checklist.
