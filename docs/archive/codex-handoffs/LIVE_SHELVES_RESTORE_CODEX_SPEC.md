# Codex implementation brief — restore Live sports + cartoons shelves (hybrid membership)

You are an autonomous coding agent working in the **mango** repository at
`/Users/aman.shrivastava/Documents/personal/projects/mango`. You have **no prior context**.
This file is the entire contract. **Read it top to bottom before writing any code.**

Mango is an AI TV box on a Raspberry Pi 5. This machine is a **work Mac that cannot reach the Pi**.
You work **locally only** (edit / build / test / gates). A separate reviewer verifies, commits, and
hands off to a home Mac that deploys to the Pi. You never SSH, deploy, or run Pi scripts.

---

## §0 — TL;DR mission

After the Jul 16 Live redesign (`2a40434 Harden playback identity and curate native Live`), the Live
tab became **thin, event/allowlist-gated shelves**. Standing FIFA+/Star Sports/beIN brand channels
and cartoons missing language metadata are rejected by design, so World Cup / cricket / soccer /
cartoon rails often qualify **zero** channels and are **hidden** by catalog-service. Couch users
see no FIFA World Cup, cricket, soccer, or cartoon channels at all.

**Success:** those rails always show something principled to watch — current live matches first when
present, curated standing brand channels filling the remainder; cartoons from the classics allowlist
even when language metadata is missing (still reject known non-EN/HI). Thin redesign preserved;
junk not re-admitted.

Workstreams, in dependency order:

1. **S1 — Diagnose against code + fixtures** (confirm root cause; no speculative rewrites).
2. **S2 — Hybrid sports membership** (World Cup / cricket / soccer): live matches first, standing brands fill.
3. **S3 — Cartoons restore** (exact allowlist; admit unknown language; inventory alignment).
4. **S4 — Cache / docs / Pi confirmation checklist**.
5. **S5 — Report**.

## §0.1 — Overriding principle (non-negotiable)

**Restore always-useful Live shelves without re-opening the floodgates that forced the redesign.**

- Prefer current live matchups when they exist; standing brands are **fill**, not replacement.
- Never re-admit women’s/club/qualifier FIFA, MLS-only soccer noise, non-India cricket, replays/ended rows, or random kids channels.
- Keep rail limits (8/8/8 for WC/cricket/soccer/cartoons; 4 for F1; 12 for news). Do not raise caps.
- Empty rails may still hide only when **both** live and standing pools are empty after inventory failure.
- Unmeasurable Pi-only evidence → `deferred — <exact reason>` in the report + `docs/COUCH_TEST.md` / `docs/LIVE_TV.md` confirmation steps. Never fabricate a green Live inventory.

---

## §1 — Hard constraints

### MUST NOT
- **No SSH to the Pi. No `scripts/pi-*.sh`. No rsync/scp.** No deploy.
- **Do not commit, push, tag, `git config`, `git commit --amend`, or `--no-verify`.** Leave work in the tree.
- **Do not switch branches.** Verify `git branch --show-current` is `feat/native-experience`. If not, **STOP**.
- **Do not add dependencies.**
- **Do not broaden sports to “any sports channel” keywords.** Standing fill must be **exact curated allowlists** derived from `config/live-sports-curated.m3u` (+ documented AREA69 standing brands if already in inventory), not open keyword dumps.
- **Do not change** pad/input, VOD play ladder, debrid policy, or tuned numeric play budgets.
- **Do not weaken** F1 / news exact allowlists (leave them as-is unless a shared helper requires a tiny refactor with identical behavior).
- **Do not fabricate** live channel inventories or claim Pi rails are non-empty without local unit-test proof.

### MUST
- Work locally: implement → build → test after each workstream (§3).
- Ground every change in primary source; cite file:line in the report.
- Keep changes minimal and principled; reuse existing qualification / match / finalize helpers.
- Bump live rails **policy version** so incompatible empty/stale disk caches cannot silently win after deploy.
- Update unit tests that currently assert standing brands fail (they must become true under the new hybrid fill semantics — carefully, without admitting junk).
- Append progress to `LIVE_SHELVES_RESTORE_CODEX_REPORT.md` as you go.

### Tool authority
- **May run:** `npm`/`node`/`tsc`, catalog tests/gates, `bash -n`, `python3`, `rg`, read-only `git status`/`diff`/`log`/`branch`, local M3U builder tests under `scripts/live/`.
- **Must not run:** Pi SSH/deploy, mutating git, package installs, live IPTV probes that require the Pi (`MANGO_LIVE_GATE=1` / `MANGO_LIVE_PROBE=1` against remote).

---

## §2 — Repository map (absolute paths)

### Config / inventory
- `/Users/aman.shrivastava/Documents/personal/projects/mango/config/catalog-live.example.yaml` — Live rails (Pi: `/etc/mango/catalog-live.yaml`). Rails: `live-world-cup`, `live-cricket`, `live-football`, `live-racing`, `live-news`, `live-cartoons`.
- `/Users/aman.shrivastava/Documents/personal/projects/mango/config/live-sports-curated.m3u` — free sports inventory (Star Sports, Willow, DD Sports, Cricket Gold, FIFA+, beIN Sports USA).
- `/Users/aman.shrivastava/Documents/personal/projects/mango/config/live-cartoons.m3u` — kids inventory (Nick Pluto, Nicktoons, Nick Jr, PBS Kids, HappyKids, Kartoon Channel, Moonbug; **Tom and Jerry currently missing from committed file**).
- `/Users/aman.shrivastava/Documents/personal/projects/mango/config/nexotv-profiles.example.json` — NexoTV profile ids (`m3u-sports-curated`, `m3u-cartoons`, …).

### Catalog-service Live core
- `.../src/catalog-service/src/live/qualification.ts` — `qualifiesLiveChannel()`, allowlists, competition regexes, language gate (`hasEnglishOrHindiEvidence`).
- `.../src/catalog-service/src/live/qualification.test.ts` — **currently asserts FIFA+/Willow/beIN alone are false**; will need updating for hybrid fill.
- `.../src/catalog-service/src/live-rails.ts` — `matchChannelsToRail`, `matchChannelsWithSourceFill`, `matchAllChannelsToRail`, `finalizeLiveRailListing`, `partitionChannelsBySportRails`, `normalizeLiveChannelMeta`.
- `.../src/catalog-service/src/live-rails.test.ts` — rail matching/partition tests.
- `.../src/catalog-service/src/live-rails-cache.ts` — `LIVE_RAILS_POLICY_VERSION` (currently `2`); disk cache compatibility.
- `.../src/catalog-service/src/core.ts` — `liveTabRailItems()` (~L1733–1811) **skips empty rails** at L1760–1766; `fetchTaggedLiveChannels`.
- `.../src/catalog-service/src/live/quality-rank.ts` — quality sort / title dedupe.
- `.../src/catalog-service/src/live/ai-catalog-rails.ts` — AI cricket merge into `live-cricket`.

### Scripts / docs
- `scripts/live/build-curated-sports-m3u.py`, `build-curated-cartoons-m3u.py`, `test_build_curated_*.py`
- `scripts/live/audit-live-rails.sh` — dump rail labels + counts (Pi)
- `docs/LIVE_TV.md` — membership contract (~L175–184) must be updated
- `docs/COUCH_TEST.md` — add home-Mac/Pi confirmation steps
- `docs/PLAYABILITY.md` — Live note if membership wording drifts

### Launcher
- `src/launcher/src/catalog.ts` `loadCatalogRails('live')` — trusts server; empty rails already omitted upstream. No launcher redesign required unless a bug is found.

---

## §3 — Environment, build, test, gates

```bash
git branch --show-current   # must be feat/native-experience

cd src/catalog-service
npm run build
npm test
# focused while iterating:
node --test dist/live/qualification.test.js dist/live-rails.test.js dist/live-rails-cache.test.js
npm run test:gate
cd ../..

# M3U builder unit tests (if you touch builders)
python3 scripts/live/test_build_curated_cartoons_m3u.py
python3 scripts/live/test_build_curated_sports_m3u.py 2>/dev/null || true

# UX smoke still green (Live is server-side)
cd src/launcher && npm run build && bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh
cd ../..
```

Gotchas:
- Always `npm run build` before `npm test` (clean-dist avoids stale `dist/*.test.js`).
- Gate-lite (`npm run test:gate`) includes `dist/live-rails.test.js` but may **not** include `qualification.test.js` — still run the focused qualification tests every time you touch that file; consider adding `dist/live/qualification.test.js` to `scripts/lib/gate-catalog-unit.sh` if missing.
- You cannot prove Pi NexoTV inventories locally; unit-test the membership logic + document Pi audit commands.

---

## §4 — Background & current state

### Redesign behavior (why channels vanished)
`qualifiesLiveChannel` (`live/qualification.ts`):

| Policy | Today |
|--------|-------|
| `fifa_mens_world_cup` | Current senior men’s WC matchup only. Standing `FIFA+` → **false** (test L17). |
| `india_cricket` | India + cricket + current matchup in name/EPG. Standing `Willow` / bare Star Sports → **false**. |
| `main_soccer` | Current Big Five / UCL / UEL only. Standing `beIN Sports` → **false**. |
| `english_hindi_cartoons` | Exact allowlist **and** positive EN/HI language evidence. Missing languages → **false** (test L96). |

`liveTabRailItems` then **omits** rails with zero matches (`core.ts` L1760–1766).

Curated free inventory **does** contain standing brands (`config/live-sports-curated.m3u`: FIFA+, Star Sports, Willow, beIN, …) and cartoons (`config/live-cartoons.m3u`). The filter, not the inventory absence alone, is the primary browse-path cause. (Inventory gaps like missing Tom and Jerry are a secondary cartoon issue.)

### Locked product decisions (from the operator)
1. **Sports = hybrid shelves:** prefer current live matches first; if none or too few, fill remaining slots with curated standing brand channels for that sport.
2. **Cartoons = exact allowlist + admit unknown language:** keep classics allowlist; only reject known non-EN/HI; fix inventory so Tom and Jerry / allowlist families are present when the builder can provide them.

---

## §5 — Existing tooling to reuse

| Need | Reuse | Notes |
|------|-------|-------|
| Event admission | `qualifiedCurrentEvent`, competition regexes, `eventMetadataProvesCurrent` | Keep as Phase A |
| Exact identity | `canonicalLiveTitle`, `exactAllowed` | Use for standing brand allowlists |
| Rail fill / caps | `matchChannelsToRail`, `matchChannelsWithSourceFill`, `finalizeLiveRailListing`, `partitionChannelsBySportRails` | Prefer extending here over duplicating |
| Quality order | `sortLiveChannelsByQuality`, `dedupeLiveChannelsByCanonicalKey` | Live matches should rank above standing fills when both present |
| Language helper | `hasEnglishOrHindiEvidence` | Change to three-state: positive EN/HI / known foreign / unknown |
| Cache invalidation | `LIVE_RAILS_POLICY_VERSION` in `live-rails-cache.ts` | Bump on membership contract change |
| Inventory builders | `scripts/live/build-curated-*-m3u.py` | Align cartoons M3U with allowlist |
| Pi audit (document only) | `scripts/live/audit-live-rails.sh`, curl `/rails/items?tab=live` | Home Mac |

**Genuinely missing (build minimal):**
- Standing-brand allowlists per sport policy (FIFA / cricket / soccer), sourced from curated M3U identities.
- A clear Phase A (live event) → Phase B (standing fill) composition helper used by the match path.
- Language helper that treats **absent** language as admit, **Spanish/etc.** as reject.

---

## §6 — Per-workstream specs

### S1 — Diagnose (write findings first; no product change yet)

**Deliverables**
1. In the report, confirm with code citations that empty WC/cricket/soccer/cartoon rails are explained by qualification + empty-rail hide (not launcher).
2. List the exact standing identities available in `config/live-sports-curated.m3u` and map each to a sport rail.
3. List cartoon allowlist vs committed `live-cartoons.m3u` deltas (e.g. Tom and Jerry).
4. Note whether `LIVE_RAILS_POLICY_VERSION` must bump (yes — membership contract changes).

**Acceptance:** Report section S1 complete before S2 code lands. No behavior change in S1.

### S2 — Hybrid sports membership (World Cup / cricket / soccer)

**Deliverables**
1. Introduce standing-brand allowlists (exact canonical titles), at minimum covering curated free inventory:
   - **World Cup standing:** `fifa+`, `fifa+ united states` (and quality variants collapsed by `canonicalLiveTitle`).
   - **Cricket standing:** `star sports 1`, `star sports 1 hindi`, `star sports 2`, `willow sports` / `willow cricket`, `dd sports`, `cricket gold`.
   - **Soccer standing:** `bein sports usa` / `bein sports` (canonicalized), plus any other soccer-specific identities already present in the curated free M3U — **do not** invent broad “espn/sky sports main event” dumps that reintroduce noise.
2. Membership composition for those three policies:
   - **Phase A:** existing current-event qualification (unchanged junk rejections: women’s/club/qualifier FIFA, non-India cricket, MLS-only, replay/ended).
   - **Phase B:** if Phase A count `< rail.limit`, fill remaining slots with standing allowlist hits from the already keyword-/source-matched pool.
   - Ordering: after composition, quality-sort so **live event rows stay ahead of standing brands** when both exist (document how — e.g. tag/priority before `sortLiveChannelsByQuality`, or sort key). Do not let a soft standing 4K outrank a live match without a deliberate, tested reason.
3. Wire through `matchChannelsToRail` / `matchAllChannelsToRail` / `matchChannelsWithSourceFill` so source_fill paths also get hybrid fill (not only one path).
4. Update `qualification.test.ts` + `live-rails.test.ts`:
   - Standing FIFA+ alone **can** appear as Phase B fill for `fifa_mens_world_cup`.
   - Current WC match still admits; women’s/club/qualifier/replay still reject.
   - Hybrid rail with 1 live match + several brands fills up to limit with live first.
   - Empty inventory still yields empty (honest).
5. Do **not** change F1/news policies except shared helpers with identical F1/news behavior proven by existing tests.

**Acceptance**
- Focused tests prove: (a) off-air day with only standing brands → WC/cricket/soccer rails non-empty from allowlisted brands; (b) live match day → live rows present and ordered before standing fills; (c) junk still rejected; (d) rail limit honored.
- Full `npm test` + `npm run test:gate` pass.

### S3 — Cartoons restore

**Deliverables**
1. Change language gate: admit when language evidence is **absent/unknown**; reject when language is present and **not** EN/HI (Spanish etc. still false).
2. Keep exact `CARTOON_ALLOWLIST`. Optionally normalize common variants already handled by `canonicalLiveTitle` (e.g. `Nick Jr.`).
3. Align inventory: if `build-curated-cartoons-m3u.py` still targets Tom and Jerry but committed `live-cartoons.m3u` lacks it, regenerate or patch the committed M3U so allowlist families that the builder can resolve are present. Do not add dead URLs — if a target cannot be resolved, document deferred and keep allowlist entry only if other sources can supply it.
4. Tests: Moonbug with no languages → **true**; Moonbug with Spanish → **false**; Moonbug with English → **true**; non-allowlist English kids → **false**.

**Acceptance**
- Qualification + live-rails tests cover the three language cases.
- Cartoon rail can populate from allowlisted channels without language metadata.
- Builder/M3U tests pass if touched.

### S4 — Cache, docs, Pi confirmation

**Deliverables**
1. Bump `LIVE_RAILS_POLICY_VERSION` (2 → 3) and extend `live-rails-cache.test.ts` so v2 caches are incompatible.
2. Update `docs/LIVE_TV.md` membership contract to describe hybrid sports + unknown-language cartoons.
3. Add a home-Mac/Pi checklist to `docs/COUCH_TEST.md` (and/or LIVE_TV manual checks):
   ```bash
   # After deploy + cache rebuild
   curl -s 'http://127.0.0.1:3020/rails/items?tab=live' | python3 -c \
     "import json,sys;d=json.load(sys.stdin);print([(r.get('label'),len(r.get('items')or[])) for r in d.get('rails',[])])"
   bash scripts/live/audit-live-rails.sh
   # Expect non-zero world cup / cricket / soccer / cartoons when free M3U sources are healthy
   ```
4. Mentions in report: operator must re-apply NexoTV curated profiles if Pi profiles drifted (`nexotv-config.sh apply-*`) — document only; do not run.

**Acceptance:** Docs accurate; policy version bump tested; Pi steps are copy-pasteable.

### S5 — Report

Write `/Users/aman.shrivastava/Documents/personal/projects/mango/LIVE_SHELVES_RESTORE_CODEX_REPORT.md` with: baseline SHA, S1 diagnosis, S2–S4 changes, exact test commands + results, deferred Pi inventory proof, and any residual risks (e.g. dead M3U URLs).

---

## §7 — Ordering & how to work

1. Verify branch `feat/native-experience`.
2. Baseline: `cd src/catalog-service && npm run build && npm test` — record counts.
3. **S1** diagnose → report section.
4. **S2** hybrid sports → focused tests → full catalog suite.
5. **S3** cartoons → focused tests → full suite.
6. **S4** policy version + docs.
7. **S5** finalize report.
8. Leave tree dirty for reviewer. **Do not commit.**

---

## §8 — Commit policy

**Do not commit or push.** Reviewer verifies independently, then commits/pushes for home-Mac Pi deploy.

---

## §9 — Definition of done

- [ ] Branch is `feat/native-experience`; no commits/pushes; no Pi access; no deps added.
- [ ] S1 diagnosis cites code proving event-only + empty-rail hide as root cause.
- [ ] S2: hybrid fill implemented; live matches first; standing allowlists only; junk still rejected; tests prove off-air and on-air cases.
- [ ] S3: unknown language admitted; known non-EN/HI rejected; allowlist intact; inventory aligned or deferred with reason.
- [ ] S4: `LIVE_RAILS_POLICY_VERSION` bumped; LIVE_TV + COUCH_TEST updated.
- [ ] Catalog `npm test` + `npm run test:gate` green; qualification + live-rails focused tests green; launcher UX smoke still passes if run.
- [ ] `LIVE_SHELVES_RESTORE_CODEX_REPORT.md` honest (no fabricated Pi rail counts).
