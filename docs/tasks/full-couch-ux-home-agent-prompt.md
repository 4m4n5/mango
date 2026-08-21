# Starter prompt — autonomous home Mango hardening and final couch acceptance

> **Superseded starter.** Do not paste or execute it as the current deploy
> contract. The audited deploy wrappers are blocked for unattended use; begin
> with [`../DEPLOY.md`](../DEPLOY.md), [`../STATUS.md`](../STATUS.md), and the
> historical banner in the full acceptance brief.

```text
Work from the home-Mac Mango clone on branch feat/native-experience; verify the
branch and do not switch. Set TARGET_SHA to the exact SHA in this assignment;
it is a minimum ancestry marker, not a single commit to cherry-pick. Fetch origin,
prove TARGET_SHA is contained in origin/feat/native-experience, then read
docs/tasks/FULL_COUCH_UX_HOME_ACCEPTANCE_CODEX_SPEC.md top to bottom before doing
anything—it is the full cumulative contract.
Before pulling or deploying, record the Pi's live starting SHA and inventory
every pending commit and changed path through the current origin branch tip.
Require the Pi start to be an ancestor of that tip; otherwise stop without
reset/stash/clean. Do not invoke `pi-deploy.sh` unattended: stop at the current
docs/DEPLOY.md blocker unless a human reviews its documented exception or the
helper has been fixed and tested. After a separately authorized Git-only deploy,
prove home, origin, and Pi SHAs match, and run gates for every subsystem
touched anywhere in the cumulative range, not just the newest commit. Then verify
every launcher, Search, Detail, P0 state, playback ladder, HUD/Streams,
voice/companion, Settings, Reliability, controller, and locked display-sleep
flow as autonomously as possible before asking me to test anything.
Reproduce The Internet's Own Boy (tt3268458) first: prove no premature black
foreground takeover, no Detail bounce followed by autonomous late playback, no
post-cancel candidate start, bounded fallthrough, and smooth B-to-first-frame
startup. Run the URL-free ladder diagnostic and verify AIOStreams is the sole VOD
aggregate while Torrentio/MediaFusion/Comet and TorBox/Real-Debrid contribute in
their correct internal roles when naturally available.
Run exhaustive diagnostics, traverse safe flows, render fixtures, capture and
inspect labeled/checksummed Pi screenshots, review logs/health/resource pressure,
and repeat timing-sensitive paths. Capture a failure before changing anything.
Feel free to make systematic, robust, principled home-Mac implementation changes
where evidence shows broken wiring, split ownership, races, weak recovery,
performance issues, or UX defects; add realistic regression tests, commit/push,
Git-deploy, and re-prove the exact invariant plus adjacent paths. Preserve locked
product contracts and never paper over defects with arbitrary waits/retries.
Only after the autonomous baseline is green, present me with a minimal 10–15
minute couch test for the residual human-only judgments, ask one to three
observations at a time, make any evidence-backed last-mile tweaks, and recheck.
Never rsync/scp, edit Pi source, delete runtime state, touch YouTube
credentials/quota, use pairing mode as normal reconnect, or fabricate a couch
pass. Push the report with every DEFERRED item and exact next action, then leave
the TV On at 30m with playback stopped and launcher/controller usable.
```
