# mango — current couch acceptance

This is the executable release checklist for the current product contract. It
does not inherit PASS results from older task reports, screenshots, SHAs, rail
counts, or recommendation models.

## Evidence and verdict rules

Record this header before testing:

```text
date/time:
source SHA:
Pi SHA:
Pi git status:
MANGO_VOD_RECS_V2 mode:
MANGO_YOUTUBE_RECS_V2 mode:
playback capability/profile:
TV / HDMI port / enhanced-mode setting:
audio route / soundbar:
controller firmware/mode:
tester(s):
```

Use only these verdicts:

| Verdict | Meaning |
|---------|---------|
| PASS | Observed on the named Pi SHA/configuration |
| FAIL | Observed behavior violates the named contract; include exact reproduction/evidence |
| DEFERRED | Hardware, account state, feature mode, source inventory, or human observation was unavailable |
| N/A | Deliberately unsupported/disabled for this release, with the product boundary recorded |

Automated gates prove process/API/state checks. Screenshots prove pixels. Only
the human tester can close physical readability, focus feel, controller/CEC,
visible picture, audio/lip sync, perceived latency, and recommendation quality.

## Safety and preconditions

- Git-only deploy; never rsync/scp/hand-copy repository files.
- Couch must be idle before deploy. `pi-deploy.sh` restarts the stack and can
  stop active playback/indexers.
- Inventory and preserve Pi dirty state. Do not stash/reset unknown operator
  changes as a routine fix.
- Never delete/rebuild runtime databases, cache, history, proof ledgers, or
  credentials to make a test pass.
- Never expose API keys, OAuth/debrid tokens, cookies, signed URLs, raw AIO
  `userData`, private companion state, or IPTV credentials in screenshots/logs.
- AIOStreams `userData` is Pi-owned state; Git deployment does not apply it.
- Current deploy wrappers are blocked for unattended agents: branch/SHA is not
  enforced/pinned and `pi-deploy.sh` can implicitly mutate AIOMetadata private
  state. Follow [DEPLOY.md](DEPLOY.md) and do not begin couch acceptance until
  that blocker is fixed or a human explicitly reviews the exception.
- Pairing mode is recovery only. Ordinary controller power-on is the happy path.
- Live is optional and its provider probes/gates are opt-in.

## 0 — Deploy and automated baseline

From the home Mac, first prove the intended source identity. The deploy-wrapper
lines are intentionally omitted while the blocker above remains open:

```bash
git switch feat/native-experience
git fetch origin feat/native-experience
git pull --ff-only
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/feat/native-experience)"
git status --short
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse HEAD && git status --short && bash scripts/mango-stack.sh status'
# Fix/review the deploy blocker per DEPLOY.md, deploy through Git, then record:
bash scripts/pi-exec.sh 'cd ~/mango && git branch --show-current && git rev-parse HEAD'
```

Run Pi-local gates only after Pi HEAD exactly matches the recorded origin SHA.

For a release candidate, still from the home Mac:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-search-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-youtube-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-ux-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/ai/gate-m5-companion-couch.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/ai/gate-m5-companion-memory.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-controller-reconnect.sh'
```

Run recommendation promotion/evaluation gates named by
[FIRE_WATER_RATINGS.md](FIRE_WATER_RATINGS.md) only when their required corpus
and mode are present. Run Live probes only with explicit provider authorization.

Record every command, rc, duration, warning, and feature mode. A yellow
Reliability result can be usable but is not an unexplained PASS. Red blocks
couch handoff.

## 1 — Launcher, focus, and global states

Test from the physical controller at normal couch distance.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| L1 | Cold launcher | Search · Movies · TV Shows · Live · YouTube appear without wallpaper/desktop/app flash | |
| L2 | Typography/safe area | Essential copy is readable; focused cards/rings are not clipped at TV edges | |
| L3 | D-pad path | Every visible interactive element is reachable and escapable; one focus target at a time | |
| L4 | Focus vs selection | White focus/current state/amber semantic state remain visually distinct | |
| L5 | L/R | Shoulders move exactly one browse tab and preserve per-tab focus/scroll | |
| L6 | B/Y | B selects; Y backs one logical level without resetting unrelated state | |
| L7 | Home | Home returns from playback to the preserved origin; on launcher it does not reset Home | |
| L8 | X ownership | Home X advances only current eligible cached discovery; Search X edits; playback X follows content kind; stale/background player state cannot steal it | |
| L9 | Loading | Skeleton/loading treatment is stable, low-motion, and does not expose diagnostic copy | |
| L10 | Empty | Honest helpful state, no inert normal rail or layout collapse | |
| L11 | Offline/stale | Last-good content remains usable where contracted; stale/offline copy is calm and actionable | |
| L12 | Toasts/errors | Copy is concise, non-stacking/non-flickering, and never shows raw IDs/URLs/provider secrets | |
| L13 | Return | Detail/Search/tab/focus/scroll survive Chromium restart used by playback return | |
| L14 | Performance | Repeated rapid D-pad moves do not lose/duplicate actions or create periodic stalls | |

Capture 1920×1080 screenshots for Home, each tab, loading, empty, offline/stale,
error/toast, Detail, and Settings. Inspect both pixels and focus geometry.

## 2 — Detail, library, and episodes

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| D1 | Movie Detail | Title/art/synopsis/actions are coherent; no raw filename, provider URL, or duplicated control legend | |
| D2 | Series Detail | Season/episode navigation is exact and retains show identity | |
| D3 | Save/Unsave | Immediate durable Saved update; playback never auto-saves | |
| D4 | Continue | Exact position belongs to the played title/episode and appears newest-first | |
| D5 | Resume | Resume returns near prior position; no Household blending or sibling-episode substitution | |
| D6 | Finish | Movie 90% and series completed-episode semantics update history/finished without stealing focus | |
| D7 | Not for me/Undo | Exact item disappears/reappears; no related-title/creator/topic penalty is implied | |
| D8 | Stale context | A stale revision/action fails safely and reconciles; it never mutates another item/profile | |

## 3 — Playback start and resolver robustness

Use representative cached/uncached Movie, exact Episode, YouTube, and optional
Live items. Include previously problematic **The Internet's Own Boy** and the
exact **Alliance** episode when those IDs/sources exist in the configured
runtime; record substitutes and exact IDs otherwise.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| P1 | Clean startup | Launcher stays visible during resolve/probe; no early black screen or late playback after Detail returns | |
| P2 | First frame | Foreground changes only after advancing media; picture and audio begin as one coherent transition | |
| P3 | Normal fast path | Usable existing stream starts from the first B press; record accepted/TTFF/ready durations separately | |
| P4 | Empty→empty→playable fixture/title | Release defaults `MANGO_STREAM_ZERO_RETRY_ATTEMPTS=2` and delay `1200`; initial plus two eligible confirmations recover inside one B press, same exact ID and deadline | |
| P5 | Error classification | Resolver HTTP/fetch timeout, 5xx, 429, auth/config/permanent, cancel, malformed, and expired-deadline notes do not enter the clean-empty confirmation loop or start later in background; candidate-local mpv/network failures may advance to a later candidate inside the same request and wall | |
| P6 | Exact episode | Every resolve/probe/winner uses `tt…:season:episode`; no sibling fallback | |
| P7 | Single flight | Repeated/duplicate input does not create duplicate provider fan-out or competing playback | |
| P8 | Honest failure | Original Detail remains visible/usable; no black wallpaper, phantom toast, or late mpv process | |
| P9 | Cancellation | Y/Home cancels scoped work and a stale completion cannot acquire foreground | |
| P10 | Replay | Stop and immediately replay; stale monitor/epoch cannot stop the new session | |
| P11 | Return | Stop/natural exit flushes progress, restores 1080p60 launcher once, and returns exact focus | |
| P12 | Provider evidence | Credential-safe counters show AIO aggregate contribution; never infer nested provider success from Git config alone | |

TTFF is a measured distribution, not the ladder's safety wall. Record profile
and loaded `auto_play_wall_ms` (90 s base, 120 s `4k-hifi`) separately.

## 4 — mpv HUD and Streams drawer

Render fixture states first, then verify during real playback:

```bash
bash scripts/m6-ship/render-mpv-hud-fixtures.sh /tmp/mango-hud-fixtures
bash scripts/m6-ship/gate-m6-stream-picker-smoke.sh
```

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| H1 | Startup | No HUD until interaction; clean film image | |
| H2 | Normal HUD | Safe-area cinematic panel; title/episode; elapsed and negative remaining; one proven technical line; contextual hints | |
| H3 | Feedback | Exact signed seek, volume value, subtitle/audio selection, pause/resume; 4 s normal and 6 s track/error dwell | |
| H4 | Pause | Full panel settles to a small persistent centered Paused badge; disappears immediately on resume | |
| H5 | Buffering | Appears only after 1 s anti-flicker and clears immediately on recovery | |
| H6 | Live | LIVE badge, no false timeline, no X guidance/response | |
| H7 | YouTube | X has no response; native playback controls remain coherent | |
| H8 | Drawer layout | 58%-height bottom drawer/local scrim; vivid playing video; stable 60/40 list/detail layout | |
| H9 | Five choices | Maximum five including current first; current amber Playing/check; best usable alternative initially focused | |
| H10 | Readiness | Ready now / May take longer / Unavailable; risky copy says May stutter on this device; details explain why | |
| H11 | Focus/disabled | 4 px white focus distinct from current; unavailable last, visibly disabled, and B cannot select it | |
| H12 | Checking | Chosen row says Checking stream…; duplicate input suppressed; current play continues | |
| H13 | Success | Drawer closes; Now playing confirmation; X temporarily Undo; position/tracks/subtitle state continue | |
| H14 | Undo | Restores prior candidate by opaque ID/latest revision, then restores normal X-to-Streams ownership | |
| H15 | Failure | Drawer stays open on failed row with persistent error band; original stream continues | |
| H16 | No alternatives | Clear no-alternatives state, not an inert normal list | |

## 5 — Fire/Water and VOD recommendations

Do not run served-quality acceptance while VOD mode is `off`/`shadow`; record
the mode and mark served checks DEFERRED. `off` has no For You rail. `shadow`
builds latest-only without exposing For You and uses exact Household
recommendation/Saved ownership while preserving personal rows; verify that
state transition explicitly rather than treating shadow as invisible compute.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| F1 | Rating sheet | Five flame/wave marks; labels + numeric values; half mark exactly clipped; 0 is valid | |
| F2 | D-pad edit | Up/Down axis/action; B enters/confirms; Left/Right exact 0.5; Y cancels; X clear confirmation | |
| F3 | Series identity | Rating from an episode writes show-level rating only | |
| F4 | Prompt | Movie 90% / three distinct series episodes; invitation appears on return without stealing focus | |
| F5 | Durability | Set/edit/clear survives restart; append-only history and seed precedence remain intact | |
| F6 | Privacy | Teacher/network request contains canonical content evidence only—no ratings, Saved/history, profile, mood, conversation, or memory | |
| F7 | Corpus/pointer | `scored + excluded == verified`, `unscored == 0`, coverage 1 for a complete publish; `/recommendations/state` must show newest diagnostics separately from matching active/previous/public pointers and epoch | |
| F8 | Rail shape | One For You after Continue/Saved; exactly six current verified/poster-bearing cards | |
| F9 | Mix | Six, 3+3, or 2+2+2 across supported threads; no v4 12-card/4-1-1/forced-surprise/rewatch behavior | |
| F10 | Exclusions | Exact rated, Saved, meaningful watch, hidden, blocked, and Not-for-me absent | |
| F11 | X | On the active Movies/TV tab, response advances `For You` and every category rail from cached verified pools without network/metadata/teacher/graph/corpus/rank work; Continue/Saved and the other tab remain stable; `For You` avoids four prior slates and category rails prefer not-recent titles when supply permits; any asynchronous low-water job is separately attributed | |
| F12 | Last good | Teacher/offline/restart/job failure retains prior valid six-card rail | |
| F13 | Rollback | serve → shadow/off removes For You without data loss; reviewed Git rollback is required for older ranking behavior | |
| F14 | Quality | Human compares relevance, diversity, familiarity, novelty, multilingual fit, and repetition across Movies/TV | |
| F15 | Shadow identity | Personal rows/counts remain intact; profile/mood writes are typed; Continue/progress and Saved ownership match the accepted Household policy with no shadow/serve divergence | |
| F16 | Recommendation-disabled Shuffle | Off/shadow expose no `For You` or public recommendation epoch, but X still honestly changes cached category rails; no-op/exhausted pools never report false success | |

The Pi serves target `7ed5a31` with complete progressive accounting, bounded
frontier-off behavior, healthy reserves, and an aggregate pre-couch PASS after
the standard display-wake path restored X11 Monitor On. Earlier 100-X proof
exercises cyclic `For You`; current exact-SHA proof covers 30 Shuffle calls per
tab, every category rail, utility stability, zero startup rank work, and
service p95 71.4 ms Movies / 47.9 ms TV. Do not turn automated proof into
a human quality claim: F1–F14 still require the physical
ten-shuffle relevance, focus, playback-return, picture, and audio checks. A
bulk artifact/importer is required only if measured progressive quality gaps
justify that additional architecture.

## 6 — Native YouTube

Do not expose OAuth/API material in evidence. Distinguish base YouTube from v2
recommendation mode.

YT1–YT4 apply in every mode. YT5–YT14 are **serve-mode** acceptance: mark them
DEFERRED in `off`/`shadow`, where recommendation rails are absent and only
eligible History/Saved utility rails remain. The non-Household `off` ownership
regression is source-tested at the target and must be re-proven on the Pi.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| YT1 | Base tab | Cached metadata remains usable; Search groups Videos/Channels/Playlists | |
| YT2 | Connect | Companion device flow succeeds; token stays `/etc/mango`, 0600; LAN status DTO stays sanitized | |
| YT3 | Takeout | Bounded ZIP/JSON/HTML import is path-safe/idempotent; normalized events remain; raw upload is discarded | |
| YT4 | Playback | Video B → `yt-dlp` → mpv; one selector fallback at most; couch-safe 403/429/CAPTCHA error | |
| YT5 | Input isolation | Only authoritative OAuth subscriptions and official Takeout history influence v2; Mango-local viewing is History/progress plus exact cooldown only | |
| YT6 | Logical order | For You, Beyond, More Like, History, Saved, then conditional Subscriptions/Live | |
| YT7 | Supply honesty | Normal rows render only at exactly four cards and can be absent; Live renders 1–4; no unrelated filler | |
| YT8 | X/quota | X advances cached eligible rails only; API/search counters unchanged; History/Saved stable | |
| YT9 | For You | 60/40 decayed official-Takeout history/subscriptions with cold-start renormalization; exact meaningful watches are absent for 30 days while Saved/Short/live exclusions remain exact | |
| YT10 | Beyond/More Like | Beyond excludes subscribed creators; More Like uses a stable official-Takeout seed; creator caps/dedupe hold | |
| YT11 | Not for me | Exact reversible video suppression only; no creator/topic penalty | |
| YT12 | Failure | Partial refresh/OAuth/quota failure preserves explicit stale last-good generation | |
| YT13 | Empty setup | With neither qualifying subscriptions/history, show connect/import/watch setup—not fake Popular filler | |
| YT14 | Human quality | Relevance, creator diversity, novelty, multilingual/topic fit, stale behavior, and repetition accepted | |
| YT15 | Off rollback | With a non-Household active profile, off returns the intended utility/setup surface without 409 and preserves all personal/Household rows | |
| YT16 | AI catalog honesty | A YouTube AI-catalog slot is never claimed visible unless the current Home renderer actually composes it | |

The supported Data API cannot reproduce YouTube's proprietary native Home feed;
absence of that feed is not a defect in Mango's supported model.

## 7 — Unified Search

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| S1 | Open/close | Magnifier opens a temporary surface; Y restores exact originating tab/focus | |
| S2 | Keyboard | D-pad QWERTY is spatially predictable; text caret/query readable; B types/selects correctly | |
| S3 | X | Tap deletes one character; hold ≥600 ms clears; returning Home restores current-tab X | |
| S4 | Local | Verified Movies/TV plus cached proven Live/YouTube appear quickly without submit | |
| S5 | Submit | External VOD, unknown Live, YouTube, optional AI phases progress independently | |
| S6 | Partial failure | One degraded source cannot erase usable rows; state/copy says which phase failed | |
| S7 | Quota | Cached result first; admitted fresh YouTube work respects protected interactive budgets | |
| S8 | Detail/playback return | Query, scope, results, focus, scroll, and origin survive Detail and playback | |
| S9 | Recents/learning | Bounded and reversible; no accidental search/history mutation during diagnostic gate | |
| S10 | No autoplay/chatbot | Search opens Detail only and does not become a conversation surface | |

## 8 — Optional Live TV

Run only when configured and explicitly opted in:

```bash
bash scripts/live/live-diagnostics.sh
MANGO_LIVE_GATE=1 bash scripts/live/gate-live-iptv.sh
MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh
```

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| TV1 | Browse shape | Only configured cricket, Formula 1, news, cartoons rails; empty qualified rows hidden | |
| TV2 | Full search | AREA69/free/news/cartoons full local index available to Search/voice without broad Home injection | |
| TV3 | Cache | Failed/empty refresh never replaces compatible non-empty last-good; old policy cache rejected | |
| TV4 | Health | Credential-safe hashed state only; known failures suppressed until horizon; no raw URLs/source secrets | |
| TV5 | Play | Immediate Live path, canonical variant failover, LIVE HUD/no timeline, no VOD empty confirmation | |
| TV6 | Source outage | Honest stale/empty/error state without hammering provider or corrupting cache | |

## 9 — Companion and voice

Requires `MANGO_VOICE=1` and a phone on the authorized LAN boundary.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| V1 | Text/PTT | Composer and PTT share one conversation/tool path; Hinglish corpus remains intelligible | |
| V2 | Discovery | Ambiguous request clarifies on phone and does not jump TV on turn one | |
| V3 | Clear open | Exact/ordinal selection opens Detail; phone says opened only after `tv_seq` ack | |
| V4 | Playback boundary | No tool or phrasing autoplays; B remains required | |
| V5 | Structured picks | Phone cards readable/selectable; no raw IDs or false availability claims | |
| V6 | TV HUD | Safe-area action/reply copy, bounded dwell, no focus theft or second browser overlay | |
| V7 | Mirror | Current tab/open title/playing/tool status coherent after pad and phone actions | |
| V8 | Save/AI rails | Exact Save/Unsave and custom-rail CRUD; automation never writes Saved | |
| V9 | Memory | Completed-watch/journal/90-day rollup/compiled notes survive restart and feel appropriately familiar | |
| V10 | Privacy boundary | Companion memory does not influence YouTube v2 or enter StoryDNA teacher requests | |
| V11 | LAN boundary | Only exact companion capabilities pass; operator recommendation/YouTube/private journal state returns 403 | |
| V12 | Output | Text-only reply; no TTS/speaking lock; immediate next turn works | |

## 10 — Controller reconnect and intentional display sleep

### Controller

Run five complete cycles: power Micro off, wait for `waiting for controller`,
power on normally, navigate, start/stop a short play, repeat.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| C1 | Five normal wakes | Every cycle reconnects/grabs current evdev node without pairing mode/reboot/stack restart | |
| C2 | Link vs router | Root link supervisor owns Bluetooth; one user router owns input; no duplicate consumers | |
| C3 | Focus/input | First deliberate button does not create duplicates or leave focus lost | |
| C4 | Recovery copy | Pairing is offered only after diagnostics prove missing bond; never documented as happy path | |

### Display sleep

These checks remain expected **DEFERRED/FAIL** until the locked feature is
implemented; permanent anti-sleep or accidental 600-second blanking is not PASS.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| DS1 | Settings | Off/15/30(default)/60/120 persists across reboot | |
| DS2 | Idle reset | Only D-pad and companion reset the timer; background progress/service events do not | |
| DS3 | Playback inhibit | Never sleeps during active mpv, including beyond selected timeout | |
| DS4 | Sleep | Idle timeout sends DPMS Off + CEC standby exactly once | |
| DS5 | Wake | D-pad/companion wake sends DPMS On + CEC power-on and restores correct foreground/focus | |
| DS6 | CEC unavailable | Safe DPMS/focus behavior without loop, crash, or repeated power commands | |
| DS7 | Accidental Xorg | `xset q` no longer exposes an independent 600-second path that bypasses Settings | |

## 11 — Target-TV picture and audio

Test at least representative 1080p SDR and compatible 4K SDR HEVC. Test HDR only
if an explicitly supported integrated engine exists; otherwise record native
HDR as N/A/unsupported, not PASS.

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| AV1 | Launcher | 1920×1080@60, readable, responsive, no overscan clipping | |
| AV2 | 1080p film/TV | Correct source-matched cadence, visible smooth picture, stable audio/subtitles | |
| AV3 | 4K SDR HEVC | Actual 4K source/output when intended, hardware decode, acceptable dropped frames, no blue screen/slow motion | |
| AV4 | Risky fallback | HDR/DV/software 4K never outranks smooth supported candidate merely for resolution/cache | |
| AV5 | Audio | Intended TV/soundbar sink, channel layout, volume, lip sync, no drop across start/seek/pause/resume | |
| AV6 | Streams/HUD load | Drawer/HUD interaction produces no dropped-frame regression during 4K SDR | |
| AV7 | Return | Black-safe downscale, one launcher reveal, posters/focus intact at 1080p60 | |
| AV8 | HDR boundary | TV HDR activation and transfer are claimed only when measured through the integrated supported path | |

## 12 — Restart, offline, maintenance, and state preservation

| ID | Check | Expected | Verdict/evidence |
|----|-------|----------|------------------|
| R1 | Catalog restart | Durable library/progress/ratings/feedback and last-good generations survive | |
| R2 | Full reboot | Correct launcher, feature modes, controller wait/reconnect, persisted settings, no desktop/fallback app | |
| R3 | Network offline | Cached/last-good rails remain; honest degraded Search/YouTube/teacher/provider states; Home never waits for AI | |
| R4 | Nightly | Persistent timer/idle/overlap guards, staged grow, exact recommendation jobs, YouTube phase, WAL, proof chain observable | |
| R5 | Failed maintenance | Previous couch snapshot/generations stay active; operator gets precise non-secret reason | |
| R6 | Safe repair | Only allowlisted locks/strays/controller/catalog/launcher work; no DB/cache/history/credential deletion | |
| R7 | Resource pressure | Foreground input/playback wins; no OOM/restart loop or corrupted publication | |
| R8 | Backup/migration | WAL-safe backup and additive migrations; before/after user-state counts preserved | |

## Final sign-off

Summarize by product outcome, not by number of commands:

| Outcome | Verdict | Evidence / remaining defect |
|---------|---------|-----------------------------|
| Browse/Search/Detail | | |
| Playback start/failure/return | | |
| HUD/Streams | | |
| Library/Fire-Water | | |
| VOD recommendations v2 | | |
| YouTube base/v2 | | |
| Live (optional) | | |
| Companion/voice | | |
| Controller reconnect | | |
| Display sleep/CEC | | |
| Target-TV picture/audio | | |
| Offline/restart/nightly/reliability | | |

The release is not ready to merge while a P0 viewing/state/security defect is
open, while a claimed feature lacks its required mode/proof, or while display
sleep/target-TV capability is documented more strongly than observed. Record
DEFERRED items explicitly with the exact next command or human/hardware step.
