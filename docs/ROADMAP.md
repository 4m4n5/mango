# Roadmap

**Branch:** `main` · **Product:** [PRODUCT.md](PRODUCT.md) ·
**Current truth:** [STATUS.md](STATUS.md)

Completed implementation belongs in STATUS and the feature docs. This
file is remaining outcomes only.

## Shipped foundations

M1–M4 (stack, browse, native mpv, self-hosted addons) and the M5/M6
source foundations (librarian, library, YouTube, recommendations,
Reliability Center, Git-only deploy) exist in `main`. They are not a
finished appliance.

## Remaining sequence

### P0 — public `main` proof baseline

Deploy this branch to a Pi through Git, inventory device-owned state,
and record a new STATUS row for the exact SHA. Do not inherit the
2026-08-21 development-branch snapshot as this tag’s proof.

### P1 — recommendations and grow on `main`

- Three unattended nights with enqueue-only rank and last-good retention
- Human relevance for For You / Top Picks / Related / YouTube More to watch
- Thin-rail yield without weakening theme or playability gates

### P2 — intentional display sleep

Locked contract: Off / 15 / 30 (default) / 60 / 120 minutes; D-pad and
companion idle only; mpv inhibits; DPMS Off + CEC standby; DPMS On +
CEC power-on. Replace accidental Xorg 600-second blanking. Prove on a
real TV.

### P3 — everyday reliability

- Exact-ID empty → play recovery on the couch
- Remove or explicitly feature-gate the legacy MediaFusion supplement
- Five ordinary controller power-on reconnects without pairing
- Neutral Reliability state when Live is intentionally off
- Per-device companion auth before any wider network exposure

### P4 — target-TV fidelity

Publish a source/codec/resolution/audio matrix. Prove picture, drops,
route, and lip-sync on the target TV. Either integrate a credible HDR
engine or keep the explicit no-HDR ship boundary.

### P5 — appliance acceptance and first boot

- Whole-product couch pass on one `main` SHA
- No-SSH installer for network, pad, display, companion, and providers

## Exit criteria still open

| Milestone | Open criterion |
|-----------|----------------|
| M3 | Repeated grow proof and target-TV playback matrix |
| M5 | Phone / voice couch pass on a release revision |
| M6 | Sleep, first boot, HDR boundary, whole-product sign-off |

## Risks

| Risk | Control |
|------|---------|
| Source-complete mistaken for shipped | STATUS columns stay separate |
| HDR or “stream anything” overclaimed | [PUBLIC_CLAIMS.md](PUBLIC_CLAIMS.md) |
| Deploy disrupts an active couch | Idle preflight, Git-only, no DB wipes |
| Old reports become product truth | Historical labels; exact SHA only in STATUS |
