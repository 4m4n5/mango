# mango brand assets

Draft 2026-06-18 · mark exploration **round 2** (identity-first). Round 1
(fruit silhouettes) archived in showcase — none locked.

## Brand identity (working)

| Axis | mango | hum | tir |
|------|-------|-----|-----|
| **Verb** | glows | hums | locks in |
| **Energy** | passive, ambient | intimate, rhythmic | active, precise |
| **Room** | couch-distance, one screen | two people, phone | solo play, target |
| **Mark job** | warmth in the room | quiet resonance | you are here |

**Product soul:** Pi box behind the TV — Stremio/Kodi, optional phone voice.
Not a smart-home hub, not a game, not a couples app. Marketing line (draft):
`your couch, your shows, your box.`

**Design principles (round 2):**

1. **Intent over literal** — mark encodes couch warmth / golden glow, not clipart
   mango ([VDS multi-brand semantics](https://variable-design-standard.vercel.app/patterns/multi-brand-architecture/)).
2. **One focal primitive** — single stroke or shape; survives 32px
   ([WhixFrame 2026](https://www.whixframe.com/blog/app-icon-design-guide)).
3. **Little blip asymmetry** — one controlled off-move, not symmetric fruit
   ([2026 design principles](https://www.linkedin.com/posts/priyanjay87_graphicdesign-designprinciples-visualdesign-activity-7467513473690669056-fand)).
4. **Sibling isolation** — distinct semantic primitive per app; same halo recipe
   ([CoreLine multi-brand tokens](https://coreline.agency/blog/operating-multi-brand-design-systems-enterprise-scale)).
5. **Home warmth** — warm minimal, not datacenter chrome
   ([Beryl home decor branding](https://beryl.agency/industry/home-decor-industry/)).

## Mark exploration round 3 — fruit silhouettes (current)

| # | Codename | Cultivar cue | Read |
|---|----------|--------------|------|
| 11 | **alphonso soft** | Maharashtra export | Waist + shoulder, rounded apex |
| 12 | **totapuri beak** | South India | Parrot-beak hook — most graphic |
| 13 | **kesar round** | Gujarat | Plump oval, soft waist |
| 14 | **banganapalli** | Andhra | Tall oblong, elegant |
| 15 | **chunky icon** | favicon tier | Bold simplified mass |
| 16 | **half cheek** | graphic | Peeled cheek + seed hole |

```bash
open assets/brand/showcase.html
```

Rounds 1–2 archived in showcase (early blobs + ambient metaphors).

## Color tokens

| Token | Hex | Where |
|---|---|---|
| Icon canvas | `#0B0B12` | `icon-master.svg`, studio canonical (hum/tir parity) |
| UI canvas | `#050608` | Launcher, companion, overlay (`src/launcher/src/style.css`) |
| Body (amber) | `#FFB300` | Mark sharp pass + inner halo; launcher eyebrow, focus ring |
| Outer halo (gold) | `#FFD080` | Outer `feGaussianBlur` pass only |
| Launcher text | `#F7F3E8` | Primary copy on TV |
| Launcher accent wash | `rgba(10, 107, 72, 0.18)` green + `rgba(255, 179, 0, 0.18)` amber | Background gradients only — **not** on the mark |
| Focus / CTA highlight | `#FFF9C4` | Selected tile, primary button fill |

Icon canvas (`#0B0B12`) and UI canvas (`#050608`) are intentionally different:
icons sit on the studio near-black; the 10-foot launcher uses a deeper void for
TV contrast. Marketing lockups may use either — document per surface.

## aaam.dev studio conformance

mango is the amber sibling alongside hum (rose wave) and tir (cyan ring+dot):

- Same warm-near-black icon canvas (`#0B0B12`).
- Single saturated accent on the mark (`#FFB300`); corona `#FFD080` is halo only.
- Single-primitive-plus-dual-halo composition — structurally identical to hum/tir
  (shape drawn three times: outer blur, inner blur, sharp top).
- Asymmetry-as-character: ventral bias, off-center dot/seed, or asymmetric wave
  peak — depends on chosen direction.
- Personality split:
  - **hum**: horizontal, intimate, rose — *hums*.
  - **tir**: centered target + off-center dot, cyan — *locks in*.
  - **mango**: warm, couch-distance, amber — *glows* (viewing comfort, not play or pairs).

## Voice & anti-positioning (marketing)

| Use | Voice |
|-----|-------|
| Store / site / launcher | lowercase, warm, concise — couch room, not datacenter |
| Product name | always `mango` (never `Mango` in UI chrome) |

**Anti-positioning** (forbidden in mark copy and marketing):

| Forbidden | Why |
|-----------|-----|
| `smart TV`, `AI box`, `hub` | Generic category junk |
| `cutting edge`, `revolutionary` | Enterprise hype |
| `game`, `play`, `score`, `race` | tir territory |
| `couple`, `partner`, `love`, `relationship` | hum territory |
| cartoon leaf + blush fruit clipart | Off-brand literalism |
| play-button / remote clichés | Lazy streaming iconography |
| hum rose `#FF8E9B` / tir cyan `#00E5FF` on mark | Studio accent isolation |

**Marketing line (draft):** `your couch, your shows, your box.`

Qualified-install framing: mango is for households that want a **simple Pi TV
box** with Stremio/Kodi + optional voice — not a generic “smart home hub”.

## Source files

| File | Purpose |
|---|---|
| `showcase.html` | Round 2 gallery (+ round 1 archived) |
| `variations/var-06-wall-wash.svg` | Candidate 06 |
| `variations/var-07-little-blip.svg` | Candidate 07 |
| `variations/var-08-ventral-arc.svg` | Candidate 08 |
| `variations/var-09-lamp-cone.svg` | Candidate 09 |
| `variations/var-10-pit-ember.svg` | Candidate 10 |
| `variations/var-01` … `var-05` | Round 1 archive |
| `icon-master.svg` | **Pending** — promote winner here |
| `icon-adaptive-foreground.svg` | TODO — transparent canvas |
| `icon-favicon.svg` | TODO — 32px-thickened variant |
| `icon-alternate-totapuri.svg` | Retired exploration (Totapuri beak) — archive or delete after lock |

## Re-rendering PNG assets (after lock)

```bash
cd mango
# TODO: scripts/brand/generate-brand.py
rsvg-convert -w 1024 -h 1024 assets/brand/icon-master.svg \
  -o assets/brand/icon-1024.png
rsvg-convert -w 256 -h 256 assets/brand/icon-adaptive-foreground.svg \
  -o assets/brand/icon-mark.png
```

Install `rsvg-convert` via `brew install librsvg` if missing.

## In-app usage (planned)

| Surface | Mark size | Notes |
|---------|-----------|-------|
| Launcher masthead | 64–96px | Beside lowercase `mango` wordmark |
| Companion PWA | 48px | Header favicon + masthead |
| Overlay toasts | 24px | Optional — do not compete with status text |
| TV boot / splash | ≥128px | Halo earns rent at large scale |

When **not** to use the mark: dense launcher tiles (focus ring is enough);
beside every instance of the wordmark on the same line (pick one).

## Lockup rules (draft)

Marketing lockup: mark left, lowercase `mango` right, 48–56px gap, mark
optically centered to wordmark x-height. Off-app only (README, aaam.dev product
page, future store listing). In-app TV UI: wordmark or mark alone, not both
stacked.

## Accent registry (aaam.dev suite)

| App | Accent | Hex | Mark primitive | Marketing line |
|---|---|---|---|---|
| hum | rose | `#FF8E9B` | sine wave | a digital home for your relationship |
| tir | cyan | `#00E5FF` | ring + dot | speed, precision |
| **mango** | **amber** | **`#FFB300`** | **TBD (pick from showcase)** | **your couch, your shows, your box.** |

Update [`humm/assets/brand/BRAND.md`](../../humm/assets/brand/BRAND.md) and
[`tir/TirApp/assets/brand/BRAND.md`](../../tir/TirApp/assets/brand/BRAND.md)
accent tables when mango locks.

Hue separation: amber (~45°) sits ≥60° from hum rose (~350°) and tir cyan
(~185°).

## Open decisions

1. **Which of the five** — user pick from `showcase.html`.
2. **Launcher canvas** — align UI background to `#0B0B12` or keep `#050608`.
3. **Wordmark** — commission lowercase `mango` letterforms or use system UI font
   at TV scale first.
4. **Slice vs profile** — if 01 still feels unnatural at 64px, prefer 02 or 04.
