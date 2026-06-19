# N3 inventory — stream play orchestrator (N3a)

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n3/gate-n3-play.sh`  
**Spec:** [`tasks/phase-n3-stream-orchestrator.md`](tasks/phase-n3-stream-orchestrator.md)

---

## Plan

**Locked scope:** orchestrator backend · filter tiers · pre-resolve · launcher copy · gates. **No picker UI** (N3b).

### Root cause

N2 browse now reaches real titles, but the current Play path is still an N1
single-title spike: `POST /play` resolves stream addons at button press, waits
through them sequentially, picks `streams[0]`, and calls mpv once. That makes
arbitrary browse picks fragile because the first stream can be uncached,
unknown-cache Torrentio, removed, too slow, or a 4K/REMUX format outside the
1080p lab profile. N1 measured stream resolve around 8 s, so sequential resolve
plus no retry burns most of the couch budget before mpv even proves a frame.

### Orchestrator design

N3a makes Play an mpv-backed retry loop with a hard 15 s wall budget. Stream
resolution runs in parallel across stream addons, stores a 10 min in-memory
cache keyed by `{type}:{id}`, and keeps the existing quality/remux/debrid
filters. Auto-play candidates are tiered after filtering:

1. `AIOStreams | ElfHosted` with `cache_status === cached`
2. `AIOStreams | ElfHosted` with `cached_or_unknown`, still honoring
   `strict_unknown_cache`

Torrentio is intentionally excluded from default auto-play tiers; it can remain
visible to future picker work but must not drive N3a autoplay. The orchestrator
probes each candidate with `mpv-play.sh --probe --timeout-ms 4000`, records
redacted attempt metadata, then starts full mpv playback only for a candidate
that reaches `playback-time > 0`. It stops after 5 attempts or 15 s total.

### Pre-resolve

Detail open fires `GET /api/catalog/stream/:type/:id` in the background. The
launcher ignores prefetch errors and keeps detail focused; the cache warms the
same backend path used by `POST /play`. Status copy stays couch-safe:
`finding stream…`, `starting…`, `playing…`, or a generic failure only.

### Gate strategy

`gate-n3-play.sh` must pick a random item from
`GET /rails/trending-india/items`, excluding `tt0111161`, then `POST /play`
that browse title and verify `ok`, `total_ms <= 15000`, attempts `<=5`, and mpv
`playback-time > 0`. Shawshank remains a regression inside the gate, not the
only proof. The N3 gate also runs N2/N1/N0 regression before handoff.

### Deferred N3b

Stream picker UI, `progress.db`, resume/Continue, Settings toggles for
uncached streams, and hidden Stremio fallback stay out of N3a. If all N3a
autoplay candidates fail, the launcher shows a generic message and the
inventory records the failure rather than relaxing filters or adding fallback
UI.

---

## Metrics (after N3a)

| Metric | Value |
|--------|-------|
| `gate-n3-play.sh` | |
| Browse pick (gate title) | |
| Browse pick `total_ms` | |
| Browse pick `attempts` | |
| Shawshank regression `total_ms` | |
| Filter exclusions (uncached / unknown) | |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N3-C1 couch note (manual)

**Lab:** 1080p monitor · headphones via monitor 3.5 mm.

- [ ] Title A (browse rail) → Play ≤15 s, picture + audio
- [ ] Title B (different rail) → Play ≤15 s
- [ ] No API error text on status line
- [ ] ⌂ → home < 1 s after play
- [ ] Voice HUD regression (N0 gate)

---

## Handoff to N3b

After N3a couch sign-off:

- Stream picker UI (2–5 options on detail)  
- `progress.db` + Continue rail  
- Optional Torrentio in picker (not auto-play)
