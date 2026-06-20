# Couch test checklist

**Branch:** `feat/native-experience` · **Gate:** `bash scripts/pi-exec-gate.sh` (gate-lite ~2 min)

Run gate on Mac before handing off to the TV. Live IPTV is opt-in — not in gate-lite.

---

## Automated preflight (agent)

```bash
bash scripts/pi-deploy.sh --fast --gate   # pull, build, gate-lite
bash scripts/diag/series-episodes.sh --sample   # on Pi — episode meta + stream probes
python3 scripts/diag/playability-status.py   # pool depth
```

---

## Browse & pad (N2 + Track B)

| # | Action | Pass? |
|---|--------|-------|
| 1 | **Movies** tab loads 9-up poster grid | |
| 2 | **L/R shoulders** switch Movies ↔ Series ↔ Live | |
| 3 | **↻ shuffle** (pad `317`) — new titles, no rate-limit text | |
| 4 | **Series** tab — rails populated | |

---

## Series episode picker (N3e)

| # | Action | Pass? |
|---|--------|-------|
| 5 | Open **Panchayat** (or Breaking Bad) → episode list below actions | |
| 6 | D-pad **down** into list — **streams strip updates** per focused episode | |
| 7 | Focus **Season 2** header → **B** jumps to first S2 episode | |
| 8 | Grey rows (no streams) are **skipped** by D-pad | |
| 9 | **Play / Resume** starts mpv; **Y** returns to detail | |
| 10 | Watch **≥50%** → **Y** → **next episode** overlay; **B** plays next, **Y** dismisses | |

---

## Play (N3a)

| # | Action | Pass? |
|---|--------|-------|
| 11 | Movie → detail → **Play** → mpv ≤90s | |
| 12 | **Continue** rail resumes if entries exist | |
| 13 | **⌂** always returns home | |

---

## Settings (optional)

| # | Action | Pass? |
|---|--------|-------|
| 14 | **Refresh library** (~5s reshuffle) | |

---

## If something fails

| Symptom | Check |
|---------|--------|
| Empty episode list | `curl localhost:3020/series/tt12004706/episodes` |
| No streams on episode | ladder play still works on **B**; row greys after probe |
| Next prompt missing | exit ≥50%; `GET /play/next-prompt` after mpv stop |
| Pad wrong button | [`docs/HARDWARE.md`](HARDWARE.md) — B=`304`, Y=`308`, shuffle=`317` |
