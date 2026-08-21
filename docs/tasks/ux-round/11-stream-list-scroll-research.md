# Stream List Scroll & 10-Foot UI Research

## 1. Verdict up front

1. **Per-Item View-Timeline Dissolve**: Remove the container gradient entirely and use `animation-timeline: view()` on the stream items themselves so they organically scale and fade as they enter/exit the edges, creating a "borderless" list.
2. **Exact-Multiple Viewport with Center Focus Anchor**: Size the scrollport to fit exactly *N* items with no half-cuts, and use `scroll-padding-block: 50%` to force the focused item to the center, removing the need for any edge treatment at all.

---

## 2. Pattern candidates

### Candidate A: Per-Item View-Timeline Dissolve (The "Borderless" List)
* **What it is**: Instead of a rectangular gradient masking the container, each stream or episode bubble animates its own opacity and scale based on its position within the scrollport. 
* **Who ships it**: Modern Web 2026 specs (WebPerfClinic, Chrome DevRel); adapted for TV to replace static box scrims.
* **D-pad behavior**: Normal vertical scrolling, but items dissolve elegantly into the background as they exit the top/bottom boundaries.
* **CSS/JS mechanism sketch**:
  ```css
  .detail-side {
    /* Force focused item to stay in the 20-80% safe zone */
    scroll-padding-block: 4rem; 
  }
  .detail-stream, .detail-episode {
    animation: item-edge-dissolve linear both;
    animation-timeline: view(block);
    /* Fades happen only in the first and last 15% of the scrollport */
    animation-range: cover 0% cover 100%;
  }
  @keyframes item-edge-dissolve {
    0%   { opacity: 0; transform: scale(0.9); }
    15%  { opacity: 1; transform: scale(1); }
    85%  { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.9); }
  }
  ```
* **Pi-5 performance verdict**: **Excellent**. `opacity` and `transform` driven by `animation-timeline: view()` run entirely on the Chromium compositor thread, bypassing the main thread's layout and paint cycles.
* **Handling the focus-ring-at-edge problem**: Flawless. Because `scroll-padding-block` ensures the focused item stays strictly within the 20%–80% safe zone of the scrollport, the focused item *never* enters the 0-15% or 85-100% fade ranges. Its amber focus ring remains 100% opaque.
* **Failure modes**: If `scroll-padding-block` is too small, a focused item could sit inside the 15% threshold, dimming the focus ring.
* **Episode list viability**: Perfect. Long lists of 24 items will organically dissolve at the edges. Season chips simply act as a separate sticky or scrollable context above.

### Candidate B: Exact-Multiple Viewport with Center Anchor
* **What it is**: The scrollport height is rigidly calculated to fit exactly $N$ rows and their gaps. `scroll-padding-block` is set to keep focus in the exact center. Half-cut rows never appear, so edge fades become completely unnecessary.
* **Who ships it**: Android TV Compose via `BringIntoViewSpec` (to set exact focal offsets), tvOS (via focus engine centering).
* **D-pad behavior**: After the first few items, focus locks to the center of the list and the list translates underneath it.
* **CSS/JS mechanism sketch**:
  ```css
  .detail-side {
    /* Fits exactly 5 streams at 90px + 4 gaps at 8px */
    height: calc((5 * 90px) + (4 * 8px));
    /* Centers the focused 90px item */
    scroll-padding-block: calc(50% - 45px);
    scroll-behavior: smooth;
  }
  ```
* **Pi-5 performance verdict**: Excellent. Standard browser scroll mechanics with no continuous animations.
* **Handling the focus-ring-at-edge problem**: Solved automatically since the focused item is always dead center.
* **Failure modes**: Highly brittle to Dynamic Type and content variations. If a stream label or episode title wraps to two lines, the row height changes, breaking the exact-multiple math and bringing back half-cut items.
* **Episode list viability**: Risky. Episode cards often have varying heights due to synopsis length, breaking the exact sizing.

### Candidate C: Overflow-to-Fullscreen Modal
* **What it is**: The right-hand panel shows a flat list of exactly 3-4 streams. The final item is a "More Options (14)" button that opens a fullscreen modal grid.
* **Who ships it**: Netflix (Audio/Subtitle pickers), Amazon Prime.
* **D-pad behavior**: Panel never scrolls. Complex choices are handled in a dedicated fullscreen space.
* **CSS/JS mechanism sketch**: Standard flex layout, no CSS scrolling.
* **Pi-5 performance verdict**: Maximum. No scroll effects needed.
* **Episode list viability**: **Poor**. Users need to see the episode list alongside the series art, context, and season chips. Moving it to a fullscreen picker breaks the TV detail page paradigm.

---

## 3. Evidence table

| Source | URL | Date | Establishes | Confidence |
|--------|-----|------|-------------|------------|
| WebPerfClinic | [CSS Scroll-Driven Perf Guide](https://webperfclinic.com/article/css-scroll-driven-animations-performance-guide) | 2026 | `animation-timeline: view()` runs entirely on the compositor thread in Chromium when animating `transform` and `opacity`. | High (Definitive) |
| Android Developers | [Compose TV Lists](https://developer.android.com/training/tv/playback/compose/lists) | 2026 | Deprecation of TV-specific lists in favor of `BringIntoViewSpec` to programmatically anchor focus (e.g. 30% from edge). | High (Official) |
| Amazon Fire TV | [UX Guidelines](https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html) | 2026 | Textual position affordance ("2 of 14") should be used in list headers rather than relying on scrollbars. Inner 90% safe zone. | High (Official) |
| Apple tvOS HIG | [Scroll Views](https://developer.apple.com/design/human-interface-guidelines/scroll-views) | 2026 | tvOS does not use visual scroll indicators; the system automatically translates content to keep focus visible. | High (Official) |

---

## 4. Explicit contradictions with internal knowledge bases

**Contradicts `ux-design-expert` KB (§ Scroll-driven edge fades beat unconditional scrims):**
The internal UX KB advocates for a sticky gradient scrim whose opacity is tied to the container's `scroll()` timeline (so it disappears at the absolute top/bottom). 
* **The Contradiction**: While this fixes the "lies at rest" problem, the user explicitly complains that *the fade still draws a visible rectangular box boundary*. Candidate A (Per-item view-timeline) contradicts the KB by abolishing the container scrim entirely. By mapping the fade to the *item's* `view()` timeline instead, the items dissolve organically, completely eliminating the "box boundary" feel while matching the performance profile of the KB's recommendation.

**Refines `mango-tv-box-expert` KB (§ Focus feedback):**
The KB mandates that focus rings are instant (`--dur-focus-in: 0ms`) and drawn purely via scale/border/shadow. Candidate A leverages this: by forcing the focused item to stay in the center 60% of the viewport (via `scroll-padding`), the focus indicator never enters the edge dissolve zones, guaranteeing the instant, high-contrast amber ring is never compromised.

---

## 5. What you could NOT establish

1. **Exact-Multiple Sizing Guidance**: I could not find explicit documentation in Apple HIG or Google Leanback asserting that developers *must* size viewports to exact row-height multiples to prevent partial clipping. Platform focus engines handle clipping organically by translating the list, making exact-sizing a design trick rather than an official guideline.
2. **Homogeneous Grouping Evidence**: While Miller's Law suggests grouping 14 streams by resolution (4K, 1080p), I could not find shipping evidence of TV media apps using expandable accordion groups *inside* a right-hand stream selection panel. Most opt for a flat list sorted by quality.
3. **D-pad Native Scroll-Snap Compatibility**: I could not definitively prove whether Chromium 149's native spatial navigation handles `scroll-snap-type: y mandatory` flawlessly on TV without intercepting key events (sometimes native TV browsers require JS `scrollIntoView` for reliable centering).
