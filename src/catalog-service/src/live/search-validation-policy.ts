import { isArea69ChannelId } from './area69.js';

export type LiveSearchValidationDecision = {
  allowed: boolean;
  reason?: 'playback_active' | 'area69_playback_active';
};

/** Background validation never contends with foreground mpv or AREA69's one connection. */
export function liveSearchValidationDecision(
  channelId: string,
  playbackActive: boolean,
): LiveSearchValidationDecision {
  if (!playbackActive) return { allowed: true };
  return {
    allowed: false,
    reason: isArea69ChannelId(channelId) ? 'area69_playback_active' : 'playback_active',
  };
}
