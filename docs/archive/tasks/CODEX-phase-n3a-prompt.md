# Codex prompt — Phase N3a stream play orchestrator (closure)

**Last updated:** 2026-06-19 · N3a ~75% shipped · **close gaps, do not rewrite**

Copy everything below the `---` into Codex as the task prompt.

---

## Prompt

You are a **senior TV-box platform engineer** (embedded Linux, Stremio addon protocol, mpv, SRE gates). **Close Phase N3a** for the **mango** repo: tighten couch play defaults, wire filter tiers, add the N3a browse gate, fill inventory metrics, and validate on the **Raspberry Pi**.

### Pi state (build on this — do not redo)

| Item | Status |
|------|--------|
| Branch | `feat/native-experience` (commit `865312c+`) |
| Pre-couch | N0 + N3d self-hosted **PASS** |
| `play-orchestrator.ts` | **Shipped** — `playWithFallback()` in `POST /play` |
| Parallel resolve + stream cache | **Shipped** — `core.ts` `rawStreams()` |
| Launcher prefetch + couch copy | **Shipped** — `detail.ts` · `catalog.ts` |
| `mpv-play.sh --probe` | **Shipped** |
| N3c gate | **Shipped** — `gate-n3c-verified-rails.sh` |
| Pain today | Example filters: 45 s wall, `strict_unknown_cache: false`; tiers parsed but not used; no 15 s browse gate |

**Do not** rebuild browse UI, playability indexer, or N3d addon stack unless regression fails.

### Think before you code (mandatory — 15 min)

Read [`docs/N3-INVENTORY.md`](../N3-INVENTORY.md) § Plan. Add **§ Closure plan** (5 bullets max): changes vs stays · filter diff · gate strategy · probe-then-play ship/waive · indexer risks.

### Read first (in order)

1. [`docs/tasks/phase-n3-stream-orchestrator.md`](phase-n3-stream-orchestrator.md) — **§3 G1–G6**
2. [`docs/N3-INVENTORY.md`](../N3-INVENTORY.md)
3. [`docs/NATIVE_EXPERIENCE.md`](../NATIVE_EXPERIENCE.md)
4. [`docs/STACK-PRINCIPLES.md`](../STACK-PRINCIPLES.md) · [`docs/DEPLOY.md`](../DEPLOY.md)
5. Code audit: `play-orchestrator.ts` · `stream-filters.ts` · `index.ts` · `catalog-filters.example.json` · `gate-n3c-verified-rails.sh` · `detail.ts`

Apply **`$mango-tv-box-expert`**.

### Branch & environment

- **`feat/native-experience`** only
- Pi: SSH **`mango`** · `~/mango` · **never rsync**
- Deploy (iterate): `bash scripts/pi-deploy.sh --fast`
- Deploy (handoff): `bash scripts/pi-deploy.sh --full --gate`

### Mission — closure only

| Do | Do not |
|----|--------|
| **G1** Couch filter defaults (15 s wall, strict unknown cache) | Rewrite orchestrator from scratch |
| **G2** Wire `auto_play_tiers` into `selectAutoPlayCandidates` | Remove indexer TorBox/RD fallbacks |
| **G3** Probe-then-play OR documented waiver with Pi numbers | Stream picker (N3b) |
| **G4** `scripts/phase-n3a/gate-n3a-play.sh` + `pi-pre-couch-gate.sh` | Change gamepad codes |
| **G5** Fill `N3-INVENTORY.md` metrics | Mock play |
| **G6** (optional) `rail_id` in launcher play | 4K relaxation |

### Sequence

```
1. AUDIT + N3-INVENTORY § Closure plan
2. G1 filters example + tests
3. G2 tier wiring + tests
4. G3 probe-then-play or waiver
5. G4 gate-n3a-play.sh
6. G6 launcher rail_id (if quick)
7. npm test + build
8. pi-deploy --fast (loop) · --full --gate (handoff)
9. G5 inventory metrics
```

### Gate N3a (`scripts/phase-n3a/gate-n3a-play.sh`)

1. Random browse pick from `movies-india-trending` or `series-india-picks` (not Shawshank)
2. `POST /play`: `ok`, `total_ms ≤ 15000`, `attempts ≤ 5`, mpv playing
3. Second pick from different rail
4. Shawshank regression (warn if > 15 s)
5. `gate-n2-browse.sh` + `gate-n0.sh`

Extend `gate_check_play_json` for max `total_ms`.

### Deploy (mandatory)

```bash
git push origin feat/native-experience
bash scripts/pi-deploy.sh --fast   # iterate
bash scripts/pi-deploy.sh --full --gate   # handoff
sudo cp config/catalog-filters.example.json /etc/mango/catalog-filters.json
bash scripts/phase-n3a/gate-n3a-play.sh
```

### Deliverables

- [ ] G1–G5 complete
- [ ] Pi gates pass
- [ ] Handoff report in commit message or inventory

**No waivers** for browse-pick play failing within 15 s.

Do not ask clarifying questions unless blocked.
