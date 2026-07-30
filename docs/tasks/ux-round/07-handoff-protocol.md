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
