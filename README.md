# mango

**TV box for Raspberry Pi 5** — browse and play in **mango**; watch in **mpv**; voice from your phone.

> **Active development:** [`feat/native-experience`](docs/NATIVE_EXPERIENCE.md) — TV-first home, Stremio addon graph, mpv playback.  
> **Stable baseline:** Phase 0–2 on `main` (launcher + voice + hidden Stremio/Kodi fallback).

---

## What mango is becoming

| Layer | Native direction |
|-------|------------------|
| **TV UI** | Chromium launcher — browse rails, search, detail (N2+) |
| **Catalog / streams** | `catalog-service` + Stremio addons (Cinemeta, AIOStreams, NexoTV live) |
| **Player** | **mpv** fullscreen — VOD + live (`--live`) |
| **Voice** | Phone PTT → orchestrator → HUD on launcher (shipped) |
| **Fallback** | Stremio desktop / Kodi YouTube — hidden, opt-in only |

North star: *ask or browse in mango · watch in mpv · never wonder which app you're in.*

---

## Quick start (Pi)

```bash
cd ~/mango && git pull
bash scripts/mango-stack.sh restart          # launcher + voice (if MANGO_VOICE=1)
bash scripts/phase-n0/gate-n0.sh             # base stack gate
```

After reboot: `bash scripts/phase1/bootstrap-after-reboot.sh`

**SSH:** `mango` → `aman@10.0.0.174` · **Branch:** `feat/native-experience`

---

## Docs (humans)

| Start here | |
|------------|--|
| [**docs/README.md**](docs/README.md) | **Doc index** — what to read when |
| [NATIVE_EXPERIENCE.md](docs/NATIVE_EXPERIENCE.md) | Product vision + locked decisions |
| [NATIVE_ROADMAP.md](docs/NATIVE_ROADMAP.md) | Implementation phases **N0–N7** |
| [LIVE_TV.md](docs/LIVE_TV.md) | Live IPTV (NexoTV, sport rails) |
| [PHASE0.md](docs/PHASE0.md) | Pi ops, gamepad, troubleshooting |
| [FOREGROUND.md](docs/FOREGROUND.md) | What’s visible: launcher \| mpv \| fallback |

| Ops | |
|-----|--|
| [HARDWARE.md](docs/HARDWARE.md) | 8BitDo Micro layout |
| [PHASE2.md](docs/PHASE2.md) | Voice pipeline setup |
| [DECISIONS.md](docs/DECISIONS.md) | Locked choices |

**Agents / automation:** [AGENTS.md](AGENTS.md)

---

## Repo layout

```
docs/                 human docs + native roadmap
scripts/
  mango-stack.sh      daily start/stop (native base stack)
  phase-n1/             catalog + mpv spikes (N1)
  phase-live/           NexoTV live IPTV (optional)
  phase0/               gamepad, Kodi, Stremio fallback
src/
  launcher/             TV UI shell
  catalog-service/      Stremio-core bridge (N1+)
  orchestrator/         voice hub
  companion/            phone PWA
config/                 examples → /etc/mango/ on Pi
```

---

## Branches

| Branch | Use |
|--------|-----|
| `feat/native-experience` | **Active** — native UX, mpv, catalog-service |
| `main` | Phase 0–2 couch stack; bugfixes |

Deploy: **git only** — [`docs/DEPLOY.md`](docs/DEPLOY.md). Commit + push from Mac; `bash scripts/pi-deploy.sh` or `git pull` on Pi. **Never rsync.** Never commit secrets (`keys/`, `/etc/mango/`).
