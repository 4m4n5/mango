# mango — Reliability Center and nightly proof

**Status:** implemented as an operator-facing Settings/API surface. It answers:
is Mango ready for couch use, and did the last unattended refresh prove it?

Reliability Center is not a consumer debug dashboard or a substitute for couch
acceptance. Home stays quiet except
for a small Settings badge when status is yellow/red. Detailed status and safe
actions live in Settings and in catalog-service APIs.

---

## Model

| Status | Meaning |
|--------|---------|
| `green` | Sampled core runtime is ready now: launcher, catalog, controller, verified library, configured optional sources, and maintenance hygiene are healthy. |
| `yellow` | Mango is usable but needs attention: stale/missing proof, partial YouTube refresh, thin rails, disabled optional service, or active maintenance. |
| `red` | Couch use is broken or blocked: launcher/catalog/controller unavailable, no displayable verified pool, Live has no ready/fallback cache, or stale locks block maintenance. |

**Known model defect:** Live is a product-optional subsystem, but current source
marks `live_config_ready=false` red and includes that component in overall
status. An intentionally Live-off box can therefore be falsely labelled not
couch-ready. Until the model and an explicit disabled-Live test are fixed, read
that red component as a defect; configured Live with neither fresh nor safe
stale cache should remain red.

Nightly proof is availability-oriented. A rail missing `+20` is proof evidence
and usually yellow, not red, unless it leaves the couch-visible pool unusable.
Green does not prove physical controller wake, TV/CEC, visible 4K/HDR, audio/lip
sync, every provider, subjective UI quality, or recommendation relevance.

---

## Storage

| Path | Purpose |
|------|---------|
| `/etc/mango/reliability/proofs.jsonl` | Append-only local proof ledger, pruned to 30 days |
| `~/.cache/mango/couch-activity.json` | Idle marker used before disruptive actions |
| `~/.cache/mango/*.lock` | Permanent ownership pathnames; a held fd is busy, an unheld pathname is normal and is never deleted as “stale” |
| `~/.cache/mango/playability-runs/*.json` | Durable coordinator claim and terminal run receipts surfaced in Reliability history |
| `~/.cache/mango/ops/events.jsonl` | Serialized, fsynced, run-bound stage/outcome ledger |
| `~/.cache/mango/recommendation-maintenance.lease` | Atomic 15-minute heavy-refresh lease; heartbeat is fresh for 30 seconds |

No cloud telemetry, secrets, or live proof data are committed.

Catalog exposes `GET /health/live` for process/event-loop liveness separately
from full `/health` readiness. The watchdog restarts an inactive unit
immediately; otherwise it requires two failed liveness probes five seconds
apart. Only a fresh recommendation lease permits one final 15-second probe.
Degraded full readiness alone never restarts a live catalog, and a stale lease
never suppresses repair.

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/reliability/state` | Localhost-only Green/Yellow/Red state, component cards, action availability, latest proof |
| `GET` | `/reliability/controller` | Localhost-only controller-link state and pad-ready evidence |
| `GET` | `/reliability/proofs?limit=20` | Localhost-only recent proof ledger rows |
| `POST` | `/reliability/proof/run` | Localhost-only proof write; accepts `{ reason, metadata }` |
| `POST` | `/reliability/repair` | Localhost-only safe repair; starts `mango-health-repair.sh --quiet` when idle |
| `POST` | `/reliability/controller/repair` | Localhost-only Bluetooth-only repair request when idle |
| `POST` | `/reliability/stack/restart` | Localhost-only detached `mango-stack.sh restart` when idle |
| `POST` | `/reliability/refresh/run` | Localhost-only atomically claimed nightly movie/TV + YouTube refresh when idle |

Proof metadata is a typed bounded allowlist (return codes, counts, run/publication/config/policy identifiers, stage/stop reason). Unknown keys, URLs, and unbounded caller text are rejected. Proof and ops ledgers serialize writers with permanent locks, fsync content, and use unique atomic report/compaction files.

Launcher uses the proxy path `/api/catalog/reliability/*`.

---

## Safe actions

Settings currently exposes:

- **Repair now** — stale lock cleanup, safe stray cleanup, pad repair, catalog restart, launcher restart.
- **Run proof now** — non-playback health proof and ledger write.
- **Restart stack** — deliberate detached `mango-stack.sh restart`.
- **Run refresh** — detached `nightly-library-refresh.sh --mode nightly --preset nightly`.

Repair/restart/refresh require Mango to be idle. Proof can run while active,
but an active couch marker is captured in the proof record.

The backend/API also implements **Repair controller** as one rate-limited
Bluetooth-link repair that never unpairs, restarts playback, or refreshes the
launcher. The audited launcher Settings renderer does not currently expose that
action, so it is API/backend-only until the UI is reconciled. Do not instruct a
viewer to press a button that is not rendered.

---

## Nightly chain

The **03:00** playability timer runs one coordinator:

On the Pi, from the repository root:

```bash
cd ~/mango
bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
```

Order:

1. Movie/TV playability stale+grow attempt and atomic publication when eligible.
2. Exact VOD recommendation refresh jobs for the newly published corpus, with
   last-good retained if a job fails or times out.
3. Session reshuffle/maintenance bookkeeping.
4. Native YouTube refresh, even if movie/TV failed, unless another playability
   lock is still active.
5. WAL checkpoint and Reliability proof, recording phase return codes/metadata.

The wrapper distinguishes ownership failure from downstream degradation: a failed/unpublished playability phase fails the run; a validated playability publication followed by VOD/YouTube/proof failure records `partial` and retains the last-good downstream output.
Set `MANGO_NIGHTLY_RELIABILITY_PROOF=0` only for targeted diagnosis.

The calendar timer is `Persistent=true`, so a missed 03:00 event can run after
boot while still respecting playback/idle/overlap guards. There is no separate
uncontrolled daytime retry watcher after a failed chain. When proof is yellow,
retry explicitly only while idle and only if no catch-up/job is already active:

```bash
cd ~/mango
bash scripts/m3-play/playability/playability-catch-up.sh nightly
```

Companion consolidate runs on a separate timer at **06:00**
(`install-companion-nightly-timer.sh`), is also persistent, and skips if the
playability maintenance lock is still held.

---

## Gates

On the Pi, from the repository root:

```bash
cd ~/mango
bash scripts/m6-ship/reliability-proof.sh --reason operator
bash scripts/m6-ship/gate-m6-reliability-proof.sh
bash scripts/m6-ship/gate-m6-controller-reconnect.sh
```

`gate-m6-reliability-proof.sh` fails on red, warns on yellow, and passes green.
It is intended to run on the exact deployed/read-back Pi SHA before couch handoff.
`gate-m6-controller-reconnect.sh` is controller-specific and requires the
controller-link installer to have been applied on the Pi.

The deploy wrappers currently have branch/SHA and implicit AIOMetadata-mutation
blockers; do not run them unattended.
Select/read back the exact Pi SHA through the reviewed process in
[DEPLOY.md](DEPLOY.md), then run these Pi-local gates.
