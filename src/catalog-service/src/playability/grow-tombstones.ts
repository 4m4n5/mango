/** Transient indexer failures — retry after grow cursor advances into deeper catalog pages. */
export const GROW_DEEP_PAGE_BYPASS_REASONS = new Set(['no_stream', 'title_mismatch']);
