# Phase 0 — Checklist

Runbook: [`PHASE0.md`](PHASE0.md)

## OS & display

- [x] Pi OS Desktop 64-bit · hostname `mango`
- [x] X11 + Openbox (`switch-to-x11.sh`)
- [x] `verify-system.sh` green

## Gamepad (8BitDo Micro)

- [x] Paired · MAC `E4:17:D8:EB:00:44`
- [x] **`mango-tv-pad.py`** — launcher + Stremio + Kodi
- [x] D-pad · **B** select · **Y** back · **⌂** home

## Kodi + YouTube

- [x] Kodi + InputStream + YouTube addon (personal API keys)
- [x] JSON-RPC `:8080` user `mango`
- [x] YouTube tile opens addon (Videos window), not Kodi home

## Stremio

- [x] Installed · login · pad via `mango-tv-pad.py`

## Phase 1 launcher

- [x] Chromium launcher · Stremio / YouTube tiles · ⌂ home
- [x] `serve.py` API · `verify-tv.sh` · optional systemd watchdog

## Phase 1.5 — Launch polish ✓ (2026-06-18)

Sign-off: couch test session **`20260618-013528`** · C2 confirmed manually.

- [x] Hide-not-kill on app switch (no `killall` sibling)
- [x] `tv_pad` health · watchdog no false repair during test
- [x] Home warm path (<300 ms target)
- [x] Stremio Y-back without F11 jitter (`--after-back`)
- [x] Couch matrix C1–C6 (C5 30 min soak deferred — optional)
- [x] `alpha-test.sh` session archived (`fetch-session.sh`)

**Pi:** `10.0.0.174` · keys/RPC password on device only
