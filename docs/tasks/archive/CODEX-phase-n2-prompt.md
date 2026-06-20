# Codex prompt — Phase N2 browse UI

**Last updated:** 2026-06-19 · N1 shipped · **5 rails / 2 sources** locked for N2

Copy everything below into Codex as the task prompt.

---

## Prompt

You are a **senior TV-box platform engineer** (embedded Linux, Stremio addon protocol, TV UI, SRE gates). Execute **Phase N2 — Real browse UI** for the **mango** repo end-to-end, including **on-device validation on the Raspberry Pi**.

### Pi state (N1 complete — build on this)

| Item | Status |
|------|--------|
| Branch | `feat/native-experience` |
| `gate-n0.sh` + `gate-n1-smoke.sh` | **PASS** |
| `catalog-service` | `:3020` · meta/stream/play + **stream filters** |
| Stream filters | `/etc/mango/catalog-filters.json` (1080p lab cap, exclude uncached debrid) |
| Couch play | `POST /play` → mpv · 1080p cached · audio via **monitor 3.5 mm** |
| Launcher | Empty catalog placeholder — **you replace this** |
| Dev lab | 1080p monitor · no soundbar · 4K TV at **N7** |

**Do not** redo N1 spikes unless regression fails.

### Think before you code (mandatory)

Spend the **first 20% of effort** writing **`docs/N2-INVENTORY.md` §Plan** before feature code. Include:

1. Rails chosen — **5 from 2 sources** (3× AIOMetadata + 2× Cinemeta; see `catalog.example.yaml`)  
2. Proxy strategy (`serve.py` `/api/catalog/*` → `:3020`)  
3. Launcher navigation: home → detail → play  
4. Risks: addon catalog latency, lazy-load if needed, poster load on Pi Chromium  
5. **Deferred post-N2:** all ~31 AIOMetadata catalogs, `tmdb_list`, catalog management UI  

### Read first (in order)

1. **Task spec (binding):** [`docs/tasks/phase-n2-browse-ui.md`](docs/tasks/phase-n2-browse-ui.md)
2. **N1 baseline:** [`docs/N1-INVENTORY.md`](docs/N1-INVENTORY.md)
3. **Roadmap:** [`docs/NATIVE_ROADMAP.md`](docs/NATIVE_ROADMAP.md) § N2
4. **Product:** [`docs/NATIVE_EXPERIENCE.md`](docs/NATIVE_EXPERIENCE.md)
5. **Hardware lab:** [`docs/HARDWARE.md`](docs/HARDWARE.md)
6. **Foreground:** [`docs/FOREGROUND.md`](docs/FOREGROUND.md)
7. **Launcher today:** `src/launcher/src/home.ts` · `main.ts` · `src/mango-ui-server/serve.py`
8. **catalog-service:** `src/catalog-service/src/core.ts` · `index.ts`

Apply **`$mango-tv-box-expert`** + **`$ux-design-expert`**: legit posters, 10ft focus, sub-300 ms home, git-only deploy, automated gate before human handoff.

### Branch & environment

- Work on **`feat/native-experience`** only.
- Pi: SSH **`mango`** → `aman@10.0.0.174`, repo **`~/mango`**.
- **Never rsync.** Commit + push; `git pull` on Pi.
- Secrets: `/etc/mango/catalog.yaml` (user copy from example) — **never commit**.

### Your mission

**N2 = 5 browse rails (2 addon sources) + detail + play.** No stream picker (N3). No mock posters. No full 31-catalog import yet.

| Build | Do not build |
|-------|----------------|
| `config/catalog.example.yaml` (5 rails) | All ~31 AIOMetadata auto-import (post-N2) |
| `GET /rails` + `/rails/:id/items` | `tmdb_list` resolver (post-N2) |
| `serve.py` catalog proxy | Stream picker UI (N3) |
| Launcher poster rails + detail + Play | `progress.db` (N3) |
| `gate-n2-browse.sh` | 4K tuning (N7) |
| N1+N0 regression | Stremio desktop for gate pass |

### Implementation sequence

```
1. PLAN — docs/N2-INVENTORY.md §Plan
2. YAML — config/catalog.example.yaml
3. SERVICE — catalog-service rails resolver + endpoints
4. PROXY — serve.py /api/catalog/*
5. UI — launcher fetch, home rails, detail view, POST play
6. BUILD — catalog-service + launcher dist on Pi
7. GATE — gate-n2-browse.sh + gate-n1-smoke.sh + gate-n0.sh
8. INVENTORY — complete N2-INVENTORY.md couch note
```

### Deliverables (all required)

Implement spec **§8 Deliverables D1–D6**.

**Locked rails on Pi** (from `config/catalog.example.yaml`):

| ID | Source |
|----|--------|
| `trending-india` | AIOMetadata · trending movies in India |
| `popular-india` | AIOMetadata · popular Indian movies |
| `recommended-india` | AIOMetadata · recommended Indian movies |
| `popular-global` | Cinemeta · `top` |
| `featured-global` | Cinemeta · `imdbRating` |

Gate must hit **at least one AIOMetadata + one Cinemeta** rail with ≥3 posters each.

**Launcher:**

- Remove “browse rails ship in N2” empty state from production path  
- Poster cards with focus ring; detail with Play → `/api/catalog/play`  

**Gates:**

- `scripts/phase-n2/check-n2-prereqs.sh`  
- `scripts/phase-n2/gate-n2-browse.sh`  

### Hard rules

- **No mock poster URLs** in production path.
- **No direct browser fetch to :3020** — proxy via `:3000/api/catalog/*`.
- **Play only through mpv** — reuse existing `POST /play` + filters.
- **Do not change gamepad evdev codes** (B=304, Y=308, ⌂=316/311).
- **Do not relax stream filters** for N2 gate.
- **No secrets in git.**
- `set -euo pipefail` on new bash scripts.

### Gate thresholds

| Check | Pass |
|-------|------|
| `check-n2-prereqs.sh` | exit 0 |
| `GET :3020/rails` | ≥5 rails |
| `GET :3020/rails/trending-india/items` | ≥3 items with poster URLs |
| `GET :3020/rails/popular-global/items` | ≥3 items (Cinemeta source) |
| `GET :3000/api/catalog/rails` | proxies OK |
| Launcher `dist/` rebuilt | poster rail in built assets |
| `gate-n1-smoke.sh` | exit 0 |
| `gate-n0.sh` | exit 0 |
| `gate-n2-browse.sh` | exit 0 |

### When done

Post a **handoff report**:

1. Rails configured + item counts  
2. Resolver timings (ms) per rail  
3. Gate summaries (N2, N1, N0)  
4. Files added/changed  
5. Couch note status (manual steps for user)  
6. **"Ready for N3"** or **"Blocked on …"**

Do not ask clarifying questions unless **blocked** — document choices in `N2-INVENTORY.md`.

### Starter command block (Pi)

```bash
cd ~/mango && git fetch && git checkout feat/native-experience && git pull
bash scripts/phase-n1/gate-n1-smoke.sh
sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml   # edit on Pi
cd src/catalog-service && npm ci && npm run build
cd src/launcher && npm ci && npm run build
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n2/gate-n2-browse.sh
bash scripts/phase-n0/gate-n0.sh
```

---

## Short paste (minimal)

```
Execute mango Phase N2 per docs/tasks/phase-n2-browse-ui.md on feat/native-experience.

N1 DONE. N2: **5 rails** (3 AIOMetadata + 2 Cinemeta), NOT all 31 yet. catalog.yaml + /rails API + serve proxy + launcher UI + gate-n2-browse.sh. Post-N2: full catalog management.

Read docs/tasks/CODEX-phase-n2-prompt.md for full binding spec.
```
