# Live shelves restore — Codex report

## Baseline

- Branch: `feat/native-experience` (verified; not switched).
- Baseline SHA: `0abc66134433d6fe7dc3eca0e33028838f2b13e8` (`Make the Pi handoff path portable`).
- Baseline catalog build: `cd src/catalog-service && npm run build` — PASS.
- Baseline catalog tests: `npm test` — PASS, 656/656.
- No Pi, SSH, deploy, package install, commit, or push was performed.

## S1 — Diagnosis

The browse-path cause is qualification plus empty-rail hiding, not launcher filtering:

- `src/catalog-service/src/live/qualification.ts:110-131` admits World Cup, India cricket, and soccer only through current-event/matchup evidence; standing FIFA+, Willow, and beIN therefore fail. The cartoon policy requires positive EN/HI evidence at `:103-107` and `:130-131`.
- `src/catalog-service/src/live-rails.ts:452-488` filters candidates through `qualifiesLiveChannel()`, so keyword/source matches do not bypass those policies. The source-fill path delegates to the same matcher at `:417-449`.
- `src/catalog-service/src/core.ts:1755-1767` partitions and verifies rails, then skips a rail when the matched or verified list is empty. The launcher receives only the resulting server rails; `src/launcher/src/catalog.ts` does not invent or remove these server-side memberships.

Standing identities in `config/live-sports-curated.m3u` and their intended fill rails:

| Curated identity | Rail |
|---|---|
| FIFA+; FIFA+ United States | `live-world-cup` |
| Star Sports 1; Star Sports 1 Hindi; Star Sports 2 HD | `live-cricket` |
| Willow Sports; DD Sports SD; Cricket Gold | `live-cricket` |
| beIN Sports USA | `live-football` |

The exact canonical matching forms are handled after the S2 change; quality/status suffixes are collapsed by `canonicalLiveTitle()` (`qualification.ts:48-57`).

Cartoon inventory delta: `CARTOON_ALLOWLIST` contains Tom and Jerry plus Nickelodeon Pluto TV, Nicktoons, Nick Jr, PBS Kids Eastern/Central, HappyKids, Kartoon Channel, and Moonbug Kids (`qualification.ts:29-32`). The committed `config/live-cartoons.m3u` contains the latter seven families but no Tom and Jerry row. The builder targets Tom and Jerry first (`scripts/live/build-curated-cartoons-m3u.py:22-30`), but its current positive-language requirement can omit a source with missing metadata; S3 will align that behavior with the new unknown-language admission without inventing a URL.

`LIVE_RAILS_POLICY_VERSION` must bump: changing sports membership from event-only to hybrid fill and changing cartoon language semantics makes existing disk-cache membership incompatible.

## S2 — Hybrid sports membership

- Added exact canonical standing fill allowlists in `src/catalog-service/src/live/qualification.ts:29-42`: FIFA/FIFA United States, Star Sports 1/1 Hindi/2, Willow Sports/Cricket, DD Sports, Cricket Gold, and beIN Sports/beIN Sports USA.
- Sports qualification now composes current-event admission with standing fill admission (`qualification.ts:110-171`). Explicit wrong FIFA events, foreign cricket matchups, MLS-only soccer, replay/ended/non-live rows remain rejected.
- `src/catalog-service/src/live-rails.ts:14-28,396-512` applies the same policy to match, match-all, and source-fill paths. Current-event rows are partitioned ahead of standing rows, then quality-sorted within each phase; caps remain config-defined.
- Tests cover standing-only fill, live-first hybrid ordering, source-fill behavior, exact identity bounds, junk rejection, and empty/limited behavior in `src/catalog-service/src/live-rails.test.ts` and `src/catalog-service/src/live/qualification.test.ts`.

## S3 — Cartoons restore

- `qualification.ts:103-108` now admits absent/unknown language evidence, while any supplied language evidence must be exclusively EN/HI. Spanish and other known non-EN/HI values remain rejected; the exact eight-family allowlist is unchanged.
- `scripts/live/build-curated-cartoons-m3u.py:143-151,166` now preserves an upstream row with no language metadata without adding a false language attribute, while continuing to reject known localized feeds. Builder unit tests cover Moonbug unknown-language admission and foreign-feed rejection.
- Tom and Jerry remains absent from the committed `config/live-cartoons.m3u`. This is deferred: the local committed inventory has no authoritative Tom-and-Jerry URL, and no live upstream/Pi inventory probe was used to invent one. The builder will select it when an eligible upstream source block is available.

## S4 — Cache, docs, and confirmation checklist

- Bumped `LIVE_RAILS_POLICY_VERSION` from 2 to 3 in `src/catalog-service/src/live-rails-cache.ts:22`; `live-rails-cache.test.ts` proves v2 payloads are incompatible.
- Updated `docs/LIVE_TV.md`, `docs/COUCH_TEST.md`, and the Native Live note in `docs/PLAYABILITY.md` for hybrid sports, unknown-language cartoons, profile re-application, cache rebuild, and Pi-only rail-count confirmation.
- No Pi inventory counts are claimed. The report and docs mark Pi confirmation deferred and provide the exact `curl`, `audit-live-rails.sh`, and `nexotv-config.sh apply-*` steps for the home Mac/Pi reviewer.

## Validation

- `cd src/catalog-service && npm run build` — PASS.
- `cd src/catalog-service && node --test dist/live/qualification.test.js dist/live-rails.test.js dist/live-rails-cache.test.js` — PASS, 28/28.
- `cd src/catalog-service && npm test` — PASS, 660/660.
- `cd src/catalog-service && npm run test:gate` — PASS, gate suite 304/304.
- `python3 scripts/live/test_build_curated_cartoons_m3u.py` — PASS, 4/4.
- `cd src/launcher && npm run build && bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh` — PASS; 15/15 launcher tests, with only expected local warnings that launcher/Pi pad were not running.
- `python3 scripts/live/test_build_curated_sports_m3u.py 2>/dev/null || true` — no output/verified result recorded because the repository does not provide a usable sports-builder test result in this environment.

## Deferred / residual risks

- `deferred — Pi is unreachable from this work Mac; NexoTV profile health, actual rail inventories, playback reachability, and couch behavior were not measured.`
- `deferred — Tom and Jerry committed M3U alignment; no dead URL was added without authoritative source proof.`
- The reviewer/home Mac must deploy through the documented git-only flow, re-apply any drifted curated NexoTV profiles, rebuild the cache, and run the Live shelf confirmation checklist before claiming non-empty Pi rails.

No commit or push was made; the worktree is intentionally left for review.
