# Phase N3a — Stream play orchestrator

**Status:** Not started  
**Branch:** `feat/native-experience`  
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md) § N3  
**Codex prompt:** [`CODEX-phase-n3-prompt.md`](CODEX-phase-n3-prompt.md)  
**Prerequisite:** N2 gate passes (`bash scripts/phase-n2/gate-n2-browse.sh` exit 0) · browse rails on Pi · [`N2-INVENTORY.md`](../N2-INVENTORY.md)

**N3 split:** This spec is **N3a** (orchestrator backend + launcher copy + gates). **N3b** (stream picker UI + `progress.db`) is a follow-up Codex run after couch verifies N3a.

---

## 1. Objective

Make **browse → detail → Play** reliable on the couch:

- **≤15 s** from Play press to mpv first frame (wall clock)
- **No error strings** on the launcher status line — spinner copy only
- **Auto-try** ranked streams when the first URL is dead, uncached, or slow
- **Prefer cached AIOStreams** streams; do not auto-play unknown Torrentio debrid

N1 proved one smoke title (`tt0111161`). N2 proved browse UI. **N3a proves play works on arbitrary browse picks** — not only Shawshank.

### Success definition

| Artifact | Requirement |
|----------|-------------|
| `play-orchestrator` | Try top N streams within 15 s budget; per-URL probe ≤4 s |
| `core.streams` | Parallel addon fetch; in-memory stream cache (TTL) |
| Stream filters | `strict_unknown_cache: true` default; AIOStreams-first tiers |
| `mpv-play.sh` | `--probe` mode for fast TTFF check per attempt |
| Launcher | Pre-resolve on detail open; friendly spinner only |
| Gate | `bash scripts/phase-n3c/gate-n3c-verified-rails.sh` exit 0 |
| N2+N1+N0 regression | All prior gates still pass |
| `docs/N3-INVENTORY.md` | Plan, metrics, couch note |

### Dev lab context

1080p monitor · headphones via monitor 3.5 mm · `max_quality: 1080p` · no 4K until N7 ([`HARDWARE.md`](../HARDWARE.md)).

---

## 2. Non-goals (N3a — defer to N3b / N4 / N7)

| Out of scope | Phase |
|--------------|-------|
| Stream picker UI (2–5 rows on detail) | N3b |
| `progress.db` / resume | N3b / N4 |
| Hidden Stremio desktop fallback launch | N7 |
| `include_uncached` Settings toggle | N3b |
| Search UI | Later |
| 4K / REMUX relaxation | N7 |
| Change gamepad evdev codes | Never |
| In-browser `<video>` | Never |

---

## 3. Problem statement (why N3a exists)

Current `POST /play` path ([`src/catalog-service/src/index.ts`](../../src/catalog-service/src/index.ts)):

1. Resolves streams **sequentially** across addons (~8 s on N1).
2. Picks **`streams[0]`** only — no retry on dead URL.
3. **`strict_unknown_cache: false`** lets Torrentio RD/TB through with `cache_status: unknown` → *download pending* / *removed files* in mpv.
4. Resolve happens **at Play**, not when detail opens.
5. Launcher shows **`could not play: …`** to the user.

---

## 4. Design principles (binding)

Apply **`$mango-tv-box-expert`**:

| Principle | N3a meaning |
|-----------|-------------|
| **Never single-shot play** | ExoPlayer-style fallback: try next URL on load failure |
| **Filter before try** | Auto-play tier 1 = AIOStreams + `cached` only |
| **Pre-resolve** | Warm stream list when detail opens (target ≤5 s before Play) |
| **15 s wall budget** | Total Play → first frame; not 15 s per URL |
| **Silent failure** | Log errors server-side; launcher shows spinner states only |
| **Chromium = UI only** | mpv remains sole player |
| **Git-only Pi deploy** | Commit + push; `git pull` on Pi |

---

## 5. Stream filter contract

**Repo template:** `config/catalog-filters.example.json`  
**Pi path:** `/etc/mango/catalog-filters.json`

### N3a default changes

```json
{
  "exclude_uncached_debrid": true,
  "strict_unknown_cache": true,
  "max_quality": "1080p",
  "exclude_remux": true,
  "auto_play_max_attempts": 5,
  "auto_play_wall_ms": 15000,
  "auto_play_probe_ms": 4000,
  "auto_play_tiers": [
    {
      "addons": ["AIOStreams | ElfHosted"],
      "require_cache": "cached"
    },
    {
      "addons": ["AIOStreams | ElfHosted"],
      "require_cache": "cached_or_unknown"
    }
  ]
}
```

| Field | Default | Meaning |
|-------|---------|---------|
| `strict_unknown_cache` | `true` | Drop debrid streams without AIOStreams `bingeGroup` cache hint |
| `auto_play_max_attempts` | `5` | Max URLs to probe per Play |
| `auto_play_wall_ms` | `15000` | Hard stop for orchestrator |
| `auto_play_probe_ms` | `4000` | Per-URL mpv probe timeout |
| `auto_play_tiers` | see above | Ordered tiers; flatten to candidate list |

**Addon name matching:** reuse existing fuzzy match in `core.ts` (`AIOMetadata  | ElfHosted` spacing variants).

**Torrentio** streams are **not** in default auto-play tiers. They may appear in `GET /stream` for N3b picker — not auto-play in N3a.

Existing query/body overrides (`include_uncached`, etc.) must still work for API callers.

---

## 6. catalog-service architecture

### 6.1 New module: `play-orchestrator.ts`

```typescript
playWithFallback(
  streams: Stream[],
  config: PlayOrchestratorConfig,
): Promise<PlayOrchestratorResult>
```

| Field | Type | Notes |
|-------|------|-------|
| `ok` | boolean | true if mpv reached `playback-time > 0` |
| `ttff_ms` | number | First frame on winning attempt |
| `total_ms` | number | Wall clock from orchestrator start |
| `attempts` | array | `{ index, source, cache_status, ok, ms, error? }` — **no raw URLs in logs to launcher** |
| `stream` | object | Winning stream metadata |
| `filters` | object | Filter meta from resolve |

**Algorithm:**

```
1. Apply tier filter → ranked candidate URLs (max auto_play_max_attempts)
2. deadline = now + auto_play_wall_ms
3. for each candidate while now < deadline:
     probe = mpv-play.sh --url URL --probe --timeout-ms auto_play_probe_ms
     if probe.ok → return success
     else record attempt, continue
4. if all failed → throw CatalogError(502, 'no playable stream within budget')
   (launcher maps to spinner message, not raw error — see §7)
```

### 6.2 `core.streams` — parallel resolve

Replace sequential `for` loop with `Promise.allSettled` per stream addon. Merge results; preserve `resolve_ms` in response.

**Timeout:** cap total resolve at **5 s** for orchestrator path (env `MANGO_STREAM_RESOLVE_BUDGET_MS` default 5000). Return partial results if budget exceeded — do not fail entire resolve.

### 6.3 Stream cache

In-process `Map<string, { streams, filters, expiresAt }>` keyed by `{type}:{id}`.

| Trigger | Action |
|---------|--------|
| `GET /stream/:type/:id` | Resolve (or cache hit); store TTL **10 min** |
| Detail pre-resolve (launcher) | Same as GET |
| `POST /play` | Use cache if fresh; else resolve |

Expose optional `resolve_ms` and `cached: true|false` on responses.

### 6.4 `POST /play` handler

Replace single-shot `streams[0]` + `playUrl` with `playWithFallback`.

Response shape (extend existing):

```json
{
  "ok": true,
  "ttff_ms": 4200,
  "total_ms": 8900,
  "attempts": 2,
  "stream": { "source": "AIOStreams | ElfHosted", "quality": "1080p", "cache_status": "cached" },
  "filters": { "kept": 12, "excluded": { "uncached_debrid": 8 } }
}
```

On failure: HTTP 502 with `{ "error": "no_playable_stream", "attempts": [...] }` — launcher must **not** display `error` text.

### 6.5 `mpv-play.sh` probe mode

Add flags:

```bash
mpv-play.sh --url <url> --probe [--timeout-ms 4000]
```

- Starts mpv, polls `playback-time > 0` via existing IPC
- On success: print `PASS: ttff_ms=N`, exit 0, **stop mpv** (probe only)
- On timeout: exit 1
- Full play (no `--probe`): existing behavior for winning URL after probe loop — or orchestrator calls full play once probe succeeds

**Recommended:** probe stops mpv; orchestrator then calls full `playUrl` on winner (avoids double-start complexity). Gate measures **total** `POST /play` wall time.

### 6.6 Pi hwdec (lab)

Probe and full play on Pi lab should use `--hwdec=v4l2m2m-copy` when `MANGO_MPV_HWDEC` unset and Pi detected — or document in inventory if left as env override. **Do not** regress N1 gate on Shawshank.

---

## 7. Launcher changes

### 7.1 Pre-resolve on detail open

In `detail.ts` `show()`:

```typescript
void prefetchStreams(card);  // GET /api/catalog/stream/:type/:id — fire-and-forget
```

Add `prefetchStreams` in `catalog.ts`. Ignore errors silently (log to console only).

### 7.2 Status copy (no errors)

| State | Status line |
|-------|-------------|
| Detail open | `B to play. Y to go back.` |
| Play pressed | `finding stream…` |
| mpv starting | `starting…` |
| Success | `playing · 1080p. ⌂ returns home.` |
| Failure | `couldn't start playback. try another title.` — **never** API/mpv stderr |

Remove `could not play: ${message}` pattern from [`detail.ts`](../../src/launcher/src/detail.ts).

### 7.3 No picker UI

Play button still calls `POST /api/catalog/play` with `{ type, id }` only.

---

## 8. Deliverables

| ID | Deliverable |
|----|-------------|
| D1 | `src/catalog-service/src/play-orchestrator.ts` |
| D2 | `core.ts` — parallel resolve + stream cache |
| D3 | `stream-filters.ts` — tier support + `strict_unknown_cache` default true in example |
| D4 | `config/catalog-filters.example.json` — N3a fields |
| D5 | `index.ts` — wired `playWithFallback` |
| D6 | `scripts/phase-n1/mpv-play.sh` — `--probe` mode |
| D7 | `src/launcher/src/catalog.ts` + `detail.ts` — prefetch + copy |
| D8 | `scripts/phase-n3c/gate-n3c-verified-rails.sh` |
| D9 | `scripts/phase-n3/gate-n3c-verified-rails.sh` |
| D10 | `docs/N3-INVENTORY.md` — plan + metrics + couch note |
| D11 | `scripts/pi-pre-couch-gate.sh` — run N3 gate when catalog on (optional but preferred) |

---

## 9. Validation gates

### Gate N3-A — Prereqs

```bash
bash scripts/phase-n3c/gate-n3c-verified-rails.sh
```

| Check | Pass |
|-------|------|
| `catalog-filters.example.json` has N3a fields | yes |
| `catalog-service` dist built | yes |
| `play-orchestrator` in dist | yes |
| `mpv-play.sh --probe` exists | yes |

### Gate N3-B — Play orchestrator (critical)

```bash
bash scripts/phase-n3c/gate-n3c-verified-rails.sh
```

| Check | Pass |
|-------|------|
| **Browse pick** | Random title from `GET /rails/trending-india/items` (not `tt0111161`) |
| `POST /play` | `ok: true` |
| `total_ms` | ≤ **15000** |
| `ttff_ms` | > 0 |
| `attempts` | ≤ 5 |
| mpv | `playback-time > 0` after play |
| Shawshank regression | `POST /play` `tt0111161` still ok (can be separate step in gate) |
| `gate-n2-browse.sh` | exit 0 |
| `gate-n1-smoke.sh` | exit 0 |
| `gate-n0.sh` | exit 0 |

**Waiver policy:** no waivers for browse-pick play. If `trending-india` title fails after 5 attempts, gate **fails** — document in inventory, do not ship.

### Gate N3-C — Couch note (manual)

Document in `N3-INVENTORY.md`:

1. Home → trending title → detail (spinner absent or brief)  
2. B Play → picture + audio ≤15 s  
3. No error text on status line  
4. ⌂ → home < 1 s  
5. Second title from different rail — repeat  

---

## 10. Failure-mode table

| Failure | Symptom | Mitigation |
|---------|---------|------------|
| Uncached RD | download pending in mpv | `strict_unknown_cache` + AIOStreams tier 1 |
| Dead torrent | removed files | try next URL in orchestrator |
| First stream 4K REMUX | blue screen | `exclude_remux` + `max_quality: 1080p` (unchanged) |
| Resolve slow | long spinner | parallel fetch + pre-resolve on detail |
| All streams fail | user sees generic message | N3a copy; N7 Stremio fallback |
| Probe passes, full play fails | rare | orchestrator retries next candidate |
| Gate only tests Shawshank | false confidence | gate **must** use browse pick |

---

## 11. Couch acceptance — N3-PLAY

| # | Test | Pass |
|---|------|------|
| 1 | `gate-n3c-verified-rails.sh` | exit 0 |
| 2 | Browse pick A → Play | ≤15 s, picture + audio |
| 3 | Browse pick B (different rail) | ≤15 s |
| 4 | No API error on status line | generic message only on total fail |
| 5 | `gate-n2` + `gate-n1` + `gate-n0` | exit 0 |

---

## 12. Deploy protocol

```bash
cd ~/mango && git pull
cd src/catalog-service && npm ci && npm run build
cd src/launcher && npm ci && npm run build
# filters — mango-stack may use repo example if /etc differs
sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json  # if sudo available
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3c/gate-n3c-verified-rails.sh
```

---

## 13. Handoff to N3b

After N3a couch sign-off:

- Stream picker UI on detail (2–5 filtered streams)  
- `progress.db` + Continue rail  
- Optional Torrentio tier in picker (not auto-play)
