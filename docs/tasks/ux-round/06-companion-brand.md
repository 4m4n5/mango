# Phone companion + brand system — inventory, design-system extraction, and drift audit

**Scope:** `src/companion/{index.html,src/main.ts,src/style.css}` (dist/ ignored) · `assets/brand/BRAND.md`, `showcase.html`, `icon-*.svg`, `variations/`, `siblings/` · token-only read of `src/launcher/src/style.css` `:root` block.
**Extracted:** 2026-07-30 · Mechanical audit — facts and line citations only, no redesign proposals.

---

## PART 1 — Phone companion inventory

### 1.0 Shape of the app

It is a **single-page, single-screen** app (no router, no separate views) built from one fixed `.app-shell` (`src/companion/src/style.css:63-71`) containing persistent chrome plus two collapsible drawers:

| Region | Element(s) | Persistent / collapsible | Source |
|---|---|---|---|
| Top bar | brand mark + wordmark, connection status dot + text | persistent | `index.html:13-25` |
| Context bar | 2 toggle chips: "YouTube", "On TV" | persistent | `index.html:28-49` |
| YouTube drawer | account status, Connect/Disconnect, device-code block | collapsible (`hidden` attr, `aria-expanded`) | `index.html:51-66` |
| TV mirror drawer | 4-stat grid (Tab/Open/Playing/Tool) + nested "Memory" toggle + memory `<pre>` panel | collapsible, with a **nested** sub-toggle | `index.html:68-92` |
| Chat log | scrollable message list, empty-state variant | persistent (content varies) | `index.html:94-99` |
| Bottom dock | error banner, text composer, push-to-talk (PTT) button, hint line | persistent | `index.html:102-126` |

So: **1 screen, 7 addressable regions/panels** (2 of them collapsible drawers, one of those with a nested sub-panel).

### 1.1 States

**Connection / voice status** (`statusDotEl` data-state + `statusEl` text, driven by `setConnectionState`/`humanizeStatus`, `main.ts:238-272`):

| Visual dot state | data-state | Status text | Trigger | CSS |
|---|---|---|---|---|
| Connecting (first load) | `connecting` | "Connecting…" (initial markup) | page load, before first `open` | `index.html:22-23`, pulsing amber `#fbbf24` `style.css:220-223` |
| Reconnecting (after drop) | `connecting` | "Reconnecting…" | `socket close` → `connected=false` | `main.ts:167-172, 241` |
| Ready / idle | `ready` | "Ready" | `state==="idle"` or first `connected` | `main.ts:161, 252-255`; green `#4ade80` `style.css:206-209` |
| Listening | `busy` | "Listening…" | `state==="listening"` | `main.ts:196, 243-244`; PTT `.active` class added |
| Thinking | `busy` | "Thinking…" | `state==="thinking"`/`transcrib` | `main.ts:246-247` |
| Speaking | `busy` | "Speaking…" | `state==="speaking"` | `main.ts:249-250` |
| Error | `error` | (error banner text, dot only) | any `setError(text)` call with non-empty text | `main.ts:285-295`; danger `#ff6b6b` `style.css:216-218` |

**Gap:** listening / thinking / speaking are 3 semantically distinct backend states but collapse into **one identical visual treatment** (`busy` dot, same pulse animation) — `main.ts:266` (`state === "listening" || state === "thinking" || state === "speaking"` → same branch). The status *text* differentiates them but the *dot* and *PTT button* do not (PTT only toggles `.active` for `listening`, `main.ts:196`).

**Chat states:**

| State | Behavior | Source |
|---|---|---|
| Empty | `#chat-empty` shown until first `.message` exists | `index.html:95-98`; `syncChatEmpty()` `main.ts:278-283`; CSS `style.css:437-460` |
| User / assistant messages | distinct bubble alignment + gradient per role | `main.ts:617-638`; CSS `style.css:480-492` |
| Assistant partial (streaming) | upserts a `[data-partial="true"]` bubble, replaced on finalize | `main.ts:207-209, 621-622, 640-663` |
| Tool working / done | pill-shaped system message, phase `start`→`done` | `main.ts:524-542`; CSS `.message.tool`/`.tool--done` `style.css:494-505` |
| Results ("pick one") | card of ≥2 tappable option rows, replaces any prior pick-card | `main.ts:563-615`; CSS `style.css:507-578`; only rendered when `options.length >= 2` |
| Error | dismissible-by-clear banner in bottom dock, `role="alert"` | `index.html:103`; `main.ts:285-295`; CSS `style.css:607-620` |

**YouTube panel sub-states** (`setYoutubeStatus`, `main.ts:396-522`) — 9 distinct text states: `checking…` (initial, `index.html:55`), `connected`, `not connected`, `OAuth client missing on Pi`, `API key missing on Pi`, `needs attention: {error}`, `waiting for Google login…`, `code expired — connect again`, `waiting — Google asked us to slow down`, plus generic fetch-failure fallbacks (`YouTube status unavailable`, `could not start YouTube auth`, `YouTube auth failed`, `could not disconnect YouTube`).

**"Disconnected from TV" gap:** there is no state distinct from "idle" for *TV unreachable*. `refreshMirrorPlaying()` polls `/ai/context` every 5s (`main.ts:342-348`) and on fetch failure sets the same `"—"` placeholder as "nothing playing" (`main.ts:365-371` vs `354`/`358`). A dead Pi and an idle-but-alive Pi render identically in the "On TV" mirror.

**Voice/mic states:** `pttActive` boolean (`main.ts:83`) gates capture; distinct copy for: no secure context (`"open the companion over HTTPS to use the microphone"`, `main.ts:679`), socket not open (`"waiting for mango connection"`, `main.ts:683`), mic permission/hardware failure (`error.message` or `"microphone unavailable"`, `main.ts:690`), zero audio captured (`"no microphone audio captured"`, `main.ts:717`), encode failure (`main.ts:723`), 30s cap hit (`"sent first 30 seconds"`, `main.ts:700`, `MAX_UTTERANCE_MS` `main.ts:47`).

### 1.2 Every control and touch-target size

`--touch-min: 44px` is declared once (`style.css:27`) and used as the intended floor.

| Control | Selector | Effective size | Meets ≥44×44? | Source |
|---|---|---|---|---|
| Context chip (YouTube / On TV) | `.context-chip` | `min-height: var(--touch-min)` (44px), flexible width (`flex:1`) | Yes | `style.css:89-93` |
| YouTube "Connect" / "Disconnect" | `.btn` | `min-height: 44px`, `padding: 0 0.95rem` | Yes | `style.css:291-301` |
| **"Memory" toggle** | `.btn.btn--chip` | `min-height: 2rem` (**32px** — overrides the 44px base) | **No** | `style.css:317-324`; used once, `index.html:71` |
| Pick-list row | `.pick-row` | `min-height: 44px`, full width | Yes | `style.css:523-529` |
| Composer textarea | `.composer textarea` | `min-height: 44px` (grows to `max-height: 6.5rem`) | Yes | `style.css:628-631` |
| Send button | `.composer-send` | `width/height: var(--touch-min)` = exactly **44×44px** | Yes, at the floor exactly | `style.css:657-663` |
| Push-to-talk (PTT) | `.ptt` | `min-height: 44px` + `padding: 0.65rem 1rem`, `width: 100%` (full-width bar, renders far taller than 44px) | Yes, generously | `style.css:685-701` |
| Toggle-chip meta text, mirror stats, role labels | non-interactive | n/a | n/a | — |

**Only one sub-44px control exists** — the "Memory" chip button nested inside the already-collapsed "On TV" drawer.

### 1.3 Every user-facing string

**Static markup (`index.html`):** title "mango companion" (`:9`) · wordmark "mango" (`:17`) · tagline "TV companion" (`:18`) · initial status "Connecting…" (`:23`) · chip labels "YouTube" (`:36`), "On TV" (`:46`) · panel titles "YouTube" (`:54`), "On TV" (`:70`) · initial YouTube status "checking…" (`:55`) · "Connect" (`:58`) · "Disconnect" (`:59`) · "Open Google device login" link text (`:63`) · "Memory" (`:71`) · mirror labels "Tab"/"Open"/"Playing"/"Tool" (`:75,79,83,87`) · empty-state title "Talk or type to mango" (`:96`) · empty-state copy "Hold to talk or send a message below. Voice opens on TV — press B to play." (`:97`) · sr-only label "Message mango" (`:105`) · placeholder "Message mango…" (`:110`) · send button aria-label "Send message" (`:113`) · PTT aria-label "Hold to talk" (`:120`) · PTT visible label "Hold to talk" (`:122`) · footer hint "Mic requires HTTPS on your phone" (`:125`).

**Dynamic (`main.ts`):** status labels "Reconnecting…"/"Listening…"/"Thinking…"/"Speaking…"/"Ready" (`:241,244,247,250,253-255`) · tab labels "Movies"/"Series"/"YouTube"/"Live" (`:299-302`, reused `:545-549`) · mirror idle fallback "Idle" (`:338`) · error strings: "socket error" (`:174`), "voice error" fallback (`:216`), "voice is busy" (`:601`), "not connected to mango" (`:667`), "waiting for mango connection" (`:683`), "open the companion over HTTPS to use the microphone" (`:679`), "microphone unavailable" (`:690`), "no microphone audio captured" (`:717`), "could not encode microphone audio" (`:723`), "sent first 30 seconds" (`:700`) · YouTube states listed in §1.1 (`:453-521`) · memory panel "loading…" (`:383`), "mango has no saved notes yet" (`:390`), "memory unavailable" fallback (`:392`) · tool card "Working"/"Done" (`:535-536`), "— building rail in background" suffix (`:529`) · pick card heading "Pick one" (`:572`) · chat role labels "You"/"Mango" (`:631`).

### 1.4 Design system as implemented (`src/companion/src/style.css`)

**Color tokens (`:root`, lines 1-20):**

| Token | Value | Line |
|---|---|---|
| `--bg-base` | `#050608` | 2 |
| `--bg-elevated` | `rgba(255, 250, 240, 0.06)` | 3 |
| `--bg-glass` | `rgba(12, 16, 14, 0.72)` | 4 |
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | 5 |
| `--border-strong` | `rgba(255, 255, 255, 0.14)` | 6 |
| `--text-primary` | `#f7f3e8` | 7 |
| `--text-secondary` | `#a8b4ad` | 8 |
| `--text-muted` | `#7d8a83` | 9 |
| `--accent` | `#ff7a3d` | 10 |
| `--accent-soft` | `rgba(255, 122, 61, 0.16)` | 11 |
| `--accent-glow` | `rgba(255, 122, 61, 0.32)` | 12 |
| `--mint` | `#67aaa2` | 13 |
| `--mint-soft` | `rgba(103, 170, 162, 0.16)` | 14 |
| `--green` | `#0a6b48` | 15 |
| `--green-soft` | `rgba(10, 107, 72, 0.2)` | 16 |
| `--danger` | `#ff6b6b` | 17 |
| `--danger-soft` | `rgba(255, 107, 107, 0.14)` | 18 |
| `--tool` | `#38bdf8` | 19 |
| `--tool-soft` | `rgba(56, 189, 248, 0.12)` | 20 |

Additional literal colors outside tokens: body background gradient stops `rgba(10, 107, 72, 0.22)`, `rgba(255, 179, 0, 0.12)`, `#07090b`, `#050608` (`:46-48`); brand-mark gradient `linear-gradient(145deg, var(--accent), #ff9f68)` (`:166`); brand-mark ink `#160d08` (`:167`, reused `:667, 696`); status-dot ready `#4ade80` (`:207`), connecting `#fbbf24` (`:221`); YouTube link color `#ffb37a` (`:408`); error text `#ffd8d8` (`:613`); YouTube "Connect" text `#ffe8d8` (`:310`).

**Radii:** `--radius-sm: 10px` (21) · `--radius-md: 14px` (22) · `--radius-lg: 20px` (23) · `--radius-pill: 999px` (24).

**Typography:** single font stack `--font: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (`:26`) applied globally via `:root` (`:30`). No second family (no serif/mono anywhere). Font sizes found (rem, ≈16px base): `0.66rem` role labels (`:584`) · `0.68rem` mirror label (`:365`) · `0.72rem` chip meta/panel title/dock hint/pick meta (`:122,185,341,553(meta≈0.72),745`) · `0.78rem` chip label (`:113`) · `0.82rem` youtube-status/status text/memory panel/error banner (`:242,271,391,403,614`) · `0.84rem` btn text (`:298`) · `0.86rem` mirror value/empty copy (`:374,458`) · `0.92rem` panel-title--inline/pick title (`:278,567`) · `0.94rem` message body (`:593`) · `0.95rem` PTT label (`:714`) · `1rem` chat-empty-title/composer textarea (`:450,637`) · `1.05rem` brand mark/h1 (`:168,176`) · `1.2rem` YouTube code (`:419`). No modular scale — values look hand-picked per component, no `--text-*` size tokens (contrast with launcher's `--text-display/title/body/control/caption`, see Part 3).

**Font weights used:** `550, 600, 650, 700, 750, 800, 850` — a fine-grained, non-standard weight ramp (e.g. `550` at `:123`, `650` at `:568`, `750` at `:114,177`, `850` at `:169`). Since only "Inter" is named without a variable-font `font-variation-settings` fallback strategy documented, these odd weights (550/650/750/850) will silently snap to the nearest available static weight (400/500/600/700/800/900) on non-variable-font fallback stacks (`ui-sans-serif, system-ui, ...`).

**Spacing:** rem-based ad hoc values (`0.1rem` … `1.5rem`), no spacing token scale (no `--space-*` custom properties at all, unlike the launcher's `--space-section/rail-header/stack/stack-lg`).

**Focus / active / press states:**

| State | Rule | Line |
|---|---|---|
| Context chip expanded | border → `rgba(255,122,61,0.35)`, bg → `--accent-soft` | 107-110 |
| `.btn:active` | `transform: scale(0.98)` | 303-305 |
| Pick row hover/focus-visible | border → `rgba(255,122,61,0.45)`, bg → `--accent-soft`, `outline: none` | 539-544 |
| Textarea `:focus` | `outline: none`, border → `rgba(255,122,61,0.45)`, bg lightened | 647-651 |
| Textarea `:disabled` | `opacity: 0.5` | 653-655 |
| Send button `:active:not(:disabled)` | `transform: scale(0.94)` | 672-674 |
| Send button `:disabled` | `opacity: 0.45`, `box-shadow: none` | 676-679 |
| PTT `.active` | `transform: scale(0.98)`, inset shadow | 719-724 |

`:focus-visible` is used exactly once (pick-row, `:540`); every other interactive element relies on `outline: none` + a custom border/background swap (textarea `:651`) or has no explicit keyboard-focus treatment at all (context chips, `.btn`, PTT, send button — no `:focus`/`:focus-visible` rule for any of them). Keyboard/switch-control users get no visible focus ring on the chips, buttons, or PTT.

**Transitions/durations:** `background 140ms ease, border-color 140ms ease` (chip, `:104`) · `background 140ms ease, border-color 140ms ease, transform 80ms ease` (btn, `:300`) · `border-color 120ms ease, background 120ms ease` (pick-row, `:536`) · `border-color 140ms ease, background 140ms ease` (textarea, `:640`) · `transform 80ms ease, opacity 140ms ease` (send, `:669`) · `transform 120ms ease, box-shadow 160ms ease` (PTT, `:700`) · `opacity 160ms ease` (ptt-ring, `:710`).

**Keyframe animations:** `pulse-dot` 1.2s/1.4s ease-in-out infinite (status dot busy/connecting, `:225-235,213,222`) · `msg-in` 180ms ease-out (every chat message mounts with a 6px slide+fade, `:466,469-478`) · `ptt-pulse` 1.1s ease-out infinite (active PTT ring, `:728,731-740`).

**`prefers-reduced-motion: reduce`** (`:749-756`): disables `pulse-dot` on both status-dot states, the PTT active ring pulse, and the per-message mount animation. It does **not** touch the `transition:` (non-keyframe) rules — button/chip/textarea press-and-hover transitions (all ≤160ms) still run.

**`prefers-color-scheme`:** no matches anywhere in `style.css` or `index.html` — single fixed dark theme, no light-mode variant.

**Safe-area / viewport / PWA:**

| Check | Finding | Source |
|---|---|---|
| Viewport meta | `width=device-width, initial-scale=1.0, viewport-fit=cover` | `index.html:5` |
| `env(safe-area-inset-*)` | Used twice: top bar (`max(0.85rem, env(safe-area-inset-top))`, `style.css:150`) and bottom dock (`max(0.65rem, env(safe-area-inset-bottom))`, `:599`) | — |
| Dynamic viewport height | `height: 100dvh;` then `height: 100svh;` fallback pair on `.app-shell` | `style.css:67-68` |
| `theme-color` | `#050608` | `index.html:6` |
| `apple-mobile-web-app-capable` | `yes` | `index.html:7` |
| `apple-mobile-web-app-status-bar-style` | `black-translucent` | `index.html:8` |
| `manifest.json` / `<link rel="manifest">` | **Absent** | not found anywhere in `index.html` or `src/companion/` |
| `apple-touch-icon` link | **Absent** | not found |
| Service worker | **Absent** — no registration in `main.ts`, no SW file, no PWA build plugin in `vite.config.ts` or `package.json` | `vite.config.ts:1-9`, `package.json:1-16` |

**Verdict: not an installable PWA.** The iOS-specific meta tags (`apple-mobile-web-app-capable`, status-bar style, `theme-color`) let it run full-screen if manually added to an iOS home screen, but there is no `manifest.json`, so Android/Chrome gets no install prompt, no standalone `display` mode, and neither platform gets a defined home-screen icon — "Add to Home Screen" falls back to a generic bookmark/screenshot icon.

### 1.5 Direct answers

- **One-handed use:** the primary CTA (PTT) and composer+send are full-width at the bottom of the viewport (`style.css:685-701, 622-679`) — good one-handed reach. The two context-bar toggle chips and the nested "Memory" button sit at the top/mid of the screen and require a thumb stretch or grip-shift on larger phones; there's no bottom-sheet or reachability affordance for them.
- **All targets ≥44×44px?** No — the "Memory" toggle is 32px tall (`style.css:318`, §1.2). Every other interactive control meets or exceeds 44px; the send button sits exactly at the 44px floor with no margin.
- **Assumes portrait?** Effectively yes. `.app-shell` is `width: min(100%, 28rem)` (`:66`), a single fixed narrow column with no `@media (orientation: landscape)` rule anywhere in the file (only reduced-motion is a media query, `:749`). In landscape it just centers the same 448px-max column, wasting the rest of the width rather than adapting layout.
- **Handles iOS Safari chrome?** Yes, reasonably: `viewport-fit=cover` + dual `dvh`/`svh` height + explicit `env(safe-area-inset-top/bottom)` padding (`:67-68,150,599`) is the correct modern pattern for the moving Safari toolbar.
- **`prefers-reduced-motion`?** Partially — keyframe animations are disabled (`:749-756`); short hover/press transitions are not (by design, since WCAG treats <200ms micro-transitions as generally exempt, but this is not stated as intentional anywhere in the file).
- **`prefers-color-scheme`?** No — no light-mode branch exists; the app is always dark regardless of system setting.
- **Installable/PWA?** No true manifest-driven install; iOS-only fullscreen-web-app meta tags are present, Android install path is absent (§1.4).

---

## PART 2 — Brand system (defined)

### 2.1 Palette (from `assets/brand/BRAND.md:49-63`)

| Token | Hex/value | Role | Source |
|---|---|---|---|
| Icon canvas | `#0B0B12` | Canvas for all icon/mark SVGs (studio-wide, shared with hum/tir) | `BRAND.md:53` |
| UI canvas | `#050608` | Stated background for "Launcher, companion, overlay" | `BRAND.md:54` |
| Body (amber) | `#FFB300` | Mark fill (sharp pass + inner halo); "launcher eyebrow, focus ring" | `BRAND.md:55` |
| Outer halo (gold) | `#FFD080` | Outer `feGaussianBlur` pass only — never a flat fill | `BRAND.md:56` |
| Launcher text | `#F7F3E8` | Primary copy on TV | `BRAND.md:57` |
| Launcher accent wash | `rgba(10,107,72,0.18)` green + `rgba(255,179,0,0.18)` amber | Background gradients only, explicitly "not on the mark" | `BRAND.md:58` |
| Focus / CTA highlight | `#FFF9C4` | Selected tile, primary button fill | `BRAND.md:59` |

No brand-level tokens exist for: text-secondary, surface/elevated, success, warning, or a semantic danger/error color. The BRAND.md doc itself flags the UI canvas as an **open decision** ("align UI background to `#0B0B12` or keep `#050608`", `BRAND.md:170`) and the type system as unresolved ("commission lowercase mango letterforms or use system UI font at TV scale first", `BRAND.md:171-172`).

### 2.2 Typography (defined)

No in-app UI type scale is defined anywhere in BRAND.md. The only typographic spec is for **marketing/promo assets** (`BRAND.md:306-317`): lowercase voice, weight 200–400, tracking `-0.02em` display / `-0.005em` body, size ≥80pt at full resolution for thumbnail legibility. This does not apply to the launcher or companion UI chrome, which is left to "system UI font at TV scale" per the open decision above.

### 2.3 Logo construction & clear-space

- **Studio-wide recipe** (identical structure across mango/hum/tir): the same path/shape is drawn three times — outer pass (`feGaussianBlur stdDeviation="42"`, opacity 0.7, halo color) → inner pass (`stdDeviation="14"`, saturated color) → sharp top pass (no filter, same saturated color). Confirmed identically in `icon-master.svg:20-27,43-45`, `siblings/hum-icon-master.svg:27-34,36-43`, `siblings/tir-icon-master.svg:64-71,74-85`.
- **Canvas:** `#0B0B12` fixed 1024×1024 `<rect>` behind the mark in every icon SVG (`icon-master.svg:19,28`; all 16 `variations/*.svg`; both `siblings/*.svg`).
- **mango's canonical mark** (`icon-master.svg`) is an "alphonso profile" mango silhouette: a single closed bezier path (`:31-41`), ventral (left) cheek fuller than dorsal (right), stem-end shoulder upper-right, filled `#FFB300` with `#FFD080` outer halo (`:43-45`). No leaf, no seed, no stroke — pure filled silhouette.
- **In-app usage table** (`BRAND.md:135-140`): launcher masthead 64–96px; companion PWA 48px (header favicon + masthead — **not currently implemented**, see §1.4, no icon link exists in `index.html`); overlay toasts 24px; TV boot/splash ≥128px.
- **Clear-space / lockup rule** (`BRAND.md:145-150`, marked "draft"): marketing lockup only — mark left, lowercase "mango" right, 48–56px gap, mark optically centered to wordmark x-height; **in-app TV UI uses wordmark OR mark alone, never stacked together**.
- **Status: unlocked.** BRAND.md's own header states "none locked" (`BRAND.md:3-4`) and the "Open decisions" section (`:167-173`) confirms the mark itself has not been chosen — six round-3 candidates (`var-11` through `var-16`) remain under review in `showcase.html`.

### 2.4 Voice / tone rules

| Rule | Detail | Source |
|---|---|---|
| Case | Product name always lowercase `mango` (never `Mango` in UI chrome) | `BRAND.md:85` |
| Register | lowercase, warm, concise — "couch room, not datacenter" for store/site/launcher copy | `BRAND.md:84` |
| Marketing line | `your couch, your shows, your box.` | `BRAND.md:17,99` |
| Signature lines (verbatim, reusable) | 4 locked lines listed, e.g. "Voice opens, pad plays." | `BRAND.md:236-241` |
| Approved vocabulary | "voice librarian" (not "voice assistant"), "AI catalogs", "verified streams / playability", "thematic rails", "Voice opens, pad plays" | `BRAND.md:221-234` |

### 2.5 Do / don't (anti-positioning)

**Mark/visual don'ts** (`BRAND.md:87-97`): no `smart TV`/`AI box`/`hub` generic category words; no `cutting edge`/`revolutionary` hype; no `game`/`play`/`score`/`race` (tir territory); no `couple`/`partner`/`love`/`relationship` (hum territory); no cartoon leaf or blush-fruit clipart; no play-button/remote iconography clichés; hum's rose `#FF8E9B` and tir's cyan `#00E5FF` are explicitly forbidden on the mango mark.

**Marketing-copy don'ts** (`BRAND.md:204-219`): no named-competitor "killer" claims, no piracy-adjacent phrasing ("free movies"/"watch anything free"), no "cut the cord", no unsubstantiated superlatives, no "voice plays" (voice opens detail only, pad plays — locked input contract), no "4K HDR" as a current feature, no "plug-and-play", no date/availability promises, no vague AI hype, no Hinglish slang (`bhai`, `yaar`, `boss`, `bro`, `let's go!`).

**Do:** name the hardware (`Pi 5 (8 GB)`), name the audience (`single household · India-first · 10-foot UI`), use the 4 locked signature lines verbatim per channel (`BRAND.md:296-304`), keep one accent per marketing asset (`BRAND.md:317`).

### 2.6 Studio-sibling accent registry (`BRAND.md:154-158,164`)

| App | Accent name | Hex | Mark primitive |
|---|---|---|---|
| hum | rose | `#FF8E9B` | sine wave |
| tir | cyan | `#00E5FF` | ring + dot |
| mango | amber | `#FFB300` | TBD — pick from showcase |

Hue separation rule: mango amber (~45°) must sit ≥60° from hum rose (~350°) and tir cyan (~185°) (`BRAND.md:164-165`).

### 2.7 SVG inventory (`assets/brand/`)

All 20 SVGs share the identical technical recipe from §2.3 (1024×1024 canvas, `#0B0B12` background rect, `feGaussianBlur` outer/inner defs, triple-draw). Differences are silhouette/geometry only:

| File | Construction |
|---|---|
| `icon-master.svg` | Canonical "alphonso" filled path silhouette, `#FFB300`/`#FFD080` |
| `icon-alternate-totapuri.svg` | Alternate elongated silhouette with a hooked "parrot-beak" tip; same fill/halo colors |
| `siblings/hum-icon-master.svg` | Single-period sine-wave **stroke** (not filled shape), `stroke-width 40`, rose `#FF8E9B`/coral `#FFB392` halo |
| `siblings/tir-icon-master.svg` | Concentric ring (`stroke`) + off-center filled dot, cyan `#00E5FF`/light-cyan `#66F0FF` halo; geometry documented in-file to sub-pixel precision (ring r=320, dot r=84 at cx=620,cy=400) |
| `variations/var-01-botanica.svg` | Ovate-oblique filled silhouette, amber/gold, near-identical curve family to `icon-master` |
| `variations/var-02-golden-slice.svg` | Cheek wedge (pac-man-like arc) with a circular seed-hole cutout (`fill-rule="evenodd"`) |
| `variations/var-03-couch-ember.svg` | Rounded-rect "TV screen" outline + off-center filled dot (literal screen-glow metaphor) |
| `variations/var-04-seed-orbit.svg` | Full ring + oblong seed-shaped void cut out of it (`evenodd`) |
| `variations/var-05-warm-pulse.svg` | Open double-wave stroke, explicitly "hum cousin" motif in amber |
| `variations/var-06-wall-wash.svg` | Open low arc stroke (light-spill-on-wall metaphor) |
| `variations/var-07-little-blip.svg` | Filled circle with a bite/notch cut from the upper-right (asymmetry study) |
| `variations/var-08-ventral-arc.svg` | Open S-curve stroke, not a closed/filled shape |
| `variations/var-09-lamp-cone.svg` | Two diverging straight-ish strokes from a single base point (lamp-cone metaphor) |
| `variations/var-10-pit-ember.svg` | Open crown arc + separate filled circle below it (inverse of tir's ring+dot) |
| `variations/var-11-alphonso-soft.svg` | Ovate-oblique filled silhouette, ventral swell, rounded shoulder (round-3 "featured" candidate) |
| `variations/var-12-totapuri-beak.svg` | Elongated filled silhouette with hooked beak (round-3 "featured" candidate) |
| `variations/var-13-kesar-round.svg` | Plumper, rounder oval filled silhouette, less waist pinch |
| `variations/var-14-banganapalli.svg` | Tall oblong filled silhouette, gentle shoulder |
| `variations/var-15-chunky-icon.svg` | Simplified, fewer-curve bold filled silhouette (designed for 32px legibility) |
| `variations/var-16-half-cheek.svg` | Half-fruit "peeled cheek" silhouette with a circular seed-hole cutout (`evenodd`) |

All 16 `variations/*` and both `icon-master.svg`/`icon-alternate-totapuri.svg` use the exact same two hex values (`#FFB300` fill, `#FFD080` halo) — the palette is locked even though the silhouette is not. The two `siblings/*` files confirm the cross-app recipe (canvas + dual-halo) is shared, while each app's accent hue is isolated (rose vs cyan vs amber).

---

## PART 3 — Brand vs. launcher vs. companion: the drift table

Launcher values below are the `:root` token declarations only, `src/launcher/src/style.css:1-48` (plus `:261-262` for two component-scoped custom properties found via the same grep).

| Role | Brand-defined | Launcher actual | Companion actual | Verdict |
|---|---|---|---|---|
| Background (base/UI canvas) | `#050608` — "Launcher, companion, overlay" (`BRAND.md:54`) | `--bg-base: #07080a` (`style.css:9`, commented "Cinema Dark tokens — locked 2026-07-05") | `--bg-base: #050608` (`style.css:2`) | **DRIFT** (launcher) / **MATCH** (companion). Launcher silently replaced the brand-specified canvas with a separate "Cinema Dark" value dated *after* the brand doc; BRAND.md was never updated. |
| Icon canvas | `#0B0B12` (`BRAND.md:53`) | not used as a token (launcher is a web UI, not an icon canvas) | not used | n/a (icon-only role) |
| Surface / elevated | not defined at brand level | `--bg-elevated: #12151a` (solid hex, `:10`) | `--bg-elevated: rgba(255,250,240,0.06)` (translucent warm-white wash, `:3`) | Brand **MISSING**; launcher vs companion **DRIFT** (opposite techniques: solid dark hex vs. alpha-blended light-on-dark) |
| Text primary | `#F7F3E8` ("Launcher text", `BRAND.md:57`) | `--text-primary: #f4f1ea` (`:12`) | `--text-primary: #f7f3e8` (`:7`) | **DRIFT** (launcher, off by a few hex steps from its own brand spec) / **MATCH** (companion, exact) |
| Text secondary | not defined | `--text-secondary: rgba(244,241,234,0.68)` (opacity-based, `:13`) | `--text-secondary: #a8b4ad` (solid, greenish-gray, `:8`) | Brand **MISSING**; launcher vs companion **DRIFT** (different technique and different hue — companion's secondary text is tinted toward the mint accent, launcher's is a pure opacity ramp of its primary) |
| Accent | `#FFB300` amber, "Body" (`BRAND.md:55,158`); also the sibling-registry locked value | `--accent: #e8a020` (`:15`) | `--accent: #ff7a3d` (`:10`) | **DRIFT × 2 — the worst one.** Three different hues in one product: brand amber `#FFB300` (~45°) → launcher `#e8a020` (~38°, darker/more saturated amber) → companion `#ff7a3d` (~19°, shifted all the way to orange). Companion's accent is closer to a coral/orange than to the studio's locked amber. |
| Focus / CTA highlight | `#FFF9C4` pale yellow (`BRAND.md:59`) | Focus ring uses `var(--accent)` = `#e8a020` (`style.css:152` in launcher, outside excerpted range but token-driven) | Focus/active states use `var(--accent)` = `#ff7a3d` (`:541,649`) | **DRIFT** on both — neither surface uses the brand's dedicated `#FFF9C4` focus color; both just reuse their own (already-drifted) accent token instead of a distinct focus color |
| Success | not defined as a named token; brand only mentions green as a background-wash color `rgba(10,107,72,0.18)` (`BRAND.md:58`) | **No `--success`/green token in the root block at all** (confirmed: zero matches for "success" in the file) | `--green: #0a6b48` / `--green-soft: rgba(10,107,72,0.2)` (`:15-16`), used for the "tool done" success state | Brand **MISSING** (wash-only, not semantic) — but companion's `--green` (`0a6b48` = rgb(10,107,72)) is an **exact hex match** to the brand's wash color, while launcher defines **no equivalent token at all** → **MATCH** (companion↔brand hue) / **MISSING** (launcher) |
| Warning | not defined anywhere | **absent** | **absent** | **MISSING** everywhere — no surface has a warning color |
| Danger / error | not defined at brand level | **absent** as a token — zero matches for "danger"/"error"/"warning" in the entire 2440-line file (grepped) | `--danger: #ff6b6b` / `--danger-soft: rgba(255,107,107,0.14)` (`:17-18`), used for the error banner | Brand **MISSING**; launcher **MISSING** (no semantic error color defined at all in tokens); companion is the only surface with one |
| Font family (UI) | not defined — open decision, "system UI font at TV scale first" (`BRAND.md:171-172`) | `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (`:4-6`) | identical stack: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (`:26`) | Brand **MISSING**; launcher **MATCHES** companion exactly (both independently converged on the same Inter stack, but nothing in BRAND.md sanctions it) |
| Font size scale | not defined for UI (only a promo-asset spec: ≥80pt thumbnails, `BRAND.md:313`) | Named token scale: `--text-display:56px / --text-title:28px / --text-body:26px / --text-control:22px / --text-caption:20px` (`:28-32`) | No token scale at all — ad hoc rem values per component (`0.66rem`…`1.2rem`, §1.4) | Brand **MISSING**; launcher has a real 5-step type scale; companion has **no type scale**, just per-component literals → **DRIFT** in methodology (tokenized vs untokenized), not just values |
| Radius | not defined at brand level | `--radius-poster:12px / --radius-control:999px / --radius-panel:16px` (`:41-43`) | `--radius-sm:10px / --radius-md:14px / --radius-lg:20px / --radius-pill:999px` (`style.css:21-24`) | Brand **MISSING**; launcher vs companion **DRIFT** (different scale, different step count; only the pill radius `999px` matches by convention) |

### Bottom line

mango does **not** have one design system — it has **three**, and the accent color is the clearest proof: brand doc says amber `#FFB300`, the launcher (which the brand doc itself names as the canonical `#050608` surface) uses a darker amber `#e8a020` on a *different* background `#07080a`, and the companion uses an orange-shifted `#ff7a3d` on the *brand-correct* `#050608` background. No two of the three amber/accent values match, and no semantic warning color exists on any surface. The companion is closer to the brand doc on background and primary text (exact matches); the launcher is closer on accent hue and has the only real typographic scale — but neither fully implements what BRAND.md specifies, and BRAND.md's own "open decisions" section (mark unlocked, UI canvas unresolved, type system unresolved) confirms the brand system itself is still in draft.
