import { createHash } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Stream } from './core.js';
import { mangoCachePath } from './paths.js';
import {
  getMpvPlaybackState,
  getMpvProperty,
  playUrl,
  probeUrl,
  setMpvProperty,
  type PlayResult,
  type PlaybackHudContext,
} from './mpv.js';
import {
  expandObligationFloor,
  expandPlayLadder,
  streamReleaseFingerprint,
  type LadderCandidate,
} from './play-ladder.js';
import {
  debridServiceId,
  effectiveStreamQualityRank,
  parseDebridCacheStatus,
  playMinDurationSec,
  streamByteSize,
  streamEpisodeIdentityConfidence,
  streamIsHdr,
  streamIsHevc,
  type StreamFilterContext,
} from './stream-filters.js';
import type { PlayOrchestratorConfig } from './play-orchestrator.js';
import {
  classifyStreamCapability,
  compareStreamsForPlaybackPath,
  playbackProfileId,
  type StreamTechnicalProfile,
} from './playback-capability.js';
import {
  recordStreamPlaybackIssue,
  undoStreamPlaybackIssue,
  upsertStreamPathEvidence,
} from './playability/db.js';
import {
  activeWatchSession,
  flushWatchProgress,
  handoffWatchSession,
} from './progress/watcher.js';
import { transitionPlaybackSession } from './playback-session.js';

export type ActiveStreamPublicCandidate = {
  candidate_id: string;
  current: boolean;
  unavailable: boolean;
  resolution: string;
  hdr: 'HDR' | 'SDR';
  codec: string;
  cache: 'cached' | 'uncached' | 'unknown';
  source: string;
  size: string | null;
  bitrate: string | null;
  release_group: string | null;
  audio: string | null;
  capability_class: 'proven_smooth' | 'unknown' | 'known_risky';
  risk: string | null;
};

export type ActiveStreamSnapshot = {
  enabled: boolean;
  session_id: string | null;
  revision: number;
  status: 'idle' | 'ready' | 'checking' | 'switching' | 'failed';
  current_candidate_id: string | null;
  candidates: ActiveStreamPublicCandidate[];
  error: string | null;
  undo_available: boolean;
  switch_undo_candidate_id: string | null;
  switch_confirmed_at: number | null;
  focus_candidate_id: string | null;
  updated_at: number;
};

type InternalCandidate = {
  candidate_id: string;
  fingerprint: string;
  stream: Stream;
  ladder_step: string;
  technical?: StreamTechnicalProfile;
  unavailable: boolean;
};

type TrackPreference = {
  language: string | null;
  title: string | null;
  role: string | null;
};

type PlaybackPreferences = {
  position_sec: number;
  audio: TrackPreference | null;
  subtitle: TrackPreference | null;
  subtitles_visible: boolean;
};

type ActiveSession = {
  session_id: string;
  revision: number;
  status: ActiveStreamSnapshot['status'];
  play_epoch: number;
  content_type: string;
  content_id: string;
  title: string | null;
  hud: PlaybackHudContext;
  current_candidate_id: string;
  candidates: InternalCandidate[];
  config: PlayOrchestratorConfig;
  filter_context: StreamFilterContext;
  error: string | null;
  undo_fingerprint: string | null;
  switch_undo_candidate_id: string | null;
  switch_confirmed_at: number | null;
  last_selected_candidate_id: string | null;
  updated_at: number;
  resolve_fresh: () => Promise<Stream[]>;
};

export class ActiveStreamConflictError extends Error {
  readonly status = 409;
}

function pickerEnabled(): boolean {
  return process.env.MANGO_STREAM_PICKER !== '0';
}

function statePath(): string {
  return process.env.MANGO_ACTIVE_STREAMS_PATH
    || mangoCachePath('active-streams.json');
}

function candidateId(sessionId: string, fingerprint: string): string {
  return createHash('sha256').update(`${sessionId}|${fingerprint}`).digest('hex').slice(0, 20);
}

function displayResolution(stream: Stream, technical?: StreamTechnicalProfile): string {
  const height = technical?.height || effectiveStreamQualityRank(stream);
  if (!height) return 'Unknown';
  if (height >= 2160) return '4K';
  return `${Math.round(height)}p`;
}

function displayCodec(stream: Stream, technical?: StreamTechnicalProfile): string {
  if (technical?.codec) return technical.codec.toUpperCase();
  if (streamIsHevc(stream)) return 'HEVC';
  const text = `${stream.title || ''} ${stream.description || ''}`;
  if (/\b(?:avc|h\.?264|x264)\b/i.test(text)) return 'AVC';
  if (/\bav1\b/i.test(text)) return 'AV1';
  if (/\bvp9\b/i.test(text)) return 'VP9';
  return 'Unknown';
}

function bytesLabel(value: number | null): string | null {
  if (!value) return null;
  const gib = value / (1024 ** 3);
  return gib >= 1 ? `${gib.toFixed(gib >= 10 ? 0 : 1)} GB` : `${Math.round(value / (1024 ** 2))} MB`;
}

function bitrateLabel(value?: number): string | null {
  return value && value > 0 ? `${(value / 1_000_000).toFixed(1)} Mbps` : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function releaseGroup(stream: Stream): string | null {
  const direct = optionalString(stream.release_group) || optionalString(stream.encode);
  if (direct) return direct;
  const text = `${stream.description || ''} ${stream.title || ''}`;
  return text.match(/(?:^|[\s.-])(?:-|\[)([A-Za-z0-9]{2,16})(?:\]|\s|$)/)?.[1] || null;
}

function publicCandidate(
  session: ActiveSession,
  candidate: InternalCandidate,
): ActiveStreamPublicCandidate {
  const decision = classifyStreamCapability(candidate.stream, {
    fingerprint: candidate.fingerprint,
    technical: candidate.technical,
  });
  return {
    candidate_id: candidate.candidate_id,
    current: candidate.candidate_id === session.current_candidate_id,
    unavailable: candidate.unavailable,
    resolution: displayResolution(candidate.stream, candidate.technical),
    hdr: (candidate.technical?.hdr ?? streamIsHdr(candidate.stream)) ? 'HDR' : 'SDR',
    codec: displayCodec(candidate.stream, candidate.technical),
    cache: parseDebridCacheStatus(candidate.stream),
    source: optionalString(candidate.stream.source)
      || debridServiceId(candidate.stream)
      || 'Source',
    size: bytesLabel(streamByteSize(candidate.stream)),
    bitrate: bitrateLabel(candidate.technical?.bitrate_bps),
    release_group: releaseGroup(candidate.stream),
    audio: optionalString(candidate.stream.audio)
      || optionalString(candidate.stream.audio_channels),
    capability_class: decision.capability_class,
    risk: decision.capability_class === 'known_risky' ? decision.reason : null,
  };
}

function snapshotOf(session: ActiveSession | null): ActiveStreamSnapshot {
  if (!session || !pickerEnabled()) {
    return {
      enabled: pickerEnabled(),
      session_id: null,
      revision: 0,
      status: 'idle',
      current_candidate_id: null,
      candidates: [],
      error: null,
      undo_available: false,
      switch_undo_candidate_id: null,
      switch_confirmed_at: null,
      focus_candidate_id: null,
      updated_at: Date.now(),
    };
  }
  const current = session.candidates.find((candidate) => (
    candidate.candidate_id === session.current_candidate_id
  ));
  const alternatives = session.candidates.filter((candidate) => (
    candidate.candidate_id !== session.current_candidate_id
  ));
  const visibleCandidates = [...(current ? [current] : []), ...alternatives].slice(0, 5);
  const lastSelected = session.last_selected_candidate_id
    ? session.candidates.find((candidate) => candidate.candidate_id === session.last_selected_candidate_id)
    : null;
  if (lastSelected && !visibleCandidates.includes(lastSelected)) {
    visibleCandidates[visibleCandidates.length >= 5 ? 4 : visibleCandidates.length] = lastSelected;
  }
  const pinned = visibleCandidates.shift();
  visibleCandidates.sort((left, right) => Number(left.unavailable) - Number(right.unavailable));
  if (pinned) visibleCandidates.unshift(pinned);
  return {
    enabled: true,
    session_id: session.session_id,
    revision: session.revision,
    status: session.status,
    current_candidate_id: session.current_candidate_id,
    candidates: visibleCandidates.map((candidate) => publicCandidate(session, candidate)),
    error: session.error,
    undo_available: Boolean(session.undo_fingerprint),
    switch_undo_candidate_id: session.switch_undo_candidate_id,
    switch_confirmed_at: session.switch_confirmed_at,
    focus_candidate_id: session.last_selected_candidate_id,
    updated_at: session.updated_at,
  };
}

function candidateRoster(input: {
  sessionId: string;
  streams: Stream[];
  config: PlayOrchestratorConfig;
  context: StreamFilterContext;
  currentFingerprint: string;
  currentTechnical?: StreamTechnicalProfile;
}): InternalCandidate[] {
  const ladder = [
    ...(input.config.main_ladder || input.config.play_ladder),
    ...(input.config.last_resort_ladder || []),
  ];
  const expanded = expandPlayLadder(input.streams, ladder, input.context, {
    strict_unknown_cache: input.config.strict_unknown_cache,
    preferred_quality: input.config.preferred_quality,
    preferred_hdr_tags: input.config.preferred_hdr_tags,
    preferred_video_codecs: input.config.preferred_video_codecs,
    max_candidates: Number.MAX_SAFE_INTEGER,
    include_uncached: true,
    hard_language: input.config.hard_language,
    preferred_language: input.config.preferred_language,
    min_quality: input.config.request_overrides?.min_quality,
    max_quality: input.config.request_overrides?.max_quality,
    exclude_remux: input.config.request_overrides?.exclude_remux,
  });
  const seenUrls = new Set(expanded.map((candidate) => candidate.stream.url));
  const floor = expandObligationFloor(input.streams, input.context, {
    excludeUrls: seenUrls,
    maxCandidates: Number.MAX_SAFE_INTEGER,
    hard_language: input.config.hard_language,
    preferred_language: input.config.preferred_language,
  });
  const deduped = new Map<string, LadderCandidate>();
  for (const candidate of [...expanded, ...floor]) {
    const fingerprint = streamReleaseFingerprint(candidate.stream);
    if (!deduped.has(fingerprint)) deduped.set(fingerprint, candidate);
  }
  const current = deduped.get(input.currentFingerprint)
    || input.streams.map((stream) => ({
      stream,
      ladder_step: 'current',
    })).find((candidate) => streamReleaseFingerprint(candidate.stream) === input.currentFingerprint);
  if (current) {
    deduped.delete(input.currentFingerprint);
    deduped.set(input.currentFingerprint, current);
  }
  return [...deduped.entries()].map(([fingerprint, candidate]) => ({
    candidate_id: candidateId(input.sessionId, fingerprint),
    fingerprint,
    stream: candidate.stream,
    ladder_step: candidate.ladder_step,
    technical: fingerprint === input.currentFingerprint ? input.currentTechnical : candidate.technical,
    unavailable: false,
  }));
}

function rerankCandidates(session: ActiveSession): void {
  const technicalByFingerprint = new Map<string, StreamTechnicalProfile>();
  for (const candidate of session.candidates) {
    if (candidate.technical) {
      technicalByFingerprint.set(candidate.fingerprint, candidate.technical);
    }
  }
  session.candidates.sort((left, right) => {
    if (left.unavailable !== right.unavailable) return left.unavailable ? 1 : -1;
    return compareStreamsForPlaybackPath(
      left.stream,
      right.stream,
      {
        max_quality: session.config.max_quality,
        preferred_quality: session.config.preferred_quality,
        preferred_hdr_tags: session.config.preferred_hdr_tags,
        preferred_video_codecs: session.config.preferred_video_codecs,
      },
      {
        preferred_language: session.config.preferred_language,
        technicalByFingerprint,
        fingerprint: streamReleaseFingerprint,
        identityConfidence: (stream) => streamEpisodeIdentityConfidence(
          stream,
          session.filter_context.metaId,
          session.filter_context.episodeTitle,
        ),
      },
    );
  });
}

async function atomicWriteSnapshot(snapshot: ActiveStreamSnapshot): Promise<void> {
  const path = statePath();
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporary, path);
}

function trackPreference(
  tracks: unknown,
  selected: unknown,
  type: 'audio' | 'sub',
): TrackPreference | null {
  const id = Number(selected);
  if (!Number.isFinite(id) || !Array.isArray(tracks)) return null;
  const track = tracks.find((item) => (
    item && typeof item === 'object'
    && (item as Record<string, unknown>).type === type
    && Number((item as Record<string, unknown>).id) === id
  )) as Record<string, unknown> | undefined;
  if (!track) return null;
  return {
    language: optionalString(track.lang)?.toLowerCase() || null,
    title: optionalString(track.title)?.toLowerCase() || null,
    role: track['hearing-impaired'] === true
      ? 'hearing-impaired'
      : track.forced === true ? 'forced' : null,
  };
}

type ActiveStreamDependencies = {
  getPlaybackState: typeof getMpvPlaybackState;
  getProperty: typeof getMpvProperty;
  setProperty: typeof setMpvProperty;
  probe: typeof probeUrl;
  play: typeof playUrl;
};

async function capturePlaybackPreferences(
  dependencies: ActiveStreamDependencies,
): Promise<PlaybackPreferences> {
  const [state, tracks, aid, sid, subtitleVisible] = await Promise.all([
    dependencies.getPlaybackState(),
    dependencies.getProperty('track-list'),
    dependencies.getProperty('aid'),
    dependencies.getProperty('sid'),
    dependencies.getProperty('sub-visibility'),
  ]);
  return {
    position_sec: state?.position_sec || 0,
    audio: trackPreference(tracks, aid, 'audio'),
    subtitle: trackPreference(tracks, sid, 'sub'),
    subtitles_visible: subtitleVisible === true,
  };
}

function matchingTrackId(
  tracks: unknown,
  type: 'audio' | 'sub',
  preference: TrackPreference | null,
): number | null {
  if (!preference || !Array.isArray(tracks)) return null;
  const candidates = tracks.filter((item) => (
    item && typeof item === 'object'
    && (item as Record<string, unknown>).type === type
  )) as Array<Record<string, unknown>>;
  const scored = candidates.map((track) => {
    let score = 0;
    const language = optionalString(track.lang)?.toLowerCase() || null;
    const title = optionalString(track.title)?.toLowerCase() || null;
    if (preference.language && language === preference.language) score += 4;
    if (preference.title && title === preference.title) score += 3;
    if (preference.role === 'hearing-impaired' && track['hearing-impaired'] === true) score += 2;
    if (preference.role === 'forced' && track.forced === true) score += 2;
    return { id: Number(track.id), score };
  }).filter((row) => Number.isFinite(row.id) && row.score > 0);
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.id ?? null;
}

async function restorePlaybackPreferences(
  preferences: PlaybackPreferences,
  dependencies: ActiveStreamDependencies,
): Promise<void> {
  const tracks = await dependencies.getProperty('track-list');
  const audioId = matchingTrackId(tracks, 'audio', preferences.audio);
  const subtitleId = matchingTrackId(tracks, 'sub', preferences.subtitle);
  if (audioId !== null) await dependencies.setProperty('aid', String(audioId));
  if (subtitleId !== null) await dependencies.setProperty('sid', String(subtitleId));
  await dependencies.setProperty('sub-visibility', preferences.subtitles_visible ? 'yes' : 'no');
}

export class ActiveStreamService {
  private session: ActiveSession | null = null;
  private switchInFlight: Promise<void> | null = null;
  private waiters = new Set<() => void>();
  private readonly dependencies: ActiveStreamDependencies;

  constructor(dependencies: Partial<ActiveStreamDependencies> = {}) {
    this.dependencies = {
      getPlaybackState: dependencies.getPlaybackState ?? getMpvPlaybackState,
      getProperty: dependencies.getProperty ?? getMpvProperty,
      setProperty: dependencies.setProperty ?? setMpvProperty,
      probe: dependencies.probe ?? probeUrl,
      play: dependencies.play ?? playUrl,
    };
  }

  private async publish(): Promise<void> {
    await atomicWriteSnapshot(snapshotOf(this.session));
    for (const resolve of this.waiters) resolve();
    this.waiters.clear();
  }

  async clear(): Promise<void> {
    this.session = null;
    await this.publish();
  }

  async register(input: {
    sessionId: string;
    playEpoch: number;
    contentType: string;
    contentId: string;
    title?: string | null;
    hud?: PlaybackHudContext;
    streams: Stream[];
    config: PlayOrchestratorConfig;
    filterContext: StreamFilterContext;
    currentFingerprint: string;
    currentTechnical?: StreamTechnicalProfile;
    resolveFresh: () => Promise<Stream[]>;
  }): Promise<void> {
    if (!pickerEnabled() || !['movie', 'series'].includes(input.contentType)) {
      this.session = null;
      await this.publish();
      return;
    }
    const candidates = candidateRoster({
      sessionId: input.sessionId,
      streams: input.streams,
      config: input.config,
      context: input.filterContext,
      currentFingerprint: input.currentFingerprint,
      currentTechnical: input.currentTechnical,
    });
    const current = candidates.find((candidate) => candidate.fingerprint === input.currentFingerprint);
    if (!current) {
      this.session = null;
      await this.publish();
      return;
    }
    this.session = {
      session_id: input.sessionId,
      revision: 1,
      status: 'ready',
      play_epoch: input.playEpoch,
      content_type: input.contentType,
      content_id: input.contentId,
      title: input.title ?? null,
      hud: input.hud ?? { title: input.title, kind: 'unknown' },
      current_candidate_id: current.candidate_id,
      candidates,
      config: input.config,
      filter_context: input.filterContext,
      error: null,
      undo_fingerprint: null,
      switch_undo_candidate_id: null,
      switch_confirmed_at: null,
      last_selected_candidate_id: null,
      updated_at: Date.now(),
      resolve_fresh: input.resolveFresh,
    };
    rerankCandidates(this.session!);
    await this.publish();
  }

  async state(afterRevision = 0, waitMs = 0): Promise<ActiveStreamSnapshot> {
    const current = snapshotOf(this.session);
    if (!this.session || current.revision > afterRevision || waitMs <= 0) return current;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        resolve();
      }, Math.min(25_000, Math.max(0, waitMs)));
      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      this.waiters.add(done);
    });
    return snapshotOf(this.session);
  }

  private assertCommand(sessionId: string, revision: number): ActiveSession {
    const session = this.session;
    if (!session || session.session_id !== sessionId) {
      throw new ActiveStreamConflictError('active playback session changed');
    }
    if (session.revision !== revision) {
      throw new ActiveStreamConflictError('stream list revision changed');
    }
    return session;
  }

  async beginSwitch(input: {
    sessionId: string;
    revision: number;
    candidateId: string;
    undo?: boolean;
  }): Promise<ActiveStreamSnapshot> {
    const session = this.assertCommand(input.sessionId, input.revision);
    if (this.switchInFlight || session.status === 'checking' || session.status === 'switching') {
      throw new ActiveStreamConflictError('a stream switch is already in progress');
    }
    const selected = session.candidates.find((candidate) => candidate.candidate_id === input.candidateId);
    if (!selected || selected.unavailable) {
      throw new ActiveStreamConflictError('selected stream is no longer available');
    }
    if (input.undo && selected.candidate_id !== session.switch_undo_candidate_id) {
      throw new ActiveStreamConflictError('stream Undo is no longer available');
    }
    if (selected.candidate_id === session.current_candidate_id) {
      return snapshotOf(session);
    }
    session.status = 'checking';
    session.last_selected_candidate_id = selected.candidate_id;
    session.error = null;
    session.revision += 1;
    session.updated_at = Date.now();
    await this.publish();
    this.switchInFlight = this.switchCandidate(session, selected, input.undo === true)
      .catch(async () => {
        if (this.session !== session) return;
        const playback = await this.dependencies.getPlaybackState().catch(() => null);
        if (playback) {
          await this.dependencies.setProperty('pause', 'no').catch(() => undefined);
          session.status = 'ready';
          session.error = 'Could not check that stream. The current video is still playing.';
        } else {
          session.status = 'failed';
          session.error = 'Playback stopped while checking the alternate stream.';
          await flushWatchProgress().catch(() => false);
          await transitionPlaybackSession(session.session_id, 'failed_after_frame', {
            error: session.error,
          }).catch(() => null);
        }
        session.revision += 1;
        session.updated_at = Date.now();
        await this.publish().catch(() => undefined);
      })
      .finally(() => {
        this.switchInFlight = null;
      });
    void this.switchInFlight;
    return snapshotOf(session);
  }

  private async validateCandidate(
    session: ActiveSession,
    candidate: InternalCandidate,
    preferences: PlaybackPreferences,
  ): Promise<{ candidate: InternalCandidate; result: PlayResult }> {
    const timeout = parseDebridCacheStatus(candidate.stream) === 'uncached' ? 25_000 : 8_000;
    const minDuration = playMinDurationSec({
      contentType: session.content_type,
      episodeRole: session.filter_context.episodeRole,
    });
    try {
      const result = await this.dependencies.probe(
        candidate.stream.url,
        timeout,
        minDuration,
        session.play_epoch,
        preferences.position_sec,
        'user',
        true,
      );
      return { candidate, result };
    } catch (firstError) {
      const fresh = await session.resolve_fresh();
      const remapped = fresh.find((stream) => (
        streamReleaseFingerprint(stream) === candidate.fingerprint
      ));
      if (!remapped) throw firstError;
      candidate.stream = remapped;
      const result = await this.dependencies.probe(
        remapped.url,
        timeout,
        minDuration,
        session.play_epoch,
        preferences.position_sec,
        'user',
        true,
      );
      return { candidate, result };
    }
  }

  private async switchCandidate(
    session: ActiveSession,
    selected: InternalCandidate,
    undo: boolean,
  ): Promise<void> {
    const original = session.candidates.find((candidate) => (
      candidate.candidate_id === session.current_candidate_id
    ));
    if (!original) return;
    const preferences = await capturePlaybackPreferences(this.dependencies);
    await this.dependencies.setProperty('pause', 'yes');
    let validated: { candidate: InternalCandidate; result: PlayResult };
    try {
      validated = await this.validateCandidate(session, selected, preferences);
    } catch {
      selected.unavailable = true;
      rerankCandidates(session);
      session.status = 'ready';
      session.error = 'That stream is unavailable. The current video is still playing.';
      session.revision += 1;
      session.updated_at = Date.now();
      await this.dependencies.setProperty('pause', 'no');
      await this.publish();
      return;
    }

    session.status = 'switching';
    session.revision += 1;
    session.updated_at = Date.now();
    await this.publish();
    selected.technical = validated.result.technical;
    if (selected.technical) {
      const decision = classifyStreamCapability(selected.stream, {
        fingerprint: selected.fingerprint,
        technical: selected.technical,
      });
      try {
        upsertStreamPathEvidence({
          release_fingerprint: selected.fingerprint,
          profile_id: decision.profile_id,
          capability_class: decision.capability_class,
          technical: selected.technical,
          reason: decision.reason,
          last_proof_at: Date.now(),
        });
      } catch {
        // A successful manual validation is still usable if optional evidence
        // persistence is temporarily unavailable.
      }
    }
    const timeout = parseDebridCacheStatus(selected.stream) === 'uncached' ? 45_000 : 25_000;
    const minDuration = playMinDurationSec({
      contentType: session.content_type,
      episodeRole: session.filter_context.episodeRole,
    });
    try {
      await this.dependencies.play(selected.stream.url, timeout, {
        minDurationSec: minDuration,
        playEpoch: session.play_epoch,
        startSec: preferences.position_sec,
        ladderStep: selected.ladder_step,
        hud: {
          ...session.hud,
          confirmation: undo
            ? 'Previous stream restored'
            : `Now playing · ${displayResolution(selected.stream, selected.technical)} · ${
              parseDebridCacheStatus(selected.stream) === 'cached' ? 'Ready now' : 'May take longer'
            }`,
        },
      });
      session.current_candidate_id = selected.candidate_id;
      session.switch_undo_candidate_id = undo ? null : original.candidate_id;
      session.switch_confirmed_at = Date.now();
      session.last_selected_candidate_id = null;
      session.status = 'ready';
      session.error = null;
      rerankCandidates(session);
      const watch = activeWatchSession();
      if (watch) {
        watch.release_fingerprint = selected.fingerprint;
        watch.technical = selected.technical;
        watch.long_watch_recorded = false;
        await handoffWatchSession(watch);
      }
      await restorePlaybackPreferences(preferences, this.dependencies);
    } catch {
      try {
        await this.dependencies.play(original.stream.url, timeout, {
          minDurationSec: minDuration,
          playEpoch: session.play_epoch,
          startSec: preferences.position_sec,
          ladderStep: original.ladder_step,
          hud: { ...session.hud, reopenStreams: true },
        });
        session.current_candidate_id = original.candidate_id;
        session.status = 'ready';
        session.error = 'Could not switch streams. The original stream was restored.';
        await restorePlaybackPreferences(preferences, this.dependencies);
      } catch {
        session.status = 'failed';
        session.error = 'Playback stopped because neither stream could start.';
        await flushWatchProgress().catch(() => false);
        await transitionPlaybackSession(session.session_id, 'failed_after_frame', {
          error: session.error,
        }).catch(() => null);
      }
      selected.unavailable = true;
      session.switch_undo_candidate_id = null;
      session.switch_confirmed_at = null;
      rerankCandidates(session);
    }
    session.revision += 1;
    session.updated_at = Date.now();
    await this.publish();
  }

  async reportIssue(input: {
    sessionId: string;
    revision: number;
    reason?: string;
  }): Promise<ActiveStreamSnapshot> {
    const session = this.assertCommand(input.sessionId, input.revision);
    const current = session.candidates.find((candidate) => (
      candidate.candidate_id === session.current_candidate_id
    ));
    if (!current) throw new ActiveStreamConflictError('current stream changed');
    recordStreamPlaybackIssue({
      release_fingerprint: current.fingerprint,
      profile_id: playbackProfileId(),
      reason: input.reason?.trim() || 'user requested a smoother source',
    });
    session.undo_fingerprint = current.fingerprint;
    rerankCandidates(session);
    session.revision += 1;
    session.updated_at = Date.now();
    session.error = 'Current source moved to final fallback. Choose an alternate, or Undo.';
    await this.publish();
    return snapshotOf(session);
  }

  async undoIssue(input: {
    sessionId: string;
    revision: number;
  }): Promise<ActiveStreamSnapshot> {
    const session = this.assertCommand(input.sessionId, input.revision);
    if (!session.undo_fingerprint) {
      throw new ActiveStreamConflictError('there is no stream issue to undo');
    }
    undoStreamPlaybackIssue({
      release_fingerprint: session.undo_fingerprint,
      profile_id: playbackProfileId(),
    });
    session.undo_fingerprint = null;
    rerankCandidates(session);
    session.error = null;
    session.revision += 1;
    session.updated_at = Date.now();
    await this.publish();
    return snapshotOf(session);
  }
}
