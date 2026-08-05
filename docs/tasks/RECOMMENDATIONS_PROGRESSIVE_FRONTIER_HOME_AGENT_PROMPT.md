# Home-agent starter — recommendations reliability recovery

```text
Work in the mango repo on branch feat/native-experience from the home Mac/Pi
LAN. Deploy and verify exactly:

TARGET_SHA=c8cfe72154eb7732a41f78417f3a63b164835078

Read completely before acting:
- AGENTS.md
- docs/DEPLOY.md
- docs/ARCHITECTURE.md
- docs/RELIABILITY.md
- docs/FIRE_WATER_RATINGS.md
- docs/YOUTUBE.md
- docs/tasks/RECOMMENDATIONS_PROGRESSIVE_FRONTIER_DEPLOY.md

Execute that deployment runbook end-to-end. It is authoritative if this starter
summary omits detail.

Recorded containment to verify, not assume: Pi HEAD 9425b1f; VOD=off;
YouTube=off; StoryDNA/teacher/frontier/TMDB off; 1096 StoryDNA rows preserved;
companion.example dirt preserved; durable snapshot
~/.local/share/mango/backups/agent-snapshots/frontier-pre-deploy-20260805T183758Z
plus older durable T161937Z/T171818Z copies preserved; operator drop-in
frontier-memory.conf at MemoryHigh=1100M/MemoryMax=1400M. The prior Movies
refresh crossed MemoryHigh and changed the invocation. The prior YouTube
generation had no More Like reserve. No serve/couch claim exists.

Mission:
1. Prove TARGET_SHA and the documentation-only origin descendant contract on
   the home Mac. Stop on executable/config drift.
2. Preserve every Pi database, rating, Saved/history/profile/playability row,
   StoryDNA overlay, generation, migration, cache, credential, backup, and
   operator-owned file. Make new verified Pi-local SQLite online backups of
   library and playability state. Never copy a DB off-box.
3. Deploy TARGET_SHA through the reviewed exact-SHA Git-only manual path. Do
   not use pi-deploy.sh or pi-exec-gate.sh and do not run addon sync.
4. Back up frontier-memory.conf and change only its two values to
   MemoryHigh=1280M and MemoryMax=1536M. Do not tune GC, swap, V8 heap, or raise
   the limits again.
5. Keep YouTube and all provider work off. Run two complete sequential VOD
   shadow cycles: Movies then TV, twice. Prove one invocation/no restarts; zero
   cgroup max/oom/oom_kill deltas; peak <=90% of MemoryHigh; post-cycle RSS
   within 100 MiB of baseline after two minutes; no monotonic growth; no
   sustained pressure/swap growth; complete accounting; reserve >=200; valid
   six-card slates; v17/v14 schemas; preserved 1096+ overlays; reused content
   generation/priors on taste-only work; healthy liveness; cached Home/X p95
   <=250 ms.
6. Prove couch activity preempts a refresh within one 128-title batch, retains
   last-good and the committed page, and links a successor that resumes only
   when idle. Do not disrupt actual playback.
7. If those gates fail twice at 1280M/1536M, leave VOD off and report evidence.
   Do not raise memory again or implement the separate-service fallback on Pi.
8. Promote VOD independently only after every automated Pi gate passes. Prove
   public/active pointers, launches, focus/Back, offline/restart behavior, and
   five cache-only X presses. Leave the user's ten-shuffle thematic judgment
   and screenshots explicitly DEFERRED.
9. Test YouTube separately. Prove off ownership, then shadow authoritative
   subscriptions plus qualifying Takeout/Mango history only. More Like must
   either produce four thematic cards, fall back to four exact-channel cards
   labelled More from <channel>, or be omitted with explicit not_applicable.
   That honest omission is allowed. Required For You/Beyond failure or
   provenance impurity still blocks. Promote independently only after its
   applicable quota, provenance, atomic-generation, latency, focus, launch,
   offline, and cache-only-X gates pass.
10. On any failure, contain only the affected domain where safe; full
    containment is both recommendation modes off plus StoryDNA/frontier/TMDB
    off. Never delete data or restore a backup without proven corruption and
    explicit human approval.

Non-negotiable boundaries:
- Git only: never rsync, scp, tar, or hand-copy repo files or databases.
- Never reset/stash preserved companion dirt or edit overlapping source dirt.
- Never weaken a gate, fabricate ratings/subscriptions, or use popularity,
  charts, Search, VOD, Saved influence, profiles, mood, or Companion state for
  YouTube recommendations.
- Keep MANGO_STORY_DNA=0, WORKER_MODE=off, and TMDB=off for this couch round.
- Report unavailable evidence as DEFERRED with the exact reason.

Return a compact PASS/FAIL/DEFERRED table containing exact SHA/config, backup
proof, schema and StoryDNA preservation, tests/builds, refresh job IDs and
phase/cursor/resume state, corpus/reserve/pointer proof, both-cycle cgroup and
process-memory measurements, couch preemption, provider/quota deltas, latency,
rollback state, and the remaining user-owned couch checklist.
```
