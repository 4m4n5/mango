# Mango launcher — visual design system extraction

**Source:** `src/launcher/src/style.css` (2440 lines) · `src/launcher/index.html` · `src/launcher/src/*.ts`  
**Extracted:** 2026-07-30 · Mechanical audit — exact values and line citations only.

---

## Runtime / non-CSS sources

| Source | What | Value / behavior | Lines |
|--------|------|------------------|-------|
| `index.html` | Inline `body` style | `margin:0; background:#07080a` | index.html:8 |
| `layout.ts` | `track.style.setProperty("--rail-cols", …)` | `9` (portrait) or `6` (landscape) | layout.ts:5–8 |
| `home.ts` | `progress.style.setProperty("--progress", …)` | `0%`–`100%` width for poster progress bar | home.ts:319, 339 |
| `main.ts` et al. | `classList.add/remove("focused")` | Toggles `.focused` pseudo-focus (no inline styles) | main.ts, detail.ts, search.ts, next-prompt.ts |
| `poster.ts` | `classList.add("poster-image--missing")` | Sets `opacity: 0` via class | poster.ts:28 · style.css:2221–2223 |

No `cssText` usage in launcher `src/*.ts`.

---

## 1. COLOR

### 1a. CSS custom properties

| Token | Value | Defined | Used (style.css lines) |
|-------|-------|---------|------------------------|
| `--bg-base` | `#07080a` | 9 | 2, 10, 70, 703, 711, 939, 1000, 2211 |
| `--bg-elevated` | `#12151a` | 10 | 879, 904, 917, 932, 961, 1222, 1246, 1299, 1352, 1497, 1847, 2000, 2050, 2253 |
| `--bg-overlay` | `rgba(7, 8, 10, 0.94)` | 11 | 1407, 1837 |
| `--text-primary` | `#f4f1ea` | 12 | 2, 108, 151, 192, 229, 325, 393, 404, 670, 767, 886, 916, 1000, 1193, 1223, 1313, 1368, 1450+, 1560, 1721, 1866, 1880, 1950, 1999, 2253, 2271, 2286, 2389, 2423 |
| `--text-secondary` | `rgba(244, 241, 234, 0.68)` | 13 | 132, 175, 217, 379, 747, 811, 894, 903, 1050, 1116, 1184, 1278, 1332, 1374, 1559, 1693, 1742, 1790, 1807, 1879, 1949, 2051, 2088, 2111, 2128, 2151, 2342, 2431 |
| `--text-muted` | `rgba(244, 241, 234, 0.45)` | 14 | 340, 452, 594, 607, 1202, 1273, 1374, 1569, 1880, 1949, 2111, 2133, 2139, 2381 |
| `--accent` | `#e8a020` | 15 | 149, 191, 193, 227, 317, 350, 391, 414, 479, 519, 569, 661, 715, 810, 976, 997, 999, 1039, 1150, 1233, 1238, 1255, 1360, 1384, 1558, 1643, 1720, 1760, 1796, 1821, 1894, 1924, 2013, 2014, 2020, 2071, 2079, 2157, 2229, 2419, 2427 |
| `--accent-soft` | `rgba(232, 160, 32, 0.16)` | 16 | 150, 193, 228, 392, 556, 1239, 1383, 1727, 1797, 1827, 1893, 2070 |
| `--accent-glow` | `rgba(232, 160, 32, 0.42)` | 17 | 152, 194, 230, 415, 662, 977, 1040, 1234, 1722, 1761, 1822, 2021, 2158, 2239 |
| `--tab-active-fill` | `rgba(255, 255, 255, 0.08)` | 18 | 199, 1712 |
| `--border-subtle` | `rgba(255, 255, 255, 0.08)` | 19 | 129, 172, 214, 744, 880, 905, 918, 960, 1220, 1245, 1297, 1349, 1696, 1749, 1774, 2001, 2048, 2140, 2254 |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | 20 | 198, 1495, 1848, 2284, 2314 |
| `--search-line` | `rgba(255, 255, 255, 0.09)` | 261 | 287, 376, 512, 530, 566 |
| `--search-key` | `#17191c` | 262 | 378, 471 |

### 1b. Distinct literal colors by semantic role

#### Background layers

| Value | Role | Lines |
|-------|------|-------|
| `#07080a` | Base (duplicate of `--bg-base`; also index.html:8) | 9, index.html:8 |
| `#12151a` | Elevated surface token | 10 |
| `#121417` | Search query shell | 300 |
| `#101417` | Poster image placeholder | 1056 |
| `#17191c` | Search key background (`--search-key`) | 262, 378, 471 |
| `rgba(7, 8, 10, 0.94)` | Full-screen overlay token | 11 |
| `rgba(7, 8, 10, 0.98)` | Search results sticky toolbar fade | 645 |
| `rgba(5, 8, 10, 0.92)` | Toast, poster shade, card-verify-badge | 1063, 2283 |
| `rgba(5, 8, 10, 0.9)` | Voice HUD | 2313 |
| `rgba(5, 8, 10, 0.72)` | Card verify badge | 1923 |
| `rgba(0, 0, 0, 0.45)` | Body bottom radial | 69 |
| `rgba(29, 38, 40, 0.96)` | Search “more” card gradient stop | 703, 711 |
| `rgba(33, 42, 44, 0.92)` | Portrait poster fallback gradient | 939, 2211 |
| `transparent` | Gradients, borders, masks | 68–69, 131, 174, 270, 549–550, 631, 645, 702–703, 710–711, 949, 974, 1036, 1047, 1063–1064, 1667–1677, 1979, 2146 |

#### Surface / card (white alpha overlays)

| Value | Lines |
|-------|-------|
| `rgba(255, 255, 255, 0.03)` | 68 |
| `rgba(255, 255, 255, 0.035)` | 216 |
| `rgba(255, 255, 255, 0.025)` | 746 |
| `rgba(255, 255, 255, 0.04)` | 1222, 1246, 1299, 1352, 1695, 1748, 1773 |
| `rgba(255, 255, 255, 0.045)` | 687, 1299 |
| `rgba(255, 255, 255, 0.05)` | 568 |
| `rgba(255, 255, 255, 0.06)` | 2087, 2150 |
| `rgba(255, 255, 255, 0.075)` | 498, 511 |
| `rgba(255, 255, 255, 0.08)` | 18–19 (tokens `--tab-active-fill`, `--border-subtle`) |
| `rgba(255, 255, 255, 0.09)` | 261 (`--search-line`) |
| `rgba(255, 255, 255, 0.115)` | 469 |
| `rgba(255, 255, 255, 0.14)` | 298, 1090 |
| `rgba(255, 255, 255, 0.16)` | 20 (`--border-strong`) |
| `rgba(0, 0, 0, 0.18)` | 1064 |

#### Text

| Value | Role | Lines |
|-------|------|-------|
| `#f4f1ea` | Primary (token) | 12 |
| `rgba(244, 241, 234, 0.68)` | Secondary (token) | 13 |
| `rgba(244, 241, 234, 0.45)` | Muted (token) | 14 |
| `rgba(244, 241, 234, 0.82)` | Search key label | 472 |
| `#17120a` | Search key focused text | 480, 520 |
| `#fff` | Live pill text | 1014 |

#### Accent / brand

| Value | Lines |
|-------|-------|
| `#e8a020` | 15 (token) |
| `rgba(232, 160, 32, 0.055)` | 270 |
| `rgba(232, 160, 32, 0.1)` | 403, 1309 |
| `rgba(232, 160, 32, 0.16)` | 16 (token `--accent-soft`), 556 |
| `rgba(232, 160, 32, 0.18)` | 392 |
| `rgba(232, 160, 32, 0.2)` | 397 |
| `rgba(232, 160, 32, 0.3)` | 484 |
| `rgba(232, 160, 32, 0.35)` | 780 |
| `rgba(232, 160, 32, 0.38)` | 402 |
| `rgba(232, 160, 32, 0.42)` | 17 (token `--accent-glow`) |
| `rgba(232, 160, 32, 0.56)` | 614 |
| `rgba(232, 160, 32, 0.65)` | 762 |
| `#ffd278` | Search key focus ring (not `--accent`) | 482 |

#### Focus (ring uses accent tokens; see §4)

#### Success

| Value | Lines |
|-------|-------|
| `#22c55e` | 1356 |
| `rgba(34, 197, 94, 0.42)` | 1303 |
| `rgba(34, 197, 94, 0.1)` | 1304 |
| `rgba(80, 220, 150, 0.16)` | 2101 |
| `#66e0a3` | 2102 |
| `#80ed99` | 2364 |

#### Warning

| Value | Lines |
|-------|-------|
| `#ffb703` | 2354 |
| `rgba(255, 196, 84, 0.16)` | 2096 |
| `#ffcf7a` | 2097 |
| `rgba(232, 160, 32, 0.42)` | 1308 (reliability yellow border — same hue as accent) |

#### Danger

| Value | Lines |
|-------|-------|
| `rgba(220, 38, 38, 0.92)` | 1013 |
| `#f87171` | 1364 |
| `rgba(248, 113, 113, 0.52)` | 1313 |
| `rgba(248, 113, 113, 0.2)` | 1391 |
| `#fecaca` | 1392 |
| `rgba(127, 29, 29, 0.26)` | 1314 |

#### Badge / status colors

| Value | Role | Lines |
|-------|------|-------|
| `#8ecae6` | Verify queued, voice thinking dot | 1911, 1942, 2359 |
| `rgba(142, 202, 230, 0.16)` | Verify queued bg | 1910 |
| `rgba(85, 227, 190, 0.16)` | Search “more” teal glow | 702, 710 |
| `rgba(56, 189, 248, 0.65)` | Settings quick-action left border | 1251 |
| `rgba(167, 139, 250, 0.65)` | Settings overnight left border | 1259 |
| `#607d8b` | Voice idle dot | 2349 |
| `rgba(96, 125, 139, 0.8)` | Voice idle glow | 2350 |
| `rgba(255, 183, 3, 0.92)` | Voice listening glow | 2355 |
| `rgba(142, 202, 230, 0.92)` | Voice thinking glow | 2360 |
| `rgba(128, 237, 153, 0.92)` | Voice speaking glow | 2365 |

#### Overlay / scrim / mask

| Value | Lines |
|-------|-------|
| `black` | Search results mask | 631 |
| `#000` | Season list horizontal mask | 1668–1669, 1675–1676 |
| Box-shadow blacks | See §6 |

---

## 2. TYPOGRAPHY

### 2a. Font families

| Value | Lines |
|-------|-------|
| `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` | 4–5 |
| `font: inherit` on `button` | 74 |

### 2b. Type scale tokens (`:root`)

| Token | Value | Lines |
|-------|-------|-------|
| `--text-display` | `56px` | 28 |
| `--text-title` | `28px` | 29 |
| `--text-body` | `26px` | 30 |
| `--text-control` | `22px` | 31 |
| `--text-caption` | `20px` | 32 |

### 2c. Font sizes (largest → smallest)

| Resolved / declared size | Selector / element | Lines |
|--------------------------|-------------------|-------|
| `5.4rem` (~86.4px at 16px root) | `h1` | 1160 |
| `clamp(2rem, 3.2vw, var(--text-display))` → 32px–56px | `#detail-title` | 1167 |
| `clamp(2rem, 3vw, var(--text-display))` | `#settings-view h1`, `#next-prompt-title` | 1859, 2192 |
| `clamp(2rem, 8vw, 3.4rem)` | `.detail-poster-wrap .poster-fallback` | 2206 |
| `var(--text-display)` `56px` | via clamps above | 28, 1167, 1859, 2192 |
| `clamp(2rem, 4vw, 3.25rem)` | `.search-more-glyph` | 716 |
| `1.75rem` | `.search-message h2` | 768 |
| `var(--text-title)` `28px` | `.empty-state-title`, `.card-title`, `.settings-heading` | 887, 1108, 1190 |
| `calc(var(--text-title) - 4px)` → `24px` | `.card--app .card-title` | 1132 |
| `1.5rem` | `.settings-action-title` | 1267 |
| `1.45rem` | `.eyebrow`, `.next-prompt-meta` | 1151, 1867 |
| `1.35rem` | `.settings-note`, `.search-results .rail-title` | 671, 1185 |
| `clamp(1.55rem, 2vw, 2.15rem)` | `.search-query` | 326 |
| `var(--text-body)` `26px` | `.detail-description`, `.info-list dd` | 1950, 2269 |
| `var(--text-control)` `22px` | `.browse-brand`, `.browse-shuffle`, `.browse-tab`, `.browse-search`, `.rail-title`, detail labels | 109, 134, 177, 219, 812, 1560, 1645, 2003 |
| `calc(var(--text-caption) + 2px)` → `22px` | `.card--landscape .card-title` | 1122 |
| `1.25rem` | `.search-key` | 473 |
| `1.2rem` | `.settings-action-body` | 1277 |
| `1.16rem` | `.reliability-copy` | 1333 |
| `1.15rem` | `.browse-shuffle-icon`, `.settings-action-meta`, `.reliability-card-title`, `.detail-episode` | 160, 1272, 1369, 1776 |
| `1.1rem` | `.search-panel-head h2`, `.search-message p`, `.rail-empty`, `.voice-state` | 445, 773, 907, 2338 |
| `1.05rem` | `.search-starter-title` | 589 |
| `1rem` | `.search-control`, `.search-starter-empty p`, `.detail-episode-progress`, `.reliability-card-summary` | 382, 620, 1791, 1375 |
| `var(--text-caption)` `20px` | subtitles, meta, badges, toast, etc. | 895, 1136, 1176, 1570, 1698, 1743, 1855, 1880, 2260, 2287 |
| `calc(var(--text-caption) - 2px)` → `18px` | `.card-subtitle`, `.settings-subheading` | 1117, 1198 |
| `0.95rem` | `.browse-shuffle-label`, `.search-results-state`, `.detail-stream-res` | 165, 653, 2072 |
| `0.92rem` | `.search-retry-youtube` | 688 |
| `0.9rem` | `.reliability-status`, `.detail-stream-secondary` | 1324, 2112 |
| `0.88rem` | `.search-degraded` | 781 |
| `0.86rem` | `.search-starter-meta` | 595 |
| `0.85rem` | `.card--poster.card--saved::after`, `.verify-badge`, `.detail-episode-stream-badge` | 1001, 1895, 1808 |
| `0.82rem` | `.search-panel-head p`, `.card-health-badge` | 453, 1385 |
| `0.8rem` | `.detail-stream-chip` | 2089 |
| `calc(var(--text-caption) - 4px)` → `16px` | `.card--landscape .card-subtitle` | 1127 |
| `clamp(0.82rem, 1.05vw, 0.98rem)` | `.card--related .card-title` | 1594 |
| `clamp(0.7rem, 0.9vw, 0.82rem)` | `.card--related .card-subtitle` | 1599 |
| `clamp(1.4rem, 4vw, 2.4rem)` | `.card--poster .poster-fallback` | 2218 |
| `0.72rem` | `.card-live-pill` | 1015 |
| `0.7rem` | `.card-verify-badge` | 1925 |
| `24px` | `.voice-text` | 2386 |
| `3.1rem` (media ≤900px) | `h1`, `.masthead--compact h1` | 2396 |

### 2d. Font weights

| Weight | Lines |
|--------|-------|
| `900` | 888, 1002, 1325, 1386, 1744, 1792, 2073, 2207 |
| `800` | 110, 813, 908, 1016, 1109, 1152, 1369, 1370, 1386, 1699, 1868, 1896, 1926, 2090, 2232, 2270, 2288, 2339, 2378, 2387 |
| `780` | 474 |
| `700` | 220, 446, 813, 896, 1177, 1191, 1561, 1646, 1777, 1809, 1881, 2004, 2113, 2185, 2232, 2261 |
| `690` | 383 |
| `680` | 327 |
| `670` | 654 |
| `660` | 590 |
| `620` | 596 |
| `600` | 135, 178, 1118, 1199, 1268, 1571, 1881, 1951 |
| `560` | 454 |
| `520` | 341 |
| `500` | 717 |

### 2e. Line heights

| Value | Lines |
|-------|-------|
| `0.98` | 1161 |
| `1` | 161, 718 |
| `1.08` | 1168, 1860, 2193 |
| `1.1` | 889 |
| `1.15` | 1110 |
| `1.2` | 1595 |
| `1.25` | 1376 |
| `1.28` | 2388 |
| `1.35` | 1279, 1334 |
| `1.45` | 621 |
| `1.48` | 1952 |

### 2f. Letter spacing

| Value | Lines |
|-------|-------|
| `-0.025em` | 328 |
| `-0.015em` | 447 |
| `-0.01em` | 672 |
| `0` | 1162 |
| `0.01em` | 384 |
| `0.02em` | 179, 1700, 1745, 1810, 1897, 1927, 2074, 2091, 2113, 2135, 2262, 2289 |
| `0.025em` | 597 |
| `0.03em` | 1387, 2123 |
| `0.04em` | 111, 136, 166, 814, 1154, 1178, 1200, 1562, 1647, 2186, 2208, 2217, 2340 |
| `0.06em` | 2379 |
| `0.08em` | 166, 1017, 1326 |

### 2g. Text transforms

| Value | Representative lines |
|-------|---------------------|
| `lowercase` | 112, 137, 180, 221, 1018, 1137, 1563, 1648, 1701, 1898, 2005, 2103, 2195, 2233, 2341, 2380 |
| `uppercase` | 1328, 2122 |
| `none` | 815, 1153, 1175, 1192, 1201, 1746, 1854, 2183, 2209, 2216, 2263 |

---

## 3. SPACING & SIZING

### 3a. Spacing tokens (`:root`)

| Token | Value | Lines |
|-------|-------|-------|
| `--safe-x` | `48px` | 21, 80, 1405 |
| `--safe-y` | `32px` | 22, 80, 1405 |
| `--focus-ring` | `3px` | 23, 152, 194, 230, 395, 482, 538, 976, 1039, 1234, 1722, 1761, 1822, 2021, 2158, 2239 |
| `--focus-glow` | `14px` | 24, 152, 194, 230, 396, 977, 1040, 1234, 1722, 1761, 1822, 2021, 2158, 2239 |
| `--focus-gutter` | `calc(var(--focus-glow) + 8px)` → `22px` | 25, 243–246, 258, 430, 538, 643–644, 823–824, 864–865, 946–947, 1522–1523, 1579–1580, 1617, 1658–1659 |
| `--space-section` | `3rem` | 33, 39 |
| `--space-rail-header` | `0.85rem` | 34, 804, 808, 1551, 1641 |
| `--space-stack` | `1rem` | 35, 878, 902, 1516, 2177 |
| `--space-stack-lg` | `1.5rem` | 36, 1609 |
| `--detail-related-gap` | `1.15rem` | 37 (defined; no other references in file) |
| `--card-gap` | `20px` | 40, 821, 1577 |
| `--rail-accent-width` | `3px` | 38, 810, 1558, 1568, 1643 |

### 3b. Padding values

| Value | Selector / context | Lines |
|-------|-------------------|-------|
| `var(--safe-y) var(--safe-x)` → `32px 48px` | `.shell`, `.detail` | 80, 1405 |
| `0` | `.search-head`, `.card`, `.detail-copy` offset | 286, 914, 1528 |
| `0 0 1rem` | `.search-head` | 286 |
| `0.35rem` | `.browse-bar` pb; search keyboard/starters | 102, 430, 529 |
| `0.55rem 0.95rem` | `.browse-shuffle` | 133 |
| `0.65rem 1.4rem` | `.browse-tab` | 176 |
| `0.65rem 1.15rem` | `.browse-search` | 218 |
| `0.65rem 0.8rem 0.65rem 1.1rem` | `.search-query-shell` | 297 |
| `0.5rem 0.95rem` | `.search-control`, `.detail-season-chip` | 381, 1692 |
| `0.48rem 0.55rem` | `.search-starter` | 548 |
| `2rem` | `.search-starter-empty`, `.next-prompt-card` | 606, 1846 |
| `3rem` | `.search-message` | 756 |
| `var(--space-stack) var(--space-stack-lg)` | `.empty-state` | 878 |
| `var(--space-stack)` | `.rail-empty` | 902 |
| `1rem 1rem 1.1rem` | `.poster-content` | 1075 |
| `1.4rem 1.5rem` | `.card--app` | 1024 |
| `1.1rem 1.4rem` | `.settings-action` | 1219 |
| `1.05rem 1.25rem` | `.reliability-summary` | 1296 |
| `0.9rem 1rem` | `.reliability-card` | 1348 |
| `0.85rem 1rem` | `.detail-episode` | 1770 |
| `0.85rem 1.35rem` | `.detail-button`, `.back-button` | 1998, 2227 |
| `0.7rem 0.9rem` | `.detail-stream` | 2047 |
| `0.85rem 1.4rem` | `.toast` | 2282 |
| `16px 20px 18px` | `.voice-hud` | 2312 |
| `8vh 7vw` | `.next-prompt` | 1836 |
| `14vh` pb | `.settings` | 2170 |
| `var(--focus-gutter)` | rails, tracks, detail copy/side | 243–246, 823, 864, 946, 1522, 1579, 1617, 1658 |
| `padding-block-end: calc(var(--focus-gutter) * 2 + 2.5rem)` | `.rails` | 244 |
| `padding-inline: var(--focus-gutter)` | `.rails`, `.detail-side` | 245, 1617 |
| `0.45rem var(--focus-gutter) 0.6rem` | `.search-results-toolbar` | 643 |
| `0.35rem 0 0.5rem 1.5rem` | `.search-discovery` | 529 |
| `0.35rem 0.2rem var(--focus-gutter) 0` | `.search-keyboard` | 430 |
| `padding-top: 1rem` | `.search-compose-body` | 425 |
| `padding-top: 0.15rem` | `.detail-copy` (related visible) | 1528 |
| `0.55rem 0.75rem` | `.detail-season-header` | 1741 |
| `0.38rem 0.7rem` | `.reliability-status` | 1320 |
| `0.28rem 0.55rem` / `0.28rem 0.7rem` | badges | 1381, 1891 |
| `0.2rem 0.55rem` / `0.2rem 0.5rem` | live pill, verify badge | 1011, 1921 |
| `0.18rem 0.45rem` | `.detail-stream-chip` | 2085 |
| `0.2rem 0.5rem` | `.detail-stream-res` | 2068 |
| `1.4rem` | `.info-list div` | 2252 |
| `padding-left: 0.85rem` | rail/detail labels | 809, 1557, 1642 |
| `padding-left: calc(0.85rem + var(--rail-accent-width))` | `.detail-related-context` | 1568 |

### 3c. Margin values

| Value | Lines |
|-------|-------|
| `0` | 65, 107, 443, 451, 619, 766, 885, 901, 913, 1159, 1166, 1174, 1183, 1861 |
| `margin: 0` resets | widespread |
| `1.5rem max(var(--focus-gutter), 3vw) var(--focus-gutter)` | `.search` | 258 |
| `calc(-1 * var(--focus-gutter))` negative | rails, tracks, toolbars | 246, 644, 824, 865, 947, 1523, 1580, 1659 |
| `0.6rem 0 0` | `.empty-state-body` | 893 |
| `2rem 0 0.5rem` | `.settings-heading` | 1189 |
| `0.75rem 0 0` | `.settings-subheading` | 1197 |
| `1.2rem 0 0.4rem` | `.detail-season-header` | 1740 |
| `0.8rem 0 0` | `.next-prompt-meta` | 1865 |
| `1.8rem` mt | `.next-prompt-actions` | 1874 |
| `0.35rem 0 0` | `.detail-actions`, `.search-message p` | 772, 1964 |
| `0 0 var(--space-rail-header)` | rail titles | 808, 1551, 1641 |
| `margin-top: 1rem` | `.settings-refresh` | 1210 |
| `margin-left: auto` | shuffle, retry youtube | 125, 685 |
| `margin-top: 0.5rem` | `.search-results` | 626 |
| `scroll-padding-block-start: 3.25rem` | `.rails` | 249 |
| `scroll-padding-block-end: var(--focus-gutter)` / `5rem` | `.rails`, `.search-results` | 250, 630 |
| `scroll-padding-inline: 2rem` | `.detail-season-list` | 1660 |
| `scroll-margin-inline: 2rem` | `.detail-season-chip` | 1702 |

### 3d. Gap values

| Value | Lines |
|-------|-------|
| `2.5vh` | `.view` | 87 |
| `0.6rem` | `.home`, `.search-scopes`, `.search-results-state` | 93, 362, 651 |
| `1.25rem` | `.browse-bar`, `.search-results` | 99, 629 |
| `1rem` | tabs, panels, actions | 117, 437, 1285, 1295, 1609, 1768, 1873, 1962 |
| `0.45rem` | shuffle, retry, edit | 127, 684, 733 |
| `0.5rem` | browse-search, card--app, season list | 212, 1028, 1654 |
| `var(--rail-gap)` / `3rem` | `.rails` | 237 |
| `var(--card-gap)` / `20px` | poster grid, related | 821, 1577 |
| `1.4vw` | non-poster rail track | 862 |
| `calc(var(--card-gap) * 0.85)` → `17px` | `.detail-related-track` | 1577 |
| `clamp(1.5rem, 2vw, 2.25rem)` | search compose | 422 |
| `clamp(1.15rem, 2.8vh, 1.75rem)` | detail main (related) | 1465 |
| `clamp(1.75rem, 3.5vw, 3rem)` | detail grid column-gap | 1403, 1475 |
| `0.55rem` | key rows, episode list | 458, 1733 |
| `0.3rem` | starter track | 535 |
| `0.18rem` | starter copy | 581 |
| `0.35rem` | poster content, settings | 1074, 1217, 1347 |
| `0.15rem` | related head | 1550 |
| `0.75rem` | reliability grid, settings row | 1285, 1340 |
| `0.85rem` | settings actions row | 1285 |
| `1.4rem` | search message | 755 |
| `0.9rem` | starter empty | 605 |
| `12px` | voice hud head/lines | 2333, 2371 |

### 3e. Border radius

| Value | Lines |
|-------|-------|
| `var(--radius-control)` / `999px` | 42–43, 130, 173, 215, 371, 677, 686, 735, 998, 1012, 1321, 1382, 1697, 1892, 1905, 1922, 1937, 2285, 2348 |
| `var(--radius-panel)` / `16px` | 43, 745, 881, 906, 1029, 1496, 1849, 2002, 2049, 2231, 2255 |
| `var(--radius-poster)` / `12px` | 41, 919, 959, 1775 |
| `22px` | `.voice-hud` | 2315 |
| `16px` | `.search-query-shell` | 299 |
| `11px` | `.search-control` | 377 |
| `10px` | `.search-key`, `.detail-season-header` | 470, 1750 |
| `9px` | `.search-starter-icon` | 567 |
| `8px` | `.detail-stream-res` | 2069 |
| `7px` | `.detail-stream-chip` | 2086 |
| `3px` | `.search-query-caret` | 349 |
| `50%` | chips, dots, spinner | 413, 660, 1980 |
| `0.75rem` (12px) | `.settings-action` | 1221 |
| `0.8rem` (12.8px) | `.reliability-card` | 1351 |
| `1rem` (16px) | `.reliability-summary` | 1298 |

### 3f. Border widths

| Value | Lines |
|-------|-------|
| `0` | `.back-button` | 2230 |
| `1px` | search, settings summary, toast, voice hud | 287, 298, 376, 566, 744, 1220, 1297, 1349, 2284, 2314 |
| `2px` | cards, tabs, episodes, streams, most controls | 129, 172, 214, 880, 905, 918, 960, 1245, 1495, 1696, 1749, 1774, 1848, 1978, 2001, 2048, 2254 |
| `3px` | `--rail-accent-width` left borders | 810, 1558, 1643 |
| `4px` | settings action left accent | 1247 |
| `0.45rem` (~7.2px) | reliability card left | 1350 |
| `stroke-width: 1.8` | `.search-icon` | 309 |

### 3g. Card & poster dimensions

| Dimension | Value | Lines |
|-----------|-------|-------|
| Portrait aspect | `2 / 3` | 936, 1493, 1587 |
| Landscape aspect | `16 / 9` | 957 |
| Poster grid columns | `repeat(var(--rail-cols, 9), …)` — set to 9 or 6 via TS | 820, layout.ts:5–8 |
| App card width | `clamp(11rem, 16vw, 18rem)` | 1022 |
| App card min-height | `11rem` | 1023 |
| Related poster width | `clamp(136px, 12vw, 168px)`; media: `clamp(120px, 14vw, 148px)` | 1588, 2414 |
| Detail poster max-height | `min(56vh, 440px)`; with related: `min(50vh, 400px)`; media: `min(44vh, 320px)` | 1491, 1503, 2410 |
| Detail hero poster col | `clamp(160px, 14vw, 220px)`; media: `10rem` | 1474, 2405 |
| Detail side width | `clamp(280px, 24vw, 380px)`; media: `clamp(240px, 30vw, 340px)` | 1401, 2400 |
| Empty state | `min(860px, 100%)`, `min-height: 8rem` | 876–877 |
| Search compose grid | `minmax(42rem, 1.6fr) minmax(20rem, 0.72fr)` | 420 |
| Masthead max | `1200px`, `1100px` (h1) | 1145, 1158 |
| Settings refresh max | `52rem` | 1209 |
| Info list | `min(1100px, 100%)`, cells `min-height: 7rem` | 2246, 2251 |
| Poster progress bar | `height: 3px` | 1089 |
| Voice HUD | `min(700px, calc(100vw - …))`, `max-height: min(34vh, 300px)` | 2308–2309 |

### 3h. Rail / browse bar heights

| Element | Min-height / height | Lines |
|---------|---------------------|-------|
| `.browse-bar` | `3rem` | 101 |
| `.rails` | `flex: 1`, scrollable | 234–252 |
| `.rail-empty` | `4rem` | 900 |
| `.search-query-shell` | `4.45rem` | 293 |
| `.search-control` | `3rem`; scopes variant `2.55rem` | 367, 380 |
| `.search-key` | `3.35rem` | 466 |
| `.search-key-action` | `3.45rem` | 497 |
| `.search-starter` | `3.65rem` | 544 |
| `.detail-button` | `3.5rem` | 1997 |
| `.detail-stream` | `4rem` | 2046 |

### 3i. Safe area / edge insets

| Value | Lines |
|-------|-------|
| `--safe-x: 48px`, `--safe-y: 32px` | 21–22, 80, 1405 |
| `--focus-gutter: 22px` (computed) | 25, used throughout scroll/focus padding |
| `env(safe-area-inset-top/bottom/left/right)` | 2278, 2306, 2308 |
| `max(3vh, calc(env(safe-area-inset-top, 0px) + 1.25rem))` | toast top | 2278 |
| `max(5vh, calc(env(safe-area-inset-bottom, 0px) + 1.25rem))` | voice HUD bottom | 2306 |
| `7vw` horizontal on next-prompt, voice HUD width calc | 1836, 2308 |

---

## 4. FOCUS & SELECTION

Focus is driven by `.focused` class (JS) matching `:focus-visible` rules. Global focus tokens: `--focus-ring: 3px`, `--focus-glow: 14px`, `--dur-focus-in/out: 0ms` (lines 23–27, 46–47).

| Component | Focus treatment | Lines |
|-----------|-----------------|-------|
| `.browse-shuffle` | `outline: none`; `border-color: accent`; `background: accent-soft`; `color: text-primary`; ring `0 0 0 3px accent` + glow `0 0 14px accent-glow` | 146–152 |
| `.browse-tab` | Same ring/glow; border accent; bg accent-soft; color primary. Active+focused: border accent only (keeps tab-active bg) | 188–206 |
| `.browse-search` | Same ring/glow; border accent; bg accent-soft | 224–230 |
| `.search-control` | Ring+glow; border accent; bg `rgba(232,160,32,0.18)`; color primary; **drop shadow** `0 8px 24px rgba(0,0,0,0.38)` + `0 0 18px rgba(232,160,32,0.2)`; **`transform: scale(1.025)`** | 388–398 |
| `.search-key` | **Filled** `background: accent`; text `#17120a`; ring color **`#ffd278`** (not accent); drop shadows; **`scale(1.04)`** | 477–485 |
| `.search-submit` (actions row) | Filled accent; border accent; text `#17120a` — **no ring/glow** | 516–520 |
| `.search-starter` | Bg `rgba(232,160,32,0.16)` only; **`scale(1.012)`** — **no ring/glow/border** | 554–557 |
| `.card` (portrait/default) | `border-color: transparent`; `z-index: 2`; ring+glow + **drop shadow** `0 18px 48px rgba(0,0,0,0.5)` — **no scale** (tokens `--focus-scale-poster` unused) | 1033–1041 |
| `.card--landscape` | Focus on **`.poster-frame`**: transparent border; ring+glow + `0 16px 40px` shadow; outer card border/shadow removed; `z-index: 2` | 972–985, 1044–1047 |
| `.settings-action` | Ring+glow; border accent — no bg change | 1230–1234 |
| `.detail-season-chip` | Ring+glow; border accent; active+focused adds accent-soft bg | 1717–1727 |
| `.detail-season-header` | Ring+glow; border accent | 1757–1761 |
| `.detail-episode` | Ring+glow; border accent; selected keeps accent-soft | 1818–1827 |
| `.detail-button` | Ring+glow; border accent — primary button keeps accent fill | 2017–2021 |
| `.detail-stream` | Ring+glow; border accent | 2154–2158 |
| `.back-button` | Ring+glow only (no border; `border: 0`) | 2236–2239 |
| Selected (non-focus) | `.browse-tab--active`, `.detail-episode--selected`, `.search-chip--active`, `.detail-season-chip--active` | 197–201, 401–405, 1710–1713, 1795–1798 |

**Opacity as disabled state:** `0.55` (settings, episodes, streams), `0.62` (shuffle active, rails refresh, detail button disabled) — lines 156, 830, 1263, 1802, 2025, 2162.

---

## 5. MOTION

### 5a. Easing

| Token / value | Lines |
|---------------|-------|
| `--ease-out: cubic-bezier(0.2, 0, 0, 1)` | 44 |
| `ease-out` | 831, 836 |
| `ease` | 2294–2295, 2321–2322 |
| `linear` | 1981 |

### 5b. Transitions (property · duration · easing · delay)

| Selector | Properties | Duration | Easing | Lines |
|----------|------------|----------|--------|-------|
| `.browse-shuffle` | border-color, background, color, box-shadow, opacity | `var(--dur-focus-in)` → **0ms** | `--ease-out` | 138–143 |
| `.browse-tab` | border-color, background, color, box-shadow | **0ms** | `--ease-out` | 181–185 |
| `.card` | border-color (`dur-focus-out`), box-shadow (`dur-focus-in`) | **0ms** | `--ease-out` | 922–924 |
| `.card--landscape .poster-frame` | box-shadow, border-color | **0ms** | `--ease-out` | 962–964 |
| `.rails--refreshing` | opacity | **0.16s** | ease-out | 831 |
| `.rails--refresh-settled` | opacity | **0.32s** | ease-out | 836 |
| `.settings-action` | box-shadow, border-color | **0ms** | `--ease-out` | 1225–1227 |
| `.detail-season-chip` | border, box-shadow, background, color | **0ms** | `--ease-out` | 1703–1707 |
| `.detail-episode` | border-color, box-shadow | **0ms** | `--ease-out` | 1778–1780 |
| `.detail-button` | box-shadow, border-color | **0ms** | `--ease-out` | 2006–2008 |
| `.detail-stream` | border-color, box-shadow | **0ms** | `--ease-out` | 2053–2055 |
| `.toast` | opacity, transform | **0.28s** | ease | 2293–2295 |
| `.voice-hud` | opacity, transform | **0.28s** | ease | 2320–2322 |
| `.search-control` | (reduced motion) `none` | — | — | 785–787 |

**Duration range:** `0ms` (focus), `0.01ms` (reduced-motion override), `0.16s`, `0.28s`, `0.32s`, `220ms`, `0.75s`.

### 5c. Animations & keyframes

| Name | Property | Duration | Easing | Iteration | Lines |
|------|----------|----------|--------|-----------|-------|
| `detail-enter` on `.detail` | opacity 0→1, translateY 8px→0 | **220ms** | `--ease-out` | once | 1408, 1416–1424 |
| `detail-spinner` on `.detail-button-spinner` | rotate 360deg | **0.75s** | linear | infinite | 1981, 1989–1992 |
| Reduced motion | `animation: none` on `.detail`; `transform: none` on focused cards/tabs | — | — | — | 845–856 |

### 5d. Transform motion (non-transition)

| Transform | Context | Lines |
|-----------|---------|-------|
| `scale(1.025)` | `.search-control.focused` | 398 |
| `scale(1.04)` | `.search-key.focused` | 485 |
| `scale(1.012)` | `.search-starter.focused` | 557 |
| `scale(1.08)` | `.detail-backdrop-image` (static) | 1440 |
| `translate(-50%, -50%)` | `.search-more-glyph` | 725 |
| `translateX(-50%) translateY(±14px)` | toast / voice-hud show-hide | 2280, 2300, 2327 |
| `translateZ(0)` | `.search-control` (GPU hint) | 385 |

**Note:** `--focus-scale-poster: 1.06` and `--focus-scale-control: 1.03` (lines 26–27) are **defined but never applied** in CSS.

---

## 6. ELEVATION / DEPTH

### 6a. Box shadows

| Shadow | Context | Lines |
|--------|---------|-------|
| `0 0 0 3px var(--accent), 0 0 14px var(--accent-glow)` | Standard focus ring (many components) | 152, 194, 230, 1234, 1722, 1761, 1822, 2021, 2158, 2239 |
| `0 0 0 3px #ffd278, 0 8px 24px rgba(0,0,0,0.42), 0 0 20px rgba(232,160,32,0.3)` | Search key focus | 481–484 |
| `0 0 0 3px accent, 0 8px 24px rgba(0,0,0,0.38), 0 0 18px rgba(232,160,32,0.2)` | Search control focus | 394–397 |
| `0 0 12px var(--accent-glow)` | Active search chip dot | 415 |
| `0 0 13px var(--accent-glow)` | Search results mark | 662 |
| `0 8px 24px rgba(0,0,0,0.28)` | `.card` default | 920 |
| `0 6px 20px rgba(0,0,0,0.22)` | `.card--app` | 1030 |
| `0 4px 14px rgba(0,0,0,0.35)` | Saved star badge | 1003 |
| `0 16px 40px rgba(0,0,0,0.45)` | Landscape card focus | 978 |
| `0 18px 48px rgba(0,0,0,0.5)` | Portrait card focus | 1041 |
| `0 22px 56px rgba(0,0,0,0.45)` | Detail poster wrap | 1498 |
| `0 24px 80px rgba(0,0,0,0.55)` | Next-prompt card | 1850 |
| `0 18px 40px rgba(0,0,0,0.45)` | Toast | 2290 |
| `0 18px 56px rgba(0,0,0,0.5)` | Voice HUD | 2316 |
| Voice dot glows | `0 0 16px`–`0 0 18px` rgba variants | 2350, 2355, 2360, 2365 |

### 6b. Gradients

| Type | Lines |
|------|-------|
| Body dual radial + base | 67–70 |
| Search atmosphere radial (accent) | 270 |
| Search query / poster / more-card linear+radial | 702–703, 710–711, 939, 1063–1064, 2211 |
| Search results toolbar fade | 645 |
| Search results bottom mask | 631 |
| Season list horizontal mask | 1665–1677 |

### 6c. Filter / blur

| Filter | Lines |
|--------|-------|
| `blur(48px) brightness(0.35)` | `.detail-backdrop-image` | 1439 |
| No `backdrop-filter` in stylesheet | — |

### 6d. Opacity layers

| Value | Use | Lines |
|-------|-----|-------|
| `0` | hidden toast/voice, detail-enter from, missing poster | 1418, 2222, 2291, 2326 |
| `0.55` | disabled settings/episode/stream | 1263, 1802, 2162 |
| `0.62` | shuffle active, rails refresh, disabled detail button | 156, 830, 2025 |
| `0.82` | unverified stream | 2144 |
| `0.92` | active tool voice line | 2435 |
| `1` | default / visible states | 835, 1422, 2299, 2318 |

---

## 7. LAYOUT

### 7a. Main scaffold

```
.shell (100vw×100vh, padding safe-x/y)
├── #home-view.view.home (flex column, gap 0.6rem)
│   ├── .browse-bar (flex row)
│   └── .rails (flex column, flex 1, overflow-y auto)
├── #search-view.view.search
├── #detail-view.view.detail (fixed grid overlay)
├── #next-episode-prompt.next-prompt (fixed centered)
├── #toast.toast (fixed top center)
├── #voice-hud.voice-hud (fixed bottom center)
└── #settings-view.view.settings (flex column, scroll)
```

| Layer | Display / structure | Lines |
|-------|---------------------|-------|
| `.shell` | Block; full viewport; safe padding | 77–81 |
| `.view` | `flex` column; `gap: 2.5vh` (home overrides `0.6rem`) | 83–94 |
| `.browse-bar` | `flex` row; `min-height: 3rem` | 96–103 |
| `.rails` | `flex` column; `gap: var(--rail-gap)`; scroll Y | 234–252 |
| `.rail-track--posters` | CSS **grid** `repeat(var(--rail-cols), 1fr)` | 818–827 |
| `.rail-track` (non-poster) | `flex` row; `gap: 1.4vw`; scroll-snap x | 860–868 |
| `.search-compose-body` | CSS **grid** `1.6fr / 0.72fr` | 418–426 |
| `.detail` | Fixed **grid** `main | side`; `clamp` side width | 1395–1414 |
| `.detail-hero` | **grid** poster + copy | 1472–1480 |
| `.detail-side` | Flex column; scroll Y | 1602–1621 |
| `.settings-actions-row`, `.info-list`, `.reliability-grid` | 2-column CSS grid | 1283–1284, 2243–2244, 1337–1340 |

### 7b. Z-index (sorted)

| z-index | Element | Lines |
|---------|---------|-------|
| `-1` | `.search-atmosphere` | 267 |
| `0` | `.detail-backdrop` | 1430 |
| `1` | `.detail-poster-wrap`, `.detail-copy`, `.detail-main`, `.detail-related` | 1450, 1460, 1538 |
| `2` | `.card.focused`, `.card--landscape.focused`, `.detail-side`, `.poster-progress`, `.card-verify-badge` | 983, 1037, 1091, 1605, 1930 |
| `3` | `.card--poster.card--saved::after`, `.card-live-pill` | 993, 1010 |
| `5` | `.search-results-toolbar` (sticky) | 636 |
| `35` | `.detail` | 1398 |
| `40` | `.voice-hud` | 2317 |
| `45` | `.next-prompt` | 1833 |
| `50` | `.toast` | 2281 |

**Stacking order (low→high):** atmosphere (−1) → detail backdrop (0) → detail content (1–2) → sticky toolbar (5) → detail overlay (35) → voice HUD (40) → next prompt (45) → toast (50). No duplicate z-index values among positioned layers except multiple `z-index: 1` and `2` peers (same stacking context).

### 7c. Overflow / scroll containers

| Container | Overflow | Lines |
|-----------|----------|-------|
| `body` | `hidden` | 66 |
| `.rails` | `y: auto`, `x: clip` | 239–240 |
| `.search-results` | mask fade bottom | 631 |
| `.detail` | `hidden` | 1406 |
| `.detail-side` | `y: auto`, `x: clip` | 1618–1619 |
| `.detail-season-list` | `x: auto` + mask | 1655–1677 |
| `.settings` | `y: auto` | 2167 |
| `.voice-hud` | `y: auto`, `x: hidden` | 2310–2311 |
| Horizontal rails | `overflow: visible` + negative margin focus gutter | 822–826, 860–866 |

### 7d. Fixed pixel / viewport assumptions

| Assumption | Lines |
|------------|-------|
| No `1920×1080` literals | — |
| `100vw` / `100vh` shell | 63–64, 78–79 |
| `48px` / `32px` safe areas (not rem) | 21–22 |
| `20px` card gap | 40 |
| `22px`, `24px`, `56px` type tokens in px | 28–32 |
| `700px` voice HUD max width | 2308 |
| `860px`, `1100px`, `1200px` content max widths | 876, 1158, 1145 |
| `440px`, `400px`, `320px` detail poster caps | 1491, 1503, 2410 |
| `300px` voice HUD max height | 2309 |
| Grid `42rem` / `20rem` search split (~672px / 320px at 16px root) | 420 |

---

## 8. RESPONSIVENESS

### 8a. Media queries

| Query | Rules | Lines |
|-------|-------|-------|
| `@media (prefers-reduced-motion: reduce)` | `.search-control { transition: none }` | 784–787 |
| `@media (prefers-reduced-motion: reduce)` | Rails opacity `0.01ms`; focused transforms `none`; `.detail { animation: none }` | 839–857 |
| `@media (max-width: 900px)` | `h1` → `3.1rem`; detail grid/hero/related poster sizes reduced | 2393–2415 |

### 8b. rem / em / px / vw / vh usage

| Unit | Role |
|------|------|
| **px** | Type tokens (20–56px), safe areas (48/32), card gap (20), voice text (24px), HUD padding (16/20/18), caret (2px), progress (3px) |
| **rem** | Most component padding, gaps, radii (0.75–5.4rem) |
| **em** | Search icon `1.45em` | 304–305 |
| **vw / vh** | View gap `2.5vh`; rail gap `1.4vw`; search/detail clamps; toast/HUD `3vh`/`5vh`/`7vw`; poster `12vw`/`16vw` |
| **%** | Gradients, poster progress width |

### 8c. Base font-size

No `html { font-size }` rule — **browser default 16px** assumed. `rem` values resolve against 16px unless user agent overrides.

### 8d. 4K (3840×2160) / 720p (1280×720) survival

| Factor | Assessment |
|--------|------------|
| **4K** | `vw`/`vh` clamps scale typography and grids; px-locked tokens (22–56px type, 48px safe) **do not scale**; poster grid uses fractional columns not fixed px width — likely readable but **physically smaller relative to screen** than vw-scaled elements. No `min-resolution` or 4K media query. |
| **720p** | `@media (max-width: 900px)` may trigger on narrow windows (not height); fixed px safe areas consume larger **proportion** of 1280 width; `42rem` search grid may squeeze. `vh`-based gaps shrink. |
| **Dominant unit** | **Mixed** — semantic type/spacing tokens in **px**; component spacing mostly **rem**; layout fluidity via **vw/vh/clamp**. |

---

## Inconsistencies and one-offs

### Duplicate / near-duplicate colors

| Values | Notes | Lines |
|--------|-------|-------|
| `rgba(255, 255, 255, 0.08)` | **Identical** `--tab-active-fill` and `--border-subtle` | 18–19 |
| `#07080a` vs `rgba(7, 8, 10, 0.94/0.98)` vs `rgba(5, 8, 10, 0.72/0.9/0.92)` | Five dark scrim/surface variants | 9, 11, 645, 1063, 1923, 2283, 2313 |
| `#12151a` vs `#121417` vs `#101417` vs `#17191c` | Four near-black elevated surfaces | 10, 262, 300, 1056 |
| `rgba(255, 255, 255, 0.04)` vs `0.045` vs `0.035` vs `0.025` vs `0.05` vs `0.06` vs `0.075` | Seven white overlay alphas for similar “muted surface” role | 216, 498, 511, 568, 746, 1222+, 2087 |
| `rgba(232, 160, 32, 0.16)` | Token `--accent-soft` **and** literal on `.search-starter.focused` | 16, 556 |
| `#e8a020` vs `#ffd278` | Accent token vs search-key focus ring color | 15, 482 |
| `#22c55e` vs `rgba(34, 197, 94, …)` vs `#66e0a3` / `#80ed99` | Three green families (reliability, stream cache, voice) | 1303–1304, 1356, 2101–2102, 2364 |
| `#f87171` vs `rgba(248, 113, 113, …)` vs `#fecaca` | Red status trio | 1313–1314, 1364, 1391–1392 |
| `rgba(255, 255, 255, 0.14)` border vs `0.115` vs `0.09` (`--search-line`) | Three search border whites | 261, 298, 469 |

### Off-scale typography one-offs

| Value | Issue | Lines |
|-------|-------|-------|
| `5.4rem` `h1` | Largest size; **outside** token scale; only reduced at ≤900px | 1160, 2396 |
| `24px` `.voice-text` | Only non-token **px** body text | 2386 |
| Font weights `520`, `560`, `620`, `660`, `670`, `680`, `690`, `780` | Non-standard (between 500/600/700/800 steps) | 341, 454, 596, 590, 654, 327, 383, 474 |
| `--detail-related-gap: 1.15rem` | **Defined but unused** | 37 |

### Off-scale spacing / radius one-offs

| Value | Issue | Lines |
|-------|-------|-------|
| `border-radius: 22px` | Voice HUD only (between 16 panel and 999 pill) | 2315 |
| `7px` / `8px` / `9px` / `10px` / `11px` radii | Search/detail chips — five ad-hoc radii vs tokens 12/16/999 | 377, 470, 567, 1750, 2069, 2086 |
| `0.8rem` vs `0.75rem` vs `12px` vs `16px` | Four “medium round” radii for panels/cards | 1221, 1351, 1298, 41–43 |
| `gap: 1.4vw` vs `var(--card-gap) 20px` | Mixed units between rail track modes | 821, 862 |
| `padding: 16px 20px 18px` | Voice HUD px padding amid rem system | 2312 |

### Focus treatment inconsistencies (factual)

| Finding | Lines |
|---------|-------|
| **Six distinct focus patterns:** (A) ring+glow standard, (B) search-control +scale+drop shadow, (C) search-key filled+#ffd278 ring+scale, (D) search-starter bg-only+scale, (E) card +drop shadow no scale, (F) search-submit filled no ring | 388–398, 477–485, 516–520, 554–557, 1033–1041 |
| `--focus-scale-poster: 1.06` and `--focus-scale-control: 1.03` **never used** | 26–27 |
| `--dur-focus-in/out: 0ms` but rails refresh uses 160ms/320ms opacity | 46–47, 831, 836 |
| Landscape cards move ring to inner `.poster-frame`; portrait uses outer `.card` | 972–979 vs 1033–1041 |

### Z-index / motion notes

| Finding | Lines |
|---------|-------|
| Multiple siblings at `z-index: 1` and `2` without explicit ordering between poster-wrap vs copy vs related | 1450, 1460, 1538, 1605 |
| `detail-enter` 220ms vs toast/voice 280ms — different overlay entrance timings | 1408, 2293, 2320 |
