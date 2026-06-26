# mango

**TV box for Raspberry Pi 5** — browse and play in **mango**; watch in **mpv**; voice from your phone.

> **Active development:** [`feat/native-experience`](docs/VISION.md) — TV-first home, verified thematic rails, Stremio-compatible addon graph, mpv playback, and phone companion.
> **Stable baseline:** `main` remains the older launcher/voice/fallback stack for emergency bugfixes.

---

## What mango is becoming

| Layer | Direction |
|-------|-----------|
| **TV UI** | Chromium launcher — browse rails, search, detail |
| **Catalog / streams** | `catalog-service` + self-hosted addons (Cinemeta, AIOStreams, AIOMetadata, optional NexoTV live) |
| **Library** | Mango-owned state: `playability.db` verified titles, `progress.db` resume, `library.db` Saved/history/finished |
| **Player** | **mpv** fullscreen — VOD + live (`--live`) |
| **Voice** | Phone PTT → orchestrator → launcher detail open |
| **Fallback** | Stremio desktop / legacy Kodi YouTube — hidden, opt-in only |

North star: *ask or browse in mango · watch in mpv · never wonder which app you're in.*

Ship target (**M6**): world-class **4K HDR plug-and-play** AI TV box.

---

## Quick start (Pi)

```bash
cd ~/mango && git pull
bash scripts/mango-stack.sh restart          # launcher + voice (if MANGO_VOICE=1)
bash scripts/m1-foundation/gate/gate-m1.sh             # base stack gate
```

After reboot: `bash scripts/m1-foundation/ui/bootstrap-after-reboot.sh`

**SSH:** `mango` → `aman@10.0.0.174` · **Branch:** `feat/native-experience`

---

## Docs

| Start here | |
|------------|--|
| [**docs/README.md**](docs/README.md) | **Doc index** |
| [VISION.md](docs/VISION.md) | Product vision + locked decisions |
| [ROADMAP.md](docs/ROADMAP.md) | Milestones **M1–M6** |
| [STATUS.md](docs/STATUS.md) | Shipped features · current hardening gaps · gates |
| [PLAYABILITY.md](docs/PLAYABILITY.md) | Verified library · grow · thematic rails |
| [LIVE_TV.md](docs/LIVE_TV.md) | Live IPTV |
| [OPS.md](docs/OPS.md) | Pi ops, gamepad, troubleshooting |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack · foreground contract |

| Ops | |
|-----|--|
| [HARDWARE.md](docs/HARDWARE.md) | 8BitDo Micro layout |
| [VOICE.md](docs/VOICE.md) | Voice pipeline setup |
| [DECISIONS.md](docs/DECISIONS.md) | Locked choices |

**Agents / automation:** [AGENTS.md](AGENTS.md)

---

## Repo layout

```
docs/                 vision · roadmap · status · architecture
scripts/
  mango-stack.sh      daily start/stop (native base stack)
  m1-foundation/      pad · launcher UI · gates (M1)
  m2-catalog/         catalog-service + mpv (M2)
  m3-play/            play · playability (M3)
  m4-addons/          self-hosted addons (M4)
  m5-voice/           voice + AI tools (M5)
  live/               NexoTV IPTV (optional)
  MILESTONES.md       layout map
src/
  launcher/           TV UI shell
  catalog-service/    Stremio-compatible addon bridge + Mango library state
  orchestrator/       voice hub
  companion/          phone PWA
config/               examples → /etc/mango/ on Pi
```

---

## Branches

| Branch | Use |
|--------|-----|
| `feat/native-experience` | **Active** — native UX, mpv, catalog-service |
| `main` | Older stable couch stack; bugfixes |

Deploy: **git only** — [`docs/DEPLOY.md`](docs/DEPLOY.md). Commit + push from Mac; `bash scripts/pi-deploy.sh` or `git pull` on Pi. **Never rsync.** Never commit secrets (`keys/`, `/etc/mango/`).
