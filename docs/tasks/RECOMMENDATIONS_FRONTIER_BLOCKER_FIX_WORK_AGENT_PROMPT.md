# Work-agent prompt — close Progressive Frontier blockers + refresh home deploy handoff

Paste into a **fresh work-Mac** agent session on `feat/native-experience`.

Home attempted an exact-SHA deploy of latest-only Progressive Frontier, then
switched to tip `3ef1b20` (docs-only beyond `345535d`). Tip runbook/DEPLOY
truth **blocks** that executable revision. Pi was contained safely. Your job is
to fix the blockers, prove them with tests, push a successor SHA, and refresh
the home deployment runbook + starter prompt so home can finish shadow→serve.

```text
Work in the mango repo on branch feat/native-experience (work Mac; no Pi SSH
required unless the human later asks).

══════════════════════════════════════════════════════════════════
WHAT ALREADY HAPPENED ON THE HOME PI (do not re-litigate; account for it)
══════════════════════════════════════════════════════════════════

- Original handoff TARGET was 345535d883805bbfc21bb277b62adbb33ccb96cb.
- Origin tip then advanced to 3ef1b2079f0cd2b45f92adf6b476bc59e1a99478
  (“docs: refresh Mango product and operations truth”) — docs/ops truth only;
  same recommendation executable as 345535d.
- Home Mac/Pi LAN agent:
  - Inventoried Pi (idle, companion dirt preserved).
  - Created Pi-local SQLite online backups (dir mode 0700, files 0600,
    checksum + quick_check) of library.db + playability.db under
    /tmp/mango-frontier-h2-20260805T161937Z — not copied off-box.
  - Built/restarted at 345535d briefly, then FF’d Pi to tip 3ef1b20.
  - Read tip docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md which
    marks 345535d BLOCKED; stopped promotion.
  - Containment now on Pi:
      HEAD = 3ef1b2079f0cd2b45f92adf6b476bc59e1a99478
      MANGO_VOD_RECS_V2=off
      MANGO_YOUTUBE_RECS_V2=off
      MANGO_STORY_DNA=0
      MANGO_STORY_DNA_WORKER_MODE=off
      MANGO_TMDB_METADATA=off
      StoryDNA recommendation_features story-dna-v1/ai count = 1096 (preserved)
      catalog healthy; companion.example dirt preserved (not reset)
  - Did NOT run shadow refresh→serve, latency/X gates, or human couch recs claim.
  - Did NOT use pi-deploy.sh / pi-exec-gate.sh (wrapper blocker in docs/DEPLOY.md).
  - Mac catalog npm test at 345535d: 872 pass / 1 fail — treat as a signal to
    investigate; do not ignore.

Home evidence note (Mac): /tmp/mango-frontier-evidence/HANDOFF.md

══════════════════════════════════════════════════════════════════
MISSION
══════════════════════════════════════════════════════════════════

1) Fix every deploy blocker named by the current tip runbook / DEPLOY.md for
   the latest-only Progressive Frontier architecture so a successor SHA is
   actually deployable.
2) Add/extend focused tests that would have caught those defects.
3) Push a successor commit on feat/native-experience.
4) Update home-facing deployment instructions AND the home-agent starter
   prompt so the next home session has an explicit TARGET_SHA and a clean
   end-to-end contract that accounts for current Pi containment state.

══════════════════════════════════════════════════════════════════
BLOCKERS THAT MUST CLOSE (from tip runbook / DEPLOY)
══════════════════════════════════════════════════════════════════

Fix and prove with tests (exact wording may evolve; close the intent):

- YouTube `off` ownership / HTTP 409 for non-Household callers.
- VOD shadow vs serve Saved-ownership divergence.
- False VOD Shuffle “success” feedback while off/shadow.
- Insufficient active-serving-pointer diagnostics (latest row ≠ active public
  generation; mode_ready / last_good alone are insufficient).
- Missing focused replacements for removed service tests covering
  mode/identity combinations, YouTube off utility rails, generation
  publication/active-pointer reporting, migration preservation, and rollback.
- Keep pi-deploy / pi-exec-gate wrapper hardening in mind: either fix the
  unattended-deploy blocker in docs/DEPLOY.md (fail-closed fetch/SHA pin,
  no silent AIOMetadata sync) OR keep the home runbook on the reviewed
  exact-SHA manual Git/build/restart path without addon sync. Do not pretend
  the wrappers are safe if they are not.

Also preserve product locks:

- Latest-only architecture only (vod-content-profile-v2 + vod-story-frontier-v1;
  provenance-gated YouTube v2). No revival of deleted v4 engines.
- No data deletion / fresh-start / purge of playability, ratings, Saved,
  history, StoryDNA, generations, tables, migrations, or ledgers.
- Companion teacher + TMDB remain off for the initial couch test; no household
  fields in teacher payloads.
- StoryDNA bulk importer is still absent and is NOT a prerequisite for this
  successor; do not block deploy on bulk tagging. Preserve the Pi’s 1096
  existing story-dna-v1 overlays.

══════════════════════════════════════════════════════════════════
DELIVERABLES (required)
══════════════════════════════════════════════════════════════════

A. Code + tests on feat/native-experience that close the blockers.
B. Update docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md:
   - Clear the BLOCKED banner only when truly fixed.
   - Exact successor TARGET_SHA (full hash) once pushed.
   - Account for Pi starting from containment (modes off, tip docs SHA,
     preserved StoryDNA, existing backups may be reused if still valid or
     home must make fresh ones before migrations).
   - Keep git-only + no pi-deploy/pi-exec-gate while wrapper blocker remains.
   - Keep one-domain-at-a-time promote order and DEFERRED human ten-shuffle.
C. Update docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_HOME_AGENT_PROMPT.md
   into a paste-ready starter with the real TARGET_SHA filled in (no
   placeholders), incorporating containment/resume facts above.
D. Short handoff note for home (in the deploy doc or a sibling task note):
   what changed, which tests prove it, Mac commands to run before touching Pi,
   and explicit “do not deploy 345535d / 3ef1b20 for promote”.

══════════════════════════════════════════════════════════════════
HOW TO WORK
══════════════════════════════════════════════════════════════════

- Re-fetch tip; do not assume 3ef1b20 stays tip.
- Prefer focused failing tests first, then fixes.
- Do not weaken gates. Do not invent synthetic household ratings.
- Do not deploy to the Pi yourself unless the human explicitly asks.
- When done: commit + push (when asked / as part of completing the handoff),
  print the full successor TARGET_SHA, and point home at the updated starter
  prompt path.

Success = home can paste the updated starter, deploy that successor SHA, pass
automated Pi gates, promote VOD then YouTube independently, and leave the Pi
ready for the user’s human couch relevance test — without rediscovering these
blockers.
```

## Pasteable one-liner for the work-Mac session

Use the fenced block above as the full user message, or:

```text
Read and execute docs/tasks/RECOMMENDATIONS_FRONTIER_BLOCKER_FIX_WORK_AGENT_PROMPT.md
end-to-end on feat/native-experience. Close the Progressive Frontier deploy
blockers that stopped the home Pi at tip 3ef1b20 (modes off, StoryDNA 1096
preserved), push a successor SHA, and refresh the home deploy runbook + starter
prompt with that exact TARGET_SHA filled in.
```
