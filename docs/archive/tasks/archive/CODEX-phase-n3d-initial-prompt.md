# Codex — Phase N3d initial prompt (paste this first)

**Branch:** `feat/native-experience`
**Last updated:** 2026-06-19

Copy **everything below the line** into a new Codex session. Then read [`CODEX-phase-n3d-prompt.md`](CODEX-phase-n3d-prompt.md) and execute slices **N3d-S0 → S6** in order.

---

You are a **senior TV-box platform engineer** (embedded Linux, leanback UX, Stremio addon protocol, Docker on Pi 5, mpv, SQLite playability index, SRE gates). Implement **Phase N3d — self-hosted addon stack (Free Path A)** for **mango** on branch `feat/native-experience`.

Invoke **`$mango-tv-box-expert`** thinking: couch-first, git-only Pi deploy, automated gates before handoff, compute budget on Pi 5 (Chromium UI-only; no wallpaper regressions).

## Why we're doing this

ElfHosted **public** AIOStreams returns `https://elfhosted.com/assets/public-rate-limit-exceeded.mp4` under maintenance load — N3c indexer hung, DB counters flat, posters empty. User **already pays TorBox + Real-Debrid + Easynews** and will **not** add $18–29/mo ElfHosted (Netflix-priced). **Free Path A:** self-host **AIOStreams** + **AIOLists** on the Pi at `127.0.0.1`; keep Cinemeta + Torrentio as fallbacks.

## Authoritative docs (read before coding)

1. **Spec:** `docs/tasks/phase-n3d-self-hosted-addon-stack.md`
2. **Slices:** `docs/tasks/CODEX-phase-n3d-prompt.md`
3. **Context:** `mango/AGENTS.md`, `docs/NATIVE_EXPERIENCE.md`, `docs/N2-INVENTORY.md`, `docs/N3c-INVENTORY.md`, `docs/ELFHOSTED.md`
4. **Existing gates:** `scripts/pi-pre-couch-gate.sh`, `scripts/lib/gate-common.sh`, `scripts/phase-n3c/gate-n3c-verified-rails.sh`

## Locked product choices (do not overturn without user approval)

| Topic | Choice |
|-------|--------|
| Stream primary | Self-hosted **AIOStreams** @ `http://127.0.0.1:3035` |
| Catalog mdblists | Self-hosted **AIOLists** @ `http://127.0.0.1:3036` |
| India trending | **India OTT Catalog** addon (public or self-host) in composite rail |
| Debrid | User's existing **TorBox + RD** in AIOStreams configure UI |
| Usenet | Wire **Easynews** in AIOStreams (user already pays) |
| N3c promise | **Verified-only posters** — do not bypass for gate convenience |
| Deploy | **Git only** — commit, push, `git pull` on Pi — never rsync |
| Secrets | `/etc/mango/config.yaml`, `stremio-export.json`, docker `.env` — **never commit** |

## Industry / systems lenses (verify your approach)

| Lens | Check |
|------|-------|
| **AIOStreams v2** | Volume mount `/app/data`; health at `/api/v1/status` not `/health` ([deployment docs](https://docs.aiostreams.viren070.me/getting-started/deployment/)) |
| **Torrentio IP** | Pi home IP OK; avoid VPS for AIOStreams ([deployment wiki](https://github.com/Viren070/AIOStreams/wiki/Deployment)) |
| **Pi reliability** | Docker restart policy; data on home dir not SD root; gate `mem available ≥2.5 GB` idle ([Pi forum guidance](https://forums.raspberrypi.com/viewtopic.php?t=211764)) |
| **TV leanback** | Gates prove play ≤15s — poster is a promise ([Android TV design for TV](https://developer.android.com/design/ui/tv/guides/foundations/design-for-tv)) |
| **mango proven failures** | Hung mpv probes >8s → hard `timeout` on `mpv-probe-ipc.sh`; skip `rate-limit-exceeded` URLs in verify |

## Known baseline on branch (may be uncommitted — merge first)

- `isRateLimitedStreamUrl` in `catalog-errors.ts` + verify skip
- `mpv-probe-ipc.sh` rate-limit fast-fail + `timeout` wrapper
- `playability-maintenance.sh`: catalog yaml resolve, probe concurrency 1, native dep preflight
- `scripts/diag/poll-maintenance.py`

Run `git status` and include these in **S2** if not on `origin/feat/native-experience`.

## Execution order

**N3d-S0** → **S6** per `CODEX-phase-n3d-prompt.md`. One commit per slice.

After each slice on Pi:

```bash
cd ~/mango && git pull --ff-only
# if TS changed:
cd src/catalog-service && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/<slice-gate>.sh
```

**Manual operator steps (document, don't block in CI):**

1. AIOStreams configure UI — paste TB/RD/Easynews keys; enable Torrentio TB+RD
2. Copy manifest URL → `/etc/mango/stremio-export.json`
3. AIOLists configure — import mdblist IDs from `N2-INVENTORY.md`
4. `export MANGO_SELF_HOSTED_ADDONS=1` in `~/.config/mango/voice.env`

## Handoff criteria

Do **not** stop until:

```bash
bash scripts/phase-n3d/gate-n3d-self-hosted.sh   # Pi
bash scripts/pi-pre-couch-gate.sh                  # or Mac: bash scripts/pi-exec-gate.sh
```

…pass, **or** failures are documented in `docs/N3d-INVENTORY.md` with explicit user action (e.g. "complete AIOStreams configure UI").

## Success in one line

**Stream resolve and catalog ingest work from Pi-local addons with zero ElfHosted rate-limit URLs, and N3c maintenance can probe without hanging.**

Start by reading the spec + prompt files, summarizing your plan (including port layout and addon name mapping), then begin **N3d-S0**.
