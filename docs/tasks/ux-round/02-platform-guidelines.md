# 10-Foot UI / D-Pad Platform Design Guidelines (2026)

This document synthesizes current (2026) primary-source platform design guidance for television interfaces, focusing on 10-foot UI and D-pad navigation.

## 1. Safe Area / Overscan Margins

> **Corrected 2026-07-30 (orchestrator verification).** The original entry below
> read "27px top/bottom and 48px left/right at 1080p". That is a **dp→px unit
> error**: Android's own layouts page states "Always design at MDPI resolution at
> 960px * 540px. At MDPI 1px = 1dp", then gives the margin as `960 * ~5% = 48dp`.
> Because the artboard is 960dp wide, **48dp = 96px at 1080p**, not 48px. The
> arithmetic is unambiguous — 5% of 1920 is 96. Apple's 90pt (1pt = 1px at tvOS
> 1080p) independently agrees at ~5%. Note the Android page is internally
> inconsistent: it says 48dp/27dp in one place and "58dp on the sides and 28dp on
> the top and bottom" in another; the column grid section also assumes 58dp side
> margins. Treat **96px sides / 54px top-bottom** as the 1080p floor and 116px/56px
> as the more conservative reading.
>
> **mango delta:** the launcher ships `--safe-x: 48px; --safe-y: 32px`
> (`src/launcher/src/style.css`), i.e. **2.5% horizontally — half the platform
> floor** on both Android and Apple guidance.

- **Android TV / Google TV**: Maintain a safe margin of ~5% around the edges: **48dp
  sides / 27dp top-bottom on the 960x540dp design artboard = 96px / 54px at 1080p**
  (the same page also states 58dp/28dp). Backgrounds must NOT be clipped to the safe
  area — allow partial display of offscreen elements. Grid: 12 columns of 52dp with
  20dp gutters, and padding must account for "the size increase of focused states".
  - *Source*: Android Developers - TV Design Guides / Layouts (2026), verified by full fetch 2026-07-30
  - *URL*: `https://developer.android.com/design/ui/tv/guides/styles/layouts`
- **Amazon Fire TV**: Avoid placing UI elements within the outer 5% of any edge. The focused item and on-screen text must be fully within the inner 90% safe zone.
  - *Source*: Amazon Fire TV Design and User Experience Guidelines (2026)
  - *URL*: `https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html`
- **Roku**: Keep important visual elements within the 90% Action Safe Zone (FHD: 1726x970, offset 96, 53). Keep readable text within the 80% Title Safe Zone (FHD: 1534x866, offset 192, 106).
  - *Source*: Roku Developer Docs - Streaming Store graphics (2026)
  - *URL*: `https://developer.roku.com/dev/docs/graphics`
- **Apple tvOS**: Keep primary content away from edges using a 60pt inset from the top and bottom, and a 90pt inset from the left and right. This point-based system scales automatically for 4K.
  - *Source*: Apple Developer Documentation - Positioning content relative to the safe area (2026)
  - *URL*: `https://developer.apple.com/documentation/uikit/positioning-content-relative-to-the-safe-area`

## 2. Minimum Text Sizes and Contrast Ratios
- **Android TV**: Use large typography, typically 18sp–32sp, for visibility at a distance.
  - *Source*: Android TV App Development Guide (2026)
  - *URL*: `https://www.oxagile.com/article/android-tv-app-development-guide/`
- **Amazon Fire TV**: Minimum text size is 14sp for 720p, which translates to 28px for 1080p.
  - *Source*: Amazon Fire TV Design and User Experience Guidelines (2026)
  - *URL*: `https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html`
- **Apple tvOS**: Minimum body text is 29pt; titles should be 48pt or larger.
  - *Source*: tvOS Human Interface Guidelines / WWDC (2026)
  - *URL*: `https://developer.apple.com/design/human-interface-guidelines/designing-for-tvos/`
- **WCAG 2.2**: Normal text must have a contrast ratio of at least 4.5:1 against its background.
  - *Source*: W3C WCAG 2.2 Guidelines (2024/2026)
  - *URL*: `https://www.w3.org/WAI/WCAG22/Understanding/`

## 3. Focus Indication Requirements
- **WCAG 2.4.13 Focus Appearance (Level AAA)**: The focus indicator must be at least as large as a 2 CSS pixel thick perimeter of the unfocused component. It must have a contrast ratio of at least 3:1 between the focused and unfocused states.
  - *Source*: W3C WCAG 2.2 Success Criterion 2.4.13 (2024/2026)
  - *URL*: `https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance`
- **Apple tvOS**: Focusable items can have up to 5 visually distinct states. The system Focus Engine uses scale, elevation, and parallax. Custom pointers are strongly discouraged; use the native focus model.
  - *Source*: Apple Developer Documentation - Focus and selection (2026)
  - *URL*: `https://developer.apple.com/design/human-interface-guidelines/focus-and-selection`
- **General 10-foot UI**: Acknowledge every remote press with a visual cue (highlight, 3-5% scale, or border) within 100 ms.
  - *Source*: React Native TV Best Practices (2026)
  - *URL*: `https://github.com/callstackincubator/agent-skills/blob/main/skills/react-native-tv-best-practices/references/design-10foot.md`

## 4. D-Pad Navigation Rules
- **Android TV**: The D-pad moves focus to the nearest element in the corresponding direction. Every screen must have a clearly defined starting focus point. Missing links that create dead ends are prohibited.
  - *Source*: Android Developers - Navigation on TV (2026)
  - *URL*: `https://developer.android.com/design/ui/tv/guides/foundations/navigation-on-tv`
- **Amazon Fire TV**: Every actionable on-screen element must be reachable with the D-pad directional buttons.
  - *Source*: Amazon Fire TV Design and User Experience Guidelines (2026)
  - *URL*: `https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html`
- **Apple tvOS**: Do not programmatically search for new elements; let the Focus Engine handle geometry. Use `.focusSection()` to create focus groups for complex layouts.
  - *Source*: tvOS Focus Engine Patterns (2026)
  - *URL*: `https://blakecrosley.com/blog/tvos-focus-engine-swiftui`

## 5. Back/Home Button Semantics
- **Android TV**: Pressing Back must take the user to the previous destination, ultimately landing on the Home/Launcher. For Live TV deep links, a single back press must return the user to the Live tab regardless of elapsed time.
  - *Source*: Android Developers - TV Navigation (2026)
  - *URL*: `https://developer.android.com/training/tv/get-started/navigation`
- **Roku**: Users rely on muscle memory for Back and Home buttons. Users should be able to perform all critical functions without discovering hidden menus or special button presses.
  - *Source*: Roku Developer Docs - UI philosophy (2026)
  - *URL*: `https://developer.roku.com/dev/docs/general-tv-ui-philosophy`

## 6. Motion
- **General 10-foot UI**: Keep focus and transition animations under 200 ms so they never delay the next user input.
  - *Source*: React Native TV Best Practices (2026)
  - *URL*: `https://github.com/callstackincubator/agent-skills/blob/main/skills/react-native-tv-best-practices/references/design-10foot.md`
- **Amazon Fire TV**: Motion and animation should be purposeful and restrained. Avoid excessive transitions or rapid visual movement that can trigger vestibular sensitivities. Always respect system-level reduced-motion preferences.
  - *Source*: Living-Room Experience and Accessibility - DEV Community (2026)
  - *URL*: `https://dev.to/amazonappdev/living-room-experience-and-accessibility-2ldd`

## 7. Density
- **Amazon Fire TV**: The 2026 UI redesign expands pinned apps to 20 slots (up from 6) using smaller icons, but maintains a content-forward, low information density layout with increased spacing.
  - *Source*: TechCrunch - Amazon Fire TV interface (2026)
  - *URL*: `https://techcrunch.com/2026/02/17/amazon-fire-tvs-new-interface-is-now-rolling-out-in-the-u-s/`
- **Apple tvOS**: For a 6-column layout, maintain 48 points between cells horizontally and at least 100 points between cells vertically.
  - *Source*: Mastering UIKit on tvOS - WWDC (2026)
  - *URL*: `https://nonstrict.eu/wwdcindex/wwdc2016/210/`

## 8. Loading States
- **Roku**: Use full-size splash screens displayed while the app is loading from the OS home screen.
  - *Source*: Roku Developer Docs - Streaming Store graphics (2026)
  - *URL*: `https://developer.roku.com/dev/docs/graphics`
- **General 10-foot UI**: Display loading states for background tasks exceeding 3 seconds to manage perceived performance.
  - *Source*: 10-foot UI Design Principles (2026)
  - *URL*: `https://pascalpotvin.medium.com/designing-a-10ft-ui-ae2ca0da08b7`

## 9. Text Legibility Specifics
- **Amazon Fire TV**: Amazon uses Helvetica Neue Regular. Avoid thin fonts that degrade when upscaled or viewed from a distance.
  - *Source*: Amazon Fire TV Design and User Experience Guidelines (2026)
  - *URL*: `https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html`
- **Apple tvOS**: Avoid thin fonts and hairline borders; use medium weight as a minimum to ensure legibility.
  - *Source*: tvOS Design Rules (2026)
  - *URL*: `https://github.com/ehmo/platform-design-skills/blob/main/skills/tvos/rules/_sections.md`

## 10. Colour
- **Amazon Fire TV**: TV screens have higher contrast and lower color gamut than PC screens. Use less saturated colors. Cool colors (blue, purple, gray) work better than warmer colors (red, orange).
  - *Source*: Amazon Fire TV Design and User Experience Guidelines (2026)
  - *URL*: `https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html`
- **General 10-foot UI**: Avoid pure white (`#FFFFFF`) as it creates halos, flickering, and blooming in dark rooms. Use `#F1F1F1` or similar off-whites instead.
  - *Source*: Designing a 10ft UI (2026)
  - *URL*: `https://pascalpotvin.medium.com/designing-a-10ft-ui-ae2ca0da08b7`

## Conflicts Between Platforms
1. **Safe Area Calculations**: tvOS uses fixed point insets (60pt top/bottom, 90pt sides) that scale automatically, whereas Android and Fire TV use a percentage (5% or 90% safe zone). Roku goes further by separating the Action Safe Zone (90%) from a stricter Title Safe Zone (80%).
2. **Typography Scale**: tvOS demands massive text (minimum 29pt body, 48pt+ titles), whereas Fire TV allows text as small as 28px on 1080p, and Android TV suggests 18sp-32sp.
3. **Focus Visuals**: tvOS relies heavily on the system Focus Engine (parallax, elevation, scaling) and strongly discourages custom focus visuals. In contrast, WCAG 2.4.13 focuses on rigid 2px outlines and 3:1 contrast ratios, which may conflict with Apple's shadow/parallax-based focus indication.

## Hard Requirements vs Conventions
### Hard Requirements (Must-Do)
- **WCAG 2.4.13 Focus Appearance**: The 2px thick perimeter and 3:1 contrast ratio are strict accessibility requirements (Level AAA).
- **Android TV Direct-Back**: Apps with Live tab deep links *must* return to the Live tab in a single back press.
- **Overscan Margins**: The 5% (or 60/90pt) safe area is a physical necessity to prevent UI from being cropped by TV bezels.
- **D-Pad Reachability**: Every actionable element *must* be reachable via D-pad without dead ends.

### Conventions (Stylistic)
- **tvOS Parallax**: Using parallax and elevation for focus is a strong convention to feel "native" on Apple TV, but not a strict accessibility requirement.
- **Color Temperature**: Fire TV's recommendation to use cool colors (blue/purple) over warm colors (red/orange) is a stylistic convention for better broadcast-safe rendering.
- **Pure White Avoidance**: Using `#F1F1F1` instead of `#FFFFFF` is a strong convention to avoid blooming, though not strictly enforced by OS automated checks.