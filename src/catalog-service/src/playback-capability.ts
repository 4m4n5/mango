import type { Stream } from './core.js';
import {
  effectiveStreamQualityRank,
  isRemux,
  parseDebridCacheStatus,
  streamIsHdr,
  streamIsHevc,
  streamPlayScore,
  type StreamPlayScoreConfig,
  type VerifiedStreamHint,
} from './stream-filters.js';
import {
  getStreamPathEvidence,
  type StreamCapabilityClass,
  type StreamPathEvidence,
} from './playability/db.js';

export type StreamTechnicalProfile = {
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  profile?: string;
  hwdec?: string;
  hdr?: boolean;
  color_transfer?: string;
  duration_sec?: number;
  bitrate_bps?: number;
};

export type PlaybackCapabilityDecision = {
  profile_id: string;
  capability_class: StreamCapabilityClass;
  reason: string;
  evidence?: StreamPathEvidence | null;
};

const CLASS_RANK: Record<StreamCapabilityClass, number> = {
  proven_smooth: 3,
  unknown: 2,
  known_risky: 1,
};

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizedCodec(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function playbackProfileId(): string {
  return (process.env.MANGO_PLAYBACK_CAPABILITY_PROFILE || 'pi5-x11-mpv-hifi').trim();
}

function isPiX11Profile(profileId: string): boolean {
  return /(?:pi5|raspberry).*(?:x11|mpv)|(?:x11|mpv).*(?:pi5|raspberry)/i.test(profileId);
}

function technicalQualityRank(stream: Stream, technical?: StreamTechnicalProfile): number | null {
  const height = positiveNumber(technical?.height);
  if (height) return height;
  return effectiveStreamQualityRank(stream);
}

function technicalIsHdr(stream: Stream, technical?: StreamTechnicalProfile): boolean {
  if (technical?.hdr === true) return true;
  const transfer = String(technical?.color_transfer || '').toLowerCase();
  if (/(?:smpte2084|arib-std-b67|pq|hlg)/.test(transfer)) return true;
  return streamIsHdr(stream);
}

function technicalIsHevc(stream: Stream, technical?: StreamTechnicalProfile): boolean {
  const codec = normalizedCodec(technical?.codec);
  if (codec) return /(?:hevc|h265|h\.265|x265)/.test(codec);
  return streamIsHevc(stream);
}

function metadataComplete(technical?: StreamTechnicalProfile): boolean {
  return Boolean(
    positiveNumber(technical?.width)
    && positiveNumber(technical?.height)
    && normalizedCodec(technical?.codec),
  );
}

/**
 * Capability is a hard tier, not another scalar score. Path-specific evidence
 * can promote a technically safe release, while an active issue always keeps
 * the release as final fallback.
 */
export function classifyStreamCapability(
  stream: Stream,
  options: {
    technical?: StreamTechnicalProfile;
    fingerprint?: string;
    profileId?: string;
    now?: number;
  } = {},
): PlaybackCapabilityDecision {
  const profileId = options.profileId || playbackProfileId();
  const now = options.now ?? Date.now();
  const evidence = options.fingerprint
    ? getStreamPathEvidence(options.fingerprint, profileId)
    : null;

  if (evidence?.issue_expires_at && evidence.issue_expires_at > now) {
    return {
      profile_id: profileId,
      capability_class: 'known_risky',
      reason: evidence.issue_reason || 'reported playback issue',
      evidence,
    };
  }
  const evidenceClass = evidence?.issue_expires_at && evidence.issue_expires_at <= now
    ? (evidence.issue_previous_class || 'unknown')
    : evidence?.capability_class;
  if (evidenceClass === 'known_risky') {
    return {
      profile_id: profileId,
      capability_class: 'known_risky',
      reason: evidence?.reason || 'previous technical proof is risky on this playback path',
      evidence,
    };
  }

  const quality = technicalQualityRank(stream, options.technical);
  const hdr = technicalIsHdr(stream, options.technical);
  const hevc = technicalIsHevc(stream, options.technical);
  if (isPiX11Profile(profileId) && quality !== null && quality > 1080) {
    if (hdr) {
      return {
        profile_id: profileId,
        capability_class: 'known_risky',
        reason: '4K HDR requires costly X11 tone mapping',
        evidence,
      };
    }
    if (!hevc) {
      return {
        profile_id: profileId,
        capability_class: 'known_risky',
        reason: '4K codec is not hardware decoded on this path',
        evidence,
      };
    }
  }

  if (evidenceClass === 'proven_smooth') {
    return {
      profile_id: profileId,
      capability_class: 'proven_smooth',
      reason: 'previous substantial watch on this playback path',
      evidence,
    };
  }

  if (quality !== null && quality <= 1080) {
    return {
      profile_id: profileId,
      capability_class: 'proven_smooth',
      reason: 'within the proven HD decode and presentation envelope',
      evidence,
    };
  }

  if (quality !== null && quality > 1080 && hevc && !hdr) {
    const remuxIsProvenFit = !isRemux(stream)
      || (metadataComplete(options.technical) && remuxFitsPath(stream, options.technical));
    return {
      profile_id: profileId,
      capability_class: remuxIsProvenFit ? 'proven_smooth' : 'unknown',
      reason: remuxIsProvenFit
        ? 'compatible 4K SDR HEVC within this path profile'
        : '4K SDR HEVC remux needs bitrate and frame-rate proof',
      evidence,
    };
  }

  return {
    profile_id: profileId,
    capability_class: evidenceClass || 'unknown',
    reason: evidence?.reason || 'playback-path capability is not yet proven',
    evidence,
  };
}

function fidelityRank(stream: Stream, technical?: StreamTechnicalProfile): number {
  return technicalQualityRank(stream, technical) ?? 0;
}

function remuxFitsPath(stream: Stream, technical?: StreamTechnicalProfile): boolean {
  if (!isRemux(stream)) return true;
  const bitrate = positiveNumber(technical?.bitrate_bps);
  const fps = positiveNumber(technical?.fps);
  const maxBitrate = positiveNumber(process.env.MANGO_4K_REMUX_MAX_BITRATE_BPS) ?? 100_000_000;
  const maxFps = positiveNumber(process.env.MANGO_4K_REMUX_MAX_FPS) ?? 30;
  return Boolean(
    technicalIsHevc(stream, technical)
    && !technicalIsHdr(stream, technical)
    && bitrate
    && bitrate <= maxBitrate
    && fps
    && fps <= maxFps,
  );
}

export function compareStreamsForPlaybackPath(
  left: Stream,
  right: Stream,
  scoreConfig: StreamPlayScoreConfig,
  options: {
    verifiedHint?: VerifiedStreamHint;
    preferred_language?: string | null;
    technicalByFingerprint?: Map<string, StreamTechnicalProfile>;
    fingerprint?: (stream: Stream) => string;
    identityConfidence?: (stream: Stream) => number;
  } = {},
): number {
  const fingerprint = options.fingerprint;
  const leftFingerprint = fingerprint?.(left);
  const rightFingerprint = fingerprint?.(right);
  let leftTechnical = leftFingerprint
    ? options.technicalByFingerprint?.get(leftFingerprint)
    : undefined;
  let rightTechnical = rightFingerprint
    ? options.technicalByFingerprint?.get(rightFingerprint)
    : undefined;
  const leftDecision = classifyStreamCapability(left, {
    technical: leftTechnical,
    fingerprint: leftFingerprint,
  });
  const rightDecision = classifyStreamCapability(right, {
    technical: rightTechnical,
    fingerprint: rightFingerprint,
  });
  const parseEvidenceTechnical = (
    decision: PlaybackCapabilityDecision,
  ): StreamTechnicalProfile | undefined => {
    if (!decision.evidence?.technical_json) return undefined;
    try {
      return JSON.parse(decision.evidence.technical_json) as StreamTechnicalProfile;
    } catch {
      return undefined;
    }
  };
  leftTechnical = leftTechnical || parseEvidenceTechnical(leftDecision);
  rightTechnical = rightTechnical || parseEvidenceTechnical(rightDecision);

  const classDiff = CLASS_RANK[rightDecision.capability_class]
    - CLASS_RANK[leftDecision.capability_class];
  if (classDiff !== 0) return classDiff;

  const identityDiff = (options.identityConfidence?.(right) ?? 0)
    - (options.identityConfidence?.(left) ?? 0);
  if (identityDiff !== 0) return identityDiff;

  const leftQuality = fidelityRank(left, leftTechnical);
  const rightQuality = fidelityRank(right, rightTechnical);
  if (leftQuality !== rightQuality) return rightQuality - leftQuality;

  const leftRemuxFit = remuxFitsPath(left, leftTechnical);
  const rightRemuxFit = remuxFitsPath(right, rightTechnical);
  if (leftRemuxFit !== rightRemuxFit) return rightRemuxFit ? 1 : -1;

  // Cache and verified hints are deliberately confined to an equal
  // capability/fidelity tier.
  const leftScore = streamPlayScore(left, scoreConfig, options.verifiedHint, {
    preferred_language: options.preferred_language,
  });
  const rightScore = streamPlayScore(right, scoreConfig, options.verifiedHint, {
    preferred_language: options.preferred_language,
  });
  if (leftScore !== rightScore) return rightScore - leftScore;

  const longWatchDiff = (rightDecision.evidence?.long_watch_count ?? 0)
    - (leftDecision.evidence?.long_watch_count ?? 0);
  if (longWatchDiff !== 0) return longWatchDiff;

  const leftCached = parseDebridCacheStatus(left) === 'cached' ? 1 : 0;
  const rightCached = parseDebridCacheStatus(right) === 'cached' ? 1 : 0;
  return rightCached - leftCached;
}
