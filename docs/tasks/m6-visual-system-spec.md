# M6 — Visual system spec (world-class 10-foot UI)

**Branch:** `feat/native-experience` · **Status:** design spec · **Pi canvas:** 1920×1080 @ 3 m  
**North star:** *Content forward · one focus language · cinema-dark calm · Apple TV / Netflix polish without copying chrome*

**Sources (2024–2026):** [Apple tvOS HIG — Focus](https://developer.apple.com/documentation/uikit/about-focus-interactions-for-apple-tv) · [Android TV — Focus system](https://developer.android.com/design/ui/tv/guides/styles/focus-system) · [Android TV — Layouts / overscan](https://developer.android.com/design/ui/tv/guides/styles/layouts) · [Smashing Magazine — Designing For TV (2025)](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/) · [Netflix Apple TV redesign (2024–2025)](https://www.macrumors.com/2025/08/13/netflix-rolls-out-redesigned-interface-apple-tv/) · mango launcher audit (`src/launcher/src/style.css`)

**Partner:** `$ux-design-expert` (tokens, type, motion) · `$mango-tv-box-expert` (focus grid, safe area, couch acceptance)

---

## 1. Why mango feels amateur today (audit)

| Issue | Root cause in code | Platform violation |
|-------|-------------------|-------------------|
| **Focus halo clipped on posters** | `.rail-track--posters { overflow: hidden }` + tight padding (`0.4rem 0.2rem`) + focus glow via `box-shadow` on `.card` inside clipped container | Android TV: account for focus scale/glow in gutters ([Layouts](https://developer.android.com/design/ui/tv/guides/styles/layouts)) |
| **Competing visual languages** | Amber `#ffb300` focus + green active tab + cream `#fff9c4` borders + dual gradients on `body` | Apple: one unmistakable focus treatment; background stays quiet ([FOCUS-01](https://github.com/ehmo/platform-design-skills/blob/main/skills/tvos/SKILL.md)) |
| **Decorative chrome over content** | Large masthead (`h1` 5.4rem), uppercase rail labels, busy background gradients | Netflix 2025: top nav + content shelves; hero is content, not logo ([MacRumors](https://www.macrumors.com/2025/08/13/netflix-rolls-out-redesigned-interface-apple-tv/)) |
| **Weak depth hierarchy** | All cards same border weight; unfocused tiles equally loud | Focus system: default dim → focused lift ([Android Focus](https://developer.android.com/design/ui/tv/guides/styles/focus-system)) |
| **Typography not calibrated for 10 ft** | `1.15rem` poster titles in a 9-up grid ≈ ~18px effective — below tvOS 29pt body guidance | Apple tvOS: body ≥ 29pt at designed resolution ([tvOS guidelines](https://github.com/ehmo/platform-design-skills/blob/main/skills/tvos/SKILL.md)) |
| **Inconsistent focus mechanics** | Posters: border + outer glow + translateY; settings: `outline`; detail episodes: 6px outline | One focus vocabulary across all surfaces |

**P0 fix (can ship independently):** remove clipping, add focus gutter, unify focus ring. See §6 Phase 0.

---

## 2. Exhaustive 10-foot UI standards (synthesis)

### 2.1 Viewing distance & canvas

| Standard | Apple tvOS | Android TV | mango (1080p Pi) |
|----------|------------|------------|------------------|
| Design distance | 8–12 ft (2.5–3.5 m) | 10 ft | **3 m couch** |
| Design artboard | 1920×1080 | 960×540 dp → scale | **1920×1080** |
| Orientation | Landscape only | Landscape only | Landscape kiosk |
| Theme default | Dark, high contrast | Dark leanback | **Cinema dark** (§4) |

### 2.2 Safe area / overscan

| Edge | Apple tvOS | Android TV | **mango token** |
|------|------------|------------|-----------------|
| Left / right | ~80 pt | 48 dp (~5%) | **`--safe-x: 48px`** |
| Top / bottom | ~60 pt | 27 dp (~5%) | **`--safe-y: 32px`** |
| Rule | Critical UI inside safe area; backgrounds may bleed | Same; allow partial off-screen decor | Apply to `.shell`, not poster bleed |

References: [Smashing TV Part 2](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/) · [Spyro-soft 2025](https://spyro-soft.com/blog/media-and-entertainment/8-ux-ui-best-practices-for-designing-user-friendly-tv-apps)

### 2.3 Typography (minimum legibility)

| Role | Apple tvOS | Android TV | **mango @ 1080p** |
|------|------------|------------|-------------------|
| Display / hero | 48pt+ | Large display type | **`--text-display: 56px`** (detail hero only) |
| Title (focused card) | Bold, high contrast | Title Medium | **`--text-title: 28px`** |
| Body / HUD | ≥ 29pt | Body Large | **`--text-body: 26px`** |
| Caption / rail label | — | Label Medium | **`--text-caption: 20px`** |
| Tab / control | — | Title Small | **`--text-control: 22px`** |

**Font stack:** `SF Pro` unavailable on Pi → use **Inter** (already loaded) with **`font-feature-settings: "ss01"`** optional; weight 600–700 for UI, 800 for titles. Avoid hairline strokes; min border **2px** on focusable controls.

**Contrast:** WCAG AA — **4.5:1** body, **3:1** large text on `#0a0c0f` base ([tvOS DISTANCE-02](https://github.com/ehmo/platform-design-skills/blob/main/skills/tvos/SKILL.md)).

### 2.4 Focus system (the product surface on TV)

TV has **no pointer**. Focus state *is* navigation feedback.

| Technique | When to use | Platform guidance | **mango choice** |
|-----------|-------------|-------------------|------------------|
| **Scale** | Posters, large tiles | 1.025–1.1× ([Android Focus](https://developer.android.com/design/ui/tv/guides/styles/focus-system)) | **`1.06×`** posters, **`1.03×`** buttons |
| **Elevation / glow** | Cards | Shadow under element | **Soft outer ring + shadow**, not inner clip |
| **Border highlight** | Chips, list rows | High-contrast outline | **2px ring** on controls |
| **Dim unfocused** | Dense grids | Reduce noise | **`opacity: 0.88`** on unfocused posters in row (optional Phase 2) |
| **Parallax** | Hero posters | tvOS LSR layers | **Defer** — CSS-only subtle `translateZ` illusion Phase 3 |
| **Motion** | Focus gain/loss | 150–220 ms ease-out; instant snap-back acceptable | **`180ms cubic-bezier(0.2, 0, 0, 1)`** |
| **Audio** | Focus change | Optional tick | **Defer** (no WebAudio in kiosk V1) |

**Apple Focus Engine rules** ([docs](https://developer.apple.com/documentation/uikit/about-focus-interactions-for-apple-tv)):
- Exactly one focused element; movement is geometric (D-pad).
- Never trap focus; bridge gaps with focus guides (mango: `FocusGrid` + scroll padding).
- Focus must remain visible after data refresh — preserve `focusKey`.

**Netflix / Apple TV consumer pattern (2024–2025):**
- Top-level navigation bar (not sidebar) — reduces eye travel ([The Verge via MacRumors](https://www.macrumors.com/2025/08/13/netflix-rolls-out-redesigned-interface-apple-tv/)).
- Poster **expands on focus**; metadata appears on focus or on detail — not always-on clutter.
- Dark UI; artwork carries color.

### 2.5 Layout — shelves (rails)

| Pattern | Spec |
|---------|------|
| Rail structure | Label (caption) + horizontal row; **9-up** grid for 2:3 posters (locked) |
| Poster aspect | **2:3** movies/series · **16:9** YouTube/live cards |
| Gutter | **20px** between cards + **focus gutter** `max(16px, focus-ring + scale overflow)` ([Android layouts](https://developer.android.com/design/ui/tv/guides/styles/layouts)) |
| Rail spacing | **40px** between rails |
| Scroll | Vertical between rails; horizontal within rail optional for >9 (future) |
| Empty rails | Hidden (already shipped) |

### 2.6 Color & atmosphere

**Principle:** Background is **near-black neutral**; brand accent appears only on **focus + primary actions**. No full-screen green/gold gradients (current `body` background fights posters).

### 2.7 Motion

| Event | Duration | Curve |
|-------|----------|-------|
| Focus gain | 180 ms | ease-out |
| Focus loss | 120 ms | ease-in (slightly faster) |
| Tab switch / rail refresh | 160 ms | opacity crossfade (existing) |
| Detail open | 220 ms | fade + subtle slide up 8px |
| HUD | 280 ms | existing |

Respect `prefers-reduced-motion: reduce` — focus scale → border-only.

### 2.8 States matrix (all focusables)

| State | Visual |
|-------|--------|
| default | Base border `rgba(255,255,255,0.08)` |
| focused | Scale + `--focus-ring` + `--focus-glow` |
| active tab | Filled pill (muted), not competing with focus ring |
| selected (detail episode) | Inner tint, focus ring still wins |
| disabled | `opacity: 0.38` (existing) |
| pressed | Scale 0.98 briefly (Phase 2) |

### 2.9 Accessibility

- Focus never color-only — ring + scale + shadow.
- Min touch target equivalent: **48×48 dp** for controls ([Android TV adaptive](https://developer.android.com/develop/adaptive-apps/guides/tv/build-adaptive-apps-for-tv)).
- Test at 3 m on real Pi + 8BitDo pad; simulators lie about glow clipping.

---

## 3. Design direction — **Cinema Dark**

**One sentence:** Black-box theater — posters glow when selected; everything else recedes.

### 3.1 Mood board (reference, not clone)

| Reference | Take |
|-----------|------|
| **Apple TV** | Focus parallax discipline, quiet chrome, crisp type |
| **Netflix (2025)** | Top nav, expanding tiles, dark shell |
| **Disney+** | Soft card lift, cool shadows |
| **mango brand** | Lowercase voice, warm accent **only on focus** |

### 3.2 Do / Don't

| Do | Don't |
|----|-------|
| Let poster art dominate | Gradient wallpaper behind rails |
| Single amber focus accent | Amber + green + cream fighting |
| Generous focus gutter | `overflow: hidden` on rail tracks |
| Caption-sized rail titles | ALL CAPS SHOUT labels |
| Collapse masthead on home | 5rem logo on browse |

---

## 4. Design tokens

```css
:root {
  /* Canvas */
  --canvas-w: 1920;
  --canvas-h: 1080;

  /* Safe area */
  --safe-x: 48px;
  --safe-y: 32px;

  /* Color — cinema dark */
  --bg-base: #07080a;
  --bg-elevated: #12151a;
  --bg-overlay: rgba(7, 8, 10, 0.94);
  --text-primary: #f4f1ea;
  --text-secondary: rgba(244, 241, 234, 0.68);
  --text-muted: rgba(244, 241, 234, 0.45);
  --accent: #e8a020;           /* warm amber — focus & primary CTA only */
  --accent-soft: rgba(232, 160, 32, 0.16);
  --accent-glow: rgba(232, 160, 32, 0.42);
  --tab-active-fill: rgba(255, 255, 255, 0.08);
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.16);

  /* Focus physics */
  --focus-ring: 3px;
  --focus-glow: 14px;
  --focus-scale-poster: 1.06;
  --focus-scale-control: 1.03;
  --focus-gutter: calc(var(--focus-glow) + 8px);

  /* Type (px @ 1080p) */
  --text-display: 56px;
  --text-title: 28px;
  --text-body: 26px;
  --text-control: 22px;
  --text-caption: 20px;

  /* Space */
  --rail-gap: 40px;
  --card-gap: 20px;
  --radius-poster: 12px;
  --radius-control: 999px;
  --radius-panel: 16px;

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0, 0, 1);
  --dur-focus-in: 180ms;
  --dur-focus-out: 120ms;
}
```

---

## 5. Component specs

### 5.1 Shell / home

```
┌────────────────────────────────────────────────────────────── safe-x
│  [movies] [tv shows] [live] [youtube]              [shuffle ⟳] │  ← browse bar, 72px tall
│                                                                │
│  continue watching                              caption label  │
│  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐                 │
│  │  │ │  │ │  │ │  │ │▣ │ │  │ │  │ │  │ │  │  ← focus gutter │
│  └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘ └──┘                 │
│                                                                │
│  trending …                                                    │
│  …                                                             │
└────────────────────────────────────────────────────────────── safe-y
```

- **Remove or shrink masthead** on home — mango wordmark only in settings/about.
- **Browse bar** pinned top inside safe area; tabs are pills; **shuffle** is icon+label ghost button.
- **Active tab:** filled `--tab-active-fill`, no green.

### 5.2 Poster card (primary tile)

**Unfocused:**
- `border: 2px solid var(--border-subtle)`
- `border-radius: var(--radius-poster)`
- No translateY
- Optional: `opacity: 0.92` on siblings when one focused (Phase 2)

**Focused:**
- `transform: scale(var(--focus-scale-poster))`
- `box-shadow: 0 0 0 var(--focus-ring) var(--accent), 0 0 var(--focus-glow) var(--accent-glow), 0 18px 48px rgba(0,0,0,0.55)`
- `border-color: transparent` (ring replaces border)
- Title in scrim: `--text-title`, max 2 lines
- Progress bar: 3px accent bottom

**Critical CSS change:**

```css
.rail-track--posters {
  overflow: visible;              /* was hidden — root clip bug */
  padding: var(--focus-gutter);   /* room for ring + scale */
  margin: calc(-1 * var(--focus-gutter)); /* keep layout alignment */
}
```

### 5.3 Tabs & shuffle

- Height **48px** min; padding `0 20px`
- Focused: ring + slight scale; active state separate (fill, not ring color)
- **Never** use focus amber on active tab simultaneously — active = fill; focus = ring

### 5.4 Detail view

- Full-bleed **blurred backdrop** from poster (CSS `filter: blur(40px) brightness(0.35)` on duplicate image)
- Left: hero poster (smaller than today — max 320px width)
- Right: title `--text-display`, meta `--text-body`, actions row
- Actions: primary = solid `--accent` text dark; secondary = ghost
- Episode/stream rows: list style with left accent bar on focus (not 6px outside outline)

### 5.5 Voice HUD

- Keep safe-area rules (shipped)
- Match token colors; reduce border to 1px `--border-strong`
- Slightly smaller `--text-body` (24px) to avoid crowding rails

### 5.6 Settings / reliability

- Same focus ring component as detail buttons
- Cards: `--bg-elevated`, no rainbow border colors — use left accent stripe only for status

---

## Locked decisions (2026-07-05)

See questionnaire outcomes — implemented in Phase 0+ pass:

- **Brand:** compact lowercase `mango` in browse bar; **removed** “What do you want to watch?”
- **Focus:** amber 3px ring + glow · 1.06× scale · sibling dim 88% · focus gutter (no clip)
- **Type:** spec scale (caption 20px, title 28px, body 26px)
- **YouTube:** 16:9 landscape cards · titles below thumbnail
- **Live:** LIVE pill on applicable tiles
- **Detail:** blurred backdrop · 320px poster · 3-line synopsis · amber CTAs
- **Cadence:** Phase 0 → couch U1/edge/U3 → full pass (this commit = Phase 0+1 combined)

---

| Phase | Scope | Exit |
|-------|-------|------|
| **0 — Focus fix** | `overflow: visible`, focus gutter, unified `.focus-ring` utility class | U1 couch: halo never clipped on edge posters |
| **1 — Tokens** | CSS variables in `style.css`; swap colors/type | ux-smoke gate green |
| **2 — Chrome diet** | Remove body gradients; shrink/remove home masthead; rail label sentence case | Visual review @ 3 m |
| **3 — Components** | Poster, tabs, detail, settings unified | COUCH_TEST U1–U9 |
| **4 — Polish** | Detail backdrop blur, unfocused dim, tab transitions | Ship candidate |
| **5 — Optional** | Hero row, parallax, focus tick sound | Post-merge |

**Files:** `src/launcher/src/style.css` (primary) · `index.html` (font preload) · `gate-m6-ux-smoke.sh` (assert focus gutter CSS)

---

## 7. Acceptance (world-class bar)

| # | Criterion | Method |
|---|-----------|--------|
| F1 | Focus ring fully visible on all 9 columns including col 1 and 9 | Couch + screenshot |
| F2 | One focus accent color across home, detail, settings | Visual audit |
| F3 | Rail titles readable at 3 m | `--text-caption` ≥ 20px |
| F4 | Poster titles readable when focused | `--text-title` ≥ 28px |
| F5 | No layout shift when focus moves between rails | Video capture |
| F6 | Background never competes with poster art | Design review |
| F7 | Tab vs focus visually distinct (U4) | COUCH_TEST |
| F8 | `prefers-reduced-motion` disables scale | Toggle test |

---

## 8. Immediate P0 patch sketch

Apply in `style.css` before full token migration:

```css
.rail-track--posters {
  overflow: visible;
  padding: 16px;
  margin: -16px;
}

.card.focused,
.card:focus-visible {
  outline: none;
  border-color: transparent;
  z-index: 2;
  position: relative;
  box-shadow:
    0 0 0 3px var(--accent, #e8a020),
    0 0 18px rgba(232, 160, 32, 0.45),
    0 20px 50px rgba(0, 0, 0, 0.5);
  transform: scale(1.06);
}
```

Also audit `.rails { overflow-x: hidden }` — may clip horizontal glow on first/last column; prefer `overflow-x: clip` only if glow fits inside safe area.

---

## 9. Out of scope

- Framework rewrite (stay Vite + vanilla TS)
- Wayland / compositor changes
- Custom font licensing (Inter is fine for ship)
- Full Netflix hero / autoplay previews (Phase 5+)

---

## 10. Doc links

- Implementation tracker: extend [m6-tv-ux-ship.md](m6-tv-ux-ship.md) § Visual system
- Couch gates: [COUCH_TEST.md](../COUCH_TEST.md) U1–U9
- Prior round: [round-m55b-m65-scope.md](round-m55b-m65-scope.md)
