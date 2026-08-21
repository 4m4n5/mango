# Detail side panel — constraint map (pre-redesign reference)

> Read-only exploration. No source files were modified. This is a factual map of
> `.detail-side` (streams list for movies, episode/season list for series) as it
> exists today on `feat/native-experience`, for use before redesigning its height
> allocation, scroll affordance, focus/navigation behavior, and bubble layout.
>
> All line numbers are from the files as read on 2026-07-31. Two files carry the
> bulk of this: `src/launcher/src/style.css` (2987 lines) and
> `src/launcher/src/detail.ts` (1827 lines).
>
> A prior audit already exists and is treated here as ground truth where it
> overlaps: [`docs/tasks/ux-round/00-surfaces.md`](00-surfaces.md) §11–16 (behavior
> inventory) and [`docs/tasks/ux-round/10-polish-plan.md`](10-polish-plan.md)
> (the related-row-under-side-panel decision and its stated costs). Their `detail.ts`
> line citations were taken at an earlier commit and are off by a few lines from
> the current file; this document's own line numbers are current and authoritative.

---

## Section 1 — CSS inventory

### 1.1 Custom properties consumed by this surface

All defined once, in `:root` (`src/launcher/src/style.css:1-109`). "Shared" means
other surfaces (home rails, search) also read it, so changing it has blast
radius beyond Detail.

| Token | Value | Defined at | Shared with home/search? |
|---|---|---|---|
| `--safe-x` | `96px` | line 41 | Yes — `.shell` (line 150), `.browse-bar::after` (188) |
| `--safe-y` | `54px` | line 42 | Yes — `.shell` (line 150) |
| `--focus-ring` | `3px` | line 43 | Yes — every `.focused`/`:focus-visible` box-shadow site |
| `--focus-glow` | `14px` | line 44 | Yes |
| `--focus-gutter` | `calc(var(--focus-glow) + 8px)` = `22px` | line 45 | Yes — `.rails` (359), `.rail-track--posters` (1161), `.search-*` |
| `--focus-ring-color` | `var(--accent)` | line 51 | Yes |
| `--focus-scale-poster` / `--focus-scale-control` / `--focus-scale-surface` | `1.06` / `1.03` / `1.012` | lines 52–55 | Yes (not used directly by `.detail-*`, but by `.card`, `.search-control`, etc. — not present in the side panel's own focus rule, see §1.3) |
| `--text-display` / `--text-title` / `--text-body` / `--text-control` / `--text-caption` / `--text-micro` | `56 / 28 / 26 / 26 / 24 / 20px` | lines 56–71 | Yes — the whole type scale is global |
| `--space-stack-lg` | `1.5rem` (24px) | line 78 | Yes — also `.empty-state`, `.settings-refresh` |
| `--detail-related-gap` | `1.15rem` (18.4px) | line 79 | **No** — comment at line 79 area (see §1.4) says this is deliberately its own token, not a fraction of `--card-gap`, because the related row lives inside a fixed-width grid column and must not inherit the 40px main-rail gutter |
| `--rail-accent-width` | `3px` | line 80 | Yes — every section-label left-accent bar (`.rail-title`, `.detail-related-label`, `.detail-episodes-label`, `.detail-streams-label`) |
| `--space-rail-header` | `1.25rem` (20px) | line 76 | Yes |
| `--accent`, `--accent-soft`, `--accent-glow`, `--accent-rgb` | `rgb(232 160 32)` derivatives | lines 16–19 | Yes — single brand amber source |
| `--border-subtle` / `--border-strong` / `--border-selected` | alpha-white | lines 24–26 | Yes |
| `--tab-active-fill` | `rgba(255,255,255,0.16)` | line 23 | Yes — shared with browse tabs, search scope chips, **and season chips** (`.detail-season-chip--active`, line 2251) |
| `--bg-elevated`, `--bg-base`, `--bg-overlay` | dark tokens | lines 9–11 | Yes |
| `--radius-panel` | `16px` | line 91 | Yes — `.detail-stream` border-radius (2593), `.detail-button` (2546) |
| `--ease-out` | `cubic-bezier(0.2,0,0,1)` | line 92 | Yes |
| `--dur-focus-in` / `--dur-focus-out` | `0ms` / `0ms` | lines 94–95 | Yes — every focus transition on this surface is instant by design ("Instant D-pad focus snap — animated rings read as input lag at 3 m", comment at line 93) |

**Not found in this codebase:** `--rail-accent-width` exists (listed above) but the
user-named `--rail-accent-width` was actually already present — confirmed, not a
miss. No token named `--card-gap`-derivative is used inside `.detail-*` other
than the explicitly separate `--detail-related-gap`. No `--focus-ring-width`
token exists (the handoff-protocol doc's pre-approved-knobs table references
`--focus-ring-width` and `--motion-fast`/`--motion-base`, but the actual tokens
in this file are named `--focus-ring` and `--dur-focus-in`/`--dur-focus-out` — see
§3.3, this is a real drift between that doc and the code).

### 1.2 `.detail` — the outer grid and its `:has()` variants

Base grid (`style.css:1857-1879`):

```1857:1879:src/launcher/src/style.css
.detail {
  position: fixed;
  inset: 0;
  z-index: 35;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(280px, 24vw, 380px);
  /* Related has its own row spanning both columns, so it runs under the side panel
     instead of stopping at the main column and leaving ~480x500px of dead canvas
     there. minmax(0, 1fr) on the first row means the panel takes what is left after
     the related row and scrolls inside it, rather than the row growing off-screen. */
  grid-template-areas:
    "main side"
    "related related";
  grid-template-rows: minmax(0, 1fr) auto;
  column-gap: clamp(1.75rem, 3.5vw, 3rem);
  row-gap: var(--space-stack-lg);
  align-items: stretch;
  padding: var(--safe-y) var(--safe-x);
  overflow: hidden;
  background: var(--bg-overlay);
  animation: detail-enter 220ms var(--ease-out);
}
```

This is the single most important rule for the redesign: the side column's width
comes from `grid-template-columns`, and `.detail-side`'s available *height* comes
from `grid-template-rows: minmax(0, 1fr) auto` — row 1 (`main side`) is whatever is
left after row 2 (`related related`, sized to its own content via `auto`). **The
side panel's height is a residual, not a designed budget.** Any change to the
related row's content height directly and silently changes how much of the panel
you can see.

`:has()` variant — collapses to a single column when the side panel has no visible
children at all (`style.css:1881-1886`):

```1881:1886:src/launcher/src/style.css
.detail:not(:has(.detail-side > :not([hidden]))) {
  grid-template-columns: 1fr;
  grid-template-areas:
    "main"
    "related";
}
```

This fires when **both** `#detail-streams` and `#detail-episodes` are `[hidden]`
(e.g. episode-list fetch failed and streams never applied — see §2.7, the
`loadEpisodeList` catch block). It removes the `side` grid area entirely; `main`
then spans the full width. A redesign that changes what counts as "the side panel
has content" (e.g. always rendering an empty-state placeholder instead of hiding)
would silently defeat this collapse.

Two more `:has()` variants react to whether the **related** row is populated, and
both change `.detail-main`'s and `.detail-hero`'s internal alignment (not the grid
itself) — see §1.3 in the hero section below. They matter here because the
side panel's row-1 height is *inversely* affected by whichever of these two states
is active (related visible vs. not), per §4.

### 1.3 `.detail-hero`, `.detail-poster-wrap`, `.detail-description`

```1965:1978:src/launcher/src/style.css
.detail-hero {
  display: grid;
  /* 280px, not the 314px of a browse poster: committing to a title should not
     shrink its art, but 314 needs 471px of height and the view has ~97px of slack
     below the related row. At 280 the poster is exactly as tall as the copy beside
     it, so the hero does not grow at all, and it clears the ~255px floor platform
     research gives for poster art at 3m. 15vw so the cap is reachable at 1920. */
  grid-template-columns: clamp(180px, 15vw, 280px) minmax(0, 1fr);
  column-gap: clamp(1.75rem, 3.5vw, 3rem);
  flex: 0 1 auto;
  min-height: 0;
  align-content: center;
  align-items: center;
}

.detail:has(.detail-related:not(.hidden)) .detail-hero {
  align-content: start;
  align-items: start;
}
```

```1985:2002:src/launcher/src/style.css
.detail-poster-wrap {
  align-self: center;
  width: 100%;
  max-width: none;
  max-height: min(56vh, 440px);
  height: auto;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border: 2px solid var(--border-strong);
  border-radius: var(--radius-panel);
  background: var(--bg-elevated);
  box-shadow: 0 22px 56px rgba(0, 0, 0, 0.45);
}

.detail:has(.detail-related:not(.hidden)) .detail-poster-wrap {
  align-self: start;
  max-height: min(50vh, 400px);
}
```

`-webkit-line-clamp` sites on `.detail-description` — **two values exist,
selected by whether the related row is present**:

```2486:2501:src/launcher/src/style.css
.detail-description {
  width: 100%;
  /* The column is wide enough to run ~85 characters a line, past the 80 WCAG 1.4.8
     sets as the ceiling for readable prose. 54ch measures ~62 actual characters:
     the ch unit is the advance of "0", which is wider than average lowercase. */
  max-width: 54ch;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-body);
  font-weight: 600;
  line-height: 1.48;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
```

```2029:2034:src/launcher/src/style.css
/* Four lines here too, not three: a narrower measure fits fewer characters per
   line, so keeping three would have cut the synopsis down rather than just
   reflowing it. Four lines at ~60 characters is about what three at ~85 showed. */
.detail:has(.detail-related:not(.hidden)) .detail-description {
  -webkit-line-clamp: 4;
}
```

Both the base rule and the `:has()` override are `-webkit-line-clamp: 4` today —
i.e. the override is currently a no-op that matches the base value (both 4). The
comment at 2029 states the *history* (it used to be 3 vs. 4); if a redesign
changes one without checking the other, this is dead-but-documented-as-live CSS
to be aware of, not an actual behavioral difference right now.

`.detail-copy` (`style.css:2010-2027`, feeds hero column 2, not directly named in
the ask but load-bearing for `.detail-description`'s ancestor sizing):

```2010:2027:src/launcher/src/style.css
.detail-copy {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: calc(var(--space-stack) * 0.9);
  width: 100%;
  max-width: none;
  min-height: 0;
  align-self: center;
  overflow: visible;
  padding: var(--focus-gutter);
  margin: calc(-1 * var(--focus-gutter));
}

.detail:has(.detail-related:not(.hidden)) .detail-copy {
  align-self: start;
  padding-top: 0.15rem;
}
```

### 1.4 `.detail-side`, `.detail-side::after`, `.detail-panels`

```2123:2176:src/launcher/src/style.css
.detail-side {
  grid-area: side;
  position: relative;
  z-index: 2;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: var(--space-stack-lg);
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: 100%;
  min-height: 0;
  /* Inset scrollport so stream/episode focus rings (same as home cards) are
     not clipped on the left/right rail edge. */
  padding-inline: var(--focus-gutter);
  overflow-y: auto;
  overflow-x: clip;
  scrollbar-width: none;
}

/* The panel no longer runs the full height of the view, so its list is cut at the
   scrollport edge and a half-row of an episode reads as breakage rather than as
   "more below". Sticky rather than a mask on the panel: a mask would fade the focus
   ring of whichever row sits at the edge, and losing the ring is worse than the
   hard cut it fixes. */
.detail-side::after {
  content: "";
  position: sticky;
  bottom: calc(-1 * var(--focus-gutter));
  z-index: 1;
  flex: 0 0 auto;
  height: 2.5rem;
  margin-block-start: calc(-2.5rem - var(--space-stack-lg));
  margin-inline: calc(-1 * var(--focus-gutter));
  background: linear-gradient(to top, var(--bg-base), transparent);
  pointer-events: none;
}

.detail-side::-webkit-scrollbar {
  display: none;
}

.detail-side:not(:has(> :not([hidden]))) {
  display: none;
}
```

Notes load-bearing for a redesign:

- **No `padding-block`** on `.detail-side` — only `padding-inline: var(--focus-gutter)`
  (22px left/right, for focus-ring clearance). There is no top/bottom breathing
  room baked in; the first stream/episode row sits flush to the panel's top edge
  and the fade pseudo-element is the only bottom treatment.
- `.detail-side::after` is a **sticky bottom fade**, not a scroll indicator or
  scrollbar. It is always rendered (not conditionally shown only when scrollable),
  sized `2.5rem` (40px), and pulled up over the last `2.5rem + space-stack-lg`
  (40 + 24 = 64px) of content via `margin-block-start: calc(-2.5rem - var(--space-stack-lg))`.
  A redesign that changes `.detail-side`'s `gap` or padding must recompute this
  offset or the fade will float above/below where content actually ends.
- `.detail-side:not(:has(> :not([hidden])))` hides the **whole scroller** (not
  just a panel) when every direct child is `[hidden]` — this is what lets `.detail`
  collapse to one column (§1.2) when neither streams nor episodes render.
- `overflow-x: clip` + `padding-inline: var(--focus-gutter)`: horizontal focus
  rings on `.detail-stream`/`.detail-episode` are NOT clipped left/right, but
  anything wider than the padded content box would be.

```2170:2176:src/launcher/src/style.css
.detail-panels {
  overflow: visible;
}

.detail-panels[hidden] {
  display: none;
}
```

`.detail-panels` is applied to **both** `#detail-streams` and `#detail-episodes`
(`index.html:56,60`) as a shared modifier class alongside their own
`.detail-streams`/`.detail-episodes` class — but neither `.detail-streams` nor
`.detail-episodes` has its own CSS rule anywhere in the file (confirmed by the
full selector grep in §1.9 below — no bare `.detail-streams {` or
`.detail-episodes {` block exists). Only `.detail-streams-label`,
`.detail-streams--unverified`, `.detail-episodes-label` are styled. The wrapper
divs themselves are unstyled beyond `.detail-panels`'s `overflow: visible`.

### 1.5 Streams: `.detail-streams-label`, `.detail-stream-list`, `.detail-stream`, variants

```2178:2188:src/launcher/src/style.css
.detail-episodes-label,
.detail-streams-label {
  margin: 0 0 var(--space-rail-header);
  padding-left: 0.85rem;
  border-left: var(--rail-accent-width) solid var(--accent);
  color: var(--text-secondary);
  font-size: var(--text-control);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: lowercase;
}
```

```2572:2600:src/launcher/src/style.css
.detail-stream-list {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  overflow: visible;
  scrollbar-width: none;
}

.detail-stream-list::-webkit-scrollbar {
  display: none;
}

.detail-stream {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.4rem;
  width: 100%;
  min-height: 4rem;
  padding: 0.7rem 0.9rem;
  border: 2px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  text-align: left;
  transition:
    border-color var(--dur-focus-out) var(--ease-out),
    box-shadow var(--dur-focus-in) var(--ease-out);
}
```

```2602:2707:src/launcher/src/style.css
.detail-stream-primary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}

.detail-stream-res {
  flex: 0 0 auto;
  min-width: 3.2rem;
  padding: 0.2rem 0.5rem;
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: var(--text-caption);
  font-weight: 900;
  letter-spacing: 0.02em;
  text-align: center;
}

.detail-stream-res[data-res="4k"] {
  background: var(--accent);
  color: var(--bg-base);
}

.detail-stream-chip {
  flex: 0 0 auto;
  padding: 0.18rem 0.45rem;
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
  font-size: var(--text-micro);
  font-weight: 800;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.detail-stream-chip--hdr {
  background: rgba(255, 196, 84, 0.16);
  color: #ffcf7a;
}

.detail-stream-chip--cache {
  background: rgba(80, 220, 150, 0.16);
  color: #66e0a3;
  text-transform: lowercase;
}

.detail-stream-secondary {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--text-micro);
  font-weight: 700;
}

.detail-stream-langs {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.detail-stream-size {
  flex: 0 0 auto;
  color: var(--text-secondary);
}

.detail-stream-flag {
  flex: 0 0 auto;
  color: var(--text-muted);
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.detail-streams--unverified .detail-streams-label {
  color: var(--text-muted);
  border-left-color: var(--border-subtle);
}

.detail-stream--unverified {
  opacity: 0.82;
  border-style: dashed;
  background: transparent;
}

.detail-stream--unverified .detail-stream-res {
  background: rgba(255, 255, 255, 0.06);
  color: var(--text-secondary);
}

.detail-stream.focused,
.detail-stream:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--focus-ring) var(--focus-ring-color), 0 0 var(--focus-glow) var(--accent-glow);
}

.detail-stream:disabled {
  opacity: 0.55;
}
```

Only **one** `--kind` chip variant modifier exists in CSS: `--hdr` and `--cache`.
`streamQualityChips()` (detail.ts, §2.4) also emits `kind: "tier"` and
`kind: "codec"` chips, which render as bare `.detail-stream-chip` with no
kind-specific override — they get the default grey pill styling. This is not a
bug, just worth knowing: only HDR (amber-tinted) and cached (green-tinted) chips
have their own colour; tier (REMUX/BluRay/…) and codec (HEVC/AV1/…) chips are
visually identical to each other.

Notably absent: **no unique visual style** distinguishes `.detail-stream` (movie
bubble, column layout, `min-height: 4rem`) from `.detail-episode` (series row,
row layout, no min-height) beyond what's quoted — they are deliberately
different shapes (see §2.4/§2.8), not variants of one component.

### 1.6 Episodes: label, season list/chips, episode list/row, selected/disabled states

`.detail-episodes-label` is covered above (shared rule with `.detail-streams-label`,
lines 2178-2188).

```2190:2226:src/launcher/src/style.css
.detail-season-list {
  display: flex;
  flex-wrap: nowrap;
  gap: 0.5rem;
  overflow-x: auto;
  overflow-y: visible;
  margin: 0 0 0.85rem;
  padding: var(--focus-gutter);
  margin-inline: calc(-1 * var(--focus-gutter));
  scroll-padding-inline: 2rem;
  scroll-behavior: smooth;
  scrollbar-width: none;
  /* Fade the scroll edges so overflowing seasons dissolve cleanly instead of
     hard-clipping at the panel edge (SOTA horizontal rail treatment). */
  -webkit-mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 1.5rem,
    #000 calc(100% - 1.5rem),
    transparent 100%
  );
  mask-image: linear-gradient(
    to right,
    transparent 0,
    #000 1.5rem,
    #000 calc(100% - 1.5rem),
    transparent 100%
  );
}

.detail-season-list[hidden] {
  display: none;
}

.detail-season-list::-webkit-scrollbar {
  display: none;
}
```

```2228:2267:src/launcher/src/style.css
.detail-season-chip {
  flex: 0 0 auto;
  min-width: 3.4rem;
  padding: 0.5rem 0.95rem;
  color: var(--text-secondary);
  text-align: center;
  background: rgba(255, 255, 255, 0.04);
  border: 2px solid var(--border-subtle);
  border-radius: 999px;
  font-size: var(--text-caption);
  font-weight: 800;
  letter-spacing: 0.02em;
  text-transform: lowercase;
  scroll-margin-inline: 2rem;
  transition:
    border-color var(--dur-focus-out) var(--ease-out),
    box-shadow var(--dur-focus-in) var(--ease-out),
    background var(--dur-focus-in) var(--ease-out),
    color var(--dur-focus-in) var(--ease-out);
}

.detail-season-chip--active {
  border-color: var(--border-strong);
  background: var(--tab-active-fill);
  color: var(--text-primary);
}

/* Match detail action buttons: accent border + ring/glow, no drop-shadow. */
.detail-season-chip.focused,
.detail-season-chip:focus-visible {
  outline: none;
  border-color: var(--accent);
  color: var(--text-primary);
  box-shadow: 0 0 0 var(--focus-ring) var(--focus-ring-color), 0 0 var(--focus-glow) var(--accent-glow);
}

.detail-season-chip--active.focused,
.detail-season-chip--active:focus-visible {
  background: var(--accent-soft);
}
```

```2269:2274:src/launcher/src/style.css
.detail-episode-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  overflow: visible;
}
```

**Dead CSS found — `.detail-season-header`.** These rules exist and are fully
styled, but `detail.ts` never creates any element with this class (confirmed:
`grep -n "detail-season-header" src/launcher/src/*.ts` returns zero matches; the
only hits are the CSS file itself). This looks like a leftover from an earlier
"flat list with inline season dividers" design that was superseded by the
chip-row + per-season-render approach (`renderSeasonChips` / `setActiveSeason`,
§2.6). A redesign should either delete this dead rule or repurpose it —
**do not assume it is currently rendering anything.**

```2276:2301:src/launcher/src/style.css
.detail-season-header {
  display: block;
  width: 100%;
  margin: 1.2rem 0 0.4rem;
  padding: 0.55rem 0.75rem;
  color: var(--text-secondary);
  font-size: var(--text-caption);
  font-weight: 900;
  letter-spacing: 0.02em;
  text-transform: none;
  text-align: left;
  background: rgba(255, 255, 255, 0.04);
  border: 2px solid var(--border-subtle);
  border-radius: 10px;
}

.detail-season-header:first-child {
  margin-top: 0;
}

.detail-season-header.focused,
.detail-season-header:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--focus-ring) var(--focus-ring-color), 0 0 var(--focus-glow) var(--accent-glow);
}
```

```2303:2370:src/launcher/src/style.css
.detail-episode {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  padding: 0.85rem 1rem;
  color: var(--text-primary);
  text-align: left;
  background: rgba(255, 255, 255, 0.04);
  border: 2px solid var(--border-subtle);
  border-radius: 12px;
  font-size: 1.15rem;
  font-weight: 700;
  transition:
    border-color var(--dur-focus-out) var(--ease-out),
    box-shadow var(--dur-focus-in) var(--ease-out);
}

.detail-episode-label {
  flex: 1 1 auto;
  min-width: 0;
}

.detail-episode-progress {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: 1rem;
  font-weight: 900;
}

/* This marks the episode `resume` will play, which is a lasting state rather than
   a cursor position, so it must not borrow the amber that means focus: while
   focus sat elsewhere in the list the panel showed two amber-outlined rows. */
.detail-episode--selected {
  border-color: var(--border-selected);
  background: var(--tab-active-fill);
}

.detail-episode--disabled,
.detail-episode--no-streams {
  opacity: 0.55;
}

.detail-episode-stream-badge {
  flex: 0 0 auto;
  color: var(--text-secondary);
  font-size: var(--text-micro);
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: lowercase;
}

.detail-episode--has-streams .detail-episode-stream-badge {
  display: none;
}

.detail-episode.focused,
.detail-episode:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--focus-ring) var(--focus-ring-color), 0 0 var(--focus-glow) var(--accent-glow);
}

.detail-episode--selected.focused,
.detail-episode--selected:focus-visible {
  background: var(--tab-active-fill);
}
```

Note `.detail-episode` and `.detail-season-chip` both use `--tab-active-fill` for
their "lasting state" background (selected episode / active season), and both
reuse the exact same focus box-shadow formula as `.detail-stream`, `.detail-button`,
and `.card`. Any change to that shared focus formula (`0 0 0 var(--focus-ring)
var(--focus-ring-color), 0 0 var(--focus-glow) var(--accent-glow)`) ripples to
every focusable element in the app, not just Detail — it is not locally
overridden anywhere in this surface.

`.detail-episode--disabled` is defined (opacity 0.55, shared rule with
`--no-streams`) but **`detail.ts` never adds the `detail-episode--disabled` class
to anything** — only `--no-streams`, `--has-streams`, and `--selected` are ever
toggled (confirmed via grep of `classList` calls in detail.ts, §2.8). Another
dead/unused modifier.

### 1.7 Related row: `.detail-related`, label, context, track, `.card--related`

```2036:2121:src/launcher/src/style.css
.detail-related {
  grid-area: related;
  flex: 0 0 auto;
  position: relative;
  z-index: 1;
  min-height: 0;
  /* The track is flex-nowrap, so enough cards would spill out of this grid column
     and paint over the episodes panel. Clipping at the column edge keeps a data
     change from becoming an overlap, and the clip margin leaves room for the
     focus ring and its glow to render outside the box. */
  overflow: clip;
  /* --focus-gutter would be the natural value but it is a calc(), and Chromium
     computes overflow-clip-margin to 0 for any calc, substituted or authored,
     which would clip the ring flush. --focus-glow is a plain length. */
  overflow-clip-margin: var(--focus-glow);
}

.detail-related.hidden {
  display: none;
}

.detail-related-head {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  margin: 0 0 var(--space-rail-header);
}

.detail-related-label {
  display: block;
  margin: 0;
  padding-left: 0.85rem;
  border-left: var(--rail-accent-width) solid var(--accent);
  color: var(--text-secondary);
  font-size: var(--text-control);
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: lowercase;
}

.detail-related-context {
  margin: 0;
  padding-left: calc(0.85rem + var(--rail-accent-width));
  color: var(--text-muted);
  font-size: var(--text-caption);
  font-weight: 600;
}

.detail-related-track {
  display: flex;
  flex-wrap: nowrap;
  /* Its own token, not a fraction of --card-gap: this is a secondary rail inside a
     fixed-width column, so it must not inherit the main rails' 40px gutter. */
  gap: var(--detail-related-gap);
  overflow: visible;
  padding: var(--focus-gutter);
  margin: calc(-1 * var(--focus-gutter));
  width: calc(100% + 2 * var(--focus-gutter));
  max-width: none;
}

.detail-related-track .card--poster {
  flex: 0 0 auto;
  aspect-ratio: 2 / 3;
  /* 228px, seven across: the row now spans the full 1728px rather than the 1300px
     main column, and seven of these plus their gaps come to 1706px. Wider cards
     were possible (six at 268px) but every pixel of extra card height is taken out
     of the side panel above, which costs a visible episode row. Seven at 228 keeps
     a row of episodes that six at 268 would have cost, at a card width within a
     few percent of the previous 240. */
  width: clamp(136px, 13vw, 228px);
  height: auto;
  max-width: none;
}
```

```2111:2121:src/launcher/src/style.css
/* Straight tokens, not vw clamps: the clamps capped out at 22.08px and 16.8px at
   1080p, and the panel is always 1920 wide on the Pi, so the viewport term only
   hid which size actually shipped. */
.card--related .card-title {
  font-size: var(--text-caption);
  line-height: 1.2;
}

.card--related .card-subtitle {
  font-size: var(--text-micro);
}
```

**This is the single most important cross-reference for the redesign:** the
comment at line 2100-2105 states explicitly that the related-card width (228px)
was chosen *because* every pixel of card height is subtracted from the side
panel's available height above it — i.e. the related row and the side panel are
in a documented, deliberate trade-off, not two independent surfaces. See §4 for
the arithmetic and §3.2 for the pre-approved-knob doc that names this exact
trade-off as the one thing the home agent is allowed to touch.

### 1.8 `.detail-button` and `.detail-button--primary`

```2539:2570:src/launcher/src/style.css
.detail-button {
  min-width: 9rem;
  min-height: 3.5rem;
  padding: 0.85rem 1.35rem;
  color: var(--text-primary);
  background: var(--bg-elevated);
  border: 2px solid var(--border-subtle);
  border-radius: var(--radius-panel);
  font-size: var(--text-control);
  font-weight: 700;
  text-transform: lowercase;
  transition:
    box-shadow var(--dur-focus-in) var(--ease-out),
    border-color var(--dur-focus-in) var(--ease-out);
}

.detail-button--primary {
  color: var(--on-primary);
  background: var(--primary-fill);
  border-color: var(--primary-fill);
}

.detail-button.focused,
.detail-button:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 var(--focus-ring) var(--focus-ring-color), 0 0 var(--focus-glow) var(--accent-glow);
}

.detail-button:disabled {
  opacity: 0.62;
}
```

Not requested but directly load-bearing for §2.2's `navigate()` "Left from an
episode" special case: `.detail-actions` (`style.css:2503-2509`, flex-wrap row of
up to 4 buttons) and the busy/spinner styles (`2511-2537`) live in `.detail-main`,
not `.detail-side` — they are the horizontal escape target, not part of the panel
itself.

### 1.9 Full selector audit (completeness check)

A full-file grep for `\.detail[a-zA-Z-]*` found every `.detail-*` selector in the
file (89 matches). Every one is accounted for above except pure structural/state
selectors already covered inline (`.detail.hidden`, `.detail-related.hidden`,
`[hidden]` variants) and two unrelated incidental matches: `.detail-copy #detail-title`
(hero H1 sizing, not part of the side panel) and the `prefers-reduced-motion`
block at lines 1244-1257 which turns off `.detail-button.focused` transform and
`.detail` enter animation — no side-panel-specific reduced-motion rule exists.

**Confirmed not present in the CSS** (asked for by name, not found under any
name, exact or approximate): a class literally named `.detail-season-row`. The
real per-season-divider class is `.detail-season-header` (§1.6), and it is dead
CSS (see above) — there is no rendered "season row" grouping today; episodes are
flat per-season lists with only a horizontally-scrolling chip row above them.

### 1.10 Media query — narrower viewports

```2939:2962:src/launcher/src/style.css
@media (max-width: 900px) {
  .masthead--compact h1,
  h1 {
    font-size: 3.1rem;
  }

  .detail {
    grid-template-columns: minmax(0, 1fr) clamp(240px, 30vw, 340px);
    column-gap: 1.5rem;
  }

  .detail-hero {
    grid-template-columns: 10rem minmax(0, 1fr);
    column-gap: 1.5rem;
  }

  .detail:has(.detail-related:not(.hidden)) .detail-poster-wrap {
    max-height: min(44vh, 320px);
  }

  .detail-related-track .card--poster {
    width: clamp(120px, 14vw, 148px);
  }
}
</fixture — narrower breakpoint continues>
```

This is dead in practice on the Pi (fixed 1920×1080 kiosk, per `docs/DEPLOY.md`
and the `--safe-x`/`--safe-y` "5% of 1920×1080" comment at line 40) but is live
if the launcher is ever opened in a narrower dev browser window. It changes the
side column's width formula independently of the base rule — a redesign must
update both or they diverge.

### 1.11 `@supports` blocks

One `@supports` block exists in the file (`style.css:1075-1106`, scroll-driven
edge fades for `.rails`/`.browse-bar`). **It does not touch any `.detail-*`
selector** — the side panel's bottom fade (`.detail-side::after`, §1.4) is a
plain sticky pseudo-element with a static gradient, not scroll-timeline driven,
unlike its home-rails equivalent. This is a real asymmetry: home's edge fades
fade in/out based on scroll position; the detail side panel's fade is always
fully opaque regardless of scroll position (always renders, whether or not
there is more content below).

---

## Section 2 — TypeScript behavior (`src/launcher/src/detail.ts`)

### 2.1 State arrays and population order

```74:88:src/launcher/src/detail.ts
  /** Season chips + episode rows in the side panel — D-pad order. */
  private listFocusables: HTMLElement[] = [];
  private seasonChipButtons: HTMLButtonElement[] = [];
  private activeSeason: number | null = null;
  private selectedEpisodeId: string | null = null;
  private nextPromptPollTimer: number | undefined;
  private browseTab: BrowseTab = "movies";
  private saved = false;
  private relatedButtons: HTMLButtonElement[] = [];
```

- `streamButtons: HTMLButtonElement[]` (line 67) — pushed to inside
  `createStreamButton()` (line 1552, `this.streamButtons.push(button)`), one per
  visible stream, in the order `this.streams` was rendered (`renderStreams()`,
  §2.4). **Never rebuilt from the DOM** — it is populated only at push time, so
  if a stream bubble is ever removed from the DOM without going through
  `renderStreams()`'s `replaceChildren()` reset, this array would go stale. Movies
  only; always empty for series (`renderStreams()` guards `card?.type === "series"`
  and returns early, clearing it).
- `listFocusables: HTMLElement[]` (line 74) — rebuilt via `rebuildListFocusables()`
  (line 881-886): `[...this.seasonChipButtons, ...this.episodeButtons()]`. Season
  chips always precede episodes in D-pad order. `episodeButtons()` (line 851-853)
  re-queries the live DOM (`this.episodeList.querySelectorAll(...)`) rather than
  reading a stored array, so it is always in DOM order (i.e. visual top-to-bottom
  order of the active season's episodes).
- `relatedButtons: HTMLButtonElement[]` (line 81) — rebuilt in `renderRelated()`
  (line 776-805) each time related cards load, in the order `siblings` iterates
  (i.e. server/fallback order, sliced to `RELATED_DISPLAY_LIMIT`).
- `seasonChipButtons: HTMLButtonElement[]` (line 75) — rebuilt in
  `renderSeasonChips()` (line 1297-1316) in season order as returned by the
  episodes API.

### 2.2 The focus model

```643:650:src/launcher/src/detail.ts
  private allFocusableElements(): HTMLElement[] {
    return [
      ...this.actionButtons(),
      ...this.listFocusables,
      ...this.streamButtons,
      ...this.relatedButtons,
    ];
  }
```

Concatenation order is: **action buttons → season chips + episodes → stream
bubbles → related cards.** This order is consumed by `applyFocus()` (§2.3) as a
fallback when there's nothing better to focus, and it is *not* the same as D-pad
traversal order (traversal is spatial via `navigate()`, §2.2.2, not sequential).

```652:654:src/launcher/src/detail.ts
  private enabledFocusables(): HTMLElement[] {
    return this.allFocusableElements().filter((el) => this.isFocusableEnabled(el));
  }
```

```622:630:src/launcher/src/detail.ts
  private isFocusableEnabled(element: HTMLElement): boolean {
    if (element.hidden) {
      return false;
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      return false;
    }
    return true;
  }
```

`isFocusableEnabled` checks the DOM `.hidden` property (not `[hidden]` attribute
directly, though they're the same thing via IDL reflection) and `.disabled` for
buttons. It does **not** check `getBoundingClientRect()` for zero-size elements —
an element with `display: none` via a CSS class (not the `hidden` attribute)
would still pass this check and then fail silently in `navigate()`'s geometry
scoring (a zero-size rect at 0,0 would skew distance scoring). No such class is
used inside `.detail-side` today (`[hidden]` is the only hiding mechanism used by
`detail.ts` — confirmed by grep), so this is a latent risk for a redesign that
introduces a CSS-only hidden state instead of the `hidden` attribute.

```656:661:src/launcher/src/detail.ts
  private focusEl(el: HTMLElement): void {
    this.focusedEl = el;
    el.focus({ preventScroll: true });
    requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
    this.onGridFocused(el);
  }
```

Every focus change goes through `focusEl()`. It always calls `.focus({
preventScroll: true })` synchronously (so the browser doesn't jump-scroll), then
schedules `scrollIntoView({ block: "nearest", inline: "nearest" })` on the *next*
animation frame. `"nearest"` means: if the element is already fully visible, no
scroll happens at all; if partially clipped, it scrolls the minimum distance to
bring it fully into view. This is the **only** scroll-into-view call in the
active navigation path (see §2.7 for the two additional ones used only during
episode-list re-render).

```636:641:src/launcher/src/detail.ts
  private onGridFocused(element: HTMLElement): void {
    for (const control of this.allFocusableElements()) {
      control.classList.toggle("focused", control === element);
    }
    this.onEpisodeFocusChanged(element);
  }
```

`onGridFocused` walks **every** focusable element (all four arrays) on every
single focus change to toggle `.focused` — O(n) per keypress across actions +
list + streams + related, not scoped to the array the newly-focused element
belongs to. `onEpisodeFocusChanged` (line 1383-1385) is currently a documented
no-op ("No dwell prefetch — series play resolves on activate via /play only").

#### 2.2.1 `applyFocus()` — initial/fallback focus selection

```747:756:src/launcher/src/detail.ts
  private applyFocus(): void {
    const focusables = this.enabledFocusables();
    if (focusables.length === 0) {
      this.focusedEl = null;
      return;
    }
    const keep = this.focusedEl && focusables.includes(this.focusedEl) ? this.focusedEl : null;
    const play = !this.playButton.hidden && !this.playButton.disabled ? this.playButton : null;
    this.focusEl(keep ?? play ?? focusables[0]);
  }
```

Priority: **(1)** keep current focus if it's still in the enabled set, **(2)**
Play button if enabled, **(3)** `focusables[0]` — which, per the concatenation
order in §2.2, is the **first action button** (Play, unless hidden/disabled, in
which case whichever of Save/Not-interested/Back comes first). `applyFocus()` is
called after every async render (streams loaded, episodes loaded, related
loaded, season switched with no better target) — it is the single fallback used
whenever a more specific focus target isn't known.

#### 2.2.2 `navigate()` — the spatial scoring algorithm

```663:745:src/launcher/src/detail.ts
  private navigate(direction: "up" | "down" | "left" | "right"): void {
    const current = this.focusedEl;
    if (!current) {
      return;
    }
    const curRect = current.getBoundingClientRect();
    const ccx = curRect.left + curRect.width / 2;
    const ccy = curRect.top + curRect.height / 2;
    const eps = 2;
    const horizontal = direction === "left" || direction === "right";
    // Episodes are a vertical list inside the right rail. Horizontal moves from
    // an episode should cross OUT to the left column (action buttons / related),
    // not land on a season chip that happens to sit up-and-left — so exclude the
    // in-rail list items (season chips + episodes) as horizontal targets here.
    const fromEpisode = current.classList.contains("detail-episode");
    // Left from an episode escapes the right rail straight to the action column
    // (play/save/back) rather than the spatially-closest related-title poster —
    // "press left on an episode → focus the buttons on the left" (issue 3).
    if (direction === "left" && fromEpisode) {
      const action = this.actionButtons().find((button) => this.isFocusableEnabled(button));
      if (action) {
        this.focusEl(action);
        return;
      }
    }
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const candidate of this.enabledFocusables()) {
      if (candidate === current) {
        continue;
      }
      if (
        horizontal
        && fromEpisode
        && (candidate.classList.contains("detail-episode")
          || candidate.classList.contains("detail-season-chip"))
      ) {
        continue;
      }
      const rect = candidate.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let keep: boolean;
      switch (direction) {
        case "right":
          keep = cx > ccx + eps;
          break;
        case "left":
          keep = cx < ccx - eps;
          break;
        case "down":
          keep = cy > ccy + eps;
          break;
        case "up":
        default:
          keep = cy < ccy - eps;
          break;
      }
      if (!keep) {
        continue;
      }
      let primary: number;
      let secondary: number;
      let beamAligned: boolean;
      if (horizontal) {
        primary = Math.abs(cx - ccx);
        secondary = Math.abs(cy - ccy);
        beamAligned = rect.bottom > curRect.top && rect.top < curRect.bottom;
      } else {
        primary = Math.abs(cy - ccy);
        secondary = Math.abs(cx - ccx);
        beamAligned = rect.right > curRect.left && rect.left < curRect.right;
      }
      const score = primary + secondary * 2 + (beamAligned ? 0 : 1_000_000);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) {
      this.focusEl(best);
    }
  }
```

Precisely, in order:

1. **Geometry basis:** every candidate's box-center (`getBoundingClientRect()`,
   live layout — not cached), compared to the current element's box-center.
   `eps = 2` (px) is the dead-zone that keeps a candidate at (nearly) the same
   coordinate on the cross-axis from being falsely "kept" — e.g. for `right`,
   a candidate must have its center at least 2px to the right (`cx > ccx + eps`),
   not merely `>=`.
2. **Special case 1 — Left from an episode** (lines 681-687): short-circuits the
   entire scoring loop. Pressing Left while `current` has class `detail-episode`
   jumps straight to the first enabled action button (Play/Save/Not-interested/
   Back, in that DOM order), regardless of actual on-screen geometry. This exists
   specifically so Left never lands on a spatially-closer related-title card.
3. **Special case 2 — horizontal moves exclude in-rail list items** (lines
   694-701): when moving `left`/`right` **from an episode**, candidates that are
   themselves `.detail-episode` or `.detail-season-chip` are excluded from
   scoring entirely (not just de-prioritized) — this only matters for `right`,
   since `left` is already handled by special case 1. It stops Right from an
   episode from landing on another episode/chip that happens to be laterally
   adjacent; the effect is to send Right out toward stream buttons or related
   cards instead (whichever scores best of the remaining candidates).
4. **Direction filter** (`keep`): a candidate is only eligible at all if its
   center is strictly past the epsilon threshold in the requested direction.
   Candidates that fail this are dropped, not merely penalized.
5. **Scoring for survivors:**
   - `primary` = absolute distance along the movement axis (vertical distance
     for up/down, horizontal distance for left/right).
   - `secondary` = absolute distance along the cross axis, weighted **×2**
     relative to `primary`.
   - `beamAligned` = true if the candidate's bounding box overlaps the current
     element's bounding box along the cross axis at all (for horizontal moves:
     candidate's vertical span overlaps current's vertical span; for vertical
     moves: horizontal span overlaps). This is a boolean "is there a clear lane
     between these two", not a distance.
   - `score = primary + secondary * 2 + (beamAligned ? 0 : 1_000_000)`. The
     `1_000_000` term means **any** beam-aligned candidate always outscores
     **every** non-aligned candidate, no matter how close the non-aligned one is
     — beam alignment is a hard priority tier, not a soft nudge. Only within the
     same alignment tier does distance (primary + 2×secondary) decide.
   - The lowest score wins; ties are resolved by insertion order in
     `enabledFocusables()` (first-found wins, `<` not `<=`).
6. **Known unpatched defect** (documented in `docs/tasks/ux-round/10-polish-plan.md`
   item D7, not fixed as of this read): when **no** candidate in a direction is
   beam-aligned, the `1_000_000` penalty still leaves every non-aligned candidate
   *eligible* (merely worse-scored, never dropped) — so at the end of a row/column
   with nothing aligned, the least-bad non-aligned candidate still wins and focus
   "teleports" to something spatially surprising (e.g. Right on the last related
   card jumps up to the Play/Resume button; Right on an episode can leave the
   side panel entirely). A redesign that changes bubble/row geometry will change
   exactly when this defect triggers, since it depends on real layout positions.

`moveRow(delta)` / `moveCol(delta)` (lines 350-366) are the only entry points
into `navigate()`: `moveRow` maps `delta > 0` → `"down"`, else `"up"`; `moveCol`
maps `delta > 0` → `"right"`, else `"left"`. `moveFocus(delta)` (line 386-389) is
a `@deprecated` alias for `moveRow` only, kept for backward compatibility with an
older caller signature. `changeSeason(delta)` (lines 368-375) is a **separate**
path, not part of `navigate()` — see §2.6.

### 2.3 `focusPlayButton()` / `applyFocus()` interaction with initial render

`show()` (line 243-305) calls `applyFocus()` synchronously on every open (line
290), before any async stream/episode/related data has loaded — at that point
`listFocusables`, `streamButtons`, and `relatedButtons` are all empty (reset at
lines 259-262, 264-269 in the same function), so the only focusable elements are
action buttons, and `applyFocus()`'s priority rule (§2.2.1) lands on Play. Once
`loadStreamList`/`loadEpisodeList`/`loadRelated` resolve, each calls
`applyFocus()` again (`renderStreams()` line 1499, `renderEpisodes()` line 1292,
`loadRelated()` line 767) — **but only if focus wasn't already moved off Play by
the user in the interim**, per the `keep` check in `applyFocus()`. This means a
fast D-pad press between `show()` and the async loads resolving can move focus
onto (e.g.) the Back button, and the subsequent re-renders will *not* steal it
back, because `keep` (line 753) short-circuits before falling through to `play`.

### 2.4 `renderStreams()` / `createStreamButton()` — markup and fields read

```1462:1500:src/launcher/src/detail.ts
  private renderStreams(): void {
    // Safety: series detail never surfaces stream bubbles.
    if (this.card?.type === "series") {
      this.streams = [];
      this.streamList.replaceChildren();
      this.streamButtons = [];
      this.streamsWrap.hidden = true;
      this.streamsWrap.classList.remove("detail-streams--unverified");
      return;
    }
    this.streamList.replaceChildren();
    this.streamButtons = [];
    if (this.streams.length === 0) {
      this.streamsWrap.hidden = false;
      this.streamsWrap.classList.remove("detail-streams--unverified");
      const streamsLabel = this.streamsWrap.querySelector(".detail-streams-label");
      if (streamsLabel) {
        streamsLabel.textContent = "streams · none found";
      }
      this.applyFocus();
      return;
    }

    this.streamsWrap.hidden = false;
    const floorOnly = this.streams.every(
      (stream) =>
        stream.unverified === true
        || UNVERIFIED_STREAM_STEPS.has(stream.ladder_step ?? ""),
    );
    this.streamsWrap.classList.toggle("detail-streams--unverified", floorOnly);
    const streamsLabel = this.streamsWrap.querySelector(".detail-streams-label");
    if (streamsLabel) {
      streamsLabel.textContent = floorOnly ? "streams · unverified" : "streams";
    }
    for (const stream of this.streams) {
      this.streamList.append(this.createStreamButton(stream));
    }
    this.applyFocus();
  }
```

`streamsLabel` text has **three** states: `"streams · finding…"` (set by
`renderStreamsFinding()`, line 1439-1448, during fetch), `"streams · none
found"` (empty result), `"streams · unavailable — Play retries"` (fetch threw,
`renderStreamsUnavailable()`, line 1450-1460), and finally either `"streams"` or
`"streams · unverified"` once data is in.

`createStreamButton()` markup structure (line 1505-1554):

```
button.detail-stream[.detail-stream--unverified]
├── span.detail-stream-primary
│   ├── span.detail-stream-res[data-res="<lowercased resolution label>"]
│   └── span.detail-stream-chip.detail-stream-chip--<kind>  (0..N, one per streamQualityChips() entry)
└── span.detail-stream-secondary
    ├── span.detail-stream-langs  (only if streamLangLabel() returns non-null)
    ├── span.detail-stream-size   (only if streamSizeLabel() returns non-null)
    └── span.detail-stream-flag   (only if unverified — text always "unverified")
```

Fields of `CatalogStream` (`src/launcher/src/catalog.ts:144-163`) actually read,
and by which helper:

| Field | Read by | Used for |
|---|---|---|
| `resolution`, `quality`, `display_label` | `streamResolutionLabel()` (detail.ts:1725-1735) | the `4K/1440p/1080p/720p/SD/auto` res badge — regex-matched against a lowercased concat of all three fields |
| `release_tier` | `streamTierLabel()` (1737-1749) | tier chip text (`REMUX/BluRay/WEB-DL/WEBRip/HDTV/DVD/CAM`, or raw uppercased+truncated to 8 chars as fallback) |
| `encode` | `streamCodecLabel()` (1751-1758) | codec chip (`HEVC/AV1/H.264`, or raw uppercased+truncated to 6 chars) |
| `hdr_tags` | `streamHdrLabel()` (1760-1771) | HDR chip (`DV/HDR10+/HDR10/HLG/HDR`, checked in that priority order) |
| `cache_status` | `streamQualityChips()` (1773-1783), directly | `"cached"` chip, only when exactly `"cached"` (not `"uncached"`/`"unknown"`) |
| `languages` | `streamLangLabel()` (1791-1801) via `streamLanguageList()` (1785-1789) | up to 3 language codes joined by `" · "` plus `" +N"` overflow; `null` if empty (renders no `.detail-stream-langs` span at all — **not** a literal "audio n/a" string; that literal is referenced only in `docs/tasks/ux-round/10-polish-plan.md` item D6 as a *pre-fix* description that no longer matches this code) |
| `size_gb` | `streamSizeLabel()` (1803-1812) | `"X MB"` if `<1`, else `"X.X GB"`; `null` if absent/non-finite/≤0 |
| `ladder_step` | `UNVERIFIED_STREAM_STEPS.has(...)` (line 1509, 1489) and `play(undefined, stream.ladder_step)` on click | unverified-styling decision (§2.9) and passed through to `play()` as `preferLadderStep` |
| `unverified` | directly, `stream.unverified === true` | unverified-styling decision, OR'd with the ladder-step check |
| `url` | `button.addEventListener("click", () => void this.play(stream.url, ...))` (line 1551) | play target; also the key for the 30-minute `hiddenStreamUntil` hard-fail hide (line 520) |
| `debrid_service` | **not read anywhere in detail.ts** | defined on the type (catalog.ts:162) but unused by the UI |
| `title`, `name`, `source` | **not read anywhere in detail.ts** | defined on the type but unused by the UI (name/title may feed `display_label` upstream in catalog-service, not consumed client-side) |

Helper vocabulary, exhaustively, exactly as emitted:

- `streamResolutionLabel()`: `"4K"`, `"1440p"`, `"1080p"`, `"720p"`, `"SD"`,
  `"auto"` (fallback). Regexes require a non-digit or string-start before the
  digit group specifically to avoid `"2160"` matching inside a larger number.
- `streamTierLabel()`: `"REMUX"`, `"BluRay"`, `"WEB-DL"`, `"WEBRip"`, `"HDTV"`,
  `"DVD"`, `"CAM"`, or `raw.toUpperCase().slice(0, 8)` as a last resort; `null`
  if `release_tier` is empty/whitespace.
- `streamCodecLabel()`: `"HEVC"`, `"AV1"`, `"H.264"`, or
  `raw.toUpperCase().slice(0, 6)`; `null` if `encode` empty.
- `streamHdrLabel()`: `"DV"`, `"HDR10+"`, `"HDR10"`, `"HLG"`, `"HDR"` (checked in
  that exact priority order — `"dv"`/`"dolby"` wins over `"hdr10+"` even if both
  substrings are present); `null` if no tags or no match.
- `streamQualityChips()`: assembles `{kind, text}` array in order **tier → codec
  → hdr → cache** (only cache is a boolean flag, not a labeled helper).
- `streamLangLabel()`: up to 3 codes via the 18-entry `STREAM_LANG_CODES` map
  (line 1704-1723: english/hindi/japanese/korean/french/german/spanish/italian/
  portuguese/russian/arabic/tamil/telugu/malayalam/kannada/bengali/punjabi/
  marathi), else first-2-letters-uppercased for unmapped languages, joined by
  `" · "`, with `" +N"` suffix if more than 3 languages exist.
- `streamSizeLabel()`: `"{Math.round(gb*1000)} MB"` under 1 GB, else
  `"{gb.toFixed(1)} GB"`.
- `streamAriaLabel()` (1814-1827): concatenates resolution + all quality chip
  texts + `"audio {lang1, lang2, lang3}"` (comma-joined, first 3, full language
  names not codes) + size + `"unverified"` if applicable — joined by `", "`. This
  is the **only** place a full (non-abbreviated) language name string is ever
  produced for this surface, and it's aria-only (not visible text).

### 2.5 Episode rendering path

`renderEpisodes()` (lines 1254-1295) is the entry point, called only from
`loadEpisodeList()` (§2.7). It:

1. Clears `episodeList` and `seasonList` and resets `seasonChipButtons`/
   `listFocusables`.
2. Computes `flatCount` across all season blocks; if zero, hides both
   `episodesWrap` and `seasonList`, sets `activeSeason = null`, calls
   `applyFocus()`, and returns — **no error state markup**, just an empty panel
   (which can trigger the `.detail` single-column collapse if streams are also
   hidden, §1.2).
3. Otherwise unhides `episodesWrap`, resolves `activeSeason` via
   `resolveInitialSeason()` (§2.6) unless a specific episode is being restored
   (in which case `seasonForEpisodeId()` wins), calls `renderSeasonChips()`
   (§2.6), then `renderActiveSeasonEpisodes(block, focusEpisodeId)`.
4. `renderActiveSeasonEpisodes()` (1318-1326) is a **full replace**:
   `episodeList.replaceChildren()` then appends one `createEpisodeButton()` per
   episode in the active season only — episodes from other seasons are never in
   the DOM simultaneously. There is no upper bound on how many episodes can be
   in one season block (no slicing/pagination) — a season with, say, 24
   episodes renders all 24 rows into the scrollport at once.
5. Scroll: `scrollTarget?.scrollIntoView({ block: "nearest", behavior: "instant"
   })` (line 1287) runs synchronously for the specific episode being restored
   (e.g. resume episode), separate from the `focusEl()`-driven
   `requestAnimationFrame` scroll (§2.2) — see §2.7 for full scroll-call
   inventory.
6. `rebuildListFocusables()` runs after chips+episodes are both in the DOM, so
   `listFocusables` always reflects the currently active season only.

How many episodes/seasons **can** exist: unbounded by the client. The only
season-count-dependent UI change is `renderSeasonChips()` hiding the entire chip
row when `episodes.seasons.length <= 1` (line 1298-1301) — single-season shows
have no chip row and no `changeSeason()` effect (`hasMultipleSeasons()`, line
888-890, gates `tryChangeSeason()`).

### 2.6 Season switching

`resolveInitialSeason()` (905-927): resume episode's season, else default
episode's season, else `seasons[0].season`, else `1`.

`tryChangeSeason(delta)` (936-975) — the actual season-cycling logic, invoked
only from `changeSeason()` (public API, called by shoulder buttons L/R or F6/F7,
main.ts:261,514-516):

1. No-op if `!hasMultipleSeasons()` or `activeSeason === null`.
2. No-op unless currently-focused element is a `.detail-season-chip` or
   `.detail-episode` (season cycling does nothing if focus is elsewhere, e.g. on
   an action button or a related card).
3. Finds current season's index in the seasons array, wraps modulo array length
   in the `delta` direction (`(currentIndex + delta + seasons.length) %
   seasons.length` — this **wraps around**, e.g. L from season 1 goes to the
   last season).
4. If focus was on an episode, remembers that episode's index within its season
   (`focusEpisodeIndex`) so the new season focuses the **same position**, not
   episode 1 — e.g. focused on S1E5 (index 4), L/R to S2 focuses S2's 5th
   episode (clamped to season length in `setActiveSeason`, §below). If focus was
   on a season chip, `focusEpisodeIndex` is explicitly reset to 0 (line
   969-971) regardless of which chip.
5. Calls `setActiveSeason(nextSeason, { focusEpisodeIndex, focusChip: <was a
   chip focused> })`.

`setActiveSeason()` (977-1014): re-renders the season's episodes, syncs chip
active-state, rebuilds `listFocusables`, then focuses — in priority order:
explicit `focusChip` request → `focusEpisodeId` if given → `focusEpisodeIndex`
(clamped to `[0, episodes.length-1]`) → first episode → `applyFocus()` fallback
if the season has zero episodes.

D-pad Left/Right (`moveCol`) does **not** cycle seasons — this is explicit by
design (comment at detail.ts:361-364): "D-pad only navigates the page spatially.
Seasons are cycled exclusively by the shoulder buttons (`changeSeason`) or by
clicking a season chip." A season-chip click (line 1309-1311) always calls
`setActiveSeason(block.season, { focusEpisodeIndex: 0 })` — always resets to the
first episode of the clicked season, unlike the shoulder-button path which
preserves position.

### 2.7 Scroll manipulation — full inventory

Every call to `scrollIntoView`, `scrollTop`, or `scrollTo` anywhere in
`detail.ts`:

| Line | Call | Options | Context |
|---|---|---|---|
| 659 | `el.scrollIntoView(...)` | `{ block: "nearest", inline: "nearest" }` | Inside `focusEl()`, deferred to next `requestAnimationFrame`. Fires on **every** focus change on this surface (actions, list, streams, related). |
| 1287 | `scrollTarget?.scrollIntoView(...)` | `{ block: "nearest", behavior: "instant" }` | Inside `renderEpisodes()`, synchronous, only when a specific `focusEpisodeId` is being restored (e.g. resume, playback return, next-episode-prompt cross-season jump). Runs *before* the `focusElement()`/`applyFocus()` call a few lines later, which will independently trigger the `requestAnimationFrame`-deferred scroll from `focusEl()` too — i.e. **two scrollIntoView calls can fire for the same episode restore**, one instant+synchronous, one animation-frame-deferred with the same `"nearest"` semantics (effectively idempotent since "nearest" is a no-op once already visible, but worth knowing if a redesign changes scroll behavior to non-instant/smooth). |

No direct `.scrollTop` assignment or `.scrollTo()` call exists anywhere in
`detail.ts`. All scrolling in this surface is `scrollIntoView`-mediated, and
always uses `block: "nearest"` (never `"start"`/`"center"`/`"end"`) — meaning
the panel never intentionally centers or top-aligns a focused row; it only ever
moves the minimum distance to make the target fully visible.

(The season-chip row, `.detail-season-list`, has its own `scroll-behavior:
smooth` and `scroll-padding-inline: 2rem` in CSS (§1.6) but no corresponding JS
`scrollIntoView` call for chips specifically — chip scrolling into view when
focused is handled by the same generic `focusEl()` call as everything else,
which uses `"nearest"`, not smooth-scroll; the CSS `scroll-behavior: smooth`
only affects scrolls triggered by other means, e.g. a click-through browser
default, not the D-pad focus path.)

### 2.8 `UNVERIFIED_STREAM_STEPS` and unverified-styling decision

```37:43:src/launcher/src/detail.ts
/** Play-only / floor steps — never styled as verified in the side-list. */
const UNVERIFIED_STREAM_STEPS = new Set([
  "obligation_floor",
  "last_resort",
  "4k_sdr_soft_cached",
  "1080p_uncached_fallback",
]);
```

A stream renders as unverified (`.detail-stream--unverified` class,
`"unverified"` flag chip, dashed border, muted resolution badge, §1.5) if
**either** `stream.unverified === true` **or** `stream.ladder_step` is one of
these four literal strings (line 1508-1509, evaluated per-stream in
`createStreamButton()`). Separately, the **panel label** ("streams" vs "streams
· unverified") flips to unverified only when **every** stream in the list meets
this same test (`floorOnly`, line 1486-1489 in `renderStreams()`) — so it's
possible for the panel label to say plain "streams" while an individual bubble
inside it still shows the dashed/muted unverified treatment (mixed list), and
vice versa is not possible (if the panel says unverified, all bubbles are
individually unverified too, since `floorOnly` requires every stream to satisfy
the same predicate).

Episode "no-streams" styling (`.detail-episode--no-streams`, distinct concept,
opacity 0.55 + "tap to retry" badge) is driven by a different signal —
`episode.playable === false` from the server (`createEpisodeButton()`, line
1357-1360) — not `UNVERIFIED_STREAM_STEPS`, which applies only to the movie
stream list. `setEpisodeStreamBadge()` (1025-1037) later toggles between
`--no-streams`/`--has-streams` and the badge text/visibility based on live
play-attempt outcomes, independent of the original server hint.

---

## Section 3 — What will break

### 3.1 Gate scripts asserting on this surface

`scripts/m6-ship/gate-m6-ux-smoke.sh` greps **source** (not just built dist) for
literal contract strings. Every literal touching detail/streams/episodes/related:

- Line 42: `"moveRow" not in detail or "moveCol" not in detail` — fails if
  `detail.ts` loses either method name.
- Line 44: `"getBoundingClientRect" not in detail` — fails if `navigate()` stops
  using live geometry (e.g. switched to a static focus-grid array).
- Line 48-49: `"async refreshAfterPlayback" not in detail or "await
  this.loadEpisodeList(card)" not in detail`.
- Lines 50-54: extracts the substring of `detail.ts` between
  `"async refreshAfterPlayback"` and `"restoreAfterPlayback"`, and within that
  slice requires `"this.focusEpisodeById(returningEpisodeId)"` to be present,
  **and requires it to appear textually after** `"await
  this.loadEpisodeList(card)"` (`refresh.find(...) > refresh.find(...)` check,
  line 53) — i.e. this gate depends on the *literal source order of statements*
  inside `refreshAfterPlayback()`, not just their presence. Any reordering
  (even a no-op refactor) can fail this gate.
- Line 55-56: `"nextEpisodeFocusTarget" not in detail or "this.pendingEpisodeRestore
  = focusTarget" not in detail`.
- Line 66: `"reconcileEpisodePlayTimeout" not in detail`.
- Line 68: `detail.count("clearPlaybackReturnSnapshot();") < 3` — literally counts
  occurrences of that exact call-with-semicolon substring; must stay ≥3.
- Lines 70-72: extracts the substring between `"} catch (error) {"` and `"}
  finally {"` and requires `reconcileEpisodePlayTimeout`'s position to be
  **before** `setEpisodeStreamBadge(episodeId, false)`'s position within that
  slice.
- Lines 60-62: fails if the literal strings `"trying alternate release"` or
  `"caching stream on TorBox"` appear **anywhere** in `detail.ts` (negative
  assertion — these are banned phrases, not required ones).
- Line 148: dist HTML must contain `id="detail-episode-list"`.
- Lines 189-204 (dist CSS check): must contain the literal substrings
  `".detail-button.focused"` and `".detail-episode.focused"` (plus several
  non-detail contracts). Note this is a **substring** search on the built CSS
  text, so it would still pass even if the selector's rule body changed
  entirely — only the selector text itself is checked.

None of these assert on `.detail-side`, `.detail-stream*`, `.detail-related*`,
season chips, or the CSS grid/height rules directly — the gate's CSS check only
touches two selectors on this whole surface (`.detail-button.focused`,
`.detail-episode.focused`). **The height/layout/scroll changes this redesign
targets are therefore not gated by `gate-m6-ux-smoke.sh` at all** — only the
literal existence of those two focus selectors, `moveRow`/`moveCol`,
`getBoundingClientRect`, and the playback-return/timeout-reconciliation code
shape are.

Backend-only gates that touch adjacent contracts but not this surface's
markup/CSS: `scripts/m3-play/detail/gate-m3-detail.sh` (asserts
`/stream/movie/:id` returns ≥1 stream with non-empty `display_label`, and
`/stream/series/:id` returns ≥1 stream — pure API, no DOM) and
`scripts/m3-play/detail/gate-m3-episodes.sh` (asserts `/series/:id/episodes`
shape: `series_id`, `episode_count >= 4`, `seasons[0].episodes[0]` has
`playable`/`season` keys — also pure API).

### 3.2 Unit tests covering `detail.ts`

Three `*.test.ts` files import from `./detail`, all narrow (pure-function tests,
no DOM):

- `src/launcher/src/detail-search-queue.test.ts` — tests only
  `isConfirmedNoStreamsError()` (exported helper, line 1646-1649 of detail.ts).
  Unrelated to layout/focus.
- `src/launcher/src/playback-return-focus.test.ts` — tests only
  `nextEpisodeFocusTarget()` (exported helper, line 1656-1679). Verifies it
  matches series/episode IDs correctly and rejects stale hints from another
  title/episode; does not touch DOM, CSS, or the side panel directly, but a
  redesign that changes episode-ID handling would need this to keep passing.
- `src/launcher/src/pad-nav.test.ts` — tests `handlePadNav()` dispatch (a
  different file, `pad-nav.ts`), using mock handlers for
  `detailMoveRow`/`detailMoveCol`/`detailChangeSeason`/`detailSelect`/
  `detailBack` — verifies pad-nav routing logic, not `DetailController`'s
  internals. Confirms the **names** `detailMoveRow`/`detailMoveCol`/
  `detailChangeSeason` are part of a stable interface (`PadNavHandlers` in
  `pad-nav.ts`) that `main.ts` wires to `detail.moveRow`/`moveCol`/`changeSeason`
  (main.ts:259-262).

**No test in the repo renders `DetailController` against real/fake DOM and
asserts on stream-bubble count, episode-row count, focus order, or CSS-derived
geometry.** The `navigate()` scoring algorithm (§2.2.2) has zero direct test
coverage — its only validation is the couch checklist (§3.3) and the
`10-polish-plan.md` D7 note describing a known-unfixed defect found by manual
scripted key walks, not an automated test.

### 3.3 Docs that will go stale

**`docs/COUCH_TEST.md`** — numbered checks covering this exact surface,
quoted exactly:

```
| 5 | Open **Panchayat** (or Breaking Bad) → episode list below actions | |
| 6 | D-pad **down** into episodes — **active season only**; streams strip **does not** update on focus | |
| 7 | **L/R** on season chip or episode row **changes season** (multi-season); chip row hidden when one season | |
| 7a | **B** on focused episode resolves and plays immediately; no dwell prefetch or mandatory picker. **Play** from actions row = global resume | |
| 8 | Grey/unverified rows remain focusable and show **tap to retry**; **B** re-runs the normal main → last-resort → floor play path | |
| 9 | **Play / Resume** starts mpv; **Y** returns to detail | |
| 10 | Exit an episode early → same episode row is focused; finish to **≥90%/EOF** → the next episode row is focused directly, including across a season boundary | |
```

```
| U2 | D-pad detail: **2D FocusGrid** — actions L/R · episodes/streams U/D; no focus trap | |
```
(Note: `detail.ts` does **not** use the `FocusGrid` class from `focus.ts` —
that class is used by home rails only. This checklist item's "FocusGrid" label
is a misnomer for `DetailController`'s own bespoke `navigate()` method, §2.2.2.
A redesign should not go looking for a `FocusGrid` instance inside
`DetailController`; there isn't one.)

```
| P3 | **Type floor** — badges, stream rows, episode numbers and card metadata are all readable from the sofa; nothing needs leaning in | |
| P6 | **Detail** — the backdrop reads as artwork behind the panel (not a muddy wash), the hero poster is substantial, synopsis lines are short enough to scan, and related cards are legible | |
| P7 | **Detail related row** — it spans the full width beneath the streams panel; D-pad reaches it and comes back without teleporting or trapping focus | |
| P8 | **Episodes** — no double amber ring, and the related row never overlaps the side panel | |
```

Also relevant, further down `COUCH_TEST.md` (not part of the numbered checklist
proper, but couch-test evidence commands that assume today's stream JSON
shape): lines 111-112, 142-145, 188-189 pipe `/stream/...` responses through
`jq` filters naming `resolution,encode,hdr_tags,cache_status,debrid_service,
ladder_step,unverified,display_label` — any renamed/removed `CatalogStream`
field breaks these diagnostic one-liners (not an automated gate, but an agent
runbook step).

**`docs/STATUS.md`** — one line under M6.5:

```
| Detail navigation | 2D `FocusGrid` — actions L/R · episodes/streams U/D |
```
Same "FocusGrid" misnomer as `COUCH_TEST.md` U2. Also references
`gate-m6-ux-smoke.sh` as the automated gate for this row (line 324, 432) — per
§3.1, that gate does not actually check layout/height/scroll behavior on this
surface.

**`docs/PLAYABILITY.md` and `docs/ARCHITECTURE.md`** — both mention a "Streams
panel", but in both cases this refers to the **in-mpv-playback OSD** Streams
picker (X-button overlay during playback, a completely different feature
implemented in `mango-hud.lua` / the play-session client), not
`.detail-stream-list`. `PLAYABILITY.md:98` ("**X** opens a persistent Streams
panel inside the mpv…") and `ARCHITECTURE.md:58` ("in-playback Streams panel")
are **not stale from this redesign** — they don't describe `.detail-side` at
all. Flagging this explicitly so it isn't mistaken for overlap.

**`docs/tasks/ux-round/00-surfaces.md`** §11-16 — the most detailed existing
behavior inventory of this exact surface (hero, streams panel, episodes panel,
YouTube-video-list variant, related-titles rail). Its prose descriptions match
this document's findings, but its `detail.ts:` line-number citations
(e.g. "`detail.ts:55-1821`", "`detail.ts:1384-1547`") are from an earlier
commit and are **off by roughly 15-20 lines** from the current file read here
(current file is 1827 lines total, ends with `streamAriaLabel` around line
1814-1827) — treat this document's own line numbers as authoritative, and
`00-surfaces.md`'s as directionally correct but not exact.

**`docs/tasks/ux-round/10-polish-plan.md`** — contains the design rationale
this redesign will directly override: the "related row spans full width beneath
the side panel" decision (§ around line 153-177), which explicitly states the
228px-related-card-width / `RELATED_DISPLAY_LIMIT: 7` choice was made *because*
"every pixel of card height comes out of the side panel above" and states the
resulting cost as "a series shows 5 of 8 episodes rather than all 8." Any
redesign of the height allocation directly obsoletes this section's numbers
(228px, 7, 5-of-8, 526px vs. 972px) — see §4 for this document's own
independent arithmetic re-deriving/cross-checking those figures.

**`docs/tasks/ux-round/07-handoff-protocol.md`** — "pre-approved knobs" table
names this exact surface as containing the **one** non-CSS-custom-property knob
a deploying agent is allowed to touch without design authority, quoted in full:

```
| `.detail-related-track .card--poster` width cap (currently `228px`) with `RELATED_DISPLAY_LIMIT` in `src/launcher/src/detail.ts` (currently `7`) | **down to `200px` / `8`** | The full-width related row takes its height from the side panel above it, so a series now shows 5 of 8 episodes. If that reads too cramped on the couch, shrinking the cards gives the panel height back. Change both together and report how many episodes became visible. |
```

This is a **standing, doc-authorized escape hatch** for exactly the trade-off a
redesign will be re-litigating — a redesign should either supersede/delete this
row or explicitly reconcile with it, since as written it grants blanket
permission to change these two specific numbers without further review. Also
note a naming drift in the same doc's *other* pre-approved-knobs table (the CSS
custom property one, a few lines above): it references `--focus-ring-width` and
`--motion-fast`/`--motion-base`, but the actual token names in `style.css` are
`--focus-ring` (line 43) and `--dur-focus-in`/`--dur-focus-out` (lines 94-95) —
those two knob rows do not correspond to any real token today.

### 3.4 Feature flags

`src/launcher/src/ui-flags.ts` — the entire file, quoted in full:

```1:6:src/launcher/src/ui-flags.ts
/**
 * Launcher UI experiments — flip flags here to revert without hunting CSS/JS.
 */

/** Hide title/year overlay on movie + TV show home posters (art already includes title). */
export const MINIMAL_VOD_POSTER_LABELS = true;
```

**Only one flag exists in the whole file, and it does not affect the detail
view.** `MINIMAL_VOD_POSTER_LABELS` gates `.card--poster-minimal` (style.css
§1494-1541), which is consumed by `home.ts`'s poster-card rendering for the
Home rails only — not referenced anywhere in `detail.ts` (confirmed by grep:
zero occurrences of `ui-flags` or `MINIMAL_VOD_POSTER_LABELS` in `detail.ts`).
The related-titles cards inside Detail (`.card--related`) are explicitly
**exempt** from this flag per `00-surfaces.md` line 333 ("this rail is not
subject to the minimal-label poster flag") and confirmed structurally: `.card--
poster-minimal` is never added to the `button.card card--poster card--portrait
card--related` element built by `createRelatedCard()` (detail.ts:807-849).
**There is no feature flag gating any part of `.detail-side` today.**

### 3.5 `index.html` — the static markup skeleton

Full detail-view block, quoted exactly (`src/launcher/index.html:28-75`):

```28:75:src/launcher/index.html
      <section id="detail-view" class="view detail hidden" aria-label="Title detail">
        <div class="detail-backdrop" aria-hidden="true">
          <img id="detail-backdrop-image" class="detail-backdrop-image" alt="" />
        </div>
        <div class="detail-main">
          <div class="detail-hero">
            <div class="detail-poster-wrap">
              <img id="detail-poster" class="detail-poster" alt="" />
            </div>
            <div class="detail-copy">
              <p id="detail-eyebrow" class="eyebrow">catalog</p>
              <h1 id="detail-title">title</h1>
              <p id="detail-meta" class="detail-meta">movie</p>
              <p id="detail-verify-badge" class="verify-badge" hidden></p>
              <p id="detail-description" class="detail-description">loading details…</p>
              <div class="detail-actions">
                <button id="detail-play" class="detail-button detail-button--primary" type="button">
                  <span class="detail-button-spinner" aria-hidden="true"></span>
                  <span class="detail-button-label">play</span>
                </button>
                <button id="detail-save" class="detail-button" type="button">save</button>
                <button id="detail-not-interested" class="detail-button" type="button" hidden>not interested</button>
                <button id="detail-back" class="detail-button" type="button">back</button>
              </div>
            </div>
          </div>
        </div>
        <div class="detail-side">
          <div id="detail-streams" class="detail-panels detail-streams" hidden aria-label="Streams">
            <p class="detail-streams-label">streams</p>
            <div id="detail-stream-list" class="detail-stream-list"></div>
          </div>
          <div id="detail-episodes" class="detail-panels detail-episodes" hidden aria-label="Episodes">
            <p class="detail-episodes-label">episodes</p>
            <div id="detail-season-list" class="detail-season-list" hidden aria-label="Seasons"></div>
            <div id="detail-episode-list" class="detail-episode-list"></div>
          </div>
        </div>
        <!-- Its own full-width grid row, not inside .detail-main: the row spans
             under the side panel so it uses the canvas the panel leaves empty. -->
        <div id="detail-related" class="detail-related hidden" aria-label="Related titles">
          <div class="detail-related-head">
            <p id="detail-related-label" class="detail-related-label" role="heading" aria-level="2">related titles</p>
            <p id="detail-related-context" class="detail-related-context" hidden></p>
          </div>
          <div id="detail-related-track" class="detail-related-track" role="list"></div>
        </div>
      </section>
```

Structurally load-bearing facts this markup encodes that are easy to break in a
refactor:

- `#detail-streams` and `#detail-episodes` are **siblings**, both direct
  children of `.detail-side`, both start `hidden`. `DetailController`'s
  constructor receives them as separate injected elements (`streamsWrap`,
  `episodesWrap` params, detail.ts:102,104) — there is no single "panel"
  abstraction, just two independently-hidden divs sharing the parent flex
  column and its `gap`.
- `#detail-related` is a sibling of `.detail-main` and `.detail-side` at the
  `.detail` (grid) level, **not nested inside `.detail-main`** — this is what
  lets it occupy the separate `"related related"` grid row (§1.2) and is called
  out explicitly in the HTML comment at lines 66-67.
- The static placeholder text inside each button/label (`"catalog"`, `"title"`,
  `"movie"`, `"loading details…"`, `"streams"`, `"episodes"`, `"related
  titles"`, `"play"`) is what a user would see for a flash of time before
  `DetailController.show()` overwrites it — relevant if a redesign changes
  initial layout, since these placeholders determine pre-JS/pre-data box sizes.

---

## Section 4 — Measured baseline

All arithmetic below uses a 1920×1080 viewport (the Pi's fixed kiosk resolution
per `docs/DEPLOY.md`/`docs/OPS.md`) and a 16px root font size (no `html { font-
size }` override exists anywhere in `style.css` — confirmed by grep — so `1rem
= 16px` throughout).

### 4.1 Side column width

`.detail` grid-template-columns (style.css:1863):
`minmax(0, 1fr) clamp(280px, 24vw, 380px)`

At 1920px viewport: `24vw = 0.24 × 1920 = 460.8px`. `clamp(280px, 460.8px,
380px)` clamps to its **maximum**, `380px`, since 460.8 > 380. So:

**Side column total width = 380px.**

The clamp's midpoint (24vw) only stays below the 380px ceiling for viewports
narrower than `380 / 0.24 = 1583.3px` — i.e. at every viewport ≥1584px
(including the Pi's 1920px), the side column is pinned at the flat **380px**
ceiling, not actually viewport-responsive in practice on this hardware.

Content width after padding: `.detail-side` has `padding-inline:
var(--focus-gutter)` (style.css:2138), and `--focus-gutter: calc(var(--focus-
glow) + 8px) = calc(14px + 8px) = 22px` (lines 44-45).

**Content width = 380px − 2 × 22px = 336px.**

(This 336px figure is independently corroborated by `10-polish-plan.md`'s own
prose at line 184: "four chips on a stream row … exceed the 336px row and
wrap" — confirms the arithmetic above matches the number the original author
used.)

### 4.2 Vertical budget

`.detail` is `position: fixed; inset: 0` (does not inherit `.shell`'s padding —
it has its own `padding: var(--safe-y) var(--safe-x)` at line 1875), so its
content box, before that padding, is the full 1920×1080 canvas.

`--safe-y: 54px`, `--safe-x: 96px` (lines 41-42).

**Total canvas after safe area = (1920 − 2×96) × (1080 − 2×54) = 1728px ×
972px.**

Grid rows: `grid-template-rows: minmax(0, 1fr) auto` with `row-gap:
var(--space-stack-lg)` = `1.5rem = 24px` (line 1873, 78).

**Case A — related row hidden** (`.detail-related.hidden`, `display: none`):
the `auto` row has no content, so its track resolves to 0px. The row-gap of
24px between the two grid tracks is still reserved (CSS Grid applies `row-gap`
between adjacent tracks unconditionally, independent of whether either track's
content is empty).

Row 1 (`main side`) height = `972 − 24 (gap) − 0 (empty related row) = 948px`.

**`.detail-side` height in this case ≈ 948px** (via `align-items: stretch` on
`.detail`, line 1874, and `.detail-side`'s own `height: 100%; max-height: 100%`,
lines 2133-2134, both resolving against the row-1 track height).

**Case B — related row visible.** Its height is the sum of:

- `.detail-related-head` (label + optional context line): `.detail-related-
  label` is `font-size: var(--text-control)` = 26px with no explicit
  `line-height` (browser default, ≈1.15-1.2× depending on font — Inter's normal
  line-height is close to 1.2, giving ≈31px), plus `.detail-related-context`
  at `font-size: var(--text-caption)` = 24px (≈29px line box) when present
  (suppressed only for the synthetic "voice" origin or an empty rail label,
  detail.ts:791-798), plus their `gap: 0.15rem` (2.4px) and the head's own
  `margin: 0 0 var(--space-rail-header)` = 20px bottom margin. Approx total:
  `31 + 2.4 + 29 + 20 ≈ 82px` (this component is **not pinned by any explicit
  CSS height** — it depends on the browser's real font metrics, which this
  document cannot compute exactly without a live render; treat as an estimate,
  not a guaranteed figure).
- `.detail-related-track .card--poster`: `width: clamp(136px, 13vw, 228px)`.
  At 1920px, `13vw = 249.6px`, clamped to the `228px` ceiling (same
  clamp-saturation pattern as §4.1; the ceiling binds for any viewport
  ≥`228/0.13 = 1753.8px`, so it binds at 1920px). `aspect-ratio: 2/3` →
  **card height = 228 × 3/2 = 342px.** The track's own `padding: var(--focus-
  gutter)` (22px) and `margin: calc(-1 * var(--focus-gutter))` (−22px) cancel
  each other in the document's flow footprint (this is the deliberate
  "focus-glow bleed" pattern used throughout this file), so the track occupies
  **342px** of vertical flow, not 342+44px.

**Estimated related-row total height ≈ 82 + 342 = 424px.**

Row 1 height in Case B = `972 − 24 (gap) − 424 (related row) ≈ 524px`.

This is within ~2px of the **526px** figure `10-polish-plan.md` states as the
shipped, author-measured (real Chromium render) side-panel height — close
enough to confirm this document's arithmetic is sound, with the small
discrepancy fully attributable to the unpinned line-height assumption in the
head-text estimate above (flagged, not guessed away).

**So: `.detail-side`'s available height swings between ~948px (no related row)
and ~526px (related row present) — a ~1.8× difference driven entirely by
whether a sibling grid row happens to have content, not by any rule that
directly targets the side panel's own height.** A redesign that "gives the
panel height back" (per the handoff-protocol knob) is trading against this same
related-row mechanism, not an independent budget.

### 4.3 Stream bubble height and scrollport capacity

`.detail-stream`: `min-height: 4rem` = **64px**, `padding: 0.7rem 0.9rem`
(11.2px vertical each side, already inside the 64px min-height since
`box-sizing: border-box` is set globally at line 111-113). Real height can
exceed 64px if the two internal rows (`.detail-stream-primary` +
`.detail-stream-secondary`, `gap: 0.4rem` = 6.4px between them) plus their
21.2px of padding exceed 64px — with a 26px-tall primary row (badge/chips) and
a 20px-tall secondary row (micro-text), `21.2×2 + 26 + 6.4 + 20 ≈ 94.8px` is a
more realistic real height for a bubble carrying both a resolution badge and a
secondary line, i.e. the `min-height: 4rem` is very likely **not** the binding
constraint in practice — actual height is content-driven and this document
cannot pin it exactly without a live render.

List gap: `.detail-stream-list { gap: 0.45rem }` = 7.2px between bubbles.

Available list height (Case B, related visible): panel height (~526px) minus
`.detail-streams-label` (font-size 26px, `margin: 0 0 var(--space-rail-header)`
= 20px bottom margin, ≈31+20=51px) ≈ **475px.**

Using the conservative `min-height: 4rem` (64px) floor: `n` bubbles fit where
`64n + 7.2(n−1) ≤ 475` → `71.2n ≤ 482.2` → **n ≈ 6.7, i.e. 6 full bubbles plus a
partially-visible 7th** (the partial row is an intentional affordance — see the
`.detail-side::after` sticky fade, §1.4 — not a bug).

Using the more realistic ~94.8px content-driven estimate: `94.8n + 7.2(n−1) ≤
475` → `102n ≤ 482.2` → **n ≈ 4.7, i.e. 4 full bubbles plus a partial 5th.**

**This document cannot resolve which of these two is closer to the real number
without measuring a live render** (the ux-harness mentioned in
`07-handoff-protocol.md`, rendered at 1920×1080, would give the exact figure) —
flagging explicitly per the "say so rather than guess" instruction, since the
true content height of a stream bubble is not fixed by any single CSS value.

### 4.4 Episode row height and scrollport capacity

`.detail-episode`: no explicit height; `padding: 0.85rem 1rem` (13.6px
vertical each side), `font-size: 1.15rem` = 18.4px, no explicit `line-height`
(browser default ≈1.2× ≈ 22px), `border: 2px solid` (4px total, inside
border-box). Estimated row height: `13.6×2 + 22 + 4 ≈ 53.2px` (again an
estimate — real text metrics may differ slightly).

List gap: `.detail-episode-list { gap: 0.55rem }` = 8.8px.

If a season chip row is present (multi-season only): `.detail-season-chip`
`min-width: 3.4rem`, `padding: 0.5rem 0.95rem` (8px vertical), `font-size:
var(--text-caption)` = 24px, giving an estimated chip height of `8×2 + ~29 ≈
45px`, plus the list's own `margin: 0 0 0.85rem` = 13.6px bottom margin —
**≈59px** subtracted from the pool before any episode rows are counted, single-
season shows skip this entirely (chip row `hidden`, §1.6).

Available pool (Case B, related visible, single-season show): panel height
(~526px) minus `.detail-episodes-label` (~51px, same formula as streams label)
≈ **475px**, same starting point as streams since the two labels share one CSS
rule (style.css:2178-2188).

`n` episode rows fit where `53.2n + 8.8(n−1) ≤ 475` → `62n ≤ 483.8` → **n ≈ 7.8,
i.e. 7 full rows plus a partial 8th** for a single-season show.

For a **multi-season** show, subtract the ~59px chip row first: pool ≈
`475 − 59 = 416px` → `62n ≤ 424.8` → **n ≈ 6.85, i.e. 6 full rows plus a
partial 7th.**

`10-polish-plan.md` states the shipped, real-Chromium-measured figure as **"5 of
8 episodes"** visible for its worked multi-season example — noticeably lower
than this document's ~6.85-row estimate. The gap is most likely one or more of:
(a) that example's episode titles wrapping to a second line in some rows
(`.detail-episode-label` has no `-webkit-line-clamp` or `white-space: nowrap` —
long titles can wrap and grow a row past the ~53px estimate — confirmed by
inspecting the rule at style.css:2322-2325, which sets no line-clamp at all),
(b) this document's line-height assumption being too tight, or (c) the doc's
example show having a longer/more-crowded season-chip row than estimated. **This
is exactly the kind of number a redesign should re-verify on a live render
rather than trust either this document's CSS arithmetic or the prior doc's
prose claim in isolation** — both are estimates/observations, not a pinned CSS
contract, and episode-title text length is a real variable neither accounts
for.
