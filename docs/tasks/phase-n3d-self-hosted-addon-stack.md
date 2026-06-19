# Phase N3d — Self-hosted addon stack (Free Path A)

**Status:** Not started
**Branch:** `feat/native-experience`
**Roadmap:** [`NATIVE_ROADMAP.md`](../NATIVE_ROADMAP.md) — stream/catalog plane under N3c
**Codex:** [`CODEX-phase-n3d-prompt.md`](CODEX-phase-n3d-prompt.md) · [`CODEX-phase-n3d-initial-prompt.md`](CODEX-phase-n3d-initial-prompt.md)
**Prerequisite:** N2b rails shipped · N3c playability indexer shipped · Pi has Docker · TB + RD + Easynews keys in `/etc/mango/config.yaml`

**Product principle:** Couch browse + play must not depend on ElfHosted public rate limits. User already pays for debrid/usenet — mango hosts the **aggregation layer** on the Pi for $0.

### Locked design choices (2026-06-19)

| Decision | Choice |
|----------|--------|
| Stream aggregator | **Self-hosted [AIOStreams](https://github.com/Viren070/AIOStreams)** on Pi (`127.0.0.1`) |
| Catalog adapter | **AIOLists** (OSS) for mdblist rails; **India OTT Catalog** for India trending |
| ElfHosted | **Removed from hot path** — docs retain paid fallback note |
| Secrets | TB / RD / Easynews in `/etc/mango/config.yaml` only — never in git |
| Stremio export | `/etc/mango/stremio-export.json` — localhost manifest URLs OK (catalog-service server-side) |
| Compute | AIOStreams + AIOLists idle when couch idle; maintenance may spike CPU — gate enforces headroom |

---

## 1. Objective

Replace ElfHosted-hosted **AIOStreams** and **AIOMetadata** with self-hosted equivalents so:

1. **Stream resolve** never returns `public-rate-limit-exceeded.mp4`.
2. **N3c maintenance** can probe and flush `playability.db` without hanging.
3. **12 thematic rails** keep mdblist + India coverage via free catalog addons.
4. **Easynews** (already paid) is wired inside AIOStreams for extra playability yield.
5. **Automated gates** prove stream + catalog planes before couch handoff.

### Success definition

| Artifact | Requirement |
|----------|-------------|
| `deploy/aiostreams/` | Docker Compose + `.env.example` + install script |
| `deploy/aiolists/` | Docker Compose + configure flow for mdblist IDs |
| `mango-aiostreams.service` | systemd user unit — start on boot, restart on failure |
| `mango-aiolists.service` | systemd user unit (catalog plane) |
| `/etc/mango/stremio-export.json` | Local manifests; names match `catalog.yaml` + filters |
| `config/catalog.example.yaml` | No `AIOMetadata \| ElfHosted` — AIOLists + India OTT ids |
| `config/catalog-filters.example.json` | Tiers reference `AIOStreams` (local), not ElfHosted |
| `gate-n3d-self-hosted.sh` | Stream + catalog smoke on Pi |
| `scripts/phase-n3d/check-n3d-prereqs.sh` | Docker, ports, secrets present |
| Docs | `ELFHOSTED.md` → paid fallback; new `N3d-INVENTORY.md` |

### Couch acceptance (N3d)

| # | Test | Pass |
|---|------|------|
| C1 | `GET /stream/movie/tt0111161` — no `rate-limit-exceeded` in any candidate URL | |
| C2 | Sample play from Cinemeta rail + India rail ≤15 s | |
| C3 | `playability-maintenance.sh --mode stale` completes without hung mpv >20 s | |
| C4 | `pi-pre-couch-gate.sh` PASS with `MANGO_CATALOG=1` | |
| C5 | Idle: AIOStreams container running; mem available ≥2.5 GB | |

---

## 2. Non-goals (N3d)

- Removing Torrentio TB/RD addons (keep as fallback tiers)
- Self-hosting MediaFusion / Comet / bundle extras
- `tmdb_list` rail type in catalog-service (defer)
- HTTPS / public URL for addons (localhost-only V1)
- Migrating Pi off SD card to NVMe (note in ops, don't block)

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Pi 5                                                         │
│  Chromium launcher :3000                                     │
│  catalog-service :3020 (stremio-core)                        │
│    ├─ Cinemeta (remote, free)                                │
│    ├─ AIOLists :3036 (local docker) — mdblist catalogs       │
│    ├─ India OTT addon (remote or local) — India trending     │
│    ├─ Torrentio TB/RD (remote) — fallback streams           │
│    └─ AIOStreams :3035 (local docker) — primary streams      │
│         ├─ TorBox / Real-Debrid (user keys)                    │
│         └─ Easynews Search (user keys)                         │
│  mpv — play + N3c probes                                       │
└─────────────────────────────────────────────────────────────┘
```

**Why Pi-local AIOStreams beats VPS:** Torrentio blocks many datacenter IPs ([AIOStreams deployment docs](https://docs.aiostreams.viren070.me/getting-started/deployment/)); home IP + localhost manifest avoids ElfHosted rate limits and IP blocks.

**Persistence:** AIOStreams v2 requires volume on `/app/data` ([migrate wiki](https://github.com/Viren070/AIOStreams/wiki/Migrate-to-V2)).

---

## 4. Phased delivery

### Plane A — Stream aggregator (N3d-S0 → S2)

| Slice | Deliverable | Gate |
|-------|-------------|------|
| **S0** | Prereqs script, port plan, `deploy/aiostreams/` skeleton | `check-n3d-prereqs.sh` |
| **S1** | AIOStreams docker + systemd; configure TB/RD/Easynews via UI once | `curl :3035/api/v1/status` |
| **S2** | `stremio-export` + `catalog-filters` migration; catalog-service resolves local AIOStreams | `gate-n3d-streams.sh` |

### Plane B — Catalog adapters (N3d-S3 → S4)

| Slice | Deliverable | Gate |
|-------|-------------|------|
| **S3** | AIOLists docker + systemd; import mdblist IDs from current yaml | `gate-n3d-catalogs.sh` (mdblist rails) |
| **S4** | India OTT addon in export; `catalog.example.yaml` migration | `gate-n2-browse.sh` (12 rails) |

### Plane C — Playability + couch (N3d-S5 → S6)

| Slice | Deliverable | Gate |
|-------|-------------|------|
| **S5** | Maintenance run `stale`; `poll-maintenance.py`; no rate-limit probes | manual + JSON `verified>0` |
| **S6** | `pi-pre-couch-gate.sh` wires `gate-n3d`; docs inventory | `pi-exec-gate.sh` |

---

## 5. Config contracts

### Addon names (must match across export, yaml, filters)

| Old (ElfHosted) | New (self-hosted) |
|-----------------|-------------------|
| `AIOStreams \| ElfHosted` | `AIOStreams` |
| `AIOMetadata \| ElfHosted` | `AIOLists` (+ `India OTT` where noted) |

### Ports (locked)

| Service | Port | Notes |
|---------|------|-------|
| launcher | 3000 | unchanged |
| catalog-service | 3020 | unchanged |
| AIOStreams | **3035** | `BASE_URL=http://127.0.0.1:3035` |
| AIOLists | **3036** | configure UI → manifest |

### stremio-export.json (example shape — no secrets)

```json
{
  "addons": [
    { "name": "Cinemeta", "manifestUrl": "https://v3-cinemeta.strem.io/manifest.json" },
    { "name": "Torrentio TB", "manifestUrl": "https://torrentio.strem.fun/..." },
    { "name": "Torrentio RD", "manifestUrl": "https://torrentio.strem.fun/..." },
    { "name": "AIOStreams", "manifestUrl": "http://127.0.0.1:3035/stremio/<user>/manifest.json" },
    { "name": "AIOLists", "manifestUrl": "http://127.0.0.1:3036/..." },
    { "name": "India OTT", "manifestUrl": "https://..." }
  ]
}
```

Manifest path after AIOStreams configure is copied from the install UI — gate script validates reachability, not a hardcoded path.

---

## 6. Gate scripts

### `scripts/phase-n3d/check-n3d-prereqs.sh`

- Docker installed and user in `docker` group
- Ports 3035/3036 free
- `/etc/mango/config.yaml` has debrid keys (names only — don't print values)
- `MANGO_CATALOG=1` in voice.env

### `scripts/phase-n3d/gate-n3d-streams.sh`

- AIOStreams `/api/v1/status` OK
- `GET http://127.0.0.1:3020/stream/movie/tt0111161` — parse JSON; **fail** if any URL matches `rate-limit-exceeded`
- Optional: one `POST /play` smoke (Shawshank or gate fixture id)

### `scripts/phase-n3d/gate-n3d-catalogs.sh`

- For each mdblist-backed rail id: `GET /rails/:id/items` returns ≥1 item (may be unverified pre-maintenance)
- India rail: `movies-india-trending` returns ≥1 item

### `scripts/phase-n3d/gate-n3d-self-hosted.sh`

- Runs prereqs + streams + catalogs + `gate_idle_hygiene` from `gate-common.sh`

Wire into `pi-pre-couch-gate.sh` when `MANGO_CATALOG=1` and `/etc/mango/aiostreams.enabled` exists (or env `MANGO_SELF_HOSTED_ADDONS=1`).

---

## 7. Ops

```bash
# Install / upgrade (Pi)
bash scripts/phase-n3d/install-aiostreams.sh
bash scripts/phase-n3d/install-aiolists.sh

# Configure (browser on Pi or SSH tunnel — one-time)
# AIOStreams: http://127.0.0.1:3035/stremio/configure
# AIOLists:    http://127.0.0.1:3036/configure

# Gates
bash scripts/phase-n3d/gate-n3d-self-hosted.sh
bash scripts/pi-pre-couch-gate.sh

# Fill pools after stream plane is healthy
bash scripts/phase-n3c/playability-maintenance.sh --mode full
```

---

## 8. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Pi RAM during maintenance | probe concurrency=1 (already); gate mem ≥2.5 GB idle |
| SD wear | data volumes under `~/.local/share/mango/`; document NVMe later |
| AIOLists catalog id ≠ AIOMetadata `mdblist.*` | mapping table in `config/catalog.example.yaml` comments |
| India OTT scraper flaky | composite rail keeps Cinemeta/year fallback weight |
| User skips Easynews in AIOStreams UI | gate warns, does not fail |

---

## 9. References

- [AIOStreams deployment](https://docs.aiostreams.viren070.me/getting-started/deployment/)
- [AIOLists GitHub](https://github.com/SebastianMorel/AIOLists)
- [India OTT Catalog addon](https://github.com/FissionMailed7/India-ott-catalog-addon)
- mango: [`ELFHOSTED.md`](../ELFHOSTED.md) · [`N3c-INVENTORY.md`](../N3c-INVENTORY.md) · [`N2-INVENTORY.md`](../N2-INVENTORY.md)
