# Codex prompt — Phase N3a stream play orchestrator

**Last updated:** 2026-06-19 · N2 shipped · **orchestrator only** — no picker UI

Copy everything below into Codex as the task prompt.

---

## Prompt

You are a **senior TV-box platform engineer** (embedded Linux, Stremio addon protocol, mpv, SRE gates). Execute **Phase N3a — Stream play orchestrator** for the **mango** repo end-to-end, including **on-device validation on the Raspberry Pi**.

### Pi state (N2 complete — build on this)

| Item | Status |
|------|--------|
| Branch | `feat/native-experience` |
| `gate-n0.sh` + `gate-n1-smoke.sh` + `gate-n2-browse.sh` | **PASS** (verify on pull) |
| `catalog-service` | `:3020` · rails/meta/stream/play + stream filters |
| Browse UI | 5 poster rails · detail · Play → `POST /play` |
| Stream pain | Slow resolve (~8 s) · dead first pick · *download pending* / *removed files* |
| Dev lab | 1080p monitor · headphones via monitor 3.5 mm · 4K at **N7** |

**Do not** redo N2 browse UI unless regression fails.

### Think before you code (mandatory)

Spend the **first 20% of effort** writing **`docs/N3-INVENTORY.md` §Plan** before feature code. Include:

1. Root cause summary (single-shot play, unknown Torrentio cache, sequential resolve)  
2. Orchestrator design (budget, probe, tiers, cache)  
3. Pre-resolve on detail open  
4. Gate strategy — **browse pick from `trending-india`, not Shawshank-only**  
5. **Deferred N3b:** stream picker UI, `progress.db`, Stremio fallback  

### Read first (in order)

1. **Task spec (binding):** [`docs/tasks/phase-n3-stream-orchestrator.md`](docs/tasks/phase-n3-stream-orchestrator.md)
2. **N2 baseline:** [`docs/N2-INVENTORY.md`](docs/N2-INVENTORY.md)
3. **N1 play metrics:** [`docs/N1-INVENTORY.md`](docs/N1-INVENTORY.md)
4. **Product:** [`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md) — § browse→play, 5 s target, auto-try next
5. **Hardware lab:** [`docs/HARDWARE.md`](docs/HARDWARE.md)
6. **Code today:** `src/catalog-service/src/core.ts` · `index.ts` · `stream-filters.ts` · `mpv.ts`
7. **Launcher:** `src/launcher/src/detail.ts` · `catalog.ts`
8. **mpv:** `scripts/phase-n1/mpv-play.sh` · `mpv-ipc.sh`

Apply **`$mango-tv-box-expert`**: 15 s wall budget, silent failures, cached AIOStreams first, git-only deploy, automated gate before human handoff.

### Branch & environment

- Work on **`feat/native-experience`** only.
- Pi: SSH **`mango`** → `aman@10.0.0.174`, repo **`~/mango`**.
- **Never rsync.** Commit + push; `git pull` on Pi.
- Secrets stay in `/etc/mango/` — **never commit**.

### Your mission

**N3a = reliable Play from browse** — orchestrator + filters + pre-resolve + gates. **No stream picker UI.**

| Build | Do not build |
|-------|----------------|
| `play-orchestrator.ts` + wired `POST /play` | Stream picker rows on detail (N3b) |
| Parallel stream resolve + in-memory cache | `progress.db` (N3b) |
| Filter tiers + `strict_unknown_cache: true` in example | Stremio desktop fallback launch (N7) |
| `mpv-play.sh --probe` | Settings UI for `include_uncached` |
| Launcher prefetch + friendly spinner copy | 4K / REMUX relaxation |
| `gate-n3-play.sh` (browse pick!) | Change gamepad evdev codes |
| N2+N1+N0 regression in gate | Mock streams / fake play |

### Implementation sequence

```
1. PLAN — docs/N3-INVENTORY.md §Plan
2. FILTERS — config/catalog-filters.example.json + stream-filters tier support
3. CORE — parallel resolve, stream cache, tier-ranked candidates
4. ORCHESTRATOR — play-orchestrator.ts, mpv probe loop, 15s wall budget
5. MPV — mpv-play.sh --probe --timeout-ms
6. API — index.ts handlePlay uses orchestrator; extend JSON response
7. LAUNCHER — prefetch on detail open; remove error strings from status line
8. BUILD — catalog-service + launcher dist on Pi
9. GATE — check-n3-prereqs.sh + gate-n3-play.sh + N2/N1/N0 regression
10. INVENTORY — metrics, couch note, handoff report
```

### Deliverables (all required)

Implement spec **§8 Deliverables D1–D11**.

#### Orchestrator (binding)

- **Wall budget:** 15 000 ms total per `POST /play`  
- **Per-URL probe:** ≤ 4 000 ms (`mpv-play.sh --probe`)  
- **Max attempts:** 5  
- **Tier 1 auto-play:** `AIOStreams | ElfHosted` + `cache_status === cached` only  
- **Tier 2:** same addon, `cached_or_unknown` (still respect `strict_unknown_cache`)  
- **Torrentio:** excluded from auto-play tiers (picker later)  
- On success: return `ok`, `ttff_ms`, `total_ms`, `attempts` count, `stream` meta  
- On failure: HTTP 502 — launcher shows generic message only  

#### Parallel resolve

- `Promise.allSettled` across stream addons (not sequential `for`)  
- Resolve budget default 5 s (`MANGO_STREAM_RESOLVE_BUDGET_MS`)  
- Cache `GET /stream` results 10 min in memory  

#### Launcher

- On detail `show()`: fire `GET /api/catalog/stream/:type/:id` (prefetch)  
- Status lines: `finding stream…` / `starting…` / `playing…` — **never** `could not play: HTTP 502`  

#### Gates

- `scripts/phase-n3/check-n3-prereqs.sh`  
- `scripts/phase-n3/gate-n3-play.sh`  

**Critical gate rule:** pick a **random** title from `GET /rails/trending-india/items` (exclude `tt0111161`), then `POST /play`. Must reach mpv `playback-time > 0` with `total_ms ≤ 15000`. Also run Shawshank `tt0111161` as regression inside gate.

### Hard rules

- **No stream picker UI** in this phase.
- **No error strings** to couch users from API failures.
- **Play only through mpv** — probe may start/stop mpv; winning URL does full play.
- **Do not relax** `max_quality` or `exclude_remux` for gate pass.
- **Do not change gamepad evdev codes** (B=304, Y=308, ⌂=316/311).
- **No secrets in git.**
- `set -euo pipefail` on new bash scripts.
- Unit tests for `play-orchestrator` / tier filter logic encouraged (pure TS).

### Gate thresholds

| Check | Pass |
|-------|------|
| `check-n3-prereqs.sh` | exit 0 |
| `mpv-play.sh --probe` | exists; probe smoke on short HTTPS MP4 |
| Browse pick `POST /play` | `ok: true`, `total_ms ≤ 15000`, mpv playing |
| Shawshank `POST /play` | regression ok |
| `gate-n2-browse.sh` | exit 0 |
| `gate-n1-smoke.sh` | exit 0 |
| `gate-n0.sh` | exit 0 |
| `gate-n3-play.sh` | exit 0 |

### When done

Post a **handoff report**:

1. Browse pick title used in gate (name + id)  
2. `total_ms`, `ttff_ms`, `attempts` for browse pick + Shawshank  
3. Filter exclusion counts (uncached / unknown)  
4. Gate summaries (N3, N2, N1, N0)  
5. Files added/changed  
6. Couch note — **3 manual plays** checklist for user  
7. **"Ready for N3b picker"** or **"Blocked on …"**

Do not ask clarifying questions unless **blocked** — document choices in `N3-INVENTORY.md`.

### Starter command block (Pi)

```bash
cd ~/mango && git fetch && git checkout feat/native-experience && git pull
bash scripts/phase-n2/gate-n2-browse.sh
cd src/catalog-service && npm ci && npm run build
cd src/launcher && npm ci && npm run build
# optional if sudo works:
sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3/gate-n3-play.sh
bash scripts/phase-n0/gate-n0.sh
```

---

## Short paste (minimal)

```
Execute mango Phase N3a per docs/tasks/phase-n3-stream-orchestrator.md on feat/native-experience.

N2 DONE. N3a: stream play orchestrator — retry loop, 15s budget, AIOStreams cached tiers, parallel resolve, detail prefetch, mpv --probe, gate-n3-play.sh on RANDOM trending-india title (not Shawshank-only). NO picker UI. NO progress.db.

Read docs/tasks/CODEX-phase-n3-prompt.md for full binding spec.
```
