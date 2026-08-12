# MediaFusion India-regional trial (historical secret-manifest experiment)

> **Superseded wiring:** the old credential-bearing share-manifest override
> expired with HTTP 404. Current source instead configures AIOStreams' native
> non-secret MediaFusion base URL, lets AIO supply its existing TorBox/RD
> services, restricts the preset to cached-search-only movie/series streams,
> and performs transactional readback/rollback. The measurements and manual
> share-URL steps below remain historical evidence, not the current runbook;
> use `scripts/m4-addons/configure-aiostreams.md`.

> **Why:** `series-india-picks` is ~80% Hindi with only ~11% regional (Tamil/Telugu/Malayalam/Kannada);
> Bharat Binge regional catalogs are wired but yield ~0 verified titles because those releases don't
> resolve to TorBox-cached streams. This is a **stream-supply** gap, not a selection gap — adding more
> mdblist lists won't help (metadata over the same streams). MediaFusion adds real regional **stream
> sources** (TamilMV/TamilBlasters scrapers, TorBox-native, cached-only).
>
> **Posture:** identical legal surface to the torrentio-class scrapers mango already uses — this widens
> language coverage of an existing surface, not a new one. Cached-only policy is
> intended to reduce uncached TorBox work, but only account/runtime evidence can
> prove quota behavior. The trial must remain reversible.

## Historical measured state (was enabled as a stream source)

MediaFusion was measured as a third stream scraper in AIOStreams alongside Torrentio and
Comet. It was wired via a fully-configured **ElfHosted TRB+RD manifest** (RD + TorBox baked
into the manifest), pasted into the AIOStreams MediaFusion preset's **URL (Override)** field
(`options.url`). Because the override ends in `/manifest.json`, AIOStreams uses it as a
self-contained external addon and does **not** inject its own userData — MediaFusion owns
its own debrid creds. This avoids the old broken default "MediaFusion P2P" endpoint (502 /
8s timeout) that forced the earlier HOLD.

- **Manifest URL (secret — RD+TorBox embedded):** stored Pi-side at
  `~/.config/mango/mediafusion.manifest` (mode 600). Never committed.
  Host is currently `mediafusion-dev.elfhosted.com` (ElfHosted TRB+RD share).
- **Preset options:** `enabled: true`, `resources: ["stream"]`, `timeout: 8000`,
  `useMultipleInstances: false`.
- **Historical verification (couch path, catalog-service :3020):** contributed ~2 TorBox-cached 4K streams
  per popular title alongside Comet + Torrentio, **zero MediaFusion errors** in AIO logs.

**Catalogs: available but NOT wired.** The current share exposes **46 catalogs** (RD
Watchlist + English/Hindi/Tamil/Telugu/Malayalam/Kannada HD+TCRip+dubbed+old movies,
matching series, plus Arabic/Bangla/Punjabi, TGx, Prowlarr, Live TV/sports). Sample
pages return ~100 metas each. Registering MediaFusion in mango's `stremio-export.json`
would also make it a **direct stream addon** (catalog-service fetches every addon that
advertises `stream`) — duplicate non-deduped streams + extra debrid/rate-limit load
alongside AIOStreams. Keep catalogs out until we either (a) add a catalog-only allowlist
in catalog-service, or (b) decide the India-rail yield gain is worth the duplicate stream
path. Stream benefit stays entirely through AIOStreams.

If an explicitly authorized new trial is opened, re-provision the manifest
(rotate creds / change catalogs), update
`~/.config/mango/mediafusion.manifest` then set the MediaFusion preset `options.url` via the
AIOStreams API (Basic auth: `uuid:password`; password is the AES-decrypted URL token).

## Step 0 — credential-safe baseline

Run interactively on the Pi. Do not export or copy the full AIOStreams
`userData`: it contains credentials and generated URLs. `diff`/`apply` output is
also potentially sensitive and must not be tee'd or pasted into a report.

```bash
cd ~/mango
bash scripts/m4-addons/aiostreams-config.sh verify
jq -c '[.addons[].name]' /etc/mango/stremio-export.json
if [[ -s ~/.config/mango/mediafusion.manifest ]]; then
  echo 'direct MediaFusion file trigger: present'
else
  echo 'direct MediaFusion file trigger: absent'
fi
```

Record only fixed policy/topology summaries and provider-count baselines. A new
trial should use the AIOStreams UI's own operator-controlled backup/restore
facility if one is available for the live version; never create a portable
plaintext copy of the full user object as a rollback artifact.

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
3. With the SSH port-forward open, use AIOStreams at
   `http://127.0.0.1:3035/stremio/configure`:
   - Marketplace → enable **MediaFusion** → expand the row → paste the Share URL into the **URL (Override)** field → Save.
   - (The Override URL path avoids the AIOStreams↔MediaFusion `secret_str=None` bug; MediaFusion owns its own TorBox creds.)

The old `MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY` “belt-and-braces” note was
never wired into the repository's actual `deploy/aiostreams/compose.yaml` or
`.env.example`; do not set or claim it as a current control. Any renewed trial
must prove cached-only behavior from the live MediaFusion/AIO policy and
credential-safe provider/account evidence.

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
2. Do not look for or revert `MEDIAFUSION_FORCED_USE_CACHED_RESULTS_ONLY`; it
   was never a wired Mango control. If some unrelated reviewed repository
   change is required, make it on the Mac and use the normal Git-only deploy.
3. Revoke the `mango-mediafusion-trial` TorBox key.
4. Re-run `aiostreams-config.sh verify`, the URL-free addon-name audit, and the
   same yield/provider counters used for baseline. Confirm MediaFusion is absent
   or disabled without printing the share URL.

_Full research + citations: subagent report (AIOStreams override behaviour, TorBox cached/quota policy,
public-instance rate-limit shape)._
