# Native mango experience

**Branch:** `feat/native-experience`  
**Status:** Architecture locked · implementation not started  
**Intent:** TV-first mango UX with **legit catalogs and streams** via the Stremio addon ecosystem; **mpv** plays everything; Stremio desktop stays hidden as fallback.

---

## North star

> **Ask or browse in mango. Watch in mpv. Never wonder which app you’re in.**

| Principle | Meaning |
|-----------|---------|
| **Legit metadata** | Posters and titles from Cinemeta / TMDB — no mock rails in production |
| **Stremio-compatible catalogs** | Rails and AI catalogs resolve through the same addon graph as Stremio |
| **mpv is the player** | Addon streams and YouTube (yt-dlp) play in mpv — not Stremio/Kodi chrome |
| **AI catalogs are real** | Named, persistent catalogs (max 3 on home) — not ephemeral suggestion toasts |
| **Stremio desktop is insurance** | Installed, hidden; opens only when mango stream/play fails |

---

## Locked decisions (2026-06)

### Catalog & addons

| Topic | Decision |
|-------|----------|
| Catalog source | **Hybrid** — Stremio library/discover + mango-configured rails + AI catalogs |
| Addon runtime | **`stremio-core`** in `catalog-service` — load manifests like Stremio |
| Stream/meta stack | **Cinemeta + Torrentio** minimum; **custom addon URLs** in config |
| **aiostreams** | Run as a **normal addon** inside stremio-core (stream/language/RD prefs live there) |
| Debrid | **Real Debrid + TorBox** — user picks in Settings |
| Stremio import | **Export file** pasted into mango Settings (not auto-scrape of Stremio profile DB) |
| Rail config V1 | **`config/catalog.yaml`** on Pi (edit on Mac → git pull); 10ft Settings UI later |
| Regional V1 | **Must-have** India/Bollywood rails — **TMDB lists + addon catalogs** |
| YouTube browse | **Separate rail** on home — not mixed into movie search |
| Search | **Cinemeta + TMDB fallback** (Hinglish / Indian title coverage) |

### Playback

| Topic | Decision |
|-------|----------|
| Player | **mpv** for movies, shows, and YouTube (**yt-dlp** for YouTube V1) |
| Stream picker | **Simple** — 2–5 options (quality / language), then play |
| Stream sort | **aiostreams addon behavior** + configurable **audio language** filter in mango |
| Quality | **4K streams enabled** for playback; UI may stay 1080p-scaled in V1 |
| Time to play | **~5 s** target from B to first frame (progress UI while resolving) |
| On stream fail | **Auto-try next** option → then **hidden Stremio desktop** fallback |
| Subtitles | Nice to have V1 — not a hard blocker |
| RD in mpv | **Not yet tested on Pi** — early validation required |

### Library & progress

| Topic | Decision |
|-------|----------|
| Continue rail order | **Stremio library first**, then **mango-stored mpv resume** |
| Resume source of truth | **mango progress DB** on Pi (mpv reports position) |
| Finished watching | **Write back** to Stremio library when possible |
| Progress backup | **mango backs up** progress on Pi (survive Kodi/mpv DB loss) |
| Stremio desktop | **Hidden** — fallback only |

### AI catalogs

| Topic | Decision |
|-------|----------|
| Persistence | **Full named catalogs** — create, list, persist |
| Refresh | **Per-catalog user choice** — frozen title IDs vs live re-query |
| Home limit | **3** AI catalogs on home |
| Edit V1 | **Voice + phone** only |
| Bad meta IDs | Drop titles that don’t resolve in Cinemeta (silent skip) |

### Household

| Topic | Decision |
|-------|----------|
| Profiles | **Single household V1** — multi-profile later |

---

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │  mango launcher (TV UI)              │
                    │  rails · search · detail · picker    │
                    └──────────────┬──────────────────────┘
                                   │ HTTP
                    ┌──────────────▼──────────────────────┐
                    │  catalog-service (Node + stremio-core)│
                    │  · YAML rails → catalog queries       │
                    │  · AI catalog store                   │
                    │  · meta / streams / search            │
                    │  · addons: Cinemeta, Torrentio,       │
                    │    aiostreams, custom URLs            │
                    └──────────────┬──────────────────────┘
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
    Stremio cloud library    TMDB (search fallback)   mango progress DB
           │                       │
           └───────────┬───────────┘
                       ▼
              ┌────────────────┐
              │  mpv (fullscreen)│◄── yt-dlp for YouTube
              └────────┬───────┘
                       │ all streams fail
                       ▼
              ┌────────────────┐
              │ Stremio desktop │  hidden fallback
              └────────────────┘
```

### Stremio addon graph (unchanged)

```
Catalog addons  →  title IDs in rails / lists
Meta (Cinemeta) →  poster, plot, seasons
Stream (Torrentio + RD/TorBox via aiostreams) →  playable URLs
```

mango does **not** reindex torrents. It runs the same protocol Stremio uses.

### Continue watching (merged)

1. Items from **Stremio library** with in-progress / up-next semantics  
2. Then items with **mango mpv resume** not yet reflected in Stremio  
3. On finish → update Stremio library + mango DB  

---

## Config (V1)

| File | Purpose |
|------|---------|
| `config/catalog.yaml` | Home rails — addon catalog refs, TMDB list IDs, order, filters |
| `config/catalog.example.yaml` | Documented template in repo |
| `/etc/mango/stremio-export.json` | Pasted Stremio export (addons, auth hints) |
| `/etc/mango/progress.db` | mpv resume + backup |
| `/etc/mango/ai-catalogs/` | Persisted AI-named catalogs |
| `config/config.yaml` | RD/TorBox keys, debrid provider choice, language filter |

**Example rail (conceptual):**

```yaml
rails:
  - id: continue
    type: stremio_library
    label: Continue watching
  - id: bollywood
    type: tmdb_list
    list_id: …
    label: Bollywood
  - id: trending
    type: addon_catalog
    addon: …
    catalog: …
```

---

## UX flows

### Browse → play (movies/shows)

1. Home rail or search → title detail  
2. B → **resolve streams** (aiostreams + Torrentio; show spinner, target 5 s)  
3. **Simple picker** — top 2–5 by cache/quality/language  
4. B → **mpv fullscreen**  
5. ⌂ → mango home (< 300 ms; C2 regression)  

### YouTube (separate rail)

1. YouTube rail or voice `play_youtube`  
2. Resolve via **yt-dlp** → mpv  
3. Same ⌂ behavior  

### AI catalog

1. Voice/phone: “make a catalog of sci-fi under 2 hours”  
2. LLM tool → search Cinemeta/TMDB → save named catalog  
3. User chooses **frozen** or **live refresh**  
4. Appears on home (max 3 slots)  

---

## Implementation phases

Full roadmap: **[`NATIVE_ROADMAP.md`](NATIVE_ROADMAP.md)**.

| Phase | Name |
|-------|------|
| **N0** | Foundation reset — strip cruft, compute headroom, gates → [`tasks/phase-n0-foundation-reset.md`](tasks/phase-n0-foundation-reset.md) |
| **N1** | `catalog-service` + one title → mpv |
| **N2** | Real `catalog.yaml` rails + launcher |
| **N3** | Stream picker + progress DB |
| **N4** | Continue + Stremio export |
| **N5** | AI catalogs + voice tools |
| **N6** | YouTube (yt-dlp) |
| **N7** | 4K polish + Stremio fallback |

**Pause feature work** until N0 gate passes. Mock launcher rails are removed in N0.

### Prototype on branch (status)

- [x] Focus grid + rail layout — **keep scaffolding**
- [x] N0 removes `mock-catalog.ts` from production path
- [ ] N2 wires launcher to `catalog-service`

---

## Risks & validation spikes

| Risk | Mitigation |
|------|------------|
| RD HTTP streams untested in **mpv** on Pi | **C0 spike** — resolve one title, play in mpv before UI |
| **5 s** TTFF vs stream resolve latency | Pre-resolve on focus; cache stream lists; show progress |
| Stremio library **write-back** | Spike API; degrade to mango-only progress if blocked |
| **yt-dlp** breakage / ToS | Pin version; Kodi YouTube as emergency fallback only |
| **stremio-core** on Pi 5 ARM | Prove catalog-service boots with your addon set early |
| **aiostreams** as addon only | Document required manifest URL; test stream shape matches picker |

---

## Open (minor)

- UI language copy (Hinglish vs English)  
- Binge mode — auto-play next episode?  
- Phone role beyond voice — remote transport during mpv?  
- Expand launcher vs `src/tv/` SPA (default: **expand launcher**)  

---

## Success metrics

| Test | Pass |
|------|------|
| Home rails show **real** posters from Cinemeta/TMDB | No mocks |
| Play Bollywood title from configured rail | mpv, no Stremio UI |
| Continue rail shows Stremio library + local resume | Correct order |
| Stream fail → auto-retry → Stremio fallback | Hidden handoff |
| ⌂ from mpv → mango home | C2 regression |
| Voice creates 3rd AI catalog | Persists across reboot |

---

## References

- [`DESIGN.md`](DESIGN.md) — V1 spec (update playback row when C0 ships)
- [`PHASE2.md`](PHASE2.md) — voice pipeline on `main`
- [`PLAN.md`](PLAN.md) — roadmap
- [`DECISIONS.md`](DECISIONS.md) — locked choices
