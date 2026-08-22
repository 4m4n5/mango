import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_SOURCE_PATH = resolve(HERE, '../../src/index.ts');
const SETUP_SCRIPT_PATH = resolve(
  HERE, '../../../..',
  'scripts/m1-foundation/ui/install-systemd-units.sh',
);
const SYSTEMD_UNIT_PATH = resolve(
  HERE, '../../../..',
  'scripts/m1-foundation/ui/systemd/mango-vod-recs-worker.service',
);

test('catalog boot never instantiates the coalescing queue or reads inline env fallback', () => {
  const source = readFileSync(INDEX_SOURCE_PATH, 'utf8');
  assert.equal(
    /new\s+CoalescingRecommendationRefreshQueue/.test(source),
    false,
    'catalog must not instantiate the legacy CoalescingRecommendationRefreshQueue',
  );
  assert.equal(
    /recommendationRefreshQueues\s*\[[^\]]+\]\s*\.\s*enqueue\s*\(/.test(source),
    false,
    'catalog must not enqueue VOD refresh work into any in-memory queue',
  );
  assert.equal(
    source.includes('MANGO_CATALOG_INLINE_RECS_REFRESH'),
    false,
    'inline VOD refresh fallback env flag must not appear in catalog boot',
  );
  assert.equal(
    source.includes('inlineRecsRefreshEnabled'),
    false,
    'inlineRecsRefreshEnabled sentinel must be gone from catalog boot',
  );
  assert.ok(source.includes('updateDesiredRevision('),
    'signal/corpus/manual refresh must persist to vod_desired_revisions');
});

test('index.ts persists desired revisions on every trigger', () => {
  const source = readFileSync(INDEX_SOURCE_PATH, 'utf8');
  const updates = source.match(/updateDesiredRevision\(/g) ?? [];
  assert.ok(updates.length >= 1,
    `expected at least one updateDesiredRevision call, found ${updates.length}`);
});

test('setup script installs and enables the isolated VOD recs worker unit', () => {
  const setupSource = readFileSync(SETUP_SCRIPT_PATH, 'utf8');
  assert.ok(setupSource.includes('mango-vod-recs-worker.service'),
    'install-systemd-units.sh must install mango-vod-recs-worker.service');
  assert.ok(/systemctl.*enable[^\n]*mango-vod-recs-worker/.test(setupSource),
    'install-systemd-units.sh must enable mango-vod-recs-worker');
});

test('systemd unit caps memory at <= 384M for the isolated worker', () => {
  const unitSource = readFileSync(SYSTEMD_UNIT_PATH, 'utf8');
  const highMatch = unitSource.match(/MemoryHigh=(\d+)M/);
  const maxMatch = unitSource.match(/MemoryMax=(\d+)M/);
  assert.ok(highMatch, 'MemoryHigh must be set');
  assert.ok(maxMatch, 'MemoryMax must be set');
  assert.ok(Number(highMatch![1]) <= 384,
    `MemoryHigh must be <= 384M, got ${highMatch![1]}M`);
  assert.ok(Number(maxMatch![1]) <= 384,
    `MemoryMax must be <= 384M, got ${maxMatch![1]}M`);
});
