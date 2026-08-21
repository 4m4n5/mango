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

test('S3: a 4K main step without exclude_hdr is rejected on an X11 path', () => {
  const previous = process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE;
  process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE = 'pi5-x11-mpv-hifi';
  try {
    assert.throws(() => validateMainLadderPiPolicy([{
      step: 'hdr_4k_on_x11',
      max_quality: '2160p',
      min_quality: '2160p',
      exclude_remux: true,
      require_hevc: true,
      require_cache: 'cached',
      verified: true,
    }]), /X11 path requires exclude_hdr=true/);
  } finally {
    if (previous === undefined) delete process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE;
    else process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE = previous;
  }
});

test('S3: a non-X11 path may admit 4K HDR', () => {
  const previous = process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE;
  process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE = 'pi5-kms-kodi-hdr';
  try {
    validateMainLadderPiPolicy([{
      step: 'hdr_4k_on_kms',
      max_quality: '2160p',
      min_quality: '2160p',
      exclude_remux: true,
      require_hevc: true,
      require_cache: 'cached',
      verified: true,
    }]);
  } finally {
    if (previous === undefined) delete process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE;
    else process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE = previous;
  }
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
