# Codex implementation brief — deploy and prove playback, source, and Native Live hardening on the mango Pi

You are an autonomous coding agent working in the **`mango`** repository on the
home Mac, which can reach both GitHub and the mango Pi. You have **no prior chat
context**. Read this file **top to bottom before running commands or changing
code**. It is the complete deployment, validation, correction, and reporting
contract for the already-pushed playback/source/Native-Live change set.

You MAY use the repository's SSH/deploy wrappers from the home Mac and perform
real couch tests on the Pi. You MAY make corrections, commit them as new
commits, push them to `origin/feat/native-experience`, and redeploy when runtime
evidence proves a defect. Never copy repository files to the Pi outside Git.

## 0. TL;DR of the mission

Deploy the commit that contains this specification to the Pi, independently
verify the local checks, then prove the previously deferred runtime and couch
contracts. The important outcomes are: successful episodes clear stale retry
state; playback exits restore the originating detail/focus; same-name remakes
do not mix; The Martian and Dune expose honest stream lists and choose smooth
fallbacks; source/debrid policy remains intact; and all six Native Live rails,
search health, and playback ladders are thin, qualified, native, and resilient.

Workstreams, in dependency order:

1. **H1 — preflight and clean git-only deployment**
2. **H2 — automated Pi gates and runtime health**
3. **H3 — playback success, return-focus, timeout, and ownership proof**
4. **H4 — source policy, title identity, popular-title lists, and 4K proof**
5. **H5 — Native Live data rebuild, rail/search qualification, and failover**
6. **H6 — evidence-led corrections, full regression, and final report**

## 0.1 Overriding principle — couch correctness and honest runtime proof

- Never turn source inspection, a local test, an HTTP 200, or a configured
  quality label into a Pi/couch pass. Observe the real behavior required by the
  acceptance clause.
- Preserve playback-for-sure and stream coverage. Do not weaken fallback
  ladders merely to make a preferred candidate win.
- Preserve native Mango ownership: launcher, Native Live search, resolution,
  and playback remain inside Mango through mpv. Do not open another app.
- Fix wiring, identity, lifecycle, and state correctness before considering
  timeout/budget/concurrency/TTL tuning.
- If a check cannot be completed, write `DEFERRED — <exact reason>` and the
  exact next command/action. Never mark it green.

## 1. What you MAY and MUST NOT do

**You MAY:**

- Use `scripts/pi-exec.sh`, `scripts/pi-deploy.sh`, and
  `scripts/pi-exec-gate.sh` from the home Mac.
- Inspect Pi services, journals, operator-owned databases/caches, generated
  manifests, NexoTV containers, mpv IPC/properties, display state, and health
  endpoints as needed. Redact credentials, tokens, complete playback URLs, and
  raw AREA69 identifiers from all output committed to Git.
- Rebuild the AREA69 v2 search index and apply the checked-in curated NexoTV
  profiles using the exact repository commands below.
- Make principled fixes on `feat/native-experience`, add regression tests, run
  the full local matrix, commit as **new** commits, push, redeploy, and repeat
  until the acceptance clauses pass or a genuine external blocker remains.

**You MUST NOT:**

- Switch or create branches. First run `git branch --show-current`; if it is
  not exactly `feat/native-experience`, STOP and report.
- Use `rsync`, `scp`, tar-copy, or hand-copy `src/`, `scripts/`, `config/`, or
  any repository file to the Pi. Git commit/push/pull is the only deploy path.
- Use `git reset --hard`, destructive `git clean`, implicit stash, force push,
  amend a published commit, bypass hooks with `--no-verify`, or rewrite history.
- Delete or overwrite intentional home-Mac/Pi worktree changes. If either tree
  is dirty in a way that prevents a safe pull, stop and report the paths.
- Commit `/etc/mango/*`, credentials, `.env` files, tokens, generated manifest
  URLs, AREA69 M3Us/indexes, `playability.db`, health registries, caches, logs,
  screenshots containing secrets, or other operator-owned state.
- Change tuned numeric defaults—timeouts, provider budgets, concurrency,
  attempts, TTLs, cache horizons, or rail limits—to make a check pass. Record a
  measurement-backed proposal in the report and ask the user before tuning.
- Weaken the debrid contract: TorBox uncached stays retained; Real-Debrid
  uncached stays excluded. Do not reduce configured VOD source coverage.
- Broaden Native Live beyond the four existing inventories: `mango Live TV`
  (AREA69), `mango Live Free`, `mango Live News`, and `mango Live Cartoons`.
- Open Stremio, Kodi, a browser service, a rights-holder app, or any external
  app to satisfy a Native Live acceptance check.
- Fabricate evidence, conceal failed attempts, or call warnings/pending probes
  passes. Record the exact failing command and relevant redacted output.

**You MUST:**

- Preserve operator-owned `/etc/mango/*`, `~/.config/mango/*`, databases,
  secrets, generated indexes, and local dependencies unless an explicit
  command in this spec safely regenerates the relevant artifact.
- Capture home-Mac HEAD, origin HEAD, and Pi HEAD before and after deployment.
- Run workstreams in order. Fix regressions before moving to the next one.
- Write `HOME_PI_PLAYBACK_LIVE_VALIDATION_REPORT.md` as specified in §9.

## 2. Repository map and sources of truth

- **Home-Mac repo:** locate the existing `mango` clone, `cd` to it, and resolve
  its root with `REPO_ROOT="$(git rev-parse --show-toplevel)"`. All repository
  paths and commands in this specification are relative to `$REPO_ROOT`; do not
  create a second checkout unnecessarily.
- **Pi repo:** `aman@mango:~/mango`; mDNS fallback is `mango-mdns`.
- **Branch:** `feat/native-experience`.
- **Entry rules:** `AGENTS.md` and the workspace `../AGENTS.md` if present.
- **Deploy truth:** `docs/DEPLOY.md` and
  `docs/DEPLOY-SPLIT-MACHINE.md`.
- **Runtime/couch truth:** `docs/COUCH_TEST.md`, especially the sections
  `Playback-hardening acceptance`, `Episode success reconciliation`,
  `Stream-source policy and resolve-load confirmation`, `Popular-title stream-list
  and smoothness confirmation`, `Same-name title identity`, and `Native Live
  curation and playable-search confirmation`.
- **Native Live truth:** `docs/LIVE_TV.md` and
  `config/catalog-live.example.yaml`.
- **Implementation/report context:**
  `EFFICIENCY_AND_SOURCES_CODEX_REPORT.md`.
- **Primary implementation surfaces:** `src/catalog-service/`,
  `src/launcher/`, `scripts/live/`, `config/`, and `docs/`.

Before work, read every source-of-truth file above in full. Treat checked-in
commands as authoritative if this brief and a newer repository doc differ;
record the discrepancy rather than guessing.

## 3. Environment and verification commands

### 3.1 Home-Mac preflight

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
git branch --show-current
git status --short --branch --untracked-files=all
git fetch origin feat/native-experience
git rev-list --left-right --count HEAD...origin/feat/native-experience
git pull --ff-only origin feat/native-experience
git status --short --branch --untracked-files=all
git rev-parse HEAD
git rev-parse origin/feat/native-experience
```

Required: correct branch, clean home-Mac tree, fast-forward-only pull, and equal
local/origin hashes. If the tree is dirty, do not stash/reset/clean it
implicitly. Diagnose and stop with the exact paths if it cannot be preserved.

### 3.2 Independent clean local matrix

Run sequentially; do not overlap catalog commands because they rebuild the
same `dist` directory.

```bash
cd src/catalog-service
npm run build
npm test
npm run test:gate

cd ../..
python3 scripts/live/test_build_curated_area69_m3u.py
python3 scripts/live/test_build_curated_cartoons_m3u.py
python3 -m py_compile \
  scripts/live/build-curated-area69-m3u.py \
  scripts/live/test_build_curated_area69_m3u.py \
  scripts/live/build-curated-cartoons-m3u.py \
  scripts/live/test_build_curated_cartoons_m3u.py \
  src/mango-ui-server/serve.py

cd src/launcher
npm run build
bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh

cd ../..
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
bash -n \
  scripts/m2-catalog/service/mpv-play.sh \
  scripts/m2-catalog/service/mpv-stop.sh \
  scripts/m3-play/playability/mpv-probe-ipc.sh \
  scripts/lib/couch-activity.sh \
  scripts/m6-ship/gate-m6-playback-ssot.sh
MANGO_REPO_DIR="$PWD" \
MANGO_GATE_SOURCE_ONLY=1 \
MANGO_MPV_STOP_LAUNCHER=1 \
MANGO_MPV_DEFER_FOREGROUND=1 \
  bash scripts/m6-ship/gate-m6-playback-ssot.sh
git diff --check
```

The work-Mac reference run was: catalog 656/656 and 301/301; AREA69 Python
4/4; cartoon Python 4/4; launcher 26 modules and 15/15 with two expected
off-Pi warnings; orchestrator 83/83; shell/Python/SSOT source gates passed with
three expected off-Pi warnings. Re-derive these results; do not trust the
reference counts if the pushed tree has changed.

### 3.3 Git-only first deployment

First prove SSH and clean Pi Git state without printing configuration secrets:

```bash
bash scripts/pi-exec.sh \
  'hostname; cd ~/mango; git branch --show-current; git status --short --branch --untracked-files=all; git rev-parse HEAD'
```

If static-IP alias `mango` fails but `mango.local` resolves, prefix all wrapper
commands with `MANGO_SSH_HOST=mango-mdns`. This is only a transport fallback.

Use a clean release deployment for this first handoff:

```bash
bash scripts/pi-deploy.sh --full --gate

git rev-parse HEAD
bash scripts/pi-exec.sh 'cd ~/mango && git rev-parse HEAD'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/mango-stack.sh status'
```

Home-Mac, origin, and Pi hashes must match. If Pi pull is blocked by a dirty
tree, inspect and report it; never reset or copy files to get around it.

### 3.4 Automated Pi gates

Run default and full gates when no couch playback or maintenance job is active:

```bash
bash scripts/pi-exec-gate.sh
bash scripts/pi-exec.sh \
  'cd ~/mango && MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m4-addons/gate-m4-self-hosted.sh'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m3-play/playability/gate-m3-verified-rails.sh'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
```

If an optional subsystem is intentionally disabled, record `DEFERRED` or
`N/A — disabled by <redacted setting>` according to the gate contract; do not
rewrite a gate to make it green. Also run the UX smoke on the Pi and record any
runtime-only warnings:

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango/src/launcher && bash ../../scripts/m6-ship/gate-m6-ux-smoke.sh'
```

## 4. Background and expected behavior

The pushed changes address several independent but interacting failures:

- A successful non-`:1:1` episode used to be unable to replace its exact stale
  failed playability row, so it could play and later appear grey with `tap to
  retry`. A launcher freeze/abort race could also show a late `catalog timed
  out` even after playback succeeded.
- Playback return state is now durable across the Chromium restart used by the
  matched-4K path. Early episode exit should restore the same episode; natural
  EOF or at least 90% completion should focus the next episode, including a
  season boundary. Movie exit should restore the same detail page with Play
  focused, never reset to Movies home.
- Stream identity now uses title/year/country/episode evidence to reject an
  explicit remake conflict while keeping ambiguous provider rows, preventing
  UK `The Office` from resolving explicit US `The Office` releases.
- Movie detail now late-joins only the identical in-flight resolve after its
  existing browse timeout. It must neither hide the stream strip nor start a
  duplicate provider fan-out. Hifi fallback prefers smooth 1080p TorBox before
  software/HDR 4K while keeping the latter available later.
- Native Live rail membership is eligibility-first. Rail qualification is
  separate from full-catalog search. Persistent hashed health suppresses known
  failures; unknown proof is bounded to two seconds; AREA69 proof yields to any
  active Mango playback; and logical variants fail over inside one `/play`.

No tuned timeout, provider budget, concurrency, attempt, or TTL default was
changed. The only approved bounded search behavior is the specified two-second
Live unknown-validation allowance.

## 5. Existing tooling to reuse

| Need | Reuse this | Notes |
|---|---|---|
| Git-only deploy | `scripts/pi-deploy.sh` | First handoff: `--full --gate`; correction loop: `--fast --gate` unless dependencies changed |
| Remote commands | `scripts/pi-exec.sh` | Never replace with copied files |
| Pre-couch proof | `scripts/pi-exec-gate.sh`, `scripts/pi-pre-couch-gate.sh` | Default plus `MANGO_GATE_FULL=1` |
| Playback profile | `scripts/m6-ship/set-playback-engine.sh` | Apply `mpv-hifi`, then inspect `status` |
| 4K runtime evidence | `scripts/diag/playback-4k-proof.sh` | Real presented/dropped-frame and decoder/output proof |
| Source policy | `scripts/m4-addons/aiostreams-config.sh verify` | Credential-safe; do not print profile JSON |
| Live index | `scripts/live/build-curated-area69-m3u.py` | Writes operator-owned v2 index/M3U |
| NexoTV profiles | `scripts/live/nexotv-config.sh` | Apply curated free/news/cartoons, AREA69, and wire export |
| Live diagnostics | `scripts/live/live-diagnostics.sh`, `scripts/live/gate-live-diagnostics.sh` | Health-only, no broad play sweep |
| Opt-in Live proof | `scripts/live/probe-live-catalog.sh`, `scripts/live/gate-live-iptv.sh` | Never run while another Mango playback is active |
| Runtime acceptance | `docs/COUCH_TEST.md` | Execute every named section, not a paraphrased subset |

Build on these tools. Do not create a parallel deploy mechanism, a second Live
search path, an external-app handoff, or a new health store.

## 6. Workstreams and acceptance

### H1 — preflight and clean git-only deployment

**Deliverables**

1. Read §2 sources in full; record the intended commit hash.
2. Prove home-Mac branch/tree/origin alignment and rerun §3.2.
3. Prove SSH; inspect Pi branch/tree/HEAD without mutation.
4. Deploy with §3.3, then prove equal home/origin/Pi hashes and healthy stack.

**Acceptance:** no unpreserved dirt, no copied repo files, all clean local
checks honestly recorded, deploy command exits 0, and all three hashes match.

### H2 — automated Pi gates and runtime health

**Deliverables**

1. Run every §3.4 gate sequentially with no active playback/maintenance.
2. Inspect `catalog-service`, launcher, pad, mpv, NexoTV/addon, and Reliability
   state when a gate warns or fails. Capture only redacted excerpts.
3. Correct real regressions before beginning manual playback work.

**Acceptance:** required gates pass on the Pi; optional disabled subsystems are
explicitly identified; no failure/warning is silently called green.

### H3 — playback success, return-focus, timeout, and ownership proof

Execute the exact `Playback-hardening acceptance` and `Episode success
reconciliation` sections in `docs/COUCH_TEST.md`, including their SQLite/API
before-and-after evidence.

At minimum prove:

1. A stale-failed episode other than `:1:1` starts, returns without a late
   timeout toast, becomes fresh `verified`/playable, and loses grey retry state.
2. A genuine pre-play failure remains visible/retryable and is not falsely
   verified. Bare-series and `:1:1` gate behavior does not regress.
3. Movie Y-back from both 1080p and matched-4K restores the same tab/title
   detail with Play focused.
4. Early episode exit restores the same title/season/episode and focuses that
   episode. At `>=90%`/EOF, focus advances to the next episode, including across
   a season boundary. No next-prompt overlay steals focus.
5. Timeout cancellation cannot create a ghost mpv after the launcher gives up.
6. Picker mode attempts only the selected URL/ladder step; hard-language mode
   never attempts a wrong-language row.
7. A long play is not interrupted by maintenance; Y/Home stop restores
   `1920x1080@60` and the launcher before accepting more input.

**Acceptance:** visible couch behavior and corresponding redacted DB/API/log
proof agree for every item. A server log without the visible/focus result is
not sufficient.

### H4 — source policy, title identity, popular-title lists, and 4K proof

Execute the exact `Stream-source policy and resolve-load confirmation`,
`Popular-title stream-list and smoothness confirmation`, and `Same-name title
identity` sections in `docs/COUCH_TEST.md`.

Required points:

1. Reapply and verify the installed hifi profile:

   ```bash
   bash scripts/pi-exec.sh \
     'cd ~/mango && bash scripts/m6-ship/set-playback-engine.sh mpv-hifi && bash scripts/m6-ship/set-playback-engine.sh status'
   ```

2. `aiostreams-config.sh verify` confirms TorBox uncached retained and RD
   uncached excluded. Actual stream rows confirm cached TB/RD parsing, retained
   TB uncached, and no known-RD-uncached couch row.
3. Configured Torrentio/Comet/MediaFusion coverage remains present through
   AIOStreams; an optional direct MediaFusion supplement adds only unique rows.
4. Foreground resolve is never held behind background verification, and
   background same-title work joins/defers instead of parallel fan-out.
5. From a cold detail-open, The Martian (`tt3659388`) and Dune 2021
   (`tt1160419`) keep a visible `finding...` state through an identical-flight
   late join, then show rows or an honest `none found`/`unavailable — Play
   retries` state. One user action causes one provider fan-out.
6. With relevant fixtures available, auto Play orders smooth
   `1080p_uncached_fallback` before software/HDR 4K, while the 4K alternative
   remains later in the ladder.
7. UK `The Office` (`tt0290978`) S1E1 plays **Downsize**, not the US **Pilot**;
   repeat a later UK episode. US `The Office` (`tt0386676`) remains correct.
   Explicit remake conflicts are `title_mismatch`; ambiguous rows remain.
8. Run `scripts/diag/playback-4k-proof.sh` during a real 4K play. Call a stream
   smooth 4K only with 2160p SDR HEVC hardware decode and acceptable real
   presented/dropped-frame evidence. Do not infer capability from the filename.

**Acceptance:** debrid/source coverage is preserved, UK/US identity is visibly
correct, popular-title rows are honest and non-duplicative, and the smoothness
claim is backed by actual target-TV decoder/frame evidence.

### H5 — Native Live data rebuild, qualification, search, and failover

First ensure no Mango playback is active. Never print the AREA69 credential
file, full M3U, complete stream URL, or raw index entries.

Run the checked-in rebuild/apply sequence on the Pi:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && \
  python3 scripts/live/build-curated-area69-m3u.py \
    --out ~/.local/share/mango/nexotv/data/live-area69-curated.m3u \
    --index-out ~/.local/share/mango/nexotv/data/area69-live-search.json && \
  jq "{version,built_at,stream_count,entries:(.entries|length)}" \
    ~/.local/share/mango/nexotv/data/area69-live-search.json && \
  bash scripts/live/nexotv-config.sh apply-free m3u-sports-curated && \
  bash scripts/live/nexotv-config.sh apply-news m3u-news-hi-en && \
  bash scripts/live/nexotv-config.sh apply-cartoons m3u-cartoons && \
  bash scripts/live/nexotv-config.sh wire-export && \
  rm -f ~/.cache/mango/live-rails-cache.json && \
  MANGO_CATALOG=1 bash scripts/mango-stack.sh restart'
```

If the AREA69 profile/credentials were never installed, use the existing
`nexotv-config.sh apply-area69` path from `docs/LIVE_TV.md`; do not create or
commit credentials. Let NexoTV repopulate before judging rail emptiness.

Then run diagnostics and opt-in proof only while foreground playback is idle:

```bash
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/live/live-diagnostics.sh --json'
bash scripts/pi-exec.sh \
  'cd ~/mango && bash scripts/live/gate-live-diagnostics.sh'
bash scripts/pi-exec.sh \
  'cd ~/mango && MANGO_LIVE_PROBE=1 bash scripts/live/probe-live-catalog.sh'
bash scripts/pi-exec.sh \
  'cd ~/mango && MANGO_LIVE_GATE=1 MANGO_LIVE_PLAY=1 bash scripts/live/gate-live-iptv.sh'
```

Execute the exact `Native Live curation and playable-search confirmation`
section in `docs/COUCH_TEST.md`. Prove all of the following:

1. AREA69 safe summary reports index version 2. Legitimate current event rows
   survive; placeholder, VOD-pack, replay, offline, and ended rows do not.
2. Rails remain in order: FIFA World Cup, cricket, soccer, Formula 1, news,
   cartoons. A rail with no current qualifying item is hidden, not broadly
   substituted or restored from a legacy cache.
3. FIFA is current senior men's World Cup matches only. Cricket requires India
   as an explicit participant and rejects West Indies/incidental `Indian`.
   Soccer proves a current Premier League, La Liga, Bundesliga, Serie A, Ligue
   1, Champions League, or Europa League matchup.
4. A standing sports channel qualifies only when current EPG/programme text
   proves both allowed competition and matchup. Generic broadcasters do not
   qualify by brand alone.
5. F1 has at most exact F1 TV, Sky Sports F1, DAZN F1, and Viaplay F1 variants.
   News has only the exact target identities, at most 12. Cartoons has at most
   eight classics-first English/Hindi-qualified families.
6. Full-catalog native Live search remains separate from rail curation. Fresh
   verified matches return immediately, fresh failures stay suppressed, and a
   never-tested response waits no more than the approved two-second allowance;
   unfinished proof is omitted until a later search.
7. While any Mango VOD or Live playback is active, an AREA69 search does not
   start a background probe or consume its single connection. Demonstrate this
   using health/journal evidence without disrupting the foreground play.
8. `2160p` ranks as 4K and only explicit `8K`/`4320p` ranks above it. Within a
   quality tier, English/Hindi and codec/health tie-breakers behave as documented.
9. A logical channel/event with multiple qualified variants displays once. If
   the first playback-start candidate fails, Mango tries the next within the
   same request/deadline, never opening another app. The success promotes the
   working variant and the failure is suppressed on a later search.
10. `~/.cache/mango/live-channel-health.json` is mode 0600 and contains only
    hashed `v1:` keys, statuses/timestamps, and sanitized reasons—no URLs,
    credentials, source names, or raw channel IDs.

**Acceptance:** exact eligible membership, safe EPG behavior, search latency,
single-connection ownership, native mpv playback, fallback, and outcome
learning are proven on the Pi. An empty current-event rail is a correct result
when the eligibility evidence is absent; generic filler is a failure.

### H6 — corrections, complete regression, and report

For every failure:

1. Correlate visible behavior with catalog/launcher/mpv/NexoTV logs and the
   relevant operator state. State the root cause before editing.
2. Fix the smallest owning layer. Add a focused regression test that fails on
   the old behavior. Do not tune numbers or reduce coverage.
3. Run the affected tests, then the entire §3.2 matrix sequentially.
4. Inspect `git diff` and `git diff --check`; scan staged content for secrets.
5. Commit a new, imperative commit. Never amend the already-pushed handoff
   commit. Push only `feat/native-experience` without force.
6. Deploy with `bash scripts/pi-deploy.sh --fast --gate` (use `--full --gate`
   only if dependencies/lockfiles changed), rerun the failing Pi/couch case,
   and rerun any gate whose owning layer changed.
7. Repeat until every required acceptance clause passes or a genuine external
   blocker is precisely documented.

Finally rerun the full automated Pi gate and a representative end-to-end couch
sequence: browse Movies -> play/return -> Series episode early exit -> episode
completion/next focus -> UK Office -> The Martian/Dune -> Live search -> Live
variant play/fallback -> Home. Confirm no wallpaper, external app, lost focus,
ghost mpv, or watchdog restart.

**Acceptance:** all corrections are tested, committed, pushed, deployed through
Git, and re-proven on the Pi; report evidence matches actual command results.

## 7. Ordering and working method

Do **H1 -> H2 -> H3 -> H4 -> H5 -> H6**. Do not start rate-limited Live probing
beside playback or another Live gate. Do not run multiple catalog build/test
commands concurrently. Keep a timestamped evidence log as you work, but redact
URLs/credentials/IDs before placing anything in the repository.

Prefer pure policy/identity helpers and focused fixtures for corrections. Keep
API changes additive and backward compatible. Preserve existing channel IDs,
provider coverage, and fallback depth unless the specification explicitly
curates a browse rail.

## 8. Commit and push policy

The user has explicitly authorized this home-agent mission to commit and push
required corrections and the final validation report.

- Do not create a commit merely to restate evidence if nothing changed; the
  final report itself may be one evidence commit.
- One coherent correction per commit where practical; imperative subject that
  explains why. Let hooks run.
- Never amend/force/rebase published history or use `--no-verify`.
- Before every commit: `git status`, `git diff`, `git diff --check`, staged-file
  review, and credential/URL scan.
- Push only `origin feat/native-experience`; verify the remote SHA after push.
- Every Pi redeploy must pull that exact pushed SHA. Never deploy an uncommitted
  home-Mac tree.

## 9. Definition of done and report contract

Create `HOME_PI_PLAYBACK_LIVE_VALIDATION_REPORT.md` in the repository. Include:

1. Date/time zone, home-Mac repo path, branch, initial deployed commit, final
   commit, origin SHA, and Pi SHA.
2. A guardrail audit: Git-only deploy, no copied files, no secrets captured,
   no tuned-default/debrid/coverage weakening, and no external Live app.
3. H1-H6 sections with exact commands, exit status, relevant redacted output,
   couch action, visible result, and linked evidence for each acceptance clause.
4. An explicit table for every row in the named `docs/COUCH_TEST.md` sections:
   `PASS`, `FAIL`, `DEFERRED — reason`, or `N/A — justified`; no blank cells.
5. Root cause, files, tests, commits, and post-deploy proof for every correction.
6. Failed/preliminary runs as failures; do not silently replace them with the
   later green rerun.
7. A source/coverage audit for RD, TorBox, AIOStreams/Torrentio/Comet/
   MediaFusion and the four approved Native Live inventories.
8. Live safe summaries: rail counts/titles/programmes, search timing, health
   counts, fallback attempt order, and credential-safety checks. Never include
   complete stream URLs or raw AREA69 identifiers.
9. 4K proof with actual decoder/output/presented/dropped-frame evidence and an
   honest conclusion about what is smooth on this Pi/TV.
10. A `Deferred / external blockers` section with exact next action for every
    unresolved item, followed by the final overall verdict.

Done means the report is written, the complete local and Pi matrices have been
run, all required runtime/couch clauses pass or are honestly blocked, every fix
is committed/pushed/deployed, and local/origin/Pi all point to the same final
commit. Do not declare the system fully working while any required row is FAIL
or unsupported by runtime evidence.

---

## Starter prompt (paste to the home Codex agent)

```text
You are the home-Mac deployment and validation agent for mango. The complete
contract is in `HOME_PI_PLAYBACK_LIVE_VALIDATION_CODEX_SPEC.md` at the repository
root. Locate the existing mango clone, cd to its root, then read that file top
to bottom before running any other command. Work only on
feat/native-experience; verify the branch and stop if it differs. Pull
fast-forward-only, deploy only through the repo's git-based Pi scripts, and
never rsync/scp/hand-copy repo files.
Run H1 through H6 in order, perform the real Pi and couch checks, diagnose and
correct failures with tests, commit/push new fixes without amend/force, redeploy,
and repeat until verified. Never expose secrets or fabricate a pass. Write and
push HOME_PI_PLAYBACK_LIVE_VALIDATION_REPORT.md with exact evidence and honest
deferred items as required by section 9.
```
