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
| AIOMetadata state | Import/config/export is Pi-owned and explicit; deploy no longer syncs rails unless `MANGO_SYNC_AIOMETADATA=1`. Direct mutation helper still needs secure-temp/redaction hardening |
| User library | `/etc/mango/library.db` owns Saved/history/finished/ratings/feedback/attribution; no Stremio write-back |
| Saved placement | Normalized source/media type owns the tab: YouTube → YouTube, series → TV Shows, tv/live/channel → Live, movie/film/blank → Movies. A navigation-origin hint applies only to unknown types and can never move known content |
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
| HUD | Clean startup; translucent floating card; stable title; always-on volume meter with −/+; time/progress instrument; equal Subtitles/Audio/Quality chips; complete pad legend; 4/6 s feedback; persistent minimal pause badge; delayed buffering; no timeline on Live; amber is state only |
| Streams drawer | Five total choices, current pinned, best usable alternative focused, unavailable disabled, isolated validation, revisioned contextual X Undo; inset floating sheet matching HUD material |
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
| Timers | 03:00 playability/YouTube/proof and 06:00 companion jobs use persistent timers plus idle/overlap guards; grow enqueues VOD desired revisions asynchronously; no nightly rank wait or full library VACUUM; no independent uncontrolled daytime retry watcher |
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
| Taste | Deterministic sparse IDF-weighted 0/1/2 lanes; `<1` exact-title veto upstream; `1–2` neutral; `>2` quadratic positive evidence; ≥2 anchors per lane for two lanes else one; legacy Bayesian K=1..3 / LOAO quarantined off by default |
| Mix | Six or 3+3 across active lanes (two lanes only with ≥2 anchors each); no v4 12-card/4-1-1/forced-surprise/bridge/cosine/KNN/MMR/cooled-rewatch behavior |
| Content profile | `vod-content-profile-v2` is the sole executable profile: deterministic metadata/rule profiles with immutable compatible StoryDNA overlays and sparse-profile exclusion |
| Content teacher | Stateless and selective only; canonical title evidence in, no household/companion state, and no score/rank/select/publish authority |
| Ranker | Local deterministic full-corpus IDF-weighted lane centroids with canonical dealer; isolated worker (file lease, ignores couch preemption, low-priority/≤384 MiB); catalog enqueue-only via `vod_desired_revisions` (migration 19); activation-only ack with 1m–1h pending retry |
| Top Picks | When no generation is activatable, Home shows labelled **Top Picks** (never false **For You**) from the verified corpus deterministically |
| Browse dealer | `deep-weighted-v1` samples without replacement over every eligible title at each epoch: 95% normalized relevance plus a 5% uniform floor. `pool_max` is acquisition-only. For You deals dynamically after its fit floor/threads/caps and retains current plus four rendered slates; category/Explore avoid one prior slate. Continue/Saved are newest-first on ordinary load and recency-weighted `deep-weighted-v1` samples on X (Continue also weights remaining progress); no exposure counter or future-page queue |
| Serve | Atomic current/previous generations and tab deals, last-good fallback, opaque revision-bound attribution; truthful Top Picks when no activatable generation; X advances Continue, Saved, For You or Top Picks, Explore, every active category, and every AI catalog without inline network/ranking work |
| Related | Detail VOD uses compatible StoryDNA/content-profile graph edges; YouTube Detail resample label is **More to watch**; requires semantic plus independent shared family for VOD; omits rather than showing random same-rail cards |
| Maintenance | Grow publication enqueues desired revisions only (household taste/exclusion hash + corpus inputs); nightly does not wait on rank completion; full `library.db` VACUUM is offline-only; staged stale refresh owns expired demotion and proactive renewal; grow-only pre-stage runs trigger drain only; playability/compaction stop enabled worker before exclusive DB work and restore after |
| Worker isolation | `mango-vod-recs-worker.service` owns rank work with file lease/heartbeat, ignores couch preemption, low-priority/≤384 MiB envelope; only **activated** ranks ack; failures stay pending with 1m–1h retry; stale revision checked transactionally before pointer swap; catalog serves and enqueues only |
| Rollout | `MANGO_VOD_RECS_V2` controls the Household ranker and `MANGO_VOD_BROWSE_V3` independently controls browse presentation. Both use off/shadow/serve and preserve every historical row |
| Promotion | Current source minimum: at least 15 eligible ratings/five folds, non-null nDCG, same-fold strong-vs-lower-preference concordance ≥0.5 when measurable, true-negative (`Fire<1` and `Water<1`) top-six intrusion ≤1/3, complete accounting, deterministic replay, cached p95 ≤250 ms. Release also requires active-pointer proof, Pi restart/offline/resource proof, and a human couch verdict |
| Acceptance boundary | Automated source/Pi gates do not establish thematic quality. Human ten-shuffle For You plausibility, Explore/category freshness, Detail coherence, focus, and playback remain explicit couch checks |

## YouTube

| Topic | Locked choice |
|-------|---------------|
| Source | First-class native tab; official Data API for metadata/search/subscriptions and `yt-dlp` → mpv for playback |
| Playback quality | Hard 1080p ceiling in resolver policy; one HLS-first then https-DASH adaptive selector, lower operator caps allowed, no progressive or sequential height ladder |
| Resolver clients | Follow yt-dlp's maintained defaults; never commit a point-in-time YouTube `player_client` list. Operator extractor overrides are emergency-only and visible in runtime diagnostics |
| Resolver lifecycle | Recommended nightly channel in atomic active/previous slots; only metadata-certified slots execute (never legacy/system fallback); promote only after every available sampled current-rail title plus stable VOD/music/channel-live controls pass real transport reads; stable controls cover first install or intentionally empty rails; upstream-fragile classes remain advisories; a failed active resolver requests idle-safe background repair and may fall back once to the previous canaried slot inside the original deadline |
| PO tokens | Explicit `bgutil` HTTP provider supervised by systemd, bound to loopback only, and required by the Pi ship gate when enabled |
| Playback auth | Public playback resolves anonymously first; operator-owned cookies are retried only after an account or explicit bot sign-in challenge, never attached to every public resolve |
| Auth/secrets | Operator-owned `/etc/mango/*`, never repository secrets |
| Inputs | Authoritative complete subscriptions plus official Google Takeout and Mango-local meaningful watches (equal decayed strength) influence recommendation acquisition/ranking; exact Not-for-me remains a video veto and also applies a decaying channel penalty |
| Isolation | Search, Saved, profiles, mood, VOD, companion memory, AI catalogs, charts, and generic cache do not influence YouTube v3 |
| Core positions | For You → From Your Subscriptions → Your regulars → More Like → Beyond Your Subscriptions → History; Saved follows as a utility; Live Now follows when present |
| Visibility | Normal rows render only with exactly four cards; Live Now renders one to four; logical positions are not guaranteed visible |
| For You | Quality-gated Takeout+local-history and subscription candidates; both source families must appear when both have eligible supply. Unsubscribed history affinity rises from 0.60 to 1.00 with decayed channel strength; subscribed affinity rises from 0.75 to 1.00. The retired fixed 60/40 blend is not a second ranker |
| Portfolio | When both sources have eligible supply, For You contains both; creator and seed caps relax only to fill four. Beyond uses one creator and at most two cards per seed before shortage relaxation |
| OAuth ready | Token receipt is not Ready: resolve authorized channel, enumerate authoritative subscriptions, cover official upload playlists in bounded pages, then report sanitized account/sync truth |
| Locale | India discovery (`IN`) and English relevance (`en`) are independent explicit settings; never infer account country from an absent channel field |
| Candidate depth | Quality-gated A/B candidates plus at most 64 tier-C candidates publish up to 512 per normal rail. Nightly uses at most the configured background Search allowance after preserving 25 interactive calls; triggered refresh stays coalesced and capped at 12 Search calls |
| More Like | Up to ten daily-stable official-history seeds; 50 results/query; seek at least eight contributing topics and continue quality-gated fill toward the 512 rail cap; distinct seed/creator slate preference; official uploads-playlist fallback only for a sub-four thematic pool, then honest omission |
| Your regulars | Mixed rewatch (≥2 lifetime watches, exempt from the 30-day cooldown) and fresh uploads from top-affinity plus rewatch channels (up to 24 affinity channels, unioned with channels you actually repeat); target 2+2 with either-way backfill. Serving shuffles those two subpools independently with a gentler weight curve so a tiny A-tier head cannot freeze two of four cards |
| History/Saved | History shuffles with X from the cached watch pool; Saved is a stable utility with zero ranking influence |
| Not-for-me | Exact reversible video veto plus a decaying channel penalty (×0.6 per event, 60-day half-life, floor ~0.25). Undo restores both |
| Embeddings | `MANGO_YOUTUBE_EMBEDDINGS=1` plus `MANGO_YOUTUBE_SIM=blend` (or `embedding`) turns on local MiniLM (`Xenova/all-MiniLM-L6-v2`, 384-d q8 ONNX). Download once with `scripts/m6-ship/ensure-youtube-embeddings.sh`. Default remains lexical/zero compute. Hash backend is tests/eval only. |
| X | Each epoch is an independent deterministic relevance-weighted draw from the published cache. Uniqueness is only within the visible slate; repeats across X are valid. No impressions, exposure counts, recent-slate exclusion, deck, acquisition, API quota, ranking, or network work affects selection; History shuffles from its cached pool; Saved stays stable |
| Failure boundary | Incomplete authoritative subscription/discovery/Live requests and atomic publication failures preserve an explicitly stale last-good generation. The clean 90-second acquisition wall is a successful bounded stop: discard the late result and permit previously accepted candidates to publish; ordinary eight-second request timeouts remain source failures |
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
| Revision identity | Required branch is `feat/native-experience`; freshly fetched origin, Mac HEAD, and post-deploy Pi HEAD must match. `pi-deploy.sh` / `pi-exec-gate.sh` fail closed on that contract |
| Stateful config | AIO `userData`, AIOMetadata config, credentials, seeds, and runtime DBs use explicit separate workflows; deploy AIOMetadata rail sync is opt-in via `MANGO_SYNC_AIOMETADATA=1`. Direct mutation helpers still need secure-temp/redaction hardening |
| First boot | `install.sh`/wizard with no SSH is a target, not current functionality |

See [OPERATIONS.md](OPERATIONS.md). Never commit API keys, OAuth material, debrid secrets,
signed URLs, cookies, or private companion state.
