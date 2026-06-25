# Playability — verified library & thematic rails

**Status:** [STATUS.md](STATUS.md) · **Rail sources:** [../config/catalog-rail-curation.md](../config/catalog-rail-curation.md) · **Deep ops:** [../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md)

How mango builds and maintains **verified play pools** per browse rail, keeps titles in **thematically correct** rows, and monitors growth.

---

## Current state

The grow system is implemented as a best-effort, couch-silent maintenance workflow:

- Production YAML keeps `grow_per_pass: 20`; benchmark iterations may set `MANGO_GROW_PER_PASS=5`.
- Each active browse/AI rail aims to add fresh `new_to_rail_verified` titles. Global unique growth, orphan repair, and existing verified links are metrics only and do not satisfy the per-rail target.
- Grow uses a staged work DB. Completed publishable runs publish even when some rails miss the `+20` target; failed, aborted, or crashed runs write structured diagnostics and leave the previous stable rail snapshot visible.
- Finalization attaches verified orphans to best-fit rails or anchors and caps unpinned cross-rail membership. Pins do not consume the unpinned cap, so a pinned title can still appear in two other strong thematic rails.
- Remaining hardening focus is source quality and repeatability: `series-reality-casual` and `series-india-picks` currently struggle to meet `+20` in one run from the configured sources.
- Maintenance is idle-gated. Recent pad, launcher, voice, mpv, or progress
  activity writes a structured `deferred` report and prevents disruptive
  stop/probe/publish phases from touching the couch session.

---

## Model

| Store | Path (Pi) | Role |
|-------|-----------|------|
| `titles` | `/etc/mango/playability.db` | Global verify state (verified / failed / TTL) |
| `rail_pool` | same DB | Per-rail membership + couch display snapshot |
| Sessions | same DB | Tab/rail shuffle slots (cleared on pool changes) |

- **Browse rails** only show titles with active **verified** status in `rail_pool`.
- A title may appear in **multiple rails**; the **unique library** is distinct `type:id` in `titles` where `status=verified`.
- **Grow** adds fresh probes; optional global links are metrics only. The configured fresh target is an SLA warning, while publish safety is based on the run completing cleanly, rails staying displayable, and finalization preserving orphan/overlap hygiene.

---

## Thematic rails (shipped)

Two mechanisms share one profile file:

| Mechanism | When | Script / code |
|-----------|------|----------------|
| **Theme gate** (ongoing) | Every grow · link · verify pool write | `rail-theme-gate.ts` — on by default |
| **Pool retheme** | Manual repair + grow finalization | `rail-pool-retheme.sh` / `refreshAllRailsGrow` |

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

### Pool retheme

Use manually after large source reshapes or legacy overlap. Completed
publishable grow runs use a lightweight finalization path: active verified orphans are
scored to their best matching rail or anchor fallback, and existing pooled
titles are capped to two unpinned memberships by current pool score. Full
metadata retheme remains a manual/off-hours repair operation.

```bash
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --rail series-reality-casual
bash scripts/m3-play/playability/rail-pool-retheme.sh apply          # preserve titles → best-fit or anchor
bash scripts/m3-play/playability/rail-pool-retheme.sh dry-run --include-orphans --limit 200
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --include-orphans   # all verified titles → best-fit or anchor
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --orphans-only      # attach orphans; do not prune/retitle current pools
bash scripts/m3-play/playability/rail-pool-retheme.sh apply --overlap-only      # cap rail overlap without metadata retheme
bash scripts/m3-play/playability/rail-pool-retheme.sh recover         # orphans → anchor rails
```

Apply clears affected rail sessions. `--include-orphans` extends the same theme
scoring to active verified titles that are not in any rail; use `--limit` for
manual off-hours batches when addon meta limits are tight. Pins and curation
overrides are preserved and do not consume the unpinned overlap budget. A pinned
title may still appear in up to two other matching rails. `--orphans-only`
repairs orphaned verified titles without changing existing memberships.
`--overlap-only` is the grow-safe lightweight repair: it enforces the unpinned
overlap cap from current pool scores without metadata calls or theme relocation.

---

## Rail source map (current)

Curated in [catalog-rail-curation.md](../config/catalog-rail-curation.md). Highlights:

| Rail | Theme |
|------|--------|
| `movies-quick-watches` | Short / stand-up / easy - streaming, RT-short, and shorts lists; not classics overlap lists |
| `movies-india-trending` | **Indian cinema** - Bharat Binge Hindi/Tamil/Telugu/Malayalam/Kannada catalogs plus India-native MDBList pools; not generic western titles "trending in India" |
| `series-india-picks` | **Indian series** - Hindi/Tamil/Telugu/Malayalam/Kannada OTT plus India-native MDBList pools, with new regional/provider sources admitted as probation probes |
| `series-classics` | Critically acclaimed shows - IMDb anchor plus HBO/BBC depth |
| `movies-documentaries` | Documentary pools widened; weak true-crime source retained only as low-weight probation |
| `series-global-popular` | Cinemeta anchor plus `mdblist.88303` / `88434` trending-show depth; weak older daily source is low-weight probation |
| `series-reality-casual` | Reality / game shows - `mdblist.84401` plus deep `147884`; weak and broad show-chart sources stay low-weight and must pass the reality/game-show theme gate |
| `series-comedy` | Sitcom/comedy MDBList pools plus small Indian stand-up overlap where theme-fit passes |

Hit-rate tuning: `python3 scripts/diag/source-hitrate.py`

Runtime grow audit:

```bash
python3 scripts/diag/source-grow-audit.py --rail movies-india-trending
python3 scripts/diag/source-grow-audit.py --rail series-india-picks
python3 scripts/diag/source-grow-audit.py --rail series-reality-casual
```

Latest measured blocker: on 2026-06-25, an earlier Pi grow published `+280`
unique verified titles. The scheduled 03:00 nightly later staged `+3` stale
re-verifications, but the maintenance process was aborted with rc `143`; the
staged DB was discarded and the live DB remained at `1054` unique verified
titles with `0` orphans. Separate source-yield audits showed
`series-reality-casual` reaching only `+9/20` and `series-india-picks`
remaining at `+0/20` in observed strict windows, mostly due to no-stream
catalogs, duplicates, unresolved IDs, and theme-rejected broad charts.

---

## Grow & top-up jobs

| Job | UI label | Command |
|-----|----------|---------|
| Reshuffle | Refresh library | launcher inline |
| Quick top-up | ~10 min | `quick-playability-topup.sh --detach` |
| Nightly | ~45 min | `playability-maintenance.sh --mode nightly` |
| Overnight | ~4 h | `overnight-playability-grow.sh --detach` |
| Manual grow | — | `playability-grow.sh --mode grow --detach` |
| Run control | operator | `grow-run-control.sh start/status/watch/assess/abort` |
| Explicit catch-up | operator | `playability-catch-up.sh nightly\|grow\|stale` |

**Presets:** `quick` (10 min wall) · `nightly` (90 min) — see [LIBRARY-GROWER-OPS.md](../scripts/m3-play/playability/LIBRARY-GROWER-OPS.md)

**Grow target:** fresh **new-to-rail probe-verified** titles per rail (`+20` default). Existing verified links, orphan reattachments, and pool reshuffles do **not** satisfy the target. Anchor rails are included by default; the old anchor diet is opt-in only (`MANGO_GROW_ANCHOR_DIET=1`). By default, target misses are warnings and usable verified work still publishes; set `MANGO_GROW_REQUIRE_TARGET=1` for strict proof runs.

**Monitor:**

```bash
python3 scripts/diag/grow_monitor.py status
python3 scripts/diag/grow_monitor.py watch --interval 30
python3 scripts/diag/grow_monitor.py assess
python3 scripts/diag/playability-status.py
python3 scripts/diag/ops-report.py
```

Tracks **unique verified library** size and per-rail deltas (`unique_verified`, `unique_verified_delta`) separately from per-rail target completion.
Status and assess output also include orphan count, overlap count, over-cap
titles, duplicate candidate pressure, wasted candidate ratio, and retheme
finalization results when present. During an active staged grow, status reads
the isolated work DB and labels it as `staged work DB`; couch-visible rails
switch only after a completed publishable run.

### Idle-gated maintenance

The activity file is `~/.cache/mango/couch-activity.json` and stores only
timestamp, source, hint, and pid. The default idle threshold is 30 minutes.

```bash
bash scripts/diag/couch-activity-status.sh
bash scripts/lib/couch-activity.sh is-idle
```

`playability-maintenance.sh` checks this before stopping launcher/catalog and
again before the disruptive grow phase in nightly mode. If activity appears,
the report is written with `ok:false`, `failure_category:
couch_active_deferred`, `deferred:true`, and an operator repair suggestion.
Debug/operator override: `MANGO_MAINTENANCE_IGNORE_COUCH_ACTIVITY=1`.

The systemd playability timers intentionally omit `OnBootSec` so a reboot does
not immediately stop a newly active couch session. Use the explicit catch-up
script after verifying the couch is idle.

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
| `rail-pool-retheme apply` on full library | Full metadata retheme can issue thousands of sequential meta calls — run off-hours; grow finalization uses the lightweight overlap/orphan path |
| Gate-lite + deploy restart | M4 stream gate uses fixture corpus only — bounded |
| Grow preflight | Reuse report if <24h; otherwise quick: 1 probe/source, nightly: 3/source. Force with `MANGO_SOURCE_HITRATE_FORCE=1` |
| Live/IPTV addon rate limit during VOD grow | Playability refresh boots catalog-service in VOD mode and skips optional Live manifests |
| Repeated bad candidates during long grow | Rail-specific rejection ledger skips recent theme/stream misses before probing; deep-page bypass for stream misses is debug-only |
| TMDB-only candidates that cannot map to IMDb | Grow marks them `unresolved_external_id`, skips stream probes, records a rail TTL, and demotes the source through runtime-only weights |
| One weak source burns a rail window | Runtime source circuit breakers suppress rate-limited, exhausted, theme-mismatched, or unsustainably low verified-yield sources for the current rail run |
| Transient stream-addon empty responses | Grow verification retries one zero-stream resolve before writing a `no_stream` tombstone |

Catalog env: `MANGO_META_RATE_LIMIT_BACKOFF_MS` (default 5 min) · `MANGO_RAIL_META_CONCURRENCY` (default 6) · `MANGO_CATALOG_FETCH_TIMEOUT_MS` (default 20s, hard-bounds catalog fetch and JSON body parsing) · `MANGO_STREAM_ZERO_RETRY_ATTEMPTS` / `MANGO_STREAM_ZERO_RETRY_DELAY_MS` (default one 1.5s retry for `GET /stream` display/gate resolves) · `MANGO_PLAYABILITY_VERIFY_ZERO_RETRY_ATTEMPTS` / `MANGO_PLAYABILITY_VERIFY_ZERO_RETRY_DELAY_MS` (default one 1.2s retry during grow verification only)

Grow negative memory is runtime-only:

- `rail_candidate_rejections` lives in `playability.db` and is scoped to `rail_id + title`.
- Theme rejects default to a 7-day rail TTL; no-stream/title-mismatch grow rejects also default to about 7 days.
- Debug-only failed-title bypass: `MANGO_GROW_BYPASS_RECENT_FAILED=1`.
- Runtime source weights and source suppressions never edit catalog YAML or theme profiles.
- After changing verification policy, archive/reset `~/.cache/mango/source-grow/latest.json` before benchmark comparison; old runtime demotions are cache-only but can otherwise bias the next run.
- Unresolved external catalog IDs are structural candidate failures, not playback failures; they should show up as `skipped_unresolved_external_id` and source `unresolved_external_id`, not as repeated `no_stream` probes.
- `uncached_verify_legacy` is a migration quarantine reason for older rows proven by stale cache metadata; it retries immediately by default so the current stream parser can re-verify them.
- Source hit-rate reports written by Python use seconds timestamps; the grow loader normalizes seconds/milliseconds before age checks.
- Catastrophic zero-yield or near-zero-yield runtime source outcomes fall to the 5-10% probation floor so weak sources can recover without burning the rail window.
- Nonzero but unsustainable stream yield is still demoted: `MANGO_GROW_SOURCE_MIN_VERIFY_RATE` defaults to `0.05`, so sources with enough samples but <=5% verified yield stay in the small probation budget.
- Monitor state is written to `~/.cache/mango/grow-run-state.json`; it is operator-only and not shown on TV.
- Completed grow finalization attaches verified orphans and prunes unpinned overlap above two rails per title without full-library metadata rescoring. Failed or aborted grows keep the previous stable couch sessions visible.
- Manual `playability-indexer top-up` and `playability-top-up-rail.sh` default to grow mode with playability VOD boot. Legacy incremental top-up is debug-only via `--mode incremental`; it can verify globally playable titles that do not fit the target rail and should not be used for thematic repair.

If refresh fails, `refresh-*.json` now records `ok:false`, `stage`, `failure_category`, and `repair_suggestions`; use `python3 scripts/diag/grow_monitor.py assess --refresh-json <file>`.

---

## Gates (playability)

| Gate | Plays |
|------|--------|
| `gate-lite-play.sh` | 1 movie + 1 series smoke |
| `gate-m3-verified-rails.sh` | **3/rail** when `MANGO_GATE_FULL=1` (override: `MANGO_N3C_GATE_MAX_PER_RAIL`) |

Full gate still runs M1 · M4 self-hosted · play orchestrator checks — holistic without exhaustive per-rail play.

```bash
bash scripts/pi-deploy.sh --fast --gate
MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh
```

PR regression (not gate-lite): `bash scripts/m3-play/playability/gate-m3-library-grow.sh`

---

## Open items

| Item | Why it matters |
|------|----------------|
| Prove repeated unattended full `+20` grows | Target state is a constantly growing library without manual repair |
| Improve reality and India-series source yield | Current catalogs are thematically useful but often no-stream, duplicate-heavy, unresolved to IMDb, or rejected by the strict theme gate |
| Promote/demote sources from measured grow outcomes | Runtime weights should keep healthy catalogs hot and weak catalogs on small probation budgets |
| Keep diagnostics compact | Operators need exact stage/source/reason without exposing grow/debug status on TV |
| Revisit full retheme cadence | Full metadata retheme is useful but can trigger many meta calls; default grow should stay lightweight |
