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
| 10 | Watch **≥50%** → **Y** → **next episode** overlay; **B** plays next, **Y** dismisses | |

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
| Return state | Exit a series episode; same title/season/episode remains, progress and Resume refresh, and focus stays on Play after async rendering | |
| Long-play ownership | Play for >30 minutes (or approved accelerated equivalent); maintenance defers and does not stop the couch-owned mpv | |
| 1080p HDR | Play the fixture; effective mpv properties and visible picture confirm the intended 1080p HDR/tone-map path | |
| 4K SDR HEVC | Play a verified 4K fixture; winning main step is SDR + HEVC and effective decoder/output properties match | |
| Subtitles/audio | ↑ shows/cycles subtitles; A shows/cycles audio; selected audio/subtitle and channel policy are audible/visible | |
| HDMI restore | First visible frame appears only after source match; Y/⌂ restores `1920x1080@60` before launcher reveal | |
| Frame drops | `scripts/diag/playback-4k-proof.sh` records real presented/dropped-frame evidence; never infer a pass from source config | |

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
| Next prompt missing | exit ≥50%; `GET /play/next-prompt` after mpv stop |
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
