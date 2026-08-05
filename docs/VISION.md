# mango — product vision

**Platform:** Raspberry Pi 5 (8 GB) · Raspberry Pi OS Desktop · X11/Openbox · Chromium + mpv

**Development branch:** `feat/native-experience`
**Current truth:** [STATUS.md](STATUS.md)

## North star

> **Ask or browse in Mango. Watch in Mango. Never wonder which app you are in.**

Mango is a private, household-owned, 10-foot streaming interface. A person can
browse with a small D-pad controller or ask the phone librarian for something
to watch, inspect a real title, press **B**, and return to the exact place they
left. Playback and library state stay local. Provider complexity is hidden
behind a fast, honest stream ladder and an intentionally small set of recovery
choices.

The long-term product is a plug-and-play living-room appliance. The current
system is a sophisticated development installation: its core viewing loop is
real, but recommendation rollout, deliberate display sleep, target-TV
4K/HDR/audio proof, comprehensive couch acceptance, and first-boot setup are
not finished.

## The experience Mango provides now

### Browse and find

- A dedicated Search surface plus Movies, TV Shows, Live, and YouTube tabs.
- Cinematic, D-pad-native rails and Detail views using real metadata and art.
- Continue and Saved owned by Mango, not inferred from a provider UI.
- Progressive Search whose VOD, Live, YouTube, and optional AI phases fail
  independently; it never autoplays or becomes a chatbot.

### Watch

- Movies, episodes, Live TV, and native YouTube open in fullscreen mpv.
- The launcher remains visible while candidates resolve and probe; Mango gives
  foreground ownership to mpv only after advancing media is proven.
- A sparse cinematic HUD, contextual controls, persistent minimal pause badge,
  delayed buffering state, and five-choice bottom Streams drawer live inside
  mpv/libass rather than in a second browser.
- One automatic VOD action can confirm a clean/transient empty aggregate up to
  two times inside the same exact-title/episode flight. Permanent, rate-limit,
  malformed, canceled, and Live/picker failures do not receive blind retries.
- Position, track choices, foreground generation, and return focus remain one
  logical session through stream switches and Undo.

### Remember and recommend

- `progress.db` owns exact Continue/resume state.
- `library.db` owns Saved, history, finished state, Fire/Water ratings,
  reversible feedback, attribution, and normalized YouTube history.
- Fire and Water are independent 0–5 ratings in half-point increments.
- The implemented VOD recommender learns up to three Household taste threads
  from explicit satisfaction and bounded watch/Saved evidence, then ranks only
  currently verified-playable titles. A stateless content teacher may enrich
  StoryDNA, but it never sees household state or owns ranking/publication.
- The implemented YouTube recommender uses only authoritative subscriptions
  and qualifying Takeout/Mango-local history. It cannot reproduce YouTube's
  proprietary native home feed and does not claim to.
- Both redesigned recommenders are rollout-gated and serve from atomic cached
  generations. Home and **X** do not wait for an LLM or spend YouTube quota.

### Ask and operate

- The phone companion accepts text or push-to-talk, searches across Mango, and
  opens a title or result on the TV. The controller still makes the final play
  decision.
- Reliability Center summarizes launcher, controller, catalog, playability,
  YouTube, Live, voice, process, and maintenance evidence without turning Home
  into an admin dashboard.
- Repair is intentionally conservative: stale locks, safe process strays,
  controller, catalog, and launcher may be repaired; databases, history,
  credentials, and caches are never destructively reset as routine recovery.

## Product principles

| Principle | Contract |
|-----------|----------|
| **Couch first** | Readable at roughly 3 m, deterministic D-pad paths, strong focus, safe-area-aware layouts, no mouse dependency |
| **One product surface** | Mango owns browsing, playback chrome, progress, and return; unsupported legacy-player artifacts are not promised as recovery UX |
| **Real and honest** | Real metadata and playable evidence; empty, stale, offline, unavailable, and risky states say what is actually known |
| **Local ownership** | Household library and recommendation state stay in Mango's local durable stores |
| **Fast by architecture** | Cached rails, sparse redraw, single flights, bounded phases, and deferred foreground—not optimistic fake loading |
| **Last good beats blank** | Atomic publication and stale-but-usable data preserve the couch experience through background failures |
| **Explicit taste beats surveillance** | Fire/Water and intentional feedback dominate; implicit signals are bounded and inspectable |
| **AI teaches, local code decides** | Content enrichment can be probabilistic; eligibility, scoring, diversity, rollout, and publication remain deterministic and local |
| **Proof has a boundary** | Source, Mac test, Pi gate, screenshot, and human couch observation are named separately |
| **Operator state is sacred** | Git-only deploys; no routine deletion of databases/cache/history and no credential copying into the repo |

## Current product boundaries

| Boundary | Current answer |
|----------|----------------|
| Native YouTube home feed | Unsupported by public YouTube Data API; Mango builds its own transparent rails |
| 4K/HDR | Compatible 4K SDR HEVC is integrated but still needs exact-TV proof; native HDR is unsupported on the current X11/mpv path, with only separate Kodi/GBM research; 1080p remains the safe default |
| Display sleep | A 30-minute Settings-driven design is locked, but the implementation and Pi proof remain open; accidental Xorg 600-second blanking is not an acceptable substitute |
| Recommendations | Current source is latest-only, but the latest recorded Pi snapshot predates that cleanup. VOD and YouTube still need independent shadow builds, promotion evidence, serve-mode deployment, and human couch-quality verdicts |
| Live TV | Optional and source/configuration dependent; excluded from default gates |
| Voice playback | The librarian opens; **B** plays. There is no voice autoplay |
| TTS | Off until the TV/soundbar audio path is deliberately validated |
| Household setup | Still operator-installed; M6.4 wizard/no-SSH setup is not built |

## Ship outcome

Mango is ready to merge and call itself an appliance when:

1. The ordinary browse → Detail → play → control → return loop is repeatably
   couch-observed across movies, exact episodes, Live, and YouTube.
2. Recommendation v2 backfills, offline gates, shadow diagnostics, serve
   promotion, rollback, and human relevance/diversity tests pass.
3. The locked display-sleep/CEC behavior replaces accidental Xorg blanking and
   is proven through idle, playback, companion, wake, and reboot cases.
4. The target TV/audio route has an honest supported-quality matrix; no 4K/HDR
   claim exceeds visible-picture, dropped-frame, mode, HDR, and audio evidence.
5. Repeated unattended grow/nightly runs preserve healthy last-good rails and
   expose thin-source shortfalls without disrupting the couch.
6. Reliability, controller reconnect, offline/restart, phone/voice, and visual
   acceptance close on the exact release revision.
7. First boot can reach a usable household setup without SSH, destructive
   recovery, or secret hand-copying.

See [ROADMAP.md](ROADMAP.md) for sequence, [STATUS.md](STATUS.md) for the current
evidence matrix, and [DECISIONS.md](DECISIONS.md) for locked behavior.
