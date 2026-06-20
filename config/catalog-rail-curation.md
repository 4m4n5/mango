# Rail catalog curation (v2.2)

Playability-first picks. Target **20 verified playable titles** per rail.
After each fill: `source-hitrate.py` → tune → re-import → `fill-playability-db.sh`.

## Hit-rate principles

1. **Cinemeta charts** (`top`, `imdbRating`) — highest debrid cache; use as anchor on weak series rails.
2. **mdblist daily/trending** (`88302`, `105797`) — mainstream cache over “latest/digital/reality”.
3. **IndiaStreams** (`recmov`, `popmov`, `trendingtv`) — regional content; blend Cinemeta on series for playability.
4. **Session dedup** — niche/optional rails **last** in yaml (allocate tab session slots first).
5. **Optional rails** — `min_display: 12` so fill does not block on hard-to-probe catalogs.

## Rail → source map (v2.2)

| Rail | Sources | Rationale |
|------|---------|-----------|
| `movies-global-popular` | Cinemeta `top` + **88302** | 100% / 80% source hit-rate |
| `movies-india-trending` | **recmov** + **popmov** | 100% regional |
| `movies-classics` | Cinemeta `imdbRating` | Anchor |
| `movies-comedy` | **91223** | 100% source; pool top-up not swap |
| `movies-quick-watches` | **88302** + **83666** | Dropped 83668 (60%); classics/modern blend |
| `movies-documentaries` | **84677** | 100%; enable in mango import |
| `series-global-popular` | Cinemeta `top` 0.8 + **105797** | Dropped 88303 (40%); daily picks 100% probe |
| `series-india-picks` | **trendingtv** 0.7 + Cinemeta `top` 0.3 | Indian chart + cache anchor |
| `series-classics` | Cinemeta `imdbRating` | Anchor |
| `series-comedy` | Cinemeta `top` 0.65 + **91224** 0.35 | Fixes 40% mdblist-only; yaml last = session priority |
| `series-miniseries` | **130153** | 80% probe |
| `series-reality-casual` | Cinemeta `top` + **105797** | Dropped **84401** (0%); label **light & casual** |

## Measurement

```bash
python3 scripts/diag/source-hitrate.py
MANGO_SOURCE_PROBE_EXPORT=1 MANGO_AIOMETADATA_EXPORT=~/.config/mango/aiometadata-import.json \
  python3 scripts/diag/source-hitrate.py
```

Goal: ≥80% stream resolve per active source (`MANGO_SOURCE_TARGET_RATE=0.80`).

## Coordination

Series stream plane / gate work: `scripts/phase-n3d/TASK-series-stream-plane.md` (WP2–WP5).
