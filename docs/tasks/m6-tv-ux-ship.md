# M6.5 — TV UI/UX ship polish

**Milestone:** M6 (Ship) · **Blocks:** merge to `main` / household handoff  
**Depends on:** M2–M4 browse/play ✓ · M6.1–M6.3 (polish on **final** feature surfaces)  
**Partner skill:** `$ux-design-expert` (visual system) · `$mango-tv-box-expert` (10-ft focus)

---

## Why this exists

Functional gates prove rails play and pad routes work. **Ship quality** is whether a household perceives mango as a **world-class TV box** at 3 m — not a Chromium kiosk with posters.

Vision: **couch-first · content forward · never wonder which app you're in.** M6.5 polishes **launcher + detail + picker + overlays** — type, focus, density, motion, error states — on the ship stack (library rail, YouTube, 4K profile).

**Merge blocker** alongside M6.4 wizard and 4K smoke — not optional frosting.

---

## Scope

### 1. 10-foot visual system

Type scale at ~3 m · focus vs selected vs idle · ~5% safe area · stable poster card size before load · leanback density · brand consistency across home/detail/settings/HUD chrome.

### 2. D-pad navigation audit

Home rails · browse bar (tabs + shuffle) · detail (play → streams → episodes) · stream picker grey rows · next-episode overlay · settings · voice HUD must not trap focus.

**Exit:** predictable axes; no focus loops; every target reachable.

### 3. States & copy

Loading skeletons · empty rails hidden · play failure couch copy · no raw API/addon errors · offline retry · Continue rail order visible.

### 4. Motion & latency

⌂ <300 ms · tab SWR instant paint · detail warm ≤1 s · shuffle feedback · instant focus state.

### 5. Ship order

M6.1 library → M6.2 YouTube → M6.3 4K → **M6.5 polish** → M6.4 wizard (ships polished UI) → merge.

### 6. Acceptance

Extend **`COUCH_TEST.md`** with UX walkthrough U1–U12 · **`gate-m6-ux-smoke.sh`** (light) · 30 min couch sign-off on Pi (+ 4K TV when available).

**UX P0:** no wallpaper · no invisible focus · no layout shift on focus move · no stderr on TV · HUD must not block tiles permanently.

---

## Out of scope

Launcher framework rewrite · Wayland · fallback app chrome · companion phone (M5.5) · store marketing assets.

---

## M6 merge requires

M6.1 · M6.2 (or documented defer) · M6.3 4K smoke · **M6.5** this doc · M6.4 wizard.

