# Phase N2 — Real browse UI

**Status:** Not started  
**Branch:** `feat/native-experience`  
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md)  
**Codex prompt:** [`CODEX-phase-n2-prompt.md`](CODEX-phase-n2-prompt.md)  
**Prerequisite:** N1 gate passes (`bash scripts/phase-n1/gate-n1-smoke.sh` exit 0) · stream filters + couch play verified · [`N1-INVENTORY.md`](../N1-INVENTORY.md)

---

## 1. Objective

Replace the launcher **“browse rails ship in N2”** empty state with **real catalog rails** — legit posters from Cinemeta/TMDB — and a **minimal title detail** screen that plays via existing `POST /play`.

N2 is the **first product surface** for native browse. Success is couch navigation from home → rail → title → play in mpv — no `curl`, no smoke ID hardcoded in UI.

### Success definition

| Artifact | Requirement |
|----------|-------------|
| `config/catalog.example.yaml` | Documented rail types + household template |
| `/etc/mango/catalog.yaml` on Pi | At least 2 rails (e.g. Trending + Bollywood) |
| `catalog-service` | `GET /rails`, `GET /rails/:id/items` with resolved meta |
| `serve.py` | Proxy `/api/catalog/*` → `:3020` (avoid browser CORS) |
| Launcher | Home rails with **poster images**; detail view; **Play** → mpv |
| Pad | D-pad across rails + detail; B select; ⌂ home unchanged |
| Gate | `bash scripts/phase-n2/gate-n2-browse.sh` exit 0 |
| N1 regression | `gate-n1-smoke.sh` + `gate-n0.sh` still pass |
| `docs/N2-INVENTORY.md` | Plan, rail IDs, couch note, metrics |

### Dev lab context

Pi is on a **1080p monitor** with **headphones via monitor 3.5 mm** ([`HARDWARE.md`](../HARDWARE.md)). Stream filters (`max_quality: 1080p`, exclude uncached debrid) remain default until **N7** (4K TV + soundbar).

---

## 2. Non-goals

| Out of scope | Phase |
|--------------|-------|
| Stream picker (2–5 options UI) | N3 |
| `include_uncached` toggle in Settings UI | N3 |
| `progress.db` / resume | N3 |
| Stremio library / Continue rail (real data) | N4 — N2 may show **placeholder** Continue rail |
| AI catalogs | N5 |
| yt-dlp YouTube rail | N6 |
| 4K / soundbar / Piper TTS | N7 |
| Search UI (Cinemeta + TMDB) | N2 stretch — **optional** if time; not gate-blocking |
| 10ft Settings editor for `catalog.yaml` | Later — edit on Mac → git pull |
| In-browser `<video>` playback | Never |

**Do not** pass N2 gate with mock/fake poster URLs in production path.

---

## 3. Design principles (binding)

Apply **`$mango-tv-box-expert`** and **`$ux-design-expert`**:

| Principle | N2 meaning |
|-----------|------------|
| **Legit metadata** | Posters from Cinemeta `meta` or TMDB list resolution — no lorem placeholders |
| **YAML-driven rails** | `catalog.yaml` is source of truth; service reads at boot + optional reload |
| **Chromium = UI only** | Play always via `POST /play` → mpv |
| **CORS-safe** | Launcher fetches `/api/catalog/*` on `:3000`, not `:3020` directly |
| **Graceful empty** | Rail with zero resolved items shows empty state, not crash |
| **Sub-300 ms home** | ⌂ from detail or mpv → launcher (N1 contract preserved) |
| **Git-only Pi deploy** | Commit + push; `git pull` on Pi |
| **1080p lab defaults** | Keep `/etc/mango/catalog-filters.json` caps; N2 does not relax filters |

---

## 4. catalog.yaml contract

**Repo template:** `config/catalog.example.yaml`  
**Pi path:** `/etc/mango/catalog.yaml` (copy from example; not committed with secrets)

### Rail types (N2 minimum)

| `type` | Purpose | N2 required |
|--------|---------|-------------|
| `addon_catalog` | Stremio addon catalog → title IDs → Cinemeta meta | **Yes** — e.g. Cinemeta popular movies |
| `tmdb_list` | TMDB list ID → resolve IDs → Cinemeta meta | **Yes** — Bollywood / India list |
| `stremio_library` | Continue watching from Stremio | Placeholder OK (empty or “ships N4”) |
| `static_ids` | Explicit `type` + `id` list | Optional smoke rail |

### Example shape

```yaml
version: 1
rails:
  - id: trending
    label: Trending
    type: addon_catalog
    addon: Cinemeta
    catalog: top
    content_type: movie

  - id: bollywood
    label: Bollywood
    type: tmdb_list
    list_id: "…"          # household TMDB list — document in N2-INVENTORY
    content_type: movie

  - id: continue
    label: Continue watching
    type: stremio_library
    enabled: false        # N4 enables
```

### Item shape (API)

Each rail item returned to launcher:

```json
{
  "id": "tt0111161",
  "type": "movie",
  "title": "The Shawshank Redemption",
  "subtitle": "1994",
  "poster": "https://…",
  "year": 1994
}
```

---

## 5. catalog-service API (extend N1)

**Base:** `127.0.0.1:3020` (unchanged)

| Method | Path | Response |
|--------|------|----------|
| `GET` | `/rails` | `{ rails: [{ id, label, type, item_count? }] }` |
| `GET` | `/rails/:id/items` | `{ rail_id, items: [...], resolve_ms }` |
| `GET` | `/meta/:type/:id` | *(existing)* |
| `GET` | `/stream/:type/:id` | *(existing + filters)* |
| `POST` | `/play` | *(existing)* |

### Behavior

- Load `catalog.yaml` from `MANGO_CATALOG_YAML` or `/etc/mango/catalog.yaml`.
- **`addon_catalog`:** map addon name → manifest from stremio export; fetch catalog page; take first N items (default **20**); resolve each via Cinemeta meta.
- **`tmdb_list`:** require `TMDB_API_KEY` from `/etc/mango/tmdb.key` or `config.yaml`; map TMDB movie IDs → `tt…` via Cinemeta or TMDB external_ids.
- **Cache:** in-memory meta cache per process (TTL optional, 5–15 min OK for N2).
- **Errors:** missing yaml → `/rails` 503; unknown rail → 404; partial meta failures → skip item silently (log count).

---

## 6. Launcher proxy (`serve.py`)

Add reverse proxy routes (stdlib `urllib` or `http.client`):

| Launcher path | Upstream |
|---------------|----------|
| `GET /api/catalog/rails` | `GET http://127.0.0.1:3020/rails` |
| `GET /api/catalog/rails/:id/items` | `GET http://127.0.0.1:3020/rails/:id/items` |
| `GET /api/catalog/meta/:type/:id` | `GET http://127.0.0.1:3020/meta/:type/:id` |
| `POST /api/catalog/play` | `POST http://127.0.0.1:3020/play` |

Return upstream status/body; set `content-type: application/json`. Timeout **60 s** for items (addon catalog can be slow).

---

## 7. Launcher UI

**Path:** `src/launcher/`

### Home (`home.ts`)

- Remove `createCatalogEmptyState()` production path.
- On load: `fetch('/api/catalog/rails')` → for each rail, `fetch('/api/catalog/rails/:id/items')`.
- Render horizontal poster rails (reuse `.rail` / `.rail-track` patterns).
- `ContentCard` extended: `posterUrl`, `type` (`movie` | `series`), `year`.
- Loading skeleton per rail; error rail shows retry message.

### Detail view (new)

- Minimal overlay or `#detail-view` section: large poster, title, year, synopsis (from meta).
- Primary action: **Play** → `POST /api/catalog/play` with `{ type, id }`.
- **Back** (Y / Escape): return to home, restore focus to originating card.
- Status line: “Resolving…” during play (reuse N1 TTFF pattern).

### Focus grid

- Rows = catalog rails + Apps row (unchanged).
- Detail is modal layer — pad B/Y still work per `FOREGROUND.md`.

### Copy voice

- Lowercase, mango-native — no Stremio jargon in user-facing strings.

---

## 8. Deliverables

### D1 — Config

| File | Purpose |
|------|---------|
| `config/catalog.example.yaml` | Template + comments |
| `docs/N2-INVENTORY.md` | Plan + metrics + TMDB list ID used |

### D2 — catalog-service

| File | Purpose |
|------|---------|
| `src/catalog-service/src/rails.ts` | YAML load + rail resolvers |
| `src/catalog-service/src/core.ts` | Wire `/rails` endpoints |
| `src/catalog-service/src/tmdb.ts` | TMDB list fetch (if split) |

### D3 — Launcher server

| File | Purpose |
|------|---------|
| `src/mango-ui-server/serve.py` | `/api/catalog/*` proxy |

### D4 — Launcher UI

| File | Purpose |
|------|---------|
| `src/launcher/src/catalog.ts` | Fetch + types for rails API |
| `src/launcher/src/home.ts` | Real rails |
| `src/launcher/src/detail.ts` | Title detail + play |
| `src/launcher/src/main.ts` | Wire detail navigation |
| `src/launcher/src/types.ts` | Extended card types |
| `src/launcher/src/style.css` | Poster cards + detail layout |

### D5 — Gates & scripts

| File | Purpose |
|------|---------|
| `scripts/phase-n2/check-n2-prereqs.sh` | yaml, tmdb key, catalog health |
| `scripts/phase-n2/gate-n2-browse.sh` | API + launcher dist + regression |

### D6 — Docs

| File | Purpose |
|------|---------|
| `AGENTS.md` | N2 gate commands |
| `docs/README.md` | N2 ← now |
| `docs/PLAN.md` | N1 ✓, N2 active |

---

## 9. Validation gates

### Gate N2-A — Prereqs

```bash
bash scripts/phase-n2/check-n2-prereqs.sh
```

| Check | Pass |
|-------|------|
| `/etc/mango/catalog.yaml` | exists |
| `/etc/mango/tmdb.key` | exists (if bollywood rail uses TMDB) |
| `GET :3020/health` | ok |
| `GET :3020/rails` | ≥2 rails |
| Launcher `dist/` built | index.html present |

### Gate N2-B — API

```bash
curl -sf http://127.0.0.1:3020/rails
curl -sf http://127.0.0.1:3020/rails/trending/items | python3 -c "import json,sys; d=json.load(sys.stdin); assert len(d['items'])>=3"
curl -sf http://127.0.0.1:3000/api/catalog/rails
```

### Gate N2-C — Play from API (regression)

```bash
bash scripts/phase-n1/gate-n1-smoke.sh
bash scripts/phase-n0/gate-n0.sh
```

### Gate N2-D — Couch note (manual)

Document in `N2-INVENTORY.md`:

1. D-pad home → poster visible on ≥2 rails  
2. B on title → detail screen  
3. B Play → mpv fullscreen (1080p, audio on monitor headphones)  
4. ⌂ → home &lt; 300 ms  
5. Voice HUD still works  

---

## 10. Failure-mode table

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Missing `catalog.yaml` | empty `/rails` | prereq gate fail; copy example |
| TMDB key missing | bollywood rail empty | gate warns; trending-only waiver |
| Addon catalog timeout | rail spinner forever | per-rail timeout; show error |
| CORS if proxy skipped | launcher fetch fails | must use `/api/catalog/*` |
| Play picks 4K | blue screen | filters unchanged; document in inventory |
| Poster HTTP blocked | broken images | use Cinemeta HTTPS poster URLs only |

---

## 11. Couch acceptance — N2-BROWSE

| # | Test | Pass |
|---|------|------|
| 1 | `gate-n2-browse.sh` | exit 0 |
| 2 | Home shows ≥2 rails with posters | no mocks |
| 3 | Detail → Play | mpv ≤ 15 s TTFF |
| 4 | ⌂ from mpv | launcher restored |
| 5 | `gate-n1-smoke.sh` + `gate-n0.sh` | exit 0 |

---

## 12. Deploy protocol

1. Mac: commit + push `feat/native-experience`  
2. Pi: `cd ~/mango && git pull`  
3. Pi: `sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml` — edit list IDs  
4. Pi: ensure `/etc/mango/tmdb.key` if using TMDB rail  
5. Pi: `cd src/catalog-service && npm ci && npm run build`  
6. Pi: `cd src/launcher && npm ci && npm run build`  
7. Pi: `MANGO_CATALOG=1 bash scripts/mango-stack.sh restart`  
8. Pi: `bash scripts/phase-n2/gate-n2-browse.sh`  

---

## 13. Exit criteria

- [ ] `catalog.yaml` template in repo  
- [ ] `/rails` + `/rails/:id/items` implemented  
- [ ] Launcher proxy + UI with posters + detail + play  
- [ ] `gate-n2-browse.sh` exit 0  
- [ ] N1 + N0 regression pass  
- [ ] `N2-INVENTORY.md` complete  
- [ ] No secrets in git  

---

## 14. Handoff to N3

N3 agent reads:

- `N2-INVENTORY.md` — rail IDs, resolver timings  
- Detail **Play** path — extend to stream picker before mpv  
- `GET /stream` filter meta — surface in picker UI  

First N3 task: **after detail Play, show 2–5 filtered streams; user picks; then mpv**.
