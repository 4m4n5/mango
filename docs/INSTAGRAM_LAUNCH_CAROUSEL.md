# Mango — Instagram launch carousel

**Status:** production brief · **Format:** eight 1080×1440 sRGB PNGs ·
**Audience:** people who want one coherent, household-owned television
experience · **Conversion:** Instagram DM first, email second

This document owns the launch carousel copy, visual treatment, capture
requirements, caption, alt text, and publication gate. Product truth still lives
in [PRODUCT.md](PRODUCT.md); current implementation and evidence live only in
[STATUS.md](STATUS.md).

## Story

The carousel introduces the real product immediately, demonstrates breadth in
the second-card position, then moves through one feature family per card:

`product → breadth → Search → streams → taste → librarian → YouTube → contact`

The first three cards receive the strongest visual hierarchy because they must
explain the product even when the rest of the carousel is not viewed. Slide 2
also works as a second cover.

## Production system

| Property | Lock |
|----------|------|
| Canvas | 1080×1440, 3:4, sRGB PNG, no alpha |
| Safe area | 64 px for text, 40 px for artwork, 64 px top, 96 px bottom |
| Canvas | `#0B0B12` |
| UI base | real capture; current launcher base is `#07080A` |
| Text | `#F4F1EA`; secondary text at 68% opacity |
| Accent | Mango amber `#E8A020`; restrained halo only |
| Type | Helvetica Neue/system sans; fixed sizes, wrap rather than shrink |
| Headline | 72–84 px, light/regular, lowercase |
| Support | 34–40 px, regular, maximum two lines |
| Progress | `01 / 08` through `08 / 08`, top-right |
| UI frame | 24 px radius, 2 px low-contrast border, subtle black shadow |
| Copy/UI relationship | Separate zones; never cover decision-carrying UI |
| Wordmark | Lowercase text `mango.`; do not invent a new logo before mark lock |

All UI inside the cards must come from the current Mango renderer or a current
Pi/phone capture. Do not redraw, replace, or “improve” the product interface in
the marketing layer.

Every card uses the same five content layers: header, subheader, real image,
title, and subtitle. Wordmark and progress remain the only persistent chrome.

## 1 / 8 — product

**Copy**

> mango.  
>
> your TV.  
> on your terms.  
>
> one home for movies, shows,  
> YouTube, and live.  
>
> running on Raspberry Pi 5.

**Visual**

- Restrained straight-on television frame in the lower 64% of the card.
- Real Movies Home with navigation and at least two populated rail families.
- Show a credible Indian/international/mainstream/niche mix.
- Keep one amber focus ring visible.
- No ad claim, hardware photograph, platform logo stack, or swipe instruction.

**Capture acceptance**

- The screenshot is current and records its source/evidence class.
- No loading, stale, offline, operator, token, URL, or Reliability chrome.
- `Live` remains a named optional surface; the card does not imply bundled IPTV.

**Alt text**

> Mango launch card one. “Your TV. On your terms.” A real Mango Movies Home
> screen appears inside a dark television frame, with populated film and series
> rails. Supporting text describes one home for movies, shows, YouTube, and live
> on Raspberry Pi 5.

## 2 / 8 — breadth

**Copy**

> it is all here.  
>
> from across streaming  
>
> and btw, no ads!  
>
> mango inserts none.

**Visual**

- Dense real Explore/catalog state, visually distinct from Slide 1 Home.
- Let posters dominate: Indian regional, international, mainstream, niche, and
  documentary titles.
- No single hero title, provider logos, editorially rearranged posters, or
  technical stream badges.
- The ad line is the conversational final beat.

**Claim boundary**

“All” means the broad library assembled from the household's configured Mango
sources, not every title or entitlement from every commercial platform. “No
ads” means Mango inserts no advertising into its own interface. It does not
promise control over third-party media or services.

**Alt text**

> Mango launch card two. “It is all here.” A dense real Mango catalog shows a
> varied wall of Indian, international, mainstream, niche, and documentary
> titles. The card adds, “from across streaming” and “and btw, no ads!”

## 3 / 8 — Search

**Copy**

> find anything.  
>
> movies, shows, YouTube, and live—together.

> one query.  
>
> every mango surface.

**Visual**

- A 2×2 grid of four independently submitted real `F1` Search states.
- Movies, TV Shows, Live, and YouTube are each genuinely activated and queried;
  the amber chip and returned content must agree.
- Keep the pinned query, Edit action, scope chips, and populated results visible.
- No keyboard, explanatory callouts, or platform logo collage.

**Claim boundary**

“Anything” is immediately scoped by the named Mango surfaces. It is not a
universal entitlement or guaranteed-title claim.

**Alt text**

> Mango launch card three. “Find anything.” Four real Mango Search screens show
> distinct F1 results for Movies, TV Shows, Live, and YouTube. Supporting text
> reads “one query” and “every Mango surface.”

## 4 / 8 — streams

**Copy**

> watch it at its best.  
>
> mango optimizes for your hardware.  
>
> choose from available streams.  
>
> quality, audio, language, and size—at a glance.

**Visual**

- Real RRR Detail state with complete poster artwork.
- Keep the verified eight-choice stream ladder visible, from 4K to 1080p.
- Preserve the real resolution, encode/source, cached state, languages, and size.
- Do not show a title with missing artwork, a generic initials fallback, or an
  `unverified` ladder.

**Capture acceptance**

- The title and every visible stream row are current real product output.
- This is a pre-play Detail ladder, not an advancing-video claim.
- Native HDR remains unsupported even if a source row contains an HDR label.

**Alt text**

> Mango launch card four. “Watch it at its best.” A real RRR Detail page with
> poster artwork shows eight cached stream choices from 4K to 1080p, including
> source, language, and file-size information.

## 5 / 8 — Fire + Water

**Copy**

> rate with fire + water.  
>
> get better recommendations.  
>
> mango learns your taste.  
>
> one title at a time.

**Visual**

- Real post-rating RRR Detail state.
- Fire and Water chips must remain legible at their real saved values of 5.0.
- Crop away the stream ladder so the rating relationship owns the frame.
- No open rating sheet, algorithm diagram, enlarged flames, or invented result.

**Capture acceptance**

- The values shown are real saved values for the current household.
- Do not imply that one rating event immediately completes a recommendation
  rebuild.

**Alt text**

> Mango launch card five. “Rate with Fire plus Water.” A real RRR Detail page
> shows the household's saved Fire 5.0 and Water 5.0 ratings. Supporting text
> says Mango learns the household's taste one title at a time.

## 6 / 8 — AI librarian

**Copy**

> your content librarian.  
>
> talk naturally from your phone.  
>
> describe. discuss. discover.  
>
> your final pick opens on the TV.

**Phone conversation**

> You: we want a tense Indian thriller under two hours.  
> Mango: more cerebral or more relentless?  
> You: cerebral.

The selected real pick must expose an `Open on TV` action.

**Visual**

- Real companion phone in the foreground.
- Matching real Detail screen fills the television behind it.
- Keep the real B-to-play affordance visible.
- Show a genuine push-to-talk transcript and selected pick; no decorative fake
  waveform.
- The final title must come from the actual captured librarian response.

**Claim boundary**

The librarian may search, clarify, curate, remember, save, and open Detail. It
does not autoplay, speak through TTS, or bypass the controller's B-to-play
decision.

**Alt text**

> Mango launch card six. “Your phone is the librarian.” A phone conversation
> asks for a tense Indian thriller under two hours, refines the request, and
> selects a real pick. The matching Mango Detail page is open on the television,
> where the B button still starts playback.

## 7 / 8 — native YouTube

**Copy**

> YouTube, built in.  
>
> get meaningful recommendations.  
>
> your regulars, subscriptions, and history—organized.

**Visual**

- Real Mango YouTube Home with `For You`, `Your regulars`, and `Subscriptions`
  identifiable.
- Focus one strong, manually approved `For You` card.
- Use the real household account only after approving every visible title,
  channel, and history-derived recommendation.
- YouTube branding appears only where Mango's real UI naturally contains it.
- No co-branded lockup or claim that this reproduces YouTube's proprietary Home.

**Publication blocker**

`ad-free, without Premium.` is not substantiated by the current public product
contract. The card may be rendered for review, but the carousel must not be
published with this line until a technical audit and explicit platform/legal
decision approve it. Creative lock is not claim substantiation.

**Alt text**

> Mango launch card seven. “YouTube, built into Mango.” A real Mango YouTube Home
> shows For You, Your regulars, and Subscriptions rails. Text says subscriptions
> plus watch history produce meaningful household recommendations and includes
> an ad-free, without Premium claim that remains blocked pending review.

## 8 / 8 — contact

**Copy**

> wanna know how I built it?  
>
> get in touch.  
>
> want mango?  
>
> send me a DM for more information.

**Visual**

- Use the standard small wordmark and five-layer layout.
- Replace the temporary television image with a real current Pi 5 enclosure and
  8BitDo Micro photograph before publication.
- Television returns to the same Home state used on Slide 1.
- Close with `08 / 08 · end`.
- No retail packaging, price, preorder, waitlist, QR code, shipping, or implied
  availability.

**Alt text**

> Mango launch card eight. “Wanna know how I built it?” A television shows the
> real Mango Home interface. The card asks “want Mango?” and invites the viewer
> to send the founder a direct message for more information.

## Instagram caption

> this is mango: a household-owned TV experience running on Raspberry Pi 5.  
>
> one place for movies, shows, YouTube, optional live TV, search, local
> Continue and Saved, Fire + Water taste, transparent stream choices, and a
> phone librarian that can help find what to watch. mango itself inserts no
> ads. third-party sources, accounts, availability, media rights, and service
> behavior remain their own.  
>
> mango is an alpha self-hosted project, not a finished retail appliance. HDR,
> no-SSH first boot, and whole-product couch sign-off remain open. You bring
> your own accounts, manifests, and media entitlements. mango is not affiliated
> with YouTube, Stremio, debrid services, IPTV providers, or any studio or
> broadcaster.  
>
> want to know more? send me a dm or email support@aaam.dev. source and current
> documentation are available on GitHub.

Do not add `ad-free, without Premium.` to the caption unless the Slide 7
publication blocker is closed.

## Capture manifest

For every input image, record:

- card number and state name
- UTC capture time
- evidence class: `Pi`, `phone`, `camera`, or `local fixture`
- repository revision when applicable
- exact UI expectation that was visible
- whether the frame is current, synthetic, or historical
- privacy review owner/result
- claim notes and any unresolved blocker

Do not copy deployed SHA or generation claims into this document. Keep them in a
separate generated manifest or refer to [STATUS.md](STATUS.md).

## Pre-publish audit

- [ ] Eight files, all exactly 1080×1440, sRGB, opaque PNG.
- [ ] Text and UI pass a 200 px-wide thumbnail review.
- [ ] No copy overlaps decision-carrying UI.
- [ ] Every card has the correct `NN / 08` marker.
- [ ] Manual alt text is ready for all eight cards.
- [ ] All visible UI is current and real; synthetic inputs are explicitly rejected.
- [ ] No private viewing history, credentials, URLs, tokens, or account identifiers.
- [ ] No empty/loading/stale/error/operator chrome.
- [ ] Optional Live, configured sources, entitlements, alpha availability, and
      native-HDR boundaries remain honest.
- [ ] Slide 7 ad/Premium blocker is closed or the line is removed.
- [ ] Instagram DM account/handle is final and accessible.
- [ ] Caption and image claims receive a same-day product-truth pass.

## Research basis

- [Meta — image resolution on Instagram](https://www.facebook.com/help/instagram/1631821640426723)
- [Socialinsider — Instagram Engagement Report, 25 May 2026](https://www.socialinsider.io/social-media-benchmarks/instagram-engagement-report)
- [Apple — asset best practices](https://developer.apple.com/app-store/asset-best-practices/)
- [SplitMetrics — OLBG screenshot-order case study](https://splitmetrics.com/cases/olbg-ios-screenshots-optimization/)
- [Cure Media — Philips OneUp launch case study](https://www.curemedia.com/case-studies/philips-x-oneup-seeding)
- [Cadenus — 2026 Instagram carousel dimensions](https://cadenus.io/resources/blog/instagram-carousel-size/)

The transferable principles are real product use from the opening frame,
cohesive sequencing, one focal idea per card, short legible copy, and exact
platform exports. App Store guidance is used only as visual-truth and
composition evidence; Mango is not presented as an App Store product.
