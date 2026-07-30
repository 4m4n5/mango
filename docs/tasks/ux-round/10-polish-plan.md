# UX round — polish plan

Ordered execution plan for the comprehensive UI/UX polish round. Authored on the
work Mac against locally rendered surfaces (`tools/ux-harness`), verified on the
Pi by the home agent per [`07-handoff-protocol.md`](07-handoff-protocol.md).

Evidence base: 24 locally rendered surfaces, 12 Pi captures, the surface
inventory (`00`), extracted design system (`01`), platform guidelines (`02`),
competitive sweep (`03`), playback surfaces (`04`), and companion/brand audit
(`06`).

## The core finding

mango has a **declared** visual system (`m6-visual-system-spec.md`, "Cinema
Dark") that is not **enforced**, and every surface built after it was locked has
no spec coverage at all — Search, the YouTube rail, the Live redesign, the
companion. Concretely: 22 hex literals and 72 `rgba()` calls sit outside the
`:root` token block, `--focus-scale-poster` and `--focus-scale-control` are
declared but never referenced (hardcoded `scale()` values are used instead), and
the launcher, brand, and companion each use a different accent value.

So this round is not a repaint. It is: finish the token layer, extend it to the
unspec'd surfaces, and fix the defects that make the TV read as a dev tool.

## Cross-cutting issues (fix once, in the foundation commit)

| # | Issue | Evidence |
|---|-------|----------|
| C1 | `--safe-x: 48px` is 2.5% of 1920 — platform floor is 5% (~96px) | `02` corrected against Android TV's 5% margin |
| C2 | Amber `--accent` means *focus*, *primary action*, *selected tab*, *badge*, and *warning* simultaneously | detail: filled amber `resume` vs amber focus ring; Reliability yellow reuses `--accent` |
| C3 | Focus scale tokens declared but unused; six different focus patterns across surfaces | `01` |
| C4 | No semantic status palette on user-facing surfaces; error cards are undifferentiated dark rectangles | `21-rails-failed`, `01` |
| C5 | Casing is inconsistent: `Continue watching` and `Catalog offline` next to `related titles` and `apps` | home, detail, offline |
| C6 | Brand name capitalised in UI: `aria-label="Search Mango"`, search placeholder `Search Mango` | `index.html:13`, search view |
| C7 | ~~Body background hardcoded `#07080a` inline, duplicating `--bg-base`~~ — **kept deliberately**: it paints the canvas before CSS parses, preventing a white flash during Chromium startup on the Pi | `index.html:8` |
| C8 | **The whole type scale sits below TV platform floors.** Fire TV's minimum is 28px at 1080p and tvOS's body minimum is 29pt; mango's `--text-caption` is 20px, `--text-control` 22px, `--text-body` 26px, and only `--text-title` (28px) reaches the floor. Raising the scale reflows every surface, so it is a product decision, not a polish edit — **open, needs a call** | `02` §2; measured tokens in `style.css:root` |

## Defects that are not styling

| # | Defect | Why it matters |
|---|--------|----------------|
| D1 | The catalog-offline status message renders **inside the browse tab strip**, taking the slot where `youtube` belongs | navigation silently loses a destination during an outage |
| D2 | Failure copy is developer-facing: `check catalog-service and N2 prereqs.` | names internal services to a couch user |
| D3 | `setStatus()` filters messages through `/couldn\|failed\|unavailable\|timed? out\|try again\|no playable\|not start/i`, so routine feedback is silently dropped | onboarding hints and progress feedback never appear |
| D4 | Related-title captions (`2% watched`) resolve to 13.12px at 1080p, and the **card titles above them to only 15.68px** — the clamps cap out (`0.98rem` / `0.82rem`) well before 1080p | measured; under half the 28px platform floor |
| D5 | The Movies tab served a stale, mostly-empty catalog cache while the backend already had every rail; only a page reload fixed it | a couch user has no reload affordance, so Home simply looks empty |
| D6 | Streams rows print a literal `audio n/a` when language metadata is missing, repeating the placeholder down every row | `detail.ts:1787`; a null value occupies each row's most prominent secondary line |

Not a defect, checked and cleared: the `KA` placeholder art on a poster-less title
is the metadata provider's own artwork, not a mango-generated initial.

### Outside this round

Synthetic key input and the `/api/pad/nav` HTTP transport intermittently stopped
registering during Pi capture while the launcher stayed responsive to mouse
clicks. That is an input/reliability question, not a visual one, and needs its own
investigation — visual work must not be read as having fixed it.

## Execution order

Foundation first: every later view inherits its tokens, so doing it last would
force re-touching all of them. Then the surfaces in order of how often a couch
user sees them, then the states, then operator surfaces.

| Step | Scope | Addresses | Acceptance gate |
|------|-------|-----------|-----------------|
| 0 | **Foundation / token layer** — safe area, focus semantics, dedicated primary-action colour, semantic status palette, casing rule, brand-name fix, kill inline background | C1–C7 | ux-smoke PASS; zero hex/rgba literals outside `:root` for touched properties; focus tokens actually referenced; no capitalised `Mango` in UI strings |
| 1 | **Home / browse** — current-tab legibility, rail-label casing and hierarchy, focus ring integrity, rail density | C2, C3, C5 | current tab identifiable at 3m without moving focus; focus ring unbroken on all four sides of every poster including row ends |
| 2 | **Detail** — layout balance on a 16:9 canvas, backdrop treatment, primary-vs-focus disambiguation, streams-panel placement, caption legibility | C2, D4, D6 | `play`/`resume` distinguishable from the focused control when focus is elsewhere; related-card text at the caption token or above; backdrop reads as artwork while copy holds ≥4.5:1 against a worst-case white backdrop |
| 3 | **Search** — reclaim the ~40% dead canvas below the keyboard, single amber meaning, recents de-duplication, placeholder copy | C2, C6 | one amber meaning on screen; no row label that repeats its column heading |
| 4 | **Episodes / seasons panel** — season chip affordance, episode row rhythm, playability badges | C2, C3 | season selection state distinct from focus; episode rows legible at 3m |
| 5 | **Live + YouTube tabs** — rail-specific card treatments, channel/badge legibility | C3, C5 | consistent with Home rails; no untokenised colour |
| 6 | **System states** — loading skeletons, empty, offline/error, toast severity | C4, D1, D2, D3 | offline message never occupies a nav slot; no internal service names in user copy; loading state visible instead of empty black |
| 7 | **Overlays** — voice HUD, next-episode prompt | C3, C4 | safe-area respected; consistent with the new token layer |
| 8 | **Settings / Reliability Center** — operator surfaces, semantic status instead of accent reuse | C4, C5 | warning/error no longer reuse `--accent` |
| 9 | **Companion phone app** — resolve the three-way accent drift against brand | C2 | single shared accent value across brand, launcher, companion |

## Decisions taken during execution

**Rail density: 5 poster / 4 landscape columns, one row per rail** (step 5,
supersedes the earlier "stays at 9 columns" note). The blocker in that note was
that rails ship more items than a narrower grid can hold on one row, so 7 columns
would wrap a 9-item rail into a 7 + 2 orphan row. The fix was to make the row
budget explicit rather than to keep the grid wide: `renderRails()` now slices each
rail to its column count, so a rail is always exactly one row, and the column
count is free to follow platform guidance.

Numbers, with sources, in [`08-card-grid-research.md`](08-card-grid-research.md).
Both passes independently landed on a 40px gutter, so posters and thumbnails now
share one `--card-gap`:

| | before | after | guidance |
|---|---|---|---|
| poster card | 174×261 | **314×470** | 306–314 wide (Prime Video, Disney+, tvOS poster rows) |
| 16:9 card | 227×127 | **402×226** | 392–410 wide (Android TV 196dp) |
| gutter | 20px | **40px** | 20dp = 40px (Android TV grid) |
| items per rail | 9 / 12 (wrapped to 2 rows) | **5 / 4** (one row) | — |

Two consequences to accept deliberately:

- **Fully visible rails drop to ~2 per screen.** This is what the poster research
  recommends against optimising away: 3+ full portrait rows forces poster width
  back under 255px. A partly visible peek row is standard TV practice and doubles
  as the scroll affordance.
- **Short rails leave empty columns** (a 3-item "continue watching" leaves 2). A
  fixed-column grid always does; it is far less pronounced than the 6 empty
  columns the 9-column grid left.

**Backend rail limits stay as they are.** `YOUTUBE_RAIL_LIMIT` (12) and
`DEFAULT_RAIL_LIMIT` (20) are deliberate headroom, since items are still dropped
for playability and dedup after the service returns them; the launcher's row
budget is what guarantees one clean row. Sliced-out cards never enter the DOM, so
their artwork is never fetched and the only cost is JSON. The knock-on is that
top-of-rail *ordering* quality now matters more than it did at 9 visible items —
a content-quality item for a later round, not a layout defect.

## Working method per step

1. Render the affected surfaces locally: `python3 tools/ux-harness/capture.py <filter>`.
2. Implement, re-render, and compare before/after at 1920×1080.
3. Check the step's acceptance gate; run `bash scripts/m6-ship/gate-m6-ux-smoke.sh` where it applies locally.
4. Commit exactly one step, with the `Verify on Pi` block from the handoff protocol.

## Out of scope

Playback rendering (mpv HUD frame timing, 4K/HDR) — that lane is parked in
[`m6-4k-fidelity.md`](../m6-4k-fidelity.md). This round only touches the HUD's
visual language, not its renderer.
