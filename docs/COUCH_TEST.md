# Couch test checklist

**Branch:** `feat/native-experience` · **Pi:** `553c35a`+ · **Gate:** `bash scripts/pi-exec-gate.sh` (gate-lite ~2 min)

Run gate on Mac before handing off to the TV. Live IPTV is opt-in — not in gate-lite.

---

## Automated preflight (agent)

```bash
bash scripts/pi-deploy.sh --fast --gate   # pull, build, gate-lite
python3 scripts/diag/playability-status.py   # on Pi — pool depth
```

---

## Browse & pad (N2 + Track B)

| # | Action | Pass? |
|---|--------|-------|
| 1 | **Movies** tab loads 9-up poster grid (not oversized) | |
| 2 | **L/R shoulders** switch Movies ↔ Series ↔ Live | |
| 3 | **↻ shuffle** (pad `317` or browse bar) — subtle crossfade, new titles | |
| 4 | Reshuffle 5× — no "rate limit exceeded" in titles/descriptions | |
| 5 | **Series** tab — rails populated, focus ring visible | |
| 6 | **Live** tab — sport/news rails (if NexoTV up) | |

---

## Play (N3a + N3b partial)

| # | Action | Pass? |
|---|--------|-------|
| 7 | Pick **movie** → detail → **Play** → mpv starts ≤90s | |
| 8 | **Back/Y** → launcher; **⌂** always returns home | |
| 9 | Pick **series** → detail → stream rows show `display_label` | |
| 10 | Pick alternate stream row → plays selected source | |
| 11 | **Continue** rail — resume from saved position (if entries exist) | |

---

## Settings — library refresh

| # | Action | Pass? |
|---|--------|-------|
| 12 | Settings → **Refresh library** (~5s) — new picks, TV stays on | |
| 13 | **Quick top-up** (~10 min) — starts, TV pauses, restores after | |
| 14 | Status line shows running / busy message (no raw errors) | |

Skip overnight / nightly pass during casual couch test unless intentionally away.

---

## Voice (optional, `MANGO_VOICE=1`)

| # | Action | Pass? |
|---|--------|-------|
| 15 | HUD connects (loopback :8766) | |
| 16 | "Play …" dispatches to catalog (future: `mango_playability_refresh` tool) | |

---

## Known gaps (not blockers for this pass)

- **N3e** episode picker — series detail plays latest / S1E1, no season grid yet
- **N4** Stremio library merge — not wired
- **LLM refresh tool** — API ready (`GET /playability/refresh/tools`), orchestrator wiring next
- **Playability depth** — ~30 verified/rail; run Quick top-up or Overnight grow to deepen pools

---

## If something fails

| Symptom | Check |
|---------|--------|
| Empty rails | `python3 scripts/diag/playability-status.py` · Quick top-up |
| Play timeout | `bash scripts/gate-lite-play.sh` · AIOStreams logs |
| Rate-limit titles | catalog-service meta backoff (should be fixed); MDBList quota |
| Pad wrong button | [`docs/HARDWARE.md`](HARDWARE.md) — shuffle=`317`, tabs L/R=`310`/`311` |
