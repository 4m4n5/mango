import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadFilterConfig, validateMainLadderPiPolicy } from './stream-filters.js';

test('S3: verified 4K ladder step without HEVC is rejected', () => {
  assert.throws(() => validateMainLadderPiPolicy([{
    step: 'unsafe_4k',
    max_quality: '2160p',
    min_quality: '2160p',
    exclude_remux: true,
    require_cache: 'cached',
    verified: true,
  }]), /4K requires require_hevc=true/);
});

test('S3: an unbounded main ladder step is treated as 4K-capable and requires HEVC', () => {
  assert.throws(() => validateMainLadderPiPolicy([{
    step: 'unsafe_unbounded_main',
    max_quality: null,
    exclude_remux: true,
    require_cache: 'cached',
    verified: true,
  }]), /4K requires require_hevc=true/);
});

test('S3: loadFilterConfig validates legacy ladder after main/last-resort split', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'mango-filter-policy-'));
  const path = join(dir, 'filters.json');
  try {
    await writeFile(path, JSON.stringify({
      play_ladder: [{
        step: 'unsafe_custom_main',
        max_quality: '2160p',
        min_quality: '2160p',
        exclude_remux: true,
        require_cache: 'cached',
      }],
    }));
    await assert.rejects(() => loadFilterConfig(path), /4K requires require_hevc=true/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
