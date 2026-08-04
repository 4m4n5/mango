# Home-agent deployment brief — Mango Couch Recommendations v2

This is the complete, context-free contract for the agent running on the home
Mac, on the same LAN as the Mango Pi. Read it top to bottom before changing the
home clone, Pi, databases, or runtime configuration.

The starter prompt must provide an exact, full `APPROVED_SHA`. It is the
immutable commit authorized by the user. If it still says `<APPROVED_SHA>`, or
that commit is not the exact initial `origin/feat/native-experience` tip, stop
without deploying and ask for the pushed SHA. Set mutable `TARGET_SHA` to that
value initially. `TARGET_SHA` may advance only to a tested corrective commit
that this home agent pushed under section 12. A dirty work-Mac implementation
or an unpushed commit is not deployable.

## 1. Mission

Deploy Mango Couch Recommendations v2 from the home Mac to the Pi, build the
real StoryDNA and YouTube generations in shadow, apply the promotion gates
without weakening them, promote VOD and YouTube independently when eligible,
verify the couch experience, and make only evidence-led corrections needed to
finish the rollout. The intended handoff state is not an empty bootstrap: each
served domain must have a healthy published local reserve. VOD must be built
from the Pi's preserved current Household Fire/Water, Saved, and qualifying
Mango watch history; YouTube must be built from its current authoritative
subscriptions and qualifying Takeout/Mango-local history.

The implementation introduces:

- VOD `vod-story-graph-v1`: one six-card For You rail in Movies and one in TV,
  ranked only from the verified-playable corpus. A stateless AI content teacher
  produces strict StoryDNA; local graph/thread code owns all taste, uncertainty,
  ranking, dealing, and publication.
- Positive-only Household taste from Fire/Water, Saved, and meaningful Mango
  viewing. Explicit Fire/Water dominates. Existing profiles and mood data stay
  dormant and recoverable.
- YouTube v2: subscriptions plus Google Takeout/Mango-local meaningful history
  only, with five core rails and conditional subscription/live rails.
- Durable local generation state, HTTP 202 refresh jobs, cached X behavior, and
  independent `off|shadow|serve` rollout controls.

## 2. Authority and hard boundaries

- Branch: `feat/native-experience`.
- Home-Mac clone: discover the real clone rather than assuming a username; a
  common relative path is `~/Documents/personal/projects/mango`.
- Pi SSH alias: `mango`; fallback `mango-mdns`; Pi repo: `~/mango`.
- Mac source is authoritative. Deploy with git only. Never use `rsync`, `scp`,
  repository archive copying, or hand-edited source files on the Pi.
- The sole transfer exception is an explicitly named, generated, sanitized
  screenshot copied Pi to home Mac for visual inspection. It does not permit
  copying source, databases, config, logs, tokens, archives, or history in
  either direction; never commit a private screenshot.
- Preserve all operator-owned dirt. Never reset, stash, clean, delete, replace,
  or reinitialize a database merely to make a gate green.
- Do not switch either machine to `main`, merge branches, force-push, rewrite
  history, or delete legacy v4 generations/code.
- Do not print `~/.config/mango/voice.env`, API keys, OAuth files, Companion
  memory, raw ratings, raw Takeout records, or database contents containing
  private history. Reports use counts, hashes, versions, and redacted errors.
- No gate threshold, relevance formula, provenance rule, verified-only veto,
  quota ceiling, or acceptance criterion may be relaxed to obtain a pass.
- Legacy v4 remains intentionally reachable in `off|shadow` for rollback
  through one accepted couch release. It is not orphaned code.

The user authorizes the home agent to correct implementation or operational
bugs discovered during this deployment, but only inside this recommendation
rollout. Once source changes begin, the home Mac is the sole source writer for
the session: edit there, run local gates, commit, push the same branch, deploy
that new exact SHA by git, and report the SHA chain. Never patch source in
`~/mango` on the Pi. Product redesign, unrelated cleanup, new dependencies, and
changes to locked controller/playback behavior require fresh user approval.

Runtime changes are limited to reversible recommendation flags and established
Mango operational controls in `~/.config/mango/voice.env`. Back it up with mode
`0600` before every edit, update it without sourcing or echoing its contents,
retain all unrelated keys, and record only the two resulting recommendation
modes. After every edit and restart, prove that the file remains mode `0600`
and use an allowlist parser that prints only `MANGO_VOD_RECS_V2` and
`MANGO_YOUTUBE_RECS_V2`. Never attach or commit an environment backup.

## 3. Required reading

Read these from the initially checked-out `APPROVED_SHA` before mutation. If a
corrective commit advances `TARGET_SHA`, reread any changed contract document
from the new target:

1. `AGENTS.md`
2. `docs/DEPLOY.md`
3. `docs/DEPLOY-SPLIT-MACHINE.md`
4. `docs/FIRE_WATER_RATINGS.md`
5. `docs/YOUTUBE.md`
6. `docs/RELIABILITY.md`
7. `docs/COUCH_TEST.md`, especially recommendation identity, Fire/Water, and
   YouTube sections
8. `docs/tasks/RECOMMENDATIONS_SIMPLIFY_IMPLEMENTATION_PLAN.md`

## 4. Evidence report

Keep timestamped working evidence outside the git clone while deploy iterations
are active so `pi-deploy.sh` can enforce a clean source tree. After the final
source SHA, deploy, and gates are settled, write:

`docs/tasks/RECOMMENDATIONS_V2_HOME_PI_REPORT.md`

Writing that report is the final local mutation. Do not commit, push, or deploy
the report itself unless the user separately asks; report the clean final
origin/home/Pi source SHA and the report's intentional uncommitted path. Never
let an in-progress report force a bypass of the clean-tree deploy guard.

It must include:

- date/time zone, home host, Pi host, branch, immutable `APPROVED_SHA`, the
  ordered `TARGET_SHA` chain with every corrective SHA, final origin SHA, final
  home SHA, and final Pi SHA;
- pre-deploy dirt and runtime state on both machines;
- database file sizes, migration versions, preservation counts, backup paths,
  and post-migration deltas without private row content;
- each command/gate, result, duration, and concise evidence;
- VOD and YouTube mode transitions with before/after generation IDs;
- full VOD domain diagnostics, offline evaluation metrics, and exact promotion
  reasons;
- YouTube subscription/history/provenance/rail counts, phase results, stale
  state, and quota counters;
- cached latency and X counter-invariance measurements;
- screenshots inspected and human couch verdicts;
- every correction and why it was principled;
- rollback drill and final rollback instructions;
- `PASS`, `FAIL`, or `DEFERRED — <exact reason>` for every acceptance item.

Never describe unobserved Pi, TV, launch, HDR, focus, or recommendation quality
as passing. A locally passing test is not Pi proof. A Pi HTTP response is not a
human couch-quality verdict.

## 5. Workstream H1 — exact source and clean authority

On the home Mac:

```bash
cd <home-mac-mango-clone>
APPROVED_SHA='<full SHA from the starter prompt>'
case "$APPROVED_SHA" in
  ''|*[!0-9a-f]*) echo 'APPROVED_SHA must be 40 lowercase hex characters' >&2; exit 2 ;;
esac
test "${#APPROVED_SHA}" -eq 40
TARGET_SHA="$APPROVED_SHA"
export APPROVED_SHA TARGET_SHA
git status --short --branch
git fetch origin feat/native-experience
git rev-parse HEAD
git rev-parse origin/feat/native-experience
git cat-file -e "${APPROVED_SHA}^{commit}"
test "$(git rev-parse origin/feat/native-experience)" = "$APPROVED_SHA"
```

Stop if the home clone has unexplained dirt, the approved commit is missing, or
origin differs from it. Preserve and report known dirt rather than hiding it.
Switch only to the explicitly requested branch, then fast-forward only:

```bash
git checkout feat/native-experience
git pull --ff-only origin feat/native-experience
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
test "$(git rev-parse origin/feat/native-experience)" = "$TARGET_SHA"
git show --check --oneline "$TARGET_SHA"
```

If origin has legitimately advanced beyond the supplied SHA, do not silently
deploy the newer tip. Ask whether the approved target moved.

Bind baseline build/test evidence to this exact SHA. At minimum run:

```bash
(cd src/catalog-service && npm ci && npm run test:gate && npm test)
(cd src/launcher && npm ci && npm run build)
(cd src/companion && npm ci && npm run build)
PYTHONPATH=src/orchestrator python3 -m unittest discover -s src/orchestrator/tests
bash -n scripts/m6-ship/youtube-refresh-cache.sh \
  scripts/m6-ship/gate-m6-youtube-smoke.sh \
  scripts/m6-ship/gate-m6-ux-smoke.sh
bash scripts/m6-ship/test-youtube-refresh-cache.sh
bash scripts/m6-ship/test-gate-m6-youtube-smoke.sh
git show --check --oneline "$TARGET_SHA"
```

If dependency installation would overwrite user-owned local state, stop and
report. A corrective source commit invalidates prior exact-SHA evidence; rerun
the affected gates and the final full matrix on the new SHA.

## 6. Workstream H2 — non-destructive Pi baseline

First prove access, branch, dirt, idle state, disk, time, and database presence:

```bash
bash scripts/pi-exec.sh 'hostname; date --iso-8601=seconds; cd ~/mango; git status --short --branch; git rev-parse HEAD; df -h / /etc/mango; bash scripts/mango-stack.sh status'
bash scripts/pi-exec.sh 'pgrep -af "mpv|playability-maintenance|nightly-library-refresh" || true; test ! -e ~/.cache/mango/playability-maintenance.lock || ls -l ~/.cache/mango/playability-maintenance.lock'
bash scripts/pi-exec.sh 'for f in /etc/mango/library.db /etc/mango/progress.db /etc/mango/playability.db /etc/mango/youtube.db; do test -f "$f" && stat -c "%n %s %y" "$f" || echo "MISSING $f"; done'
```

Do not deploy during playback or active maintenance. Record tracked and
untracked Pi dirt exactly. If it overlaps deploy files, stop for user direction.

Before migration, capture privacy-safe counts needed to prove preservation:

- `library_migrations`, `youtube_migrations`, and `progress_migrations`
  versions;
- profiles, ratings current/history, Saved, watch history, feedback,
  recommendation snapshots/events;
- current Household VOD qualifying-positive Fire/Water, Saved, meaningful
  partial-watch, and completion counts split by movie/series, using aggregate
  counts only—never titles, IDs, rating rows, or history rows;
- progress rows;
- verified movies and series;
- existing YouTube cache/history/subscription counts.

Run `PRAGMA quick_check` on all four SQLite databases. Do not dump rows. Create
a timestamped backup directory on the Pi with mode `0700`. Make each database
backup with SQLite's online `.backup` command, or stop every owning service
before copying; a plain copy of a live SQLite file is not acceptable. Set each
backup to mode `0600`, keep it on the Pi, and record only its path, size,
timestamp, checksum, and permissions. Also make a mode-`0600` backup of
`~/.config/mango/voice.env` before each later mode edit without reading it into
the shell or report. Never copy these backups between machines.

## 7. Workstream H3 — git-only deploy and migration proof

Record the Pi's pre-deploy SHA as `PI_BASELINE_SHA`. Compare lockfiles between
that commit and `TARGET_SHA`; `package-lock.json` changes and dependency state
determine deploy mode:

- use `bash scripts/pi-deploy.sh --fast` when locks did not change and the Pi
  already has dependencies;
- use `bash scripts/pi-deploy.sh --full` for first boot, changed lockfiles, or
  dependency repair.

Do not start with `--gate`; first establish services and migration evidence.
Run exactly one selected deploy command from the home clone:

```bash
bash scripts/pi-deploy.sh --fast   # unchanged locks and healthy dependencies
# or
bash scripts/pi-deploy.sh --full   # first boot, changed locks, or dependency repair
```

After deploy, validate the mutable target, never merely the original approval:

```bash
test "$(git rev-parse HEAD)" = "$TARGET_SHA"
test "$(git rev-parse origin/feat/native-experience)" = "$TARGET_SHA"
bash scripts/pi-exec.sh "cd ~/mango && test \"\$(git rev-parse HEAD)\" = '$TARGET_SHA' && git status --short --branch && bash scripts/mango-stack.sh status"
bash scripts/pi-exec.sh 'test -f /etc/mango/library.db.pre-fire-water-v4.bak; test "$(sqlite3 /etc/mango/library.db "SELECT group_concat(version) FROM (SELECT version FROM library_migrations ORDER BY version);")" = "1,2,3,4,5,6,7,8,9,10,11,12,13,14"; test "$(sqlite3 /etc/mango/youtube.db "SELECT group_concat(version) FROM (SELECT version FROM youtube_migrations ORDER BY version);")" = "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15"; test "$(sqlite3 /etc/mango/progress.db "SELECT group_concat(version) FROM (SELECT version FROM progress_migrations ORDER BY version);")" = "2"'
bash scripts/pi-exec.sh 'curl -fsS http://127.0.0.1:3020/health; curl -fsS http://127.0.0.1:3020/personalization/state; curl -fsS http://127.0.0.1:3020/recommendations/state; curl -fsS http://127.0.0.1:3020/youtube/state'
```

Expected migration sets are exactly library `1..14`, YouTube `1..15`, and
progress version `2` only. Compare the post-migration preservation counts with
H2. No profile, rating, Saved/history/progress, legacy snapshot, StoryDNA,
provenance, or last-good row may disappear unexpectedly.

## 8. Workstream H4 — staged VOD shadow build

Before allowing a corpus-scale teacher job, establish the stateless StoryDNA
teacher path. If diagnostics show a StoryDNA backlog, the orchestrator must be
running and its configured provider/model must be usable even when the normal
voice feature would otherwise be off. Use the established orchestrator setup
and readiness scripts, then check `http://127.0.0.1:8766/health`, falling back
to port `8765` only when that is the configured local service.

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m5-voice/stack/ensure-orchestrator-venv.sh && bash scripts/m5-voice/stack/start-voice-stack.sh'
bash scripts/pi-exec.sh 'curl -fsS http://127.0.0.1:8766/health || curl -fsS http://127.0.0.1:8765/health'
```

Run `verify-voice-ready.sh` here only when `MANGO_VOICE=1`; its full voice/HUD
contract is broader than the content-teacher preflight.

Send exactly one real verified title's canonical catalog evidence to
`POST /recommendations/story-dna`. The probe must contain no ratings, Saved or
watch events, profiles, mood, conversation, Companion memory, or other
household state. Require HTTP 200, one response item with the exact requested
type and stable ID, `schema_version=story-dna-v1`, the expected ontology,
prompt, and configured model versions, `teacher_role=content-only`, and
`provenance.content_only=true`. Keep the response in a mode-`0600` temporary
file only long enough to validate it, then remove that file. Do not begin the
full backfill if health, provider/model use, identity binding, or schema
validation fails.

After that preflight, start conservatively:

```text
MANGO_VOD_RECS_V2=shadow
MANGO_YOUTUBE_RECS_V2=off
```

Before the edit, make the protected environment backup required by H2. Update
only those two keys in `~/.config/mango/voice.env`, preserving every other
byte and mode `0600`, then restart through established scripts. After every
mode edit/restart in this document, use this same allowlisted readback pattern;
assert exactly one valid value for each key and do not source the file:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_CATALOG=1 bash scripts/mango-stack.sh restart'
bash scripts/pi-exec.sh 'set -eu; test "$(stat -c %a ~/.config/mango/voice.env)" = 600; awk -F= '\''$1 == "MANGO_VOD_RECS_V2" || $1 == "MANGO_YOUTUBE_RECS_V2" { print $1 "=" $2 }'\'' ~/.config/mango/voice.env'
```

If `mango` fails and the documented `mango-mdns` fallback is needed, set
`MANGO_SSH_HOST=mango-mdns` consistently for every wrapper invocation; do not
mix hosts within one evidence chain.

Run the normal playability nightly chain so the captured verified corpus is
current. This chain already enqueues and polls the VOD recommendation jobs;
capture its exact job IDs rather than immediately enqueueing duplicate work:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_NIGHTLY_YOUTUBE_REFRESH=0 bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly'
```

This invocation is VOD/playability-only. It must not run legacy or v2 YouTube
acquisition, spend YouTube quota, or blur the independent YouTube baseline.

Use a manual localhost enqueue only when the nightly chain produced no VOD job
or when a later bounded StoryDNA batch is needed after the prior jobs became
terminal:

```bash
bash scripts/pi-exec.sh 'curl -fsS -H "content-type: application/json" -d "{\"reason\":\"home_v2_shadow_backfill\"}" http://127.0.0.1:3020/recommendations/refresh'
```

For every nightly or manual job, capture its job ID, content type, trigger
reasons, and captured revisions. A manual enqueue must return HTTP 202. Poll
each exact localhost route at
`GET /recommendations/jobs/<job_id>`; terminal statuses are `complete`,
`coalesced`, or `failed`. `coalesced` is terminal, not a reason to wait forever.
Use `GET /recommendations/state` separately for aggregate generation,
coverage, cursor, failure, stale, evaluation, and serving-work diagnostics.
During a long backfill, report progress at least every few minutes without
restarting a healthy worker.

One refresh intentionally bounds StoryDNA teacher work. When
`profiled_count + failure_count < verified_count`, enqueue the next refresh only
after the current jobs are terminal and diagnostics show forward progress.
Repeat sequentially until the complete corpus is profiled or has durable
retryable failures; do not overlap jobs, bypass retry backoff, or create an
unbounded provider-cost burst. Stop and report if two consecutive batches make
no progress.

For both `movie` and `series`, require:

- model/schema/ontology are the intended v2 versions;
- `verified_count == scored_count + excluded_count`, `unscored_count == 0`,
  and coverage is `1.0` once full accounting completes;
- every verified row is either profiled or has a durable retryable failure;
- reserve depth is at least 200 before a v2 rail is eligible to publish;
- the active taste generation has nonzero `anchor_count`; its `explicit_mass`
  is nonzero when H2 found qualifying-positive current Household Fire/Water,
  and its `implicit_mass` is nonzero when H2 found qualifying Saved or
  meaningful-watch evidence. Read these aggregate fields from the exact
  `vod_taste_generations` row referenced by the active rank generation;
- the active taste revision was captured after the H2 signal baseline and no
  newer Household rating, Save/Unsave, meaningful-watch, or completion
  revision is pending. If a signal changes during backfill, allow the
  coalescing worker to publish the newer revision and re-run this check;
- no stale reason, cursor/corpus race, or newer revision was overwritten;
- active threads are 1–3 when qualifying evidence exists;
- offline evaluation is present for the final complete generation;
- evaluation status is `passed`, `promotion_eligible == true`, relative
  nDCG@6 improvement is at least 10%, paired 90% bootstrap low bound is above
  zero, per-axis/intrusion guardrail regressions are no worse than 0.02,
  accounting and determinism pass, and cached p95 is at most 250 ms.

If ratings are too sparse for the confidence bound, keep VOD in `shadow` and
mark promotion `DEFERRED — insufficient normal household ratings`. Never seed
synthetic ratings or weaken the gate. Optional operator-supplied rating seeds
must be dry-run, validated, imported, and re-imported to prove `noop: true`.

Before promotion, use `/recommendations/state`, privacy/schema tests bound to
`TARGET_SHA`, and privacy-safe database diagnostics to prove v2 coverage,
strict StoryDNA, threads, ranks, and evaluation. In `shadow`, the public
`/rails/items?tab=movies` and `/rails/items?tab=series` routes intentionally
remain legacy; query them only to prove rollback service remains available and
ordinary loads do not advance v2 generation IDs. Do not claim v2 six-card
shape, verified-only output, or public v2 ordering from those shadow responses.

Prove teacher input isolation with exact-SHA tests and a source/config audit.
Privacy-safe logs may corroborate that result, but absence from logs is not
proof that private fields were absent from requests.

## 9. Workstream H5 — staged YouTube shadow build

Keep the VOD mode at its current independently justified value and set:

```text
MANGO_YOUTUBE_RECS_V2=shadow
```

Make the protected environment backup, edit only the YouTube key, restart
catalog/launcher, and perform the mode-`0600` two-key allowlist readback from
H4. Do not modify the independently justified VOD mode.

Google Takeout is optional. If the operator supplies a local Pi path, use the
Reliability Center importer or CLI fallback:

```bash
bash scripts/pi-exec.sh 'cd ~/mango/src/catalog-service && npm run youtube:takeout -- /operator/provided/path/to/takeout.zip'
```

Do not inspect raw records. Mango must not retain a copy of the archive or
extracted JSON/HTML, but leave the operator-supplied source path untouched; its
owner decides when to remove it. The response/report may contain only batch
counts, generation/version, sanitized format/name, timestamps, and redacted
errors—never normalized history rows. Re-import the same file and prove that
normalized row counts do not grow. Use the desktop path only within its
configured upload limit (64 MiB by default and never above its 256 MiB cap);
use the CLI for a larger already-Pi-local source. Because the desktop proxy may
buffer before catalog-service, measure peak memory for a representative upload
or report that end-to-end streaming proof as `DEFERRED`; do not claim it merely
from the parser design.

After any optional import and its idempotency check, run one final authoritative
nightly-class refresh so subscription, history, provenance, acquisition, live,
and rank phases are captured in the same final shadow evidence:

```bash
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/youtube-refresh-cache.sh --reason nightly_home_v2_shadow --timeout-sec 900'
```

Capture the HTTP 202 job and poll its exact
`GET /recommendations/jobs/<job_id>` route to a terminal state. Preserve each
phase result independently in the report.

YouTube shadow acceptance requires:

- when subscriptions/OAuth are in use, a successful complete authoritative
  subscription snapshot; on OAuth loss with a prior snapshot, an explicitly
  stale retained last-good snapshot rather than a partial replacement;
- when Takeout was supplied, normalized history generation plus privacy-safe
  import audit counts and an idempotent re-import; when it was not supplied,
  no Takeout-specific acceptance claim is required;
- Mango-local meaningful history is accepted independently of Takeout, and a
  valid subscriptions-only or history-only cold start is not failed for lacking
  the other signal;
- recommendation candidates have only `subscription_upload`,
  `subscription_live`, `history_channel`, or `history_topic` provenance;
- generic Search, AI-catalog, chart, Saved, profile, mood, VOD, and companion
  cache writes cannot enter v2 candidates;
- v2 diagnostics and exact-`TARGET_SHA` tests establish the intended logical
  order: For You/Beyond/More Like when recommendation-ready, History and Saved
  in canonical positions only when their own data exists, then conditional
  subscription/live rails; they also establish global deduplication, card
  counts, Shorts exclusion, and live isolation. Public v2 shape is proved only
  after serve promotion in H6;
- each refresh phase is reported independently and a failed phase retains its
  last-good generation;
- acquisition stays within the documented search/live quota ceilings and
  preserves the interactive Search reserve.

Apply the correct evidence case explicitly:

- subscriptions plus history: all eligible recommendation and conditional
  subscription/live semantics may be built;
- subscriptions only: For You/Beyond may use subscriptions and the thematic
  fallback is `More from channels you follow`;
- history only: For You/Beyond/More Like are valid and subscription/live rails
  are omitted;
- neither: the v2 diagnostics must select setup guidance, never Popular or
  regional filler.

In `shadow`, `/youtube/rails` intentionally remains legacy. Use
`/youtube/state`, exact-SHA tests, and privacy-safe provenance counts for v2
acceptance; use the public route only to prove legacy rollback service remains
available and its ordinary loads do not mutate v2 generations.

## 10. Workstream H6 — independent promotion

Promote only a domain whose own shadow gate passes:

```text
MANGO_VOD_RECS_V2=serve       # only if H4 passed
MANGO_YOUTUBE_RECS_V2=serve   # only if H5 passed
```

It is valid to serve one domain and leave the other in shadow. After each
single-domain change, make the protected backup, edit only that key, restart,
perform the file-mode/two-key allowlist readback from H4, and read back
`/recommendations/state` and `/youtube/state`. Inspect Home before changing the
second domain.

For VOD serve, inspect the exact public routes
`GET /rails/items?tab=movies` and `GET /rails/items?tab=series`. Prove each has
exactly one v2 For You rail (`for-you-movies` or `for-you-series`), exactly six
unique cards, and no private score/tag/reason payload. Join each returned ID
against current privacy-safe database state to prove poster presence,
verified-playable status, and absence of exact rated, Saved, meaningfully
watched, hidden, blocked, or Not-for-me titles. A static curated-rail gate is
not a substitute for this dynamic v2 proof.

Use exact-SHA tests plus naturally occurring operator activity to validate
that rating/Save/watch mutations commit first, evict the exact title, and
enqueue a revision-captured refresh. Do not create, alter, or clear real
ratings, Saved state, history, OAuth, or profiles merely to manufacture this
evidence; if no normal event occurs during the rollout, report the live
mutation observation as `DEFERRED` while retaining the automated proof.

For YouTube serve, inspect exact `GET /youtube/rails` output. Require For You,
Beyond Your Subscriptions, and More Like in stable order when the generation is
recommendation-ready. History and Saved occupy their canonical positions only
when their own utility data exists; an empty Saved household is valid. Only
applicable From Your Subscriptions and Live Now rails may follow. Prove each
rendered normal row contains four globally unique landscape cards, Live Now
contains one to four subscribed live streams, Shorts/live do not spill into
other recommendation rails, and every recommendation card has allowed
provenance. History and Saved remain stable utility rails and Saved has zero
rank influence.

## 11. Workstream H7 — automated Pi and couch proof

Run at the final exact SHA and final modes:

```bash
bash scripts/pi-exec-gate.sh
bash scripts/pi-exec.sh 'cd ~/mango && MANGO_GATE_FULL=1 bash scripts/pi-pre-couch-gate.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m3-play/playability/gate-m3-verified-rails.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-youtube-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-search-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-ux-smoke.sh'
bash scripts/pi-exec.sh 'cd ~/mango && bash scripts/m6-ship/gate-m6-reliability-proof.sh'
```

When `MANGO_VOICE=1`, also run the voice readiness and relevant Companion gates.
Do not run opt-in Live IPTV or destructive/grow probes unless their documented
preconditions are met.

Measure 100 ordinary cached requests separately for every served public route:

- `GET /rails/items?tab=movies`;
- `GET /rails/items?tab=series`;
- `GET /youtube/rails`.

Run the timing loop on the Pi against `127.0.0.1:3020`, record curl
`time_total`, and compute nearest-rank p95 from those 100 samples. Do not include
SSH round-trip time and do not pass `reshuffle`; each route's p95 must be at
most 250 ms. Prove these ordinary loads preserve the current shuffle epoch and
generation. Remove any temporary timing file after recording aggregate
statistics.

Then, separately from the 100-load test, perform exactly five X/reshuffle
requests on each served applicable surface. Do not perform 100 X presses: VOD's
predealt queue is deliberately bounded. For direct service proof use the same
exact route with `reshuffle=1`; use the physical controller for focus and
scroll proof. Before and after each five-press sequence, snapshot:

- VOD job IDs, generation IDs, and
  `story_graph_serving_work.full_reserve_queries`,
  `full_reserve_rows_loaded`, and `dealer_calls`;
- YouTube generation/phase state plus `quota_used_today`,
  `search_calls_today`, and `api_calls_today`.

The expensive VOD counters, job/generation IDs, and all YouTube quota/API/rank
state must remain unchanged. `queue_slates_scanned` and
`slate_items_revalidated` may increase because bounded local cached-slate
selection and current-eligibility validation are serving work, not network,
enrichment, corpus scanning, or ranking. Runtime state does not expose a
universal network-call counter, so establish the broader zero-work contract
with exact-`TARGET_SHA` tests plus stable jobs/generations/counters; logs are
corroboration only. Do not report a stronger runtime observation than the
available instrumentation proves.

The five-press behavior contract is:

- Movies X changes only Movies For You;
- TV X changes only TV For You;
- YouTube X changes recommendation/discovery/subscription/live slates while
  History and Saved stay stable;
- all five presses retain focus/card position and scroll state;
- each new slate avoids the preceding four when supply permits, with any
  documented relaxation recorded.

Verify restart and last-good recovery directly. Failure injection must be
non-destructive and reversible: never disable the Pi's LAN/interface during
SSH, revoke or edit real OAuth credentials, consume quota deliberately, clear
caches, corrupt databases, or mutate real household state. Use an existing
isolated test harness wherever possible. A runtime teacher/network endpoint
override is allowed only with a second healthy control path, captured
before-state, a bounded timeout, and a `trap`/watchdog that restores the exact
configuration and restarts services; recheck SSH, modes, health, and last-good
IDs afterward. If no supported safe injector exists for teacher offline,
network loss, OAuth loss, or quota exhaustion, mark that Pi-runtime item
`DEFERRED — no non-destructive injector` and cite the exact-SHA failure-path
test. Never turn a destructive simulation into a required gate.

Use `docs/COUCH_TEST.md` for human checks. At minimum perform ten VOD shuffles
per tab and judge whether at least two recognizable household taste threads are
present and at least five of six cards are plausible; inspect Beyond for novel
creators and More Like for at least three of four coherent cards. Verify
ten-foot readability, D-pad focus, Back restoration, and no private technical
explanation on cards. Capture the current six Movies and six TV For You IDs,
then B-launch every one of those twelve cards to first frame and return before
creating a meaningful-watch threshold solely for the test. Record success or
the exact failing card; all twelve must launch for this item to pass. The
static verified-rail gate and an API playability flag do not substitute for
actual launch proof. If the operator declines the twelve-launch check, mark it
`DEFERRED`, not passing. Human verdicts cannot be inferred from data.

## 12. Corrections and tuning

Diagnose before editing. Acceptable corrections include broken job polling,
cache invalidation, focus restoration, mode-aware gates, resource bounds,
schema/runtime bugs, or clear presentation defects. Tuning is acceptable only
when it preserves the approved product contract and is justified by measured
Pi/couch evidence.

For each source correction:

1. write the failing observation and a minimal reproduction;
2. `git fetch origin feat/native-experience` and require the remote tip still
   equals the current `TARGET_SHA`; if it moved, stop rather than rebasing or
   merging silently;
3. add or update a regression test and edit on the home Mac only;
4. run affected tests, `git diff --check`, and inspect that only intended
   source/test/docs are staged—never the working evidence or final report;
5. commit with a narrow message, run the complete local matrix against that
   candidate commit, and run `git show --check --oneline HEAD`;
6. only after those pass, push normally to
   `origin/feat/native-experience`; never force-push;
7. fetch again, require origin equals the pushed commit, then advance
   `TARGET_SHA="$(git rev-parse HEAD)"` and append it to the report's SHA chain;
   `APPROVED_SHA` never changes;
8. deploy `TARGET_SHA` through `pi-deploy.sh`, read back matching
   origin/home/Pi full SHAs, and rerun the failed Pi/couch proof plus all
   affected gates.

A failed or rejected push does not advance `TARGET_SHA`. Any later correction
repeats this guard from the then-current target. All subsequent commands,
evidence, promotion decisions, and the final report bind to `TARGET_SHA`.

Do not tune toward one convenient hand, add popularity filler, reintroduce
cosine/MMR, permit AI household scoring, allow unverified VOD candidates, or
broaden YouTube inputs.

## 13. Rollback drill

Rollback is mode-only and non-destructive. For the affected domain, change
`serve` to `shadow` first using the protected backup/edit/readback procedure,
restart, and prove legacy/last-good service returns.
Use `off` only when shadow work itself must stop. Never delete v2 tables,
profiles, ratings, StoryDNA, YouTube provenance/history, v4 snapshots, or DB
files. Restore `serve` after a successful drill only if its gates remain valid.

## 14. Completion contract

The rollout is complete only when:

- origin, home, and Pi match the final reported `TARGET_SHA`, while the report
  also preserves the immutable `APPROVED_SHA` and correction chain;
- local gates and final Pi gates pass at that SHA;
- migrations and preservation checks pass;
- each served domain passed its independent promotion contract;
- each served VOD domain has a current-signal taste generation and at least
  200 eligible reserve rows, and each served YouTube recommendation generation
  has the applicable current subscription/history provenance rather than an
  empty or generic-cache bootstrap;
- cached p95 and X zero-work behavior pass;
- restart/last-good and rollback drills pass; each offline/failure-injection
  runtime item either passes safely or is explicitly deferred with its matching
  exact-SHA failure-path test and `no non-destructive injector` reason;
- required couch judgments are actually observed;
- final modes and exact rollback commands are recorded;
- the report contains no secrets or unsupported claims and remains intentionally
  uncommitted/unpushed unless the user separately authorizes publishing it.

If anything remains unavailable, leave the safest proven modes in place and
report `DEFERRED` with the exact blocker and next command. Do not convert an
unknown into a pass.
