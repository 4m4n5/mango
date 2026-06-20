# N3 inventory — play + browse

**Branch:** `feat/native-experience`  
**Spec:** [`tasks/phase-n3-stream-orchestrator.md`](tasks/phase-n3-stream-orchestrator.md)

---

## Shipped

### N3a — play orchestrator + ladder ✓

- Shared `play_ladder` in `config/catalog-filters.json` (ideal → last_resort)
- `POST /play` — parallel resolve, probe-then-play, 90s wall, NFO preflight
- Pre-resolve on detail open; couch-safe error copy
- Gates: `gate-n3a-play-ladder.sh`, `gate-n3c-verify-ladder.sh`, `gate-lite-play.sh`

### N3c — playability index ✓

- `playability.db` with verified pools, `win_ladder_step`, maintenance timer
- `gate-n3c-verified-rails.sh` for full per-rail play sweep (`MANGO_GATE_FULL=1`)

### Track B — verified rails UX ✓

- Thin rails (no filler), empty rails hidden, ↻ library refresh reshuffles verified pool
- Settings: library refresh levels + time estimates

### N3b — partial ✓

| Slice | Status |
|-------|--------|
| **C1** stream picker on detail | ✓ `GET /stream` rows with `display_label`; tap to `POST /play { url }` |
| **C2** Continue watching | ✓ `progress.db` + Continue rail; mpv position watcher |
| Episode picker (N3e) | design / next |
| Stremio library merge (N4) | planned |

### Live TV ✓

Dual NexoTV + **live** tab — see [`LIVE_TV.md`](LIVE_TV.md). Excluded from deploy gates.

---

## Gate strategy (deploy)

| Gate | Role |
|------|------|
| `gate-lite.sh` / `pi-pre-couch-gate.sh` | **Default** — N0 + N3d (if enabled) + N2 browse + unit + 2 plays |
| `MANGO_GATE_FULL=1` | Adds `gate-n3c-verified-rails` + `gate-n3a-play` per-rail sweep |
| `gate-live-iptv.sh` | **Opt-in only** — `MANGO_LIVE_GATE=1` |

---

## Next paths

| Priority | Item | Notes |
|----------|------|-------|
| 1 | **N3e** series episode picker | Detail → season/episode grid; gate in `tasks/` |
| 2 | **N3b polish** | Picker UX (focus, labels), cancel during long resolve |
| 3 | **N4** library + write-back | Stremio export import; finished → library sync |
| 4 | **Live** paid cricket | AREA69 catalog depth / genre fetch |
| 5 | **N5–N7** | AI catalogs · YouTube · 4K TV ship |

---

## Config touchpoints

| File | Purpose |
|------|---------|
| `/etc/mango/catalog-filters.json` | Ladder, quality cap, stream display limit |
| `/etc/mango/playability.db` | Verified pools |
| `/etc/mango/progress.db` | mpv resume positions |
| `/etc/mango/catalog-live.yaml` | Live sport rails (optional; repo example fallback) |

Deploy sync: `scripts/lib/sync-etc-mango-config.sh` on `pi-deploy.sh`.
