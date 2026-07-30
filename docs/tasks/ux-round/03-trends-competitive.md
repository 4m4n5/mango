# 03 — Competitive teardown & visual-design trends (2026)

Research date: **2026-07-30**. Scope: inform a polishing round for a dark, poster-forward Raspberry Pi TV launcher. Pre-2024 material is labeled **[STALE]** where still cited for enduring patterns. Claims include source name, URL, and date.

---

## Part A — Competitive teardown (2025–2026)

### Netflix (TV app)

**Rails / shelves.** Horizontal carousels remain the grammar, but the 2024–2025 redesign makes each *focused* tile a large expanding block with synopsis, pills, and rich imagery — often only ~4 titles visible at once, with a peek of the next shelf below. Continue Watching and recommendation rows share the same expanding-card pattern for consistency. ([Matthijs Langendijk, Medium — “Breaking down the new Netflix TV UI,” 2025-07-21](https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee); [Netflix Help Center — TV experience update, accessed 2026-07-30](https://help.netflix.com/en/node/321880164349028))

**Hero / billboard.** First item / homepage billboard fills most of the viewport; carousel title below signals scroll. Pills (e.g. season status) sit on the hero. ([Langendijk, 2025-07-21](https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee); [Netflix Tudum — “Netflix's New Layout,” May 2025 rollout](https://www.netflix.com/tudum/articles/netflix-new-tv-layout))

**Focus.** Expansion + lift of the focused card (not a thin border alone); unfocused tiles shrink in visual importance. Metadata appears *on focus* without opening detail. ([Langendijk, 2025-07-21](https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee); [MacRumors — redesigned interface on Apple TV, 2025-08-13](https://www.macrumors.com/2025/08/13/netflix-rolls-out-redesigned-interface-apple-tv/))

**Metadata density & badges.** Inline pills for “New Season,” awards, Top 10, cast snippets; title art often baked into posters so chrome titles are optional. Web A/B tests mirrored TV badges (“Recently Added,” “Highly Rewatched”) at tile bottoms. ([Tudum, May 2025](https://www.netflix.com/tudum/articles/netflix-new-tv-layout); [What's on Netflix — website redesign testing, 2025](https://www.whats-on-netflix.com/news/netflix-website-redesign-testing/))

**Typography / colour / background.** Big/bold, cinematic; muted dark chrome so artwork dominates. Dominant-colour / gradient responses to focused title appear in web refresh tests echoing TV. ([What's on Netflix, 2025](https://www.whats-on-netflix.com/news/netflix-website-redesign-testing/); [Langendijk, 2025-07-21](https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee))

**Motion.** Smooth expand/collapse between tiles; Back jumps to top menu (shortcut for deep scroll). ([Langendijk, 2025-07-21](https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee); [Netflix Help, accessed 2026-07-30](https://help.netflix.com/en/node/321880164349028))

**Detail / episodes / resume.** My Netflix hubs Continue Watching + My List; player keeps Skip Intro / next-episode; episode list still often via player or details rather than dense on-home pickers. Progress is red-on-grey on the player scrubber (desktop pattern documented; TV player continuity noted in reviews). ([Netflix Help](https://help.netflix.com/en/node/321880164349028); [The Streamable — Netflix UI review, accessed 2026-07-30](https://thestreamable.com/netflix-user-interface-review); [UX Planet — Netflix design patterns, desktop/player — treat TV player chrome as related, date on page](https://uxplanet.org/next-episode-the-design-patterns-and-flows-of-netflix-592b63741f89) — **verify freshness for TV-specific chrome**)

**Premium vs mediocre.** Premium: *one* focused story fills the room; pills replace cluttered always-on labels; unified card language across movies/games. Mediocre: dense static grids with no focus expansion and metadata only after click.

---

### Disney+

**Rails.** Poster-forward content rows; dynamic **brand row** (Disney, Pixar, Marvel, Star Wars, Nat Geo + Hulu/FX/ESPN/ABC). Hero carousel with video/character-forward display. ([Disney+ Explore — app redesign, revised 2026-01-09](https://www.disneyplus.com/explore/articles/disney-plus-app-redesign-new-features))

**Hero.** Video display in hero puts characters/stories front and center. ([Disney+, 2026-01-09](https://www.disneyplus.com/explore/articles/disney-plus-app-redesign-new-features))

**Focus / badges.** Cinematic poster artwork; badges for “Season Finales,” “New Series,” “New Movies.” ([Disney+, 2026-01-09](https://www.disneyplus.com/explore/articles/disney-plus-app-redesign-new-features))

**Nav.** Top tabs: For You / Disney+ / Hulu / ESPN (+ Live hub lightning bolt). Profiles made more prominent for personalization. ([Disney+, 2026-01-09](https://www.disneyplus.com/explore/articles/disney-plus-app-redesign-new-features); [Yahoo Tech / Disney Plus redesign summary, 2025–2026](https://tech.yahoo.com/streaming/articles/disney-plus-gets-major-redesign-173915704.html))

**Premium signal.** Brand as navigation + clear “what’s new” badges on posters; multi-catalog without visual chaos.

---

### Apple TV app / tvOS home (tvOS 26, 2025–2026)

**Material system.** **Liquid Glass** — translucent, refracting UI chrome for controls, Top Shelf, Control Center; keeps *playing content* visible behind overlays. Available Apple TV 4K 2nd gen+. ([Apple Newsroom — Apple TV redesign / tvOS 26, 2025-06](https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/); [Apple — Liquid Glass software design, 2025-06](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/); [Adopting Liquid Glass — Apple Developer Docs, accessed 2026-07-30](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass))

**Hero / posters.** Apple TV app redesigned around **cinematic poster art** + Liquid Glass so more titles show and discovery feels gallery-like. ([Apple Newsroom, 2025-06](https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/))

**Focus.** System buttons/controls take Liquid Glass on focus; classic tvOS language remains scale ~1.1× + shadow lift + optional parallax on artwork; blur snaps back instantly (one focus only). ([Apple Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass); [VP0 Journal — focus engine animation, 2026](https://vp0.com/blogs/apple-tv-focus-engine-animation-react-native); Materials HIG notes Liquid Glass on focus for image views/buttons — [Materials HIG mirror, updated 2025-09-09](https://apple-docs.everest.mt/docs/design/human-interface-guidelines/materials/))

**Background / depth.** Glass over video; standard materials (ultrathin→thick) still for content-layer structure on TV. ([Materials HIG, 2025](https://apple-docs.everest.mt/docs/design/human-interface-guidelines/materials/))

**Premium signal.** Chromeless content focus; glass only on *controls*; posters as primary identity; system-consistent focus physics.

---

### Google TV / Android TV Material

**Home (2025 redesign).** Nav simplified to Home / Live / Apps; Watchlist & Library under profile menu with large headers + horizontal content lists. ([9to5Google — homescreen redesign gallery, 2025-11-13](https://9to5google.com/2025/11/13/google-tv-homescreen-redesign-2025/); [9to5Google — official rollout, 2025-09-24](https://9to5google.com/2025/09/24/google-tv-homescreen-redesign-official-rolling-out-to-more-users/))

**Focus system (platform).** Indicators: **scale** (defaults **1.025 / 1.05 / 1.1×**), **border**, **glow/shadow** (glow elevation **2dp–32dp**), **colour** shifts; surface tonal elevation +1…+5; exactly one focused element. ([Android Developers — Focus system, last updated 2024-03-21](https://developer.android.com/design/ui/tv/guides/styles/focus-system) — still current guidance as of research date)

**Immersive list / hero pattern.** Row + large preview viewport; on focus: card **scale 1.1**, border, elevation; background art updates; **cinematic scrim**; subject aligned **top-right**; backgrounds **16:9**; progressive disclosure of title/description as list gains height. ([Android Developers — Immersive list, last updated 2024-08-19](https://developer.android.com/design/ui/tv/guides/components/immersive-list))

**Premium signal.** Spec’d multi-cue focus (scale+border+glow) and immersive background tied to focus — not a single thin outline.

---

### Amazon Prime Video

**Rails / nav.** Destinations: Home, Movies, TV Shows, Sports, Live TV; unified carousels for add-ons; **Prime** section clarifies entitlement. ([TheWrap — Kam Keshmiri interview on Prime Video UI, post–July first look / global rollout](https://www.thewrap.com/prime-video-app-update-amazon-kam-keshmiri-interview/))

**Hero / artwork.** Improved artwork quality emphasized as storytelling; promotional area for major releases retained in roadmap reporting. ([TheWrap](https://www.thewrap.com/prime-video-app-update-amazon-kam-keshmiri-interview/); [FTVDB — Lighthouse AI redesign reporting, 2026-07-28](https://ftvdb.com/blog/2026-07-28-amazon-prime-video-lighthouse-ai-redesign/) — *roadmap, not shipping UI*)

**Badges / resume / play.** Blue checkmark / “included with Prime” cues; **one-click play** when entitled; shopping bag for rentals. Search ≤2 clicks. ([TheWrap](https://www.thewrap.com/prime-video-app-update-amazon-kam-keshmiri-interview/))

**Poster aspect.** Industry commentary pairs Prime with **16:9** card rows more than Netflix-style 2:3. ([Smashing Magazine — Designing for TV Part 2, 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/))

**Premium signal.** Entitlement clarity + immediate play; mediocre catalogs bury “can I watch this?” behind detail pages.

---

### Max (HBO Max)

**Nav (Google TV 2025–2026).** Top menu replaced by **left rail**: Home, Search, Movies, Series, HBO, My Stuff — better D-pad vertical jump than horizontal tab scrubbing. ([TechYorker — Max Google TV redesign, 2025–2026](https://techyorker.com/max-streaming-service-ditches-top-menu-in-google-tv-redesign/))

**Premium signal.** Navigation aligned to remote geometry (vertical rail), reclaiming horizontal space for shelves.

---

### Plex

**Modern layout (pattern still industry-influential).** Artwork-first; **inline metadata** on focus (genres, ratings, synopsis); **dominant-colour extraction** from posters for adaptive backgrounds; optional Classic layout with titles under posters. Settings personalize density. ([Plex Blog — Modern Layout, **2021-08-19 — STALE launch date**, pattern still cited](https://www.plex.tv/blog/choose-your-own-adventure-introducing-modern-layout/); [Luis Herrero — Plex TV case study, accessed 2026-07-30](https://luisherrero.es/plex/))

**2025–2026 caveat.** Community pushback on forced title graphics / nested menus; cohesion still contested on some platforms. ([Plex Forums — UI threads, 2025–2026](https://forums.plex.tv/t/new-ui-is-terrible-stop-forced-title-graphics-less-nested-menus-role-this-back/931757))

**Premium when it works.** UI frames the art; colour bleeds from poster; metadata appears without a click. Mediocre: competing chrome, forced logos, unclear hierarchy.

---

### Infuse (Firecore)

**Visual system.** Infuse **8.2.5** (2025-09) adopts **Liquid Glass** on iOS/tvOS 26 for system cohesion; glass limited to supported Apple TV 4K gens. ([Firecore community — Infuse 8.2.5, 2025-09-18](https://community.firecore.com/t/infuse-8-2-5-now-available/57408))

**Library UX.** Users praise clean, predictable library browsing vs algorithm homes; critique includes landscape-only Up Next, duplicate clearlogo+title, desire for episode stills. ([Firecore — redesign discussion thread, accessed 2026-07-30](https://community.firecore.com/t/any-plans-for-a-re-design-to-the-infuse-tvos-ui/58990))

**Premium signal.** Platform-native materials + library clarity; not Netflix-clone suggestion walls.

---

### Jellyfin (Android TV & community clients)

**Official ATV.** Moving Next Up / cards toward Compose; **ProgressButton** with 0–1 progress fill; badge contrast improvements on posters (unread counts, etc.). ([jellyfin-androidtv PR #4531, merged 2025-03](https://github.com/jellyfin/jellyfin-androidtv/pull/4531); [Issue #5194 badge contrast, 2025–2026](https://github.com/jellyfin/jellyfin-androidtv/issues/5194))

**Community “premium” forks.** Vertical cards, glassmorphic layers, large focus previews / backdrops — explicitly copying commercial streaming grammar. ([ShivPatel123/jellyfin-androidtv fork README, accessed 2026-07-30](https://github.com/ShivPatel123/jellyfin-androidtv))

**Continue Watching.** Server may show every partial episode (clutter); plugins dedupe per series. ([jellyfin-plugin-dedupe-continue-watching, accessed 2026-07-30](https://github.com/SloMR/jellyfin-plugin-dedupe-continue-watching))

**Premium gap.** Stock often functional but badge contrast / density lag Netflix/Plex Modern; forks prove the visual delta is focus preview + poster verticality + glass layering.

---

### Kodi — Estuary vs Arctic Horizon / Fuse

**Estuary (default).** Functional shelves; less “cinematic immersive” than modern streamers — baseline mediocre for world-class polish. ([TroyPoint — Best Kodi skins 2026](https://troypoint.com/best-kodi-skins/))

**Arctic Horizon 2 / Fuse.** Minimal, widget-driven, large posters; fanart backgrounds; poster ratios aimed ~**1:1.43–1:1.5** (Fanart.TV / TVDb / TMDb variance). Horizon 2 deprecated → **Arctic Fuse** successor; AH2.1 fork for low-power. ([Kodi forum — Arctic Horizon 2 poster ratios, 2023 thread — **STALE thread**, ratios still cited](https://forum.kodi.tv/showthread.php?pid=3115583&tid=367352); [TroyPoint 2026](https://troypoint.com/best-kodi-skins/); [DeFiNiek/ah2.1, created 2025-08](https://github.com/DeFiNiek/ah2.1))

**Premium signal.** Full-bleed fanart + big posters + sparse chrome; mediocre Estuary-like UIs leave empty negative space unused and over-label every tile.

---

### Emby

Useful as “Plex-class media server” peer: generally poster grids + detail pages + progress on resume rows, but fewer 2025–2026 public design teardowns than Plex/Infuse. Treat as **parity target with Plex Modern** (artwork + progress + quality badges) rather than a trend leader. (No strong primary design post found in this research window; infer from category norms in [Smashing Magazine, 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/).)

---

### What premium UIs do that mediocre ones don’t

1. **Focus is cinematic** — scale ≥~1.1, lift/glow, *and* ambient background/scrim tied to the focused title (Netflix expand, Android Immersive List, Plex colour extraction, Apple glass over content).
2. **Metadata on focus, not always-on** — synopsis/genres/pills appear when focused; posters carry titles.
3. **One visual language** across rails (same card physics everywhere).
4. **Entitlement / quality / newness badges** are sparse, high-contrast, and decision-critical (Prime checkmarks, Disney “New…”, Netflix pills).
5. **Nav matches the remote** — Back-to-menu, left rail, or always-reachable top nav — no lost focus.
6. **Motion is short and singular** — only the focused item animates; blur is instant.

Mediocre UIs: thin focus rings, static identical tiles, metadata under every poster, pure-black flat panels with no elevation, hover/desktop metaphors, and competing simultaneous highlights.

---

### Comparison table — focus treatments

| Product / system | Primary focus cues | Typical scale | Ambient / background | Extra |
|------------------|-------------------|---------------|----------------------|--------|
| Netflix TV (2025) | Expand card + rich metadata | Large expand (few tiles on-screen) | Focused art dominates frame | Pills on focus |
| tvOS / Apple TV app | Liquid Glass on controls; scale+shadow+parallax on posters | ~**1.1×** (convention) | Glass over video; Aerials | Instant blur snap-back |
| Android / Google TV Material | Scale + border + glow + colour | **1.025 / 1.05 / 1.1×** | Immersive 16:9 + scrim | Glow **2–32dp** |
| Disney+ | Poster emphasis + badges | Platform-default | Hero video carousel | Brand row |
| Prime Video | Card focus + entitlement cues | Platform-default | Promo hero | Blue check / one-click play |
| Max (GTV) | Platform focus + left-rail nav | Platform-default | Standard shelves | Rail reduces tab travel |
| Plex Modern | Focus + inline meta | Platform | **Dominant-colour** backdrop | Layout presets |
| Infuse | System Liquid Glass + clean library focus | System | Native tvOS | Library-first |
| Jellyfin ATV | Border/scale evolving; badge work | Varies | Forks add backdrop preview | ProgressButton |
| Kodi Arctic / Fuse | Large poster selection | Skin-dependent | Fanart bleed | Sparse chrome |
| Estuary / mediocre | Often thin highlight | Low | Flat dark | Dense labels |

Sources for numeric rows: [Android Focus system, 2024-03-21](https://developer.android.com/design/ui/tv/guides/styles/focus-system); [Android Immersive list, 2024-08-19](https://developer.android.com/design/ui/tv/guides/components/immersive-list); [VP0 focus animation, 2026](https://vp0.com/blogs/apple-tv-focus-engine-animation-react-native); [Langendijk, 2025-07-21](https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee); [Plex / Herrero](https://luisherrero.es/plex/).

---

## Part B — Visual-design trends for dark, poster-forward 10-foot UI (2026)

### Glassmorphism / translucency on TV

**State of the art.** Evolved from heavy 2021 blur to **subtle** translucent layers; Apple **Liquid Glass** (2025) is the reference — refraction on *chrome*, content stays primary; Reduce Transparency remains an a11y escape hatch. ([Midrocket — UI trends 2026, 2026-03-12](https://midrocket.com/en/guides/ui-design-trends-2026/); [Apple Newsroom, 2025-06](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/); [iDownloadBlog — minimize Liquid Glass, 2025-06-13](https://www.idownloadblog.com/2025/06/13/disable-liquid-glass-apple-devices/))

**Verdict: ADAPT** — Use translucency for nav/HUD overlays over artwork or video; avoid full-UI frosted mush on Pi GPU. Prefer solid near-black panels if blur is expensive.

---

### Depth & elevation in dark UI

**Trend.** Dark mode uses **lighter surfaces** for elevation (tonal overlays), not drop-shadows alone; Android TV documents glow 2–32dp + tonal +1…+5. ([Android Focus system, 2024-03-21](https://developer.android.com/design/ui/tv/guides/styles/focus-system); [Midrocket, 2026-03-12](https://midrocket.com/en/guides/ui-design-trends-2026/); [DesignDroid — pure black vs grey, 2026 guide](https://designdroid.in/android-dark-mode-background/))

**Verdict: ADOPT** — Near-black base + elevated focused card (scale + glow + slightly lighter surface).

---

### Gradients & mesh

**Trend.** Soft brand-tinted gradients / mesh as atmosphere; Smashing advises **muted** palettes, avoid pure `#ffffff` blast in dark rooms. Artwork-driven gradients (Plex) beat decorative purple meshes. ([Smashing Magazine, 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/); [Plex Modern / Herrero](https://luisherrero.es/plex/))

**Verdict: ADAPT** — Scrims and dominant-colour washes behind focused art; avoid loud mesh gradients that fight posters.

---

### Variable fonts & optical sizing at large scale

**Trend.** Variable fonts + `opsz` for Display vs Text; kinetic type in heroes on web. TV needs **larger baseline** (~24px start) and short 5–6 step scales. ([Midrocket, 2026-03-12](https://midrocket.com/en/guides/ui-design-trends-2026/); [Kittl — variable fonts 2026](https://www.kittl.com/blogs/why-variable-fonts-are-winning-fnt/); [Smashing Magazine, 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/))

**Verdict: ADAPT** — Prefer a display-capable face / optical sizing for rail titles; avoid ultra-thin weights and kinetic type that distracts from posters.

---

### True black vs near-black (OLED)

**Trend.** Media UIs often use true black for cinema; complex UI needs near-black (`#121212` / `#1C1B1F` / `#1a1a1a`) for elevation and to reduce smearing/halation. Sub-black priming (`#010101`) discussed for scroll smear. Living-room TV: Smashing prefers muted dark over pure white text glare. ([DesignDroid OLED palettes 2026](https://designdroid.in/oled-dark-mode-color-palettes-android-2026/); [NateBal — OLED dark mode](https://natebal.com/oled-optimized-dark-mode-aeo-efficiency/); [News Loom — OLED interfaces 2026](https://newsloom.odoo.com/blog/our-blog-1/designing-dynamic-high-contrast-oled-interfaces-in-2026-4); [Smashing Magazine, 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/))

**Verdict: ADAPT** — True black *behind* posters/video; near-black for chrome/surfaces; off-white (not `#fff`) for body text.

---

### Motion design (spring vs ease, stagger, shared element)

**Trend.** Focus springs ~**1.1×** (damping ~18 gain / ~22 loss examples); focus cue **&lt;~100ms**; transitions **&lt;~200ms**; stagger ok for first paint, not per D-pad step; shared-element detail opens are premium when performant. ([VP0, 2026](https://vp0.com/blogs/apple-tv-focus-engine-animation-react-native); [Callstack — design-10foot.md](https://github.com/callstackincubator/agent-skills/blob/main/skills/react-native-tv-best-practices/references/design-10foot.md); [Motion Components — motion-font springs, accessed 2026-07-30](https://www.motion-components.dev/docs/text/motion-font/))

**Verdict: ADOPT** — Spring focus scale + instant unfocus; **AVOID** long staggered cascades on every focus move.

---

### Colour systems from artwork

**Trend.** Dominant-colour extraction for immersive backdrops (Plex); Netflix personalized artwork selection/generation research in 2026. ([Herrero / Plex](https://luisherrero.es/plex/); [Medium — Netflix homepage artwork engine summary, 2026](https://medium.com/@swsthik.nair/how-netflix-built-an-engine-to-design-your-homepage-e177e521962a))

**Verdict: ADOPT** — Soft backdrop tint + gradient scrim from focused poster (cached, throttled on Pi).

---

### Accessibility-driven design

**Trend.** Reduce Transparency / Increase Contrast for glass; high-contrast focus mandatory; badge contrast fixes (Jellyfin); WCAG-minded dark contrast; couch testing from 3m. ([iDownloadBlog, 2025-06-13](https://www.idownloadblog.com/2025/06/13/disable-liquid-glass-apple-devices/); [Jellyfin #5194](https://github.com/jellyfin/jellyfin-androidtv/issues/5194); [Callstack 10-foot](https://github.com/callstackincubator/agent-skills/blob/main/skills/react-native-tv-best-practices/references/design-10foot.md); [Smashing Magazine, 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/))

**Verdict: ADOPT** — Focus contrast, large type, solid fallbacks for glass, badge AA contrast.

---

### Trends that are WRONG for TV (explicit AVOID)

| Pattern | Why wrong on TV |
|---------|-----------------|
| Hover-only reveals | No pointer; metadata must appear on **focus** ([Android Focus](https://developer.android.com/design/ui/tv/guides/styles/focus-system)) |
| Small tap targets / dense chips | D-pad + 3m distance; missable hits ([Smashing 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/); [Callstack](https://github.com/callstackincubator/agent-skills/blob/main/skills/react-native-tv-best-practices/references/design-10foot.md)) |
| Ultra-thin type / hairline icons | Vanish at 10 feet; Smashing: when in doubt go larger |
| Mouse-centric cursors / drag | Remote has no cursor ([VP0](https://vp0.com/blogs/apple-tv-focus-engine-animation-react-native)) |
| Pure white `#ffffff` full-screen UI | Blinding in dark rooms ([Smashing 2025-09](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/)) |
| Bento / dashboard clutter on home | Competes with posters; home should be shelves + one hero ([Smashing shelves](https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/)) |
| Decorative long motion / blocking animations | Must keep focus feedback &lt;100ms / &lt;200ms ([Callstack](https://github.com/callstackincubator/agent-skills/blob/main/skills/react-native-tv-best-practices/references/design-10foot.md)) |
| Always-on dense metadata under every poster | Premium UIs move meta to focus/inline (Netflix, Plex Modern) |

---

## Ten patterns worth stealing

1. **Focus scale 1.1× + shadow/glow lift** with **instant** unfocus snap-back (Android default **1.1**; tvOS canon).  
2. **Immersive focus backdrop**: 16:9 art, subject **top-right**, cinematic scrim, metadata progressive-disclosed.  
3. **Expanding focus card** (Netflix): synopsis + 1–2 pills on focus so play is one select away.  
4. **Dominant-colour ambient wash** from the focused poster (Plex Modern).  
5. **Poster-first rails** at **2:3** for movies/shows; peek the next tile past the margin (Smashing).  
6. **Decision badges only**: New / Finale / 4K / HDR / resume — high contrast, not decorative clutter (Disney+, Prime checkmarks).  
7. **Continue Watching**: landscape thumb + **progress bar** on the card; one row entry per series when possible.  
8. **Back-to-nav shortcut** so deep shelf scroll never traps the user (Netflix Back → top menu).  
9. **Glass/translucency only on HUD/chrome** over content — never frost the posters themselves (Liquid Glass principle).  
10. **Type floor ~24px**, short scale, display optical sizing for titles; never thin-weight body at 10 feet (Smashing).

---

## Source log (fully read for this brief)

| # | Source | URL | Date |
|---|--------|-----|------|
| 1 | Langendijk — Netflix TV UI teardown | https://mlangendijk.medium.com/breaking-down-the-new-netflix-tv-ui-d651aff8bbee | 2025-07-21 |
| 2 | Apple Newsroom — Apple TV / tvOS 26 | https://www.apple.com/newsroom/2025/06/apple-tv-brings-a-beautiful-redesign-and-enhanced-home-entertainment-experience/ | 2025-06 |
| 3 | Disney+ — App redesign | https://www.disneyplus.com/explore/articles/disney-plus-app-redesign-new-features | Revised 2026-01-09 |
| 4 | Smashing Magazine — Designing for TV Part 2 | https://www.smashingmagazine.com/2025/09/designing-tv-principles-patterns-practical-guidance/ | 2025-09 |
| 5 | Midrocket — UI Design Trends 2026 | https://midrocket.com/en/guides/ui-design-trends-2026/ | 2026-03-12 |
| 6 | TheWrap — Prime Video UI interview | https://www.thewrap.com/prime-video-app-update-amazon-kam-keshmiri-interview/ | ~2024–2025 rollout (page accessed 2026-07-30) |
| 7 | 9to5Google — Google TV homescreen | https://9to5google.com/2025/11/13/google-tv-homescreen-redesign-2025/ | 2025-11-13 |
| 8 | Netflix Tudum — New TV layout | https://www.netflix.com/tudum/articles/netflix-new-tv-layout | May 2025 |
| 9 | Netflix Help — TV experience | https://help.netflix.com/en/node/321880164349028 | Accessed 2026-07-30 |
| 10 | Firecore — Infuse 8.2.5 | https://community.firecore.com/t/infuse-8-2-5-now-available/57408 | 2025-09-18 |
| 11 | VP0 — tvOS focus animation | https://vp0.com/blogs/apple-tv-focus-engine-animation-react-native | 2026 |
| 12 | Plex Blog — Modern Layout | https://www.plex.tv/blog/choose-your-own-adventure-introducing-modern-layout/ | **2021-08-19 [STALE]** |
| 13 | Luis Herrero — Plex case study | https://luisherrero.es/plex/ | Accessed 2026-07-30 |
| 14 | Android — Focus system | https://developer.android.com/design/ui/tv/guides/styles/focus-system | Updated 2024-03-21 |
| 15 | Android — Immersive list | https://developer.android.com/design/ui/tv/guides/components/immersive-list | Updated 2024-08-19 |
| 16 | TechYorker — Max GTV redesign | https://techyorker.com/max-streaming-service-ditches-top-menu-in-google-tv-redesign/ | 2025–2026 |
| 17 | Apple — Liquid Glass announcement | https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/ | 2025-06 |

Additional supporting reads (snippets / secondary): What's on Netflix web redesign; MacRumors Netflix Apple TV; Callstack design-10foot; DesignDroid / NateBal OLED dark mode; Jellyfin PRs; Kodi Arctic threads; FTVDB Lighthouse (roadmap).
