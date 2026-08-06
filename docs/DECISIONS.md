# mango — locked implementation decisions

This file records product and architecture choices that should not drift during
implementation. [STATUS.md](STATUS.md) records whether each choice is
source-complete, local-pass, Pi-deployed, Pi-gated, couch-observed, or deferred.

## Product and platform

| Decision | Locked choice |
|----------|---------------|
| Product direction | Mango-owned TV-first UX, playback chrome, library, and recommendations |
| Development branch | `feat/native-experience` |
| Host | Raspberry Pi 5 / Raspberry Pi OS Desktop |
| Display stack | X11 + Openbox for the current product; no implied Wayland/HDR support |
| TV UI | Vite + vanilla TypeScript in one Chromium kiosk at idle |
| Player | Native fullscreen mpv only for the supported daily path |
| Legacy players | Kodi/Stremio code, config, and research are rollback/spike material; do not promise an automatic viewer fallback that current source cannot execute |
| LLM provider | Configurable Anthropic/OpenAI through operator-owned configuration |
| Proof language | Source-complete, local-pass, Pi-deployed, Pi-gated, couch-observed, and deferred are distinct |

## Controller and focus

| Topic | Locked choice |
|-------|---------------|
| Device/layout | 8BitDo Micro; face buttons **Y · X · A · B** clockwise from left |
| Select/back | **B**=`304` selects; **Y**=`308` backs/cancels |
| Contextual secondary | **X**=`307`: Home current-tab cached shuffle; Search tap delete/hold clear; movie/episode playback Streams or temporary Undo; ignored for Live/YouTube playback |
| Volume/tabs | `−/+`=`314/315`; `L/R`=`310/311` previous/next tab, or large seek during playback |
| Home | `316` only in the canonical launcher/mpv contract |
| Owner | `mango-tv-pad.py` owns launcher and active mpv input; input-remapper is recovery only |
| Reconnect | Root BlueZ link supervisor plus user evdev router; ordinary controller power-on is the happy path, never pairing mode |
| Focus | One deterministic focused element, persistent logical origin through Detail/playback, and a visible focus state distinct from selected/current status |

Do not change pad ownership, bindings, debounce, or pairing expectations without
explicit product approval.

## Launcher, activity, and display

| Topic | Locked choice |
|-------|---------------|
| Base stack | `scripts/mango-stack.sh start\|stop\|status\|restart` |
| Launcher | `mango-launcher` Chromium + UI server `:3000` |
| Foregrounds | `launcher \| mpv`; probes and failed candidates are display-neutral |
| Launcher mode | `1920x1080@60`; playback output policy is separate |
| Couch activity | Timestamp/source only; maintenance defers around real user/playback activity |
| Display sleep presets | Off, 15 min, **30 min default**, 60 min, 2 h |
| Idle inputs | Reset only on D-pad and companion activity; background service/progress noise is not human activity |
| Playback inhibition | Never sleep while mpv is playing |
| Sleep/wake | Sleep = DPMS Off + HDMI-CEC standby; wake = DPMS On + HDMI-CEC power-on and correct Mango foreground/focus |
| Current gap | The locked sleep policy is not implemented/proven; disabling automatic DPMS/forcing the panel on and accidental Xorg 600-second values are both transitional, not the happy path |

## Catalog, addons, and library

| Topic | Locked choice |
|-------|---------------|
| Catalog protocol | Stremio-compatible manifests/catalog/stream resources through catalog-service |
| Export | `/etc/mango/stremio-export.json` contains addon manifests only, never user-library sync |
| Self-hosted services | AIOStreams `:3035`; AIOMetadata `:3036` |
| Resolver topology | Target: AIOStreams is the sole stream-capable Mango VOD aggregate/path; catalog/metadata and optional Live addons may coexist, while Torrentio/Comet/optional MediaFusion and RD/TorBox/Easynews live behind AIO |
| Known topology divergence | Source still contains an optional Pi-state-triggered direct MediaFusion thin-pool supplement; remove it or approve an explicit feature flag, deadline/security contract, diagnostics, and couch gate before treating it as supported |
| AIO state | Pi `userData` is operator-owned state; Git deploy does not overwrite it; current `diff/apply` helper leaks sensitive output/temp state and is blocked for agents until hardened; fixed-field `verify` remains diagnostic |
| AIOMetadata state | Import/config/export is Pi-owned and explicit; current mutation helper and deploy-triggered rail sync print/leave sensitive state, so both direct unattended mutation and the deploy wrapper are blocked until secure-temp, cleanup, redaction, explicit opt-in and fail-closed behavior are tested |
| User library | `/etc/mango/library.db` owns Saved/history/finished/ratings/feedback/attribution; no Stremio write-back |
| Resume | `/etc/mango/progress.db` owns exact Continue/resume |
| Playability | `/etc/mango/playability.db` owns verified title/path evidence and rail pools |
| Schema marker | Migration table is authority; committed source's playability migration `14` with API constant `13` is a defect, not a second valid version |
| YouTube cache | `/etc/mango/youtube.db` is rebuildable metadata/reservoir/quota/query state; normalized user history stays in `library.db` |
| Repair | Never automatically rebuild/delete durable DBs, clear history/cache, or rewrite credentials |

## Playback and stream selection

| Topic | Locked choice |
|-------|---------------|
| Acknowledgement | Idempotent asynchronous play session; persisted acceptance precedes foreground handoff |
| Foreground commit | Hide launcher/match display/enable media only after real advancing playback is proven |
| Single flight | Exact title/episode identity, one shared deadline, coalesced provider work, cache write only when logical flight settles |
| Clean-empty recovery | Release default: automatic Movie/Episode Play gets initial resolve plus two 1.2 s confirmations for clean HTTP-200 empty or proven-transient error-only aggregate results; source accepts 0–3 attempts and 0–10 s only as explicit rollback/experiment overrides, so runtime values must be recorded |
| Resolve-confirmation exclusions | No clean-empty confirmation for Detail, Live, picker refresh, HTTP/429, permanent/auth/config error, cancellation, invalidation, deadline exhaustion, or sibling episode |
| Automatic ladder | One attempt budget spans main, last-resort, obligation-floor, risky, and retry phases; pipeline-fatal failures stop |
| Ranking | Identity and capability tiers are lexicographic/path-scoped; cache/scalar bonuses cannot lift known-risky above safe candidates |
| Episode identity | Numeric contradictions reject; full season/episode markers outrank bare episode markers; localized title mismatch is soft if numeric identity agrees |
| Cleanup | PID + play-epoch scoped; stale monitors cannot stop a newer session |
| HUD | Clean startup; cinematic safe-area libass panel; 4/6 s feedback; persistent minimal pause; delayed buffering; no timeline on Live |
| Streams drawer | Five total choices, current pinned, best usable alternative focused, unavailable disabled, isolated validation, revisioned contextual X Undo |
| Switching | Preserve position/tracks/subtitle visibility/generation ownership and one logical watch session; never auto-switch or use stutter detection |

## Quality and target-TV fidelity

| Topic | Locked choice |
|-------|---------------|
| Safe default | Prefer/retain source-matched smooth 1080p as the couch-safe fallback whenever a compatible source exists; providers can legitimately return none |
| 4K SDR | Proven-compatible HEVC/REMUX paths may outrank 1080p under the hifi profile |
| Native HDR | Not supported by the current X11/mpv product path; do not claim ship-ready HDR from Pi codec capability |
| HDR experiments | Kodi/GBM evidence is an integration option only; it remains parked until HUD/input/progress/lifecycle/security parity is solved |
| Acceptance | Visible picture, actual output mode, dropped frames, audio route, lip sync, subtitle/seek/resume, and launcher restore on target equipment |
| TTS | Off until the TV/soundbar audio route is explicitly validated |

## Verified rails and grow

| Topic | Locked choice |
|-------|---------------|
| Visible VOD | Serve verified `rail_pool` titles; hide honest empty/underfilled rails rather than add unverified filler |
| Target | Best effort toward fresh `+20` new-to-rail verified titles per active rail |
| Publish | Work DB and atomic publication; failed/aborted/crashed work preserves the previous couch snapshot |
| Hygiene | Theme gate, active-orphan attachment, unpinned overlap cap, recent rejection memory, runtime-only source weights |
| TV visibility | No grow/progress/debug surface on Home |
| Timers | 03:00 playability/recommendation/YouTube/proof and 06:00 companion jobs use persistent timers plus idle/overlap guards; no independent uncontrolled daytime retry watcher |
| Reliability | Target shortfalls are operator evidence/yellow unless visible availability is broken; do not discard useful completed work by default |

## Voice and companion

| Topic | Locked choice |
|-------|---------------|
| Role | Browse/search/clarify/curate/remember/open librarian; **no voice play** |
| Playback boundary | Voice/phone opens Detail; controller **B** plays |
| STT | Deepgram `nova-3`, multilingual/Hinglish configuration |
| Replies | Text on phone; no TTS or speaking lock in the current contract |
| TV surface | Launcher `voice-hud.ts`; no second Chromium overlay |
| Saved tools | Save/Unsave exact/current context; never auto-save/hide/play |
| Memory boundary | Companion/librarian memory can improve conversation and AI catalogs; it is not an input to YouTube v2 and never exposes Household state to the StoryDNA teacher |

## Fire/Water and VOD recommendations

| Topic | Locked choice |
|-------|---------------|
| Identity | VOD `shadow` and `serve` use Household; `off` restores personal-profile state but has no recommender. Existing personal/mood rows remain recoverable in every mode |
| Ratings | Fire and Water both required; 0 valid; 0–5 in 0.5 steps; movies title-level, series show-level |
| Seed | Approved stable identities only; idempotent; never overwrite later couch history |
| System rails | One six-card For You after Continue/Saved plus one full-corpus Explore rail; every existing category rail and AI-catalog slot remains |
| Eligibility | Current verified/playable/poster-bearing; exclude exact rated, Saved, meaningful watch, hidden, blocked, and Not-for-me |
| Taste | Up to three deterministic positive Bayesian threads; `<1` is negative, `1–2` is neutral, and `>2` contributes quadratically increasing positive evidence. Negative ratings exclude their exact title but do not become broad thematic vetoes |
| Mix | Six, 3+3, or 2+2+2 across supported threads; no v4 12-card/4-1-1/forced-surprise/bridge/cosine/KNN/MMR/cooled-rewatch behavior |
| Content profile | `vod-content-profile-v2` is the sole executable profile: deterministic metadata/rule profiles with immutable compatible StoryDNA overlays and sparse-profile exclusion |
| Content teacher | Stateless and selective only; canonical title evidence in, no household/companion state, and no score/rank/select/publish authority |
| Ranker | Local deterministic uncertainty-aware story graph over the complete verified corpus |
| Browse dealer | For You uses fit-floor relevance weighting and taste-thread quotas; Explore gives every eligible verified title positive probability; categories use trusted/theme membership; AI catalogs retain their own relevance |
| Serve | Atomic current/previous generations and tab deals, last-good fallback, opaque revision-bound attribution; X advances Continue, Saved, For You, Explore, every active category, and every AI catalog without inline network/ranking work |
| Related | Detail uses compatible StoryDNA/content-profile graph edges, requires a semantic plus independent shared family, and omits rather than showing random same-rail cards |
| Rollout | `MANGO_VOD_RECS_V2` controls the Household ranker and `MANGO_VOD_BROWSE_V3` independently controls browse presentation. Both use off/shadow/serve and preserve every historical row |
| Promotion | Current source minimum: at least 15 eligible ratings/five folds, non-null nDCG, same-fold strong-vs-lower-preference concordance ≥0.5 when measurable, true-negative (`Fire<1` and `Water<1`) top-six intrusion ≤1/3, complete accounting, deterministic replay, cached p95 ≤250 ms. Release also requires active-pointer proof, Pi restart/offline/resource proof, and a human couch verdict |
| Acceptance boundary | Automated source/Pi gates do not establish thematic quality. Human ten-shuffle For You plausibility, Explore/category freshness, Detail coherence, focus, and playback remain explicit couch checks |

## YouTube

| Topic | Locked choice |
|-------|---------------|
| Source | First-class native tab; official Data API for metadata/search/subscriptions and `yt-dlp` → mpv for playback |
| Auth/secrets | Operator-owned `/etc/mango/*`, never repository secrets |
| Inputs | Only authoritative complete subscriptions and official Google Takeout watch history influence recommendation acquisition/ranking; Mango-local viewing is limited to History/progress and a 30-day exact-video cooldown |
| Isolation | Search, Saved, profiles, mood, VOD, companion memory, AI catalogs, charts, and generic cache do not influence YouTube v2 |
| Core positions | For You → Beyond Subscriptions → More Like → History → Saved; conditional Subscriptions and Live Now follow |
| Visibility | Normal rows render only with exactly four cards; Live Now renders one to four; logical positions are not guaranteed visible |
| For You | 60% decayed history / 40% subscription affinity, renormalized when one source is absent |
| Portfolio | When both sources have eligible supply, For You contains both; creator and seed caps relax only to fill four. Beyond uses one creator and at most two cards per seed before shortage relaxation |
| OAuth ready | Token receipt is not Ready: resolve authorized channel, enumerate authoritative subscriptions, cover official upload playlists in bounded pages, then report sanitized account/sync truth |
| Locale | India discovery (`IN`) and English relevance (`en`) are independent explicit settings; never infer account country from an absent channel field |
| More Like | Six-to-ten distinct daily-stable official-history seeds; 25 results/query; target reserve 64/cap 120; distinct seed/creator slate preference; official uploads-playlist fallback only for a sub-four thematic pool, then honest omission |
| History/Saved | Stable utility rails; Saved has zero ranking influence |
| X | Cached serving epoch only; no acquisition, API quota, ranking, or network work; History/Saved stay stable |
| Native-feed claim | Public YouTube Data API cannot reproduce YouTube's proprietary Home feed; Mango does not claim it can |
| Rollout | `off` disables recommendation work, `shadow` builds latest-only while hiding recommendation rails, and `serve` exposes Household v2. History/Saved remain utilities; there is no legacy allocator fallback. This flag remains independent of VOD |
| Open proof | Human ten-shuffle relevance, focus/launch/offline behavior, and physical couch judgment remain explicit user gates even after automated Pi proof |

## Live and Search

| Topic | Locked choice |
|-------|---------------|
| Live browse | Optional four thin rails: cricket, F1/racing, news, cartoons; excluded from default gate |
| Live catalog | Full AREA69/NexoTV index is available to Search/voice, not broad Home injection |
| Live cache | Never replace non-empty last-good with empty rebuild; serve stale health-qualified data when necessary |
| Unified Search | Temporary magnifier surface, not a fifth tab/chatbot; local typeahead, explicit submit, progressive isolated phases, no autoplay |
| Search storage | Recents/selection/SafeSearch in `library.db`; YouTube query cache in `youtube.db`; bounded jobs in memory; no `search.db` |

## Reliability and deployment

| Topic | Locked choice |
|-------|---------------|
| Reliability Center | Settings/API Green/Yellow/Red snapshot plus 30-day local proof ledger; Home only gets a degraded badge |
| Optional Live | Intentionally disabled/unconfigured Live must be neutral, not make overall readiness red; current model diverges and requires a fix/test |
| Safe repair | Idle-only allowlist: stale locks, safe strays, controller, catalog, launcher |
| Deploy | Git push/pull only; never rsync/scp/hand-copy repository files |
| Pi precondition | Couch idle and dirty state inventoried/preserved before deploy; do not stash/reset operator changes by default |
| Revision identity | Required branch is `feat/native-experience`; freshly fetched origin, Mac HEAD, and post-deploy Pi HEAD must match. Current wrappers do not enforce/pin this and are blocked for unattended agents |
| Stateful config | AIO `userData`, AIOMetadata config, credentials, seeds, and runtime DBs use explicit separate workflows; current AIO/AIOMetadata mutation helpers and implicit deploy sync need explicit opt-in, secure-temp/cleanup, redacted output and fail-closed hardening before unattended or agent use |
| First boot | `install.sh`/wizard with no SSH is a target, not current functionality |

See [OPS.md](OPS.md). Never commit API keys, OAuth material, debrid secrets,
signed URLs, cookies, or private companion state.
