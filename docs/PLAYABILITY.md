# Playability — verified library & thematic rails

**Status:** [STATUS.md](STATUS.md) · **Rail sources:** [../config/catalog-rail-curation.md](../config/catalog-rail-curation.md) · **Deep ops:** [../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md)

How mango builds and maintains **verified play pools** per browse rail, keeps titles in **thematically correct** rows, and monitors growth.

---

## Model

| Store | Path (Pi) | Role |
|-------|-----------|------|
| `titles` | `/etc/mango/playability.db` | Global verify state (verified / failed / TTL) |
| `rail_pool` | same DB | Per-rail membership + couch display snapshot |
| Sessions | same DB | Tab/rail shuffle slots (cleared on pool changes) |

- **Browse rails** only show titles with active **verified** status in `rail_pool`.
- A title may appear in **multiple rails**; the **unique library** is distinct `type:id` in `titles` where `status=verified`.
- **Grow** adds fresh probes; optional global links are metrics only. A successful grow requires every active rail to meet its configured fresh target.

---

## Thematic rails (shipped)

Two mechanisms share one profile file:

| Mechanism | When | Script / code |
|-----------|------|----------------|
| **Theme gate** (ongoing) | Every grow · link · verify pool write | `rail-theme-gate.ts` — on by default |
| **Pool retheme** (one-off) | Manual prune + relocate mismatches | `rail-pool-retheme.sh` |

**Profiles:** `config/rail-theme-profiles.yaml` (`MANGO_RAIL_THEME_PROFILES`)

| Field | Meaning |
|-------|---------|
| `intent` | Positive keywords (tokenized like AI compose) |
| `exclude` | Strong mismatch — blocks pool membership |
| `min_fit` | Minimum score to keep title on rail (anchor rails use `3`, India rails `14`) |
| `max_runtime_minutes` | Movies only — e.g. quick-watches cap |

**Anchor rails** (`movies-global-popular`, `series-global-popular`) stay permissive — catch-all for relocated titles.

**Pins** from `rail-curation-overrides.yaml` always bypass the theme gate.

Disable gate (debug only): `MANGO_RAIL_THEME_GATE=0`

### Pool retheme (manual)

Use after large source reshapes or legacy overlap — not part of nightly grow.

```bash
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --rail series-reality-casual
bash scripts/m3-play/playability/rail-pool-retheme.sh apply          # preserve titles → best-fit or anchor
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --include-orphans --limit 200
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --include-orphans   # all verified titles → best-fit or anchor
bash scripts/m3-play/playability/rail-pool-retheme.sh recover         # orphans → anchor rails
```

Apply clears affected rail sessions. `--include-orphans` extends the same theme
scoring to active verified titles that are not in any rail; use `--limit` for
off-hours batches when addon meta limits are tight. Prefer **grow + theme gate**
for steady state; retheme is a scalpel.

---

## Rail source map (current)

Curated in [catalog-rail-curation.md](../config/catalog-rail-curation.md). Highlights:

| Rail | Theme |
|------|--------|
| `movies-quick-watches` | Short / stand-up / easy — not classics overlap lists |
| `movies-india-trending` | **Indian cinema** (Bharat Binge primary) — not “trending in India” western hits |
| `series-india-picks` | **Indian series** (Hindi/regional OTT) |
| `series-reality-casual` | Reality / game shows — `mdblist.63182` + Cinemeta anchor |

Hit-rate tuning: `python3 scripts/diag/source-hitrate.py`

---

## Grow & top-up jobs

| Job | UI label | Command |
|-----|----------|---------|
| Reshuffle | Refresh library | launcher inline |
| Quick top-up | ~10 min | `quick-playability-topup.sh --detach` |
| Nightly | ~45 min | `playability-maintenance.sh --mode full` |
| Overnight | ~4 h | `overnight-playability-grow.sh --detach` |
| Manual grow | — | `playability-grow.sh --mode grow --detach` |

**Presets:** `quick` (10 min wall) · `nightly` (90 min) — see [LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md)

**Grow quota:** fresh **new-to-rail probe-verified** titles per rail (`+20` default). Existing verified links, orphan reattachments, and pool reshuffles do **not** satisfy the quota. Anchor rails are included by default; the old anchor diet is opt-in only (`MANGO_GROW_ANCHOR_DIET=1`).

**Monitor:**

```bash
python3 scripts/diag/grow_monitor.py status
python3 scripts/diag/grow_monitor.py watch --interval 30
python3 scripts/diag/playability-status.py
python3 scripts/diag/ops-report.py
```

Tracks **unique verified library** size and per-rail deltas (`unique_verified`, `unique_verified_delta`) separately from strict per-rail grow success.

---

## Manual curation

```bash
bash scripts/m3-play/playability/rail-curation.sh list
bash scripts/m3-play/playability/rail-curation.sh pin add --rail series-comedy --type series --id tt33094114
bash scripts/m3-play/playability/rail-curation.sh apply
```

---

## Rate limits & deploy hygiene

Addons (Cinemeta, AIOMetadata, AIOStreams) throttle aggressive meta/stream bursts.

| Risk | Mitigation |
|------|------------|
| Full gate played every couch item per rail (old behavior) | **Fixed:** `MANGO_GATE_FULL=1` samples **3 plays/rail** |
| `rail-pool-retheme apply` on full library | ~900 sequential meta calls — run off-hours; catalog backoff 5 min |
| Gate-lite + deploy restart | M4 stream gate uses fixture corpus only — bounded |
| Grow preflight | Quick: 1 probe/source (skip if report <24h); nightly: 3/source |
| Live/IPTV addon rate limit during VOD grow | Playability refresh boots catalog-service in VOD mode and skips optional Live manifests |
| Repeated bad candidates during long grow | Rail-specific rejection ledger skips recent theme/stream misses before probing |
| One weak source burns a rail window | Runtime source circuit breakers suppress rate-limited, exhausted, theme-mismatched, or low-hit sources for the current rail run |

Catalog env: `MANGO_META_RATE_LIMIT_BACKOFF_MS` (default 5 min) · `MANGO_RAIL_META_CONCURRENCY` (default 6)

Grow negative memory is runtime-only:

- `rail_candidate_rejections` lives in `playability.db` and is scoped to `rail_id + title`.
- Theme rejects default to a 7-day rail TTL; no-stream/title-mismatch grow rejects default to 24h.
- Runtime source weights and source suppressions never edit catalog YAML or theme profiles.
- Monitor state is written to `~/.cache/mango/grow-run-state.json`; it is operator-only and not shown on TV.

If refresh fails, `refresh-*.json` now records `ok:false`, `stage`, `failure_category`, and `repair_suggestions`; use `python3 scripts/diag/grow_monitor.py assess --refresh-json <file>`.

---

## Gates (playability)

| Gate | Plays |
|------|--------|
| `gate-lite-play.sh` | 1 movie + 1 series smoke |
| `gate-m3-verified-rails.sh` | **3/rail** when `MANGO_GATE_FULL=1` (override: `MANGO_N3C_GATE_MAX_PER_RAIL`) |

Full gate still runs M1 · M4 self-hosted · N3a orchestrator — holistic without exhaustive per-rail play.

```bash
bash scripts/pi-deploy.sh --fast --gate
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
```

PR regression (not gate-lite): `bash scripts/m3-play/playability/gate-m3-library-grow.sh`
