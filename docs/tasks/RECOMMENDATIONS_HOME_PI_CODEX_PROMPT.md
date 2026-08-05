# HISTORICAL — DO NOT EXECUTE

This prompt targets the superseded legacy-v4/v2 migration contract and is not
safe for the latest-only source at `345535d`. It is retained only as historical
context. Do not give it to a home agent. Use the blocked successor template in
[`RECOMMENDATIONS_PROGRESSIVE_FRONTIER_HOME_AGENT_PROMPT.md`](RECOMMENDATIONS_PROGRESSIVE_FRONTIER_HOME_AGENT_PROMPT.md), and do not deploy until that template's source blockers are fixed and a reviewed successor SHA is pushed.

## Historical starter prompt — home agent
Work in the home-Mac `mango` clone on `feat/native-experience`; deploy exact pushed commit `<APPROVED_SHA>` to the Pi.
Read `docs/tasks/RECOMMENDATIONS_HOME_PI_CODEX_SPEC.md` from that commit top to bottom first; it is the complete contract.
Stop if the placeholder remains or that SHA is not the exact initial remote tip; keep `APPROVED_SHA` immutable.
Initialize `TARGET_SHA=APPROVED_SHA`; advance it only after a scoped correction is tested, committed, and pushed under the spec.
Use git-only source deployment: never rsync/scp/hand-copy repo files, edit Pi source, hide dirt, or delete/replace operator data.
Preserve legacy v4, profiles, ratings, Saved/history/progress, StoryDNA/provenance/last-good state, and the operator's Takeout source.
Build and gate VOD/YouTube independently in shadow; use only non-destructive failure injection and never claim public v2 rails from shadow.
Finish with healthy published reserves built from the Pi's current Household Fire/Water/Mango history and current YouTube subscription/history evidence; a mere empty or 200-row bootstrap is not completion.
Keep working evidence outside the clone, then write `docs/tasks/RECOMMENDATIONS_V2_HOME_PI_REPORT.md` as the final local mutation.
Do not commit, push, or deploy that report without separate approval; report the full `APPROVED_SHA` to `TARGET_SHA` chain.
Never fabricate a pass: mark every unobserved or blocked item `DEFERRED — <exact reason>` and leave the safest proven modes in place.
