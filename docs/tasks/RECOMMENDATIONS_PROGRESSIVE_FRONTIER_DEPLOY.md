# Progressive Story Frontier — home Pi deployment

This is a git-only, preserve-state rollout. Do not copy databases, caches,
credentials, or source files between machines. Do not delete existing
`recommendation_features`, StoryDNA generations, ratings, history, Saved,
profiles, or playability rows.

## 1. Record and pause

On the Pi, record the current SHA, service configuration, active recommendation
generations, verified counts, StoryDNA row count, and database backup status.
Keep the safe initial posture:

```bash
MANGO_VOD_RECS_V2=shadow
MANGO_VOD_CONTENT_PROFILE=progressive-v2
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_TMDB_METADATA=off
```

`MANGO_STORY_DNA=0` is the containment switch for all teacher calls. The
progressive compiler still reuses valid persisted StoryDNA overlays.

## 2. Git-only deploy

From the Mac source authority, first confirm the target commit is pushed. On
the home Mac/Pi LAN use the repository deploy flow:

```bash
bash scripts/pi-deploy.sh --full
bash scripts/pi-exec-gate.sh
```

If deploying directly on the Pi, follow `docs/DEPLOY.md`: fetch, verify the
expected commit is an ancestor, `git pull --ff-only`, install/build, restart,
and read back the exact SHA. Never use rsync or scp.

## 3. Shadow proof with zero provider work

Verify migrations, then enqueue one Movies and one TV recommendation refresh.
Poll the HTTP 202 job IDs to terminal state. Read Reliability diagnostics and
require for both domains:

- `profile_mode=progressive-v2` and model `vod-story-frontier-v1`;
- `eligible + excluded == verified` and coverage 1.0;
- reserve depth at least 200;
- sparse rows have `sparse_unresolved` and are not serving eligible;
- existing enriched rows remain present;
- frontier worker is off and the provider usage ledger does not increase;
- Home and five X presses do not change provider, metadata, or ranking counts.

Run catalog-service tests/build and the launcher build at the deployed SHA.
Run the normal Pi pre-couch gate. Preserve logs and exact command outputs.

## 4. Optional TMDB

TMDB is not required for healthy recommendations. Enable it only after exact-ID
coverage is inspected and credentials are installed through the Pi's existing
secret mechanism. Settings must display: “This product uses the TMDB API but
is not endorsed or certified by TMDB.” Never commit the credential.

Keep `MANGO_TMDB_METADATA=off` if credentials or attribution proof is missing.

## 5. Bounded Companion frontier

Only after the zero-provider shadow gate passes, restore the configured
Companion provider and set:

```bash
MANGO_STORY_DNA=1
MANGO_STORY_DNA_WORKER_MODE=frontier
MANGO_STORY_DNA_FRONTIER_NIGHTLY_PER_TYPE=12
MANGO_STORY_DNA_FRONTIER_ROLLING_30D=96
MANGO_STORY_DNA_FRONTIER_BATCH=4
```

Restart once, verify the effective configuration, and observe one bounded run.
Require one request in flight, no more than four titles per request, no more
than 12 per domain per 24 hours, no more than 96 in 30 days, content-only
payloads, and durable stop/retry behavior. A provider failure must leave the
last-good rail healthy.

## 6. Promotion and rollback

Do not change VOD from shadow to serve unless the frozen evaluation, accounting
gate, p95 ≤250 ms Pi gate, and smoke/focus tests pass. YouTube remains under its
independent flag.

Rollback is configuration-first:

```bash
MANGO_STORY_DNA=0
MANGO_STORY_DNA_WORKER_MODE=off
MANGO_VOD_RECS_V2=shadow
MANGO_VOD_CONTENT_PROFILE=strict-v1
```

Restart and verify the prior last-good generation. Do not roll back by deleting
new tables or old artifacts. Human ten-shuffle couch judgment, focus retention,
and thematic satisfaction remain explicitly deferred until the user performs
them.
