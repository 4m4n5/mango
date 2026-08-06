# Home-agent starter — post-deployment couch verification only

```text
Work on the Mango Pi/home LAN only if the user asks for additional automated
or physical couch evidence. The recommendation deployment is already complete.

EXECUTABLE_TARGET_SHA=93345e8e7fbefccb9bc072958918c75ce2057c7f

Read completely before acting:
- AGENTS.md
- docs/DEPLOY.md
- docs/STATUS.md
- docs/FIRE_WATER_RATINGS.md
- docs/COUCH_TEST.md
- docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md

Current state to verify, never assume:
- branch feat/native-experience; executable target above or a documentation-only
  descendant;
- MANGO_VOD_RECS_V2=serve and MANGO_YOUTUBE_RECS_V2=serve;
- MANGO_STORY_DNA=0, MANGO_STORY_DNA_WORKER_MODE=off, and
  MANGO_TMDB_METADATA=off;
- MemoryHigh=1280M and MemoryMax=1536M;
- library schema 17, playability schema 14, and 1,096 preserved
  story-dna-v1/AI overlays;
- preserved companion.example dirt and all existing backups, including
  ~/.local/share/mango/backups/agent-snapshots/
  frontier-pre-deploy-20260805T222844Z.

Do not deploy, rebuild, refresh recommendations, change modes, change memory,
or mutate data merely to repeat already-complete proof. Do not use rsync/scp,
restore/delete a database, fabricate ratings, or enable the StoryDNA/TMDB
workers. If source/runtime state differs, stop and report the exact difference.

The rating contract is locked:
- Fire/Water below 1 is a true-negative evaluation label;
- 1 through 2 is neutral;
- above 2 is quadratic positive preference: ((rating - 2) / 3)^2;
- low ratings never propagate a thematic penalty, although the exact rated
  title remains ineligible.

Remaining user-owned acceptance work:
1. From Movies and TV, inspect ten For You shuffles per tab at ten feet. Record
   whether at least five of six cards are plausible and whether recognizable
   household taste threads recur without feeling repetitive.
2. Confirm X changes only the active recommendation slates, keeps focus at the
   same card/scroll position, and leaves Continue, Saved, YouTube History, and
   YouTube Saved stable.
3. Launch representative Movies, TV, and YouTube cards. Confirm advancing
   playback, Back restoration, picture/audio quality, and no raw provider or
   diagnostic copy.
4. Confirm YouTube For You and Beyond feel relevant. More Like may be absent
   only while diagnostics say not_applicable; zero subscriptions is valid for
   this current history-only account.
5. Capture screenshots only if the user requests them. Do not claim subjective
   relevance, target-TV quality, or physical-controller behavior without direct
   observation.

If an automated regression appears, collect exact HEAD, effective modes,
/health/live, recommendation and YouTube state, InvocationID/NRestarts,
memory.events, process RSS, and the failing response/log. Preserve last-good
serving and household data. Contain only the affected recommendation domain if
necessary and return the evidence to the work agent before changing code.

Return a compact PASS/FAIL/DEFERRED table. Human thematic satisfaction,
picture/audio, screenshots, and controller feel must remain DEFERRED unless the
user directly observed them.
```
