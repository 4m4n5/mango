# ux-harness — render declared launcher scenes on a Mac

Iterate on launcher UI without a Pi. The real launcher runs under `vite dev`; a
fixture server answers a bounded set of `/api/*` requests recorded from a Pi,
and Playwright screenshots the scenes declared in `capture.py` at 1920×1080.

Recorded 2026-07-30: the then-current Home fixture was pixel-equivalent to its Pi
capture for layout, safe area, focus treatment, and casing. That is dated
evidence, not proof that current source or a target TV still matches.

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

# 3. capture every declared scene, or a filtered subset
python3 tools/ux-harness/capture.py
python3 tools/ux-harness/capture.py detail search
```

Screenshots, a `manifest.json`, and a contact sheet land in
`~/.cache/mango-ux/local-shots/`. Open `index.html` there to review a run.

Playwright drives the installed Google Chrome (`channel="chrome"`), so no browser
download is needed. If Homebrew's default `node` is broken, use the parallel keg:
`export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.

## Current coverage

The declared scenes cover core Movies/TV/Live/YouTube tabs, Search, Movie and
Series Detail, Settings shell, loading/empty/offline/stale states, long Detail
stream lists, and representative voice/next-episode/toast styling.

They do **not** currently provide deterministic interaction proof for the
Fire/Water rating drawer, recommendation-v2 explanations/attribution,
Reliability Center actions, YouTube OAuth, or the asynchronous accepted →
resolving → playing play-session sequence. Add sanitized fixtures and explicit
scene assertions when those launcher surfaces change; do not treat a generic
`{"ok": true}` mutation response as acceptance proof.

mpv/libass playback chrome is a separate production renderer:

```bash
bash scripts/m6-ship/render-mpv-hud-fixtures.sh /tmp/mango-hud-fixtures
```

That renderer still does not replace physical TV/controller/playback proof.

## Input grammar

`capture.py` sends the same browser keys as `mango-tv-pad.py`, so the navigation
grammar matches the couch. It does not reproduce Bluetooth/input ownership or
physical latency:

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
| `delay_ms` | stall responses — renders stable, non-focusable loading skeletons |
| `empty` | return shape-preserving empty collections, e.g. `["rails"]` |
| `fail` | return an error status for a family, e.g. `["stream"]` |
| `status` | status code paired with `fail` (default 503) |
| `play` | `"ok"` gives a generic success to a `POST` path containing `play`; it does not emulate the asynchronous session state machine |

Families: `rails`, `detail`, `stream`, `search`, `library`, `health`.

Scenes marked **synthetic** in the manifest are forced into place with JS because
they are event-driven (voice HUD, next-episode prompt, toast). Treat them as
representative of styling, not proof the trigger works.

The state scenes also cover a two-step stale-content path: Home first loads real
fixture cards, the harness then fails a user refresh, and the launcher must keep
those cards mounted while showing its recently-loaded banner. This is the local
regression proof that a transient outage never replaces usable shelves.

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
  metrics differ; CSS layout/spacing/colour relationships are reviewable, while
  physical colour, motion and focus feel still require the target TV.
- A screenshot proves the rendered fixture state only. It does not prove the
  trigger, API ownership, focus restoration after a real failure, or the latest
  Pi deployment revision unless those are tested separately.
