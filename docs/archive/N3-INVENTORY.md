# N3 inventory — play + browse

**Branch:** `feat/native-experience` @ `553c35a`  
**Spec:** [`tasks/phase-n3-stream-orchestrator.md`](tasks/phase-n3-stream-orchestrator.md)  
**Couch checklist:** [`COUCH_TEST.md`](COUCH_TEST.md)

---

## Shipped

### N3a — play orchestrator + ladder ✓

- Shared `play_ladder` in `config/catalog-filters.json` (ideal → last_resort)
- `POST /play` — parallel resolve, probe-then-play, 90s wall, NFO preflight
- Pre-resolve on detail open; couch-safe error copy
- Gates: `gate-n3a-play-ladder.sh`, `gate-n3c-verify-ladder.sh`, `gate-lite-play.sh`

### N3c — playability index ✓

- `playability.db` with verified pools, `win_ladder_step`, paginated ingest cursors (schema v3)
- **Growth jobs:** Quick top-up (~10 min) · Nightly pass (~45 min) · Overnight grow (~4 h)
- **Settings UI** + `GET /playability/refresh/levels` + `GET /playability/refresh/tools` (LLM-ready)
- Scripts: `quick-playability-topup.sh`, `overnight-playability-grow.sh`, `playability-maintenance.sh`
- Defaults: 40 fresh probes/rail (nightly), 15 verified cap/rail, paginated catalog offset
- `gate-n3c-verified-rails.sh` for full per-rail play sweep (`MANGO_GATE_FULL=1`)

### Track B — verified rails UX ✓

- 9-up poster grid, ↻ shuffle (pad `317` + browse bar), L/R tab shoulders
- Thin rails (no filler), empty rails hidden, rate-limit meta blocked in browse
- Settings: grouped refresh levels (Quick · Standard · Overnight)

### N3b — shipped ✓

| Slice | Status |
|-------|--------|
| **C1** stream picker on detail | ✓ `GET /stream` rows with `display_label`; tap to `POST /play { url }` |
| **C2** Continue watching | ✓ `progress.db` + Continue rail; mpv position watcher |
| **N3e** episode picker | ✓ playability hints · gates · cancel-on-Y |
| Stremio library merge (N4) | planned |

### Live TV ✓

Dual/triple NexoTV + **live** tab (sport, news, free) — see [`LIVE_TV.md`](LIVE_TV.md). Excluded from deploy gates.

### Catalog hygiene ✓

- Self-hosted AIOStreams + AIOMetadata only (no ElfHosted in export)
- Meta merge: Cinemeta first; throttled addon error text never shown on posters

---

## Gate strategy (deploy)

| Gate | Role |
|------|------|
| `gate-lite.sh` / `pi-pre-couch-gate.sh` | **Default** — N0 + N3d + N2 browse + unit + 2 plays |
| `MANGO_GATE_FULL=1` | Adds `gate-n3c-verified-rails` + `gate-n3a-play` per-rail sweep |
| `gate-live-iptv.sh` | **Opt-in only** — `MANGO_LIVE_GATE=1` |

```bash
bash scripts/pi-exec-gate.sh              # Mac → Pi gate-lite
bash scripts/pi-deploy.sh --fast --gate     # deploy + gate
```

---

## Playability ops (Pi)

| Job | Settings button | Script |
|-----|-----------------|--------|
| Reshuffle picks | Refresh library | inline reshuffle |
| ~10 min grow | Quick top-up | `quick-playability-topup.sh --detach` |
| ~45 min grow | Nightly pass | `playability-maintenance.sh --mode full` |
| ~4 h loop | Overnight grow | `overnight-playability-grow.sh --detach` |

Status: `python3 scripts/diag/playability-status.py`

---

## Next paths

| Priority | Item | Notes |
|----------|------|-------|
| 1 | **N5b** | AI home catalogs (3 slots) |
| 3 | **N5 prep** | Wire `mango_playability_refresh` LLM tool in orchestrator |
| 4 | **N4** library + write-back | Stremio export import; finished → library sync |
| 5 | **Pool depth** | Quick top-up after couch test; MDBList Standard if ingest stalls |
| 6 | **Live** | Paid cricket / AREA69 depth (opt-in gates) |
| 7 | **N6–N7** | YouTube · 4K TV ship |

---

## Config touchpoints

| File | Purpose |
|------|---------|
| `/etc/mango/catalog-filters.json` | Ladder, quality cap, stream display limit |
| `/etc/mango/playability.db` | Verified pools + ingest cursors |
| `/etc/mango/progress.db` | mpv resume positions |
| `/etc/mango/catalog-live.yaml` | Live sport rails (optional; repo example fallback) |

Deploy sync: `scripts/lib/sync-etc-mango-config.sh` on `pi-deploy.sh`.
