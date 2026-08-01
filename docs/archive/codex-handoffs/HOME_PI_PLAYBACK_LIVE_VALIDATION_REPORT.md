# Home Pi playback / Live validation report

**Date:** 2026-07-16 (America/Los_Angeles)  
**Home-Mac repo:** `/Users/aman/Documents/personal/projects/mango`  
**Branch:** `feat/native-experience`  
**Spec expected handoff commit:** `0abc66134433d6fe7dc3eca0e33028838f2b13e8`  
**Initial deployed commit (after clean-tree docs commit):** `67ed974bd3a75da7dd417b57d7c355f7e5cd8678`  
**Final commit / origin / Pi SHA:** `66010cd1531a82e8c3038064012bd5ec788b852a` (all three match)

## Guardrail audit

| Guardrail | Result |
|---|---|
| Git-only Pi deploy (`pi-deploy.sh` / `pi-exec.sh`) | PASS — no rsync/scp/hand-copy of repo files |
| Secrets / full stream URLs / raw AREA69 IDs in this report | PASS — redacted |
| Tuned timeouts / budgets / TTLs | PASS — no numeric default tuning |
| Debrid contract (TB uncached retained, RD uncached excluded) | PASS — `aiostreams-config.sh verify` |
| External Live app (Stremio/Kodi/etc.) | PASS — not used |
| Fabricated passes | PASS — failures and deferred items recorded |

## H1 — preflight and clean git-only deployment

| Step | Result |
|---|---|
| Branch `feat/native-experience` | PASS |
| Dirty MediaFusion docs on pull | Committed as `67ed974` (not stashed/reset) |
| §3.2 local matrix | PASS — catalog 656/656 + gate 301/301; AREA69/cartoon Python 4/4; launcher build + ux-smoke 15/15 (2 off-Pi warns); orchestrator **83/83** via `src/orchestrator/.venv` (Python 3.11); SSOT source-only PASS (3 off-Pi warns); `git diff --check` clean |
| Pi dirt under `config/companion.example/` | Preserved to `~/.local/share/mango/companion` + `/etc/mango/companion`, then restored example tree (operator data was wrongly writing into the git example dir via `MANGO_COMPANION_DIR`) |
| `bash scripts/pi-deploy.sh --full --gate` | PASS at `67ed974` — home/origin/Pi equal; stack healthy |

## H2 — automated Pi gates and runtime health

| Gate | Result | Notes |
|---|---|---|
| `pi-exec-gate.sh` / gate-lite | PASS after fixes | Preliminary FAIL: unbound `MANGO_REPO_DIR` on full path; intermittent lite-play `http=unknown` / VO race |
| `MANGO_GATE_FULL=1 pi-pre-couch-gate.sh` | **FAIL** | `N3c GATE FAIL: 21/39 plays, 18 error(s)` — dominant error `mpv did not start playback within 10000ms` on MediaFusion elfhosted URLs during rapid rail sweep |
| `gate-m4-self-hosted.sh` | PASS | Embedded in full gate |
| `gate-m3-verified-rails.sh` | **FAIL** | Same 21/39 |
| `gate-m6-reliability-proof.sh` | PASS (yellow) | Reliability state yellow / thin rails (expected) |
| `gate-m6-ux-smoke.sh` (Pi) | PASS | Via gate-lite path |

### H2 corrections (committed + deployed)

1. **`5d855a0`** — `mango_gate_init` exports `MANGO_REPO_DIR` (full gate aborted under `set -u`).
2. **`e959f3e`** — launcher GL reset only when panel ≥3k (1080p film-cadence matches no longer cold-start Chromium).
3. **`674e1d7`** — wait/retry catalog `/health` before lite `/play` (empty curl status flakes).
4. **`795b644`** — watchdog must not pkill intentional `pi-pre-couch-gate` / gate-lite.
5. **`8d71e00`** — watchdog must not pkill in-flight `/play` curls.

### H2 deferred / proposals (no tuning applied)

- **Full-gate MediaFusion 10s start timeouts:** many candidates fail `auto_play_probe_ms=10000` under consecutive plays. Measurement-backed proposal (needs approval): raise probe budget for MediaFusion hosts only, or add inter-play settle in `gate-m3-verified-rails` without changing product play defaults.
- AI horror titles with empty provider inventory remain thin; demoted verified-empty rows when found.

## H3 — playback success, return-focus, ownership

| COUCH_TEST row | Result | Evidence |
|---|---|---|
| Successful non-`:1:1` episode | **PASS** | `tt0903747:2:1` before `failed/no_stream` → after play `verified`, episodes API `playable: true`, title **Seven Thirty-Seven**; no late timeout observed on API path |
| Real pre-play failure | **DEFERRED** — needs intentional unreachable episode without starting mpv; not completed this session |
| Gate episode regression (`:1:1` / bare) | **PASS** (lite) | gate-lite series `tt0903747:1:1` played |
| Movie return focus (1080p + matched-4K) | **DEFERRED** — requires Chromium localStorage / visible Play focus; API stop only proven |
| Series early-exit focus | **DEFERRED** — same (visible focus) |
| Series ≥90%/EOF next focus | **DEFERRED** — same |
| Timeout cancellation / ghost mpv | **DEFERRED** — not force-exercised at 95s watchdog |
| Picker single-shot / hard language | **DEFERRED** — not couch-exercised |
| Long-play ownership >30m | **DEFERRED** — not run (would block remaining proofs) |
| HDMI restore | **PASS** (partial) | Post-stop browse returns `1920x1080@60` in observed stops |
| 1080p HDR / subtitles/audio pad | **DEFERRED** — not exercised |

## H4 — source policy, identity, popular titles, 4K

| COUCH_TEST row | Result | Evidence |
|---|---|---|
| Live AIO policy | **PASS** | `TorBox retained, Real-Debrid excluded` |
| Real formatter shapes (TB/RD) | **PASS** (partial) | Shawshank: 10 TorBox `cached` rows; `rd_uncached=0` |
| Source coverage labels | **PASS** (partial) | UK Office stream name includes `Torrentio`; AIOStreams wrapper present |
| Foreground/background join | **DEFERRED** — journal user unit empty on this Pi (`No journal files`); no `resolve_flight` capture |
| The Martian list / late join | **PASS** (partial) | Cold resolve returned rows; auto Play won `4k_sdr_soft_cached` (soft H.264) while HEVC remux also listed |
| Dune list / ordering | **PASS** (partial) | Played; won `last_resort` (inventory mostly harsh) |
| Smooth auto choice 1080p before soft 4K | **DEFERRED** — fixtures with both 1080p TB + soft 4K not isolated this run |
| Real 4K capability | **PASS** | Arrival (`tt2543164`): `4k_sdr_remux_cached`, HDMI `3840x2160@23.98`, decode **HEVC**, `hwdec=drm`, dropped=0 — `playback-4k-proof.sh` **PASS**. Martian soft H.264 4K correctly **FAIL — no-hwdec** |
| UK stream list / Downsize | **PASS** | Play `tt0290978:1:1` → mpv `media-title` **The Office (UK) (S1E1): Downsize**; path `The.Office.UK.S01E01...` |
| UK later episode | **DEFERRED** — only S1E1 played |
| US regression | **PASS** | `tt0386676:1:1` filename `The.Office.S01E01.2005.WEB-DL...` (US 2005); embedded media-title junk (`www.hackstore.ac`) noted |
| Conflict telemetry `title_mismatch` | **DEFERRED** — not present in stream JSON top-level; journal unavailable |

## H5 — Native Live rebuild, qualification, search, failover

### Rebuild

- AREA69 index: `version: 2`, `stream_count/entries: 45354`
- Applied free/news/cartoons + `wire-export`; cleared live rails cache; catalog restart

### Root cause + fix

`/etc/mango/catalog-live.yaml` was a **stale keyword-only** copy (**0** `qualification:` keys) while `config/catalog-live.example.yaml` has eligibility policies. Result: Women's Softball as “World Cup”, MLS as soccer, standing cricket brands, etc.

**Fix:** copied example → `/etc/mango/catalog-live.yaml` (backup kept); **`66010cd`** makes `sync-etc-mango-config.sh` sync `catalog-live.yaml` on deploy.

### After qualification sync

| Rail | Count | Assessment |
|---|---|---|
| FIFA World Cup | hidden (0) | **PASS** — no current senior men’s matchups |
| Cricket | hidden (0) | **PASS** — no India-qualified current items |
| Soccer | hidden (0) | **PASS** — no approved-league matchups |
| F1 | 3 | **PASS** — Sky Sports F1 / DAZN F1 / F1 TV only |
| News | 12 | **PASS** — at allowlist cap |
| Cartoons | hidden (0) | **PASS** — empty/hidden when unqualified |

| COUCH_TEST row | Result |
|---|---|
| AREA69 index v2 | **PASS** |
| EPG standing-channel gate | **PASS** after fix (standing brands no longer fill sports rails) |
| World Cup / Cricket / Soccer / F1 / News / empty hiding | **PASS** after fix |
| Search proof + ≤2s unknown | **DEFERRED** — `voice/search?tab=live&q=BBC News` returned **0** results (~2.55s) despite news rail membership; needs search-path follow-up |
| AREA69 playback ownership while VOD plays | **DEFERRED** — not demonstrated |
| Quality parsing 2160p | **DEFERRED** — not isolated |
| Variant failover + outcome learning | **DEFERRED** — not demonstrated |
| Credential-safe health file | **PASS** — mode `0600`; keys `v1:` hashes; no URL/credential fields in sample |

## H6 — corrections summary

| Commit | Why |
|---|---|
| `67ed974` | Clean tree for deploy (MediaFusion docs) |
| `5d855a0` | Full gate `MANGO_REPO_DIR` under `set -u` |
| `e959f3e` | Stop Chromium restart race after 1080p film match |
| `674e1d7` | Catalog settle before lite play |
| `795b644` | Watchdog was SIGTERM-ing full gates |
| `8d71e00` | Watchdog was SIGTERM-ing `/play` curls |
| `66010cd` | Sync live qualification YAML to `/etc` |

Local regression helpers added: `test-gate-common-repo-dir.sh`, `test-browse-gl-reset.sh`, `test-health-repair-gate-guard.sh`, `test-sync-catalog-live.sh`.

Post-fix deploy: `--fast` to `66010cd`; Pi SHA matches; live rails still eligibility-correct (`live-racing=3`, `live-news=12`).

## Source / coverage audit

| Surface | Status |
|---|---|
| TorBox uncached retained | PASS (verify) |
| RD uncached excluded | PASS (verify) |
| AIOStreams + Torrentio visible | PASS (UK Office label) |
| Comet / MediaFusion | Present via AIO/MediaFusion playback URLs; full label audit incomplete |
| Native Live inventories (4) | PASS — AREA69 + free + news + cartoons wired |

## 4K proof (honest)

| Title | Ladder | Codec / hwdec | Verdict |
|---|---|---|---|
| The Martian auto | `4k_sdr_soft_cached` | H.264 / no hwdec | **Not smooth 4K** |
| Arrival | `4k_sdr_remux_cached` | HEVC / `drm` | **Smooth 4K on this Pi/TV** (dropped=0) |

## Deferred / external blockers

1. Full N3c rail sweep MediaFusion 10s start failures — propose probe/settle change for approval.  
2. Visible launcher return-focus / episode-focus (needs Chromium focus evidence or couch pad).  
3. Live `voice/search` returning empty for `BBC News` while rail lists BBC NEWS.  
4. Live variant failover + AREA69 single-connection ownership under active VOD.  
5. Journal persistence for `resolve_flight` / `title_mismatch` telemetry on this Pi.  
6. Re-run `MANGO_GATE_FULL=1` after MediaFusion start reliability is addressed.

## Overall verdict

**Not fully green.** Core handoff contracts that *were* proven: git-only deploy, gate-lite, debrid policy, UK/US Office identity, episode failed→verified reconcile, Arrival HEVC 4K hwdec proof, and Native Live eligibility after fixing stale `/etc` live YAML. Remaining blockers are full-gate play flakiness under MediaFusion 10s probes, several visible return-focus couch rows, and Live search/failover proofs.
