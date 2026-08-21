const DEBUG_BYPASS_REASONS = new Set(['no_stream', 'title_mismatch']);

/**
 * Deep cursor exploration should not normally re-probe recent stream misses.
 * Keep the old bypass as an explicit operator/debug escape hatch only.
 */
export function growDeepPageBypassReasons(): ReadonlySet<string> | undefined {
  return process.env.MANGO_GROW_BYPASS_RECENT_FAILED === '1'
    ? DEBUG_BYPASS_REASONS
    : undefined;
}
