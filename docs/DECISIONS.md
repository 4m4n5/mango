# Implementation decisions

Locked choices. Update when changing behavior.

| Decision | Choice |
|----------|--------|
| LLM provider | Configurable — Anthropic + OpenAI in `config.yaml` |
| Display | X11 + Openbox (not Wayland) |
| TV navigation | 8BitDo Micro Bluetooth |
| UI stack | Vite + vanilla TypeScript |
| Branch | `feat/native-experience` |
| Product direction | Mango-owned TV-first UX and user library; Stremio/Kodi = fallback engines |

---

## Gamepad

| Topic | Choice |
|-------|--------|
| Layout | **Y · X · A · B** clockwise from left ([HARDWARE.md](HARDWARE.md)) |
| Select / back | **B**=`304` · **Y**=`308` · **L**=`310` tab − · **R**=`311` tab + · **↻**=`317` shuffle |
| Home | `316`/`311` → `launch-launcher.sh` (`mango-tv-pad.py`) |
| Pad owner | **`mango-tv-pad.py`** — launcher + mpv |
| Fallback | `input-remapper` only if pad fails to grab |

---

## M1 — Foundation & launcher

| Topic | Choice |
|-------|--------|
| Base stack | `scripts/mango-stack.sh start|stop|status|restart` |
| Launcher | Chromium kiosk `mango-launcher` · `serve.py` `:3000` |
| Foreground | `launcher | mpv | fallback_stremio` ([ARCHITECTURE.md](ARCHITECTURE.md)) |
| Chromium budget | One launcher at idle; no overlay Chromium |
| Hide launcher | Z-order below media (`mango-window.sh hide`) |
| Fallback apps | `MANGO_FALLBACK_STREMIO=1` · `MANGO_LEGACY_YOUTUBE=1` |
| Launch lock | `flock` — release before background child |
| API debounce | Launcher home debounced 2 s |
| Health | `tv_pad` OR `input_remapper=active` |
| Couch activity | Timestamp-only shared state; maintenance defers when couch is active |
| Display sleep | X11 DPMS/screensaver disabled in couch mode; pad input wakes display |
| Launcher display | `1920x1080@60` couch default; stream/playback quality is owned separately by catalog filters + mpv |

---

## M2–M4 — Catalog & playback

| Topic | Choice |
|-------|--------|
| Catalog service | `:3020` · `@stremio/stremio-core-web` |
| Addon graph | `/etc/mango/stremio-export.json` contains manifests only, not user-library sync |
| Player | **mpv** fullscreen — not Stremio/Kodi chrome |
| Self-hosted addons | AIOStreams `:3035` · AIOMetadata `:3036` |
| Live TV | NexoTV · `catalog-live.yaml` · opt-in gates ([LIVE_TV.md](LIVE_TV.md)) |
| Live cache | Never replace a non-empty Live cache with empty rebuild output; stale non-empty cache may serve indefinitely |
| Lab quality cap | `max_quality: 1080p` until M6.3 ship profile |

---

## M3 — Verified library and grow

| Topic | Choice |
|-------|--------|
| Visible rails | Serve only verified `rail_pool` titles; hidden/empty rails are acceptable when underfilled |
| Grow target | Best effort toward all-active-rails `+20`; `12/13` is an SLA shortfall warning unless strict mode is explicitly enabled |
| Fresh quota | `grow_per_pass` new-to-rail probe-verified titles; links/orphans/reshuffles do not count |
| Publish | Staged work DB publishes after a completed publishable run; failed or aborted runs preserve the previous couch snapshot |
| Orphans | Attach active verified orphans to best-fit thematic rail or anchor fallback |
| Overlap | Cap unpinned memberships; pins do not consume the unpinned cap |
| Runtime source weights | Cache/state only; never auto-edit catalog YAML or theme profiles |
| TV visibility | No couch-facing grow/progress/debug UI |
| Timers | No couch-disruptive `OnBootSec`; post-boot maintenance catch-up is explicit operator action |

---

## M5 — Voice

| Topic | Choice |
|-------|--------|
| Orchestrator | FastAPI · WSS `:8765` · HUD loopback `:8766` |
| Companion | HTTPS PWA `:3001` (mkcert) |
| Voice role | Browse + open librarian — **no voice play** |
| STT | Deepgram `nova-3` + `multi` + keyterms |
| TTS | Off until M6.3 soundbar/TV validated |
| TV HUD | `voice-hud.ts` in launcher — only default TV voice surface |
| Multi-turn PTT | Allowed while reply visible |
| Reply dwell | `overlay_reply_seconds: 10` |
| Saved tools | Save/Unsave current context or exact title only; no voice play, hide, or auto-save |

---

## M6 — Ship

| Topic | Choice |
|-------|--------|
| Library | Mango-owned `library.db` for explicit Saved, history, finished, dormant hidden/blocked fields, and taste/profile hooks; `progress.db` remains M6.1 Continue/resume source |
| Saved | Explicit only; playback never auto-saves; existing user-facing Pins import once into Saved |
| Stremio sync | None. No Stremio user-library sync or write-back |
| AI catalog automation | Must not write to Saved; overflow policy is replace/merge only |
| YouTube | First-class native tab; official API for metadata/search/subscriptions, `yt-dlp` → mpv for playback; voice opens, pad **B** plays |
| YouTube storage | `/etc/mango/youtube.db` is rebuildable cache; durable Saved/history/Not Interested lives in `library.db` with `source="youtube"` |
| YouTube auth/secrets | API key, OAuth client, token, and optional cookies are operator-owned `/etc/mango/*`; no repo secrets |
| YouTube save policy | Videos only; channels/playlists open lists and are not Saved entities in M6.2; Saved videos remain in Saved until explicit Unsave |
| YouTube history policy | History is Mango-local only; default shows latest 9 unique videos watched in Mango, shuffle samples 9 random videos from the full local YouTube watch set |
| YouTube refresh policy | One nightly/manual coordinator refreshes all YouTube cache phases; each phase is isolated and stale cached rails remain visible when a phase fails |
| YouTube For You policy | Mango-owned reservoir in `youtube.db`; long-watch optimized, medium-first, no Shorts/live/watched videos, 5 familiar + 3 discovery + 1 wildcard, 7-day exposure cooldown |
| YouTube Fresh Finds policy | Mango-owned broad-discovery reservoir in `youtube.db`; official-API refresh only, no couch-time API calls, no watched/Not Interested/live/Shorts, prefer non-Saved/non-subscribed alternatives, 14-day exposure cooldown |
| YouTube Because You Watched policy | Seed-scoped reservoir in `youtube.db` based on latest meaningful Mango-local YouTube watch; one same-channel anchor plus same-topic/deeper-dive/wildcard follow-ups; max-one creator when enough distinct creators exist; no watched/live/Shorts/Not Interested cards; shuffle is cache-only |
| YouTube Popular policy | Neutral broad-trending reservoir in `youtube.db` built from official `videos.list(chart=mostPopular)` across configured region plus India/US and broad categories; no search quota, no couch-time API calls, no watched/Not Interested/live/Shorts, prefer non-Saved/non-subscribed alternatives, 48-hour exposure cooldown |
| YouTube native recommendations | Exact native YouTube home/recommended feed is not available through supported Data API routes; any raw-feed experiment must be explicit opt-in and isolated from Mango-owned recommender rails |
| 4K | Ship profile on target TV; relax filters in `catalog-filters.json` |
| Deploy | `install.sh` wizard — no SSH for household setup |

Ops: [OPS.md](OPS.md). Never commit API keys.

---

## Appendix — legacy section names

Older docs used **Phase 0–2** (foundation + voice shell) and **N0–N7** slice labels. Map to milestones in [ROADMAP.md](ROADMAP.md#appendix--legacy-names).
