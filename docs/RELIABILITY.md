# mango — Reliability Center and nightly proof

**Status:** implemented as an operator-facing Settings/API surface. It answers:
is Mango ready for couch use, and did the last unattended refresh prove it?

Reliability Center is not a consumer debug dashboard. Home stays quiet except
for a small Settings badge when status is yellow/red. Detailed status and safe
actions live in Settings and in catalog-service APIs.

---

## Model

| Status | Meaning |
|--------|---------|
| `green` | Core couch path is ready: launcher, catalog, controller, verified library, Live fallback, YouTube cache, and maintenance hygiene are healthy. |
| `yellow` | Mango is usable but needs attention: stale/missing proof, partial YouTube refresh, thin rails, disabled optional service, or active maintenance. |
| `red` | Couch use is broken or blocked: launcher/catalog/controller unavailable, no displayable verified pool, Live has no ready/fallback cache, or stale locks block maintenance. |

Nightly proof is availability-oriented. A rail missing `+20` is proof evidence
and usually yellow, not red, unless it leaves the couch-visible pool unusable.

---

## Storage

| Path | Purpose |
|------|---------|
| `/etc/mango/reliability/proofs.jsonl` | Append-only local proof ledger, pruned to 30 days |
| `~/.cache/mango/couch-activity.json` | Idle marker used before disruptive actions |
| `~/.cache/mango/*.lock` | Maintenance locks checked for stale blockers |

No cloud telemetry, secrets, or live proof data are committed.

---

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/reliability/state` | Current Green/Yellow/Red state, component cards, action availability, latest proof |
| `GET` | `/reliability/proofs?limit=20` | Recent proof ledger rows |
| `POST` | `/reliability/proof/run` | Localhost-only proof write; accepts `{ reason, metadata }` |
| `POST` | `/reliability/repair` | Localhost-only safe repair; starts `mango-health-repair.sh --quiet` when idle |
| `POST` | `/reliability/stack/restart` | Localhost-only detached `mango-stack.sh restart` when idle |
| `POST` | `/reliability/refresh/run` | Localhost-only detached nightly movie/TV + YouTube refresh when idle |

Launcher uses the proxy path `/api/catalog/reliability/*`.

---

## Safe actions

Settings exposes:

- **Repair now** — stale lock cleanup, safe stray cleanup, pad repair, catalog restart, launcher restart.
- **Run proof now** — non-playback health proof and ledger write.
- **Restart stack** — deliberate detached `mango-stack.sh restart`.
- **Run refresh** — detached `nightly-library-refresh.sh --mode nightly --preset nightly`.

Repair/restart/refresh require Mango to be idle. Proof can run while active,
but an active couch marker is captured in the proof record.

---

## Nightly chain

The 03:00 playability timer still runs one coordinator:

```bash
bash scripts/m3-play/playability/nightly-library-refresh.sh --mode nightly --preset nightly
```

Order:

1. Movie/TV playability stale+grow attempt.
2. Native YouTube refresh, even if movie/TV failed, unless another playability lock is still active.
3. Reliability proof, recording `playability_rc` and `youtube_rc` metadata.

The wrapper exits non-zero if movie/TV, YouTube, or proof is red/unreachable.
Set `MANGO_NIGHTLY_RELIABILITY_PROOF=0` only for targeted diagnosis.

---

## Gates

```bash
bash scripts/m6-ship/reliability-proof.sh --reason operator
bash scripts/m6-ship/gate-m6-reliability-proof.sh
```

`gate-m6-reliability-proof.sh` fails on red, warns on yellow, and passes green.
It is intended to run after `pi-deploy.sh --fast --gate` before couch handoff.
