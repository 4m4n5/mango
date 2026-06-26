# Couch test checklist

**Branch:** `feat/native-experience` · **Gate:** `bash scripts/pi-exec-gate.sh` (gate-lite ~2 min)

Run gate on Mac before handing off to the TV. Live IPTV is opt-in — not in gate-lite.

---

## Automated preflight (agent)

```bash
bash scripts/pi-deploy.sh --fast --gate   # pull, build, gate-lite
bash scripts/diag/series-episodes.sh --sample   # on Pi — episode meta + stream probes
python3 scripts/diag/playability-status.py   # pool depth
python3 scripts/diag/grow_monitor.py status  # latest grow health; operator-only
```

---

## Browse & pad (M2)

| # | Action | Pass? |
|---|--------|-------|
| 1 | **Movies** tab loads 9-up poster grid | |
| 2 | **L/R shoulders** switch Movies ↔ Series ↔ Live | |
| 3 | **↻ shuffle** (pad `317`) — new titles, no rate-limit text | |
| 4 | **Series** tab — rails populated | |

---

## Series episode picker (M3)

| # | Action | Pass? |
|---|--------|-------|
| 5 | Open **Panchayat** (or Breaking Bad) → episode list below actions | |
| 6 | D-pad **down** into list — **streams strip updates** per focused episode | |
| 7 | Focus **Season 2** header → **B** jumps to first S2 episode | |
| 8 | Grey rows (no streams) are **skipped** by D-pad | |
| 9 | **Play / Resume** starts mpv; **Y** returns to detail | |
| 10 | Watch **≥50%** → **Y** → **next episode** overlay; **B** plays next, **Y** dismisses | |

---

## Play (M3)

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

## Library grow health (operator)

Do not show grow/debug status on TV. Check this from SSH before claiming library maintenance is healthy.

| # | Check | Pass? |
|---|-------|-------|
| G1 | `grow_monitor.py assess` selects the newest run artifact, including failures | |
| G2 | Orphan count is zero after successful grow or orphan-only repair | |
| G3 | No title exceeds the overlap cap except curation/pin semantics | |
| G4 | Failed/partial grow did not publish staged rail pools to couch | |
| G5 | Source-grow audit explains any short rail with concrete reasons | |

---

## If something fails

| Symptom | Check |
|---------|--------|
| Empty episode list | `curl localhost:3020/series/tt12004706/episodes` |
| No streams on episode | ladder play still works on **B**; row greys after probe |
| Next prompt missing | exit ≥50%; `GET /play/next-prompt` after mpv stop |
| Pad wrong button | [`docs/HARDWARE.md`](HARDWARE.md) — B=`304`, Y=`308`, shuffle=`317` |


---

## Voice companion (M5.5a safety, M5.5b polish)

Requires `MANGO_VOICE=1`. M5.5a verifies the voice contract now; final phone/HUD polish is re-run after native YouTube. Full spec: [tasks/m5-companion-ux-ship.md](tasks/m5-companion-ux-ship.md)

| # | Action | Pass? |
|---|--------|-------|
| V1 | PTT "good Hindi movies" — **no TV jump**; clarifying or chat on phone | |
| V2 | PTT "Panchayat kholo" — detail on TV ≤8 s; phone confirms open | |
| V3 | Ambiguous title — list on phone; **no open** until explicit pick | |
| V4 | Create AI catalog — confirm once; rail appears after bootstrap | |
| V5 | "What do you know about me?" — readable summary on phone | |
| V6 | Voice HUD dismisses within ~12 s; tiles unobstructed | |
| V7 | Proactive off (default) — no unsolicited TV suggestions | |

---

## Unified TV/companion UX ship polish (M6.5)

Manual sign-off after Mango Library, YouTube, and 4K feature slices. Spec: [tasks/m6-tv-ux-ship.md](tasks/m6-tv-ux-ship.md)

| # | Action | Pass? |
|---|--------|-------|
| U1 | Focus visible on every tile at 3 m | |
| U2 | D-pad: no focus trap in detail → episodes → streams | |
| U3 | Poster grid stable — no jump when images load | |
| U4 | Tab vs shuffle visually distinct (active vs amber outline) | |
| U5 | Play failure shows couch copy — no API/mpv stderr | |
| U6 | Empty rail hidden or graceful — no full-screen error | |
| U7 | Continue rail uses Mango progress/library state only | |
| U8 | ⌂ from mpv — home <300 ms perceived | |
| U9 | YouTube rail/search/detail follows the same focus, HUD, and pad-play rules | |
