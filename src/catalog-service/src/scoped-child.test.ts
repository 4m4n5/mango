import assert from 'node:assert/strict';
import test from 'node:test';
import { runScopedCommand, ScopedChildTimeoutError } from './scoped-child.js';

test('S4: hung child group is terminated and its output consumed within cleanup grace', async () => {
  const started = Date.now();
  // Full-suite process contention can exceed 50 ms before a newly spawned
  // shell gets its first timeslice. Keep the timeout short, but long enough
  // that this verifies pipe draining and group cleanup rather than OS startup
  // scheduling.
  const error = await runScopedCommand('bash', ['-c', 'printf started; sleep 5'], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 250,
    killGraceMs: 100,
  }).catch((caught) => caught);
  assert.ok(error instanceof ScopedChildTimeoutError);
  assert.equal(error.result.stdout, 'started');
  assert.ok(Date.now() - started < 1500, `cleanup exceeded grace: ${Date.now() - started}ms`);
});
