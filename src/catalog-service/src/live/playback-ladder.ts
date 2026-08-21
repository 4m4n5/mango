export type LivePlaybackCandidate = {
  url: string;
  source?: unknown;
  live_channel_id?: unknown;
  live_channel_source?: unknown;
  [key: string]: unknown;
};

export type LivePlaybackLadderResult<TPlayback> = {
  candidate?: LivePlaybackCandidate;
  playback?: TPlayback;
  attempts: number;
  errors: string[];
  exhausted: boolean;
};

export async function playLiveCandidateLadder<TPlayback>(
  candidates: LivePlaybackCandidate[],
  fallbackId: string,
  options: {
    remainingMs: () => number;
    probeTimeoutMs: number;
    probe: (url: string, timeoutMs: number) => Promise<boolean>;
    play: (url: string, timeoutMs: number) => Promise<TPlayback>;
    record: (
      source: string,
      channelId: string,
      status: 'verified' | 'failed',
      reason?: string,
    ) => Promise<void>;
    isCancelled: (error: unknown) => boolean | Promise<boolean>;
  },
): Promise<LivePlaybackLadderResult<TPlayback>> {
  let attempts = 0;
  const errors: string[] = [];
  for (const candidate of candidates) {
    const remainingMs = options.remainingMs();
    if (remainingMs <= 0) break;
    const source = typeof candidate.live_channel_source === 'string'
      ? candidate.live_channel_source
      : typeof candidate.source === 'string'
        ? candidate.source
        : 'unknown';
    const channelId = typeof candidate.live_channel_id === 'string'
      ? candidate.live_channel_id
      : fallbackId;
    const reachable = await options.probe(
      candidate.url,
      Math.min(options.probeTimeoutMs, remainingMs),
    );
    attempts += 1;
    if (!reachable) {
      errors.push(`${channelId}: unreachable`);
      await options.record(source, channelId, 'failed', 'reachability probe failed');
      continue;
    }
    try {
      const playRemainingMs = options.remainingMs();
      if (playRemainingMs <= 0) break;
      const playback = await options.play(candidate.url, playRemainingMs);
      await options.record(source, channelId, 'verified');
      return { candidate, playback, attempts, errors, exhausted: false };
    } catch (error) {
      if (await options.isCancelled(error)) throw error;
      errors.push(`${channelId}: playback start failed`);
      await options.record(
        source,
        channelId,
        'failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
  return {
    attempts,
    errors,
    exhausted: options.remainingMs() <= 0,
  };
}
