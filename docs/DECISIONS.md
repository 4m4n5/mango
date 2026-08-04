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
| Select / back | **B**=`304` · **Y**=`308` · **X**=`307` contextual secondary (Home shuffle; Search delete/clear) · **−/+**=`314`/`315` volume · **L**=`310` tab − · **R**=`311` tab + |
| Home | `316`/`311` → `launch-launcher.sh` (`mango-tv-pad.py`) |
| Pad owner | **`mango-tv-pad.py`** — launcher + active playback foreground |
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
| Couch play authority | Play-first: Phase A preference ladder, then Phase B integrity-only obligation floor; first miss demotes to `stale`/`play_miss` (keep pool); `failed` + pool purge only after sustained miss within 24h; browse/verify stay ladder-only ([PLAYABILITY.md](PLAYABILITY.md)) |
| Playback acknowledgement | Launcher uses an idempotent asynchronous session; persisted acceptance precedes foreground handoff, and only failure before the first ready frame is user-visible |
| Replay recovery | Retry at most once after a classified stale cached transport by resolving fresh metadata; never retry cancellation, rate-limit, or malformed-media failures |
| Empty resolve recovery | Automatic movie/episode Play gets at most two 1.2s confirmation passes for clean/proven-transient aggregate empties, absorbing empty → empty → playable inside one B press and the same exact-ID flight/deadline; Detail lists, Live, picker refresh, provider HTTP/429/permanent errors, authoritative no-stream rows, invalidated work, and sibling episodes are never retried |
| Playback cleanup | Natural mpv exit cleanup is PID + play-epoch scoped; stale monitors cannot stop a newer session |
| Foreground playback commit | Launcher/display ownership changes only after real advancing playback is proven; failed candidates and probes remain display-neutral |
| Resolver topology | AIOStreams is the sole VOD aggregate; Torrentio/MediaFusion/Comet are its indexers and TorBox/RD are transports, not direct peer fan-outs |
| Automatic play budget | One attempt cap spans main, last-resort, obligation-floor, risky fallback, and retries; pipeline-fatal failures never fall through |
| Episode stream identity | Explicit numeric contradictions reject; full `SxxExx`/`NxE` markers outrank bare `E`/`EP`; localized title mismatch is soft when numeric identity agrees |
| Playback ranking | Capability tier is lexicographic and path-scoped; `known_risky` never outranks identity-safe smooth/unknown sources through cache or scalar bonuses |
| Playback HUD | Viewer-first cinematic libass panel inside the 5% TV safe area; clean startup, 4s/6s adaptive feedback, minimal persistent pause, delayed buffering, and Live without a timeline; amber is progress/confirmation only |
| Stream switching | Five-choice 58%-height mpv drawer for movies/episodes only; current pinned first, best alternative focused, unavailable last/disabled, isolated validation before every explicit switch, contextual revisioned X Undo after success, one progress session, and no stutter detection or auto-switching |

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
| Timers | Single 03:00 nightly library refresh; no couch-disruptive `OnBootSec`; no daytime auto-retry of failed nightlies — catch-up is explicit operator action |
| Companion nightly | 06:00 consolidate (after grow window); skips if playability maintenance lock is held |
| Reliability Center | Operator-facing Settings/API surface; home stays quiet except a degraded Settings badge |
| Nightly proof | Availability-oriented Green/Yellow/Red proof after movie/TV and YouTube refresh; rail `+20` shortfalls are yellow unless the visible pool is unusable |
| Repair policy | Safe repair only: stale locks, safe strays, pad, catalog, launcher. No automatic DB rebuilds, cache clears, or destructive repairs |

---

## M5 — Voice

| Topic | Choice |
|-------|--------|
| Orchestrator | FastAPI · WSS `:8765` · HUD loopback `:8766` |
| Companion | HTTPS PWA `:3001` (mkcert) |
| Voice role | Browse + open librarian — **no voice play** |
| STT | Deepgram `nova-3` + `multi` + keyterms |
| TTS | Off until M6.3 soundbar/TV validated |
| Companion replies | Text-only on phone; idle immediately after reply (no speaking lock) |
| TV HUD | `voice-hud.ts` in launcher — only default TV voice surface |
| Multi-turn PTT | Allowed while reply visible |
| Reply dwell | `overlay_reply_seconds: 10` |
| Saved tools | Save/Unsave current context or exact title only; no voice play, hide, or auto-save |

---

## M6 — Ship

| Topic | Choice |
|-------|--------|
| Library | Mango-owned `library.db` for explicit Saved, profile watch/history, finished, dormant hidden/blocked fields, and taste/profile hooks; `progress.db` v2 is the profile-exact Continue/resume source |
| Saved | Explicit only; playback never auto-saves; existing user-facing Pins import once into Saved |
| Stremio sync | None. No Stremio user-library sync or write-back |
| AI catalog automation | Must not write to Saved; overflow policy is replace/merge only |
| Viewer profiles | Recommendations v2 is Household-only. Profile UI is hidden; non-Household create/activate returns typed `household_only`; existing profile ratings, Saved/history, progress, snapshots, and events remain dormant and recoverable without merge/delete |
| Profile inheritance | No profile blending in v2 acquisition, ranking, cache identity, or attribution. Exact Continue/resume stays profile-owned in preserved legacy state; Household activation is idempotent |
| Session mood | Removed from recommendation UI/ranking/generation. Existing state is preserved; clear is idempotent and non-null writes return typed `household_only` in v2 serve mode |
| Fire/Water ratings | Both axes required; 0 is valid; 0–5 in 0.5 steps; movies title-level, series show-level; Household retains seed data and later couch history always supersedes seed |
| Rating icon language | Five repeated native flame/wave emoji matching the household sheet; saturated filled portion, gray remainder, clipped half mark, plus visible axis text/value |
| For You ownership | One system rail per Movies/TV tab after Continue/Saved; it never consumes the three user AI-catalog slots |
| VOD recommendation mix | Exactly six strongest supported fits across up to three Household taste threads: `2/2/2`, `3/3`, or all six. No close/adjacent/surprise bucket, bridge, MMR, or cooled-rewatch lane; the prior valid slate remains when six cannot be healed |
| Recommendation policy | `vod-story-graph-v1` ranks the complete verified-playable Movies/TV corpus, publishes at 200 eligible rows, grows to complete accounting, and serves only current verified/poster-bearing candidates from atomic last-good generations |
| Recommendation AI | Mango Companion's configured AI is a stateless StoryDNA content teacher only. It receives title evidence/identity, never household or companion state, and cannot score, rank, select, or publish. The local uncertainty-aware theme graph owns ranking |
| StoryDNA/theme graph | Strict versioned controlled-vocabulary profiles plus fixed ontology/compound/deterministic metadata edges; posterior graph likelihood and uncertainty replace v4 semantic hashes, cosine, KNN, and MMR. Low-confidence facets shrink toward corpus priors |
| Household taste | Up to three deterministic Bayesian threads from positive Fire/Water, Saved, and meaningful VOD viewing. Ratings at or below 2.5 do not propagate a penalty; exact rated/Saved/meaningfully watched titles remain ineligible |
| Recommendation refresh | Rating/Save/meaningful-watch writes commit and evict exact items first; serialized/coalesced work publishes last-good generations. Manual refresh returns HTTP 202 with job ID, captured revisions, and reasons; X is cached serving only |
| Recommendation attribution | Server-issued opaque token binds immutable Household/domain/rail/revision/membership/source/context; stale actions return 409. TV exposes no profiles, mood, IDs, scores, predictions, reasons, ontology tags, prompts, URLs, or credentials |
| Read ownership | Recommendation v2 captures and validates Household plus source/generation revisions; stale actions return 409 and never fall through to ownerless reads. Preserved legacy profile-scoped Continue/Saved APIs keep their existing exact-owner checks |
| Profile companion tool | Preserved for dormant-data compatibility and rollback; in v2 serve mode it cannot create or activate a non-Household recommendation identity |
| YouTube | First-class native tab; official API for metadata/search/subscriptions, `yt-dlp` → mpv for playback; voice opens, pad **B** plays |
| YouTube storage | `/etc/mango/youtube.db` is rebuildable cache with authoritative subscription and provenance-stamped candidate generations; normalized Takeout/Mango history, Saved, exact Not-for-me, and import batches live durably in `library.db` |
| YouTube auth/secrets | API key, OAuth client, token, and optional cookies are operator-owned `/etc/mango/*`; no repo secrets |
| YouTube save policy | Videos only; channels/playlists open lists and are not Saved entities in M6.2; Household Saved remains until explicit Unsave and has zero recommendation influence |
| YouTube rail shape | Ordered equal core rails: For You → Beyond Your Subscriptions → More Like … → History → Saved; then conditional From Your Subscriptions and Live Now. Normal rows have four cards; Live Now may have one to four |
| YouTube history policy | Google Takeout plus qualifying Mango-local viewing only, latest-first and stable; 90-day ranking half-life. The importer is idempotent/path-safe, stores normalized events/diagnostics, and discards raw ZIP/JSON/HTML |
| YouTube input isolation | Only authoritative subscriptions and qualifying history affect acquisition/ranking. Search, Saved, profiles, mood, VOD, companion state, AI catalogs, and charts have zero influence |
| YouTube provenance | Recommendation eligibility requires `subscription_upload`, `subscription_live`, `history_channel`, or `history_topic`; generic metadata-cache presence cannot create provenance |
| YouTube refresh policy | Nightly/manual refreshes publish complete phase-isolated generations atomically and preserve last-good on failure; triggered acquisition coalesces for 15 minutes and Home/X never runs it |
| YouTube For You policy | Local 60% decayed-history / 40% subscription affinity, renormalized when one source is absent; exclude watched/Saved/Short/live and apply creator caps |
| YouTube discovery policy | Beyond uses bounded subscription/history topics and excludes subscribed creators; More Like uses a daily-stable recent meaningful-watch seed because supported API routes lack `relatedToVideoId` |
| YouTube Subscriptions policy | Successful complete OAuth pagination atomically replaces the channel snapshot; newest unwatched uploads and subscribed-channel live streams form the two conditional rails |
| YouTube Live Now policy | Currently live subscribed-channel streams only; no generic live search, unrelated filler, Shorts, or spill into VOD rows |
| YouTube quota policy | Triggered acquisition uses at most five Search calls; nightly caps Beyond/More Like/live probes at 8/4/8 and preserves interactive reserves. X consumes only local published generations |
| YouTube impressions | Persist exact rendered Household/slate/rail/item IDs without URLs; use them for deterministic exposure control, never as a public engagement score |
| Recommendation rollout | Independent `MANGO_VOD_RECS_V2=off|shadow|serve` and `MANGO_YOUTUBE_RECS_V2=off|shadow|serve`; retain legacy snapshots/code through one accepted couch release |
| VOD promotion gate | Frozen deterministic five-fold comparison against v4: ≥10% relative holistic nDCG@6 lift, paired 90% bootstrap interval above zero, ≤2-point regression per guardrail, complete corpus accounting, determinism, and cached p95 ≤250 ms. Sparse evidence stays shadow; post-serve couch judgment can roll back |
| Unified Search | Temporary magnifier surface, not a fifth tab/chatbot; local typing, explicit submit, progressive isolated sources, 9-card local pagination, no autoplay |
| Search persistence | Recents/selection/SafeSearch in `library.db`; YouTube query cache in `youtube.db`; bounded progressive jobs in memory; no `search.db` |
| Interactive quota | 10,000-unit general Pacific day with 2,500 reserved; separate 100-call Search bucket with 25 calls reserved; admitted before request |
| YouTube native recommendations | Exact native YouTube home/recommended feed is not available through supported Data API routes; any raw-feed experiment must be explicit opt-in and isolated from Mango-owned recommender rails |
| 4K | Ship profile on target TV; relax filters in `catalog-filters.json` |
| Deploy | `install.sh` wizard — no SSH for household setup |

Ops: [OPS.md](OPS.md). Never commit API keys.

---

## Appendix — legacy section names

Older docs used **Phase 0–2** (foundation + voice shell) and **N0–N7** slice labels. Map to milestones in [ROADMAP.md](ROADMAP.md#appendix--legacy-names).
