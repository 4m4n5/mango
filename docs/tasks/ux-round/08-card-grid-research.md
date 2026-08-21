# Card grid research — poster and 16:9 rows at 1920×1080

Primary-source research behind the rail density change in step 5 of
[`10-polish-plan.md`](10-polish-plan.md). Two independent passes: portrait 2:3
posters (Movies, TV Shows) and 16:9 landscape thumbnails (YouTube, Live). They
were run separately and, without coordination, landed on the same 40px gutter.

## What was applied

| | before | after | where |
|---|---|---|---|
| poster columns | 9 (174×261) | **5 (314×470)** | `RAIL_COLUMNS`, `src/launcher/src/layout.ts` |
| landscape columns | 6 (227×127) | **4 (402×226)** | `RAIL_COLUMNS_LANDSCAPE`, same file |
| gutter, both | 20px / 20px | **40px** | `--card-gap`, `src/launcher/src/style.css` |
| items rendered per rail | 9 / 12, wrapped to 2 rows | **one row, = column count** | `renderRails()`, `src/launcher/src/home.ts` |

Landscape cards also lost the `--focus-gutter` padding that inset the thumbnail
inside its own grid cell, which had left a 64px visible gap between 227px
thumbnails — 28% of thumbnail width, against the 10% the 40px gutter now gives.

Not applied: the 3-up "feature row" widths both passes describe (536px landscape,
402px poster). mango has no editorial hero row to spend them on yet.

## Conversion rules used by both passes

- Android TV / Fire TV describe a 1080p surface as 1920×1080px with a 960×540dp
  logical layout, so **1dp = 2px** at 1080p.
- tvOS HIG uses points at @1x for 1080p, so **1pt = 1px**.
- Numbers below are labelled either as documented platform guidance or as
  observation/inference from product screenshots. Treat app observations as
  current-product evidence, not fixed contracts — these UIs are A/B tested.

---

# Pass 1 — portrait 2:3 posters


Scope: portrait 2:3 movie/TV poster cards in 10-foot TV browsing UI. I did not revisit landscape 16:9 rail sizing. All pixel numbers are for a 1920x1080 output unless stated otherwise.

## Executive recommendation

For mango's Movies and TV Shows tabs, the practical portrait-poster answer is **5 posters per row** at 1080p, using **about 306-314px poster width**, **459-471px poster height**, and **40px horizontal gutters**. A 4-up poster row is excellent for featured/editorial rows at **392-402px wide**, but too tall for dense browsing. A 6-up row at **248-255px wide** is the lower-density platform-card floor, not a comfortable poster-art target at 3m. The current 9-up layout at **174x261px** is well below the practical TV threshold.

## Source anchors and conversions

### Android TV / Google TV documented guidance

Sources:

- Android TV Cards: https://developer.android.com/design/ui/tv/guides/components/cards
- Android TV Layouts: https://developer.android.com/design/ui/tv/guides/styles/layouts
- Android TV Compose catalog browser example: https://developer.android.com/training/tv/playback/compose/browse
- Legacy Android TV typography source: https://android.googlesource.com/platform/frameworks/base/+/0bfee5a4905a14a318731661214558792abc2f7d/docs/html/design/tv/style.jd

Documented platform guidance:

- Android TV designs at an MDPI artboard of **960x540dp**. At 1080p this means **1dp = 2px** and **1sp ~= 2px** at default font scale.
- Overscan-safe content margins are **48dp left/right = 96px** and about **24-27dp top/bottom = 48-54px**. The 12-column grid uses **58dp side margins = 116px** and **20dp gutters = 40px**.
- Android's card guidance lists card widths by visible-count layout:
  - **1-card layout:** 844dp = **1688px**
  - **2-card layout:** 412dp = **824px**
  - **3-card layout:** 268dp = **536px**
  - **4-card layout:** 196dp = **392px**
  - **5-card layout:** 124dp = **248px**
- Android documents **20dp card spacing = 40px** for peeking.
- Android documents 2:3 cards as useful when you want to "break up the grid and bring more emphasis"; its examples call out 16:9 for movie cards and 2:3 for taller emphasis cards, so the widths above are platform card widths, not a direct "movie poster grid" prescription.
- The modern Compose catalog browser example uses `LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp))`, which converts to **32px** between sections. Legacy Leanback defaults commonly used larger row padding; the practical TV row gap lands closer to **56-64px** once card focus/shadow space is included.
- Legacy Android TV type guidance lists **Card Titles 16sp = 32px**, **Card Subtext 12sp = 24px**, and row/category titles around **20sp = 40px**. Modern Android TV typography guidance is less numeric but emphasizes larger, glanceable TV type.

Important inference from the Android numbers:

- The **392px** 4-card width maps cleanly to a 2:3 poster of **392x588px**.
- The **248px** 5-card documented width maps to **248x372px**. This is likely a dense/peek card layout floor. It is below the poster-forward sizes used by tvOS Top Shelf and poster rows in major streaming apps.
- If mango keeps 96px safe side margins and uses 40px gutters, equal-width rows produce:
  - **4-up:** `(1920 - 2*96 - 3*40) / 4 = 402px`, poster **402x603px**
  - **5-up:** `(1920 - 2*96 - 4*40) / 5 = 313.6px`, poster **314x471px**
  - **6-up:** `(1920 - 2*96 - 5*40) / 6 = 254.7px`, poster **255x382px**
  - **7-up:** `(1920 - 2*96 - 6*40) / 7 = 212.6px`, poster **213x319px**
  - **9-up with mango's current 20px gap:** `(1920 - 2*96 - 8*20) / 9 = 174.2px`, poster **174x261px**

### Fire TV documented guidance

Sources:

- Fire TV Design and UX Guidelines: https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html
- Fire TV Display and Layout: https://developer.amazon.com/docs/fire-tv/display-and-layout.html

Documented platform guidance:

- Fire TV also treats 1080p as **1920x1080px** with an Android render density of **960x540dp**, so again **1dp = 2px**.
- Fire TV recommends a full 1080p design target and avoiding the outer **5%** of all edges for critical UI, i.e. about **96px** side safe margins.
- Fire TV's 10-foot UI principles explicitly call for **low information density**, simple visual choices, and elements "large enough and spaced far enough apart to be read from a distance."
- Fire TV typography says body text should be at least **14sp**, approximately **28px at 1080p**. Treat **28px** as a floor, not an ideal target.
- Fire TV describes home views as multiple horizontal content rows and 1D list views as a single row of items with a title bar and mini-details for the focused item. It does not publish a portrait-poster count.

### tvOS / Apple documented guidance

Sources:

- Apple HIG Top Shelf: https://developer.apple.com/design/human-interface-guidelines/top-shelf/
- Accessible text mirror of the HIG page used for exact Top Shelf numbers: https://apple-docs.everest.mt/docs/design/human-interface-guidelines/top-shelf/
- Apple HIG Typography: https://developer.apple.com/design/human-interface-guidelines/typography
- Apple TV partner artwork requirements: https://tvpartners.apple.com/support/3708-artwork-requirements and https://itunespartner.apple.com/tv-movies/support/5450-artwork-requirements

Documented platform guidance:

- tvOS Top Shelf sectioned content rows support a **Poster (2:3)** image shape.
- Apple documents Top Shelf poster sizes:
  - **Actual poster image:** **404x608pt**, documented as **404x608px @1x** and **808x1216px @2x**
  - **Focused/safe zone:** **380x570pt**, i.e. **380x570px @1x**
  - **Unfocused size:** **333x570pt**, i.e. **333x570px @1x**
- At a 1080p/@1x design target, this means Apple is comfortable with portrait poster art around **333-404px wide**.
- A row of 4 actual 404px posters is **1616px** before gutters; a row of 5 unfocused 333px posters is **1665px** before gutters. With TV-safe margins and spacing, tvOS poster guidance therefore implies roughly **4 large posters** or **5 unfocused posters** across, not 7-9.
- tvOS Top Shelf does **not** show persistent labels under content. Apple says if text is needed in that layout style, add it to the image and the accessibility label. The row/section can have labels, and a label can appear on focus, but the poster card itself is not a caption-under-card pattern.
- tvOS typography documents **tvOS default body size 29pt** and **minimum 23pt**. Built-in tvOS text styles include **Caption 1 = 25pt** and **Caption 2 = 23pt**. At @1x 1080p, that is **25px** and **23px** respectively.
- Apple TV partner artwork documentation has recently emphasized **16:9 cover art** for browsing in the Apple TV app, although current 2026 user reports and third-party artwork tools indicate Apple is also moving parts of Apple TV app artwork back toward **2:3 portrait** on some OS surfaces. Treat the Apple TV app itself as a moving target; treat tvOS Top Shelf poster sizing as the reliable poster-specific guidance.

## App observations and inferences

These apps do not publish exact poster-grid formulas, and many screenshots are product/press imagery or A/B-dependent. I label these as observations/inferences, not documented platform requirements.

### Netflix TV

Sources:

- Netflix official TV redesign article: https://www.netflix.com/tudum/articles/netflix-new-tv-layout
- The Verge on Netflix TV redesign: https://www.theverge.com/2024/6/6/24172351/netflix-redesign-homepage-experience-test
- Netflix 2013 TV redesign context: https://techcrunch.com/2013/11/12/netflix-new-tv-experience/ and https://www.theverge.com/2013/11/13/5098224/netflix-introduces-one-unified-tv-interface-to-rule-them-all

Observation/inference:

- Current Netflix TV UI is **not a stable 2:3 portrait poster grid**. Netflix's official 2025 TV redesign describes larger responsive recommendation cards with details up-front, and The Verge reports that static tiles expand on focus.
- Netflix moved away from portrait DVD-box-dominated TV UI as early as its 2013 living-room redesign, replacing old poster-style images with widescreen thumbnails for much of the TV home experience.
- Therefore I would not use current Netflix TV as evidence for 7-9 portrait posters per row. If using older/non-TV Netflix poster strips as weak secondary evidence, they tend to sit around **5-8 tiles**, but this is not authoritative for a 1080p TV launcher.
- Practical conclusion from Netflix: poster art should not carry excessive density; the modern direction is fewer/larger, more informative focused cards.

### Prime Video TV

Sources:

- Amazon official Prime Video redesign: https://www.aboutamazon.com/news/entertainment/prime-video-makes-it-easier-to-find-your-favorite-content
- Amazon official updated look: https://www.aboutamazon.com/news/entertainment/prime-video-updated-steaming-experience
- Secondary screenshot/writeups: https://www.androidpolice.com/amazon-prime-video-visual-redesign/ and https://www.thewrap.com/amazon-prime-video-redesign-info-details-preview-photos/

Observation/inference:

- Amazon's official wording says the Prime Video "Super Carousel" uses **larger, poster-style artwork** for Amazon Originals, Exclusives, and Prime Video Cinema. It distinguishes this from ordinary rows.
- Secondary screenshots/writeups describe **large poster art with inline trailer playback** and portrait poster-style super carousels. The visible row count is typically about **5 large posters** before horizontal scrolling/peeking, depending on focus state.
- At 1920px wide:
  - With mango's 96px safe side margins and 40px gutters, **5-up = 314px wide**.
  - With Android's 116px grid side margins and 40px gutters, **5-up = 306px wide**.
- Prime's poster row therefore supports a practical target around **306-314px** wide for a poster row, with focus expansion/detail instead of persistent captions.

### Disney+ TV

Sources:

- Disney Streaming official UX announcement: https://medium.com/disney-streaming/introducing-our-latest-ux-enhancements-for-disney-f7c93a4e38cb
- Disney+ press product assets entry point: https://press.disneyplus.com/about/logos
- Secondary screenshots/writeup: https://whatsondisneyplus.com/disney-home-page-gets-a-small-update/

Observation/inference:

- Disney explicitly introduced a **Poster Row** on select devices: "large, vertically-oriented tiles" that break up the smaller landscape tiles used through most browse rows.
- Disney's language is important: the poster row is not dense default browsing; it is an editorial/device-select pattern used to reduce fatigue and create variety.
- Product/screenshots around the Poster Row show a small number of large vertical posters rather than a dense library grid. The practical count is **about 5 posters visible** or **4-5** depending on the hero/navigation area and focus scaling.
- At 1920px wide:
  - **4-up** with 96px side margins and 40px gutters = **402px** poster width.
  - **5-up** with 96px side margins and 40px gutters = **314px** poster width.
- Disney supports the recommendation that poster rows should live in the **314-402px** band, not around 174px.

### Apple TV app

Sources:

- Apple TV partner artwork: https://tvpartners.apple.com/support/3708-artwork-requirements
- Apple TV and Movies partner artwork: https://itunespartner.apple.com/tv-movies/support/5450-artwork-requirements
- Apple HIG Top Shelf poster sizes: https://developer.apple.com/design/human-interface-guidelines/top-shelf/
- Apple community reports showing format churn: https://discussions.apple.com/thread/255363136 and https://discussions.apple.com/thread/256149972

Observation/inference:

- The Apple TV app is a poor single source for portrait-row counts because artwork treatment has changed by OS, surface, and content type. Official partner docs still document **16:9 cover art** and **16:9 tile/keyframe artwork** for many browsing surfaces, while current user reports discuss 2:3 portrait artwork returning on some app/library surfaces.
- The reliable Apple poster-specific number is tvOS Top Shelf: **333px unfocused**, **380px safe/focused zone**, **404px actual** at @1x.
- That implies **4-5 portrait posters across** at 1080p, not 7-9.

## Poster width recommendation

Documented platform numbers and app observations conflict:

- Android TV's documented dense card width goes as low as **248px** for its 5-card layout, but this is a generic card-system number and appears designed for peeking/dense card rows.
- tvOS Top Shelf poster guidance is much larger: **333-404px** wide.
- Prime Video and Disney+ poster rows are special emphasis rows and infer to roughly **306-402px** wide.

Recommendation for mango:

- **Browsable portrait grid target:** **5-up at 306-314px wide**, poster height **459-471px**.
- **Featured poster row target:** **4-up at 392-402px wide**, poster height **588-603px**.
- **Lower practical floor:** **~255-280px**. Six-up at **255px** can work only if you accept smaller art and minimal captions.
- **Too small threshold:** **<250px** is too small for comfortable poster browsing at 3m; **<220px** is clearly cramped; mango's current **174px** posters are far below the TV-comfort floor.

## Gutters and vertical spacing

Documented platform guidance:

- Android TV card spacing: **20dp = 40px**.
- Android TV grid gutters: **20dp = 40px**.
- Fire TV and Android both use 960x540dp at 1080p, so this maps cleanly on Pi/Chromium/X11.

Recommendation:

- Use **40px horizontal gutters** between portrait posters.
- Acceptable range: **32-48px**. Below **24px** starts to feel like web/mobile density on TV, especially with focus rings and shadows.
- Between one poster row's bottom and the next row label, use **56-64px** in the final optical layout. The documented Compose section gap is **16dp = 32px**, but poster rows need additional focus/shadow breathing room. A practical decomposition is 32px minimum section gap plus 24-32px focus/shadow/label breathing space.

## Captions

Documented platform guidance:

- Android TV card components support a content block below the image; legacy guidance uses **Card Title 16sp = 32px** and **Card Subtext 12sp = 24px**.
- Fire TV says body text minimum **14sp = 28px at 1080p**.
- tvOS uses **Caption 1 25pt = 25px** and **Caption 2 23pt = 23px**, with **Body 29pt = 29px**.
- tvOS Top Shelf poster rows do **not** show persistent labels under content; text should be in the artwork/accessibility label if needed.

App observation/inference:

- Netflix, Prime Video poster-style rows, Disney+ Poster Row, and tvOS Top Shelf mostly rely on poster art/title treatment plus focus details, not always-visible title captions under every poster.
- Captions are more common in generic platform card components than in major streaming poster rows.

Recommendation:

- If poster art already contains readable title treatment, omit persistent captions and show title/details on focus.
- If mango needs captions for local-library clarity, use **28-32px** title text at 1080p, **one line preferred**, **two lines maximum**, with strong truncation/fade. Avoid subtitles/descriptions in the row.

## Rows visible and peek rows

Documented/observed support:

- Android TV's layout guidance says background/offscreen elements can be partially displayed and Browse layouts are vertical stacks of horizontal rows.
- tvOS Top Shelf asks developers to provide enough content to span the full width of the screen; peeking/offscreen content is normal in TV collection layouts.
- Major streaming home screens commonly show a partial next row to signal vertical navigation.

Recommendation:

- With **4-up posters** around **402x603px**, show **1 full poster row plus a partial next row**.
- With **5-up posters** around **314x471px**, show **about 2 rows total**, often **1 full row plus a strong partial/peek row** once top navigation, labels, focus rings, and safe areas are included.
- Do not optimize for 3+ full portrait rows at 1080p; that forces poster widths into the **<255px** range.
- A partial peek row is good practice if it is intentional, symmetric, and does not clip the currently focused card's focus ring or scale animation.

## Final mango layout numbers

Use these as the implementation target for Movies/TV portrait rows:

- Side margins: **96px** minimum safe margin; **112-116px** if matching Android's 58dp grid side margin.
- Poster count: **5 per row** for default browsing.
- Poster size: **314x471px** with 96px margins and 40px gutters, or **306x459px** with 116px margins and 40px gutters.
- Horizontal gutter: **40px**.
- Caption: prefer none; if needed, **28-32px**, one line preferred, two max.
- Vertical distance from poster bottom to next row label: **56-64px**.
- Visible rows: **about 2 rows including peek**; a deliberate partial next row is desirable.

---

# Pass 2 — 16:9 landscape thumbnails


Research target: a 10-foot TV launcher at 1920x1080, with 16:9 video thumbnails in browsable rows. The specific Mango problem is a YouTube tab showing 6 landscape cards per row, which reads cramped.

## Conversion Rules Used

- Android TV / Google TV / Fire TV document a 1080p TV surface as 1920x1080px with a 960x540dp logical layout. Therefore, at 1080p: **1dp = 2px** and, at default font scale, **1sp ~= 2px**. Android TV layout source: https://developer.android.com/design/ui/tv/guides/styles/layouts. Fire TV source: https://developer.amazon.com/docs/fire-tv/display-and-layout.html.
- tvOS HIG uses points at @1x for 1080p assets. Therefore, at 1080p: **1pt = 1px**. Apple typography explicitly says point size is based on @1x / 72 ppi designs. Source: https://developer.apple.com/design/human-interface-guidelines/typography.
- 16:9 height calculation: **height = width x 9 / 16**.

## 1. Cards Per Row and Thumbnail Widths

### Documented Platform Guidance

| Source | Documented layout | 1080p thumbnail width | 16:9 size | Notes |
|---|---:|---:|---:|---|
| Android TV layout/card guidance | 4-card layout | 196dp = **392px** | **392x221px** | Android TV cards page says 16:9 is the most common card aspect ratio for video, card spacing is 20dp, and 4-card layout width is 196dp. Sources: https://developer.android.com/design/ui/tv/guides/components/cards, https://developer.android.com/design/ui/tv/guides/styles/layouts |
| Android TV layout/card guidance | 3-card layout | 268dp = **536px** | **536x302px** | Useful for feature/hero rows, not dense browsing. Source: https://developer.android.com/design/ui/tv/guides/components/cards |
| Android TV layout/card guidance | 5-card layout | 124dp = **248px** | **248x140px** | Documented, but this is much smaller than the other TV guidance and too small for video-title browsing at 10 feet. Source: https://developer.android.com/design/ui/tv/guides/components/cards |
| Apple tvOS HIG | 4-column grid | **410px** | **410x231px** | Apple documents 40px horizontal spacing and 100px minimum vertical spacing. Source: https://developer.apple.com/design/human-interface-guidelines/layout |
| Apple tvOS HIG | 5-column grid | **320px** | **320x180px** | Reasonable lower bound for browsable video cards. Source: https://developer.apple.com/design/human-interface-guidelines/layout |
| Apple tvOS HIG | 6-column grid | **260px** | **260x146px** | Documented as possible, but cramped for YouTube-style title + metadata cards. Source: https://developer.apple.com/design/human-interface-guidelines/layout |
| Apple tvOS HIG | 3-column grid | **560px** | **560x315px** | Good for promoted rows. Source: https://developer.apple.com/design/human-interface-guidelines/layout |

### Observed / Inferred From Major TV Apps

These are observations from product screenshots/articles, not hard public specs. The apps are responsive and A/B tested, so treat them as current-product evidence rather than fixed contracts.

| App / surface | Observed cards per row | Inferred 1080p thumbnail width | Evidence label |
|---|---:|---:|---|
| YouTube on TV home | **4 full 16:9 cards**, often with a partial/peeking next card depending on left navigation state | roughly **390-410px** if aligned to Android TV / tvOS 4-card grids | Observation/inference. YouTube Help says TV Home and Subscriptions use a grid of recommended videos; Android Police screenshots show the Android/Fire/smart-TV YouTube app layout; Google/YouTube state TV homepage discovery is a first-class surface and now supports 4K thumbnails. Sources: https://support.google.com/youtube/answer/7583931, https://www.androidpolice.com/2019/11/04/youtube-for-android-tv-gets-a-light-makeover-with-expanded-menu-options/, https://blog.google/intl/en-au/products/5-new-features-to-help-youtube-content-shine-on-tv-screens/ |
| Google TV / Android TV home recommendation rows | **4 full landscape cards** is the documented Android TV card target; Google TV uses 16:9 widescreen recommendation cards | **392px** documented Android TV card width | Documented + observed/inferred. Android TV card/layout docs give 4-card width 196dp = 392px; SlashGear reports Google TV adding 16:9 widescreen movie/show posters. Sources: https://developer.android.com/design/ui/tv/guides/components/cards, https://developer.android.com/design/ui/tv/guides/styles/layouts, https://www.slashgear.com/google-tv-for-android-gets-more-chromecast-style-features-27684268/ |
| Netflix TV rows | commonly **5 landscape cards** in older/current row-style browsing; newer redesign uses larger expanding cards and can show fewer | roughly **320-340px** per card, depending margins | Observation/inference. Netflix says the new TV experience gives more detailed information in the browsing card and uses responsive recommendations; third-party UX teardown observes Netflix rows at 5 titles per row. Sources: https://www.netflix.com/tudum/articles/netflix-new-tv-layout, https://uxplanet.org/netflix-vs-amazon-prime-video-user-experience-part-2-ac5b6482d5cd |
| Prime Video TV | row carousels with expanding landscape cards; exact count varies | typically in the **320-410px** range by visual comparison to Netflix/Fire TV rows | Observation/inference. Amazon/TechCrunch describe Prime Video TV redesign using side nav, bigger carousels, and expanding landscape tiles. Sources: https://techcrunch.com/2022/07/18/amazon-refreshes-prime-video-design-with-icon-based-navigation-and-a-dedicated-sports-tab/, https://www.vulture.com/2022/07/amazon-prime-video-new-design-home-screen.html |

### Consensus

- For a YouTube-like 16:9 video browsing row at 1920x1080, the strongest consensus is **4 cards per row**.
- **5 cards per row** is a tolerable lower-density option when titles are short or metadata is minimized.
- **6 cards per row** lands in the tvOS 260px width band, which is documented as a possible grid but conflicts with Android TV's 4-card video-card target and feels cramped once a 2-line title and channel line are added.

## 2. Recommended Thumbnail Width / Height at 1080p

Recommended for Mango YouTube tab:

- **Target / typical:** **392-410px wide**, **221-231px high**. This is Android TV 4-card width (196dp x 2 = 392px) and tvOS 4-column width (410px).
- **Acceptable lower bound:** **320px wide**, **180px high**. This matches tvOS 5-column width and observed Netflix-style denser rows.
- **Feature row / hero row:** **536-560px wide**, **302-315px high**. This matches Android TV 3-card and tvOS 3-column grids.
- **Avoid for YouTube title cards:** **248-260px wide**, **140-146px high**. Android documents a 248px 5-card card width and tvOS documents a 260px 6-column grid, but for a YouTube-style card with text below, this is below the practical browsing minimum.

## 3. Gutters and Row Gaps at 1080p

### Horizontal Gutter

- Android TV documented card spacing: **20dp = 40px**. Source: https://developer.android.com/design/ui/tv/guides/components/cards.
- Android TV grid gutter: **20dp = 40px**, columns are 52dp = 104px, side margins are 58dp = 116px. Source: https://developer.android.com/design/ui/tv/guides/styles/layouts.
- tvOS documented horizontal spacing: **40pt = 40px** for all documented grid widths. Source: https://developer.apple.com/design/human-interface-guidelines/layout.
- Fire TV does not give a card gutter number in the general UI guide, but it requires low information density and elements large/spaced enough for 10-foot use. Source: https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html.

Recommendation: **40px horizontal gap** between thumbnails. Do not go below **32px** unless thumbnails are 410px+ and focus scale is small.

### Vertical Row Gap

- tvOS documented grid minimum vertical spacing: **100pt = 100px** between rows. It also says titled rows need additional spacing between the previous unfocused row, the title, and the next row. Source: https://developer.apple.com/design/human-interface-guidelines/layout.
- Android TV layout docs mention **4dp = 8px vertical spacing between lines**, but this is not a complete recommendation for card-row spacing. Android TV card docs give 20dp card spacing for peaking but not a row-to-row number. Sources: https://developer.android.com/design/ui/tv/guides/styles/layouts, https://developer.android.com/design/ui/tv/guides/components/cards.

Recommendation for Mango:

- **40px** between thumbnail and next horizontal neighbor.
- **16-24px** between thumbnail bottom and title block.
- **72-100px** from the bottom of the title/metadata block to the next row's thumbnail top.
- If using row headers, reserve **40-56px** for header rhythm above the row and keep the full previous-row-to-next-thumbnail rhythm near **100px**.

## 4. Title Treatment Under 16:9 Thumbnails

### Documented Platform Text Sizes

| Platform | Minimum / default text guidance at 1080p | Converted px |
|---|---:|---:|
| Android TV legacy TV style | minimum recommended **12sp**, default **18sp**; card titles **16sp**, card subtext **12sp** | min **24px**, default **36px**, card title **32px**, card subtext **24px**. Source mirror of older Android TV design spec: https://minimum-viable-product.github.io/marshmallow-docs/design/tv/style.html |
| Android / Material 3 type scale | titleMedium **16sp / 24sp line-height**, titleSmall **14sp / 20sp**, bodySmall **12sp / 16sp** | titleMedium **32px / 48px line-height**, titleSmall **28px / 40px**, bodySmall **24px / 32px**. Source: https://developer.android.com/develop/ui/compose/designsystems/material3 |
| Fire TV | body text at least **14sp**, approximately **28px** at 1080p | min body **28px**. Source: https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html |
| Fire TV ads / living-room creative | minimum **24px**, recommended **28pt** for living-room Fire TV ad text | min **24px**, recommended **28px-ish** for creative text. This is ad creative guidance, not app UI. Source: https://advertising.amazon.com/resources/ad-specs/fire-tv/custom-content-row |
| tvOS | minimum **23pt**, default/body **29pt**, caption 1 **25pt**, caption 2 **23pt** | min **23px**, body/default **29px**, caption **23-25px**. Source: https://developer.apple.com/design/human-interface-guidelines/typography |

### Typical YouTube-Style Card Text

- **Title lines:** **2 lines** is the best default for YouTube videos. One line truncates too aggressively at 320-410px widths; more than two lines makes row height uneven and increases vertical density.
- **Title size:** **28-32px** at 1080p. This maps to tvOS body/default 29px and Android titleSmall/titleMedium 14-16sp = 28-32px.
- **Title line height:** **36-44px**. Android M3 titleSmall line-height converts to 40px; titleMedium converts to 48px, which is comfortable but tall.
- **Channel/subtitle line:** YouTube commonly shows channel/metadata under the title; Netflix/Prime often avoid separate text below each thumbnail and move details into focus/preview. For Mango, use **one muted metadata line** at **22-24px** only if useful; otherwise keep metadata out of the default row and show it on focus/detail.
- **Metadata line count:** **0-1 line**. Do not stack channel + views + age as multiple separate lines at 10 feet.

## 5. Vertical Rhythm

Concrete recommendation for a 392-410px thumbnail:

- Thumbnail: **392x221px** to **410x231px**.
- Thumbnail bottom to title top: **16px** minimum, **20-24px** comfortable. Android TV Material card examples use title top padding of 8dp = 16px for TV cards; Material card content padding commonly uses 16dp = 32px on Android mobile/desktop, which is larger than necessary under a TV thumbnail. Sources: https://github.com/android/tv-samples/blob/bf599072/TvMaterialCatalog/app/src/main/java/com/google/tv/material/catalog/screens/CardsScreen.kt, https://m2.material.io/develop/android/components/cards/.
- Title block: **2 lines x 36-44px = 72-88px**.
- Optional channel/metadata: **24-32px line-height**.
- Title/metadata block bottom to next row thumbnail: **72-100px**. Use **100px** if row headers are present or focus scale is 1.1x; **72-80px** is acceptable if there is no row header and cards use 1.05x focus.

Practical total row height:

- Thumbnail 221-231px + 20px title gap + 72-88px title + optional 0-32px metadata + 72-100px row gap = **385-471px** per row band.
- This means a 1080p screen should show roughly **2 full rows plus context/peeking**, not 3-4 dense rows of YouTube cards.

## 6. Focus Treatment for Landscape Cards

### Documented Guidance

- Android TV focus system uses scale, border, glow, and color. Default scale examples are **1.025x, 1.05x, and 1.1x**. Glow levels range **2dp-32dp = 4-64px**. Source: https://developer.android.com/design/ui/tv/guides/styles/focus-system.
- AndroidX TV Material3 CardDefaults default focused scale is **1.1x** and default focused border is **3dp = 6px**. Source: https://developer.android.com/reference/kotlin/androidx/tv/material3/CardDefaults.
- Fire TV requires focus to be clearly indicated; focused item and text should remain in the inner 90% safe zone. Fire TV web-app docs show a **2px** white focus border example, and Vega guidance recommends physical changes such as borders or size changes, not color alone. Sources: https://developer.amazon.com/docs/fire-tv/design-and-user-experience-guidelines.html, https://developer.amazon.com/docs/fire-tv/customizing-your-web-app.html, https://developer.amazon.com/docs/vega/0.22/focus-management.html.
- tvOS focus commonly enlarges and elevates focused items with parallax/shadow. Apple docs say focus often increases scale and assets must be supplied for the larger focused size; HIG grid spacing is designed to prevent overlap. Sources: https://developer.apple.com/design/human-interface-guidelines/focus-and-selection, https://developer.apple.com/design/human-interface-guidelines/layout.

### Recommendation for Mango

- Use **1.05x focus scale** for 392-410px video cards if rows are close together. This grows a 400px card to 420px and needs about 10px extra on each side.
- Use **1.08-1.1x** only when horizontal/vertical spacing is generous. A 400px card at 1.1x becomes 440px and needs about 20px extra each side, so 40px gutters are just enough horizontally but vertical spacing must be protected.
- Use a **4-6px focus ring** at 1080p. AndroidX default 3dp converts to **6px**; Fire web examples use **2px**, which is likely too subtle from couch distance unless paired with scale/glow.
- Keep the focused card and text inside safe zones: Android TV side margins **116px** documented; Fire TV says avoid the outer **5%** of any edge, which is **96px horizontal** and **54px vertical** at 1920x1080.

## Conflict Summary

- Android TV modern card guidance strongly supports **4 video cards at 392px** with **40px** gaps.
- tvOS documents more grid densities, including **5 columns at 320px** and **6 columns at 260px**, but also demands **100px** minimum vertical spacing and enough room for focus growth.
- Fire TV is less numeric for card grids but is explicit about low information density, 1080p design, 960x540dp output, safe zones, and larger text.
- Observed app layouts vary because YouTube, Netflix, Prime, and Google TV are responsive and A/B tested. Still, the practical product range is **4-5 landscape cards**, with **4** favored for YouTube-like video cards that include title text.

## Mango Layout Recommendation

For the Mango YouTube tab at 1920x1080:

- Change from **6 cards per row** to **4 cards per row**.
- Use thumbnail width **392-410px** and height **221-231px**.
- Use horizontal gap **40px**.
- Use title top gap **20px**.
- Use title font **30-32px**, two lines, line-height **40-44px**.
- Use optional channel/metadata **22-24px**, one line max, muted.
- Use next-row gap **80-100px** after the text block.
- Use focus scale **1.05x** with a **6px** ring/glow. If using 1.1x, increase vertical row clearance to the full **100px**.

The single highest-impact correction: **stop showing 6 cards per row; target 4 cards per row around 400px wide.**
