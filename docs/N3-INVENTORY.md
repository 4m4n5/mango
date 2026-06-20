# N3 inventory — stream play orchestrator (N3a)

**Branch:** `feat/native-experience`  
**Gates:** `bash scripts/phase-n3a/gate-n3a-play.sh` · `bash scripts/phase-n3a/gate-n3a-play-ladder.sh` · `bash scripts/phase-n3c/gate-n3c-verify-ladder.sh`  
**Spec:** [`tasks/phase-n3-stream-orchestrator.md`](tasks/phase-n3-stream-orchestrator.md)  
**Manual:** [`../scripts/phase-n3a/MANUAL-GATE-play-ladder.md`](../scripts/phase-n3a/MANUAL-GATE-play-ladder.md)

---

## Plan

**Locked scope:** orchestrator backend · play preference ladder · filter tiers · pre-resolve · launcher copy · gates. **No picker UI** (N3b).

### Play preference ladder (shipped)

Couch `POST /play` and playability **verify** share the same ladder (`config/catalog-filters.example.json` → `play_ladder`):

| Step | Intent |
|------|--------|
| `ideal` | 1080p cached encode, TorBox, no remux |
| `1080p_uncached` | 1080p TorBox uncached allowed |
| `1080p_remux` | 1080p cached remux |
| `2160p_encode` | 2160p encode, TorBox + RD |
| `last_resort` | any cache, remux OK, RD safe-unknown |

**Budgets:** `auto_play_wall_ms: 90000` · `auto_play_max_attempts: 12` · `auto_play_probe_ms: 8000` · `auto_play_uncached_probe_ms: 25000`.

**NFO preflight** rejects non-video sidecars before mpv. **GET /stream** still filters to **ideal step only** (display headroom for N3b picker). **POST /play** uses raw streams + full ladder.

**Verify DB:** `schema_version >= 2` · `win_ladder_step` on verified rows · play prefers matching hash + step.

### Orchestrator (baseline N3a)

Parallel stream resolve (10 min cache) · probe-then-play · verified `win_url_hash` fast path when `probe_ms` within couch budget · AIOStreams-only autoplay tiers · Torrentio excluded from autoplay.

### Pre-resolve

Detail fires `GET /api/catalog/stream/:type/:id` in background. Launcher status: `finding stream…` → ladder copy (`trying best match…` / `trying alternate release…`) → `playing…`.

### Gate strategy

| Gate | Role |
|------|------|
| `gate-n3a-play-ladder.sh` | Config contract + ladder unit tests |
| `gate-n3c-verify-ladder.sh` | Verify imports ladder + DB `win_ladder_step` |
| `gate-n3a-play.sh` | Live couch: 2 browse picks + Shawshank warn-only; wall ≤90s, attempts ≤12 |

Browse picks: `movies-india-trending` / `series-india-picks` (fallback global rails when empty). Also runs N2 + N0 regression.

### Deferred N3b

Stream picker UI · `progress.db` · Continue rail · Torrentio in picker only.

---

## Metrics (after play ladder — Track A)

| Metric | Value |
|--------|-------|
| `gate-n3a-play-ladder.sh` | **PASS** @ `8f6aad5` |
| `gate-n3c-verify-ladder.sh` | **PASS** @ `8f6aad5` |
| `gate-n3a-play.sh` | **PASS** @ `8f6aad5` (Pi pre-couch) |
| Dark Knight regression | `win_ladder_step: 1080p_remux` ~9s (NFO skip on ideal) |
| Shawshank regression | warn-only when `total_ms > 90000` |
| Browse pick budget | `total_ms ≤ 90000`, `attempts ≤ 12` |
| `playability.db` | `schema_version: 2`, stale **0** @ Track A audit |
| `movies-india-trending` | low_water (10/20 verified) — bootstrap top-up @ Track A — bootstrap maintenance |
| catalog-service tests | **57** pass (ladder + preflight + orchestrator) |
| `/etc/mango/catalog-filters.json` | synced via `scripts/lib/sync-etc-mango-config.sh` on deploy |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N3-C1 couch note (manual)

**Lab:** 1080p monitor · headphones via monitor 3.5 mm.

- [x] Verified title (Shawshank) → Play without alternate-release copy
- [x] Ladder fallback (Dark Knight) → playback after ladder status
- [ ] Cancel (Y) during long resolve
- [ ] One series from india picks
- [ ] ⌂ → home < 1 s after play
- [ ] Voice HUD regression (N0 gate)

---

## Handoff to N3b / Track B

- **N3b:** Stream picker (2–5 options from ideal step) · `progress.db` · Continue  
- **Track B:** Verified-only rail display · `gate-n3c-verified-rails` as primary couch proof

---

## Follow-ups

| ID | Item | Stage | Notes |
|----|------|-------|-------|
| N3-F1 | ElfHosted private subscriptions | Ops | [`ELFHOSTED.md`](ELFHOSTED.md) |
| N3-F2 | Rail cache + stagger + couch-safe errors | **Shipped** | |
| N3-F3 | N3c playability index + ladder verify | **Shipped** | `win_ladder_step` |
| N3-F4 | `gate-n3c-verified-rails` primary gate | Track B | displayed ⇒ playable |
| N3-F5 | Async play progress API | Track C | 90s wall vs launcher HTTP |
