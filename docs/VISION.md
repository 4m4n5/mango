# mango — product vision

**Platform:** Raspberry Pi 5 (8 GB) · Pi OS Desktop · X11 + Openbox  
**Branch:** `feat/native-experience`  
**Status:** Core TV stack shipped · library grow and companion UX hardening in progress

---

## North star

> **Ask or browse in mango. Watch in mpv. Never wonder which app you're in.**

mango is a **plug-and-play AI TV box**: legit catalogs, conversational control from your phone, instant playback in **mpv** — tuned for a **4K HDR living room** (target ship milestone **M6**).

**Dev lab (today):** 1080p monitor + headphones. Stream filters cap quality until 4K is proven on target TV + soundbar.

---

## Product principles

| Principle | Meaning |
|-----------|---------|
| **Legit metadata** | Posters and titles from Cinemeta / TMDB — no mock rails in production |
| **Stremio-compatible graph** | Rails and AI catalogs use the same addon protocol as Stremio |
| **mpv is the player** | Movies, series, live IPTV, and (future) YouTube play in mpv — not Stremio/Kodi chrome |
| **AI catalogs are real** | Named, persistent home rails (max 3 per tab) — not ephemeral toasts |
| **Verified rails stay quiet** | Background grow can work for hours, but couch rails switch only after a completed publishable maintenance run |
| **Stremio desktop is insurance** | Installed, hidden; opens only when mango stream/play exhausts retries |
| **Couch-first** | 3 m / 10 ft · D-pad only · sub-300 ms home from mpv |
| **Voice opens, pad plays** | Phone finds and opens titles; **B** on the remote starts playback |

---

## Locked decisions (2026)

### Catalog & addons

| Topic | Decision |
|-------|----------|
| Catalog source | Stremio library + YAML rails + AI catalog slots |
| Addon runtime | `stremio-core` in `catalog-service` |
| Minimum addons | Cinemeta + self-hosted **AIOStreams** + **AIOMetadata** |
| Debrid | Real Debrid + TorBox — configured in AIOStreams UI |
| Stremio import | Export file at `/etc/mango/stremio-export.json` |
| Rail config | `config/catalog.yaml` on Pi (git-managed examples in repo) |
| Regional V1 | India / Bollywood rails required |
| Search | Verified library + Cinemeta external fallback |

### Playback

| Topic | Decision |
|-------|----------|
| Player | **mpv** fullscreen |
| Stream picker | Top 2–5 options by cache / quality / language |
| Quality (lab) | 1080p cap via `catalog-filters.json` |
| Quality (ship) | 4K HDR on target TV — **M6** |
| Time to play | ~5 s target from **B** to first frame |
| On stream fail | Auto-try next stream → hidden Stremio fallback |
| Live TV | NexoTV Docker → mpv `--live` |

### Library & progress

| Topic | Decision |
|-------|----------|
| Continue rail | Stremio library first, then mango `progress.db` resume |
| Resume source of truth | mango progress DB (mpv position watcher) |
| Verified library | `playability.db` active verified titles; thematic `rail_pool` memberships |
| Library grow | Best-effort fresh `+20` new-to-rail verified target per active rail; shortfalls publish usable verified work with operator warnings |
| Grow visibility | Operator-only reports; no TV debug/progress surface |
| Finished watching | Write back to Stremio library when possible (**M6**) |

### Voice & AI

| Topic | Decision |
|-------|----------|
| Voice role | Browse + open librarian — no voice play |
| STT | Deepgram `nova-3` · Hinglish (`multi` + hi/en fallback) |
| TTS | Off until **M6** soundbar/TV path validated |
| AI catalogs | Voice-created slots on home · overflow handling (replace / pin / merge) |

### Household

| Topic | Decision |
|-------|----------|
| Profiles | Single household V1 |

---

## Success metrics (ship)

| Test | Pass |
|------|------|
| Home rails show real Cinemeta/TMDB posters | No mocks |
| Play from configured rail | mpv, no Stremio UI |
| Verified library grows | Active rails gain fresh verified thematic titles, shortfalls are visible to operators, and verified work is not discarded when a rail misses target |
| Continue rail order | Stremio library → local resume |
| Stream exhaustion | Auto-retry → hidden Stremio |
| **⌂** from mpv | Home < 300 ms |
| Voice creates AI catalog | Persists across reboot |
| Companion discover query | No TV jump; clarifying chat (M5.5) |
| Companion clear open | Detail on TV; phone/TV agree (M5.5) |
| 4K title on ship TV | Visible picture + reliable audio (**M6**) |
| TV browse at 3 m | Legible focus, stable rails, couch-safe errors (**M6.5**) |
| First boot | `install.sh` wizard → couch-ready without SSH (**M6**) |

---

## References

| Doc | Use |
|-----|-----|
| [ROADMAP.md](ROADMAP.md) | Milestones · planned work |
| [STATUS.md](STATUS.md) | Shipped features · gates · ops |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Stack · layers · foreground |
| [DECISIONS.md](DECISIONS.md) | Implementation locks |
