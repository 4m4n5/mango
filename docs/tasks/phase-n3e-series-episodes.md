# Phase N3e — Series episode picker & play

**Status:** PR1 shipped · **PR2 shipped** (launcher episode list + next-prompt)  
**Branch:** `feat/native-experience`  
**Last updated:** 2026-06-20

## Problem

Rails and detail use **bare series IMDB ids** (`tt12004706`). Catalog-service silently maps them to **S1E1** via `normalizeSeriesVerifyId()`. The launcher has no season/episode UI — Smart Play always targets episode 1. Continue Watching stores the real `play_id` but cannot pick a different episode from detail.

## Product decisions (locked)

| Area | Decision |
|------|----------|
| Play from rail / primary Play | Resume **latest in-progress** episode; else **S1E1** |
| Detail layout | Primary **Play** (resume/latest) + **episode list** below |
| Episode list | Single scroll: S1 E1, S1 E2, … with **focusable season headers** (jump) |
| Row content | S# E# + title + **progress %** (bar or text) |
| List open scroll | Latest in-progress if any; else S1 E1 |
| D-pad | Up/down; **skip greyed** (no-stream) rows |
| Streams | **Per episode** — reload when row is focused/selected |
| Miniseries | Same numbered list as multi-season shows |
| Missing streams | Grey row; not focusable / skipped |
| Continue rail | **One card per show** · subtitle `S2 E5 · 42%` |
| Progress storage | Latest episode **replaces** prior Continue entry (key `series:tt…`) |
| Start over | **Not v1** |
| After playback | **Next episode** prompt — **B** plays, **Y** dismisses (no countdown autoplay) |
| Mid-episode back (Y) | Next prompt only if **≥50%** watched |
| API ids | Accept **bare id** (→ S1E1 compat) **and** episode id `tt…:s:e` |
| Episode meta source | **Cinemeta** `videos[]` on series meta |
| Playability | **Hybrid:** background indexer for rail titles + **on-demand** in picker |
| Gates v1 | **diag only** (`scripts/diag/series-episodes.sh`) |
| Ship order | **PR1** API + meta/episodes + play · **PR2** launcher UI + next prompt |
| UX avoid | Stremio stream clutter in list · Kodi deep season walls · Netflix autoplay countdown |

## Spike results (Pi · 2026-06-20)

Cinemeta meta via `GET /meta/series/:bareId`:

| Show | Bare id | `videos[]` | Seasons | Meta latency |
|------|---------|------------|---------|--------------|
| Panchayat | `tt12004706` | 32 | 4 (S1–S4) | ~240 ms |
| Breaking Bad | `tt0903747` | 67 | 5 | ~73 ms |
| Chernobyl | `tt7366338` | 10 | miniseries | ~91 ms |

Episode entries include Stremio ids (`tt12004706:1:3`), `season`, `episode`, `title`, optional `thumbnail`.

**Chernobyl quirk:** meta includes legacy `season: 0` rows alongside `season: 1`. UI must **normalize** to display seasons 1…N and map play ids consistently (filter or remap `season <= 0`).

Stream probe (`GET /stream/series/:id`):

| Id | HTTP | Streams | Notes |
|----|------|---------|-------|
| `tt12004706` (bare) | 200 | 3 | Same as S1E1 (normalize) |
| `tt12004706:1:1` | 200 | 3 | |
| `tt12004706:1:3` | 200 | 3 | |
| `tt12004706:2:1` | 200 | 3 | Later season works |
| `tt0903747:1:1` | 200 | 1 | |
| `tt0903747:2:5` | 200 | 8 | Count varies by episode |
| `tt7366338:1:1` | 200 | 1 | |
| `tt7366338:1:3` | 200 | 1 | |

**Conclusion:** Episode picker is viable on Cinemeta `videos[]`. Per-episode stream resolve works when episode id is passed. PR1 exposes episodes + progress; PR2 wires launcher focus/skip/grey.

**Diag:** `bash scripts/diag/series-episodes.sh --sample` (after deploy).

---

## Architecture

```
Launcher detail (series)
  ├─ GET /meta/series/:bareId          → hero + videos[] (episodes)
  ├─ GET /series/:bareId/episodes      → normalized list + progress (PR1)
  ├─ focus episode row
  │    └─ GET /stream/series/:episodeId → stream list for that row
  ├─ Play (primary) → POST /play { type, id: resolvedEpisodeId, resume? }
  └─ on mpv exit (≥50%) → next-episode overlay → POST /play next id

Catalog-service
  ├─ normalizeSeriesVerifyId (keep for bare-id compat)
  ├─ episodes.ts — normalize Cinemeta videos[]
  ├─ playability: indexer + on-demand playable flags
  └─ progress.db: play_id = episode id; list key = series:tt…
```

---

## API (PR1)

### `GET /series/:bareId/episodes` (new)

Normalized couch response — hides Cinemeta quirks from TV UI.

```json
{
  "series_id": "tt12004706",
  "name": "Panchayat",
  "seasons": [
    {
      "season": 1,
      "label": "Season 1",
      "episodes": [
        {
          "id": "tt12004706:1:1",
          "season": 1,
          "episode": 1,
          "title": "…",
          "thumbnail": "https://…",
          "progress_pct": 0.42,
          "playable": true
        }
      ]
    }
  ],
  "resume": {
    "episode_id": "tt12004706:2:3",
    "position_sec": 840,
    "progress_pct": 0.35
  }
}
```

- Drop or remap `season <= 0` entries.
- `playable`: from playability DB if known; `null` = unknown (try play).
- `resume`: latest eligible Continue row for this series.

### `GET /stream/series/:id` / `POST /play` (existing)

- Bare id → S1E1 compat via `normalizeSeriesVerifyId`.
- Episode id → that episode only.
- Primary Play from bare id: resolve **latest in-progress** episode server-side.

---

## Launcher UI (PR2)

- Primary **Play** + scrollable episode list with season headers (focus to jump).
- Row: S# E# + title + progress; grey + D-pad skip when unplayable.
- Streams reload per focused episode (stream picker strip unchanged).
- Next-episode overlay: B play / Y dismiss; only if ≥50% on mid-exit.

---

## PR plan

### PR1 — catalog-service

- [x] `episodes.ts` — normalize `videos[]`
- [x] `GET /series/:bareId/episodes` + progress join
- [x] `POST /play` resolve latest episode for bare series id
- [ ] Playability `playable` flags (hybrid)
- [x] Unit tests (Chernobyl season 0, resume resolution)
- [ ] Deploy + `series-episodes.sh --sample`

### PR2 — launcher + next prompt

- [x] Episode list UI + focus/skip/grey
- [x] Per-episode stream on focus
- [x] Next-episode overlay from mpv-stop
- [ ] Couch verify Panchayat multi-episode flow

---

## References

- `src/catalog-service/src/playability/ids.ts`
- `src/catalog-service/src/progress/`
- `src/launcher/src/detail.ts`
- `scripts/diag/series-episodes.sh`
