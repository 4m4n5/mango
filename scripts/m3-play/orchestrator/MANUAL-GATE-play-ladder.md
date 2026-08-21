# Manual gate — automatic playback ladder

This is Pi/TV evidence, not a Mac-only source check. Run it on the exact deployed
revision after the automated ladder gates and while a human can see the TV.
Choose fixtures from the **current verified library**; a hard-coded title or a
fixed time-to-first-frame is not a durable playback contract.

## Automated prerequisites

```bash
bash scripts/m3-play/orchestrator/gate-m3-play-ladder.sh
bash scripts/m3-play/playability/gate-m3-verify-ladder.sh
bash scripts/m3-play/orchestrator/gate-m3-play.sh
```

Record `git rev-parse HEAD`, the active filter profile, and gate output with the
couch result. A pass on another SHA is historical evidence only.

## Couch checks

1. **Deferred foreground** — press **B once** on a currently verified movie. The
   launcher stays visible and responsive while Mango resolves and probes. It
   yields the TV only after mpv has advancing media; there is no black screen,
   return to Detail, or late surprise playback.
2. **Exact episode** — choose a specific episode and press **B once**. The same
   season/episode starts; no bare-series substitution occurs.
3. **Ranked fallback** — use a fixture whose first candidate is known to fail but
   a later compatible candidate works. Mango stays inside one accepted play
   session and one deadline, then starts the later candidate without another
   couch press.
4. **Transient aggregate empty** — when logs show a clean HTTP-200 empty or a
   proven-transient placeholder, automatic Movie/Episode Play may make the
   initial resolve plus at most two delayed confirmations. If a later pass finds
   a playable stream, that same **B** press starts it. Rate limits, auth/config
   faults, permanent provider errors, malformed media, cancellation, and an
   exhausted deadline must fail closed without blind retries.
5. **Cancel/return ownership** — press **Y** while resolution is still pending,
   then wait beyond the prior resolve window. No stale worker may launch mpv.
   After a normal playback exit, focus returns to the initiating Detail item.
6. **HUD and Streams** — after playback starts, verify the cinematic HUD and the
   five-choice in-mpv Streams drawer. A switch/Undo retains the same logical
   watch session; Live and YouTube ignore **X**.

Useful count/identity-only diagnostics:

```bash
journalctl --user -u mango-catalog.service --since "10 minutes ago" --no-pager \
  | grep '"component":"catalog-playback"'
```

Look for one `play_request_start`, bounded `stream_resolve_retry` events only
when classified, and one foreground owner. Do not paste stream URLs or provider
credentials into a report.

## Maintenance after a genuine miss

Do not rebuild or delete runtime state. Inspect the verified corpus and use a
targeted, idle-only top-up when the evidence shows a stale title/path:

```bash
python3 scripts/diag/playability-status.py
bash scripts/m3-play/playability/playability-top-up-rail.sh movies-india-trending --pool-target 20
```

Full stale/bootstrap maintenance is disruptive and belongs to an explicitly
authorized idle window; see [`docs/features/content-and-playback.md`](../../../docs/features/content-and-playback.md).
