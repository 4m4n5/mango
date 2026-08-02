# Codex home-agent brief — deploy and finish Mango couch UX acceptance

You are an autonomous agent working from the **home Mac** Mango clone, on the
same LAN as the Raspberry Pi and physical TV. You have no prior chat context.
Read this file top to bottom before running commands or changing source. This is
the complete contract for deploying the current `feat/native-experience` tip,
proving it on the Pi and TV, autonomously diagnosing and improving every surface
that can be exercised safely, and then using a short human couch session only for
the final perceptual and physical-hardware judgments automation cannot make.

You MAY use the checked-in Git deploy/diagnostic scripts, SSH to the Pi through
those scripts, collaborate with the human tester, and make evidence-backed source
fixes in the home-Mac clone. You MAY systematically refactor an owning
implementation when evidence shows a structural defect, provided the locked
product contracts remain intact and deterministic tests prove the new invariant.
You MAY commit and push proven fixes and the final sanitized report to
`origin/feat/native-experience` as specified below.

## 0. TL;DR mission

Deploy the latest source tip containing all shipped ops, launcher-state, Search,
Cinema Dark, playback-ladder, and mpv HUD/Streams work. First exhaust what the
agent can prove alone: runtime health, logs, service ownership, real X11
screenshots, fixture renders, deterministic input flows, playback timing,
resolver contribution, failure recovery, resource pressure, and repeated gates.
For each real defect, capture evidence, identify the owning layer, implement a
principled source fix on the home Mac, test it, commit/push it, Git-deploy it, and
re-run the exact proof. Only after this loop is green should the human perform a
minimal couch test for legibility, motion feel, visible video, sound, physical-pad
feel, CEC, and other observations unavailable to automation.

Workstreams, in order:

1. **S0 — Source and environment preflight**
2. **S1 — Git-only deploy and automated Pi gates**
3. **S2 — Autonomous diagnostics, state traversal, and screenshot audit**
4. **S3 — Autonomous principled repair, performance, and hardening loop**
5. **S4 — Final automated regression and evidence bundle**
6. **S5 — Minimal human couch test and last-mile tuning**
7. **S6 — Report, final safe state, commit, and push**

## 0.1 Overriding principle — automate exhaustively, then ask only what needs eyes and ears

- Do not spend human attention on anything logs, tests, X11 capture, fixture
  rendering, APIs, or deterministic input traversal can prove first.
- A source assertion or Mac render is not deployed-Pi proof. A Pi screenshot is
  deployed render evidence but not proof of TV-panel visibility, audio, physical
  controller feel, CEC action, HDR indication, or motion quality.
- The human reports only those remaining visible/audible/physical observations;
  the agent correlates them with pre-collected runtime state and logs.
- Never tune code to satisfy a screenshot if it worsens D-pad predictability,
  playback continuity, safe area, accessibility, or Pi performance.
- Never convert missing, blocked, or ambiguous evidence into a pass. Use
  `DEFERRED` with the exact reason and next action.
- Prefer one falsifiable hypothesis and one small fix over speculative redesign.

## 1. Authority and hard constraints

### You MAY

- Run read-only home-Mac and Pi diagnostics without asking for approval.
- Run the checked-in deploy, build, fixture-render, and gate scripts.
- Exercise non-destructive launcher flows with the existing X11/input harnesses,
  capture Pi screenshots, and inspect images/checksums without waiting for a human.
- Change repository source or docs on the home Mac after a reproducible automated,
  screenshot, log, performance, or human-observed failure.
- Commit and push a coherent, tested fix to `feat/native-experience`.
- Refactor the owning implementation when a local patch would preserve a flawed
  state model, race, ownership split, or duplicated policy. Keep the refactor
  bounded, reversible, and protected by focused plus full regression tests.
- Adjust documented TV-safe tokens when screenshot or human proof clearly
  identifies a legibility, safe-area, timing, density, or motion problem.

### You MUST NOT

- Switch or create branches. Verify `feat/native-experience`; if different, STOP.
- Use `rsync`, `scp`, archives, or hand-copy repository files to the Pi.
- Edit repository source directly on the Pi.
- Force-push, amend published commits, create tags, change Git config, use
  `--no-verify`, or discard/stash/reset unknown local work.
- Delete or rebuild runtime DBs, caches, history, Saved state, progress, proof
  ledgers, pairing state, or user configuration to make a test pass.
- Touch YouTube credentials, cookies, OAuth tokens, API keys, quota policy, or
  provider credentials.
- Print or commit tokens, signed URLs, private provider payloads, credentials,
  private transcripts, IP addresses, or new hardware identifiers.
- Pair/unpair the 8BitDo Micro as a normal reconnect fix. Pairing mode is recovery
  only after diagnostics prove pairing loss and the human explicitly approves.
- Install packages, reboot the Pi, intentionally put the TV into standby, alter
  CEC topology, or perform an OS-level rollback without telling the human what
  will happen and receiving approval.
- Reopen locked product decisions: X11/Openbox, mpv ownership, B select/Y back,
  voice-opens/pad-plays, five-choice explicit Streams switching, or intentional
  Settings-driven display sleep.
- Claim 4K/HDR, audio, CEC, controller, or couch behavior that was not observed on
  the actual target equipment.
- Ask the human to perform a long matrix before the autonomous baseline, repair,
  screenshot, and final-regression loops are complete.

### You MUST

- Preserve any pre-existing home-Mac or Pi dirt until its owner and purpose are
  understood. If it blocks a pull/deploy, report it; do not clean it reflexively.
- Keep Mac, origin, and Pi SHAs explicit at every deploy boundary.
- Stage only intentional files and inspect the staged diff before every commit.
- Add or strengthen a deterministic test for each source behavior you change.
- Re-run the focused test, affected build, relevant Pi gate, screenshot/state
  traversal, and—only when applicable—the final human row that failed.
- Keep screenshots temporary and sanitized. Do not commit copyrighted playback
  frames, personal library/history, voice transcripts, signed URLs, or secrets.
- Record screenshot label, UTC timestamp, pixel dimensions, byte size, checksum,
  foreground owner, and expected state. Distinct states must have distinct
  checksums; unchanged captures are not evidence that input succeeded.
- Keep the box usable and the display timeout restored to the locked 30-minute
  default at handoff.

## 2. Repository and contract map

- **Home Mac repo:** the user's Mango clone; establish with `pwd`.
- **Pi repo:** `~/mango` as user `aman`.
- **Branch:** `feat/native-experience` only.
- **Assignment target:** the starter prompt supplies an exact `TARGET_SHA`. Prove
  that SHA is the fetched `origin/feat/native-experience` tip (or an ancestor of
  it after a documented follow-up fix); never silently deploy an older local tip.
- **Minimum required source ancestry:**
  - the assignment's `TARGET_SHA` — atomic playback ownership and resolver-health
    hardening plus this cumulative home acceptance contract.
  - `b4d4f87` — restore Detail after a matched-4K playback exit.
  - `07af9dc`, `4e57ae5`, `c4cb91b` — normalized VOD addon discovery/fetch and
    Live/VOD isolation.
  - `afef49e` — cinematic mpv HUD and five-choice Streams drawer.
  - `63c34da` — launcher loading, empty, offline, stale, and toast states.
  - `539ebdb` — comprehensive launcher visual polish baseline.
  - `2cbb86a`, `f81c9f0`, `5f48adc` — normal BlueZ reconnect hardening.
- **Deploy contract:** `docs/DEPLOY.md`.
- **Split-machine contract:** `docs/DEPLOY-SPLIT-MACHINE.md`.
- **Existing ops/display/controller contract:**
  `docs/tasks/OPS_HEALTH_HOME_DEPLOY_PROMPT.md`.
- **Full human checklist:** `docs/COUCH_TEST.md`.
- **Playback contract:** `docs/ARCHITECTURE.md`, `docs/PLAYABILITY.md`,
  `docs/DECISIONS.md`, and `docs/HARDWARE.md`.
- **Final report:**
  `docs/tasks/FULL_COUCH_UX_HOME_ACCEPTANCE_REPORT.md`.

Read all of those files before the first couch session. The existing OPS prompt
remains binding for controller reconnect and locked display-sleep/CEC work; this
brief adds the consolidated P0/P1 UX acceptance lane and does not weaken it.

## 3. Environment and verification commands

### S0 preflight

```bash
git branch --show-current
git status --short
git fetch origin feat/native-experience
git rev-parse HEAD
git rev-parse origin/feat/native-experience
git merge-base --is-ancestor "$TARGET_SHA" origin/feat/native-experience
git merge-base --is-ancestor b4d4f87 origin/feat/native-experience
git merge-base --is-ancestor 07af9dc origin/feat/native-experience
git merge-base --is-ancestor 4e57ae5 origin/feat/native-experience
git merge-base --is-ancestor c4cb91b origin/feat/native-experience
git merge-base --is-ancestor afef49e origin/feat/native-experience
git merge-base --is-ancestor 63c34da origin/feat/native-experience
git merge-base --is-ancestor 539ebdb origin/feat/native-experience
```

If the home tree is clean, update only by fast-forward:

```bash
git pull --ff-only origin feat/native-experience
```

If the home tree is dirty, classify every path. Do not stash, restore, reset, or
overwrite it. Continue only if the existing work can be safely committed/pushed
or the human explicitly chooses how to resolve it.

### Local checks after any home-agent source fix

Run only the affected subset while iterating, then the complete relevant set
before pushing:

```bash
cd src/catalog-service && npm run test
cd ../launcher && npm run build
cd ../companion && npm run build
cd ../..
python3 scripts/m1-foundation/pad/test_pad_context.py
python3 scripts/m1-foundation/pad/test_pad_mpv_ipc.py
python3 scripts/m2-catalog/service/test_mango_hud_contract.py
bash scripts/lib/gate-catalog-unit.sh src/catalog-service
bash scripts/m6-ship/gate-m6-stream-picker-source.sh
bash scripts/m6-ship/gate-m6-ux-smoke.sh
git diff --check
```

Do not run a command merely to accumulate green output. Select checks based on
the changed ownership boundary and record exactly what ran.

## 4. Current state and design intent

The source has already received major visual and reliability work. This is an
acceptance-and-tuning task, not permission for a broad redesign:

- Home/Search/Detail use the Cinema Dark token and focus system.
- Launcher system states preserve usable controls and cached content across cold
  load, empty results, outages, stale recovery, and failed shuffle operations.
- Playback starts clean; interaction reveals a safe-area HUD with exact action
  feedback, minimal pause state, and delayed buffering state.
- Movie/series playback exposes a five-choice bottom Streams drawer. Switching
  is explicit, validated, URL-free, preserves the watch session, and offers a
  short contextual X Undo window.
- Live and YouTube have no Streams drawer and must ignore X during playback.
- VOD candidate attempts remain display-neutral until mpv proves real playback;
  only then may the foreground handoff hide/freeze the launcher. A candidate
  failure must never produce black → Detail → unexplained later playback.
- One global attempt budget spans the ordinary, last-resort, obligation-floor,
  risky, and thin-retry phases. Cached known-bad skips do not spend that budget.
- Cancellation, stale play epoch, foreground-ownership conflict, display/VO
  enable failure, handoff failure, and global deadline are terminal pipeline
  failures. Ordinary candidate failures may continue to the next candidate.
- AIOStreams is Mango's one VOD aggregate. Torrentio, MediaFusion, and Comet are
  its internal indexers; TorBox and Real-Debrid are transports. Do not configure
  all six as parallel direct Mango providers. Runtime credentials/config remain
  home-owned and must never appear in evidence.
- The controller's normal power-on reconnect path must never depend on pairing
  mode.
- Intentional display sleep is locked and home-owned: Settings timeout choices,
  30m default, only D-pad/companion activity resets idle, mpv inhibits standby,
  DPMS+CEC transitions own sleep/wake, and accidental Xorg 600s blanking is gone.

## 5. Existing tooling to reuse

| Need | Reuse | Notes |
|---|---|---|
| Git-only deploy | `scripts/pi-deploy.sh` | `--full --gate` for final acceptance |
| Pi command | `scripts/pi-exec.sh` | No raw invented SSH credentials |
| Pre-couch gate | `scripts/pi-exec-gate.sh` | Record pass/warn/fail counts |
| X11 screenshots | `scripts/m1-foundation/gate/capture-tv.sh` | Pi render proof; label and checksum every state |
| Launcher UX | `scripts/m6-ship/gate-m6-ux-smoke.sh` | Source + live launcher contract |
| Search | `scripts/m6-ship/gate-m6-search-smoke.sh` | Non-mutating search proof |
| HUD/Streams source | `scripts/m6-ship/gate-m6-stream-picker-source.sh` | Mac-safe deterministic gate |
| HUD/Streams Pi | `scripts/m6-ship/gate-m6-stream-picker-smoke.sh` | Runtime, URL-free snapshot proof |
| HUD render fixtures | `scripts/m6-ship/render-mpv-hud-fixtures.sh` | Actual mpv/libass images on Pi |
| Playback SSOT | `scripts/m6-ship/gate-m6-playback-ssot.sh` | Lifecycle/foreground contract |
| Playback ladder health | `scripts/diag/playback-ladder-health.sh` | URL-free provider/indexer/debrid contribution summary |
| AIOStreams topology | `scripts/m4-addons/aiostreams-config.sh verify` | Aggregate health without printing credentials |
| Reliability | `scripts/m6-ship/gate-m6-reliability-proof.sh` | Red fails; yellow requires explanation |
| Controller | `scripts/m1-foundation/pad/controller-link-couch-test.sh` | Five ordinary wake cycles |
| Controller failure | `scripts/m1-foundation/pad/controller-link-diagnose.sh` | Capture before pairing |
| Full acceptance matrix | `docs/COUCH_TEST.md` | Agent closes automated rows first; human sees only the minimal residual set |

Build only what an observed failure proves is missing. Do not create replacement
deploy scripts, a second overlay renderer, a second input owner, or a parallel
acceptance framework.

## 6. Workstreams

### S0 — Source and environment preflight

1. Verify branch and inspect dirty state on the home Mac.
2. Fetch origin and prove the three minimum patch ancestors above.
3. Fast-forward only when safe.
4. Prove SSH through `bash scripts/pi-exec.sh 'echo ok'`.
5. Capture starting home/origin/Pi SHAs and current stack status.

**Acceptance:** correct branch, understood working trees, required commits in
origin ancestry, working checked-in Pi transport, no source or state destroyed.

### S1 — Git-only deploy and automated Pi gates

Run:

```bash
bash scripts/pi-deploy.sh --full --gate
bash scripts/pi-exec-gate.sh
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-ux-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-search-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-playback-ssot.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-stream-picker-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m4-addons/aiostreams-config.sh verify'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/diag/playback-ladder-health.sh movie tt3268458'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
```

Also render the production HUD fixtures on the Pi to a temporary directory and
inspect them before couch testing:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/render-mpv-hud-fixtures.sh /tmp/mango-hud-fixtures'
```

Create a temporary, non-repository screenshot directory and capture the real Pi
X11 output after every meaningful launcher state transition:

```bash
bash scripts/pi-exec.sh 'mkdir -p /tmp/mango-autonomous-shots'
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_GATE_SHOT_DIR=/tmp/mango-autonomous-shots bash scripts/m1-foundation/gate/capture-tv.sh launcher-home'
bash scripts/pi-exec.sh 'find /tmp/mango-autonomous-shots -maxdepth 1 -type f -name "*.png" -exec sha256sum {} +'
```

Use temporary captures only. Inspect the actual PNGs with the tools available on
the home machine; never infer visual quality from file existence. Verify each is
1920×1080 or the expected active playback mode, non-uniform when content should
be present, free of wallpaper/desktop/duplicate-window exposure, and different
from the preceding distinct state. Do not install screenshot packages merely to
avoid an honest `DEFERRED`; first use the checked-in fallback chain.

Record every WARN/FAIL. Do not erase runtime state or disable a subsystem to turn
yellow/red into green.

**Acceptance:** home/origin/Pi code SHAs match; full deploy succeeds; required
gates pass or are precisely explained; fixtures render all named states.

### S2 — Autonomous diagnostics, state traversal, and screenshot audit

Do not ask the human to drive this matrix. Use checked-in endpoints, fixture
renderers, safe XTEST navigation, runtime state, and screenshots to traverse and
audit every reachable surface. Synthetic navigation proves state/focus wiring;
it does not count as physical-Micro proof, which remains in S5. Cover:

1. **Boot/home:** one fullscreen launcher, no wallpaper/white flash/duplicate
   Chromium, 5% safe area intact, obvious single focus, responsive D-pad.
2. **Home rails:** Movies, TV Shows, Live, YouTube, Saved, Continue, and Apps;
   stable poster geometry, honest focus labels, edge fades, shuffle motion, and
   unchanged focus during updates.
3. **P0 loading:** cold/slow load shows a stable aspect-correct skeleton row while
   Search/tabs/Settings remain usable; no shimmer or focusable placeholders.
4. **P0 empty:** partial empty rails hide; fully empty tab shows one calm state;
   Live never suggests shuffle.
5. **P0 offline/stale:** cached posters remain when usable; outage appears below
   navigation; reconnect does not flash through loading or move focus.
6. **P0 toast:** success/warning/error are visibly distinct, safe-area aligned,
   non-duplicated, and contain no backend/mpv/addon text.
7. **Search:** compose, recents, keyboard, scope changes, results, More, Detail,
   playback return, and exact origin/focus restoration.
8. **Detail:** movie, series with 8+ episodes, YouTube channel/playlist, and
   related titles. Walk every row end; focus must not teleport, trap, clip, or
   disappear. Verify Back behavior aloud so surprising nested exits are recorded.
9. **Post-play:** Y/Home/EOF/next-episode paths restore one launcher surface and
   the exact expected context without an unrelated refresh.

For each stable state, capture a labeled screenshot and inspect safe area,
clipping, focus visibility, density, hierarchy, text leakage, loading geometry,
toast duplication, and unexpected desktop/black exposure. Capture before and
after navigation, and compare checksums so ignored input is visible. Record the
corresponding U/P/H/D/S automated rows in `docs/COUCH_TEST.md`; do not silently
collapse them into a single “looks good” verdict.

**Acceptance:** all relevant rows have an automated result where applicable and
an inspected screenshot/state/log result; any defect has deterministic
reproduction steps and evidence. Human-only perceptual rows are explicitly held
for S5 rather than prematurely marked pass.

### S3 — Autonomous principled repair, performance, and hardening loop

Begin with the reported regression title **The Internet's Own Boy** (IMDb
`tt3268458`). The prior symptom was: loading, a black screen, return to Detail,
then playback starting later without a new human selection. Capture sanitized
timestamps and logs; never paste signed URLs or raw provider payloads.

First prove the ladder and ownership contract:

1. Run the URL-free ladder diagnostic above and record configured aggregate
   counts plus provider/indexer/debrid contribution counts.
2. `configured_stream_providers.aiostreams` should be `1`. Direct Torrentio,
   MediaFusion, and Comet should normally be `0`; they contribute inside
   AIOStreams. If live config differs, diagnose duplication before changing it.
3. Across `tt3268458` and a small representative movie/series corpus, verify that
   Torrentio, MediaFusion, and Comet contribute when naturally available, and
   that TorBox/Real-Debrid transport contributions appear when configured and
   naturally returned. Zero for one title is evidence, not automatic failure.
4. Start `tt3268458` once. Until a candidate proves real playback, Detail must
   remain the visible owner: no black takeover and no launcher freeze.
5. If an ordinary candidate fails, the next candidate may start within the same
   bounded play request, but there must be no intermediate black → Detail bounce.
6. Press Back/cancel during loading. The request is terminal: no later candidate
   may begin and no autonomous playback may appear afterward.
7. A display-enable, VO-after-enable, foreground-handoff, ownership-conflict,
   stale-epoch, or global-deadline failure is terminal; do not keep walking the
   ladder after it.
8. Confirm the shared attempt cap holds across every fallback phase and that a
   cached known-bad zero-I/O skip does not consume an attempt.
9. Record time from B to first real frame and whether video/audio begin smoothly.
   Compare repeated runs without clearing caches or changing provider policy.

Do not expose resolver URLs or credentials while proving contribution health.
Do not turn Torrentio/MediaFusion/Comet into direct peers to make counters nonzero,
and do not claim a resolver is broken from a single naturally empty title.

Use a movie, a multi-episode series, Live, YouTube, a long stream ladder, a
risky/unavailable candidate if naturally available, and a real 4K title.

Prove autonomously with the mpv IPC/controller harness, actual libass fixture
renders, repeated runtime plays, logs, timing, state snapshots, and screenshots:

1. Playback starts with no chrome.
2. HUD title/episode, elapsed/negative remaining, essentials line, and B/X/Y
   hints are readable and contain no raw ID, filename, or URL.
3. Exact seek 10/30/120, volume, audio, subtitle, pause, and resume feedback uses
   the right value and appropriate 4s/6s dwell.
4. Pause settles to the small persistent badge; resume removes it immediately.
5. Sustained buffering appears only after about 1s and clears immediately;
   harmless cache flicker does not paint a warning.
6. Live shows LIVE with no timeline. Live and YouTube hide X and pressing X has
   no visible response.
7. X opens the 58%-height Streams drawer over vivid continuing video; current is
   first/amber, best alternate initially has the white focus ring, five choices
   maximum, unavailable options are disabled and last.
8. The right pane remains readable and explains readiness/risk/unavailability.
9. B shows Checking stream and blocks duplicates. Success closes and confirms;
   X temporarily performs Undo, then returns to opening Streams.
10. A failed validation keeps the original playing, drawer open, error band
    visible, and focus on the failed row. One-candidate state says no alternatives.
11. Position, audio/subtitle preference, subtitle visibility, and one logical
    progress session survive switch and Undo.
12. A real 4K play shows no measured dropped-frame regression from
    opening, navigating, switching, and closing the drawer.

Do not manufacture unavailable candidates by changing provider credentials or
runtime databases. If the natural catalog cannot supply a proof row, mark only
that row `DEFERRED` with the exact title/query needed next.

For every failure found anywhere in S1–S3:

1. Preserve the failing evidence before restarting or changing anything.
2. State one falsifiable root-cause hypothesis and identify the single owning
   layer; inspect adjacent paths for the same invariant rather than patching only
   the observed title/state.
3. Choose the smallest robust design that removes the cause. A systematic
   refactor is preferred when a one-line workaround would duplicate policy,
   hide a race, add an arbitrary wait/retry, or leave split ownership.
4. Add deterministic regression coverage using realistic payloads/stdout/state.
5. Run focused tests, the full affected suite/build, shell/source gates,
   `git diff --check`, and staged-diff/secret audits.
6. Commit one coherent fix, push, Git-deploy, prove all three SHAs, and repeat the
   exact diagnostic, screenshot, timing, and gate that failed.
7. Run at least one adjacent regression path and record failed attempts honestly.

The agent may improve implementation structure, error recovery, state ownership,
performance, perceived latency, accessibility, focus geometry, and diagnostics.
It may not reopen locked bindings, playback/session semantics, display-sleep
policy, provider credentials/policy, or user-data ownership without explicit
operator approval. Never improve speed by weakening verification, increasing
unbounded concurrency/retries, or hiding failures.

**Acceptance:** the reported title never produces black → Detail → autonomous
late playback; cancel and pipeline-fatal states are terminal; the aggregate
topology and sanitized contribution evidence are recorded; every HUD/drawer row
that automation can exercise has inspected render/state evidence; relevant gates
stay green after every fix; resource/latency measurements show no regression.

### S4 — Final automated regression and evidence bundle

Close every automatable row in the complete contract in
`docs/tasks/OPS_HEALTH_HOME_DEPLOY_PROMPT.md`, including:

- service, BlueZ, input-node, retry/cadence, and pad-router diagnostics without
  entering pairing mode; reserve the five physical power cycles for S5;
- synthetic launcher/playback input routing plus automated context tests;
- phone PTT/text, TV HUD, structured pick, open-detail acknowledgement, and
  voice-opens/pad-plays behavior;
- Settings and Reliability Center legibility, truthful severity, safe actions,
  and back/focus behavior;
- display-sleep configuration, activity ownership, mpv inhibition, persistence,
  and absence of Xorg 600s timeout; reserve intentional TV standby/CEC and
  physical wake for S5 with human approval;
- target-TV display/audio/4K proof only where actual hardware evidence exists.

Run the complete affected local test suites again, a final `--full --gate`
deploy, `pi-exec-gate`, UX/Search/playback/Streams/reliability gates, screenshot
matrix, fixture render, resource snapshot, and sanitized log/health review.
Repeat flaky/timing-sensitive flows enough to distinguish a one-off pass from a
stable invariant. Do not claim statistical confidence from a tiny sample.

**Acceptance:** all agent-observable rows are green or carry exact causal
deferrals; final screenshots and fixture renders have been inspected; no new
warnings, secrets, raw URLs, resource-pressure regressions, or ownership leaks;
the box is ready for the short human session.

### S5 — Minimal human couch test and last-mile tuning

Present the human with a concise 10–15 minute test derived from residual evidence,
not the full internal matrix. Ask one to three observations at a time and adapt.
At minimum cover:

1. From normal distance: Home focus/readability/safe area and one fast rail scrub.
2. Search → Detail → Back: predictable focus and readable loading/offline/toast
   treatment if a natural state is available.
3. **The Internet's Own Boy**: B-to-first-picture feel, no black/Detail bounce,
   clean HUD, pause/buffering treatment, Streams open/switch/Undo/failure return,
   and no autonomous later start after cancel.
4. One normal controller power-off/on reconnect while idle and one during the
   launcher-to-playback flow; zero pairing-mode entries.
5. One companion/voice open-detail flow and confirmation that pad B—not voice—plays.
6. One representative 4K/audio sample: visible picture, smooth motion, sound,
   lip sync, and no obvious dropped-frame regression, correlated with metrics.
7. With explicit warning/approval: locked display sleep and DPMS/CEC standby/wake;
   finish TV On, timeout 30m, playback stopped, launcher/pad usable.

Do not ask the human to repeat automated checks unless a discrepancy appears.
Convert each answer into pass/fail plus one sentence of evidence. If a subjective
issue appears, present at most three concrete options, recommend one, and explain
the trade-off.

For each failure:

1. Record the exact surface, starting focus/state, input sequence, expected
   behavior, human observation, and timestamp.
2. Capture relevant source/runtime evidence before restarting anything.
3. Correlate it with the existing autonomous evidence, identify the owning layer,
   and state one falsifiable root-cause hypothesis.
4. For subjective visual issues, show the human at most three concrete tuning
   choices and recommend one. Do not ask an open-ended design questionnaire.
5. Change the smallest source-owned surface on the home Mac.
6. Add/strengthen a deterministic regression test.
7. Run focused tests, affected build, `git diff --check`, and inspect the diff.
8. Commit with an imperative subject, push, Git-only deploy, and prove SHAs.
9. Re-run the exact failed human row, then the relevant gate and pre-couch gate.
10. Record failed attempts rather than rewriting history.

Allowed last-mile tuning examples: safe-area/token spacing, focus contrast, couch text
size, panel density, fade thresholds, poster-label delay, HUD dwell, copy, or a
localized focus-navigation correction. Changes to bindings, playback ownership,
stream ranking, DB semantics, provider policy, display-sleep policy, or
credentials are outside routine tuning scope and require a separate explicit
decision. If the playback regression still reproduces, capture it and stop
before altering those contracts; do not hide it with longer waits or extra
attempts.

**Acceptance:** the short couch path passes; every pushed last-mile fix is tied
to observed evidence, tested, redeployed, and re-observed; no speculative
redesign or contract drift.

### S6 — Report, final regression, safe state, and push

After the final fix:

```bash
bash scripts/pi-deploy.sh --full --gate
bash scripts/pi-exec-gate.sh
```

Write `docs/tasks/FULL_COUCH_UX_HOME_ACCEPTANCE_REPORT.md` with:

1. date, sanitized environment description, starting/final SHAs;
2. exact deploy/gate commands and pass/warn/fail counts;
3. patch SHA/subject/paths/reason/rollback for every home-agent fix;
4. per-surface automated verdicts, screenshot/checksum inventory, and inspection
   findings for S2-S4, separated from S5 human verdicts;
5. controller cycle timings and pairing-mode count;
6. display-sleep/CEC proof and restored 30m default;
7. 4K dropped-frame evidence plus the human visible-picture verdict;
8. `tt3268458` playback-ladder verdict, B-to-first-frame timing, cancel proof,
   terminal-failure proof, attempt-budget proof, and explicit confirmation that
   no autonomous late playback occurred;
9. URL-free AIOStreams topology plus provider/indexer/debrid contribution counts,
   with naturally empty observations distinguished from configuration failures;
10. performance/resource baseline and final measurements, repeated-run stability,
    failed attempts, root causes, and evidence-driven corrections;
11. the final minimal human couch checklist, observations, and any last-mile fix;
12. every `DEFERRED` item with reason, owner, and exact next action;
13. confirmation that no credentials, URLs, runtime data, screenshots containing
    private/copyrighted content, or other private content are
    included and that the box was left safe and usable.

Stage only intentional source/docs, inspect the staged diff, commit the sanitized
report and any final documentation, then push:

```bash
git status --short
git diff --check
git diff --cached --stat
git commit -m "docs(ux): record full couch acceptance"
git push origin feat/native-experience
```

If the report-only commit moves origin beyond the Pi code SHA, either perform a
final Git-only pull/deploy or explicitly report code-runtime SHA versus docs tip.

**Acceptance:** report is complete and pushed; origin contains every proven fix;
final home/origin/Pi identities are explicit; the TV is On, timeout is 30m,
playback is stopped, and launcher/pad are usable.

## 7. Ordering and collaboration cadence

Perform **S0 → S6**. Do not begin human acceptance on a failed or incomplete
automated baseline. The agent should work independently through S4. In S5:

- explain the next high-value surface and expected controls;
- ask for one to three observations;
- summarize what was observed;
- choose the next smallest batch based on that result.

If the human pauses, leave the system safe and persist the unfinished checklist
in the report instead of claiming completion.

## 8. Commit and push policy

This task explicitly authorizes commits and pushes for:

- narrowly scoped, tested source fixes arising from observed acceptance failures;
- corresponding tests and accurate source-of-truth docs;
- the sanitized final report.

Use one coherent commit per fix. Never amend or force-push. Never bundle unknown
home dirt. Pull with `--ff-only` before beginning a new fix; if origin moved,
reconcile transparently before continuing.

## 9. Definition of done

- Correct branch and required patch ancestry proved.
- Home/origin/Pi code SHAs match the intended deployed source.
- Full deploy and automated gates pass or have exact, non-fabricated deferrals.
- The Internet's Own Boy regression is proven fixed on the TV: no premature
  foreground takeover, no post-cancel/later autonomous start, bounded fallthrough,
  and recorded B-to-first-frame timing.
- URL-free runtime evidence confirms the intended AIOStreams aggregate topology
  and records natural indexer/debrid contributions without credential exposure.
- Launcher P0 states, Home, Search, Detail, post-play, HUD, Streams, voice,
  companion, Settings, Reliability, controller, and display contracts have
  direct human observations.
- All pushed autonomous and last-mile changes are systematic, tested, redeployed,
  and re-proven through their exact diagnostic plus adjacent regressions.
- The temporary screenshot/fixture matrix was captured, checksummed, inspected,
  and summarized without committing private or copyrighted images.
- The human performed only the compact residual couch path after S4 was green.
- 4K/performance claims include runtime metrics and a human visible-picture check.
- No pairing-mode happy path, runtime-state deletion, credential/quota change,
  Pi source edit, rsync/scp, or hidden destructive cleanup occurred.
- Final report is committed and pushed.
- All remaining items are marked `DEFERRED` with exact reason and next action.
- Box is left safe: TV On, 30m display timeout, playback stopped, launcher and
  controller usable.

Begin by reading the files in §2, then perform S0.
