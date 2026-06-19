import type { Stream } from '../core.js';
import { playabilityVerifyMaxCandidates } from './config.js';

export function limitVerifyCandidates(candidates: Stream[]): Stream[] {
  const max = playabilityVerifyMaxCandidates();
  if (candidates.length === 0) {
    return candidates;
  }
  const top = candidates[0];
  const cacheStatus = typeof top.cache_status === 'string' ? top.cache_status.toLowerCase() : '';
  if (cacheStatus === 'cached') {
    return candidates.slice(0, 1);
  }
  return candidates.slice(0, max);
}
