import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('connection information never falls back to a previous household LAN address', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const source of [main, html]) {
    assert.doesNotMatch(source, /10\.0\.0\.174/);
    assert.match(source, /https:\/\/mango\.local:3001/);
  }
  assert.match(main, /setText\("ip-address", "Unavailable"\)/);
  assert.match(main, /setText\("ip-address", info\.ip\)/);
});
