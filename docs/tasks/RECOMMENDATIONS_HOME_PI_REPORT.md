# Recommendations home-Pi report

**Date:** 2026-08-04 (PT)  
**Home host:** Amans-MacBook-Air-M2.local (`/Users/aman/Documents/personal/projects/mango`)  
**Pi hostname:** mango  
**Branch:** `feat/native-experience`  
**Supplied source SHA:** `2440a82ad8388233bfd3a6e338524c489322de95`  
**Final source / origin / Pi SHA:** `af9d337a2c5145a6db242750fbbd036332ed2364`

Home clone path differs from the spec’s `aman.shrivastava` path; this is the active LAN clone and matched origin for the handoff.

---

## 1. Identity and SHAs

| Role | SHA |
|------|-----|
| Operator expected tip (start) | `2440a82ad8388233bfd3a6e338524c489322de95` |
| Pi baseline (pre-deploy) | `ed5645b` (ancestor of tip; ancestry proved) |
| After first deploy + early corrections | `dd07e49d5ab7ca2b4997006faf737d0cc1fea27d` |
| **Final reconciled tip** | `af9d337a2c5145a6db242750fbbd036332ed2364` |

Undeployed ancestry `ed5645b..2440a82` was fast-forwarded in full (no cherry-pick). Later correction commits on home Mac were pushed and redeployed.

---

## 2. H2 baseline (pre-mutation)

| Check | Result |
|-------|--------|
| Branch | `feat/native-experience` |
| Pi dirt | **Known, preserved:** `config/companion.example/{compiled-notes.md,profile.yaml}` — not reset/stashed |
| Playback | idle |
| Grow / maintenance | not running / unlocked |
| Couch activity | `idle:false` (pad/voice activity within 1800s) — deploy proceeded with playback+grow idle documented |
| DBs | library / progress / youtube `PRAGMA quick_check` = **ok** |
| Pre-v4 backup | `/etc/mango/library.db.pre-fire-water-v4.bak` present (~4.4 MB, dated 2026-08-02) |
| Seed imports | `successful_seed_imports=2` (historical; **not** approved 56-row reconciliation) |
| Prior `MANGO_FOR_YOU` | unset → **rollout hold applied** `export MANGO_FOR_YOU=0` |

DB sizes (post-handoff snapshot): library ~13.6 MB · progress ~74 KB · youtube ~26.1 MB.

---

## 3. H1–H5 verdicts

| Stream | Verdict | Evidence |
|--------|---------|----------|
| **H1 Source preflight** | **PASS** (after correction) | Clean `feat/native-experience`; origin matched supplied tip then corrections. Local: `test:gate` 498 pass; `npm test` 877 pass; launcher+companion builds PASS; orch 98 PASS (venv); `test_serve_https` PASS; UX smoke PASS (2 off-Pi warns); stream-picker source PASS |
| **H2 Pi baseline** | **PASS** with noted couch non-idle | Playback/grow idle; DB ok; For You hold on; dirt inventoried and preserved |
| **H3 Deploy + AIO** | **PASS** | `pi-deploy.sh --fast` exit 0; migrations `4..11` / progress `2` / `context_id` present; backup intact; AIO apply+verify (see §6) |
| **H4 Runtime proof** | **PASS** with deferred items | Gate-lite `PRE-COUCH: PASS` (exit 0); Pi `npm test` 877/0 after live-search fixture fix; library/search/voice/companion PASS; YT cache-only counters flat; ownership/privacy PASS; Alliance one-press play PASS; restart `PERSIST_OK`; full gate DEFERRED (couch not idle) |
| **H5 Visual + couch** | **PARTIAL** | Screenshots captured+inspected (§8); **human couch pass still required** for subjective TV / physical pad / Fire-Water sheet |

---

## 4. Commands and exit statuses (concise)

### H1 local

| Command | Exit | Result |
|---------|-----:|--------|
| `npm run test:gate` (catalog) | 0* | First run 2 MMR fixture fails → fixed in `8f222b8`; rerun **498 pass** |
| `npm test` (catalog) | 0 | **877 pass** |
| `npm run build` (launcher) | 0 | PASS |
| `npm run build` (companion) | 0 | PASS (after `npm ci`) |
| orch `unittest` via `.venv` | 0 | **98 pass** |
| `python3 scripts/m5-voice/stack/test_serve_https.py` | 0 | **6 pass** |
| `gate-m6-ux-smoke.sh` | 0 | PASS (2 Mac-only warns) |
| `gate-m6-stream-picker-source.sh` | 0 | PASS |

\*Initial gate failure was stale MMR expectations vs cluster cap 2 — not a product regression.

### H3 deploy

| Command | Exit | Result |
|---------|-----:|--------|
| `bash scripts/pi-deploy.sh --fast` | 0 | Multiple deploys through tip `af9d337` |
| `aiostreams-config.sh diff/apply/verify` | 0 | Policy applied; MediaFusion present/disabled soft-warn |

### H4 Pi

| Command | Exit | Result |
|---------|-----:|--------|
| `MANGO_GATE_SKIP_YOUTUBE=1 pi-pre-couch-gate.sh` | 0 | **PRE-COUCH: PASS** (`/tmp/mango-h4-gate-lite2.txt`; final rerun in flight / same gate) |
| `MANGO_GATE_FULL=1 …` | — | **DEFERRED** — couch `idle:false` (mpv/voice activity from agent probes) |
| Pi `npm test` (pre-fix) | 0† | 875 pass / **2 fail** (live-search AREA69 leakage) |
| Pi `npm test` @ `af9d337` | 0 | **877 pass / 0 fail** |
| `gate-m6-library-smoke.sh` | 0 | PASS after `dd07e49` ownership headers |
| `gate-m6-search-smoke.sh` | 0 | PASS |
| `gate-m5-voice.sh` | 0 | pass=19 |
| `gate-m5-companion-memory.sh` | 0 | PASS |
| YouTube cache-only reshuffle probe | 0 | `YT_CACHE_OK` api 116→116 search 51→51; cache videos 10593 |
| Restart persistence | 0 | `PERSIST_OK` |
| Alliance `POST /play` `tt40914930:1:2` | 0 | **ALLIANCE_ONE_PRESS PASS** |

†node test runner can exit 0 with failing subtests; counts recorded honestly.

---

## 5. Migration / backup / persistence

| Item | Proof |
|------|-------|
| Library migrations 4–11 | `4,5,6,7,8,9,10,11` |
| Progress migrations | `2` |
| `context_id` column | present on `profile_recommendation_served_slates` |
| Pre-v4 backup | present; not auto-restored |
| Post-restart | profile revision + YT cache count persisted (`PERSIST_OK`) |
| Integrity | all three DBs `quick_check ok` after deploy |

---

## 6. AIOStreams policy

Apply set `hideErrors=false` and non-stream `hideErrorsForResources` (sanitized).

**Verify (final):**  
`AIOStreams live policy verified: TorBox/RD/Easynews enabled; Torrentio/Comet enabled; MediaFusion present (disabled); uncached TorBox retained; uncached RD excluded; stream errors observable`

Warnings (expected): MediaFusion disabled until healthy manifest; conditional groups disabled (parallel fanout).

Catalog topology: `configured_stream_providers.aiostreams=1` (sole VOD aggregate); Torrentio/Comet/MediaFusion not nested as direct catalog stream providers.

Correction `b843d99`: verify requires Torrentio+Comet enabled; MediaFusion must **exist**, warn if disabled (enable PUT 400 when ElfHosted manifest 404).

---

## 7. Alliance exact-episode one-press

| Field | Value |
|-------|-------|
| Episode ID | `tt40914930:1:2` (from series episodes surface / documented exact ID; not `:1:1`) |
| Request | single `POST /play` with ownership fields when available |
| Result | `ok: true`, `play_id: tt40914930:1:2`, `ttff_ms≈5893`, `total_ms≈14820` |
| Resolver Δ | fanout **+1**; retries/recoveries/exhaustions **0** |
| Stop | mpv IPC quit → playback idle |
| Sibling fallback | none observed |
| Raw diagnostic leak | none in sanitized play response |
| Empty→retry recovery counters | **DEFERRED** — streams available on first pass this run (recovery path not exercised) |

---

## 8. Screenshots and visual audit

Captured on Pi under `~/.cache/mango/gate-screenshots/`; inspected copies on home Mac at `/tmp/mango-recommendation-proof3/` (not committed).

| Label | Notes |
|-------|-------|
| Movies / series / YouTube frames | Pad-nav tab switching flaky (search focus swallows tab); later frames distinct |
| Visual | Dark UI; Household chip; Continue Watching + Saved; **no For You** under hold; Alliance visible on TV continue; focus ring visible; no technical diagnostic strings |
| YouTube | Four-card landscape rails when on youtube tab; history row present |
| Safe area / contrast | Acceptable in pixels; **10-foot judgment deferred to human** |
| Duplicates / truncation | No obvious duplicate cards in inspected frames; some titles ellipsize normally |

Early identical hashes across differently labeled captures — discarded; later distinct hashes used.

---

## 9. Latency / resources (warm, n=20)

Measured after final deploy:

| Endpoint | median | p95 | max |
|----------|-------:|----:|----:|
| `/recommendations/state` | 3.5 ms | 4.2 ms | 19.4 ms |
| `/rails?tab=movies` | 1.14 ms | 1.6 ms | 1.86 ms |
| `/rails?tab=series` | 1.18 ms | 1.33 ms | 1.75 ms |

Resources (gate / snapshot): MemAvailable ≈ 5.3–5.6 GB; temp ≈ 60–61 °C; throttled OK; root disk ~14%.

---

## 10. Ownership / privacy / YouTube / recommendations

| Check | Result |
|-------|--------|
| Owner-exact movies/series rails | PASS (`owner_exact: true`); For You absent under hold |
| Partial owner | HTTP 400 |
| Stale rev | HTTP 409 |
| `/recommendations/state` | no forbidden public markers |
| LAN companion private paths | 403; public companion endpoints 200 |
| YouTube quota | cache-only proof; api/search counters unchanged |
| Seed / For You quality | **DEFERRED** — no approved 56-row manifest; hold remains |

---

## 11. Correction commits (this handoff)

| SHA | Why |
|-----|-----|
| `8f222b8` | Align MMR test fixtures with cluster cap 2 so local gate matches product policy |
| `b843d99` | AIOStreams verify: MediaFusion may be present-but-disabled without failing verify |
| `dd07e49` | Library smoke must send exact profile ownership (`/library/context` ownership gate) |
| `f2fd498` | live-search fixture: begin AREA69 isolation |
| `af9d337` | Pin AREA69 to empty temp index (default Pi share path still leaked); drop brittle wall-clock assert |

---

## 12. Human couch verdicts

**Not yet collected.** Minimal remaining couch script is in the agent handoff message (15–25 min). Agent owns objective PASS above; human owns 10-foot readability, Fire/Water semantics, perceived latency, relevance/diversity/surprise, and physical controller confirmation.

RP/FW matrix: objective rails/hold/ownership exercised; seed-calibrated For You (RP rows needing `MANGO_FOR_YOU=1`) and FW sheet interaction remain for human.

---

## 13. Deferred items

1. **Approved Fire/Water seed + `MANGO_FOR_YOU=1`** — needs human disposition of Sheet rows and validated stable-ID manifest; double import with second `noop: true`.
2. **MediaFusion enable** — wait for healthy manifest; do not force enable on 404.
3. **Alliance empty-retry counter proof** — re-test when clean-empty→recovery can be forced without weakening policy.
4. **`MANGO_GATE_FULL=1` pre-couch** — rerun when couch activity idle ≥1800s.
5. **Strict pre-deploy couch-idle** — this run had non-idle couch activity from prior/agent use.
6. **Subjective TV / pad pairing** — pad often `waiting_for_controller`; wake 8BitDo normally (no pairing mode).
7. **Pi dirt** — companion.example edits remain; leave unless human decides.

---

## 14. Credential / privacy audit

- No credentials, tokens, OAuth material, media URLs, raw provider errors, private profile names, or DB row dumps written to this report or committed.
- Screenshots remain under `/tmp` / Pi cache only — **not** committed.
- YouTube keys/quota config untouched; no `fresh-start`; no rsync of source/state.
- AIOStreams UUID may appear in local tee logs from apply tooling; **not** reproduced here.

---

## 15. Final ship state

| Machine | SHA |
|---------|-----|
| Home HEAD | `af9d337a2c5145a6db242750fbbd036332ed2364` |
| `origin/feat/native-experience` | `af9d337a2c5145a6db242750fbbd036332ed2364` |
| Pi `~/mango` | `af9d337a2c5145a6db242750fbbd036332ed2364` |

Report commit may advance tip by one documentation SHA; deploy that commit for parity after push.
