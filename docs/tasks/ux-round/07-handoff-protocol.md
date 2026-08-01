# UX round — handoff protocol

How the UI/UX polish round moves from the work Mac (design + implementation, no
Pi access) to the home Mac (deploy + couch verification). Written for the home
agent: **follow it literally and do not redesign anything.**

## Division of labour

| Work Mac (author) | Home Mac (deployer) |
|---|---|
| Designs and implements each view | Deploys commits to the Pi |
| Renders locally via `tools/ux-harness` at 1920×1080 | Runs the gates and reports pass/fail |
| Writes the per-commit verification block | Captures Pi screenshots and sends them back |
| Decides all visual questions | Applies only the pre-approved knobs below |

The home agent has **no design authority**. If a view looks wrong on the TV, it
reverts that one commit and reports what it saw. It does not invent a fix.

## Commit shape

One view per commit, ordered so each is independently deployable and revertible.
Every commit body ends with a block the home agent executes verbatim:

```
ux(<view>): <what changed in one line>

<why, 1–3 sentences>

Verify on Pi:
1. bash scripts/pi-deploy.sh --fast
2. bash scripts/m6-ship/gate-m6-ux-smoke.sh      # must PASS
3. Couch check: <specific, observable, pass/fail statements>
Revert if wrong: git revert <this-sha> && bash scripts/pi-deploy.sh --fast
```

Couch checks must be observable from the sofa without tooling, e.g. "the focused
poster's amber ring is unbroken on all four sides" — never "focus looks better".

## Deploy loop (home agent)

```bash
cd ~/mango
git pull --ff-only origin feat/native-experience
bash scripts/pi-deploy.sh --fast          # ~30–45s
bash scripts/m6-ship/gate-m6-ux-smoke.sh
bash scripts/pi-exec-gate.sh              # before handing the couch to the user
```

Deploy the commits **in order**, verifying each before moving to the next. If a
commit fails its gate or couch check, stop, revert that commit only, and report.

## Pre-approved knobs

The only changes the home agent may make without asking. Each is a single CSS
custom property in `src/launcher/src/style.css`, and each must be reported back
with its old and new value:

| Token | Allowed adjustment | Reason it may need tweaking on real hardware |
|-------|--------------------|----------------------------------------------|
| `--safe-x` / `--safe-y` | ±16px | TV overscan varies by panel and input mode |
| `--focus-ring-width` | ±1px | ring can bloom on some panels |
| `--motion-fast` / `--motion-base` | ±60ms | Pi compositor may need more headroom |
| `--shuffle-stagger` (22ms) / `--shuffle-travel` (130ms) | stagger 14–30ms, travel 100–180ms | The shuffle cascade must read as dealing cards, not as waiting. Keep `stagger x 5 + travel` under ~300ms total or it becomes lag. Report both values and whether the D-pad stayed responsive during the wave. |
| `--panel-edge-fade` (3rem) | 2–4.5rem | How far stream/episode rows dissolve at the top and bottom of the side panel. It is a mask, not a scrim, so the rows fade into the background rather than toward a colour — and `updateEdgeFade()` caps each band by the content actually hidden on that side, so the extremes and short lists get no fade at all. Raise it if the cut still reads as an edge from the sofa; lower it if it swallows a row you were choosing between. Do not replace it with an overlay gradient: that draws the box, which is the defect it was built to remove. Note the scrollport is `.detail-stream-list` / `.detail-episode-list`, **not** the `.detail-side` column around them — the column also holds the panel heading and the season chips, and scrolling it scrolls those out of view. `gate-m6-ux-smoke.sh` fails if `overflow-y: auto` moves back up to `.detail-side`. Related: because those lists are column flex containers *and* the scrollport, `.detail-stream` and `.detail-episode` must keep `flex: 0 0 auto` — with the default shrink they compress to `min-height` and their content spills past their own border (a dashed unverified row then looks struck through). The gate fails if that is removed. |
| `--poster-label-delay` (100ms) | 60–220ms | Hover intent on the focused-poster label. Pad key-repeat rate is the thing this has to beat and it cannot be measured off-Pi: too low and every card scrubbed past flashes its title, too high and a card you have settled on feels slow to name itself. Report the value and whether scrubbing still strobes. |

### Not a knob: type sizes

`--text-micro` (20px), `--text-caption` (24px), `--text-control` (26px) and above are
**off limits**. 20px already sits under both platform floors (Fire TV 28px at 1080p,
tvOS 29pt) as a deliberate exception for metadata nobody has to read to make a
choice, and caption/control were raised to 24/26px in this round precisely because
the small end was illegible from the sofa.

Shrinking type was considered as the fix for the stream row overflowing its 332px
column and was rejected. Three geometry changes solved it instead, with the chip row
now measuring 0 clipped chips across a 14-stream ladder:

- `HDR10` / `HDR10+` collapse to `HDR` — the X11 path cannot output HDR at all and
  the Kodi path emits HDR10 either way, so the distinction is unactionable here.
  `DV` stays separate because the ladder does treat it differently.
- Chip inline padding 0.45rem → 0.34rem and `.detail-stream-primary` gap 0.4rem →
  0.3rem — ~13px, and the change that actually closed the last 9px. The widest row
  (`4K WEB-DL HDR cached`) needs 312px against a 303px budget.
- `.detail-stream-res` `min-width` 3.2rem → 2.6rem — worth ~1px, not the ~10px first
  assumed: `4K` measures 50px naturally, so 3.2rem was barely binding. Kept for
  correctness, but it is not load-bearing.
- `.detail-stream-chip--tier` is the only chip allowed to shrink and ellipsise, so
  any combination wider than the column degrades on provenance rather than slicing
  `cached` off the right edge. Measured: 0 of 14 rows truncate or overflow, so this
  is a guard for combinations the fixture does not contain, not an active behaviour.
  If you see `WEB…` on the couch, the row got wider than the fixture predicts —
  report it rather than adjusting the font.

If a row still overflows on real hardware, remove information or tighten geometry.
Do not lower a font size.

One exception to "CSS custom property", because it is the single judgment call in
the rail density change that needs real-hardware eyes:

| Constant | Allowed adjustment | Reason |
|----------|--------------------|--------|
| `RAIL_COLUMNS` in `src/launcher/src/layout.ts` | now **6**; may go back to **5 only** | 6 posters is 255px, the documented lower floor for 3 m viewing, and was chosen for one more title per rail. Only a real panel at real viewing distance shows whether it reads generous or cramped. If cramped, set it back to 5 (314px). Never above 6, and never touch `RAIL_COLUMNS_LANDSCAPE`. |
| `.detail-related-track .card--poster` width cap (currently `228px`) with `RELATED_DISPLAY_LIMIT` in `src/launcher/src/detail.ts` (currently `7`) | **down to `200px` / `8`** | The full-width related row takes its height from the side panel above it, so a series now shows 5 of 8 episodes. If that reads too cramped on the couch, shrinking the cards gives the panel height back. Change both together and report how many episodes became visible. |

Items per rail follow that constant automatically — `renderRails()` slices each
rail to its column count — so nothing else needs editing, and report the change
with a photo of the Movies tab.

Anything else — colours, type sizes, layout, copy, markup — comes back to the
work Mac as a report with a screenshot.

## Capturing Pi screenshots for the author

Use this exact recipe. Note the flag bug that wasted an earlier capture run:
`xdotool search --class -i chromium` is **invalid** (`-i` does not exist) and
silently yields no window, so every later "capture" is a duplicate of one screen.

```bash
export DISPLAY=:0 XAUTHORITY=$HOME/.Xauthority
xdotool key --clearmodifiers Down     # plain XTEST reaches Chromium; no --window needed
scrot -o /tmp/shot.png
md5sum /tmp/shot.png                  # MUST differ from the previous shot
```

**Checksum every screenshot against the previous one.** If it is unchanged the
input did not register: report that rather than saving duplicates. Pad keys are
`Left/Right/Up/Down`, `Return` (B), `BackSpace` (Y), `F6`/`F7` (shoulders),
`F5`/`shift+F5` (X tap/hold).

Never start playback while capturing. If mpv appears, run
`bash scripts/m2-catalog/service/mpv-stop.sh` immediately.

## Reporting back

Per commit: gate result, each couch check as pass/fail, any knob changed with old
and new value, and a screenshot of the view. On failure also include the last 40
lines of `journalctl --user -u mango-launcher` and whether a revert was applied.
