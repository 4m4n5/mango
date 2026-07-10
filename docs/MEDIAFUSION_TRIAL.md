# MediaFusion India-regional trial (measure-first, reversible)

> **Why:** `series-india-picks` is ~80% Hindi with only ~11% regional (Tamil/Telugu/Malayalam/Kannada);
> Bharat Binge regional catalogs are wired but yield ~0 verified titles because those releases don't
> resolve to TorBox-cached streams. This is a **stream-supply** gap, not a selection gap — adding more
> mdblist lists won't help (metadata over the same streams). MediaFusion adds real regional **stream
> sources** (TamilMV/TamilBlasters scrapers, TorBox-native, cached-only).
>
> **Posture:** identical legal surface to the torrentio-class scrapers mango already uses — this widens
> language coverage of an existing surface, not a new one. Cached-only is enforced at three layers so it
> **cannot burn TorBox quota** during nightly grows. Fully reversible in ~2 minutes.

## Current Pi status (HOLD)

Marketplace MediaFusion without a Share Manifest **URL Override** resolves to a broken
default "MediaFusion P2P" endpoint (502 / 8s timeout on every couch resolve). Until a
configured Share Manifest is pasted into AIOStreams, MediaFusion is **disabled** on the
Pi so it cannot burn resolve budget. Comet remains the working secondary scraper.

When re-enabling: set `useCachedResultsOnly: true`, paste the Share Manifest into
**URL (Override)**, keep resources stream-only, then re-run the yield probe below.

## Step 0 — Snapshot (reversibility anchor)
On the Pi (read-only):
```bash
bash scripts/pi-exec.sh 'jq . /etc/mango/stremio-export.json' > /tmp/stremio-export.before.json
bash scripts/pi-exec.sh 'cat ~/.local/share/mango/aiostreams/data/users/*.json' > /tmp/aiostreams-userdata.before.json
```

## Step 1 — Baseline yield (BEFORE MediaFusion)
Build a probe list of 15–20 known Tamil/Telugu/Malayalam/Kannada IMDb ids (mix recent + back-catalogue,
≥1 Kannada). One `tt####### [movie|series]` per line, save as `/tmp/india-probe.txt`. Then, on the Pi:
```bash
bash scripts/diag/india-regional-yield.sh /tmp/india-probe.txt before
```

## Step 2 — Enable MediaFusion (your ~10-min browser config — credentials stay yours)
1. Mint a **dedicated** TorBox API key labeled `mango-mediafusion-trial` (single-click revoke later).
2. Open `https://mediafusion.elfhosted.com/configure`:
   - Providers → **TorBox**, paste the trial key, tick **Only Show Cached Streams**.
   - Catalogs → enable **Tamil, Telugu, Malayalam, Kannada, Hindi** only.
   - Indexers → **TamilMV** + **TamilBlasters** only.
   - Filters → cached only; min res 480p.
   - Copy the **Share Manifest URL** at the bottom.
3. Open AIOStreams `http://<pi>:3035/stremio/<user>/configure` (SSH port-forward):
   - Marketplace → enable **MediaFusion** → expand the row → paste the Share URL into the **URL (Override)** field → Save.
   - (The Override URL path avoids the AIOStreams↔MediaFusion `secret_str=None` bug; MediaFusion owns its own TorBox creds.)

**Belt-and-braces (agent will wire on GO):** `MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY=true` in
`deploy/aiostreams/docker-compose` env. mango's existing `aiostreams-target-patch.json` already strips
uncached-debrid streams (`excludeUncachedFromStreamTypes: ["debrid"]`).

## Step 3 — After yield + delta
```bash
MANGO_INDIA_PROBE_BASELINE=/tmp/india-yield-before.tsv \
  bash scripts/diag/india-regional-yield.sh /tmp/india-probe.txt after
```
**GO bar:** ≥60% of the probe list returns ≥1 stream **and** ≥+30pp vs the before run.

## Step 4 — Decision
- **GO:** wire regional supply into rails (weights / a Tamil/Telugu-forward rail), then add the
  language-aware selection cap so india rails actually *surface* the new regional titles. Consider
  self-hosting MediaFusion before promoting past trial (avoids public 429s during nightly grow).
- **HOLD:** keep MediaFusion in the stream plane only (helps ad-hoc plays); don't touch rails.
- **SKIP:** run rollback.

## Rollback (~2 min)
1. AIOStreams `/configure` → Marketplace → disable MediaFusion → Save.
2. If env changed: revert the `MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY` line, push, `pi-deploy.sh --fast`.
3. Revoke the `mango-mediafusion-trial` TorBox key.
4. `diff /tmp/aiostreams-userdata.before.json <current>` to confirm state matches pre-trial.

_Full research + citations: subagent report (AIOStreams override behaviour, TorBox cached/quota policy,
public-instance rate-limit shape)._
