# Manual gate — play preference ladder (Phase 1 + 2)

Run after `gate-n3a-play-ladder.sh` and `gate-n3c-verify-ladder.sh` pass on Mac, and after Pi deploy.

## Automated prerequisites

```bash
bash scripts/phase-n3a/gate-n3a-play-ladder.sh
bash scripts/phase-n3c/gate-n3c-verify-ladder.sh
bash scripts/phase-n3a/gate-n3a-play.sh   # live couch play on Pi
```

## Couch manual checks

1. **Ideal step** — pick a verified title (e.g. Shawshank). Status should reach `playing` within ~15s. No `trying alternate release…`.
2. **Ladder fallback** — play **The Dark Knight** (`tt0468569`). Expect ladder status messages then playback (may use `2160p_encode` step).
3. **Cancel** — press Y during long play resolve; mpv should stop.
4. **Rails** — verified home-rail titles should play without generic failure.

## Verify maintenance

```bash
# Full stale refresh + bootstrap (long — prefer targeted rail top-up)
MANGO_MAINTENANCE_SKIP_GATE=1 bash scripts/phase-n3c/playability-maintenance.sh --mode stale --bootstrap

# Targeted low_water rail (bootstrap re-probes recent failures)
bash scripts/phase-n3c/playability-top-up-rail.sh movies-india-trending --pool-target 20

python3 scripts/diag/playability-status.py
```
