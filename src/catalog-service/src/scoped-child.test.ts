import assert from 'node:assert/strict';
import test from 'node:test';
import { runScopedCommand, ScopedChildTimeoutError } from './scoped-child.js';

test('S4: hung child group is terminated and its output consumed within cleanup grace', async () => {
  const started = Date.now();
  const error = await runScopedCommand('bash', ['-c', 'printf started; sleep 5'], {
    cwd: process.cwd(),
    env: process.env,
    timeoutMs: 50,
    killGraceMs: 100,
  }).catch((caught) => caught);
  assert.ok(error instanceof ScopedChildTimeoutError);
  assert.equal(error.result.stdout, 'started');
  assert.ok(Date.now() - started < 1000, `cleanup exceeded grace: ${Date.now() - started}ms`);
});
