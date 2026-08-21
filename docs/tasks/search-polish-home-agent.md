# Home-agent validation brief — Mango Search polish

> **Historical Search-release contract.** Preserve its observations, but do not
> execute the embedded deploy wrappers as current instructions: they are blocked
> for unattended use. Reconcile the target SHA and flow with
> [`../DEPLOY.md`](../DEPLOY.md), [`../STATUS.md`](../STATUS.md), and
> [`../COUCH_TEST.md`](../COUCH_TEST.md).

You are the home-side deployment and validation agent for the **`mango`**
repository. You have no prior chat context. Read this file top to bottom before
running commands. The work Mac owns the implementation; your job is to deploy
the supplied commit to the Pi, prove the Search fixes on real hardware, perform
safe runtime repair when needed, and make only narrowly evidenced Search-source
fixes if Pi testing proves they are necessary.

## 0. Mission

Validate a Search hardening slice that:

1. removes routine `Refresh YouTube` from the couch UI;
2. retries only a completed degraded YouTube phase, without rerunning VOD,
   Live, or AI;
3. keeps every More tile inside its own rail's D-pad focus grid;
4. fills the YouTube video shelf as two six-slot rows;
5. improves VOD/YouTube artwork selection and launcher fallback;
6. updates YouTube quota accounting to separate the 100-call Search bucket
   from the 10,000-unit general metadata bucket.

The assignment message must provide `TARGET_SHA`. If it does not, stop and ask
for it. Never infer the target from an old local checkout.

## 0.1 Overriding principle

**Do not trade durable Pi state or a healthy couch stack for a passing test.**

- Deploy by git only.
- Preserve `/etc/mango`, credentials, OAuth state, library DBs, YouTube DB,
  playability DB, and user history.
- Never spend YouTube quota merely to prove pagination.
- Never report a couch behavior as passing unless it was physically observed.
- A test that cannot be run is `DEFERRED` with the exact reason, not green.

## 1. Authority and hard constraints

You MAY:

- Pull and deploy the supplied commit on the home Mac and Pi.
- Run repository gates, read-only APIs, logs, process checks, and D-pad couch
  tests.
- Restart Mango through repository scripts when idle.
- Apply safe runtime repair already supported by Mango.
- If a reproducible Pi-only source defect remains, make the smallest
  Search-related source/test fix, rerun all required gates, commit it, and push
  it to `feat/native-experience` so the work Mac can pull it.

You MUST NOT:

- Use `rsync`, `scp`, or manually copy repository files to the Pi.
- Delete/rebuild runtime DBs, clear YouTube cache/history, disconnect OAuth,
  overwrite secrets, unpair the controller, or alter playback/display policy.
- Reset, clean, force-checkout, amend, force-push, change git config, create a
  tag, or use `--no-verify`.
- Touch unrelated dirty files. If the home Mac or Pi repo is dirty, stop and
  report the exact `git status --short`.
- Intentionally exhaust quota or break API credentials to force Retry state.
- Expose API keys, OAuth tokens, provider URLs, stream URLs, or cookies in the
  report.

Source-fix scope, only after concrete reproduction:

- `src/launcher/src/{search,home,poster,style}.ts` / `style.css` as applicable;
- `src/catalog-service/src/search/*`;
- `src/catalog-service/src/{poster,voice/external}.ts`;
- `src/catalog-service/src/youtube/{api,db,types}.ts`;
- directly corresponding tests and Search/YouTube docs.

Anything outside that scope must be reported to the work agent instead of
patched.

## 2. Environment and repository

- Branch: `feat/native-experience`
- Home Mac repo: locate the existing Mango clone; common path is
  `~/Documents/personal/projects/mango`
- Pi SSH: `mango`, fallback `mango-mdns`
- Pi repo: `/home/aman/mango`
- Catalog: `http://127.0.0.1:3020`
- Launcher: `http://127.0.0.1:3000`

Set the supplied SHA:

```bash
export TARGET_SHA='<SHA_FROM_ASSIGNMENT>'
test -n "$TARGET_SHA"
```

## 3. Pre-deploy proof

On the home Mac:

```bash
cd ~/Documents/personal/projects/mango
test "$(git branch --show-current)" = "feat/native-experience"
test -z "$(git status --porcelain)"
git fetch origin feat/native-experience
git cat-file -e "$TARGET_SHA^{commit}"
git merge-base --is-ancestor "$TARGET_SHA" origin/feat/native-experience
```

Capture but do not publish secrets:

```bash
git rev-parse --short HEAD
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse --short HEAD && git status --short'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'
```

If SSH fails, retry once with:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-exec.sh 'echo ok'
```

## 4. Deploy

Fast deploy is correct because package locks are unchanged:

```bash
git pull --ff-only origin feat/native-experience
test "$(git rev-parse HEAD)" = "$(git rev-parse "$TARGET_SHA")"
bash scripts/pi-deploy.sh --fast --gate
```

If the static alias fails, use:

```bash
MANGO_SSH_HOST=mango-mdns bash scripts/pi-deploy.sh --fast --gate
```

After deploy:

```bash
bash scripts/pi-exec.sh "test \"\$(cd ~/mango && git rev-parse HEAD)\" = \"$TARGET_SHA\""
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'
```

Do not continue to couch testing unless catalog, launcher, and pad are healthy
or the exact degraded component is explained.

## 5. Automated Pi validation

Run:

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango/src/catalog-service && node --test \
    dist/search/service.test.js \
    dist/poster.test.js \
    dist/youtube/db.test.js \
    dist/youtube/api.test.js'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-ux-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-search-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-youtube-smoke.sh'
bash scripts/pi-exec-gate.sh
```

The Search smoke is diagnostic/cache-only and must not write recents, probe
Live, call AI, play media, or spend YouTube quota.

Capture quota shape before and after pagination testing:

```bash
bash scripts/pi-exec.sh \
  "curl -sf http://127.0.0.1:3020/youtube/state | python3 -c \
  'import json,sys; r=json.load(sys.stdin)[\"refresh\"]; print(json.dumps({k:r.get(k) for k in \
  [\"quota_used_today\",\"search_calls_today\",\"quota_budget\",\"interactive_reserve\",\
  \"search_call_budget\",\"interactive_search_call_reserve\",\
  \"background_search_calls_remaining\",\"interactive_search_calls_remaining\"]}, indent=2))'"
```

Expected defaults:

- `quota_budget=10000`
- `interactive_reserve=2500`
- `search_call_budget=100`
- `interactive_search_call_reserve=25`

Do not require usage counters to be zero; they are durable operator state.

## 6. Couch acceptance

Use the connected controller. Do not enter controller pairing mode.

1. Open Search and confirm no permanent `Refresh YouTube` button exists.
2. Submit a broad query expected to have many cached YouTube matches, such as
   `music`, `dune`, or `india`.
3. Confirm the YouTube video shelf occupies exactly two six-slot rows:
   - 12 videos when only 12 or fewer remain;
   - 11 videos plus one same-sized More tile when more results remain.
4. From YouTube row one, press Down. Focus must move to the corresponding
   column in YouTube row two.
5. From row two, press Down away from the More tile. Focus must enter the next
   content rail, never jump to an unrelated detached action.
6. Reach More with horizontal movement in the YouTube row. Select it.
   The next cached batch must appear, focus must move to the first newly
   revealed video, and there must be no full-screen blackout.
7. Re-read `/youtube/state`. Selecting More must not increment
   `search_calls_today` or general quota usage.
8. Inspect Top Results, Movies, TV Shows, Live, YouTube, and More Movies &
   Shows. No failed or absent image may leave an empty black card; a stable
   title-initial fallback is acceptable.
9. Open one VOD and one YouTube result, return with Y, and confirm exact Search
   query, rail, page, and card focus restoration.

Retry acceptance:

- If YouTube naturally degrades, confirm `Retry YouTube` appears only then.
  Selecting it must leave VOD/Live rows and focus state intact.
- If YouTube is healthy, record this item as
  `DEFERRED: degraded-only retry was unit-tested but no natural Pi failure was
  available; credentials/quota were intentionally not disturbed`.

## 7. Diagnostics and safe repair

If a gate or couch test fails, collect:

```bash
bash scripts/pi-exec.sh \
  'journalctl --user -u mango-catalog.service -u mango-ui-server.service \
    -u mango-launcher-chromium.service -n 250 --no-pager'
bash scripts/pi-exec.sh \
  'cd ~/mango && git status --short && bash scripts/mango-stack.sh status'
bash scripts/pi-exec.sh \
  'curl -sf http://127.0.0.1:3020/reliability/state | python3 -m json.tool'
```

Safe repair while idle:

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango && MANGO_CATALOG=1 bash scripts/mango-stack.sh restart'
bash scripts/pi-exec-gate.sh
```

Never repair Search by deleting `youtube.db`, `library.db`, `progress.db`,
`playability.db`, browser storage, OAuth files, or API keys.

## 8. Source-fix protocol

Only patch source after:

1. reproducing the failure twice;
2. recording exact D-pad steps or API request;
3. capturing relevant logs without secrets;
4. proving restart/safe repair does not resolve it.

Then make the smallest in-scope change on the home Mac, not directly on the Pi.
Run:

```bash
cd src/catalog-service && npm run test:gate && npm test
cd ../launcher && npm run build
cd ../..
bash scripts/m6-ship/gate-m6-ux-smoke.sh
git diff --check
```

Commit only the minimal correction:

```bash
git add <EXACT_SEARCH_RELATED_FILES>
git commit -m "fix(search): correct Pi couch regression"
git push origin feat/native-experience
bash scripts/pi-deploy.sh --fast --gate
```

Report the new SHA so the work Mac can pull it. Never combine unrelated cleanup.

## 9. Report

Return a concise report with:

- deployed target SHA and Pi SHA;
- every automated command and pass/fail result;
- before/after quota counters;
- couch results for steps 1–9;
- Retry result or exact `DEFERRED` statement;
- poster failure count and affected source/type if nonzero;
- logs/root cause for any failure;
- runtime repair performed;
- source-fix commit SHA, if any;
- remaining blockers.

Do not call the feature shipped if any D-pad path, quota-preservation check,
focus restoration, or blank-artwork check is unverified.
