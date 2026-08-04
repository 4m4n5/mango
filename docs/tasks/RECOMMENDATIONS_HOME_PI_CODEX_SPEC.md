# Home-agent brief — deploy and harden Mango recommendations on the Pi

You are the autonomous **home agent** for the `mango` repository. You have no
access to the conversation that produced this change. Read this file top to
bottom before mutating either machine. The operator's starter prompt supplies
the exact pushed source SHA; that SHA and this file are the deployment contract.

The work Mac has implemented a profile-owned Fire/Water and YouTube
recommendation redesign. Your job is to deploy it from the home Mac to the Pi,
prove the real runtime systematically, inspect screenshots, make only
evidence-led and principled source corrections, and leave the smallest useful
human couch test for the end. You may use SSH from the home Mac. The work agent
that authored this file did **not** SSH to or observe the Pi or TV.

## 0. Mission and workstream order

Complete these workstreams in order:

1. **H1 — Source and authority preflight:** prove the home clone, origin, and
   supplied SHA agree; establish one source writer.
2. **H2 — Non-destructive Pi baseline:** prove the Pi is on the right clean
   branch, the couch and playback are idle, maintenance is idle, and current
   databases are healthy before deployment.
3. **H3 — Git-only deploy and migration proof:** deploy all catalog, launcher,
   companion, and orchestrator changes; prove exact SHA, backup, schema, and
   service health.
4. **H4 — Automated product proof:** run local and Pi gates, contract/privacy
   probes, restart persistence, cached performance checks, and zero-quota
   YouTube checks.
5. **H5 — Visual and behavioral audit:** inspect screenshots and current TV
   geometry; test all safe states autonomously, then perform the minimal final
   couch pass with the human.
6. **H6 — Evidence-led correction loop:** diagnose any failure, fix source on
   the home Mac, test, commit, push, redeploy, and rerun affected plus regression
   gates.
7. **H7 — Report and ship:** write the required report, commit and push any
   approved source/report changes, and state PASS, FAIL, or DEFERRED for every
   acceptance item.

## 0.1 Overriding principle — preserve real user state and real evidence

- A missing, unreachable, quota-blocked, or subjective check is **DEFERRED with
  its exact reason**. It is never a fabricated PASS.
- Runtime databases, history, ratings, Saved state, progress, caches, profiles,
  operator credentials, and quota configuration belong to the home system.
- Source moves Mac → origin → Pi through Git. Evidence may move Pi → home Mac;
  source and state never move by ad-hoc copying.
- Deterministic tests establish contracts. Screenshots establish rendered
  geometry. Only the human looking at the TV can establish 10-foot readability,
  overscan, color, motion comfort, perceived relevance, and playback quality.
- Fix causes, not symptoms. Do not weaken a gate, hide an error, delete state,
  or disable the intended happy path to manufacture green output.

## 1. Authority and hard constraints

### You MAY

- Run read-only home-Mac and Pi reconnaissance, local tests, Pi gates, service
  logs, SQLite `PRAGMA quick_check`, sanitized API probes, screenshot capture,
  and resource snapshots.
- Run the repository's Git-only deploy wrapper after every precondition passes.
- Make systematic, reversible source or documentation fixes when Pi/TV evidence
  identifies a real defect. The home agent is the temporary **single source
  writer** for this handoff.
- Commit and push those fixes and the final report to
  `origin/feat/native-experience`, then deploy the new exact SHA and re-prove it.
- Copy an explicitly named, generated screenshot **from the Pi to the home Mac
  for inspection only**. This exception does not permit copying repo files,
  databases, config, cookies, tokens, or histories in either direction.

### You MUST NOT

- Work on, create, or switch to any branch other than
  `feat/native-experience`. If the home clone or Pi is on another branch, stop
  and report; do not switch it silently.
- Deploy an origin revision other than the full SHA supplied by the operator,
  unless you have made, tested, committed, and pushed a documented correction
  during this handoff.
- Use `rsync`, hand-copy repository files, edit source directly on the Pi, or
  copy a Mac database to the Pi.
- Delete, recreate, truncate, move, replace, or "fresh start" any runtime DB,
  cache, ratings, history, progress, Saved state, profile, recommendation
  snapshot, or YouTube state. Never call `/youtube/fresh-start`.
- Alter, disconnect, regenerate, print, or copy YouTube API keys, OAuth tokens,
  cookies, scopes, quota limits, or quota configuration. Do not run a command
  that knowingly spends YouTube Data API quota.
- Print or commit credentials, media URLs, token paths, raw provider errors,
  private profile names, opaque content IDs, raw Sheet captions, or stable-ID
  manifests containing unresolved/private source text.
- Run `git reset --hard`, force-push, amend a published commit, bypass hooks,
  discard a dirty tree, or stash unknown user work. A dirty Pi or home clone is
  a stop-and-inventory condition.
- Change controller bindings, controller ownership, debounce, pairing behavior,
  playback ownership, stream-selection contracts, progress ownership, display
  sleep policy, or input routing without explicit human approval. Normal
  controller reconnect, not pairing mode, remains the happy path.
- Abort active playback or playability maintenance to make a deploy convenient.
  `pi-deploy.sh` restarts the stack and can stop both; preflight them first.
- Turn off a product feature as the final "fix." The one rollout exception is
  the documented `MANGO_FOR_YOU=0` hold when no approved seed import exists.
- Claim Pi, TV, screenshot, recommendation-quality, or playback PASS from
  work-Mac tests alone.

### You MUST

- Use `git pull --ff-only`, the repo deploy wrapper, and exact SHA comparisons.
- Preserve the current database files and record their size, timestamp, and
  `quick_check` before and after migration without dumping personal rows.
- Keep YouTube proof cache-only and show that search/API counters did not
  increase. If that cannot be proved, mark YouTube runtime proof DEFERRED.
- Treat the Fire/Water stable-ID seed as unavailable unless an approved,
  reconciled manifest actually exists and passes the documented validator.
- Use small commits with meaningful messages, push normally, and rerun the
  complete relevant proof after every correction.
- Write `docs/tasks/RECOMMENDATIONS_HOME_PI_REPORT.md` as specified in §9.

## 2. Repository and runtime map

- **Home Mac repo:** use the clone containing this file; expected canonical path
  is `/Users/aman.shrivastava/Documents/personal/projects/mango`.
- **Pi repo:** `~/mango` on the configured `mango` SSH alias; use
  `mango-mdns` only as the documented fallback.
- **Branch:** `feat/native-experience` only.
- **Deploy/runbooks:** `AGENTS.md`, `docs/DEPLOY.md`,
  `docs/DEPLOY-SPLIT-MACHINE.md`, `docs/OPS.md`.
- **Product contracts:** `docs/FIRE_WATER_RATINGS.md`, `docs/YOUTUBE.md`,
  `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`.
- **Couch matrix:** recommendation profiles RP1–RP11 and Fire/Water FW1–FW14
  in `docs/COUCH_TEST.md`.
- **Deploy/gates:** `scripts/pi-deploy.sh`, `scripts/pi-exec.sh`,
  `scripts/pi-pre-couch-gate.sh`, `scripts/m6-ship/gate-m6-ux-smoke.sh`,
  `scripts/m6-ship/gate-m6-youtube-smoke.sh`.
- **Runtime DBs:** `/etc/mango/library.db`, `/etc/mango/progress.db`, and
  `/etc/mango/youtube.db`. Observe them; never replace or clear them.
- **Runtime env:** `~/.config/mango/voice.env`. Do not print it. Only an exact,
  recorded recommendation feature-flag line may be changed under this brief.
- **Screenshot helper:** `scripts/m1-foundation/gate/capture-tv.sh`; output is
  under `~/.cache/mango/gate-screenshots/` on the Pi.

## 3. Known source state and local proof boundary

The operator's starter prompt contains `EXPECTED_SHA`, the full pushed SHA that
includes this file and the recommendation redesign. Do not substitute a stale
SHA shown elsewhere in Mango documentation. In particular, historical Pi or UX
SHAs are context, not this deployment target.

The work agent reported these source-side results. The final resolver hardening
was followed by the catalog suite and both production builds; the remaining
rows are an earlier integrated baseline and must be rerun at home:

| Gate | Reported local result |
|---|---:|
| Catalog full test suite after final resolver patch | 876 passed, 0 failed |
| Launcher production build after final resolver patch | PASS |
| Companion production build after final resolver patch | PASS |
| Catalog gate subset (earlier baseline) | 497 passed, 0 failed |
| Launcher source/UX tests (earlier baseline) | 76 passed, 0 failed |
| Orchestrator tests (earlier baseline) | 98 passed, 0 failed; final local rerun DEFERRED because system Python lacked pytest |
| Pad navigation (earlier baseline) | 10 passed, 0 failed |
| Contextual X ownership (earlier baseline) | 10 passed, 0 failed |
| LAN companion proxy security (earlier baseline) | 6 passed, 0 failed |
| Stream-picker source/session gates (earlier baseline) | 10 + 5 passed, 0 failed |

The operator explicitly stopped the remaining Mac gate run for this handoff, so
home reruns are mandatory. These counts are a baseline, not a substitute for
rerunning tests. Counts may
increase after a correction; the invariant is zero failures and no skips that
hide a required assertion. Local playback-SSOT checks that require X11, mpv,
systemd, HDMI, or the real TV were intentionally deferred to this home run.

There is currently **no approved stable-ID seed manifest in source**. The Sheet
audit found 56 non-empty rows, 54 clean numeric pairs, and two rows requiring
human disposition. Do not guess those rows, synthesize IDs, or run the example
`/path/to/fire-water-seed-v1.json` commands. Base code/migration/UI can deploy;
seeded Household warm-start and seed-calibrated quality remain DEFERRED unless
the exact reconciliation is completed during this handoff.

## 4. H1 — source and authority preflight

From the home Mac repo, substitute the exact full SHA from the starter prompt:

```bash
cd /Users/aman.shrivastava/Documents/personal/projects/mango

MANGO_EXPECTED_SHA='<full pushed SHA from the starter prompt>'

git fetch origin feat/native-experience
test "$(git branch --show-current)" = 'feat/native-experience'
test -z "$(git status --porcelain)"
git pull --ff-only origin feat/native-experience
test "$(git rev-parse HEAD)" = "$MANGO_EXPECTED_SHA"
test "$(git rev-parse origin/feat/native-experience)" = "$MANGO_EXPECTED_SHA"
git log --oneline --decorate -5
```

If another agent is writing this branch, coordinate and establish one writer
before continuing. If the tree is dirty, inventory it and ask the human how to
preserve it. Do not deploy around, discard, or stash unknown work.

Run the source gates before touching the Pi:

```bash
(cd src/catalog-service && npm run test:gate && npm test)
(cd src/launcher && npm run build)
(cd src/companion && npm run build)
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
python3 scripts/m5-voice/stack/test_serve_https.py
bash scripts/m6-ship/gate-m6-ux-smoke.sh
bash scripts/m6-ship/gate-m6-stream-picker-source.sh
git diff --check
test -z "$(git status --porcelain)"
```

The supplied SHA is the complete branch tip, not a request to deploy only its
last commit. Never cherry-pick the latest patch. The fast-forward pull and
exact-SHA comparison must bring every commit missing from the Pi into the
deployment.

If an expected count changes, inspect why. Require zero failures; do not edit a
test just to reproduce the historical count.

**H1 acceptance:** correct clean branch; home HEAD equals origin and supplied
SHA; all local gates pass; one writer established.

## 5. H2 — non-destructive Pi baseline and rollout hold

First prove branch, SHA, and cleanliness without changing the Pi:

```bash
bash scripts/pi-exec.sh \
  'hostname; cd ~/mango; git branch --show-current; git rev-parse HEAD; git status --short --branch; bash scripts/mango-stack.sh status'

bash scripts/pi-exec.sh \
  'cd ~/mango && source scripts/lib/mango-browse-display.sh; if playback_surface_active; then echo BLOCKED_playback_active; exit 3; else echo playback_idle; fi'

bash scripts/pi-exec.sh \
  'cd ~/mango && python3 scripts/diag/grow_monitor.py status --json'

bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/diag/couch-activity-status.sh'
```

Record and audit the entire undeployed ancestry before mutation:

```bash
MANGO_PI_BASE_SHA="$(bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse HEAD')"
git merge-base --is-ancestor "$MANGO_PI_BASE_SHA" "$MANGO_EXPECTED_SHA"
git log --oneline --decorate "$MANGO_PI_BASE_SHA..$MANGO_EXPECTED_SHA"
```

If the Pi revision is not an ancestor of the supplied tip, stop and report the
divergence. Do not reduce the deployment to one cherry-picked commit.

Proceed only when the Pi is already on `feat/native-experience`, its repo is
clean, playback is inactive, `grow.running` and `grow.maintenance_lock` are
false, and the couch is idle. If SSH alias `mango` alone fails, retry read-only
preflight with `MANGO_SSH_HOST=mango-mdns`; do not invent addresses/passwords.

Record only non-sensitive DB metadata and integrity:

```bash
bash scripts/pi-exec.sh '
  set -euo pipefail
  for MANGO_DB_PATH in /etc/mango/library.db /etc/mango/progress.db /etc/mango/youtube.db; do
    if test -f "$MANGO_DB_PATH"; then
      stat -c "%n bytes=%s modified=%y" "$MANGO_DB_PATH"
      sqlite3 "$MANGO_DB_PATH" "PRAGMA quick_check;"
    else
      echo "missing $MANGO_DB_PATH"
    fi
  done
'
```

Also record the pre-deploy migration boundary so a historical v4 database can
be distinguished from a first v4 migration without exposing rows:

```bash
bash scripts/pi-exec.sh '
  for MANGO_DB_PATH in /etc/mango/library.db /etc/mango/progress.db; do
    test -f "$MANGO_DB_PATH" || continue
    echo "$MANGO_DB_PATH"
    sqlite3 "$MANGO_DB_PATH" "SELECT name FROM sqlite_master WHERE type='"'"'table'"'"' AND name IN ('"'"'library_migrations'"'"','"'"'progress_migrations'"'"') ORDER BY name;"
    sqlite3 "$MANGO_DB_PATH" "SELECT group_concat(version, '"'"','"'"') FROM (SELECT version FROM library_migrations ORDER BY version);" 2>/dev/null || true
    sqlite3 "$MANGO_DB_PATH" "SELECT group_concat(version, '"'"','"'"') FROM (SELECT version FROM progress_migrations ORDER BY version);" 2>/dev/null || true
  done
'
```

Before the first restart, enforce the locked seed rollout boundary. Inspect
only counts, never manifest names/hashes or rating rows:

```bash
bash scripts/pi-exec.sh '
  set -euo pipefail
  MANGO_LIBRARY_PATH=/etc/mango/library.db
  MANGO_SEED_IMPORTS=0
  if test -f "$MANGO_LIBRARY_PATH" && \
     test "$(sqlite3 "$MANGO_LIBRARY_PATH" "SELECT count(*) FROM sqlite_master WHERE type='"'"'table'"'"' AND name='"'"'rating_seed_imports'"'"';")" = 1; then
    MANGO_SEED_IMPORTS="$(sqlite3 "$MANGO_LIBRARY_PATH" "SELECT count(*) FROM rating_seed_imports WHERE imported_count > 0;")"
  fi
  echo "successful_seed_imports=$MANGO_SEED_IMPORTS"
  MANGO_ENV_PATH="$HOME/.config/mango/voice.env"
  test -f "$MANGO_ENV_PATH"
  echo "current_for_you_flag=$(grep -E '"'"'^export MANGO_FOR_YOU='"'"' "$MANGO_ENV_PATH" | tail -n 1 | cut -d= -f2- || true)"
  if grep -qE '"'"'^export MANGO_FOR_YOU='"'"' "$MANGO_ENV_PATH"; then
    sed -i '"'"'s/^export MANGO_FOR_YOU=.*/export MANGO_FOR_YOU=0/'"'"' "$MANGO_ENV_PATH"
  else
    printf '"'"'\nexport MANGO_FOR_YOU=0\n'"'"' >> "$MANGO_ENV_PATH"
  fi
  echo "rollout_hold=MANGO_FOR_YOU=0"
'
```

A historical `rating_seed_imports` row proves only that some import ran; it does
not prove the locked 56-row reconciliation was approved. Therefore
`MANGO_FOR_YOU=0` is the required reversible rollout hold regardless of that
count, and Fire/Water rating capture may remain enabled. Re-enable For You only
after the human explicitly identifies the approved manifest, it has unique
stable IDs and explicit disposition for every source row, passes dry-run and
validation, imports twice with the second run reporting `noop: true`, and
survives the gates below.

**H2 acceptance:** Pi/source/state baseline recorded; DB integrity is `ok`;
playback, maintenance, and couch are idle; seed-dependent rail cannot start
unapproved.

## 6. H3 — git-only deploy and migration proof

Because no dependency lockfile changed, use the fast wrapper. Do **not** use its
`--gate` option here: `pi-exec-gate.sh` does not forward the zero-YouTube-quota
skip, and the ordinary YouTube smoke can call `search.list`.

```bash
bash scripts/pi-deploy.sh --fast
```

Use the documented transport fallback only if needed:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-deploy.sh --fast
```

Use `--full` only if the fast dependency/build step fails for a real dependency
reason. Do not replace the wrapper with manual build snippets: this changeset
touches catalog, launcher, and companion, and the wrapper builds all three.

The git deploy does not mutate AIOStreams `userData`; apply and verify the
credential-free target patch separately using the Pi-owned credentials:

```bash
bash scripts/pi-exec.sh '
  cd ~/mango
  bash scripts/m4-addons/aiostreams-config.sh diff
  bash scripts/m4-addons/aiostreams-config.sh apply
  bash scripts/m4-addons/aiostreams-config.sh verify
'
```

The patch intentionally omits the service array and never prints secret values.
Verification must confirm enabled TorBox, Real-Debrid, and Easynews service
references; Torrentio, Comet, and MediaFusion presets; the service-wrap and
uncached policies; and visible stream-resource resolver errors. Do not add the
nested indexers directly or expose credentials in logs or the report.

Prove exact revision and services:

```bash
git rev-parse HEAD
bash scripts/pi-exec.sh \
  'cd ~/mango && git rev-parse HEAD && git status --short --branch && bash scripts/mango-stack.sh status'
```

Home HEAD, origin, and Pi HEAD must all equal `MANGO_EXPECTED_SHA` unless you
have intentionally produced and pushed a later correction SHA.

Prove migration backup and schema without mutating rows:

```bash
bash scripts/pi-exec.sh '
  set -euo pipefail
  test -f /etc/mango/library.db.pre-fire-water-v4.bak
  stat -c "%n bytes=%s modified=%y" /etc/mango/library.db.pre-fire-water-v4.bak
  test "$(sqlite3 /etc/mango/library.db "PRAGMA quick_check;")" = ok
  test "$(sqlite3 /etc/mango/progress.db "PRAGMA quick_check;")" = ok
  sqlite3 /etc/mango/library.db \
    "SELECT group_concat(version, ',') FROM (SELECT version FROM library_migrations WHERE version BETWEEN 4 AND 11 ORDER BY version);"
  sqlite3 /etc/mango/progress.db \
    "SELECT group_concat(version, ',') FROM (SELECT version FROM progress_migrations ORDER BY version);"
  sqlite3 /etc/mango/library.db \
    "SELECT name FROM pragma_table_info('profile_recommendation_served_slates') WHERE name='context_id';"
'
```

Expected library versions include `4,5,6,7,8,9,10,11`, progress includes `2`,
and the final query returns `context_id`. If the H2 baseline did not yet include
library migration 4, the pre-v4 backup is mandatory; its absence is a failure.
If H2 proved migration 4 had already run on an older revision and the backup was
already absent, record a high-severity historical backup-proof gap rather than
fabricating or creating a "pre-v4" copy from the current DB. A failed integrity
check or incomplete migration is always a stop condition. Preserve logs and
current files; do not restore the pre-v4 backup automatically because that
could discard new viewer activity.

**H3 acceptance:** wrapper succeeds; exact SHA matches; Pi tree remains clean;
catalog, launcher, pad, and enabled voice/companion services are healthy;
backup/integrity/migrations prove cleanly.

## 7. H4 — automated runtime proof

### 7.1 Pi gates without YouTube quota

Run the normal gate remotely with the skip explicitly inside the SSH command:

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango && MANGO_GATE_SKIP_YOUTUBE=1 bash scripts/pi-pre-couch-gate.sh'
```

When the couch and maintenance remain idle, run the full gate the same way:

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango && MANGO_GATE_FULL=1 MANGO_GATE_SKIP_YOUTUBE=1 bash scripts/pi-pre-couch-gate.sh'
```

Then run the recommendation-adjacent deterministic suites on the Pi:

```bash
bash scripts/pi-exec.sh 'cd ~/mango/src/catalog-service && npm test'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-library-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-search-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/ai/gate-m5-voice.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/ai/gate-m5-companion-memory.sh'
```

Do not run `gate-m6-youtube-smoke.sh` under the zero-quota guardrail: it performs
a real YouTube search when an API key exists. If a named gate requires an
unavailable optional service, report its exact skip/failure rather than
changing credentials or config to make it run.

### 7.2 Sanitized state and exact-owner VOD rails

Run these probes on Pi loopback. The summaries intentionally print counts and
keys, not profile names, item IDs, tokens, URLs, or private diagnostics:

```bash
bash scripts/pi-exec.sh '
  set -euo pipefail
  MANGO_PERSONALIZATION_JSON="$(curl -fsS http://127.0.0.1:3020/personalization/state)"
  MANGO_PROFILE_ID="$(printf "%s" "$MANGO_PERSONALIZATION_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['"'"'state'"'"']['"'"'active_profile_id'"'"'])")"
  MANGO_PROFILE_REV="$(printf "%s" "$MANGO_PERSONALIZATION_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['"'"'state'"'"']['"'"'updated_at'"'"'])")"
  printf "%s" "$MANGO_PERSONALIZATION_JSON" | python3 -c "import json,sys; d=json.load(sys.stdin); print({'"'"'ok'"'"':d.get('"'"'ok'"'"'), '"'"'profile_count'"'"':len(d.get('"'"'profiles'"'"',[])), '"'"'active_kind'"'"':next((p.get('"'"'kind'"'"') for p in d.get('"'"'profiles'"'"',[]) if p.get('"'"'profile_id'"'"')==d['"'"'state'"'"']['"'"'active_profile_id'"'"']),None), '"'"'mood_set'"'"':bool(d['"'"'state'"'"'].get('"'"'mood'"'"'))})"
  for MANGO_TAB in movies series; do
    curl -fsSG http://127.0.0.1:3020/rails/items \
      --data-urlencode "tab=$MANGO_TAB" \
      --data-urlencode "expected_profile_id=$MANGO_PROFILE_ID" \
      --data-urlencode "expected_personalization_updated_at=$MANGO_PROFILE_REV" |
      MANGO_EXPECTED_PROFILE="$MANGO_PROFILE_ID" MANGO_EXPECTED_REV="$MANGO_PROFILE_REV" \
      python3 -c "import json,os,sys; d=json.load(sys.stdin); owner_ok=d.get('"'"'profile_id'"'"')==os.environ['"'"'MANGO_EXPECTED_PROFILE'"'"'] and str(d.get('"'"'personalization_updated_at'"'"'))==os.environ['"'"'MANGO_EXPECTED_REV'"'"']; print(d['"'"'tab'"'"'], {'"'"'owner_exact'"'"':owner_ok, '"'"'rails'"'"':[(r.get('"'"'rail_id'"'"'),len(r.get('"'"'items'"'"',[]))) for r in d.get('"'"'rails'"'"',[])]}); raise SystemExit(0 if owner_ok else 6)"
  done
  MANGO_PARTIAL_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -G http://127.0.0.1:3020/rails/items --data-urlencode tab=movies --data-urlencode "expected_profile_id=$MANGO_PROFILE_ID")"
  MANGO_STALE_REV="$((MANGO_PROFILE_REV + 1))"
  MANGO_STALE_CODE="$(curl -sS -o /dev/null -w "%{http_code}" -G http://127.0.0.1:3020/rails/items --data-urlencode tab=movies --data-urlencode "expected_profile_id=$MANGO_PROFILE_ID" --data-urlencode "expected_personalization_updated_at=$MANGO_STALE_REV")"
  echo "partial_owner_http=$MANGO_PARTIAL_CODE stale_owner_http=$MANGO_STALE_CODE"
  test "$MANGO_PARTIAL_CODE" = 400
  test "$MANGO_STALE_CODE" = 409
  curl -fsS http://127.0.0.1:3020/recommendations/state |
    python3 -c "import json,sys; d=json.load(sys.stdin); blob=json.dumps(d).lower(); forbidden=[x for x in ('"'"'http://'"'"','"'"'https://'"'"','"'"'api_key'"'"','"'"'token_file'"'"','"'"'caption'"'"','"'"'prompt'"'"','"'"'media_url'"'"') if x in blob]; print({'"'"'top_keys'"'"':sorted(d), '"'"'forbidden_public_markers'"'"':forbidden}); raise SystemExit(0 if not forbidden else 7)"
'
```

Required behavior:

- Owner ID/revision are echoed exactly; a stale pair returns 409 and never
  falls back to an unowned response.
- Rail order is Continue → Saved → For You → user AI catalogs → curated
  discovery. With the rollout hold, For You is absent. Once legitimately
  enabled, it is a poster-layout window of 6–12 unique currently verified cards,
  targeting two full six-card rows. The ranked head retains close/adjacent/
  bounded-surprise intent; shuffle rotates through the reserve without admitting
  ineligible titles.
- Rated, hidden, Not-for-me, invalid, and unverified items do not enter For You;
  completed items use only the bounded cooled-rewatch path.
- Public state contains no media URLs, credentials, raw captions, prompts,
  private feature text, scores, or token paths. Opaque action IDs/tokens may be
  present where required but must not be copied into the report.

Do not mutate a real rating or create a permanent profile for automated proof.
The full Pi catalog suite exercises mutations against isolated temporary DBs.
Profiles currently have no delete action; create one only after explicit human
approval during §8.

### 7.3 Cache-only YouTube contract and quota invariance

`GET /youtube/rails` can opportunistically refresh Live Now, and the ordinary
YouTube smoke performs Search. Use only the cache-only reshuffle path, and only
when the operator state shows a nonempty cache. Record counters before and
after; do not print the full operator state.

```bash
bash scripts/pi-exec.sh '
  set -euo pipefail
  MANGO_YT_BEFORE="$(curl -fsS http://127.0.0.1:3020/youtube/state)"
  printf "%s" "$MANGO_YT_BEFORE" | python3 -c "import json,sys; d=json.load(sys.stdin); print({'"'"'cache_videos'"'"':d.get('"'"'cache'"'"',{}).get('"'"'videos'"'"',0), '"'"'api_calls_today'"'"':d.get('"'"'refresh'"'"',{}).get('"'"'api_calls_today'"'"'), '"'"'search_calls_today'"'"':d.get('"'"'refresh'"'"',{}).get('"'"'search_calls_today'"'"')})"
  MANGO_YT_CACHE_COUNT="$(printf "%s" "$MANGO_YT_BEFORE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('"'"'cache'"'"',{}).get('"'"'videos'"'"',0))")"
  MANGO_YT_BEFORE_API="$(printf "%s" "$MANGO_YT_BEFORE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('"'"'refresh'"'"',{}).get('"'"'api_calls_today'"'"',0))")"
  MANGO_YT_BEFORE_SEARCH="$(printf "%s" "$MANGO_YT_BEFORE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('"'"'refresh'"'"',{}).get('"'"'search_calls_today'"'"',0))")"
  test "$MANGO_YT_CACHE_COUNT" -gt 0 || { echo DEFERRED_empty_youtube_cache; exit 4; }
  MANGO_PERSONALIZATION_JSON="$(curl -fsS http://127.0.0.1:3020/personalization/state)"
  MANGO_PROFILE_ID="$(printf "%s" "$MANGO_PERSONALIZATION_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['"'"'state'"'"']['"'"'active_profile_id'"'"'])")"
  MANGO_PROFILE_REV="$(printf "%s" "$MANGO_PERSONALIZATION_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['"'"'state'"'"']['"'"'updated_at'"'"'])")"
  MANGO_YT_RAILS="$(curl -fsSG http://127.0.0.1:3020/youtube/rails \
    --data-urlencode reshuffle=1 \
    --data-urlencode "expected_profile_id=$MANGO_PROFILE_ID" \
    --data-urlencode "expected_personalization_updated_at=$MANGO_PROFILE_REV")"
  printf "%s" "$MANGO_YT_RAILS" |
    MANGO_EXPECT_PROFILE="$MANGO_PROFILE_ID" MANGO_EXPECT_REV="$MANGO_PROFILE_REV" \
    python3 -c "import json,os,sys; d=json.load(sys.stdin); rails=d.get(\"rails\",[]); anchors=[\"for_you\",\"new_from_subscriptions\",\"history\",\"saved\"]; rail_ids=[r.get(\"rail_id\") for r in rails]; rows=[[i.get(\"id\") for i in r.get(\"items\",[])] for r in rails]; assert d.get(\"profile_id\")==os.environ[\"MANGO_EXPECT_PROFILE\"]; assert d.get(\"personalization_updated_at\")==int(os.environ[\"MANGO_EXPECT_REV\"]); assert [r for r in rail_ids if r in anchors]==[r for r in anchors if r in rail_ids]; assert len([r for r in rail_ids if r not in anchors])<=3; assert all(len(row)==4 and len(row)==len(set(row)) for row in rows); by_id={r.get(\"rail_id\"):set(i.get(\"id\") for i in r.get(\"items\",[])) for r in rails}; assert by_id.get(\"for_you\",set()).isdisjoint(by_id.get(\"saved\",set())); print([(r.get(\"rail_id\"),len(r.get(\"items\",[]))) for r in rails])"
  MANGO_YT_AFTER="$(curl -fsS http://127.0.0.1:3020/youtube/state)"
  MANGO_YT_AFTER_API="$(printf "%s" "$MANGO_YT_AFTER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('"'"'refresh'"'"',{}).get('"'"'api_calls_today'"'"',0))")"
  MANGO_YT_AFTER_SEARCH="$(printf "%s" "$MANGO_YT_AFTER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('"'"'refresh'"'"',{}).get('"'"'search_calls_today'"'"',0))")"
  echo "api_calls_before=$MANGO_YT_BEFORE_API api_calls_after=$MANGO_YT_AFTER_API search_calls_before=$MANGO_YT_BEFORE_SEARCH search_calls_after=$MANGO_YT_AFTER_SEARCH"
  test "$MANGO_YT_BEFORE_API" = "$MANGO_YT_AFTER_API"
  test "$MANGO_YT_BEFORE_SEARCH" = "$MANGO_YT_AFTER_SEARCH"
'
```

Required cached shape: logical anchors in For You → Subscriptions → History →
Saved order when nonempty, followed by at most three adaptive rails; every
visible row has exactly four unique cards; History and Saved stay stable; exact
Saved videos do not appear in For You. A healthy ten-slate source yields
28/8/4 close/adjacent/explore; thin supply must expose its honest fallback
diagnostic instead of being called healthy. Do not generate ten live slates if
doing so cannot be proven quota-free; local deterministic tests already cover
the allocator.

Also prove the LAN boundary using the existing proxy tests. Full
`/youtube/state`, raw error text, token paths, scopes, expiry, command paths,
cache, and quota diagnostics must remain loopback-only. The companion status
DTO is exactly four sanitized booleans.

```bash
bash scripts/pi-exec.sh '
  for MANGO_PATH in ai/context voice/companion/summary youtube/companion/status; do
    curl -sk -o /dev/null -w "$MANGO_PATH %{http_code}\n" "https://127.0.0.1:3001/api/catalog/$MANGO_PATH"
  done
  for MANGO_PATH in recommendations/state voice/companion/journal youtube/state; do
    curl -sk -o /dev/null -w "$MANGO_PATH %{http_code}\n" "https://127.0.0.1:3001/api/catalog/$MANGO_PATH"
  done
'
```

The first three paths must return `200`; the private/operator paths must return
`403`. Inspect only the sanitized `/youtube/companion/status` key set and assert
it is exactly `api_key_configured`, `oauth_configured`, `authenticated`, and
`needs_attention`.

### 7.4 Persistence, failure isolation, and performance

Capture sanitized summaries and DB metadata, restart deliberately once while
the couch is idle, then repeat them:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh restart && bash scripts/mango-stack.sh status'
```

Ratings, profile ownership, Saved/history, Continue positions, current
snapshots, and YouTube cache counts must persist. Do not verify this by dumping
rows; compare counts/revisions and use the human's normal UI for identity.

Measure at least 20 warm, read-only calls to personalization state and
owner-bound Movies/TV rails. Record median, p95, maximum, endpoint `resolve_ms`,
Pi CPU/memory, and whether the launcher stayed responsive. This run establishes
the Pi baseline: do not invent a latency threshold, and do not treat the
launcher's 12–15 second timeout ceilings as good UX. Use
`scripts/diag/pi-resource-snapshot.sh` before and after; report measured values
and let the human judge perceived latency.

For failure isolation, use only supported reversible flags and restore the
exact prior value afterward. `MANGO_RECOMMENDATIONS_AI=0` may prove that local
last-good rails and Detail remain responsive without enrichment. Do not
disconnect Wi-Fi, change YouTube credentials, delete caches, or leave
`MANGO_RECOMMENDATION_RANK_WORKER=0`; the latter is diagnostic-only. A worker
deadline/failure must retain the last complete snapshot.

### 7.5 Alliance exact-episode first-press recovery

The reported fail/fail/play sequence is consistent with a transient clean-empty
resolver result being cached and then bypassed by each manual retry. This patch
makes one automatic VOD Play request perform at most three exact-ID passes
(initial plus two bounded confirmations) inside one flight and deadline. It does
not retry fatal authentication/configuration errors, 429s, HTTP/timeout
placeholders, cancellation, malformed output, Detail-list resolution, Live, or
picker refreshes.

Use the real Alliance episode ID returned by
`/series/<bare-series-id>/episodes`; never substitute `:1:1` or a sibling
episode. Record sanitized `/health.resolver` counters before the test, press B
exactly once, wait without leaving Detail, then record the counters and fixed
resolver-event journal lines. PASS requires playback to start from that first B
when the same playable result would have appeared on the former third manual
attempt, no sibling-episode fallback, no late playback after cancellation or
return, no raw resolver diagnostics, and coherent increments for retries,
recoveries, or exhaustions. `scripts/diag/playback-ladder-health.sh` exercises
Detail-list resolution and therefore is not proof of this Play-only recovery.

**H4 acceptance:** required gates pass; migrations and state persist across a
restart; owner and privacy contracts hold; cached calls have measured evidence;
YouTube API/search counters are unchanged or YouTube proof is honestly
DEFERRED.

## 8. H5 — screenshots and minimal human couch proof

### 8.1 Autonomous visual evidence first

Capture every state you can reach without changing user state. The capture
script prints the exact Pi path. Its label does **not** navigate the launcher.
Do not run these four commands against one unchanged frame: before each command,
navigate through the established D-pad/UI harness to the named surface, wait
for the loading state to settle, visually confirm the active tab, and then
capture that one state. Use this sequence: recommendation Home/Movies, Series,
YouTube anchors, returning to Movies if a separate recommendation-home frame is
needed.

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m1-foundation/gate/capture-tv.sh recommendations-home'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m1-foundation/gate/capture-tv.sh recommendations-movies'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m1-foundation/gate/capture-tv.sh recommendations-series'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m1-foundation/gate/capture-tv.sh youtube-anchors-cache-only'
```

Navigate only through existing D-pad/controller ownership or an established UI
harness; do not invent input injection that bypasses the product. For a state
that requires a real rating/profile mutation, wait for the human phase.

Copy each exact generated PNG Pi → home Mac only when needed for visual
inspection, for example:

```bash
mkdir -p /tmp/mango-recommendation-proof
scp 'mango:<exact generated PNG path>' /tmp/mango-recommendation-proof/
```

This one-way evidence copy is not permission to copy source, DBs, config, logs
containing secrets, or any runtime state. Open each PNG with an image viewer and
audit safe area, focus visibility, truncation, empty/loading/offline/error
states, duplicate cards, row/card geometry, contrast, and whether technical
diagnostics leaked. A screenshot proves pixels, not perceived TV behavior.

### 8.2 Final human-in-the-loop couch test

Only after autonomous gates and screenshot review are clean, ask the human for
one focused 15–25 minute pass. Prefer existing profiles/state. If profile
isolation cannot be proved without a new permanent profile, explain that there
is no delete action and obtain explicit approval before creating one.

1. **Household and controller (2 min):** wake the 8BitDo normally, confirm no
   pairing mode, immediate D-pad response, stable focus, and no startup profile
   chooser.
2. **Fire/Water sheet (4 min):** open an unrated VOD Detail. Confirm Rate follows
   Save; the sheet stays inside 5% safe area; Fire/Water have text plus emoji;
   B enters at 2.5; Left/Right moves 0.5; both axes are required; Y cancels. Use
   an actual save/edit/clear only with the human's chosen title and values.
3. **Movies and TV recommendations (5 min):** if the approved seed exists and
   For You is enabled, inspect all displayed Movies and TV cards (normally 12
   per tab in two full poster rows) for exact row shape, no duplicates,
   relevance, diversity, adjacent discovery, plausible
   surprise, and no rated/hidden/unverified title. If seed is unavailable,
   verify the rollout hold and mark this seed-quality portion DEFERRED.
4. **Profile/mood safety (4 min):** with approved existing profiles, switch via
   companion, confirm immediate ownership update and 30-second fallback,
   profile-local Saved/Continue/Not-for-me, reversible Undo, and mood cleared on
   switch. Do not expose profile names in the report.
5. **YouTube (3 min):** inspect four-card anchors/adaptives and use X only if
   before/after counters can prove cache-only behavior. History/Saved must remain
   stable and no Saved video may appear in For You. Do not refresh/Search merely
   for this test.
6. **Playback return (3 min):** include the exact reported Alliance episode when
   available and press B only once. Prove prompt first frame, controller/HUD,
   return focus, progress continuity, no black-screen/late-start regression, and
   the bounded exact-ID retry evidence from §7.5. Also play one recommended VOD
   through the normal ladder. Do not interrupt active playback for deployment or
   repair.

Record the human's words or a concise verdict for 10-foot readability,
Fire/Water semantics, focus, perceived latency, Movies relevance, TV relevance,
diversity, surprise quality, YouTube relevance, and playback. The agent owns
objective diagnostics; the human owns these subjective verdicts.

**H5 acceptance:** screenshots were opened and audited, not merely captured;
all reachable RP1–RP11 and FW1–FW14 rows have PASS/FAIL/DEFERRED evidence; the
minimal human pass has explicit verdicts; no seed-dependent claim is green
without an approved import.

## 9. H6/H7 — correction loop, rollback, report, and definition of done

### Evidence-led correction loop

For each defect:

1. Reproduce and collect the smallest sanitized evidence: exact command, exit
   code, service log lines, screenshot, API shape, timing, or human observation.
2. Locate the owning layer. Preserve exact profile ownership, opaque
   attribution, the 6–12-card poster VOD window and ranked bucket intent,
   four-card YouTube rows, 70/20/10 allocator,
   playability filters, cache-only X, controller bindings, playback/progress,
   and last-good semantics.
3. Edit source **only on the home Mac**. Add a deterministic regression test.
4. Run focused tests and then the complete applicable local gates from §4.
5. Commit with a small imperative message, push normally to
   `origin/feat/native-experience`, and record the new full SHA.
6. Wait for origin readback, deploy with `pi-deploy.sh --fast`, rerun the failed
   check, then rerun the zero-quota pre-couch and relevant full gates.
7. Repeat only while evidence improves. Do not blindly increase timeouts,
   weights, candidate counts, quota budgets, or UI delays.

If the implementation is correct but the UX needs a small visual/token tweak,
preserve 10-foot font sizes, 5% safe area, focus contrast, D-pad reachability,
and reduced-motion behavior. Capture before/after screenshots and ask the human
only for the subjective choice that cannot be established from pixels.

### Rollback

- For source rollback, create a normal `git revert <bad-sha>` commit on the home
  Mac, test it, push it, and deploy the revert. Never rewrite branch history or
  hard-reset the Pi.
- `MANGO_FIRE_WATER_RATINGS=0`, `MANGO_FOR_YOU=0`, and
  `MANGO_RECOMMENDATIONS_AI=0` are reversible containment flags that preserve
  state. Record the previous and final value. Do not leave a containment flag
  as a silent final fix.
- If migration or SQLite integrity fails, stop the affected service and preserve
  evidence. Do not automatically restore the pre-v4 backup or delete current
  files; ask the human before any state-replacing recovery.
- If SSH, branch cleanliness, maintenance-idle, or exact-SHA proof cannot be
  established, stop and report the blocker. Do not improvise around it.

### Required report

Create `docs/tasks/RECOMMENDATIONS_HOME_PI_REPORT.md` with:

1. Date, home host, Pi hostname, branch, supplied source SHA, final source SHA,
   origin SHA, and Pi SHA.
2. Baseline state: clean/dirty result, playback/maintenance/couch idle proof,
   DB sizes/timestamps/integrity, prior feature-flag state, and seed-import count.
3. Every command run with exit status and a concise sanitized result.
4. H1–H5 verdict table with PASS/FAIL/DEFERRED and exact evidence/reason.
5. Migration/backup/schema proof and post-restart persistence proof.
6. Test/gate results, measured timings/resources, cached YouTube quota
   before/after counters, API/privacy audit, and screenshot paths plus visual
   findings.
7. Every correction commit and why it was necessary; final deployed SHA.
8. Human couch verdicts and which RP/FW checks were observed.
9. Deferred items with exact next command or required human decision. The
   unresolved seed manifest should be explicit if still unavailable.
10. A credential/privacy audit confirming no private values entered Git or the
    report.
11. AIOStreams policy apply/verify evidence and the Alliance exact-episode
    first-press result, including sanitized resolver counter deltas.

Do not commit screenshots containing private profiles or diagnostics. A
sanitized report and any source fixes must be committed and pushed to
`origin/feat/native-experience`. Confirm origin and Pi are at the final SHA after
the report commit; if committing the report creates a new SHA, deploy that
documentation-only commit only if the operator wants Pi/source parity, otherwise
state the intentional one-commit report-only difference precisely.

### Definition of done

- H1–H5 each have an honest verdict and evidence.
- Exact source, origin, and deployed Pi SHA are reconciled.
- Pi repo is clean; databases are intact; no runtime state or credential was
  copied, reset, or deleted.
- All applicable local/Pi gates pass; any unavailable gate is explicitly
  deferred and not summarized as green.
- YouTube quota/search counters are unchanged during runtime proof.
- Screenshots were visually inspected and the final minimal couch test was
  completed, or its specific human-only remainder is documented.
- Any correction is regression-tested, committed, pushed, redeployed, and
  re-proved.
- The report is complete, sanitized, committed, and pushed.

Start with H1. Do not touch the Pi until its H2 preconditions can be proved.
