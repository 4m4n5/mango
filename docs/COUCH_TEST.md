# Couch test checklist

**Branch:** `feat/native-experience` · **Pi HEAD:** `8eeb239` (2026-07-05) · **Gate:** `bash scripts/pi-exec-gate.sh` (gate-lite ~2 min) + ux-smoke on feat branch

Run gate on Mac before handing off to the TV. Live IPTV is opt-in — not in gate-lite.

---

## Automated preflight (agent)

```bash
bash scripts/pi-deploy.sh --fast --gate   # pull, build, gate-lite
bash scripts/diag/series-episodes.sh --sample   # on Pi — episode meta + stream probes
python3 scripts/diag/playability-status.py   # pool depth
python3 scripts/diag/grow_monitor.py status  # latest grow health; operator-only
bash scripts/m6-ship/gate-m6-library-smoke.sh # Saved/current-context smoke
bash scripts/m6-ship/gate-m6-youtube-smoke.sh # YouTube state/rails/search/detail
bash scripts/m6-ship/gate-m6-ux-smoke.sh      # M6.5 HUD/focus contracts
bash scripts/m5-voice/ai/gate-m5-companion-memory.sh  # living librarian watch signals
```

---

## Browse & pad (M2)

| # | Action | Pass? |
|---|--------|-------|
| 1 | **Movies** tab loads 9-up poster grid | |
| 2 | **L/R shoulders** switch Movies ↔ Series ↔ Live | |
| 3 | **X shuffle** (pad `307`) — new titles, no rate-limit text | |
| 4 | **Series** tab — rails populated | |

---

## Series episode picker (M3)

| # | Action | Pass? |
|---|--------|-------|
| 5 | Open **Panchayat** (or Breaking Bad) → episode list below actions | |
| 6 | D-pad **down** into episodes — **active season only**; streams strip **does not** update on focus | |
| 7 | **L/R** on season chip or episode row **changes season** (multi-season); chip row hidden when one season | |
| 7a | **B** on focused episode resolves and plays immediately; no dwell prefetch or mandatory picker. **Play** from actions row = global resume | |
| 8 | Grey/unverified rows remain focusable and show **tap to retry**; **B** re-runs the normal main → last-resort → floor play path | |
| 9 | **Play / Resume** starts mpv; **Y** returns to detail | |
| 10 | Exit an episode early → same episode row is focused; finish to **≥90%/EOF** → the next episode row is focused directly, including across a season boundary | |

---

## Play (M3)

| # | Action | Pass? |
|---|--------|-------|
| 11 | Movie → detail → **Play** → mpv ≤90s | |
| 11a | From mpv, **Y** returns to the same launcher state: same tab, same title/detail context, no reshuffle/reset to Movies | |
| 12 | **Continue** rail resumes if entries exist | |
| 13 | **⌂** always returns home | |

## Playback-hardening acceptance (home Mac/Pi only)

Do not mark these from work-Mac source checks. Capture the referenced runtime evidence after the reviewed commit is pushed and deployed once with `--fast --gate`.

| Check | Couch action and required evidence | Pass? |
|---|---|---|
| Timeout cancellation | Force/observe a play exceeding the 95 s launcher watchdog; confirm the request ID is cancelled and no ghost mpv starts later | |
| Hard language | Play a hard-language title; logs/attempt metadata show no wrong-language candidate attempted | |
| Picker single-shot | Choose one displayed release; the sole attempt has that URL identity and ladder step, with no silent substitution | |
| Movie return state | Exit a movie from both 1080p and matched-4K output; Chromium may restart, but the same tab/title detail returns with Play focused instead of Movies home | |
| Series early-exit state | Exit a series episode below the finished threshold; the same title/season/episode remains and that episode row is focused after progress refresh | |
| Series completion state | Exit at ≥90% or natural EOF; the same title detail returns with the next episode row focused, including last-episode-to-next-season; no takeover overlay steals focus | |
| Long-play ownership | Play for >30 minutes (or approved accelerated equivalent); maintenance defers and does not stop the couch-owned mpv | |
| 1080p HDR | Play the fixture; effective mpv properties and visible picture confirm the intended 1080p HDR/tone-map path | |
| 4K SDR HEVC | Play a verified 4K fixture; winning main step is SDR + HEVC and effective decoder/output properties match | |
| Subtitles/audio | ↑ shows/cycles subtitles; A shows/cycles audio; selected audio/subtitle and channel policy are audible/visible | |
| HDMI restore | First visible frame appears only after source match; Y/⌂ restores `1920x1080@60` before launcher reveal | |
| Frame drops | `scripts/diag/playback-4k-proof.sh` records real presented/dropped-frame evidence; never infer a pass from source config | |

### Episode success reconciliation (home Mac/Pi only)

Use an existing failed episode row from the first query; these checks are
read-only. Open that exact episode from Series detail, press **B**, wait for mpv
to start, then return with **Y**. Pass means there is no late **catalog timed
out** toast, the row is not grey/**tap to retry**, and the exact episode row is
freshly `verified`. A genuine pre-play failure must still show the retry state.

```bash
sqlite3 ~/.cache/mango/playability.db \
  "SELECT type,id,status,fail_reason,expires_at,updated_at FROM titles WHERE id LIKE 'tt%:_:_%';"

curl -sf "http://127.0.0.1:3020/series/<bareSeriesId>/episodes" \
  | jq '.. | .playable? // empty'
```

| Check | Required evidence | Pass? |
|---|---|---|
| Successful non-`:1:1` episode | Before/after SQL row plus episode JSON show the played episode changed from stale `failed` to fresh `verified`/`playable: true`; no late timeout toast or grey row | |
| Real pre-play failure | Use an unreachable/exhausted episode without starting mpv; timeout/error remains visible and the episode stays retryable, not falsely verified | |
| Gate episode regression | Bare-series Play and `:1:1` still follow the normal rail-gate promotion/demotion behavior | |

### Stream-source policy and resolve-load confirmation (home Mac/Pi only)

Run these on the Pi after the reviewed tree is deployed. The first command is
credential-safe: it reads the live AIOStreams user profile but prints no keys.
Do not infer a pass from the repo patch alone.

```bash
cd ~/mango
bash scripts/m4-addons/aiostreams-config.sh verify

curl -sf "http://127.0.0.1:3020/stream/movie/tt0111161?strict_unknown_cache=false" \
  | jq '[.streams[] | {source,debrid_service,cache_status,display_label,ladder_step}]'

journalctl --user -u mango-catalog.service --since '-10 min' --no-pager \
  | grep '"event":"resolve_flight"' \
  | grep -E 'background_defer_foreground|background_join_foreground|foreground_bypass_background'
```

| Check | Required evidence | Pass? |
|---|---|---|
| Live AIO policy | `aiostreams-config.sh verify` exits 0 and states TorBox uncached retained / RD uncached excluded | |
| Real formatter shapes | A title with both services shows TB/RD cached rows as `cached`, an available TB `⏳` row as `uncached`, and no RD `⏳`/`download` row reaches the couch response | |
| Source coverage | AIOStreams result labels include its configured Torrentio/Comet/MediaFusion sources; if direct MediaFusion is configured, a thin AIO result can be supplemented without duplicate URLs | |
| Foreground priority | Start a maintenance verify for a title, then open/play the same title; couch resolve does not wait on the background deadline | |
| Background amplification guard | While a couch resolve for a title is active, same-title background work logs join/defer and does not start a parallel provider fan-out | |

Deferred on the work Mac: the live AIO user profile, generated manifest URL,
paid-provider results, journal concurrency evidence, and actual provider fan-out
all exist only on the Pi.

### Popular-title stream-list and smoothness confirmation (home Mac/Pi only)

Reapply the reviewed hifi profile so the repo copy replaces the prior installed
copy, then restart through the normal git-only deployment path. Do not mark a
source/config pass from work-Mac code or public-addon results.

```bash
cd ~/mango
bash scripts/m6-ship/set-playback-engine.sh mpv-hifi

curl -sf "http://127.0.0.1:3020/stream/movie/tt3659388" \
  | jq '[.streams[] | {display_label,resolution,encode,hdr_tags,cache_status,debrid_service,ladder_step,unverified}]'

curl -sf "http://127.0.0.1:3020/stream/movie/tt1160419" \
  | jq '[.streams[] | {display_label,resolution,encode,hdr_tags,cache_status,debrid_service,ladder_step,unverified}]'

journalctl --user -u mango-catalog.service --since '-10 min' --no-pager \
  | grep '"event":"resolve_flight"' \
  | grep '"flight_result":"join_equivalent"'

bash scripts/diag/playback-4k-proof.sh
```

| Check | Required evidence | Pass? |
|---|---|---|
| The Martian list (`tt3659388`) | Open detail from a cold stream cache. The strip stays on **finding…** through the late join, then shows rows; it never vanishes on the initial UI timeout. If providers truly return none, the visible label says **none found**. | |
| Dune list (`tt1160419`) | Same behavior; when main is empty, retained last-resort rows are visibly **unverified**, with 1080p TorBox ordered before soft 4K. | |
| No duplicate scrape | One cold detail open that crosses the first wait produces an equivalent-flight `join` and only one provider fan-out for that title search. | |
| Smooth auto choice | With both a 1080p TorBox fallback and cached AV1/H.264 4K present, automatic Play attempts `1080p_uncached_fallback` first. Soft 4K remains eligible later in the ladder; coverage is not reduced. | |
| Real 4K capability | A row is called smooth 4K only when metadata and `playback-4k-proof.sh` show 2160p SDR HEVC hardware decode with acceptable real dropped-frame evidence. HDR/AV1/H.264 4K remains unverified unless target-TV proof says otherwise. | |

### Same-name title identity (home Mac/Pi only)

Use the UK series IMDb ID (`tt0290978`) and compare it with the US series ID
(`tt0386676`). The URL parameters below mirror the launcher's cold-meta identity
fallback; do not include credentials in captured evidence.

```bash
curl -sf "http://127.0.0.1:3020/stream/series/tt0290978%3A1%3A1?title=The%20Office&year=2001" \
  | jq '[.streams[] | {title,name,description,source,display_label}]'
```

| Check | Required evidence | Pass? |
|---|---|---|
| UK stream list | Explicit `UK`/`U.K.`/`2001`/`Downsize` rows remain; explicit `US`/`U.S.`/`2005`/`Pilot` rows are absent. Unqualified rows remain available when providers supply them. | |
| UK episode playback | Play UK S1E1 and confirm the visible/audible episode is **Downsize**, not the US **Pilot**; repeat one later episode to rule out a one-row coincidence. | |
| US regression | Open `tt0386676` S1E1; explicit US/2005/Pilot rows remain eligible and playback is the US episode. | |
| Conflict telemetry | The stream response/log telemetry attributes rejected remake rows to `title_mismatch`; it does not report a provider outage or empty list when correct/ambiguous candidates exist. | |

Deferred on the work Mac: Pi Chromium restart/focus behavior, actual live addon
inventory, and visible/audible UK-vs-US playback identity. Run these only from
the home-Mac/Pi handoff after review and deploy.

Deferred on the work Mac: actual The Martian/Dune provider inventories, debrid
cache state, the late-join timing/log correlation, mpv decoder selection, and
presented/dropped-frame evidence.

### Native Live curation and playable-search confirmation (home Mac/Pi only)

Run only after the reviewed commit reaches the Pi through the normal git-only
handoff. These commands rebuild operator-owned AREA69 data and NexoTV profiles;
they were intentionally not run on the work Mac. Never capture the credentials
file or generated stream URLs in evidence.

```bash
cd ~/mango

python3 scripts/live/build-curated-area69-m3u.py \
  --out ~/.local/share/mango/nexotv/data/live-area69-curated.m3u \
  --index-out ~/.local/share/mango/nexotv/data/area69-live-search.json
jq '{version,built_at,stream_count,entries:(.entries|length)}' \
  ~/.local/share/mango/nexotv/data/area69-live-search.json

bash scripts/live/nexotv-config.sh apply-free m3u-sports-curated
bash scripts/live/nexotv-config.sh apply-news m3u-news-hi-en
bash scripts/live/nexotv-config.sh apply-cartoons m3u-cartoons
bash scripts/live/nexotv-config.sh wire-export

rm -f ~/.cache/mango/live-rails-cache.json
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart

curl -sf 'http://127.0.0.1:3020/rails/items?tab=live' \
  | jq '[.rails[] | {id:.rail_id,label,items:[.items[]|{id,title,subtitle,source}]}]'
curl -sf http://127.0.0.1:3020/health \
  | jq '.live | {cache,search_health,last_rebuild_error}'

curl -sfG -w '\nsearch_total=%{time_total}\n' \
  'http://127.0.0.1:3020/voice/search' \
  --data-urlencode 'tab=live' --data-urlencode 'q=BBC News' \
  | tee /tmp/mango-live-search-proof.txt
```

Confirm EPG/current-programme delivery from the local catalog without printing
manifest tokens by inspecting the Live rail subtitles above: a standing sports
channel may appear only when its subtitle names the current allowed competition
and matchup. Repeat a never-searched exact channel query; the first response
must finish within 2 s of added validation time. If proof is still running, it
must omit the row. Wait for the `/health.live.search_health.queued` count to
return to zero and repeat; only then may a newly verified row appear.

| Check | Required evidence | Pass? |
|---|---|---|
| AREA69 index v2 | Safe `jq` summary reports `version: 2`; current matchup rows exist in the index while replay/ended/placeholder/VOD-pack fixtures do not | |
| EPG standing-channel gate | Current match rows appear first; off-air sports rails may use only exact curated FIFA+/Star Sports/Willow/DD Sports/Cricket Gold/beIN fills, never generic sports brands | |
| World Cup rail | Current senior men's World Cup matches first (one best variant per matchup); off-air fill is only exact FIFA+/FIFA+ United States — no qualifiers, other FIFA events, studio, replay, ended, or generic sports brands | |
| Cricket rail | Current India-participant matches first; off-air fill is only exact Star Sports/Willow/DD Sports/Cricket Gold. West Indies and incidental `Indian` text never admit a row | |
| Soccer rail | Current Premier League / La Liga / Bundesliga / Serie A / Ligue 1 / UCL / UEL matches first; off-air fill is only exact beIN Sports — no MLS-only or generic sports brands | |
| F1 rail | At most four exact F1 TV/Sky Sports F1/DAZN F1/Viaplay F1 identities; no generic sport or other motorsport | |
| News/cartoon rails | News remains exact-target bounded; cartoons are at most eight classics-first allowlisted rows, admitting unknown language metadata but rejecting known non-English/Hindi metadata | |
| Empty rail hiding | Temporarily absent target events shrink/hide their rail; no generic substitute or stale broad-policy cache appears | |
| Search proof and latency | Fresh verified results return immediately, fresh failures stay absent, and an unknown response adds no more than 2 s before omitting unfinished proof | |
| AREA69 playback ownership | While any Mango title is actively playing, an AREA69 search does not start a headless validation or consume its single connection; queued count does not rise for that attempt | |
| Quality parsing | A `2160p` variant ranks as 4K below only explicit `8K`/`4320p`, never as 8K; same-tier English/Hindi and HEVC ordering follows afterward | |
| Variant failover | Choose a logical channel with multiple qualified variants, make/observe the first playback-start candidate fail, and confirm Mango tries the next candidate within the same request/deadline without opening another app | |
| Outcome learning | After a successful fallback play, repeat Live search: the working logical result rises; the failed variant stays suppressed until the existing Live health horizon expires | |
| Credential-safe state | `~/.cache/mango/live-channel-health.json` is mode 0600 and contains only hashed `v1:` keys/status/timestamps/sanitized reasons—no URLs, credentials, source names, or raw channel IDs | |

### Live shelf membership confirmation (home Mac/Pi only)

Run after the reviewed branch has been deployed through the git-only handoff
and the Live cache has been rebuilt. These commands are intentionally deferred
from the work Mac because it cannot prove the Pi's NexoTV inventories:

```bash
curl -s 'http://127.0.0.1:3020/rails/items?tab=live' | python3 -c \
  "import json,sys;d=json.load(sys.stdin);print([(r.get('label'),len(r.get('items')or[])) for r in d.get('rails',[])])"
bash scripts/live/audit-live-rails.sh
```

Expect non-zero World Cup, cricket, soccer, and cartoons when the free M3U
sources are healthy. If profiles drift, re-apply them with
`bash scripts/live/nexotv-config.sh apply-*` and rebuild the cache before
diagnosing membership.

Deferred on the work Mac: AREA69 API/index contents, NexoTV EPG behavior, actual
rail membership, native search wall time, active-playback connection ownership,
and representative mpv fallback playback. None is locally claimed as passed.

## Saved library (M6.1)

| # | Action | Pass? |
|---|--------|-------|
| 14 | Detail → **Save**; **Saved** rail appears immediately after Continue | |
| 15 | Detail → **Unsave**; item disappears from Saved after refresh/navigation | |
| 16 | Live channel → **Save**; appears in Saved/history but has no resume semantics | |

---

## Native YouTube (M6.2)

Requires `/etc/mango/youtube-api.key` for search/refresh and `MANGO_YOUTUBE_PLAY=1` for automated playback smoke. Full ops: [YOUTUBE.md](YOUTUBE.md).

| # | Action | Pass? |
|---|--------|-------|
| 17 | YouTube tab loads cached rails without full-screen error; empty Fresh Finds or expired Live Now is hidden instead of showing stale live cards | |
| 18 | YouTube rails show at most 9 cards; **X shuffle** changes History/For You/New From Subscriptions/Fresh Finds/Because You Watched/Live Now/Popular without blocking on refresh | |
| 19 | Search via voice/companion returns grouped Videos, Channels, Playlists | |
| 20 | Open a YouTube video → detail shows Play / Save / Not Interested; **B** starts mpv | |
| 21 | After playing a second meaningful YouTube VOD, Because You Watched follows that newer seed and shows cached non-live/non-Short follow-ups | |
| 22 | Open a channel/playlist → detail shows a D-pad video list; Save is disabled | |
| 23 | Not Interested removes the card from YouTube rails after refresh/navigation | |
| 24 | "Save this" on an open YouTube video updates Saved; no voice playback starts | |
| 25 | Popular shows a neutral 9-card non-live/non-Short row and reshuffles without spending search quota | |
| 26 | Live Now, when populated, contains currently live items only; if search quota is exhausted, cached VOD rails still work | |

---

## Settings (optional)

| # | Action | Pass? |
|---|--------|-------|
| 27 | Settings → Reliability Center opens with D-pad focus, large status cards, and Back returns home | |
| 28 | Reliability Center shows Green/Yellow/Red summary and component cards without dense debug text | |
| 29 | `Run proof now` records a proof; Repair/Restart/Refresh are disabled when Mango is active and enabled when idle | |
| 30 | **Refresh library** (~5s reshuffle) | |

## Library grow health (operator)

Do not show grow/debug status on TV. Check this from SSH before claiming library maintenance is healthy.

| # | Check | Pass? |
|---|-------|-------|
| G1 | `grow_monitor.py assess` selects the newest run artifact, including failures | |
| G2 | Orphan count is zero after successful grow or orphan-only repair | |
| G3 | No title exceeds the overlap cap except curation/pin semantics | |
| G4 | Failed/partial grow did not publish staged rail pools to couch | |
| G5 | Source-grow audit explains any short rail with concrete reasons | |
| G6 | `bash scripts/m6-ship/gate-m6-reliability-proof.sh` exits 0 unless Reliability Center is red | |

---

## If something fails

| Symptom | Check |
|---------|--------|
| Empty episode list | `curl localhost:3020/series/tt12004706/episodes` |
| No streams on episode | Row greys as **tap to retry** but remains focusable; **B** runs the normal ladder again |
| Next-episode focus missing | exit ≥90%/EOF; inspect `GET /play/next-prompt` immediately after mpv stop and confirm its series/from/next IDs |
| Pad wrong button | [`docs/HARDWARE.md`](HARDWARE.md) — B=`304`, Y=`308`, X shuffle=`307`, −/+=`314`/`315` |


---

## Voice companion (Phase 3 + M5.5b round)

Requires `MANGO_VOICE=1`. **Round code shipped** (`8eeb239`); comprehensive manual pass is the merge gate. Spec: [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md) · [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md) · [AI_LAYER.md](AI_LAYER.md)

| # | Action | Pass? |
|---|--------|-------|
| V1 | PTT "good Hindi movies" — **no TV jump**; clarifying or chat on phone | |
| V2 | PTT or text "Panchayat kholo" — detail on TV ≤8 s; phone confirms open | |
| V3 | Ambiguous title — **numbered tappable pick rows** on phone; tap opens; no open until pick | |
| V4 | Create AI catalog — confirm once; rail appears after bootstrap | |
| V5 | "What do you know about me?" — readable summary on phone | |
| V6 | Voice HUD dismisses; tiles unobstructed | |
| V7 | Proactive off (default) — no unsolicited TV suggestions | |
| V8 | "Save this" on open detail updates Saved; no playback starts | |
| V9 | Text "find live cartoons" — lists IPTV channels; can open one on TV | |
| V10 | Text follow-up while idle — composer not blocked after mango reply | |
| V11 | YouTube / On TV chips expand on tap; chat fills screen when collapsed | |
| V12 | Navigate all four tabs via voice/text (`movies`, `series`, `live`, `youtube`) | |

Automated: `bash scripts/m5-voice/ai/gate-m5-companion-couch.sh`

---

## Target-TV Stage 2 playback validation (M6.3)

Run after applying the Stage 2 profile and moving the Pi to the 4K TV path.
Launcher must remain lightweight; mpv should use source-matched 1080p output
until a separate visible-picture 4K gate passes.

```bash
cd ~/mango
bash scripts/m6-ship/gate-m6-4k-hdr-profile.sh
bash scripts/diag/pi-resource-snapshot.sh
```

| # | Action | Pass? |
|---|--------|-------|
| K1 | Gate sees connected display advertising 1080p film cadence (`23.98/24`) | |
| K2 | Launcher is readable and smooth at `1920x1080@60` on the TV | |
| K3 | Play a known verified movie; picture is visible and smooth within normal play budget | |
| K4 | **Y** exits mpv and returns to the exact launcher tab/focus state | |
| K5 | **B** resumes/plays another 1080p title if the first candidate fails | |
| K6 | Soundbar/TV sink plays audio; no TTS until sink is validated | |
| K7 | Resource snapshot shows no critical memory, disk, temp, or throttling issue | |

---

## Unified TV/companion UX ship polish (M6.5)

Manual sign-off after automated gates. **Code shipped** in M5.5b/M6.5 round. Spec: [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md) · [tasks/round-m55b-m65-scope.md](tasks/round-m55b-m65-scope.md)

Automated: `bash scripts/m6-ship/gate-m6-ux-smoke.sh` (also in `pi-pre-couch-gate.sh` on `feat/native-experience`)

| # | Action | Pass? |
|---|--------|-------|
| U1 | Focus visible on every tile at 3 m | |
| U2 | D-pad detail: **2D FocusGrid** — actions L/R · episodes/streams U/D; no focus trap | |
| U3 | Poster grid stable — no jump when images load | |
| U4 | Tab vs shuffle visually distinct (active vs amber outline) | |
| U5 | Play failure shows couch copy — no API/mpv stderr | |
| U6 | Empty rail hidden or graceful — no full-screen error | |
| U7 | Continue rail uses Mango progress/library state only | |
| U8 | ⌂ from mpv — home <300 ms perceived | |
| U9 | YouTube rail/search/detail follows the same focus, HUD, and pad-play rules | |

---

## Living librarian memory (Phase 5)

Optional but recommended during the comprehensive pass. Requires finishing a VOD title to ≥90% progress.

| # | Action | Pass? |
|---|--------|-------|
| M1 | Watch a movie to ~90%+ — exit mpv; no errors in catalog logs | |
| M2 | Ask "what do you know about me?" — summary reflects increased familiarity / completed watch | |
| M3 | Re-watch same title to completion — `completed_watches` does not double-count (companion or profile read) | |
