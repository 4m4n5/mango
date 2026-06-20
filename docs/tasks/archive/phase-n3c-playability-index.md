# Phase N3c — Verified catalog / playability index

**Status:** Not started  
**Branch:** `feat/native-experience`  
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md) — slots between N3a and N5  
**Codex prompt:** [`CODEX-phase-n3c-prompt.md`](CODEX-phase-n3c-prompt.md)  
**Prerequisite:** N3a orchestrator on Pi (`7882f15+`) · `MANGO_CATALOG=1` · [`N3-INVENTORY.md`](../N3-INVENTORY.md)

**Product principle:** If a title appears on a mango rail, **Play must work**.  
Hit rate is measured as **plays succeeded ÷ titles shown**, not random upstream trending.

### Locked design choices (2026-06-19)

| Decision | Choice |
|----------|--------|
| Verification | **Tiered:** production filters → mpv `--probe` on top candidates only |
| Surfacing | **Verified-only** — no unverified posters; backfill until rail minimum met |
| Freshness | **Session mix:** 70% stable favorites + 30% random from verified pool each boot |
| AI catalogs (N5) | **Unified pipeline** — all list sources share `playability.db` + verification |

---

## 1. Objective

Replace “show upstream trending, hope play works” with a **verified catalog layer**:

1. **Wide ingest** — pull many candidate IDs per rail (100+ from addon catalogs).
2. **Tiered verify** — run `filterStreamsForPlay` + mpv probe on survivors.
3. **Narrow serve** — launcher rails contain **only verified** titles (10–12 visible).
4. **Never run dry** — low-water triggers backfill; pools sized so each category survives a full day.
5. **Stay fresh** — session rotation + cooldown so rails don’t feel identical every day.
6. **N5-ready** — AI-named catalogs are just another `ListSource`; same verify path.

### Success definition

| Artifact | Requirement |
|----------|-------------|
| `playability.db` | SQLite on Pi; survives reboot; migrations versioned |
| `playability-indexer` | Tiered verify worker; bounded concurrency; resumable |
| `ListSource` API | Pluggable sources: `addon_catalog`, `static_ids`, `ai_catalog` (stub ok), future `tmdb_list` |
| `core.railItems` | Returns verified-only items; `resolve_ms` + `verified_count` + `pool_depth` in meta |
| Rotation | 70/30 session mix; 7-day recently-shown cooldown per rail |
| Triggers | Low-water, scheduled re-probe, boot warm, config-change invalidation |
| Gate | `gate-n3c-verified-rails.sh` — **N/N** play OK on **served** rail items |
| Launcher | No change required if API is honest; optional “refreshing…” if rail &lt; min |
| Diagnostics | `scripts/diag/playability-status.py` — pool depth, stale counts, last run |

### Couch acceptance

| # | Test | Pass |
|---|------|------|
| C1 | Every poster on every rail → Play ≤15 s, picture + audio | |
| C2 | Reboot Pi → rails differ ~30% from prior session (rotation) | |
| C3 | No debrid download/copyright screen on first frame | |
| C4 | No API/mpv error text on status line | |
| C5 | After 24 h idle, rails still ≥ min size (no empty rows) | |

---

## 2. Non-goals (N3c)

| Out of scope | Phase |
|--------------|-------|
| Stream picker UI | N3b |
| `progress.db` / Continue rail | N4 |
| LLM `create_catalog` tools | N5 (but schema + `ListSource` must be ready) |
| Voice `play_title` bypassing verify | Never for home rails; voice may search then verify-on-demand |
| In-browser video | Never |
| Showing unverified posters with disabled Play | Rejected — breaks 100% promise |
| Parallel mpv probes (multi-stream) | Defer — single indexer, serial probes initially |

---

## 3. Problem statement

Diagnostics (exhaustive + gate, `4965eb9`–`7882f15`):

- Random rail play OK ≈ **49–60%** — wrong denominator for couch UX.
- Failures: title mismatch, debrid status clips, uncached timeouts.
- Gate: browse pick OK, Shawshank API ok but mpv dead — false positive.
- Root cause: **rails = upstream catalog**; playability decided at button press.

N3a orchestrator is a **safety net**, not a product strategy. N3c moves guarantee to **index time**.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  catalog.yaml / ai-catalogs/*.json  (ListSource definitions)     │
└────────────────────────────┬────────────────────────────────────┘
                             │ ingest (wide pool)
┌────────────────────────────▼────────────────────────────────────┐
│  playability-indexer (systemd timer + on-demand)                 │
│  1. ListSource.candidates(limit × ingest_multiplier)             │
│  2. meta enrich (existing resolveRailItem path)                  │
│  3. filterStreamsForPlay (production filters + metaTitle/metaId) │
│  4. mpv --probe top 1–3 candidates (12s budget, min duration)  │
│  5. UPSERT playability.db                                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  playability.db (SQLite)                                         │
│  titles · rail_pool · rail_session · verify_log · triggers       │
└────────────────────────────┬────────────────────────────────────┘
                             │ serve
┌────────────────────────────▼────────────────────────────────────┐
│  catalog-service GET /rails/:id/items                          │
│  verified-only · session rotation · backfill                     │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  mango launcher (unchanged contract if API honest)               │
└─────────────────────────────────────────────────────────────────┘
```

### ListSource (unified for N5)

```typescript
interface ListSource {
  readonly sourceId: string;       // e.g. rail id or ai-catalog id
  readonly sourceType: 'addon_catalog' | 'ai_catalog' | 'static_ids' | 'tmdb_list';
  candidates(options: { offset: number; limit: number }): Promise<CandidateMeta[]>;
}
```

- **N3c ships:** `addon_catalog` (from yaml), `static_ids` (for tests).
- **N3c stubs:** `ai_catalog` reads `/etc/mango/ai-catalogs/{id}.json` — same verify pipeline, not exposed on home until N5.
- **Future:** `tmdb_list` implements same interface.

---

## 5. Data model (`playability.db`)

Path: `/etc/mango/playability.db` (configurable `MANGO_PLAYABILITY_DB`).

### `titles`

| Column | Type | Notes |
|--------|------|-------|
| `type` | TEXT | `movie` \| `series` |
| `id` | TEXT | imdb id |
| PK | (`type`, `id`) | |
| `status` | TEXT | `verified` \| `failed` \| `pending` \| `stale` |
| `verified_at` | INTEGER | unix ms |
| `expires_at` | INTEGER | unix ms — re-probe after |
| `fail_reason` | TEXT | taxonomy: `title_mismatch`, `no_stream`, `status_clip`, `timeout`, `copyright` |
| `best_source` | TEXT | winning addon name |
| `cache_status` | TEXT | `cached` \| `uncached` \| `unknown` |
| `debrid_service` | TEXT | |
| `probe_ms` | INTEGER | |
| `win_url_hash` | TEXT | sha256 prefix — invalidate on change |

### `rail_pool`

Links verified titles to a logical rail (many-to-many).

| Column | Notes |
|--------|-------|
| `rail_id` | matches `catalog.yaml` id |
| `type`, `id` | FK → titles |
| `score` | stable rank (recency, quality, diversity) |
| `ingested_at` | |

### `rail_session`

Per-boot rotation state (cleared or rotated each `mango-stack.sh restart` / daily).

| Column | Notes |
|--------|-------|
| `rail_id` | |
| `type`, `id` | |
| `slot` | display order 0..n-1 |
| `mix_bucket` | `stable` \| `fresh` |
| `session_id` | uuid per boot |

### `recently_shown`

| Column | Notes |
|--------|-------|
| `rail_id`, `type`, `id` | |
| `shown_at` | unix ms |
| Cooldown: **7 days** before title eligible for `stable` slot again |

### `verify_log` (append-only, prune >30d)

`started_at`, `rail_id`, `type`, `id`, `stage`, `ms`, `outcome`

---

## 6. Verification algorithm (tiered)

Per `(type, id)`:

```
1. rawStreams(type, id)           — existing catalog-service path
2. filterStreamsForPlay(...)      — production config + metaTitle/metaId
3. if kept == 0 → status=failed, reason from excluded counts
4. selectAutoPlayCandidates(...)  — top 3 max
5. for each candidate (stop on first pass):
     mpv-play.sh --url URL --probe --timeout-ms 12000 --min-duration-sec 600
6. if pass → status=verified, record winner metadata, expires_at = now + 48h
7. if all fail → status=failed, reason from last error
```

**Concurrency:** 1 mpv probe at a time (Pi constraint). Meta/stream resolve may parallelize (max 3).

**Series:** `min-duration-sec 600` for movies; 600 for series pilot (same as orchestrator).

---

## 7. Rail serve algorithm

Config per rail (yaml extensions or defaults):

```yaml
rails:
  - id: trending-india
  # ... existing fields ...
    playability:
      display_limit: 12        # posters on screen
      min_display: 8           # trigger low-water below this
      ingest_multiplier: 5     # fetch limit × 5 candidates per indexer pass
      pool_target: 60          # verified titles to maintain in rail_pool
```

### Session rotation (70/30)

On `mango-stack.sh start` or first `GET /rails/:id/items` after boot:

1. Load `rail_pool` where `status=verified` and not expired.
2. Exclude `recently_shown` within 7 days for **stable** picks.
3. **Stable (70%):** highest `score` among eligible (cached &gt; unknown &gt; uncached TB).
4. **Fresh (30%):** uniform random from remaining verified pool.
5. Write `rail_session` rows; record `recently_shown`.
6. Return items in slot order (enriched meta from cache).

If verified &lt; `min_display` → **trigger indexer** (async) + return what exists (may be &lt; min temporarily; launcher shows fewer cards, not broken posters).

### Pi bootstrap target delta (N3c-S2)

The long-term `pool_target` remains 60, but the initial Pi bootstrap config uses
`pool_target: 20` for the five active rails. Measured on the Pi, the
`trending-india` upstream page exposed 97 unique titles and only 24 verified
successfully after full classification. A target of 60 is therefore unreachable
for that rail until N3c adds wider/fallback sources. This does not weaken the
served-item guarantee: rails still serve verified-only items, and `min_display`
remains 8.

### Low-water triggers

| Trigger | Condition | Action |
|---------|-----------|--------|
| `pool_low` | verified in `rail_pool` &lt; `pool_target × 0.5` | ingest next upstream page |
| `display_low` | session items &lt; `min_display` | priority verify pending queue |
| `stale` | `expires_at` &lt; now | re-probe in background |
| `config_change` | hash of `catalog-filters.json` / export changed | mark all `stale`, re-probe |
| `play_failure` | `POST /play` exhausted candidates | mark title `stale`, remove from session |
| `scheduled` | systemd timer 03:00 daily | re-probe stale + top-up pools |

---

## 8. API changes

### `GET /rails/:id/items`

Response additions:

```json
{
  "rail_id": "trending-india",
  "items": [ /* only verified */ ],
  "resolve_ms": 42,
  "playability": {
    "displayed": 10,
    "verified_pool": 58,
    "pending": 12,
    "low_water": false,
    "session_id": "…"
  }
}
```

### New endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/playability/status` | indexer health, per-rail pool depths |
| `POST` | `/playability/reindex` | manual trigger (localhost only) |
| `POST` | `/playability/invalidate` | body `{type,id}` — after play failure |

---

## 9. Indexer deployment

**Script:** `scripts/phase-n3c/playability-indexer.ts` (or `.py` calling catalog HTTP + mpv)

**systemd user units:**

- `mango-playability-indexer.service` — oneshot
- `mango-playability-indexer.timer` — daily 03:00 + `OnBootSec=5min`
- `mango-stack.sh` — invoke indexer warm after catalog-service healthy

**Env:**

- `MANGO_PLAYABILITY_DB=/etc/mango/playability.db`
- `MANGO_PLAYABILITY_CONCURRENCY=1` (mpv)
- `MANGO_PLAYABILITY_INGEST_MULTIPLIER=5`

---

## 10. Gate strategy

**Replace** random trending in `gate-n3-hitrate.sh` with:

`scripts/phase-n3c/gate-n3c-verified-rails.sh`:

1. For each enabled yaml rail: `GET /rails/:id/items`
2. Assert `items.length >= min_display` (or waiver logged)
3. For **every** returned item: `POST /play` → assert ok + mpv `playback-time > 0` + duration check
4. Target: **100%** (N/N)
5. Shawshank **removed** as fixed anchor — use served set only

Keep `exhaustive-hitrate.py` as **indexer QA** (wide pool), not couch gate.

---

## 11. File plan

| Path | Action |
|------|--------|
| `src/catalog-service/src/playability/` | NEW — db, indexer client, ListSource, rotation |
| `src/catalog-service/src/core.ts` | `railItems` → verified serve path |
| `src/catalog-service/src/rails.ts` | parse `playability:` rail extensions |
| `scripts/phase-n3c/playability-indexer.ts` | NEW — CLI worker |
| `scripts/phase-n3c/gate-n3c-verified-rails.sh` | NEW |
| `scripts/diag/playability-status.py` | NEW |
| `config/catalog.example.yaml` | add `playability` defaults |
| `scripts/mango-stack.sh` | start indexer warm + timer install hint |
| `scripts/pi-pre-couch-gate.sh` | call `gate-n3c` when `MANGO_CATALOG=1` |
| `docs/N3c-INVENTORY.md` | NEW — metrics after ship |

---

## 12. Implementation phases (for Codex)

| Slice | Deliverable | Gate |
|-------|-------------|------|
| **N3c-S0** | SQLite schema + migrations + `GET /playability/status` | unit smoke |
| **N3c-S1** | ListSource + tiered verify CLI (single title) | manual `tt0111161` |
| **N3c-S2** | Indexer batch + `rail_pool` ingest | pool depth &gt; 0 |
| **N3c-S3** | `railItems` verified-only + session rotation | launcher shows subset |
| **N3c-S4** | Triggers (low-water, stale, play invalidate) | 24h soak |
| **N3c-S5** | `gate-n3c-verified-rails.sh` + pi-pre-couch | **N/N pass** |

---

## 13. Risks

| Risk | Mitigation |
|------|------------|
| Indexer slow (100 titles × 15s) | Tiered filter-first; nightly top-up; wide pool not all at once |
| Upstream catalog thin | multiple ListSources per rail; `static_ids` emergency backfill |
| TorBox uncached wins expire | `expires_at` 48h; prefer cached in `score` |
| AI catalog IDs bad meta | N5 silent skip at ingest; never enters pool |
| Pi CPU during couch | indexer nice-level 10; pause when `POST /play` active |
| **ElfHosted public rate limits** | Private subs ([`ELFHOSTED.md`](../ELFHOSTED.md)); rail cache 45 min; staggered fetch; N3c serves from DB |

### Follow-ups (N3c + ops)

| ID | Item | Owner |
|----|------|-------|
| N3c-F1 | Subscribe ElfHosted private (AIOMetadata + AIOStreams) | User — [`ELFHOSTED.md`](../ELFHOSTED.md) |
| N3c-F2 | Indexer uses cached rails where possible | N3c-S2 |
| N3c-F3 | `gate-n3c` only hits verified pool (not raw upstream burst) | N3c-S5 |
| N3c-F4 | Document `MANGO_RAIL_*` in Pi `voice.env` example | N3c-S5 |

---

## 14. References

- Diagnostics: `/tmp/mango-exhaustive-1781837588.json`, `1781838299.json` on Pi
- [`phase-n3-stream-orchestrator.md`](phase-n3-stream-orchestrator.md) — orchestrator as safety net
- [`NATIVE_EXPERIENCE.md`](../NATIVE_EXPERIENCE.md) § AI catalogs
- Android TV Engage SDK — daily refresh + event-driven updates ([publish guidelines](https://developer.android.com/guide/playcore/engage/publish))
