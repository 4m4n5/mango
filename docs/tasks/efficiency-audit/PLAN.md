# Mango efficiency & lightness audit — exploration plan

**Status:** Active implementation  
**Branch:** `feat/native-experience`  
**Constraint:** read-only until `IMPLEMENTATION_PLAN.md` is approved. No code patches, no Pi mutations. Pi access only via `bash scripts/pi-exec.sh '<read-only cmd>'`. Never `pi-deploy.sh` / `pi-exec-gate.sh`.

This directory holds the audit artifacts. The Cursor plan file is not edited.

## Deliverables

| File | Role |
|------|------|
| [BASELINE.md](BASELINE.md) | Measured Pi baseline before any change |
| [FINDINGS.md](FINDINGS.md) | Issue ledger (one ID per issue) |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Batched patches + Pi deploy sequence |

## Evidence standard

An issue enters FINDINGS.md only after all four:

1. **Mechanism** — exact `path:line` and a causal cost explanation.
2. **Adversarial check** — written attempt to disprove it (hot path? already cached/gated? required by a locked contract?). Survivors get `confidence: high/medium`. Rejected items stay listed so they are not re-found.
3. **User-visible impact** — couch lag, RAM/CPU, thermal, deploy/gate cost, or maintainer complexity.
4. **Measurement** — timed on Pi or a local script when possible; otherwise `unmeasured`.

Each entry: `ID · subsystem · severity (P0–P3) · confidence · effort (S/M/L) · mechanism · adversarial notes · proposed fix direction`.

## Locked contracts (audit inputs, not targets)

Pad bindings, Search couch contract (`docs/SEARCH.md`), git-only deploy, latest-only YouTube v2, mpv-only playback.

## Phases

0. Pi runtime baseline  
1. Launcher  
2. catalog-service hot paths  
3. Background / recurring work  
4. Python runtimes  
5. Playback time-to-first-frame  
6. Voice / companion / Live TV (opt-in)  
7. Data layer  
8. Bloat / dead code / complexity  
9. Network / external calls  
10. Reconcile + independent adversarial re-verification  
11. Implementation & deploy plan  

Live TV and voice are audited but flagged as opt-in surfaces.
