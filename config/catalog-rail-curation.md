# Rail catalog curation (v2.2)

Playability-first picks. Target **20 verified playable titles** per rail.
After each fill: `source-hitrate.py` → tune → re-import → `fill-playability-db.sh`.

## Hit-rate principles

1. **Cinemeta charts** (`top`, `imdbRating`) — highest debrid cache; use as anchor on weak series rails.
2. **mdblist daily/trending** (`88302`, `105797`) — mainstream cache over “latest/digital/reality”.
3. **IndiaStreams** (`recmov`, `popmov`, **`trendingtv`**) — regional movies stable; **`trendingtv` kept** for Indian series UX (Mirzapur, IGL) despite ~20% probe — Cinemeta anchor blend, not full demotion.
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
| `series-india-picks` | **trendingtv** 0.7 + Cinemeta `top` 0.3 | Indian OTT chart; low probe rate but right couch titles |
| `series-classics` | Cinemeta `imdbRating` | Anchor |
| `series-comedy` | Cinemeta `top` + **91224** | yaml last = session priority; probe ~40% — WP2 stream tuning |
| `series-miniseries` | **130153** | 80% probe |
| `series-reality-casual` | Cinemeta `top` + **105797** | Dropped **84401** (0%); label **light & casual** |

## Measurement

```bash
python3 scripts/diag/source-hitrate.py
MANGO_SOURCE_PROBE_EXPORT=1 MANGO_AIOMETADATA_EXPORT=~/.config/mango/aiometadata-import.json \
  python3 scripts/diag/source-hitrate.py
```

Goal: ≥80% stream resolve per active source (`MANGO_SOURCE_TARGET_RATE=0.80`).

Demoted candidates to re-test with `MANGO_SOURCE_PROBE_EXPORT=1`: `mdblist.88303`, `mdblist.84401`, `mdblist.83666`.

**Stream gate couch exemplars** (`config/stream-gate-fixtures.json`): IGL + Panchayat are **soft** — track Indian series streams without blocking deploy. Filters must not drop IGL when AIOStreams returns rows (see `debrid-stream-audit.py`).

## Coordination

Series stream plane / gate work: `scripts/phase-n3d/TASK-series-stream-plane.md` (WP2–WP5).
