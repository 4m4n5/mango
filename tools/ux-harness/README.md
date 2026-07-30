# ux-harness — render the launcher on a Mac

Iterate on launcher UI without a Pi. The launcher runs under `vite dev` exactly as
it ships; a fixture server answers `/api/*` with responses recorded from a real
Pi, and a Playwright script screenshots every surface at 1920×1080.

Validated 2026-07-30: the harness render of Home is pixel-equivalent to the same
surface captured on the Pi (same layout, safe area, focus treatment, casing).

## Never commit fixtures

Recorded responses contain **debrid playback tokens** inside stream URLs. They
live outside the repo (`~/.cache/mango-ux/fixtures`) and `.gitignore` blocks the
in-repo path. Do not paste fixture contents into docs, issues, or commits.

## Run it

```bash
# 1. fixture API on :3000 — the port launcher's vite.config.ts already proxies to
python3 tools/ux-harness/mock-api.py

# 2. the launcher itself on :5173
cd src/launcher && npm run dev

# 3. capture every surface (all scenes, or a filtered subset)
python3 tools/ux-harness/capture.py
python3 tools/ux-harness/capture.py detail search
```

Screenshots, a `manifest.json`, and a contact sheet land in
`~/.cache/mango-ux/local-shots/`. Open `index.html` there to review a run.

Playwright drives the installed Google Chrome (`channel="chrome"`), so no browser
download is needed. If Homebrew's default `node` is broken, use the parallel keg:
`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.

## Input grammar

`capture.py` sends the same keys `mango-tv-pad.py` sends, so navigation matches
the couch exactly:

| Pad | Key | Role |
|-----|-----|------|
| D-pad | `ArrowUp/Down/Left/Right` | move |
| B | `Enter` | select |
| Y | `Backspace` | back |
| L / R | `F6` / `F7` | previous / next browse tab |
| X tap / hold | `F5` / `Shift+F5` | contextual secondary |

## Forcing states the couch cannot reach on demand

`mock-api.py` re-reads a control file on every request, so a scene can change
backend behaviour without a restart (`~/.cache/mango-ux/control.json`):

| Key | Effect |
|-----|--------|
| `delay_ms` | stall responses — renders loading/skeleton states |
| `empty` | return shape-preserving empty collections, e.g. `["rails"]` |
| `fail` | return an error status for a family, e.g. `["stream"]` |
| `status` | status code paired with `fail` (default 503) |
| `play` | `"ok"` makes `POST …/play` succeed; default fails, which is the interesting UI |

Families: `rails`, `detail`, `stream`, `search`, `library`, `health`.

Scenes marked **synthetic** in the manifest are forced into place with JS because
they are event-driven (voice HUD, next-episode prompt, toast). Treat them as
representative of styling, not proof the trigger works.

## Re-recording fixtures from a Pi

Only needed when catalog response shapes change. On a machine with Pi access,
curl each endpoint the launcher calls (see `src/launcher/src/catalog.ts`), save
raw JSON plus a `manifest.json` of `{file, url, status}` entries, and copy the
directory to `~/.cache/mango-ux/fixtures`. Never `POST` a play endpoint.

## Limits

- Not a substitute for couch verification. It cannot show real TV overscan,
  HDMI colour, D-pad latency, or mpv playback. Frame-accurate and motion checks
  still belong on the Pi.
- Chrome on macOS is not Chromium on the Pi. Font rasterisation and scrollbar
  metrics differ slightly; layout, spacing, and colour are trustworthy.
