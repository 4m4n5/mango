> **Archived spec** — superseded by [ROADMAP.md](../../ROADMAP.md) / [STATUS.md](../../STATUS.md).
> Shipped status may differ from this doc. Do not implement from here without checking STATUS.

# Phase N3a — Stream play orchestrator

**Status:** In progress (~75% shipped on `feat/native-experience` @ `865312c`)  
**Branch:** `feat/native-experience`  
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md) § N3  
**Codex prompt:** [`CODEX-phase-n3a-prompt.md`](CODEX-phase-n3a-prompt.md)  
**Inventory:** [`N3-INVENTORY.md`](../N3-INVENTORY.md)

**N3 split:** **N3a** = orchestrator + launcher copy + gates (this spec). **N3b** = stream picker UI + `progress.db` (after couch sign-off).

---

## 1. Objective

Make **browse → detail → Play** reliable on the couch:

| Target | Requirement |
|--------|-------------|
| Wall clock | **≤15 s** from Play press to mpv first frame |
| UX | **No API/mpv error strings** on launcher status line |
| Resilience | Auto-try ranked streams when first URL is dead, uncached, or slow |
| Source policy | Prefer **cached AIOStreams**; no auto-play Torrentio debrid |

N1 proved one smoke title. N2 proved browse UI. **N3a proves play on arbitrary browse picks** — not Shawshank-only.

### Success definition

| Artifact | Requirement |
|----------|-------------|
| `play-orchestrator.ts` | Try top N streams within 15 s wall; per-attempt budget from config |
| `core.streams` | Parallel addon fetch; in-memory stream cache (10 min TTL) |
| Stream filters | Tier-ranked auto-play candidates; couch-safe defaults in example JSON |
| `mpv-play.sh` | `--probe` mode for fast TTFF check |
| Launcher | Pre-resolve on detail open; friendly spinner only |
| Gate | `gate-n3a-play.sh` exit 0 (browse pick + budget) · `gate-n3c-verified-rails.sh` regression |
| N0 + N3d regression | `pi-pre-couch-gate.sh` still passes |
| `docs/N3-INVENTORY.md` | Metrics filled + couch sign-off note |

### Dev lab context

1080p monitor · headphones via monitor 3.5 mm · `max_quality: 1080p` · no 4K until N7 ([`HARDWARE.md`](../HARDWARE.md)).

---

## 2. Already shipped (do not redo)

Audit before coding — these exist on `feat/native-experience`:

| Area | Location | Notes |
|------|----------|-------|
| Orchestrator module | `src/catalog-service/src/play-orchestrator.ts` | `playWithFallback()` · attempt log · wall budget |
| Wired `POST /play` | `src/catalog-service/src/index.ts` | Uses orchestrator · invalidates title on failure |
| Parallel resolve + cache | `src/catalog-service/src/core.ts` | `Promise.allSettled` · `streamCache` 10 min |
| mpv probe + play | `src/catalog-service/src/mpv.ts` · `scripts/phase-n1/mpv-play.sh` | `--probe` · `--timeout-ms` |
| Candidate ranking | `src/catalog-service/src/stream-filters.ts` | `selectAutoPlayCandidates()` · phased cache tiers |
| Launcher prefetch | `src/launcher/src/catalog.ts` · `detail.ts` | `prefetchStreams()` on detail open |
| Launcher copy | `src/launcher/src/detail.ts` | Spinner states · generic failure message |
| N3c play gate | `scripts/phase-n3c/gate-n3c-verified-rails.sh` | Samples served rail items · `POST /play` |
| Gate helpers | `scripts/lib/gate-common.sh` | `gate_post_play` · mpv playback-time check |
| Inventory plan | `docs/N3-INVENTORY.md` § Plan | Root cause + design locked |

**Codex mission = close gaps below**, not greenfield rewrite.

---

## 3. Remaining gaps (closure work)

### G1 — Couch defaults in `catalog-filters.example.json`

Current example diverges from N3a contract:

| Field | Spec | Current example | Action |
|-------|------|-----------------|--------|
| `strict_unknown_cache` | `true` | `false` | Set `true` |
| `auto_play_wall_ms` | `15000` | `45000` | Set `15000` (keep TorBox/RD fallback env paths for indexer) |
| `auto_play_probe_ms` | `4000` | `12000` | Set `4000` for couch play |

Pi sync: `sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json`

Indexer/playability verify may need longer budgets via env — **do not** slow couch play to match indexer.

### G2 — Wire `auto_play_tiers` into candidate selection

`stream-filters.ts` parses `auto_play_tiers` from JSON but `selectAutoPlayCandidates()` uses hardcoded phases. Either:

- **Preferred:** flatten tiers from config (addon name fuzzy match + `require_cache`) into ranked list, then `diversifyCandidates`; or
- Document phases as equivalent and add test proving tier config is honored.

Torrentio must remain **excluded** from default auto-play tiers.

### G3 — Probe-then-play (optional but spec-aligned)

Today orchestrator calls full `playUrl()` per attempt (with `minDurationSec: 600`). Spec design:

1. `probeUrl()` — fast TTFF check, **stop mpv**
2. On probe success → single full `playUrl()` on winner

**Benefit:** failed attempts don't leave fullscreen mpv running; faster retry. **Risk:** double mpv start adds ~1 s — measure on Pi before/after.

If probe-then-play regresses TTFF, keep full-play loop but document waiver in `N3-INVENTORY.md`.

### G4 — Dedicated N3a gate: `scripts/phase-n3a/gate-n3a-play.sh`

N3c gate proves served items play; N3a gate proves **browse contract**:

```bash
bash scripts/phase-n3a/gate-n3a-play.sh
```

| Check | Pass |
|-------|------|
| Prereqs | `catalog-service` up · filters example has N3a fields |
| **Browse pick A** | Random item from `movies-india-trending` or `series-india-picks` (not `tt0111161`) |
| `POST /play` | `ok: true` |
| `total_ms` | ≤ **15000** |
| `attempts` | ≤ `auto_play_max_attempts` (5) |
| mpv | `playback-time > 0` |
| **Browse pick B** | Different rail than A — same checks |
| Shawshank regression | `tt0111161` still plays (budget may exceed 15 s — warn only) |
| Regression | `gate-n2-browse.sh` · `gate-n0.sh` exit 0 |

Add to `pi-pre-couch-gate.sh` when `MANGO_CATALOG=1`.

Reuse `scripts/lib/gate-common.sh`. Extend `gate_check_play_json` to accept max `total_ms` arg.

### G5 — Inventory metrics + couch note

Fill `docs/N3-INVENTORY.md` § Metrics after Pi gate run. Add § Couch sign-off checklist (manual).

### G6 — Launcher passes `rail_id` on play (nice-to-have)

`POST /play` body supports `rail_id` for playability invalidation. Launcher `playCard()` should pass rail context when available.

---

## 4. Non-goals (N3a — defer)

| Out of scope | Phase |
|--------------|-------|
| Stream picker UI | N3b |
| `progress.db` / resume | N3b / N4 |
| Hidden Stremio fallback | N7 |
| Settings UI for `include_uncached` | N3b |
| Search UI | Later |
| 4K / REMUX relaxation | N7 |
| Change gamepad evdev codes | Never |

---

## 5. Design principles (binding)

Apply **`$mango-tv-box-expert`**: 15 s wall budget · silent launcher failures · cached AIOStreams first · git-only deploy · gate before handoff.

---

## 6. Stream filter contract

**Repo:** `config/catalog-filters.example.json` · **Pi:** `/etc/mango/catalog-filters.json`

N3a couch defaults: `strict_unknown_cache: true` · `auto_play_wall_ms: 15000` · `auto_play_probe_ms: 4000` · tiered AIOStreams cached-first.

Indexer relaxations (`uncached_torbox_fallback`, `rd_safe_unknown_fallback`) stay for verify — not default couch browse.

---

## 7. API contract (`POST /play`)

Success: `{ ok, ttff_ms, total_ms, attempts, stream, filters }`  
Failure: HTTP 502 `no_playable_stream` — launcher generic message only.

---

## 8. Launcher status copy

`finding stream…` → `starting…` → `playing · 1080p. ⌂ returns home.` or `couldn't start playback. try another title.`

---

## 9. Deliverables (closure)

| ID | Deliverable | Status |
|----|-------------|--------|
| D1–D2 | orchestrator + core cache | ✓ shipped |
| D3 | tier wiring | **G2** |
| D4 | filter defaults | **G1** |
| D5–D7 | API + launcher | ✓ shipped (G6 optional) |
| D8–D9 | `gate-n3a-play.sh` + pre-couch | **G4** |
| D10 | inventory metrics | **G5** |

---

## 10. Validation

```bash
bash scripts/phase-n3a/gate-n3a-play.sh
bash scripts/phase-n3c/gate-n3c-verified-rails.sh
bash scripts/pi-pre-couch-gate.sh
```

No waivers for browse-pick play within 15 s.

---

## 11. Deploy

```bash
git push origin feat/native-experience && bash scripts/pi-deploy.sh --fast   # iterate; --full --gate before handoff
sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json
```

---

## 12. Handoff to N3b

Stream picker · `progress.db` · Continue rail · optional Torrentio in picker (not auto-play).
