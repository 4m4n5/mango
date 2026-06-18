# N1 inventory — catalog + play spike

**Branch:** `feat/native-experience`  
**Gate:** `bash scripts/phase-n1/gate-n1-smoke.sh`  
**Spec:** [`tasks/phase-n1-catalog-play-spike.md`](tasks/phase-n1-catalog-play-spike.md)

---

## Plan

> Codex / agent: write implementation plan here **before** feature code.  
> Include: risks, spike status, pinned title ID, stremio-core version, mpv socket path, pad diff summary.

_(not started)_

---

## Spike log

| Spike | Date | Result | Notes |
|-------|------|--------|-------|
| S0 mpv HTTP | | | |
| S1 stremio-core | | | |
| S2 meta+stream | | | |
| S3 mpv RD | | | |
| S4 catalog-service | | | |
| S5 pad+home | | | |
| S6 gate | | | |

### Pinned smoke title

| Field | Value |
|-------|-------|
| Type | `movie` |
| Cinemeta ID | _(e.g. tt0111161)_ |
| Title | |
| Stream URL shape | RD HTTP |
| TTFF ms | |

---

## Prereq status (Pi)

| Check | Status | Notes |
|-------|--------|-------|
| SSH `mango` | | |
| `gate-n0.sh` | | |
| `mpv` + `socat` | | `install-n1-prereqs.sh` |
| `node` ≥ 20 | | |
| `/etc/mango/stremio-export.json` | | `setup-stremio-export.sh` |
| `check-n1-prereqs.sh` | | |

---

## Metrics (after N1)

| Metric | Value |
|--------|-------|
| `gate-n1-smoke.sh` | |
| `gate-n0.sh` | |
| Stream resolve ms | |
| Play TTFF ms | |
| ⌂ home ms | |
| catalog-service RSS MB | |

---

## Waivers

| ID | Check | Reason | Owner |
|----|-------|--------|-------|
| | | | |

---

## N1-C2 couch note (manual)

- [ ] `POST /play` → film on TV
- [ ] ⌂ → mango home
- [ ] Voice PTT still works
- [ ] No Stremio window during test
