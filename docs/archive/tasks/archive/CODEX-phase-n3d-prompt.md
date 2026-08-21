# Codex — Phase N3d implementation checklist

**Branch:** `feat/native-experience`
**Spec:** [`phase-n3d-self-hosted-addon-stack.md`](phase-n3d-self-hosted-addon-stack.md)

Execute slices **in order**. One logical commit per slice. After each slice: Mac build if TS touched → commit → push → Pi pull → run slice gate.

---

## N3d-S0 — Prereqs + skeleton

**Goal:** Repo layout and prereq gate; no Pi secrets in git.

- [ ] Add `scripts/phase-n3d/check-n3d-prereqs.sh` (executable)
- [ ] Add `deploy/aiostreams/compose.yaml` + `.env.example` (SECRET_KEY format documented; `BASE_URL=http://127.0.0.1:3035`)
- [ ] Add `deploy/aiolists/compose.yaml` (port 3036)
- [ ] Add `scripts/phase-n3d/install-aiostreams.sh` — `docker compose up -d`, health wait on `/api/v1/status`
- [ ] Add `scripts/phase-n3d/install-aiolists.sh`
- [ ] Document ports in `docs/N3d-INVENTORY.md` (new, concise)

**Gate:** `bash scripts/phase-n3d/check-n3d-prereqs.sh` (on Pi)

**Do not:** commit `.env` with real `SECRET_KEY` or debrid keys.

---

## N3d-S1 — AIOStreams running on Pi

**Goal:** Local stream aggregator healthy; persistent volume at `~/.local/share/mango/aiostreams/data`.

- [ ] `install-aiostreams.sh` creates volume dir, pulls `ghcr.io/viren070/aiostreams:latest`
- [ ] Add `config/systemd/mango-aiostreams.service` (user unit) — `After=docker.service`, restart unless-stopped
- [ ] Add `scripts/phase-n3d/enable-aiostreams-service.sh` — `systemctl --user enable --now`
- [ ] Add `scripts/phase-n3d/configure-aiostreams.md` — operator steps: open configure UI, add Torrentio TB+RD, TorBox, Real-Debrid, **Easynews Search**, language prefs
- [ ] Operator copies resulting manifest URL into `/etc/mango/stremio-export.json` as `"name": "AIOStreams"`

**Gate:**

```bash
curl -sf http://127.0.0.1:3035/api/v1/status
docker ps --filter name=aiostreams --format '{{.Status}}' | grep -qi up
```

**Couch test:** N/A (no catalog wiring yet)

---

## N3d-S2 — Stream plane wired into mango

**Goal:** catalog-service uses local AIOStreams; filters prefer it; rate-limit URLs fail fast.

- [ ] Update `config/stremio-export.example.json` — local AIOStreams placeholder
- [ ] Update `config/catalog-filters.example.json` — replace `AIOStreams | ElfHosted` → `AIOStreams` in `auto_play_tiers`
- [ ] Update `src/catalog-service/src/stream-filters.ts` `defaultAutoPlayTiers()` to match
- [ ] Merge any uncommitted rate-limit hardening (`isRateLimitedStreamUrl`, mpv-probe timeout wrapper) if not on branch
- [ ] Add `scripts/phase-n3d/gate-n3d-streams.sh`
- [ ] `npm run build` in `src/catalog-service`

**Gate:** `bash scripts/phase-n3d/gate-n3d-streams.sh`

**Pi:**

```bash
MANGO_CATALOG=1 bash scripts/mango-stack.sh restart
bash scripts/phase-n3d/gate-n3d-streams.sh
```

---

## N3d-S3 — AIOLists catalog plane

**Goal:** mdblist rails work without AIOMetadata.

- [ ] AIOLists running on 3036 with mdblist lists matching current yaml IDs (see `N2-INVENTORY.md` table)
- [ ] Export entry `"name": "AIOLists"` with local manifest
- [ ] Add `scripts/phase-n3d/gate-n3d-catalogs.sh` — rail item smoke for mdblist rails
- [ ] Add `scripts/phase-n3d/map-mdblist-catalogs.md` — old `mdblist.XXXXX` → AIOLists catalog id mapping (operator reference)

**Gate:** `bash scripts/phase-n3d/gate-n3d-catalogs.sh` (items ≥1 per mdblist rail; verification optional this slice)

---

## N3d-S4 — catalog.yaml migration + India OTT

**Goal:** 12 rails with zero ElfHosted addon references in repo config.

- [ ] Update `config/catalog.example.yaml`:
  - Replace `AIOMetadata  | ElfHosted` sources with `AIOLists` catalog ids
  - `movies-india-trending`: composite with **India OTT** + mdblist fallback (drop `in_rdata_indiastreams.*` unless mapped)
- [ ] Update `scripts/phase-n2/check-n2-prereqs.sh` rail id list if needed
- [ ] Update `src/launcher/src/catalog.ts` — stagger/heuristic: treat AIOLists like ElfHosted for fetch stagger (rename helper to `isHeavyCatalogAddon`)
- [ ] `sudo cp config/catalog.example.yaml /etc/mango/catalog.yaml` on Pi (operator or script with note)

**Gate:** `bash scripts/phase-n2/gate-n2-browse.sh`

---

## N3d-S5 — Playability validation

**Goal:** Maintenance completes; DB counters move; no hung probes.

- [ ] Ensure `scripts/diag/poll-maintenance.py` on branch (`MANGO_POLL_MAX=1` default)
- [ ] Run `bash scripts/phase-n3c/playability-maintenance.sh --mode stale` on Pi
- [ ] Assert: no probe processes >30s; `verified_total` or `failed_total` increases vs start
- [ ] Optional: sample `gate-n3c-verified-rails.sh` (2/rail) — warn if pools thin, don't block S5

**Gate:** maintenance JSON includes `"duration_ms"` and `skipped_recent_failed` not 100% of candidates

---

## N3d-S6 — Pre-couch integration + docs

**Goal:** Single gate path for agents; ElfHosted demoted to fallback doc.

- [ ] Add `scripts/phase-n3d/gate-n3d-self-hosted.sh` (orchestrates S0–S4 checks)
- [ ] Edit `scripts/pi-pre-couch-gate.sh` — run `gate-n3d-self-hosted.sh` when `MANGO_SELF_HOSTED_ADDONS=1`
- [ ] Update `docs/ELFHOSTED.md` — "paid fallback" section at top
- [ ] Update `docs/HARDWARE.md` ElfHosted paragraph → pointer to N3d
- [ ] Update `docs/tasks/README.md` row for N3d
- [ ] Set `MANGO_SELF_HOSTED_ADDONS=1` in `~/.config/mango/voice.env` on Pi

**Gate:** `bash scripts/pi-exec-gate.sh` from Mac

---

## Commit message style

```
N3d-Sn: <short why-focused subject>

Optional body: gate command + any operator step left manual.
```

---

## Forbidden

- Committing `/etc/mango/*` or debrid/Easynews credentials
- `rsync` deploy to Pi
- Weakening N3c verified-only surfacing to pass gates
- Public ElfHosted URLs in `stremio-export.example.json` as default
