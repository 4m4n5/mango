# Starter prompt — home agent

> **Superseded starter.** Do not paste it as a current deploy prompt. The
> audited deploy wrappers are blocked for unattended use; reconcile with
> [`../DEPLOY.md`](../DEPLOY.md), [`../STATUS.md`](../STATUS.md), and the banner
> in the full Search brief.

```text
Work in the home-Mac Mango clone and validate the Search polish commit:
TARGET_SHA=<SHA_FROM_WORK_AGENT>

Read docs/tasks/search-polish-home-agent.md top to bottom before running anything;
it is historical context, not current deploy authority. Work only on
feat/native-experience and prove the exact SHA by Git, then stop at the current
docs/DEPLOY.md unattended-wrapper blocker unless a human reviews the documented
exception or the helper has been fixed and tested. Never rsync/scp, delete runtime
DBs/cache/history, disturb YouTube credentials/quota, or touch unrelated files.

Run every automated and couch acceptance step in the brief. Safe runtime repair
is allowed while idle. Make a source fix only after reproducing a Pi-only defect
twice and proving restart does not resolve it; keep the patch inside the brief's
Search scope, run all named gates, commit/push it, redeploy, and report the new
SHA. Never fabricate a pass: unavailable proof must be DEFERRED with the exact
reason.

Return the §9 report with SHA parity, gate results, quota before/after, D-pad
observations, poster failures, repairs, source-fix SHA if any, and blockers.
```
