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

## Defects that are not styling

| # | Defect | Why it matters |
|---|--------|----------------|
| D1 | The catalog-offline status message renders **inside the browse tab strip**, taking the slot where `youtube` belongs | navigation silently loses a destination during an outage |
| D2 | Failure copy is developer-facing: `check catalog-service and N2 prereqs.` | names internal services to a couch user |
| D3 | `setStatus()` filters messages through `/couldn\|failed\|unavailable\|timed? out\|try again\|no playable\|not start/i`, so routine feedback is silently dropped | onboarding hints and progress feedback never appear |
| D4 | Related-title captions (`2% watched`) resolve to ~13px at 1080p | far below the ~24px 10-ft floor |

## Execution order

Foundation first: every later view inherits its tokens, so doing it last would
force re-touching all of them. Then the surfaces in order of how often a couch
user sees them, then the states, then operator surfaces.

| Step | Scope | Addresses | Acceptance gate |
|------|-------|-----------|-----------------|
| 0 | **Foundation / token layer** — safe area, focus semantics, dedicated primary-action colour, semantic status palette, casing rule, brand-name fix, kill inline background | C1–C7 | ux-smoke PASS; zero hex/rgba literals outside `:root` for touched properties; focus tokens actually referenced; no capitalised `Mango` in UI strings |
| 1 | **Home / browse** — current-tab legibility, rail-label casing and hierarchy, focus ring integrity, rail density | C2, C3, C5 | current tab identifiable at 3m without moving focus; focus ring unbroken on all four sides of every poster including row ends |
| 2 | **Detail** — layout balance on a 16:9 canvas, backdrop treatment, primary-vs-focus disambiguation, streams-panel placement, caption legibility | C2, D4 | `play`/`resume` distinguishable from the focused control when focus is elsewhere; no caption below 24px; right half of canvas no longer empty |
| 3 | **Search** — reclaim the ~40% dead canvas below the keyboard, single amber meaning, recents de-duplication, placeholder copy | C2, C6 | one amber meaning on screen; no row label that repeats its column heading |
| 4 | **Episodes / seasons panel** — season chip affordance, episode row rhythm, playability badges | C2, C3 | season selection state distinct from focus; episode rows legible at 3m |
| 5 | **Live + YouTube tabs** — rail-specific card treatments, channel/badge legibility | C3, C5 | consistent with Home rails; no untokenised colour |
| 6 | **System states** — loading skeletons, empty, offline/error, toast severity | C4, D1, D2, D3 | offline message never occupies a nav slot; no internal service names in user copy; loading state visible instead of empty black |
| 7 | **Overlays** — voice HUD, next-episode prompt | C3, C4 | safe-area respected; consistent with the new token layer |
| 8 | **Settings / Reliability Center** — operator surfaces, semantic status instead of accent reuse | C4, C5 | warning/error no longer reuse `--accent` |
| 9 | **Companion phone app** — resolve the three-way accent drift against brand | C2 | single shared accent value across brand, launcher, companion |

## Working method per step

1. Render the affected surfaces locally: `python3 tools/ux-harness/capture.py <filter>`.
2. Implement, re-render, and compare before/after at 1920×1080.
3. Check the step's acceptance gate; run `bash scripts/m6-ship/gate-m6-ux-smoke.sh` where it applies locally.
4. Commit exactly one step, with the `Verify on Pi` block from the handoff protocol.

## Out of scope

Playback rendering (mpv HUD frame timing, 4K/HDR) — that lane is parked in
[`m6-4k-fidelity.md`](../m6-4k-fidelity.md). This round only touches the HUD's
visual language, not its renderer.
