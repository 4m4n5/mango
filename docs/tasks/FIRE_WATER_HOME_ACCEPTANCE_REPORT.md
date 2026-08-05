# Fire & Water — home deploy acceptance report

> **Historical v4 evidence.** This report proves its 12-card Fire/Water rollout
> and seed/UI fixes only at the SHA below. The current recommendation contract is
> Household Story Graph v2 with one six-card For You rail; see
> [`../FIRE_WATER_RATINGS.md`](../FIRE_WATER_RATINGS.md) and
> [`../STATUS.md`](../STATUS.md).

**Date:** 2026-08-03 (UTC)  
**Branch:** `feat/native-experience`  
**Deploy tip:** `831fe9886837f0689596d37dad7134ac6bbdc327`  
**Ancestry:** `118c028`, `368be80`, `831fe98` all present  
**Pi start SHA (before pull):** `f1b4223` · **Mac/origin/Pi after deploy:** `831fe98`  
**Pi dirt preserved:** `config/companion.example/{compiled-notes.md,profile.yaml}`

## Commands

```bash
git switch feat/native-experience
git pull --ff-only
bash scripts/pi-deploy.sh --fast --gate   # first run: FAIL M1 (Chromium window 0 during restart race)
# recovered Chromium, then:
bash scripts/pi-exec-gate.sh              # PRE-COUCH: PASS
```

| Gate | Result |
|------|--------|
| `--fast --gate` first pass | FAIL M1 — launcher Chromium window count 0 mid-restart |
| Chromium restart + re-gate | **PRE-COUCH: PASS** (gate-lite 0 warnings; reliability yellow) |
| Migration backup | **PASS** — `/etc/mango/library.db.pre-fire-water-v4.bak` present (4.4 MB) |
| Ratings survive catalog restart | **PASS** — 50 ratings unchanged after `mango-catalog` restart |
| Seed dry-run / validate | **PASS** — 48 approved / 8 excluded |
| Seed import #1 | **PASS** — imported 47, skipped_couch 1 (RRR) |
| Seed import #2 | **PASS** — `noop: true` |
| AI disabled (`MANGO_RECOMMENDATIONS_AI=0`) | **PASS** — For You still 12 cards; rating GET ~15 ms; flag restored |
| Rail order movies | **PASS** — continue → saved → for-you-movies → AI/curated |
| Rated leak on For You | **PASS** — no rated IDs in displayed 12 |
| Series For You | **PASS** — `for-you-series` 12 cards (API + screenshot) |

## Seed reconciliation (read-only sheet)

Sheet: `1obI2M4hExMUC-PR-FPWSr1Z7lr94n8YIpVf092-91Mc` (Sheet1).  
**No raw captions persisted** — only SHA-256 caption hashes in the working manifest on Pi `/tmp/mango-fw/fire-water-seed-v1.json`.

| Bucket | Count | Disposition |
|--------|------:|-------------|
| Clean half-step pairs | 54 | ID-resolved |
| Approved (unique exact / article-tolerant title+year) | 48 | Imported |
| Excluded (no unique exact evidence) | 6 | See list |
| Human disposition required | 2 | Await operator |

### Excluded (agent)

| Title | Year | Reason |
|-------|------|--------|
| Laapataa Ladies | 2023 | Cinemeta English title is Lost Ladies — not exact |
| Swatantrya Veer Savarkar | 2023 | Cinemeta year 2024 |
| Hit Man | 2024 | Cinemeta year 2023 |
| f1 | 2025 | Nearest is F1: The Movie — not exact sheet title |
| Deewar | 1975 | Nearest exact transliteration Deewaar; year-collision with 1976 Deewar |
| Chanllengers | 2024 | Sheet typo; Challengers tt16426418 available after rename |

### Needs human (only)

1. **The idea of you** (2024) — both Fire and Water blank. Approve with scores, or exclude with reason?  
2. **La Cocina** (2024) — Fire `2.5 or 3`, Water `2 or 1.5`. Pick discrete half-steps, or exclude?

## Screenshots (Pi `/tmp/mango-fw-final/`, 1920×1080, not committed)

| Label | Verdict |
|-------|---------|
| `home-top` / `movies-for-you-focused` | Movies **For You** rail visible; focus on BARDO |
| `series-for-you-focused` | TV **For You** rail visible; focus on Age of Attraction |
| `detail-unrated` | Rate action present on movie Detail (Karate Kid) |
| `rating-sheet-unset` | Sheet in safe area; Fire focused; both axes Not set |
| `rating-sheet-half` | Fire 3.5 / Water 2.5 with half-mark clipping visible |
| Compact chips on rated Detail | Fire marks readable; **Water marks often empty squares** |
| Invitation / clear-confirm / network-error | **DEFERRED** — not cleanly captured this pass |
| DPMS Off mid-session | Caused black `scrot` until `xset dpms force on` |

## Defects found

### P0 — Color emoji font missing on Pi

`fonts-noto-color-emoji` is **not installed**. Chromium falls back to Noto Sans → Water `🌊` often renders as empty boxes; Fire is unreliable vs the household reference.

**Proposed fix (needs your OK to install a package):**

```bash
bash scripts/pi-exec.sh 'sudo apt-get update && sudo apt-get install -y fonts-noto-color-emoji'
# then restart launcher Chromium and re-capture rating sheet + chips
```

No source change required if the system font is present; optional follow-up is bundling a launcher `@font-face` fallback.

### P1 — Screenshot automation / DPMS

Uncontrolled Xorg DPMS Off (600s) still present (pre-existing OPS DEFERRED). Black captures are Monitor Off, not launcher crashes. Keep `xset dpms force on` before capture until intentional display-sleep lands.

### P2 — Stale 409 copy

Stale rating PUT returns HTTP 409 with body error string `catalog temporarily unavailable` while still including `current` rating. Functional, but the message is wrong for couch/debug. **DEFERRED** small copy fix.

## Autonomous API / behavior proofs

- PUT / edit / stale-409 / half-step / clear on `tt3268458` — PASS  
- Couch training ratings + seed import → 50 current ratings — PASS  
- `/recommendations/refresh` → movies/series snapshots 40 items — PASS  
- Mutation latency sample: first PUT ~767 ms (includes rerank); subsequent GET ~15 ms  
- Generation duration last movies ~320–386 ms (above 25 ms cached-assembly target for cold refresh; cached rail load is separate)

## Safe state at handoff

- Tip `831fe98` on Pi  
- Chromium active, FreezerState running, Monitor On  
- No mpv; catalog ready; pad router waiting for controller (Micro not grabbed this session)  
- Temporary AI-off drop-in **removed**  
- Seed manifest only under `/tmp/mango-fw/` (not in git)

## Residual human couch (later, as requested)

Keep holistic session short:

1. Icon clarity at 3 m (after emoji font install)  
2. B / Left / Right / Y / X on the rating sheet  
3. Fire 5 / Water 0 vs Fire 0 / Water 5 influence on For You  
4. Focus restore after rating a For You title  
5. Recommendation quality skim (12 Movies + 12 TV)  
6. One 4K play/return  

Plus the two seed disposition answers above.


## Follow-up fixes (2026-08-03)

Deploy tip: `0521331`.

| Issue | Fix | Proof |
|-------|-----|-------|
| Emoji tofu / missing waves | Installed `fonts-noto-color-emoji` on Pi | `fc-match "Noto Color Emoji"` → NotoColorEmoji.ttf |
| Idea of You / La Cocina | Excluded Idea of You; approved La Cocina Fire 3 / Water 1.5 (`tt19864832`) | Seed v2 import + noop; GET rating |
| Half-mark overfill | Glyph wrapper + width clip at mark box | Launcher CSS/TS change |
| For You ~5–6 cards | Browse row budget was 1×6; For You now 2 rows (12) + shuffle rotates reserve | API 12 before/after shuffle; overlap 3 |
| Save → catalog unavailable | UI proxy omitted PUT body; validation sanitized to couch message | Proxy PUT 200 in 606 ms |
