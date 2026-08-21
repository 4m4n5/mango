> **Archived spec** — superseded by [ROADMAP.md](../../ROADMAP.md) / [STATUS.md](../../STATUS.md).
> Shipped status may differ from this doc. Do not implement from here without checking STATUS.

# Phase N5d — AI catalog bootstrap (non-empty rails)

**Status:** Spec locked · **not shipped**  
**Branch:** `feat/native-experience`  
**Depends on:** N5b (AI catalogs) ✓ · N5c (living librarian) ✓ · N3d (mdblist pipeline) ✓  
**Inventory:** extends [`../N5-INVENTORY.md`](../N5-INVENTORY.md)  
**Related:** [`phase-n5b-ai-catalogs.md`](phase-n5b-ai-catalogs.md) · [`phase-n5c-living-librarian.md`](phase-n5c-living-librarian.md) · [`../STACK-PRINCIPLES.md`](../STACK-PRINCIPLES.md)

---

## Goal

When a user asks for a voice-managed AI rail (e.g. “horror movies”), mango must **always** produce a **couch-visible** rail on the correct tab — **≥ `min_display` (6) verified posters** as soon as the async bootstrap job completes — then grow via existing playability top-up + nightly gardener rules.

**North star:** *Create means “on TV soon,” not “YAML saved.”*

---

## Problem statement (verified — horror incident)

| Layer | Horror case (2026-06-21) |
|-------|--------------------------|
| Slot YAML | ✓ `/etc/mango/ai-catalogs/slots/horror.yaml` |
| `seed_titles` / `sources` | ✗ theme-only |
| Playability pool | `verified_pool: 0` |
| Movies tab batch | `ai-horror` omitted (`items.length === 0` filter) |
| Agent reply | falsely claimed visible on Movies tab |

Root chain: **no ingest path** → **no bootstrap** → **hidden rail** → **agent spoke from create `ok` not from TV truth**.

---

## Locked design decisions

| # | Topic | Choice |
|---|--------|--------|
| D1 | **Thematic display** | **Server Thematic Compose** — mdblist match first; else library + external search → `seed_titles`; bootstrap until thematic pool fills; broad Cinemeta only if thematic seeds still cannot verify |
| D2 | **Degraded label** | Keep user label (“Horror”); theme in `llm_hints`; **no** misleading silent broad rail without thematic effort |
| D3 | **Bootstrap UX** | **Async** — create returns quickly; phone shows “building…”; agent polls status; user shuffles when `visible_on_tab` |
| D4 | **Visibility floor** | **`min_display` (6)** verified + present in tab batch |
| D5 | **Reserve size** | **~40 mdblist lists** pre-imported (`showInHome: false`) — AI Rail Catalog Reserve |
| D6 | **Lazy import** | **Always** when compose picks a warm list not yet in AIOMetadata (background step inside bootstrap job) |
| D7 | **Compose boundary** | **Server Source Composer only** — agent sends `{ label, tab, content_type, theme? }`; API rejects theme-only / agent-supplied sources |
| D8 | **Bad slots** | **Auto-migrate on compose/refresh** — rewrite slot + re-bootstrap (fixes existing `horror.yaml`) |
| D9 | **Growth after create** | Unchanged N5b/N5c — nightly top-up, gardener hints, `llm_hints.topup_suggestions` |

### MDBList / API load (why ~40 is enough)

| Activity | Cost | Frequency |
|----------|------|-----------|
| Inventory sync (HTML scrape toplists/curated) | No MDBList API key | Weekly on Mac/CI |
| Pre-import reserve into AIOMetadata | One-time config write per deploy | Deploy + lazy add |
| Catalog page fetch during top-up | MDBList API per **active** list page (24h cache in AIOMetadata) | Only when a rail ingests |
| Playability verify | AIOStreams/debrid (dominant cost) | Per candidate title |

**Reserve entries are idle until attached to a rail.** Pi load scales with **active AI rails (≤6)** + yaml rails, not reserve count. ~40 lists covers one strong list per taxonomy genre + India/mood headroom without config bloat.

---

## Architecture principles (binding)

| # | Invariant |
|---|-----------|
| P1 | **Create ≠ visible** until bootstrap job reports `visible_on_tab: true` |
| P2 | **Every slot must have an ingest path** — `sources` and/or `seed_titles`; theme-only invalid |
| P3 | **Thematic first** — compose maximizes tag-matched mdblist + searched seeds before any broad fallback |
| P4 | **Servable sources** — lazy-import warm catalogs before top-up if not in AIOMetadata manifest |
| P5 | **Agent truth** — only claim TV visibility when status API says `visible_on_tab` |
| P6 | **One index, many consumers** — `mdblist-inventory.json` + reserve serve yaml curation, voice compose, and LLM export |

---

## Layer 1 — Catalog index & reserve

### 1.1 Expand inventory (offline)

**Existing:** `scripts/diag/mdblist-inventory.py sync-toplists` (~50 cards).

**Add:** paginated sync, `config/mdblist-genre-seeds.json`, extend `tags.genre` (horror, hindi, …), weekly `mdblist-catalog-pipeline.sh measure`.

**Target:** 300+ indexed lists; **40 promoted to reserve**.

### 1.2 AI Rail Catalog Reserve

**New:** `config/ai-catalog-reserve.json` — ~40 lists, `showInHome: false` in AIOMetadata.

Merge into `aiometadata-config.sh import`. Gate: every taxonomy genre has ≥1 reserve catalog.

### 1.3 Lazy import (always-on)

When compose selects ids not in manifest: synthesize from inventory → incremental AIOMetadata save → wait for manifest (60s) → top-up. Runs inside bootstrap job.

---

## Layer 2 — Source Composer

**New:** `src/catalog-service/src/ai-catalogs/compose.ts`

1. Tokenize label + theme → intent tags  
2. Rank inventory (tag overlap, hit rate, reserve tier, popularity)  
3. Pick 1–3 mdblist sources  
4. Thematic seeds: verified library search + external search (`queue_missing`)  
5. Fallback ladder: adjacent tags → broader mdblist + seeds → Cinemeta `top` last  
6. Reject if no sources and fewer than 3 seed candidates  

---

## Layer 3 — Bootstrap job & API

**Create flow:** compose → write slot → enqueue bootstrap → return `{ job_id, bootstrap_status: queued }`

**Worker:** lazy import → topUp loop → escalate fallback if exhausted → `visible_on_tab` check

**New routes:**

- `GET /voice/ai-catalogs/bootstrap/:job_id`
- `GET /voice/ai-catalogs/:slot_id/status`

**Migrate:** invalid/empty slots on refresh + nightly prelude.

---

## Layer 4 — Voice agent & companion

- Agent sends `{ label, tab, content_type, theme? }` only  
- Poll status; claim visibility only when `visible_on_tab: true`  
- Companion: bootstrap progress on tool card  

---

## Implementation phases

| Phase | Scope | Gate |
|-------|-------|------|
| **0** | This doc + gate skeleton + test stubs | Gate 0 runs |
| **1** | Source Composer + reject theme-only + migrate | Unit tests; create writes sources/seeds |
| **2** | Bootstrap worker (sync dev flag) + status API | E2E: horror visible ≥6 items |
| **3** | Async job + agent policy + companion | gate-n5d + conversation truth test |
| **4** | Reserve 40 + lazy import + inventory expansion | Manifest + reserve gate |
| **5** | Nightly migrate + measure pipeline | Weekly playbook |

**Start:** Phase 0 + Phase 1 on `feat/native-experience`.

---

## Gates

```bash
bash scripts/phase-n5/gate-n5d-ai-catalog-bootstrap.sh
bash scripts/phase-n5/gate-n5d-mdblist-reserve.sh
```

Horror regression: create → poll → `/rails/items?tab=movies` includes `ai-horror` with ≥6 items.

---

## Success criteria

| Metric | Target |
|--------|--------|
| Voice create → visible rail | ≥95% within 120s async job |
| Thematic score | ≥0.5 when reserve genre exists |
| Agent false visibility | 0 in policy gate tests |

---

## Detailed phase deliverables

### Phase 0 — Spec & gates skeleton

| Deliverable | Path |
|-------------|------|
| Gate skeleton | `scripts/phase-n5/gate-n5d-ai-catalog-bootstrap.sh` |
| Reserve gate | `scripts/phase-n5/gate-n5d-mdblist-reserve.sh` |
| Test stubs | `compose.test.ts`, `bootstrap.test.ts` |

### Phase 1 — Source Composer

| Task | Detail |
|------|--------|
| `compose.ts` | Rank inventory, thematic search, plan output |
| Inventory reader | `MANGO_MDBLIST_INVENTORY` or repo default |
| Create hook | Call compose; reject theme-only |
| `composeAndRewriteSlot()` | Migrate bad slots (horror.yaml) |
| Tests | Horror intent → mdblist horror ids + library seeds |

### Phase 2 — Bootstrap worker

| Task | Detail |
|------|--------|
| `bootstrap.ts` | topUp loop + tab visibility check |
| Dev flag | `MANGO_AI_CATALOG_SYNC_BOOTSTRAP=1` for inline run |
| Status endpoint | `verified_pool`, `displayed`, `visible_on_tab`, `thematic_score` |
| Timeouts | job 120s; lazy import 60s |

### Phase 3 — Async + agent truth

| Task | Detail |
|------|--------|
| In-process job map | keyed by `job_id` |
| Agent policy | `_TOOL_POLICY` + persona: visibility from status only |
| Companion | poll + show pool count on tool done |
| gate-n5c extension | catalog truthfulness case |

### Phase 4 — Reserve + lazy import

| Task | Detail |
|------|--------|
| `config/ai-catalog-reserve.json` | ~40 lists |
| `aiometadata-config.sh ensure-catalogs` | incremental import |
| Paginated mdblist sync | extend `mdblist_sync.py` |
| `config/mdblist-genre-seeds.json` | horror, hindi, anime, … |

### Phase 5 — Pipeline & nightly

| Task | Detail |
|------|--------|
| Nightly empty-slot migrate | `companion-nightly-consolidate.sh` hook |
| Promote measured lists → reserve | playbook in doc |
| `export-llm` | tag `voice-ready` |

---

## File touch list

| Area | Files |
|------|-------|
| Compose | `src/catalog-service/src/ai-catalogs/compose.ts`, `compose.test.ts` |
| Bootstrap | `src/catalog-service/src/ai-catalogs/bootstrap.ts`, `bootstrap.test.ts` |
| Service | `service.ts`, `index.ts` |
| Config | `config/ai-catalog-reserve.json`, `config/mdblist-genre-seeds.json` |
| Deploy | `scripts/phase-n3d/aiometadata-config.sh`, `docs/DEPLOY.md` |
| Inventory | `scripts/diag/lib/mdblist_sync.py` |
| Voice | `persona.py`, `voice/tools.ts` |
| Companion | `src/companion/src/main.ts` |
| Gates | `gate-n5d-*.sh`, `gate-voice-tools.sh` |

---

## Out of scope (N5d)

- Launcher partial-empty rails
- Phone push when rail ready
- Multi-household profiles
- Autonomous yaml rail edits

---

## Compose API types (reference)

```ts
type ComposePlan = {
  seed_titles: AiSeedTitle[];
  sources: CatalogSourceRef[];
  llm_hints: AiCatalogLlmHints;
  catalogs_to_activate: string[];
  fallback_level: 0 | 1 | 2 | 3;
  thematic_score: number;
};
```

```ts
type BootstrapStatus = {
  slot_id: string;
  rail_id: string;
  bootstrap_status: 'queued' | 'running' | 'ready' | 'failed';
  visible_on_tab: boolean;
  verified_pool: number;
  displayed: number;
  thematic_score: number;
  fallback_level: number;
  message: string;
};
```
