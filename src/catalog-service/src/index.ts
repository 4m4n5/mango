import http from 'node:http';
import { CatalogCore, CatalogError, normalizeResourceId } from './core.js';
import { couchPlayFailureMessage, publicPlayFailureDetails } from './catalog-errors.js';
import { isMpvActive, playUrl } from './mpv.js';
import { playWithLadder } from './play-orchestrator.js';
import { assertPlayEpoch, bumpPlayEpoch, isPlayEpochStale, PlayCancelledError } from './play-cancel.js';
import {
  reconcileFailedEpisodePlayability,
  reconcileSuccessfulEpisodePlayability,
} from './episode-playability-reconcile.js';
import { createPlayDeadline, remainingPlayBudgetMs, type PlayDeadline } from './play-deadline.js';
import {
  createPlayRequestTerminalEmitter,
  emitPlaybackTelemetry,
  getRecentPlayRequestTerminalSummary,
  noPlayableStreamTerminalStage,
  type PlayRequestTerminalDetails,
  type PlayRequestTerminalOutcome,
} from './playback-telemetry.js';
import {
  cancelPlayRequest,
  finishPlayRequest,
  normalizePlayRequestId,
  registerPlayRequest,
} from './play-request-registry.js';
import {
  createPlaybackSession,
  getPlaybackSession,
  transitionPlaybackSession,
  waitForPlaybackSession,
  type PlaybackSessionSource,
} from './playback-session.js';
import {
  demoteTitle,
  enqueuePlayabilityTrigger,
  invalidateTitle,
  getTitlePlayability,
  getTitleVerifyProfile,
  playabilityRecommendationCorpusGeneration,
  recordVerifyResult,
} from './playability/db.js';
import { startTriggerConsumerBackgroundTick } from './playability/trigger-consumer.js';
import { isSeriesEpisodeId, isSeriesRailGateId, seriesBareId } from './playability/ids.js';
import { playabilityVerifyTtlMs } from './playability/config.js';
import {
  shouldConfirmPlayFailure,
  shouldDemoteAfterPlayError,
} from './playability/play-failure-policy.js';
import { assignVerifiedTitleToBestRail } from './playability/rail-pool-retheme.js';
import { isFirstTimeVerifiedPromotion } from './play-verify-state.js';
import { deriveLibraryVerifyState } from './voice/external.js';
import { initProgressDb, getWatchProgressForTitle } from './progress/db.js';
import {
  clearLibraryContext,
  clearLibraryFeedback,
  getLatestEpisodeWatchProgress,
  getLibraryContext,
  getLibraryState,
  initLibraryDb,
  isLibrarySaveAllowed,
  libraryDomainForItem,
  libraryTabForItem,
  backupLibraryDbBeforeFireWaterMigration,
  activeViewerProfileId,
  activateViewerProfile,
  completeViewerProfileOnboarding,
  createViewerProfile,
  getPersonalizationState,
  listSavedLibraryItems,
  listProfileLibraryFeedback,
  listViewerProfiles,
  listWatchHistory,
  normalizeLibraryIdentity,
  recordLibraryWatch,
  recordRecommendationDetailOpen,
  recordRecommendationImpressions,
  registerRecommendationServedSlates,
  resolveRecommendationServedSlate,
  renameViewerProfile,
  saveLibraryItem,
  setLibraryFeedback,
  setLibraryContext,
  setViewerMood,
  unsaveLibraryItem,
  SYNTHETIC_LIBRARY_SOURCE,
  type LibraryItemInput,
} from './library/db.js';
import {
  RatingRevisionConflictError,
  RatingValidationError,
  clearRating,
  canonicalRatingIdentity,
  getRating,
  getRatingPromptState,
  markRatingPromptPresented,
  putRating,
  resolveRatingPrompt,
} from './library/ratings.js';
import {
  currentRecommendationRevision,
  fireWaterRatingsEnabled,
  recommendationDiagnostics,
  incrementRecommendationMetric,
  refreshForYou,
} from './recommendations/service.js';
import { CoalescingRecommendationRefreshQueue } from './recommendations/background-refresh.js';
import {
  recommendationOwnerForRollout,
  recommendationsHouseholdOnlyForRollout,
  vodRecommendationsV2Mode,
} from './recommendations/v2-mode.js';
import {
  captureVodRecommendationRevisions,
  createRecommendationRefreshJob,
  recommendationRefreshJobById,
  reconcileInterruptedRecommendationRefreshJobs,
  updateRecommendationRefreshJobs,
  updateRecommendationRefreshJobRuntime,
  type RecommendationRefreshJob,
} from './recommendations/jobs.js';
import {
  householdOnlyMutationError,
  preserveHouseholdMoodClear,
  reconcileHouseholdRecommendationIdentity,
} from './recommendations/household-identity.js';
import { validateOptionalRecommendationMutationAttribution } from './recommendations/mutation-attribution.js';
import { vodBrowseV3Mode } from './recommendations/vod-browse-v3.js';
import { assertCurrentVodRecommendationSource } from './recommendations/source-revision.js';
import {
  setStoryDnaStructuredLookupProvider,
  setStoryGraphLowWaterEnqueueHook,
  storyGraphStartupRefreshRequired,
} from './recommendations/story-graph-service.js';
import { readFreshRecommendationMaintenanceLease } from './recommendations/maintenance.js';
import { CouchPreemptedRecommendationRefreshError } from './recommendations/maintenance.js';
import { enrichStoryDnaInputsWithTmdb } from './recommendations/tmdb-metadata.js';
import { previewStoryEvidence } from './playability/list-source.js';
import { searchCachedYoutubeItems } from './youtube/db.js';
import {
  importYoutubeTakeoutStream,
  invalidateYoutubeV2ExactExclusions,
  primeYoutubeV2ExactExclusions,
  primeYoutubeV2HistoryItems,
  refreshYoutubeV2AfterLocalSignal,
  resolveYoutubeImpressionSourceRevision,
  YoutubeService,
  youtubePublicPersonalizationPayload,
  youtubeRecommendationsV2Mode,
} from './youtube/service.js';
import { rebuildYoutubeV2Generation } from './youtube/v2.js';
import type { YoutubeItemKind } from './youtube/types.js';
import {
  ReliabilityService,
  listPlayabilityRunReceipts,
  sanitizeReliabilityProofMetadata,
  sanitizeReliabilityProofReason,
} from './reliability/service.js';
import { resolvePosterFromMeta, enrichMetaForLauncher, stubMetaForLauncher } from './poster.js';
import {
  flushWatchProgress,
  setRecommendationSignalChangeHook,
  startWatchSessionFromPlay,
} from './progress/watcher.js';
import {
  buildNextPromptResponse,
  takePendingNextPrompt,
} from './progress/next-prompt.js';
import { resolveSeriesPlayTarget } from './series-play.js';
import { buildPlaybackHudContext } from './playback-hud-context.js';
import {
  buildLlmRefreshToolManifest,
  getRefreshLevel,
  listRefreshLevelsForUi,
  startRefreshLevel,
  startRefreshJob,
  resolveRefreshLevelId,
} from './playability/refresh-control.js';
import { playabilityPolicySnapshot } from './playability/policy.js';
import type { GrowPresetId } from './playability/grow-target.js';
import { GROW_PRESETS } from './playability/grow-target.js';
import { parseCatalogTab, loadRailConfig } from './rails.js';
import {
  addUserPin,
  listUserPins,
  removeUserPin,
} from './user-pins.js';
import { isErrorStream } from './stream-filters.js';
import { shouldRefreshCachedTransport } from './play-error-classify.js';
import { isBlockedLiveStreamUrl, probeStreamReachability } from './live-stream-verify.js';
import { playLiveCandidateLadder } from './live/playback-ladder.js';
import {
  parseFilterOverridesFromQuery,
  type StreamFilterOverrides,
} from './stream-filters.js';
import { searchVerifiedLibrary } from './voice/search.js';
import { searchLiveChannels } from './voice/live-search.js';
import { buildContinuePlayTarget, buildNowPlayingResponse } from './voice/now-playing.js';
import { buildAiContextResponse } from './voice/ai-context.js';
import { buildVoiceToolManifest } from './voice/tools.js';
import { buildLibraryCatalog, buildLibraryOverview } from './voice/library.js';
import { readLibrarianNotes, writeLibrarianNotes } from './voice/librarian-notes.js';
import {
  patchProfile,
  profileSummary,
  readProfile,
  type ProfilePatch,
} from './companion/profile.js';
import { appendJournalEvent, listJournalEvents } from './companion/journal.js';
import { compiledNotesExcerpt, readCompiledNotes, writeCompiledNotes } from './companion/compile-notes.js';
import { consolidateCompanionNightly, processLightReflect } from './companion/reflect.js';
import { runCompanionNightly } from './companion/nightly.js';
import { applyCompanionGardener } from './companion/gardener.js';
import { searchExternalTitles } from './voice/external.js';
import { touchCouchActivity } from './couch-activity.js';
import {
  deleteAiCatalog,
  listAiCatalogSummaries,
  updateAiCatalog,
  type CreateAiCatalogInput,
} from './ai-catalogs/service.js';
import {
  createAiCatalogWithBootstrap,
  getBootstrapJob,
  getSlotBootstrapStatus,
  migrateSlotIfEmpty,
  refreshAiCatalogWithMigrate,
} from './ai-catalogs/bootstrap.js';
import type { AiSeedTitle } from './ai-catalogs/types.js';
import { UnifiedSearchService, parseSearchScope } from './search/service.js';
import {
  acceptPlaybackRecommendationAttribution,
  hasRecommendationAttributionIntent,
  isRecommendationPlaybackIdentityCompatible,
} from './recommendations/attribution-request.js';
import {
  assertExpectedPersonalization,
  parseExpectedPersonalization,
  parseExpectedPersonalizationBody,
} from './personalization-request.js';
import {
  ActiveStreamConflictError,
  ActiveStreamService,
} from './active-stream-session.js';

const HOST = process.env.MANGO_CATALOG_HOST || '127.0.0.1';
const PORT = Number(process.env.MANGO_CATALOG_PORT || 3020);
const BODY_LIMIT = 64 * 1024;
const PLAYABILITY_POLICY = playabilityPolicySnapshot();
let activeStreams: ActiveStreamService | null = null;

type PlayBody = StreamFilterOverrides & {
  request_id?: string;
  source?: PlaybackSessionSource;
  /** Durable library identity; playback transport remains `source`. */
  library_source?: string;
  type?: string;
  id?: string;
  title?: string;
  poster?: string;
  year?: string | number;
  description?: string;
  tab?: string;
  rail_id?: string;
  slate_revision?: number;
  attribution_token?: string;
  recommendation_item_type?: string;
  recommendation_item_id?: string;
  /** Captured server-side when an async play session is accepted. */
  recommendation_profile_id?: string;
  expected_profile_id?: string;
  expected_personalization_updated_at?: string | number;
  reason?: string;
  url?: string;
  /** Picker row — prefer this stream in the play ladder. */
  prefer_url?: string;
  /** Ladder step from GET /stream (e.g. 4k_sdr_remux_cached); avoids legacy ideal hint. */
  prefer_ladder_step?: string;
  /** Resume playback at this position (seconds). */
  start_sec?: number;
  /** Lookup saved progress for {type,id} and resume. */
  resume?: boolean;
  /** Live IPTV channel — skip VOD ladder and min-duration probe. */
  live?: boolean;
  language?: string | null;
  level?: string;
  /** Library Grower refresh — alternative to level. */
  mode?: string;
  preset?: string;
  detach?: boolean;
};

function normalizeForExactMatch(value: string): string {
  return value.toLowerCase().trim().replace(/^the\s+/i, '').replace(/\s+/g, ' ');
}

function libraryItemFromRecord(body: Record<string, unknown>): LibraryItemInput | null {
  if (typeof body.type !== 'string' || typeof body.id !== 'string') {
    return null;
  }
  const identity = normalizeLibraryIdentity(
    typeof body.source === 'string' ? body.source : undefined,
    body.type,
  );
  return {
    source: identity.source,
    type: identity.type,
    id: body.id,
    title: typeof body.title === 'string' ? body.title : undefined,
    poster: typeof body.poster === 'string' ? body.poster : undefined,
    year: typeof body.year === 'string' || typeof body.year === 'number' ? body.year : undefined,
    description: typeof body.description === 'string' ? body.description : undefined,
    tab: parseCatalogTab(typeof body.tab === 'string' ? body.tab : null) ?? null,
  };
}

async function resolveLibraryTarget(
  body: Record<string, unknown>,
  core?: CatalogCore,
): Promise<LibraryItemInput> {
  const direct = libraryItemFromRecord(body);
  if (direct) {
    return direct;
  }

  if (body.current === true || body.current_context === true) {
    const current = getLibraryContext();
    if (!current) {
      throw new CatalogError(404, 'no current TV title to save');
    }
    return {
      source: current.source,
      type: current.type,
      id: current.id,
      title: current.title,
      poster: current.poster,
      tab: current.tab,
    };
  }

  if (typeof body.title === 'string' && body.title.trim()) {
    const title = body.title.trim();
    const requestedSource = typeof body.source === 'string' ? body.source : undefined;
    const requestedType = typeof body.type === 'string' ? body.type : undefined;
    if (libraryDomainForItem(requestedSource, requestedType ?? '') === 'youtube') {
      if (requestedType && !isLibrarySaveAllowed(requestedSource, requestedType)) {
        throw new CatalogError(400, 'only YouTube videos can be saved', undefined, {
          couchMessage: 'only YouTube videos can be saved',
        });
      }
      const hits = searchCachedYoutubeItems(title, 12).filter((hit) => {
        if (hit.kind !== 'video') {
          return false;
        }
        return normalizeForExactMatch(hit.title) === normalizeForExactMatch(title);
      });
      if (hits.length !== 1) {
        throw new CatalogError(
          hits.length === 0 ? 404 : 409,
          hits.length === 0
            ? `no exact YouTube cache match for: ${title}`
            : `multiple exact YouTube cache matches for: ${title}`,
        );
      }
      const hit = hits[0];
      const identity = normalizeLibraryIdentity(requestedSource, 'youtube_video');
      return {
        source: identity.source,
        type: identity.type,
        id: hit.id,
        title: hit.title,
        poster: hit.thumbnail,
        description: hit.description,
        tab: 'youtube',
      };
    }
    const type = requestedType
      ? normalizeLibraryIdentity(requestedSource, requestedType).type
      : null;
    const hits = await searchVerifiedLibrary(title, 12, core);
    const exact = hits.filter((hit) => {
      if (type && hit.type !== type) {
        return false;
      }
      return normalizeForExactMatch(hit.title) === normalizeForExactMatch(title);
    });
    if (exact.length !== 1) {
      throw new CatalogError(
        exact.length === 0 ? 404 : 409,
        exact.length === 0
          ? `no exact Mango library match for: ${title}`
          : `multiple exact Mango library matches for: ${title}`,
      );
    }
    const hit = exact[0];
    return {
      type: hit.type,
      id: hit.id,
      title: hit.title,
      poster: hit.poster,
      tab: hit.tab,
    };
  }

  throw new CatalogError(400, 'library target requires {type,id}, {current:true}, or exact {title}');
}

function assertSaveAllowed(target: LibraryItemInput): void {
  if (!isLibrarySaveAllowed(target.source, target.type)) {
    throw new CatalogError(400, 'only YouTube videos can be saved', undefined, {
      couchMessage: 'only YouTube videos can be saved',
    });
  }
}

function libraryTargetDomain(target: LibraryItemInput): 'vod' | 'youtube' {
  return libraryDomainForItem(target.source, target.type);
}

function libraryTargetStateOwner(target: LibraryItemInput, activeProfileId: string): string {
  const tab = libraryTabForItem(target.source, target.type, target.tab);
  if (tab === 'youtube') return recommendationOwnerForRollout('youtube', activeProfileId);
  if (tab === 'movies' || tab === 'series') return recommendationOwnerForRollout('vod', activeProfileId);
  return activeProfileId;
}

function parseYoutubeKind(value: string | null): YoutubeItemKind {
  if (value === 'channel' || value === 'playlist') {
    return value;
  }
  return 'video';
}

function savedPayload(
  tab: ReturnType<typeof parseCatalogTab>,
  limit: number,
  personalization = getPersonalizationState(),
): {
  ok: true;
  tab?: string;
  profile_id: string;
  personalization_updated_at: number;
  saved: ReturnType<typeof listSavedLibraryItems>;
} {
  const dataOwner = tab === 'youtube'
    ? recommendationOwnerForRollout('youtube', personalization.active_profile_id)
    : tab === 'movies' || tab === 'series'
      ? recommendationOwnerForRollout('vod', personalization.active_profile_id)
      : personalization.active_profile_id;
  return {
    ok: true,
    ...(tab ? { tab } : {}),
    profile_id: personalization.active_profile_id,
    personalization_updated_at: personalization.updated_at,
    saved: listSavedLibraryItems(tab, Number.isFinite(limit) ? limit : 100, {
      profile_id: dataOwner,
      household_blend: false,
    }),
  };
}

function filterOverridesFromBody(body: PlayBody): StreamFilterOverrides {
  const overrides: StreamFilterOverrides = {};
  if (body.include_uncached === true) overrides.include_uncached = true;
  if (typeof body.strict_unknown_cache === 'boolean') {
    overrides.strict_unknown_cache = body.strict_unknown_cache;
  }
  if (body.max_quality !== undefined) overrides.max_quality = body.max_quality;
  if (typeof body.exclude_remux === 'boolean') overrides.exclude_remux = body.exclude_remux;
  if (body.min_quality !== undefined) overrides.min_quality = body.min_quality;
  if (body.language !== undefined) {
    overrides.hard_language = typeof body.language === 'string' && body.language.trim() !== ''
      ? body.language.trim()
      : null;
  }
  if (body.hard_language !== undefined) {
    overrides.hard_language = body.hard_language;
  }
  if (body.preferred_language !== undefined) {
    overrides.preferred_language = body.preferred_language;
  }
  return overrides;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res: http.ServerResponse, error: unknown): void {
  if (error instanceof CatalogError) {
    sendJson(res, error.status, {
      error: error.couchMessage,
      ...(error.details || {}),
    });
    return;
  }
  if (error instanceof PlayCancelledError) {
    sendJson(res, 499, { error: 'play cancelled' });
    return;
  }
  sendJson(res, 500, { error: 'catalog temporarily unavailable' });
}

function routeParts(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

function isLocalRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

async function withoutCatalogErrorDetails<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof CatalogError) {
      throw new CatalogError(error.status, error.message, undefined, {
        couchMessage: error.couchMessage,
      });
    }
    throw error;
  }
}

function parseTitleExcludeQuery(raw: string | null): Array<{ type: string; id: string }> {
  if (!raw?.trim()) {
    return [];
  }
  const refs: Array<{ type: string; id: string }> = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }
    const separator = trimmed.indexOf(':');
    if (separator <= 0 || separator >= trimmed.length - 1) {
      continue;
    }
    refs.push({
      type: trimmed.slice(0, separator),
      id: trimmed.slice(separator + 1),
    });
  }
  return refs;
}

async function readBody(req: http.IncomingMessage): Promise<PlayBody> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > BODY_LIMIT) {
      throw new CatalogError(413, 'request body too large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as PlayBody;
}

async function attachWatchSession(
  core: CatalogCore,
  type: string,
  playId: string,
  stream?: {
    profileId?: string;
    releaseFingerprint?: string | null;
    technical?: import('./playback-capability.js').StreamTechnicalProfile | null;
    attribution?: {
      profile_id: string;
      domain: 'vod' | 'youtube';
      rail_id: string;
      slate_revision: number;
      item_type: string;
      item_id: string;
    } | null;
  },
): Promise<void> {
  try {
    const metaId = type === 'series' ? (seriesBareId(playId) || playId) : playId;
    const meta = await core.metaCached(type, metaId);
    await startWatchSessionFromPlay({
      profile_id: stream?.profileId ?? stream?.attribution?.profile_id,
      type,
      id: playId,
      title: typeof meta.name === 'string' ? meta.name : null,
      poster: resolvePosterFromMeta(meta),
      releaseFingerprint: stream?.releaseFingerprint,
      technical: stream?.technical,
      recommendation: stream?.attribution ? {
        profile_id: stream.attribution.profile_id,
        domain: stream.attribution.domain,
        rail_id: stream.attribution.rail_id,
        slate_revision: stream.attribution.slate_revision,
        item_type: stream.attribution.item_type,
        item_id: stream.attribution.item_id,
      } : undefined,
    });
  } catch {
    await startWatchSessionFromPlay({
      profile_id: stream?.profileId ?? stream?.attribution?.profile_id,
      type,
      id: playId,
      releaseFingerprint: stream?.releaseFingerprint,
      technical: stream?.technical,
      recommendation: stream?.attribution ? {
        profile_id: stream.attribution.profile_id,
        domain: stream.attribution.domain,
        rail_id: stream.attribution.rail_id,
        slate_revision: stream.attribution.slate_revision,
        item_type: stream.attribution.item_type,
        item_id: stream.attribution.item_id,
      } : undefined,
    });
  }
}

function recommendationAttributionFromBody<TDomain extends 'vod' | 'youtube'>(
  body: PlayBody,
  domain: TDomain,
): {
  profile_id: string;
  domain: TDomain;
  rail_id: string;
  slate_revision: number;
  item_type: string;
  item_id: string;
} | null {
  // rail_id predates recommendation attribution and is present on ordinary
  // catalog and Search cards. Only an opaque token or served revision opts a
  // request into the recommendation contract; once opted in, every field
  // (including rail_id and card identity) is mandatory and validated below.
  const hasAnyAttribution = hasRecommendationAttributionIntent(body);
  if (!hasAnyAttribution) return null;
  if (!body.rail_id || !body.attribution_token
    || !body.recommendation_item_type || !body.recommendation_item_id
    || !Number.isInteger(body.slate_revision) || (body.slate_revision ?? -1) < 0) {
    throw new CatalogError(409, 'stale or incomplete recommendation slate');
  }
  if (!isRecommendationPlaybackIdentityCompatible(
    { type: body.recommendation_item_type, id: body.recommendation_item_id },
    { type: body.type, id: body.id },
  )) {
    throw new CatalogError(409, 'recommendation card does not match requested playback');
  }
  let served;
  try {
    served = resolveRecommendationServedSlate({
      attribution_token: body.attribution_token,
      domain,
      rail_id: body.rail_id,
      slate_revision: body.slate_revision!,
      item: {
        type: body.recommendation_item_type,
        id: body.recommendation_item_id,
      },
    });
  } catch {
    throw new CatalogError(409, 'this recommendation slate is no longer current');
  }
  if (served.profile_id !== recommendationOwnerForRollout(domain, activeViewerProfileId())) {
    throw new CatalogError(409, 'profile changed; reload recommendations before acting');
  }
  if (domain === 'vod') {
    try {
      assertCurrentVodRecommendationSource(served);
    } catch {
      throw new CatalogError(409, 'this recommendation slate is no longer current');
    }
  }
  return {
    profile_id: served.profile_id,
    domain,
    rail_id: served.rail_id,
    slate_revision: served.slate_revision,
    item_type: body.recommendation_item_type,
    item_id: body.recommendation_item_id,
  };
}

/**
 * Explicit Play of a visible card is user intent. A missing, expired, or
 * incomplete served slate must not block mpv. Mutations stay fail-closed via
 * `recommendationAttributionFromBody` / `validateOptionalRecommendationMutationAttribution`.
 */
function playbackRecommendationAttributionFromBody<TDomain extends 'vod' | 'youtube'>(
  body: PlayBody,
  domain: TDomain,
): ReturnType<typeof recommendationAttributionFromBody<TDomain>> {
  return acceptPlaybackRecommendationAttribution(
    () => recommendationAttributionFromBody(body, domain),
  );
}

type VodRecommendationAttribution = NonNullable<
  ReturnType<typeof recommendationAttributionFromBody<'vod'>>
>;

/** Additive verify-state for the detail/meta page — mirrors voice search's in_library/queued_for_verify shape. */
async function withVerifyStateForLauncher(
  meta: Record<string, unknown>,
  contentType: string,
  contentId: string,
): Promise<Record<string, unknown>> {
  try {
    const playability = await getTitlePlayability(contentType, contentId);
    const { inLibrary, alreadyQueued } = deriveLibraryVerifyState(playability?.status);
    return {
      ...meta,
      in_library: inLibrary,
      queued_for_verify: alreadyQueued,
    };
  } catch {
    return meta;
  }
}

async function handlePlay(
  core: CatalogCore,
  body: PlayBody,
  queryOverrides: StreamFilterOverrides = {},
  deadline: PlayDeadline = createPlayDeadline(),
  requestId: string | null = normalizePlayRequestId(body.request_id),
  onRequestRegistered?: (epoch: number) => void,
  preparedEpoch?: number,
  acceptedAttribution?: VodRecommendationAttribution | null,
): Promise<Record<string, unknown>> {
  // Capture exact resume/history ownership before the first await. Public
  // routes set this explicitly, while direct/internal callers keep the
  // compatibility default of the active profile at acceptance time.
  const playbackProfileId = body.recommendation_profile_id || activeViewerProfileId();
  await activeStreams?.clear().catch((error) => {
    console.warn(
      `active stream cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  let playUrlValue = body.url;

  if (playUrlValue) {
    if (!/^https?:\/\//i.test(playUrlValue)) {
      throw new CatalogError(400, 'play url must be http(s)');
    }
    const started = deadline.startedAtMs;
    const playEpoch = preparedEpoch ?? await bumpPlayEpoch();
    if (preparedEpoch === undefined) {
      registerPlayRequest(requestId, playEpoch);
      onRequestRegistered?.(playEpoch);
      emitPlaybackTelemetry('play_request_start', {
        request_id: requestId,
        epoch: playEpoch,
        total_deadline_ms: deadline.budgetMs,
        resolve_request_class: 'user',
      });
    }
    const startSec = typeof body.start_sec === 'number' && body.start_sec > 0
      ? body.start_sec
      : undefined;
    const remainingMs = remainingPlayBudgetMs(deadline);
    if (remainingMs <= 0) {
      throw new CatalogError(504, 'play deadline exceeded', undefined, {
        couchMessage: 'playback took too long — try again',
      });
    }
    const playback = await playUrl(playUrlValue, remainingMs, {
      startSec,
      playEpoch,
      hud: buildPlaybackHudContext({ ...body, contentId: body.id }),
    });
    await assertPlayEpoch(playEpoch);
    if (body.type && body.id) {
      await assertPlayEpoch(playEpoch);
      await attachWatchSession(core, body.type, body.id, {
        profileId: playbackProfileId,
        attribution: acceptedAttribution,
      });
    }
    return {
      ...playback,
      total_ms: Date.now() - started,
      attempts: 1,
    };
  }

  if (!body.type || !body.id) {
    throw new CatalogError(400, 'POST /play requires {url} or {type,id}');
  }

  const overrides = { ...queryOverrides, ...filterOverridesFromBody(body) };

  if (body.type === 'tv' || body.live === true) {
    const started = deadline.startedAtMs;
    const playEpoch = preparedEpoch ?? await bumpPlayEpoch();
    if (preparedEpoch === undefined) {
      registerPlayRequest(requestId, playEpoch);
      onRequestRegistered?.(playEpoch);
      emitPlaybackTelemetry('play_request_start', {
        request_id: requestId,
        epoch: playEpoch,
        total_deadline_ms: deadline.budgetMs,
        resolve_request_class: 'user',
      });
    }
    const resolved = await core.resolveLiveForPlay(
      body.id,
      body.title,
      deadline.deadlineAtMs,
    );
    const candidates = resolved.streams.filter((candidate) => {
      const url = candidate.url;
      return typeof url === 'string'
        && url.trim() !== ''
        && !isBlockedLiveStreamUrl(url)
        && !isErrorStream(candidate);
    });
    if (candidates.length === 0) {
      throw new CatalogError(502, 'no_playable_stream');
    }
    // Resolve has expanded the logical item into a quality-ordered canonical
    // variant ladder. Reachability remains a cheap preflight; playback-start
    // failure now advances to the next qualified variant within one deadline.
    const probeTimeoutMs = Number(process.env.MANGO_LIVE_PROBE_TIMEOUT_MS ?? 10_000);
    const ladder = await playLiveCandidateLadder(candidates, body.id, {
      remainingMs: () => remainingPlayBudgetMs(deadline),
      probeTimeoutMs,
      probe: probeStreamReachability,
      play: async (url, timeoutMs) => {
        await assertPlayEpoch(playEpoch);
        const result = await playUrl(url, timeoutMs, {
          live: true,
          playEpoch,
          hud: buildPlaybackHudContext({ type: 'tv', title: body.title, contentId: body.id }),
        });
        await assertPlayEpoch(playEpoch);
        return result;
      },
      record: (source, channelId, status, reason) => (
        core.recordLiveSearchOutcome(source, channelId, status, reason)
      ),
      isCancelled: async (error) => (
        error instanceof PlayCancelledError || await isPlayEpochStale(playEpoch)
      ),
    });
    if (!ladder.candidate || !ladder.playback) {
      throw new CatalogError(ladder.exhausted ? 504 : 502, ladder.exhausted
        ? 'play deadline exceeded'
        : 'live_playback_failed', {
        candidate_count: candidates.length,
        attempts: ladder.attempts,
        errors: ladder.errors,
      }, {
        couchMessage: ladder.exhausted
          ? 'playback took too long — try again'
          : 'live stream unavailable — try again',
      });
    }
    const chosenCandidate = ladder.candidate;
    const playback = ladder.playback;
    await assertPlayEpoch(playEpoch);
    try {
      await assertPlayEpoch(playEpoch);
      recordLibraryWatch({
        profile_id: playbackProfileId,
        type: body.type,
        id: body.id,
        title: body.title,
        poster: body.poster,
        year: body.year,
        description: body.description,
        tab: parseCatalogTab(body.tab) ?? 'live',
        event: 'play',
        watched_at: Date.now(),
      });
    } catch (error) {
      console.warn(
        `library live history failed type=${body.type} id=${body.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (playback.ok) {
      await assertPlayEpoch(playEpoch);
      await startWatchSessionFromPlay({
        profile_id: playbackProfileId,
        type: 'tv',
        id: body.id,
        title: body.title ?? null,
        poster: body.poster ?? null,
        tab: 'live',
      });
    }
    return {
      ok: playback.ok,
      live: true,
      ttff_ms: playback.ttff_ms,
      total_ms: Date.now() - started,
      attempts: ladder.attempts,
      play_id: body.id,
      stream: {
        url: chosenCandidate.url,
        source: typeof chosenCandidate?.source === 'string' ? chosenCandidate.source : undefined,
        display_label: 'live',
        resolve_ms: resolved.resolve_ms,
        cached: resolved.cached,
      },
    };
  }

  let playId = body.id;
  let startSec = typeof body.start_sec === 'number' && body.start_sec > 0
    ? body.start_sec
    : undefined;
  const saved = getWatchProgressForTitle(body.type, body.id, {
    profile_id: playbackProfileId,
  });
  const bareSeriesId = body.type === 'series'
    ? (seriesBareId(body.id) || body.id)
    : null;
  const episodeSaved = body.type === 'series' && isSeriesEpisodeId(body.id) && bareSeriesId
    ? getLatestEpisodeWatchProgress(bareSeriesId, body.id, {
      profile_id: playbackProfileId,
    })
    : null;
  const playTarget = resolveSeriesPlayTarget(body.type, body.id, {
    saved,
    episodeSaved,
    resume: body.resume,
    startSec,
  });
  playId = playTarget.playId;
  startSec = playTarget.startSec;

  const playEpoch = preparedEpoch ?? await bumpPlayEpoch();
  if (preparedEpoch === undefined) {
    registerPlayRequest(requestId, playEpoch);
    onRequestRegistered?.(playEpoch);
    emitPlaybackTelemetry('play_request_start', {
      request_id: requestId,
      epoch: playEpoch,
      total_deadline_ms: deadline.budgetMs,
      resolve_request_class: 'user',
    });
  }
  const now = Date.now();
  const usePlayabilityIndex = body.type !== 'series' || isSeriesRailGateId(playId);
  const profile = usePlayabilityIndex
    ? await getTitleVerifyProfile(body.type, playId)
    : null;
  const profileHint = profile?.status === 'verified'
    && (profile.expires_at === null || profile.expires_at > now)
    ? {
      best_source: profile.best_source,
      cache_status: profile.cache_status,
      debrid_service: profile.debrid_service,
      win_url_hash: profile.win_url_hash,
      win_ladder_step: profile.win_ladder_step,
      probe_ms: profile.probe_ms,
    }
    : undefined;
  const verifiedHint = profileHint;

  let resolved: Awaited<ReturnType<CatalogCore['resolveForPlay']>> | null = null;
  const playMode = body.prefer_url ? 'picker' as const : 'auto' as const;
  try {
    resolved = await core.resolveForPlay(body.type, playId, overrides, {
      requestClass: 'user',
      deadlineAtMs: deadline.deadlineAtMs,
      identityHint: { title: body.title, year: body.year },
    });

    const playResolved = () => playWithLadder(resolved!.streams, resolved!.filters, {
      mode: playMode,
      contentType: body.type,
      filterContext: resolved!.filterContext,
      verified_hint: playMode === 'picker' ? undefined : verifiedHint,
      playEpoch,
      startSec,
      preferUrl: body.prefer_url,
      preferLadderStep: body.prefer_ladder_step,
      deadlineAtMs: deadline.deadlineAtMs,
      startedAtMs: deadline.startedAtMs,
      hud: buildPlaybackHudContext({
        ...body,
        contentId: playId,
        episodeTitle: resolved!.filterContext.episodeTitle,
      }),
    });
    let playback;
    try {
      playback = await playResolved();
    } catch (firstError) {
      const firstDetails = firstError instanceof CatalogError
        ? firstError.details as { attempts?: Array<{ error?: string }> } | undefined
        : undefined;
      const attemptErrors = (firstDetails?.attempts || [])
        .map((attempt) => attempt.error || '')
        .filter(Boolean);
      const refreshTransport = playMode === 'auto'
        && resolved.cached
        && remainingPlayBudgetMs(deadline) >= 5000
        && shouldRefreshCachedTransport(attemptErrors);
      if (!refreshTransport) throw firstError;

      core.invalidateStreams(body.type, playId);
      emitPlaybackTelemetry('stream_transport_refresh', {
        request_id: requestId,
        epoch: playEpoch,
        content_type: body.type,
        stale_attempts: attemptErrors.length,
      });
      await assertPlayEpoch(playEpoch);
      resolved = await core.resolveForPlay(body.type, playId, overrides, {
        requestClass: 'user',
        deadlineAtMs: deadline.deadlineAtMs,
        identityHint: { title: body.title, year: body.year },
      });
      playback = await playResolved();
    }

    await assertPlayEpoch(playEpoch);
    const identityCertifiable = resolved.filterContext.identityCertifiable !== false;

    try {
      if (identityCertifiable) {
        await reconcileSuccessfulEpisodePlayability({
          contentType: body.type,
          playId,
          playMode,
          usePlayabilityIndex,
          identityCertifiable,
          playEpoch,
          playback,
        });
      }
    } catch (writeError) {
      if (writeError instanceof PlayCancelledError) {
        throw writeError;
      }
      console.warn(
        `episode playability refresh on play failed type=${body.type} id=${playId}: ${
          writeError instanceof Error ? writeError.message : String(writeError)
        }`,
      );
    }
    await assertPlayEpoch(playEpoch);

    const firstTimeVerified = isFirstTimeVerifiedPromotion(
      usePlayabilityIndex,
      typeof profile?.first_verified_at === 'number',
    );
    if (identityCertifiable && usePlayabilityIndex && playMode === 'auto') {
      if (playback.win_on_main) {
        await assertPlayEpoch(playEpoch);
        await recordVerifyResult({
          type: body.type,
          id: playId,
          status: 'verified',
          rail_id: body.rail_id ?? null,
          best_source: typeof playback.stream.source === 'string' ? playback.stream.source : null,
          cache_status: typeof playback.stream.cache_status === 'string' ? playback.stream.cache_status : null,
          debrid_service: typeof playback.stream.debrid_service === 'string' ? playback.stream.debrid_service : null,
          probe_ms: playback.probe_ms,
          win_url_hash: playback.win_url_hash,
          win_ladder_step: playback.win_ladder_step,
          expires_at: Date.now() + playabilityVerifyTtlMs(),
          stage: 'play',
          outcome: 'verified',
          proof_version: 2,
          exact_main_win: true,
          run_id: process.env.MANGO_OPS_RUN_ID ?? null,
          request_id: requestId || null,
          request_title_id: playId,
          request_title: body.title ?? null,
          request_year: body.year ?? null,
          source_key: typeof playback.stream.source === 'string' ? playback.stream.source : null,
          attempt_kind: 'main',
        }).catch((writeError) => {
          console.warn(
            `playability refresh on play failed type=${body.type} id=${body.id}: ${
              writeError instanceof Error ? writeError.message : String(writeError)
            }`,
          );
        });
        await assertPlayEpoch(playEpoch);
        await assignVerifiedTitleToBestRail(core, {
          type: body.type,
          id: playId,
          preferredRailId: body.rail_id ?? null,
        }).catch((assignError) => {
          console.warn(
            `playability rail assign on play failed type=${body.type} id=${body.id}: ${
              assignError instanceof Error ? assignError.message : String(assignError)
            }`,
          );
        });
      } else {
        // Q3B: last-resort / floor win → stale (playback-only); keep rail visibility.
        await assertPlayEpoch(playEpoch);
        await demoteTitle({
          rail_id: body.rail_id ?? null,
          type: body.type,
          id: playId,
          reason: 'last_resort_play',
        }).catch((demoteError) => {
          console.warn(
            `playability stale on last-resort play failed type=${body.type} id=${body.id}: ${
              demoteError instanceof Error ? demoteError.message : String(demoteError)
            }`,
          );
        });
      }
    }

    await assertPlayEpoch(playEpoch);
    await attachWatchSession(core, body.type, playId, {
      profileId: playbackProfileId,
      releaseFingerprint: playback.win_url_hash,
      technical: playback.technical,
      attribution: acceptedAttribution,
    });
    if (activeStreams) {
      await activeStreams.register({
        sessionId: requestId || `play-${playEpoch}`,
        playEpoch,
        contentType: body.type,
        contentId: playId,
        title: body.title ?? null,
        hud: buildPlaybackHudContext({
          ...body,
          contentId: playId,
          episodeTitle: resolved.filterContext.episodeTitle,
        }),
        streams: resolved.streams,
        config: resolved.filters,
        filterContext: resolved.filterContext,
        currentFingerprint: playback.win_url_hash,
        currentTechnical: playback.technical,
        resolveFresh: async () => {
          core.invalidateStreams(body.type!, playId);
          const refreshed = await core.resolveForPlay(body.type!, playId, overrides, {
            requestClass: 'user',
            deadlineAtMs: Date.now() + 30_000,
            zeroStreamRetryAttempts: 0,
            zeroStreamRetryDelayMs: 0,
            identityHint: { title: body.title, year: body.year },
          });
          return refreshed.streams;
        },
      }).catch((error) => {
        console.warn(
          `active stream registration failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }

    return {
      ok: playback.ok,
      ttff_ms: playback.ttff_ms,
      total_ms: playback.total_ms,
      attempts: playback.attempts.length,
      candidate_count: playback.candidate_count,
      win_ladder_step: playback.win_ladder_step,
      play_id: playId,
      resolved_from: playTarget.resolved_from,
      stream: {
        ...playback.stream,
        resolve_ms: resolved.resolve_ms,
        cached: resolved.cached,
      },
      filters: {
        applied: resolved.filters,
        play_ladder: resolved.filters.play_ladder.map((step) => step.step),
      },
      ...(identityCertifiable && firstTimeVerified && playback.win_on_main
        ? { first_time_verified: true }
        : {}),
    };
  } catch (error) {
    if (error instanceof PlayCancelledError) {
      throw new CatalogError(499, 'play cancelled');
    }
    if (await isPlayEpochStale(playEpoch)) {
      throw new CatalogError(499, 'play cancelled');
    }
    const details = error instanceof CatalogError
      ? (error.details as {
        attempts?: unknown[];
        candidates?: number;
        obligation_floor_ran?: boolean;
      } | undefined)
      : undefined;
    const attempts = details?.attempts;
    const obligationFloorRan = details?.obligation_floor_ran === true;
    const isNoPlayableStream = error instanceof CatalogError && error.message === 'no_playable_stream';

    if (!usePlayabilityIndex) {
      try {
        const episodeAction = await reconcileFailedEpisodePlayability({
          contentType: body.type,
          playId,
          playMode,
          usePlayabilityIndex,
          playEpoch,
          isNoPlayableStream,
          attempts,
          candidates: details?.candidates,
          obligationFloorRan,
        });
        if (episodeAction === 'failed') {
          core.invalidateStreams(body.type, playId);
        }
      } catch (writeError) {
        if (writeError instanceof PlayCancelledError) {
          throw new CatalogError(499, 'play cancelled');
        }
        console.warn(
          `episode playability failure reconcile failed type=${body.type} id=${playId}: ${
            writeError instanceof Error ? writeError.message : String(writeError)
          }`,
        );
      }
    }

    if (usePlayabilityIndex && isNoPlayableStream) {
      const prior = await getTitlePlayability(body.type, playId).catch(() => null);
      const policyInput = {
        isNoPlayableStream: true,
        attempts,
        candidates: details?.candidates,
        obligationFloorRan,
        priorFailReason: prior?.fail_reason ?? null,
        priorUpdatedAt: prior?.updated_at ?? null,
        nowMs: Date.now(),
      };
      const confirmFailure = shouldConfirmPlayFailure(policyInput);
      const demote = !confirmFailure && shouldDemoteAfterPlayError(policyInput);

      if (confirmFailure) {
        await assertPlayEpoch(playEpoch);
        core.invalidateStreams(body.type, playId);
        await invalidateTitle({
          rail_id: body.rail_id,
          type: body.type,
          id: playId,
          reason: 'play_failure',
        }).catch((invalidateError) => {
          console.warn(
            `playability invalidate failed type=${body.type} id=${body.id}: ${
              invalidateError instanceof Error ? invalidateError.message : String(invalidateError)
            }`,
          );
        });
        core.reshufflePlayabilitySession();
      } else if (demote) {
        await assertPlayEpoch(playEpoch);
        await demoteTitle({
          rail_id: body.rail_id,
          type: body.type,
          id: playId,
          reason: 'play_miss',
        }).catch((demoteError) => {
          console.warn(
            `playability demote failed type=${body.type} id=${body.id}: ${
              demoteError instanceof Error ? demoteError.message : String(demoteError)
            }`,
          );
        });
      }

      // Always enqueue fast-lane background reverify on couch miss (even transient).
      await assertPlayEpoch(playEpoch);
      await enqueuePlayabilityTrigger({
        trigger_type: 'play_failure_reverify',
        rail_id: body.rail_id,
        type: body.type,
        id: playId,
        reason: confirmFailure ? 'play_failure' : demote ? 'play_miss' : 'play_retry',
      }).catch((enqueueError) => {
        console.warn(
          `playability fast-lane enqueue failed type=${body.type} id=${body.id}: ${
            enqueueError instanceof Error ? enqueueError.message : String(enqueueError)
          }`,
        );
      });
    }
    if (error instanceof CatalogError) {
      if (error.message === 'no_playable_stream') {
        error.couchMessage = couchPlayFailureMessage(
          details?.attempts as Array<{ error?: string; debrid_service?: unknown }> | undefined,
          { candidates: details?.candidates },
        );
      }
      error.details = {
        ...(error.details || {}),
        ...(resolved
          ? {
            filters: {
              applied: resolved.filters,
              play_ladder: resolved.filters.play_ladder.map((step) => step.step),
            },
          }
          : {}),
      };
    }
    throw error;
  }
}

const playbackSessionStarts = new Map<string, Promise<Awaited<ReturnType<typeof createPlaybackSession>>>>();

function playbackSessionErrorMessage(error: unknown): string {
  if (error instanceof CatalogError) return error.couchMessage;
  if (error instanceof PlayCancelledError) return 'play cancelled';
  return 'could not start playback — try again';
}

function playbackTerminalFailure(
  error: unknown,
  cancelled: boolean,
): { failureClass: string; stage: string } {
  if (cancelled) return { failureClass: 'cancelled', stage: 'session' };
  if (error instanceof CatalogError) {
    if (error.message === 'no_playable_stream') {
      return {
        failureClass: 'no_stream',
        stage: noPlayableStreamTerminalStage(error.details),
      };
    }
    if (error.status === 504 || /deadline/i.test(error.message)) {
      return { failureClass: 'deadline', stage: 'play_start' };
    }
    if (error.status === 409) {
      return { failureClass: 'ownership', stage: 'session' };
    }
    if (error.status >= 500) {
      return { failureClass: 'provider', stage: 'resolve' };
    }
  }
  return { failureClass: 'unknown', stage: 'play_start' };
}

function playbackTerminalResult(result: Record<string, unknown>): {
  resolveMs: unknown;
  attempts: unknown;
  candidateCount: unknown;
  exactMain: unknown;
  cached: unknown;
} {
  const stream = result.stream && typeof result.stream === 'object'
    ? result.stream as Record<string, unknown>
    : {};
  const filters = result.filters && typeof result.filters === 'object'
    ? result.filters as Record<string, unknown>
    : {};
  const applied = filters.applied && typeof filters.applied === 'object'
    ? filters.applied as Record<string, unknown>
    : {};
  const mainLadder = Array.isArray(applied.main_ladder) ? applied.main_ladder : [];
  const winLadderStep = typeof result.win_ladder_step === 'string'
    ? result.win_ladder_step
    : null;
  const exactMain = winLadderStep === null
    ? null
    : mainLadder.some((entry) => (
      entry && typeof entry === 'object'
      && (entry as Record<string, unknown>).step === winLadderStep
    ));
  return {
    resolveMs: stream.resolve_ms,
    attempts: result.attempts,
    candidateCount: result.candidate_count,
    exactMain,
    cached: stream.cached,
  };
}

async function startPlaybackSession(
  core: CatalogCore,
  youtube: YoutubeService,
  body: PlayBody,
  queryOverrides: StreamFilterOverrides,
  expectedPersonalization: ReturnType<typeof parseExpectedPersonalizationBody>,
): Promise<Awaited<ReturnType<typeof createPlaybackSession>>> {
  const requestId = normalizePlayRequestId(body.request_id);
  if (!requestId) {
    throw new CatalogError(400, 'POST /play-session requires a valid request_id');
  }
  assertExpectedPersonalization(
    expectedPersonalization,
    getPersonalizationState(),
    'before playback ownership captured',
  );
  // Profile switching can happen from the companion while resolution is in
  // flight. Capture ownership at acceptance so the eventual outcome cannot be
  // credited to whichever profile happens to be active minutes later.
  const acceptedYoutubeAttribution = body.source === 'youtube'
    ? playbackRecommendationAttributionFromBody(body, 'youtube')
    : null;
  const acceptedVodAttribution = body.source === 'youtube'
    ? null
    : playbackRecommendationAttributionFromBody(body, 'vod');
  body.recommendation_profile_id = acceptedYoutubeAttribution?.profile_id
    ?? acceptedVodAttribution?.profile_id
    ?? recommendationOwnerForRollout(
      body.source === 'youtube' ? 'youtube' : 'vod',
      expectedPersonalization?.active_profile_id ?? activeViewerProfileId(),
    );
  const existing = await getPlaybackSession(requestId);
  assertExpectedPersonalization(
    expectedPersonalization,
    getPersonalizationState(),
    'before playback session reused',
  );
  if (existing) {
    return { session: existing, created: false };
  }
  const joining = playbackSessionStarts.get(requestId);
  if (joining) return joining;

  const starting = (async () => {
    const deadline = createPlayDeadline();
    assertExpectedPersonalization(
      expectedPersonalization,
      getPersonalizationState(),
      'before playback epoch advanced',
    );
    const playEpoch = await bumpPlayEpoch();
    assertExpectedPersonalization(
      expectedPersonalization,
      getPersonalizationState(),
      'before playback session created',
    );
    registerPlayRequest(requestId, playEpoch);
    emitPlaybackTelemetry('play_request_start', {
      request_id: requestId,
      epoch: playEpoch,
      total_deadline_ms: deadline.budgetMs,
      resolve_request_class: 'user',
      session_async: true,
    });
    const source: PlaybackSessionSource = body.source === 'youtube' ? 'youtube' : 'catalog';
    const emitTerminal = createPlayRequestTerminalEmitter({
      requestId,
      epoch: playEpoch,
      contentType: source === 'youtube' ? 'youtube' : body.type,
      startedAtMs: deadline.startedAtMs,
    });
    let created: Awaited<ReturnType<typeof createPlaybackSession>>;
    try {
      created = await createPlaybackSession({
        requestId,
        epoch: playEpoch,
        source,
        contentType: body.type,
        contentId: body.id,
        title: body.title,
      });
    } catch (error) {
      const failure = playbackTerminalFailure(error, false);
      emitTerminal('failed_before_frame', failure);
      finishPlayRequest(requestId, playEpoch, false);
      throw error;
    }
    if (!created.created) return created;

    void (async () => {
      let succeeded = false;
      let terminalOutcome: PlayRequestTerminalOutcome = 'failed_before_frame';
      let terminalFields: PlayRequestTerminalDetails = {};
      try {
        await transitionPlaybackSession(requestId, 'resolving');
        if (source === 'youtube') {
          await activeStreams?.clear().catch((error) => {
            console.warn(
              `active stream cleanup failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
        }
        const result = source === 'youtube'
          ? await youtube.play({
            profile_id: body.recommendation_profile_id,
            id: body.id,
            title: body.title,
            poster: body.poster,
            library_source: body.library_source,
            recommendation: acceptedYoutubeAttribution ?? undefined,
          }, { playEpoch })
          : await handlePlay(
            core,
            body,
            queryOverrides,
            deadline,
            requestId,
            undefined,
            playEpoch,
            acceptedVodAttribution,
          );
        succeeded = true;
        terminalOutcome = 'playing';
        terminalFields = {
          stage: 'play_start',
          ...playbackTerminalResult(result),
        };
        await transitionPlaybackSession(requestId, 'playing', {
          result,
          error: null,
        });
      } catch (error) {
        const cancelled = error instanceof PlayCancelledError
          || (error instanceof CatalogError && error.status === 499)
          || await isPlayEpochStale(playEpoch);
        terminalOutcome = cancelled ? 'cancelled' : 'failed_before_frame';
        terminalFields = playbackTerminalFailure(error, cancelled);
        await transitionPlaybackSession(
          requestId,
          cancelled ? 'cancelled' : 'failed_before_frame',
          { error: cancelled ? null : playbackSessionErrorMessage(error) },
        );
      } finally {
        emitTerminal(terminalOutcome, terminalFields);
        finishPlayRequest(requestId, playEpoch, succeeded);
      }
    })();
    return created;
  })().finally(() => {
    playbackSessionStarts.delete(requestId);
  });
  playbackSessionStarts.set(requestId, starting);
  return starting;
}

async function main(): Promise<void> {
  await backupLibraryDbBeforeFireWaterMigration();
  initLibraryDb();
  const recommendationsHouseholdOnly = recommendationsHouseholdOnlyForRollout;
  reconcileInterruptedRecommendationRefreshJobs();
  reconcileHouseholdRecommendationIdentity(recommendationsHouseholdOnly());
  await initProgressDb();
  const core = await CatalogCore.create();
  setStoryDnaStructuredLookupProvider(async (inputs) => {
    const output: typeof inputs[number][] = [];
    let cursor = 0;
    const workerCount = Math.min(4, inputs.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < inputs.length) {
        const input = inputs[cursor];
        cursor += 1;
        if (!input) continue;
        try {
          const meta = await core.meta(input.type, input.id);
          const evidence = previewStoryEvidence(meta, input.id);
          output.push({
            ...input,
            synopsis: evidence.synopsis,
            genres: evidence.genres,
            keywords: evidence.keywords,
            languages: evidence.languages,
            countries: evidence.countries,
            runtime_minutes: evidence.runtime_minutes || null,
            release_state: evidence.release_state,
            format: evidence.format,
            cast: evidence.cast,
            characters: evidence.characters,
            directors: evidence.directors,
            writers: evidence.writers,
            awards_certification: [evidence.awards, evidence.certification]
              .filter((value): value is string => Boolean(value)),
            external_ids: evidence.external_ids,
            source: 'structured-addon-meta',
            evidence_sources: ['structured-addon-meta'],
            lookup_used: true,
          });
        } catch {
          // Selective lookup is optional and item-scoped. A failed addon lookup
          // leaves the original canonical evidence eligible for teacher retry.
        }
      }
    });
    await Promise.all(workers);
    const addonByKey = new Map(output.map((input) => [`${input.type}:${input.id}`, input]));
    const merged = inputs.map((input) => addonByKey.get(`${input.type}:${input.id}`) ?? input);
    return enrichStoryDnaInputsWithTmdb(merged);
  });
  const pendingRecommendationJobs = new Map<string, string[]>();
  const activeRecommendationJobs = new Map<string, string[]>();
  const pendingRecommendationReasons = new Map<string, string[]>();
  const activeRecommendationReasons = new Map<string, string[]>();
  const recommendationWorkKey = (profileId: string, tab: 'movies' | 'series'): string => (
    `${profileId}\u0000${tab}`
  );
  const createRecommendationRefreshQueue = (ownedTab: 'movies' | 'series') => new CoalescingRecommendationRefreshQueue({
    shouldRetry: (error, failedAttempts, maxRetries) => (
      !(error instanceof CouchPreemptedRecommendationRefreshError) && failedAttempts <= maxRetries
    ),
    refresh: async ({ profile_id: profileId, tab }) => {
      if (tab !== ownedTab) throw new Error(`recommendation worker ${ownedTab} received ${tab}`);
      const key = recommendationWorkKey(profileId, tab);
      let jobIds = activeRecommendationJobs.get(key);
      if (!jobIds) {
        jobIds = pendingRecommendationJobs.get(key) ?? [];
        pendingRecommendationJobs.delete(key);
        activeRecommendationJobs.set(key, jobIds);
        activeRecommendationReasons.set(key, pendingRecommendationReasons.get(key) ?? ['refresh']);
        pendingRecommendationReasons.delete(key);
        updateRecommendationRefreshJobs(jobIds, 'running');
      }
      const result = await refreshForYou(tab, {
        profile_id: profileId,
        trigger_reasons: activeRecommendationReasons.get(key) ?? ['refresh'],
        job_ids: jobIds,
      });
      if (jobIds.length > 0) {
        updateRecommendationRefreshJobs(jobIds.slice(0, 1), 'complete');
        updateRecommendationRefreshJobs(jobIds.slice(1), 'coalesced');
      }
      activeRecommendationJobs.delete(key);
      activeRecommendationReasons.delete(key);
      return result;
    },
    onPublished: (work) => {
      core.invalidateRecommendationTab(work.tab);
      core.scheduleVodBrowseReservoirRefresh(work.tab);
    },
    onRetainedLastGood: (work, error, willRetry) => {
      if (error instanceof CouchPreemptedRecommendationRefreshError) {
        const key = recommendationWorkKey(work.profile_id, work.tab);
        const jobIds = activeRecommendationJobs.get(key) ?? [];
        updateRecommendationRefreshJobs(jobIds, 'coalesced', error);
        activeRecommendationJobs.delete(key);
        activeRecommendationReasons.delete(key);
        const delay = Math.max(10_000, Math.min(
          10 * 60_000,
          Number.parseInt(process.env.MANGO_RECOMMENDATION_COUCH_RETRY_MS ?? '', 10) || 60_000,
        ));
        const timer = setTimeout(() => {
          void queueRecommendationRefresh(
            [work.tab],
            work.profile_id,
            ['couch_preempted_resume'],
          ).then((successors) => {
            updateRecommendationRefreshJobRuntime(jobIds, {
              successor_job_id: successors[0]?.job_id ?? null,
              error_code: 'couch_preempted',
            });
          });
        }, delay);
        timer.unref?.();
        console.warn(`recommendation refresh yielded ${work.tab} to couch activity; successor queued after idle delay`);
        return;
      }
      if (!willRetry) {
        const key = recommendationWorkKey(work.profile_id, work.tab);
        updateRecommendationRefreshJobs(activeRecommendationJobs.get(key) ?? [], 'failed', error);
        activeRecommendationJobs.delete(key);
        activeRecommendationReasons.delete(key);
      }
      console.warn(`recommendation background refresh retained last-good ${work.tab} snapshot for ${work.profile_id}${
        willRetry ? ' and will retry' : ''}: ${error instanceof Error ? error.message : String(error)}`);
    },
  });
  const recommendationRefreshQueues = {
    movies: createRecommendationRefreshQueue('movies'),
    series: createRecommendationRefreshQueue('series'),
  };
  const queueRecommendationRefresh = async (
    tabs: readonly ('movies' | 'series')[],
    profileId = recommendationOwnerForRollout('vod', activeViewerProfileId()),
    triggerReasons: readonly string[] = ['signal_change'],
    captured: Record<string, string | number | null> = {},
  ): Promise<RecommendationRefreshJob[]> => {
    const corpusGeneration = typeof captured.corpus_generation === 'number'
      ? captured.corpus_generation
      : await playabilityRecommendationCorpusGeneration().catch(() => null);
    const jobs = tabs.map((tab) => createRecommendationRefreshJob({
      domain: 'vod',
      content_type: tab === 'movies' ? 'movie' : 'series',
      trigger_reasons: triggerReasons,
      captured_revisions: {
        ...captureVodRecommendationRevisions(tab, {
          corpus_generation: corpusGeneration,
        }),
        ...captured,
      },
    }));
    jobs.forEach((job, index) => {
      const key = recommendationWorkKey(profileId, tabs[index]!);
      pendingRecommendationJobs.set(key, [
        ...(pendingRecommendationJobs.get(key) ?? []),
        job.job_id,
      ]);
      pendingRecommendationReasons.set(key, [...new Set([
        ...(pendingRecommendationReasons.get(key) ?? []),
        ...job.trigger_reasons,
      ])].sort());
    });
    tabs.forEach((tab) => recommendationRefreshQueues[tab].enqueue(profileId, [tab]));
    return jobs;
  };
  setStoryGraphLowWaterEnqueueHook((request) => (
    queueRecommendationRefresh(
      [request.tab],
      recommendationOwnerForRollout('vod', activeViewerProfileId()),
      ['low_water_replenishment'],
      { rank_generation: request.rank_generation_id },
    ).then(() => undefined)
  ));
  // Explicit ratings are not a prerequisite: Household Saved/watch evidence
  // can warm the progressive ranker from neutral priors. A restart does not,
  // however, justify repeating a complete current full-corpus refresh.
  if (vodRecommendationsV2Mode() !== 'off') {
    const startupTabs = (await Promise.all((['movies', 'series'] as const).map(async (tab) => (
      await storyGraphStartupRefreshRequired(tab) ? tab : null
    )))).filter((tab): tab is 'movies' | 'series' => tab !== null);
    if (startupTabs.length > 0) {
      await queueRecommendationRefresh(
        startupTabs,
        recommendationOwnerForRollout('vod', activeViewerProfileId()),
        ['service_startup'],
      );
    }
  }
  // Eligibility publication is independent of ranking/provider acquisition.
  // Reconcile algorithm or theme-policy revisions after every service start so
  // serve mode can atomically promote a deep index without a recommendation refresh.
  if (vodBrowseV3Mode() !== 'off') {
    core.scheduleVodBrowseReservoirRefresh('movies');
    core.scheduleVodBrowseReservoirRefresh('series');
  }
  core.startLiveRailsBackgroundRefresh();
  activeStreams = new ActiveStreamService();
  await activeStreams.clear().catch((error) => {
    console.warn(
      `active stream startup cleanup failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  });
  // H1(b): no-ops unless MANGO_TRIGGER_CONSUMER=1 — bounded, idle-gated, debounced (couch safety).
  startTriggerConsumerBackgroundTick(core);
  const youtube = new YoutubeService();
  // Move the potentially multi-thousand-row exclusion read to catalog startup.
  // Cached Home/X remains database- and provider-free afterward.
  primeYoutubeV2ExactExclusions();
  primeYoutubeV2HistoryItems();
  setRecommendationSignalChangeHook((change) => {
    if (change.stage === 'play') return;
    if (change.type === 'youtube_video') {
      void refreshYoutubeV2AfterLocalSignal({
        reason: 'meaningful_watch',
        service: youtube,
        wait_for_acquisition: false,
      }).catch((error) => console.warn(`YouTube v2 local signal refresh retained last-good: ${
        error instanceof Error ? error.message : String(error)}`));
      return;
    }
    // A qualifying VOD watch is an exact v2 exclusion immediately, before the
    // coalesced Story Graph worker publishes its replacement generation.
    const tab = change.type === 'series' ? 'series' : 'movies';
    core.invalidateRecommendationTab(tab);
    void queueRecommendationRefresh(
      [tab],
      recommendationOwnerForRollout('vod', change.profile_id),
      [change.stage === 'completed' ? 'watch_completion' : 'meaningful_watch'],
    ).catch((error) => console.warn(`recommendation watch refresh enqueue failed: ${
      error instanceof Error ? error.message : String(error)
    }`));
  });
  const search = new UnifiedSearchService(core, youtube);
  const reliability = new ReliabilityService({
    catalogHealth: () => core.health(),
    playabilityStatus: () => core.playabilityStatus(),
    activePlayabilityRailIds: () => core.growableRails().map((rail) => rail.id),
    youtubeState: () => youtube.state(),
  });
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      const parts = routeParts(url);

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'state') {
        sendJson(res, 200, await search.state());
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'suggestions') {
        const query = url.searchParams.get('q') || '';
        const scope = parseSearchScope(url.searchParams.get('scope'));
        const limit = Number(url.searchParams.get('limit') || 9);
        sendJson(res, 200, {
          ok: true,
          query,
          scope,
          suggestions: await search.suggestions(query, scope, Number.isFinite(limit) ? limit : 9),
        });
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'query') {
        const body = await readBody(req) as Record<string, unknown>;
        if (body.diagnostic === true && !isLocalRequest(req)) {
          throw new CatalogError(403, 'diagnostic search is localhost-only');
        }
        const query = typeof body.query === 'string' ? body.query : '';
        const snapshot = await search.startQuery({
          query,
          scope: parseSearchScope(body.scope),
          diagnostic: body.diagnostic === true,
        });
        sendJson(res, 202, snapshot);
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'search' && parts[1] === 'query') {
        const afterRevision = Number(url.searchParams.get('after_revision') || 0);
        const waitMs = Number(url.searchParams.get('wait_ms') || 0);
        const snapshot = await search.waitForSnapshot(
          parts[2],
          Number.isFinite(afterRevision) ? afterRevision : 0,
          Number.isFinite(waitMs) ? waitMs : 0,
        );
        if (!snapshot) throw new CatalogError(404, 'search session not found');
        sendJson(res, 200, snapshot);
        return;
      }

      if (req.method === 'POST' && parts.length === 4
        && parts[0] === 'search' && parts[1] === 'query' && parts[3] === 'cancel') {
        sendJson(res, 200, { ok: true, cancelled: search.cancel(parts[2]) });
        return;
      }

      if (req.method === 'POST' && parts.length === 5
        && parts[0] === 'search' && parts[1] === 'query'
        && parts[3] === 'youtube' && parts[4] === 'retry') {
        if (!isLocalRequest(req)) throw new CatalogError(403, 'search retry is localhost-only');
        const snapshot = await search.retryYoutube(parts[2]);
        if (!snapshot) throw new CatalogError(404, 'search session not found');
        sendJson(res, 200, snapshot);
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'selection') {
        const body = await readBody(req) as Record<string, unknown>;
        const required = ['normalized_query', 'key', 'source', 'type', 'id', 'title'] as const;
        if (required.some((key) => typeof body[key] !== 'string' || !String(body[key]).trim())) {
          throw new CatalogError(400, 'search selection requires query, key, source, type, id, and title');
        }
        search.recordSelection(body as {
          normalized_query: string;
          key: string;
          source: string;
          type: string;
          id: string;
          title: string;
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && parts.length === 3
        && parts[0] === 'search' && parts[1] === 'external' && parts[2] === 'queue') {
        if (!isLocalRequest(req)) throw new CatalogError(403, 'search queue is localhost-only');
        const body = await readBody(req) as Record<string, unknown>;
        const type = body.type === 'series' ? 'series' : body.type === 'movie' ? 'movie' : null;
        if (!type || typeof body.id !== 'string' || typeof body.title !== 'string') {
          throw new CatalogError(400, 'search queue requires movie|series type, id, and title');
        }
        sendJson(res, 200, {
          ok: true,
          ...await search.queueUnavailableExternal({
            type,
            id: body.id,
            title: body.title,
            poster: typeof body.poster === 'string' ? body.poster : undefined,
            year: typeof body.year === 'string' || typeof body.year === 'number'
              ? String(body.year)
              : undefined,
          }),
        });
        return;
      }

      if (req.method === 'DELETE' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'history') {
        if (!isLocalRequest(req)) throw new CatalogError(403, 'search history is localhost-only');
        sendJson(res, 200, { ok: true, cleared: search.clearActivity() });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'preferences') {
        sendJson(res, 200, { ok: true, preferences: search.preferences() });
        return;
      }

      if (req.method === 'PUT' && parts.length === 2 && parts[0] === 'search' && parts[1] === 'preferences') {
        if (!isLocalRequest(req)) throw new CatalogError(403, 'search preferences are localhost-only');
        const body = await readBody(req) as Record<string, unknown>;
        const safeSearch = body.youtube_safe_search;
        if (safeSearch !== 'moderate' && safeSearch !== 'strict' && safeSearch !== 'none') {
          throw new CatalogError(400, 'youtube_safe_search must be moderate, strict, or none');
        }
        sendJson(res, 200, {
          ok: true,
          preferences: search.setPreferences(safeSearch),
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'pins') {
        const tab = parseCatalogTab(url.searchParams.get('tab'));
        if (!tab) {
          throw new CatalogError(400, 'GET /pins requires tab=movies|series|live');
        }
        const pins = await listUserPins(tab);
        sendJson(res, 200, { ok: true, tab, pins });
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'pins') {
        const body = await readBody(req) as Record<string, unknown>;
        const tab = parseCatalogTab(typeof body.tab === 'string' ? body.tab : null);
        if (!tab || !body.type || !body.id) {
          throw new CatalogError(400, 'POST /pins requires { tab, type, id }');
        }
        const pin = await addUserPin({
          tab,
          type: String(body.type),
          id: String(body.id),
          title: typeof body.title === 'string' ? body.title : undefined,
          poster: typeof body.poster === 'string' ? body.poster : undefined,
        });
        core.clearRailItemsCache();
        sendJson(res, 200, { ok: true, pin });
        return;
      }

      if (req.method === 'DELETE' && parts.length === 1 && parts[0] === 'pins') {
        const body = await readBody(req) as Record<string, unknown>;
        const tab = parseCatalogTab(typeof body.tab === 'string' ? body.tab : null);
        if (!tab || !body.type || !body.id) {
          throw new CatalogError(400, 'DELETE /pins requires { tab, type, id }');
        }
        const removed = await removeUserPin({
          tab,
          type: String(body.type),
          id: String(body.id),
        });
        core.clearRailItemsCache();
        sendJson(res, 200, { ok: true, removed });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'state') {
        const current = url.searchParams.get('current') === '1'
          || url.searchParams.get('current') === 'true';
        if (current) {
          const context = getLibraryContext();
          if (!context) {
            sendJson(res, 200, { ok: true, current: null, state: null });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            current: context,
            state: getLibraryState({
              source: context.source,
              type: context.type,
              id: context.id,
              profile_id: libraryTargetStateOwner(context, activeViewerProfileId()),
            }),
          });
          return;
        }
        const type = url.searchParams.get('type')?.trim() ?? '';
        const id = url.searchParams.get('id')?.trim() ?? '';
        if (!type || !id) {
          throw new CatalogError(400, 'GET /library/state requires type and id, or current=true');
        }
        const source = url.searchParams.get('source') || undefined;
        const stateOwner = libraryTargetStateOwner({ source, type, id }, activeViewerProfileId());
        sendJson(res, 200, {
          ok: true,
          state: getLibraryState({
            source,
            type,
            id,
            profile_id: stateOwner,
          }),
        });
        return;
      }

      if (parts.length === 2 && parts[0] === 'library' && parts[1] === 'ratings') {
        const type = req.method === 'PUT'
          ? ''
          : url.searchParams.get('type')?.trim() ?? '';
        const id = req.method === 'PUT'
          ? ''
          : url.searchParams.get('id')?.trim() ?? '';
        if (req.method === 'GET') {
          if (!type || !id) throw new CatalogError(400, 'GET /library/ratings requires type and id');
          const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
          const personalization = getPersonalizationState();
          assertExpectedPersonalization(
            expectedPersonalization,
            personalization,
            'before rating state loaded',
          );
          try {
            canonicalRatingIdentity(type, id, { rejectEpisode: true });
            const rating = getRating(type, id);
            let prompt = getRatingPromptState(type, id);
            if (prompt.eligible && !prompt.presented_at) prompt = markRatingPromptPresented(type, id);
            sendJson(res, 200, {
              ok: true,
              enabled: fireWaterRatingsEnabled(),
              rating,
              prompt,
              profile_id: personalization.active_profile_id,
              personalization_updated_at: personalization.updated_at,
            });
          } catch (error) {
            if (error instanceof RatingValidationError) throw new CatalogError(400, error.message);
            throw error;
          }
          return;
        }
        if (req.method === 'PUT') {
          const body = await readBody(req) as Record<string, unknown>;
          const expectedPersonalization = parseExpectedPersonalizationBody(body);
          const personalization = getPersonalizationState();
          assertExpectedPersonalization(
            expectedPersonalization,
            personalization,
            'before rating changed',
          );
          validateOptionalRecommendationMutationAttribution(body, 'vod', {
            type: String(body.type ?? ''),
            id: String(body.id ?? ''),
          });
          let rating;
          try {
            rating = putRating({
              type: String(body.type ?? ''),
              id: String(body.id ?? ''),
              title: String(body.title ?? ''),
              year: body.year == null ? null : String(body.year),
              fire: body.fire,
              water: body.water,
              expected_revision: Number(body.expected_revision),
              origin: 'couch',
              reject_episode: true,
            });
          } catch (error) {
            if (error instanceof RatingRevisionConflictError) {
              throw new CatalogError(409, 'Rating changed elsewhere. Review the latest values.', {
                current: error.current,
              }, { couchMessage: 'Rating changed elsewhere. Review the latest values.' });
            }
            if (error instanceof RatingValidationError) {
              throw new CatalogError(400, error.message, undefined, { couchMessage: error.message });
            }
            throw error;
          }
          const affectedTabs = rating?.type === 'series' ? ['series'] as const : ['movies'] as const;
          const before = Object.fromEntries(affectedTabs.map((tab) => [tab, currentRecommendationRevision(tab)]));
          affectedTabs.forEach((tab) => core.invalidateRecommendationTab(tab));
          await queueRecommendationRefresh(affectedTabs);
          incrementRecommendationMetric('rating_mutations');
          sendJson(res, 200, {
            ok: true,
            rating,
            profile_id: personalization.active_profile_id,
            personalization_updated_at: personalization.updated_at,
            recommendation_revisions: before,
            recommendation_refresh: 'queued',
          });
          return;
        }
        if (req.method === 'DELETE') {
          if (!type || !id) throw new CatalogError(400, 'DELETE /library/ratings requires type and id');
          const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
          const personalization = getPersonalizationState();
          assertExpectedPersonalization(
            expectedPersonalization,
            personalization,
            'before rating cleared',
          );
          validateOptionalRecommendationMutationAttribution({
            attribution_token: url.searchParams.get('attribution_token') ?? undefined,
            rail_id: url.searchParams.get('rail_id') ?? undefined,
            slate_revision: url.searchParams.get('slate_revision') ?? undefined,
          }, 'vod', { type, id });
          try {
            const result = clearRating({
              type,
              id,
              expected_revision: Number(url.searchParams.get('expected_revision')),
            });
            const tabs = type.trim().toLowerCase() === 'series'
              ? ['series'] as const
              : ['movies'] as const;
            tabs.forEach((tab) => core.invalidateRecommendationTab(tab));
            await queueRecommendationRefresh(tabs);
            incrementRecommendationMetric('rating_mutations');
            sendJson(res, 200, {
              ok: true,
              ...result,
              profile_id: personalization.active_profile_id,
              personalization_updated_at: personalization.updated_at,
            });
          } catch (error) {
            if (error instanceof RatingRevisionConflictError) {
              throw new CatalogError(409, 'Rating changed elsewhere. Review the latest values.', {
                current: error.current,
              }, { couchMessage: 'Rating changed elsewhere. Review the latest values.' });
            }
            if (error instanceof RatingValidationError) {
              throw new CatalogError(400, error.message, undefined, { couchMessage: error.message });
            }
            throw error;
          }
          return;
        }
      }

      if (req.method === 'POST' && parts.length === 3
        && parts[0] === 'library' && parts[1] === 'rating-prompts' && parts[2] === 'dismiss') {
        const body = await readBody(req) as Record<string, unknown>;
        const expectedPersonalization = parseExpectedPersonalizationBody(body);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before rating prompt dismissed',
        );
        try {
          const prompt = resolveRatingPrompt(
            String(body.type ?? ''),
            String(body.id ?? ''),
            body.disposition === 'left_detail' ? 'left_detail' : 'dismissed',
          );
          sendJson(res, 200, {
            ok: true,
            prompt,
            profile_id: personalization.active_profile_id,
            personalization_updated_at: personalization.updated_at,
          });
        } catch (error) {
          if (error instanceof RatingValidationError) throw new CatalogError(400, error.message);
          throw error;
        }
        return;
      }

      if (req.method === 'GET' && parts.length === 2
        && parts[0] === 'recommendations' && parts[1] === 'state') {
        sendJson(res, 200, { ok: true, ...recommendationDiagnostics() });
        return;
      }

      if (req.method === 'GET' && parts.length === 3
        && parts[0] === 'recommendations' && parts[1] === 'jobs') {
        if (!isLocalRequest(req)) throw new CatalogError(403, 'recommendation job state is localhost-only');
        const job = recommendationRefreshJobById(parts[2] || '');
        if (!job) throw new CatalogError(404, 'recommendation refresh job not found');
        sendJson(res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'recommendations' && parts[1] === 'impressions') {
        const body = await readBody(req) as Record<string, unknown>;
        const domain = body.domain === 'youtube' ? 'youtube' : body.domain === 'vod' ? 'vod' : null;
        if (!domain) throw new CatalogError(400, 'recommendation impressions require a valid domain');
        const rails = Array.isArray(body.rails) ? body.rails.slice(0, 8) : [];
        let recorded = 0;
        for (const value of rails) {
          const rail = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          const railId = typeof rail.rail_id === 'string' ? rail.rail_id : '';
          const attributionToken = typeof rail.attribution_token === 'string' ? rail.attribution_token : '';
          const revision = Number(rail.slate_revision);
          const items = Array.isArray(rail.items) ? rail.items.slice(0, 40) : [];
          if (!railId || !attributionToken || !Number.isInteger(revision) || revision < 0) {
            throw new CatalogError(409, 'stale or incomplete recommendation slate');
          }
          const normalizedItems = items.map((item, rank) => {
            const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            return {
              type: typeof row.type === 'string' ? row.type : '',
              id: typeof row.id === 'string' ? row.id : '',
              rank: Number.isInteger(Number(row.rank)) ? Number(row.rank) : rank,
            };
          }).filter((item) => item.type && item.id);
          let served;
          try {
            served = resolveRecommendationServedSlate({
              attribution_token: attributionToken,
              domain,
              rail_id: railId,
              slate_revision: revision,
              items: normalizedItems,
            });
          } catch {
            throw new CatalogError(409, 'this recommendation slate is no longer current');
          }
          if (domain === 'vod') {
            try {
              assertCurrentVodRecommendationSource(served);
            } catch {
              throw new CatalogError(409, 'this recommendation slate is no longer current');
            }
          }
          recorded += recordRecommendationImpressions({
            profile_id: served.profile_id,
            domain,
            rail_id: served.rail_id,
            slate_revision: served.slate_revision,
            items: normalizedItems,
          });
        }
        sendJson(res, 200, { ok: true, recorded });
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'recommendations' && parts[1] === 'action') {
        const body = await readBody(req) as Record<string, unknown>;
        const domain = body.domain === 'youtube' ? 'youtube' : body.domain === 'vod' ? 'vod' : null;
        const revision = Number(body.slate_revision);
        if (body.action !== 'detail_open' || !domain
          || typeof body.attribution_token !== 'string' || !body.attribution_token
          || typeof body.rail_id !== 'string' || !body.rail_id
          || typeof body.type !== 'string' || !body.type
          || typeof body.id !== 'string' || !body.id
          || !Number.isInteger(revision) || revision < 0) {
          throw new CatalogError(400, 'invalid recommendation action');
        }
        let served;
        try {
          served = resolveRecommendationServedSlate({
            attribution_token: body.attribution_token,
            domain,
            rail_id: body.rail_id,
            slate_revision: revision,
            item: { type: body.type, id: body.id },
          });
        } catch {
          throw new CatalogError(409, 'this recommendation slate is no longer current');
        }
        if (served.profile_id !== recommendationOwnerForRollout(domain, activeViewerProfileId())) {
          throw new CatalogError(409, 'profile changed; reload recommendations before acting');
        }
        if (domain === 'vod') {
          try {
            assertCurrentVodRecommendationSource(served);
          } catch {
            throw new CatalogError(409, 'this recommendation slate is no longer current');
          }
        }
        recordRecommendationDetailOpen({
          profile_id: served.profile_id,
          domain,
          rail_id: served.rail_id,
          slate_revision: served.slate_revision,
          item_type: body.type,
          item_id: body.id,
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'GET' && parts.length === 2
        && parts[0] === 'personalization' && parts[1] === 'state') {
        sendJson(res, 200, {
          ok: true,
          profiles: listViewerProfiles(),
          state: getPersonalizationState(),
          recommendation_identity: recommendationsHouseholdOnly() ? 'household' : 'profile',
          household_only: recommendationsHouseholdOnly(),
          vod_recommendations_v2: vodRecommendationsV2Mode(),
        });
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'personalization' && parts[1] === 'profiles') {
        const body = await readBody(req) as Record<string, unknown>;
        const action = typeof body.action === 'string' ? body.action : 'create';
        try {
          if (action === 'rename') {
            const profile = renameViewerProfile(
              typeof body.profile_id === 'string' ? body.profile_id : '',
              typeof body.name === 'string' ? body.name : '',
            );
            sendJson(res, 200, { ok: true, profile, profiles: listViewerProfiles() });
            return;
          }
          if (action === 'complete_onboarding') {
            const profile = completeViewerProfileOnboarding(
              typeof body.profile_id === 'string' ? body.profile_id : '',
            );
            sendJson(res, 200, { ok: true, profile, profiles: listViewerProfiles() });
            return;
          }
          if (action !== 'create') throw new Error('unknown profile action');
          const policyError = householdOnlyMutationError(
            recommendationsHouseholdOnly(),
            'profile_create',
          );
          if (policyError) {
            sendJson(res, 409, {
              ok: false,
              ...policyError,
            });
            return;
          }
          const profile = createViewerProfile(typeof body.name === 'string' ? body.name : '');
          sendJson(res, 201, { ok: true, profile, profiles: listViewerProfiles() });
        } catch (error) {
          throw new CatalogError(400, error instanceof Error ? error.message : 'profile update failed');
        }
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'personalization' && parts[1] === 'activate') {
        const body = await readBody(req) as Record<string, unknown>;
        const requestedProfile = typeof body.profile_id === 'string' ? body.profile_id.trim().toLowerCase() : '';
        const policyError = householdOnlyMutationError(
          recommendationsHouseholdOnly(),
          'profile_activate',
          requestedProfile,
        );
        if (policyError) {
          sendJson(res, 409, {
            ok: false,
            ...policyError,
          });
          return;
        }
        const current = getPersonalizationState();
        const state = current.active_profile_id === 'household' && requestedProfile === 'household'
          ? current
          : activateViewerProfile(requestedProfile);
        if (state.updated_at !== current.updated_at) {
          core.clearRailItemsCache();
          await queueRecommendationRefresh(['movies', 'series'], state.active_profile_id, ['household_activation']);
        }
        sendJson(res, 200, { ok: true, state, profiles: listViewerProfiles() });
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'personalization' && parts[1] === 'mood') {
        const body = await readBody(req) as Record<string, unknown>;
        const requestedMood = typeof body.mood === 'string' ? body.mood.trim() : '';
        const policyError = householdOnlyMutationError(
          recommendationsHouseholdOnly(),
          'mood_write',
          requestedMood,
        );
        if (policyError) {
          sendJson(res, 409, {
            ok: false,
            ...policyError,
          });
          return;
        }
        const ttlMs = Number(body.ttl_ms);
        const current = getPersonalizationState();
        const state = !requestedMood && current.mood === null
          ? current
          : setViewerMood(requestedMood || null, Number.isFinite(ttlMs) ? ttlMs : undefined);
        if (recommendationsHouseholdOnly() && !requestedMood) preserveHouseholdMoodClear();
        if (state.updated_at !== current.updated_at) {
          core.clearRailItemsCache();
          await queueRecommendationRefresh(['movies', 'series'], state.active_profile_id, ['mood_change']);
        }
        sendJson(res, 200, { ok: true, state });
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'recommendations' && parts[1] === 'refresh') {
        if (!isLocalRequest(req)) throw new CatalogError(403, 'recommendation refresh is localhost-only');
        const body = await readBody(req) as Record<string, unknown>;
        const tab = body.tab === 'movies' || body.tab === 'series' ? body.tab : null;
        const triggerReason = typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'manual_refresh';
        const corpusGeneration = await playabilityRecommendationCorpusGeneration();
        const jobs = await queueRecommendationRefresh(
          tab ? [tab] : ['movies', 'series'],
          recommendationOwnerForRollout('vod', activeViewerProfileId()),
          [triggerReason],
          { corpus_generation: corpusGeneration },
        );
        sendJson(res, 202, {
          ok: true,
          jobs: jobs.map((job) => ({
            job_id: job.job_id,
            content_type: job.content_type,
            trigger_reasons: job.trigger_reasons,
            captured_revisions: job.captured_revisions,
            status: job.status,
          })),
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'saved') {
        const tab = parseCatalogTab(url.searchParams.get('tab'));
        const limit = Number(url.searchParams.get('limit') || 100);
        const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before Saved state loaded',
        );
        sendJson(res, 200, savedPayload(tab, limit, personalization));
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'saved') {
        const body = await readBody(req) as Record<string, unknown>;
        const expectedPersonalization = parseExpectedPersonalizationBody(body);
        assertExpectedPersonalization(
          expectedPersonalization,
          getPersonalizationState(),
          'before Saved target resolved',
        );
        const target = await resolveLibraryTarget(body, core);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before Saved state changed',
        );
        const savedDomain = libraryTargetDomain(target);
        const savedOwner = recommendationOwnerForRollout(
          savedDomain,
          personalization.active_profile_id,
        );
        validateOptionalRecommendationMutationAttribution(
          body,
          savedDomain,
          { type: target.type, id: target.id },
        );
        assertSaveAllowed(target);
        const saved = saveLibraryItem({
          ...target,
          saved_by: typeof body.saved_by === 'string' ? body.saved_by : 'user',
          profile_id: savedOwner,
        });
        if (savedDomain === 'youtube') {
          invalidateYoutubeV2ExactExclusions();
          core.clearRailItemsCache();
        } else if (saved.source !== SYNTHETIC_LIBRARY_SOURCE
          && (saved.type === 'movie' || saved.type === 'series')) {
          const tab = saved.type === 'series' ? 'series' : 'movies';
          core.invalidateRecommendationTab(tab);
          await queueRecommendationRefresh([tab]);
        }
        sendJson(res, 200, {
          ok: true,
          saved,
          profile_id: personalization.active_profile_id,
          personalization_updated_at: personalization.updated_at,
          state: getLibraryState({
            source: saved.source,
            type: saved.type,
            id: saved.id,
            profile_id: savedOwner,
          }),
        });
        return;
      }

      if (req.method === 'DELETE' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'saved') {
        const body = await readBody(req) as Record<string, unknown>;
        const expectedPersonalization = parseExpectedPersonalizationBody(body);
        assertExpectedPersonalization(
          expectedPersonalization,
          getPersonalizationState(),
          'before Saved target resolved',
        );
        const target = await resolveLibraryTarget(body, core);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before Saved state changed',
        );
        const savedDomain = libraryTargetDomain(target);
        const savedOwner = recommendationOwnerForRollout(
          savedDomain,
          personalization.active_profile_id,
        );
        validateOptionalRecommendationMutationAttribution(
          body,
          savedDomain,
          { type: target.type, id: target.id },
        );
        const removed = unsaveLibraryItem({
          source: target.source,
          type: target.type,
          id: target.id,
          profile_id: savedOwner,
        });
        if (savedDomain === 'youtube') {
          invalidateYoutubeV2ExactExclusions();
          core.clearRailItemsCache();
        } else if (target.source !== SYNTHETIC_LIBRARY_SOURCE
          && (target.type === 'movie' || target.type === 'series')) {
          const tab = target.type === 'series' ? 'series' : 'movies';
          core.invalidateRecommendationTab(tab);
          await queueRecommendationRefresh([tab]);
        }
        sendJson(res, 200, {
          ok: true,
          removed,
          target,
          profile_id: personalization.active_profile_id,
          personalization_updated_at: personalization.updated_at,
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'history') {
        const limit = Number(url.searchParams.get('limit') || 50);
        sendJson(res, 200, {
          ok: true,
          history: listWatchHistory(Number.isFinite(limit) ? limit : 50),
        });
        return;
      }

      if (parts.length === 2 && parts[0] === 'library' && parts[1] === 'not-interested') {
        if (req.method === 'GET') {
          const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
          const personalization = getPersonalizationState();
          assertExpectedPersonalization(
            expectedPersonalization,
            personalization,
            'before hidden-title state loaded',
          );
          const requestedSource = url.searchParams.get('source')?.trim() || undefined;
          const requestedType = url.searchParams.get('type')?.trim() || null;
          const id = url.searchParams.get('id')?.trim() || null;
          const identity = normalizeLibraryIdentity(requestedSource, requestedType ?? 'movie');
          const source = requestedSource ? identity.source : undefined;
          const type = requestedType ? identity.type : null;
          const feedbackDomain = libraryTargetDomain({
            source,
            type: type ?? 'movie',
            id: id ?? '',
          });
          const feedbackOwner = recommendationOwnerForRollout(
            feedbackDomain,
            personalization.active_profile_id,
          );
          const feedback = listProfileLibraryFeedback('not_interested', source, {
            profile_id: feedbackOwner,
            household_blend: false,
          }).filter((row) => (!type || row.type === type) && (!id || row.id === id));
          sendJson(res, 200, {
            ok: true,
            active_profile_id: personalization.active_profile_id,
            profile_id: personalization.active_profile_id,
            personalization_updated_at: personalization.updated_at,
            hidden: type !== null && id !== null ? feedback.length > 0 : undefined,
            items: feedback,
          });
          return;
        }
        const body = await readBody(req) as Record<string, unknown>;
        const expectedPersonalization = parseExpectedPersonalizationBody(body);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before hidden-title state changed',
        );
        const target = libraryItemFromRecord(body);
        if (!target) throw new CatalogError(400, 'Not for me requires { type, id }');
        const feedbackDomain = libraryTargetDomain(target);
        const feedbackOwner = recommendationOwnerForRollout(
          feedbackDomain,
          personalization.active_profile_id,
        );
        validateOptionalRecommendationMutationAttribution(
          body,
          feedbackDomain,
          { type: target.type, id: target.id },
        );
        if (req.method === 'POST') {
          const feedback = setLibraryFeedback({
            ...target,
            feedback: 'not_interested',
            reason: typeof body.reason === 'string' ? body.reason : null,
            profile_id: feedbackOwner,
          });
          if (feedbackDomain === 'youtube') {
            invalidateYoutubeV2ExactExclusions();
            if (youtubeRecommendationsV2Mode() !== 'off') rebuildYoutubeV2Generation({ force: true });
            core.clearRailItemsCache();
          }
          else if (target.type === 'movie' || target.type === 'series') {
            const tab = target.type === 'series' ? 'series' : 'movies';
            core.invalidateRecommendationTab(tab);
            await queueRecommendationRefresh([tab]);
          }
          sendJson(res, 200, {
            ok: true,
            profile_id: personalization.active_profile_id,
            personalization_updated_at: personalization.updated_at,
            feedback,
          });
          return;
        }
        if (req.method === 'DELETE') {
          const removed = clearLibraryFeedback({
            source: target.source,
            type: target.type,
            id: target.id,
            feedback: 'not_interested',
            profile_id: feedbackOwner,
          });
          if (feedbackDomain === 'youtube') {
            invalidateYoutubeV2ExactExclusions();
            if (youtubeRecommendationsV2Mode() !== 'off') rebuildYoutubeV2Generation({ force: true });
            core.clearRailItemsCache();
          }
          else if (target.type === 'movie' || target.type === 'series') {
            const tab = target.type === 'series' ? 'series' : 'movies';
            core.invalidateRecommendationTab(tab);
            await queueRecommendationRefresh([tab]);
          }
          sendJson(res, 200, {
            ok: true,
            profile_id: personalization.active_profile_id,
            personalization_updated_at: personalization.updated_at,
            removed,
          });
          return;
        }
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'context') {
        const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
        if (!expectedPersonalization) {
          throw new CatalogError(400, 'GET /library/context requires exact profile ownership');
        }
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before current Detail context loaded',
        );
        sendJson(res, 200, {
          ok: true,
          context: getLibraryContext(personalization.active_profile_id),
          profile_id: personalization.active_profile_id,
          personalization_updated_at: personalization.updated_at,
        });
        return;
      }

      if (req.method === 'DELETE' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'context') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'library context is localhost-only');
        }
        sendJson(res, 200, { ok: true, removed: clearLibraryContext() });
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'library' && parts[1] === 'context') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'library context is localhost-only');
        }
        const body = await readBody(req) as Record<string, unknown>;
        const expectedPersonalization = parseExpectedPersonalizationBody(body);
        if (!expectedPersonalization) {
          throw new CatalogError(400, 'POST /library/context requires exact profile ownership');
        }
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before current Detail context changed',
        );
        const target = libraryItemFromRecord(body);
        if (!target) {
          throw new CatalogError(400, 'POST /library/context requires { type, id }');
        }
        sendJson(res, 200, {
          ok: true,
          context: setLibraryContext(target, {
            profile_id: personalization.active_profile_id,
            opened_at: Number.isSafeInteger(body.context_opened_at)
              && Number(body.context_opened_at) > 0
              ? Number(body.context_opened_at)
              : undefined,
          }),
          profile_id: personalization.active_profile_id,
          personalization_updated_at: personalization.updated_at,
        });
        return;
      }

      if (parts.length >= 1 && parts[0] === 'youtube') {
        if (req.method === 'GET' && parts.length === 3
          && parts[1] === 'companion' && parts[2] === 'status') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'companion YouTube status is available through HTTPS only');
          }
          sendJson(res, 200, youtube.companionStatus());
          return;
        }

        if (req.method === 'POST' && parts.length === 4
          && parts[1] === 'companion' && parts[2] === 'auth' && parts[3] === 'start') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'companion YouTube auth is available through HTTPS only');
          }
          sendJson(res, 200, await withoutCatalogErrorDetails(() => youtube.startCompanionAuth()));
          return;
        }

        if (req.method === 'GET' && parts.length === 4
          && parts[1] === 'companion' && parts[2] === 'auth' && parts[3] === 'poll') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'companion YouTube auth is available through HTTPS only');
          }
          const sessionId = url.searchParams.get('session_id')?.trim() ?? '';
          if (!sessionId) {
            throw new CatalogError(400, 'GET /youtube/companion/auth/poll requires session_id');
          }
          sendJson(
            res,
            200,
            await withoutCatalogErrorDetails(() => youtube.pollCompanionAuth(sessionId)),
          );
          return;
        }

        if (req.method === 'POST' && parts.length === 4
          && parts[1] === 'companion' && parts[2] === 'auth' && parts[3] === 'disconnect') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'companion YouTube auth is available through HTTPS only');
          }
          sendJson(res, 200, youtube.disconnectCompanionAuth());
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'state') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'YouTube operator state is localhost-only');
          }
          sendJson(res, 200, youtube.state());
          return;
        }

        if (req.method === 'POST' && parts.length === 3
          && parts[1] === 'takeout' && parts[2] === 'import') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'YouTube Takeout import is localhost-only');
          }
          const configuredLimit = Number(process.env.MANGO_YOUTUBE_TAKEOUT_MAX_BYTES);
          const uploadLimit = Number.isFinite(configuredLimit) && configuredLimit > 0
            ? Math.min(256 * 1024 * 1024, Math.floor(configuredLimit))
            : 64 * 1024 * 1024;
          const header = req.headers['x-mango-filename'];
          const filename = (Array.isArray(header) ? header[0] : header)?.trim().slice(0, 240)
            || 'youtube-takeout';
          let result;
          try {
            result = await importYoutubeTakeoutStream(req, {
              filename,
              max_bytes: uploadLimit,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : 'YouTube Takeout import failed';
            throw new CatalogError(
              /too large/i.test(message) ? 413 : 400,
              message,
            );
          }
          let localRankError: string | null = null;
          let recommendationRefresh: Awaited<ReturnType<typeof refreshYoutubeV2AfterLocalSignal>>;
          try {
            recommendationRefresh = await refreshYoutubeV2AfterLocalSignal({
              reason: 'takeout_import',
              changed: !result.noop,
              service: youtube,
              wait_for_acquisition: false,
            });
          } catch (error) {
            localRankError = error instanceof Error ? error.message : String(error);
            recommendationRefresh = {
              local_generation: null,
              acquisition: youtubeRecommendationsV2Mode() === 'off' ? 'off' : 'coalesced',
              acquisition_result: null,
            };
          }
          sendJson(res, 200, {
            ok: true,
            import: result,
            recommendation_refresh: {
              local_generation: recommendationRefresh.local_generation,
              local_rank_error: localRankError,
              acquisition: recommendationRefresh.acquisition,
            },
          });
          return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[1] === 'auth' && parts[2] === 'start') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'YouTube operator auth is localhost-only');
          }
          sendJson(res, 200, await youtube.startAuth());
          return;
        }

        if (req.method === 'GET' && parts.length === 3 && parts[1] === 'auth' && parts[2] === 'poll') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'YouTube operator auth is localhost-only');
          }
          const sessionId = url.searchParams.get('session_id')?.trim() ?? '';
          if (!sessionId) {
            throw new CatalogError(400, 'GET /youtube/auth/poll requires session_id');
          }
          sendJson(res, 200, await youtube.pollAuth(sessionId));
          return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[1] === 'auth' && parts[2] === 'disconnect') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'YouTube operator auth is localhost-only');
          }
          sendJson(res, 200, youtube.disconnectAuth());
          return;
        }

        if (req.method === 'POST' && parts.length === 2 && parts[1] === 'refresh') {
          if (!isLocalRequest(req)) throw new CatalogError(403, 'YouTube refresh is localhost-only');
          const body = await readBody(req) as Record<string, unknown>;
          const reason = typeof body.reason === 'string' && body.reason.trim()
            ? body.reason.trim()
            : 'manual';
          const state = youtube.state();
          const job = createRecommendationRefreshJob({
            domain: 'youtube',
            trigger_reasons: [reason],
            captured_revisions: {
              mode: youtubeRecommendationsV2Mode(),
              v2_state: JSON.stringify(state.recommendations_v2 ?? null).slice(0, 2_000),
            },
          });
          setImmediate(() => {
            updateRecommendationRefreshJobs([job.job_id], 'running');
            void youtube.refresh(reason).then((result) => {
              if (result.ok) updateRecommendationRefreshJobs([job.job_id], 'complete');
              else updateRecommendationRefreshJobs(
                [job.job_id],
                'failed',
                result.error ?? 'YouTube refresh failed',
              );
            }).catch((error) => updateRecommendationRefreshJobs([job.job_id], 'failed', error));
          });
          sendJson(res, 202, {
            ok: true,
            job: {
              job_id: job.job_id,
              trigger_reasons: job.trigger_reasons,
              captured_revisions: job.captured_revisions,
              status: job.status,
            },
          });
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'rails') {
          const reshuffle = url.searchParams.get('reshuffle') === '1'
            || url.searchParams.get('reshuffle') === 'true';
          const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
          const personalization = getPersonalizationState();
          assertExpectedPersonalization(
            expectedPersonalization,
            personalization,
            'before YouTube rails loaded',
          );
          const result = await youtube.rails({ reshuffle, expectedPersonalization });
          const currentPersonalization = getPersonalizationState();
          const expectedRecommendationOwner = recommendationOwnerForRollout(
            'youtube',
            personalization.active_profile_id,
          );
          if (currentPersonalization.active_profile_id !== personalization.active_profile_id
            || currentPersonalization.updated_at !== personalization.updated_at
            || result.profile_id !== expectedRecommendationOwner
            || result.personalization_updated_at !== personalization.updated_at) {
            throw new CatalogError(409, 'profile changed while YouTube recommendations were loading');
          }
          const { attribution_contexts: attributionContexts, ...publicYoutubeResult } = result;
          const servedInputs = result.rails.map((rail) => {
            const attributionContext = attributionContexts[rail.rail_id];
            if (!attributionContext
              || attributionContext.source_revision !== result.slate_sequence) {
              throw new CatalogError(500, 'YouTube recommendation attribution context is unavailable');
            }
            return {
              profile_id: result.profile_id,
              domain: 'youtube' as const,
              rail_id: rail.rail_id,
              source_revision: attributionContext.source_revision,
              context_id: attributionContext.context_id,
              slate_revision: result.slate_sequence,
              items: rail.items.map((item, rank) => ({
                type: `youtube_${item.kind}`,
                id: item.id,
                rank,
              })),
            };
          });
          let served;
          try {
            served = registerRecommendationServedSlates(servedInputs);
          } catch (error) {
            console.warn(`YouTube recommendation attribution could not be persisted: ${
              error instanceof Error ? error.message : String(error)
            }`);
            throw new CatalogError(500, 'YouTube recommendation attribution could not be persisted');
          }
          const publicResult = youtubePublicPersonalizationPayload({
            ...publicYoutubeResult,
            rails: result.rails.map((rail, index) => ({
              ...rail,
              slate_sequence: result.slate_sequence,
              attribution_token: served[index]!.attribution_token,
            })),
          }, personalization);
          sendJson(res, 200, publicResult);
          return;
        }

        if (req.method === 'POST' && parts.length === 2 && parts[1] === 'impressions') {
          const body = await readBody(req) as Record<string, unknown>;
          const sequence = Number(body.slate_sequence);
          const rails = Array.isArray(body.rails) ? body.rails : [];
          if (!Number.isInteger(sequence) || sequence < 0) {
            throw new CatalogError(400, 'YouTube impressions require a non-negative slate_sequence');
          }
          const validatedRails: Array<{
            profile_id: string;
            rail_id: string;
            slate_revision: number;
            source_revision: number;
            context_id: string;
            items: Array<{ type: string; id: string; rank: number }>;
          }> = [];
          for (const entry of rails.slice(0, 8)) {
            const row = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
            const railId = typeof row.rail_id === 'string' ? row.rail_id : '';
            const attributionToken = typeof row.attribution_token === 'string' ? row.attribution_token : '';
            const revision = Number(row.slate_revision);
            const rawItems = Array.isArray(row.items) ? row.items.slice(0, 4) : [];
            const items = rawItems.map((item, rank) => {
              const candidate = item && typeof item === 'object' ? item as Record<string, unknown> : {};
              return {
                type: typeof candidate.type === 'string' ? candidate.type : '',
                id: typeof candidate.id === 'string' ? candidate.id : '',
                rank: Number.isInteger(Number(candidate.rank)) ? Number(candidate.rank) : rank,
              };
            }).filter((item) => item.type && item.id);
            if (!railId || !attributionToken || !Number.isInteger(revision) || items.length === 0) {
              throw new CatalogError(409, 'stale or incomplete YouTube recommendation slate');
            }
            let served;
            try {
              served = resolveRecommendationServedSlate({
                attribution_token: attributionToken,
                domain: 'youtube',
                rail_id: railId,
                slate_revision: revision,
                items,
              });
            } catch {
              throw new CatalogError(409, 'this YouTube recommendation slate is no longer current');
            }
            if (served.rail_id === 'because_you_watched' && !served.context_id) {
              // Pre-v11 tokens cannot prove which seed produced the row. Fail
              // closed instead of attributing them to mutable current history.
              throw new CatalogError(409, 'this YouTube recommendation context is no longer current');
            }
            validatedRails.push({
              profile_id: served.profile_id,
              rail_id: served.rail_id,
              slate_revision: served.slate_revision,
              source_revision: served.source_revision,
              context_id: served.context_id,
              items,
            });
          }
          const owners = new Set(validatedRails.map((rail) => rail.profile_id));
          if (owners.size > 1) {
            throw new CatalogError(409, 'YouTube recommendation slate owners do not match');
          }
          const profileId = validatedRails[0]?.profile_id;
          if (!profileId) {
            throw new CatalogError(400, 'YouTube impressions require at least one rendered rail');
          }
          let authoritativeSourceRevision: number;
          try {
            authoritativeSourceRevision = resolveYoutubeImpressionSourceRevision(sequence, validatedRails);
          } catch {
            throw new CatalogError(409, 'this YouTube recommendation source revision does not match');
          }
          const youtubeResult = youtube.impressions({
            profile_id: profileId,
            slate_sequence: authoritativeSourceRevision,
            rails: validatedRails.map((rail) => ({
              rail_id: rail.rail_id,
              context_id: rail.context_id,
              item_ids: rail.items.map((item) => item.id),
            })),
          });
          let attributionRecorded = 0;
          for (const rail of validatedRails) {
            attributionRecorded += recordRecommendationImpressions({
              profile_id: rail.profile_id,
              domain: 'youtube',
              rail_id: rail.rail_id,
              slate_revision: rail.slate_revision,
              items: rail.items,
            });
          }
          sendJson(res, 200, { ...youtubeResult, attribution_recorded: attributionRecorded });
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'related') {
          const railId = url.searchParams.get('rail_id')?.trim() ?? '';
          const exclude = parseTitleExcludeQuery(url.searchParams.get('exclude'));
          const limit = Number(url.searchParams.get('limit') || 8);
          sendJson(res, 200, await youtube.railRelated(
            railId,
            exclude,
            Number.isFinite(limit) ? limit : 8,
          ));
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'search') {
          const query = url.searchParams.get('q')?.trim() ?? '';
          const limit = Number(url.searchParams.get('limit') || 25);
          sendJson(res, 200, await youtube.search(query, Number.isFinite(limit) ? limit : 25));
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'detail') {
          const kind = parseYoutubeKind(url.searchParams.get('kind'));
          const id = url.searchParams.get('id')?.trim() ?? '';
          if (!id) {
            throw new CatalogError(400, 'GET /youtube/detail requires id');
          }
          sendJson(res, 200, await youtube.detail(kind, id));
          return;
        }

        if (req.method === 'POST' && parts.length === 2 && parts[1] === 'not-interested') {
          const body = await readBody(req) as Record<string, unknown>;
          sendJson(res, 200, youtube.notInterested({
            kind: typeof body.kind === 'string' ? body.kind : undefined,
            id: typeof body.id === 'string' ? body.id : undefined,
            title: typeof body.title === 'string' ? body.title : undefined,
            reason: typeof body.reason === 'string' ? body.reason : null,
          }));
          return;
        }

        if (req.method === 'POST' && parts.length === 2 && parts[1] === 'play') {
          const body = await readBody(req);
          const attribution = playbackRecommendationAttributionFromBody(body, 'youtube');
          touchCouchActivity('catalog', 'youtube_play');
          sendJson(res, 200, await youtube.play({
            profile_id: attribution?.profile_id
              ?? recommendationOwnerForRollout('youtube', activeViewerProfileId()),
            id: typeof body.id === 'string' ? body.id : undefined,
            title: typeof body.title === 'string' ? body.title : undefined,
            poster: typeof body.poster === 'string' ? body.poster : undefined,
            library_source: typeof body.library_source === 'string'
              ? body.library_source
              : undefined,
            recommendation: attribution ?? undefined,
          }));
          return;
        }
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'tools') {
        sendJson(res, 200, buildVoiceToolManifest());
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'library') {
        const limit = Number(url.searchParams.get('limit') || 500);
        const overviewOnly = url.searchParams.get('overview') === '1'
          || url.searchParams.get('overview') === 'true';
        const config = await loadRailConfig();
        const railLabels = new Map(
          config.rails
            .filter((rail) => rail.enabled !== false && 'label' in rail)
            .map((rail) => [rail.id, rail.label]),
        );
        const catalog = await buildLibraryCatalog(railLabels, Number.isFinite(limit) ? limit : 500);
        if (overviewOnly) {
          sendJson(res, 200, buildLibraryOverview(catalog.titles, railLabels));
          return;
        }
        sendJson(res, 200, catalog);
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'library' && parts[2] === 'notes') {
        sendJson(res, 200, await readLibrarianNotes());
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'library' && parts[2] === 'notes') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'librarian notes are localhost-only');
        }
        const body = await readBody(req) as { notes?: string };
        if (typeof body.notes !== 'string') {
          throw new CatalogError(400, 'POST /voice/library/notes requires { notes }');
        }
        sendJson(res, 200, await writeLibrarianNotes(body.notes));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'profile') {
        sendJson(res, 200, { ok: true, profile: await readProfile() });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'profile') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion profile writes are localhost-only');
        }
        const body = await readBody(req) as ProfilePatch;
        const profile = await patchProfile(body);
        await writeCompiledNotes(profile);
        appendJournalEvent('profile_patch', { keys: Object.keys(body) });
        sendJson(res, 200, { ok: true, profile });
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'summary') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion summary is available through HTTPS only');
        }
        const profile = await readProfile();
        const compiled = await readCompiledNotes();
        sendJson(res, 200, {
          ok: true,
          summary: profileSummary(profile),
          compiled_excerpt: compiledNotesExcerpt(compiled),
          familiarity: profile.familiarity,
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'journal') {
        const limit = Number(url.searchParams.get('limit') || 50);
        sendJson(res, 200, { ok: true, events: listJournalEvents(Number.isFinite(limit) ? limit : 50) });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'session-notes') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion session notes are localhost-only');
        }
        const body = await readBody(req) as { bullets?: string[] };
        if (!Array.isArray(body.bullets)) {
          throw new CatalogError(400, 'POST /voice/companion/session-notes requires { bullets: string[] }');
        }
        const profile = await patchProfile({ append_session_notes: body.bullets });
        await writeCompiledNotes(profile);
        appendJournalEvent('session_notes', { count: body.bullets.length });
        sendJson(res, 200, { ok: true, profile });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'reflect') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion reflect is localhost-only');
        }
        const body = await readBody(req) as { transcript?: string; reply?: string; tools_used?: string[] };
        if (typeof body.transcript !== 'string') {
          throw new CatalogError(400, 'POST /voice/companion/reflect requires { transcript }');
        }
        sendJson(res, 200, await processLightReflect({
          transcript: body.transcript,
          reply: typeof body.reply === 'string' ? body.reply : undefined,
          tools_used: Array.isArray(body.tools_used) ? body.tools_used.filter((t) => typeof t === 'string') : [],
        }));
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'consolidate') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion consolidate is localhost-only');
        }
        sendJson(res, 200, await consolidateCompanionNightly());
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'nightly') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion nightly is localhost-only');
        }
        const body = await readBody(req) as { phases?: Array<'rule' | 'gardener'> };
        sendJson(res, 200, await runCompanionNightly({ phases: body.phases }));
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'companion' && parts[2] === 'gardener') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion gardener is localhost-only');
        }
        const gardenerResult = await applyCompanionGardener();
        await core.reloadAiCatalogRails();
        sendJson(res, 200, gardenerResult);
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'search-external') {
        const query = url.searchParams.get('q')?.trim() ?? '';
        const typeParam = url.searchParams.get('type');
        const contentType = typeParam === 'movie' || typeParam === 'series' ? typeParam : null;
        const queue = url.searchParams.get('queue') === '1' || url.searchParams.get('queue') === 'true';
        const limit = Number(url.searchParams.get('limit') || 8);
        sendJson(res, 200, await searchExternalTitles(core, query, {
          type: contentType,
          limit: Number.isFinite(limit) ? limit : 8,
          queue_missing: queue,
        }));
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'search') {
        const query = url.searchParams.get('q')?.trim() ?? '';
        const limit = Number(url.searchParams.get('limit') || 8);
        const resultLimit = Number.isFinite(limit) ? limit : 8;
        const liveOnly = url.searchParams.get('tab') === 'live'
          || url.searchParams.get('live') === '1'
          || url.searchParams.get('live') === 'true';
        const results = liveOnly
          ? await searchLiveChannels(query, resultLimit, core, { validateUnknown: true })
          : await searchVerifiedLibrary(query, resultLimit, core);
        sendJson(res, 200, { ok: true, query, results });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'ai-catalogs') {
        sendJson(res, 200, { ok: true, catalogs: await listAiCatalogSummaries() });
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'ai-catalogs') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'ai catalog writes are localhost-only');
        }
        const body = await readBody(req) as Record<string, unknown>;
        const tab = parseCatalogTab(typeof body.tab === 'string' ? body.tab : null);
        const contentType = body.content_type === 'movie' || body.content_type === 'series' || body.content_type === 'youtube_video' || body.content_type === 'tv'
          ? body.content_type
          : null;
        if (!tab || !contentType || typeof body.label !== 'string' || !body.label.trim()) {
          throw new CatalogError(400, 'POST /voice/ai-catalogs requires { label, tab, content_type }');
        }
        const theme = typeof body.theme === 'string' ? body.theme.trim() : undefined;
        const result = await createAiCatalogWithBootstrap(core, {
          label: body.label.trim(),
          tab,
          content_type: contentType,
          theme,
          seed_titles: Array.isArray(body.seed_titles) ? body.seed_titles as AiSeedTitle[] : undefined,
          sources: Array.isArray(body.sources) ? body.sources as CreateAiCatalogInput['sources'] : undefined,
          llm_hints: typeof body.llm_hints === 'object' && body.llm_hints !== null
            ? body.llm_hints as CreateAiCatalogInput['llm_hints']
            : undefined,
          overflow_action: body.overflow_action === 'replace'
            || body.overflow_action === 'merge'
            ? body.overflow_action
            : undefined,
          replace_slot_id: typeof body.replace_slot_id === 'string' ? body.replace_slot_id : undefined,
          merge_into_slot_id: typeof body.merge_into_slot_id === 'string' ? body.merge_into_slot_id : undefined,
        });
        if (!result.ok) {
          sendJson(res, 409, { ok: false, error: result.error, overflow_options: result.overflow_options });
          return;
        }
        sendJson(res, 200, { ok: true, catalog: result.catalog, bootstrap: result.bootstrap });
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'ai-catalogs' && parts[2] === 'status') {
        const slotId = url.searchParams.get('slot_id')?.trim() ?? '';
        if (!slotId) {
          throw new CatalogError(400, 'GET /voice/ai-catalogs/status requires slot_id');
        }
        const status = getSlotBootstrapStatus(slotId);
        if (!status) {
          sendJson(res, 200, {
            ok: true,
            status: {
              slot_id: slotId,
              bootstrap_status: 'unknown',
              visible_on_tab: false,
            },
          });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          status: {
            ...status,
            bootstrap_status: status.status,
          },
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'ai-catalogs' && parts[2] === 'bootstrap') {
        const jobId = url.searchParams.get('job_id')?.trim() ?? '';
        if (!jobId) {
          throw new CatalogError(400, 'GET /voice/ai-catalogs/bootstrap requires job_id');
        }
        const job = getBootstrapJob(jobId);
        if (!job) {
          throw new CatalogError(404, `unknown bootstrap job: ${jobId}`);
        }
        sendJson(res, 200, { ok: true, job });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'ai-catalogs' && parts[2] === 'migrate') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'ai catalog migrate is localhost-only');
        }
        const body = await readBody(req) as Record<string, unknown>;
        if (typeof body.slot_id !== 'string' || !body.slot_id.trim()) {
          throw new CatalogError(400, 'POST /voice/ai-catalogs/migrate requires { slot_id }');
        }
        const migrated = await migrateSlotIfEmpty(core, body.slot_id.trim());
        sendJson(res, 200, { ok: true, migrated, status: getSlotBootstrapStatus(body.slot_id.trim()) });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'ai-catalogs' && parts[2] === 'update') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'ai catalog writes are localhost-only');
        }
        const body = await readBody(req) as Record<string, unknown>;
        if (typeof body.slot_id !== 'string' || !body.slot_id.trim()) {
          throw new CatalogError(400, 'POST /voice/ai-catalogs/update requires { slot_id }');
        }
        const catalog = await updateAiCatalog(core, {
          slot_id: body.slot_id.trim(),
          label: typeof body.label === 'string' ? body.label : undefined,
          seed_titles: Array.isArray(body.seed_titles) ? body.seed_titles as AiSeedTitle[] : undefined,
          sources: Array.isArray(body.sources) ? body.sources as never : undefined,
          llm_hints: typeof body.llm_hints === 'object' && body.llm_hints !== null
            ? body.llm_hints as never
            : undefined,
          append_seeds: Array.isArray(body.append_seeds) ? body.append_seeds as AiSeedTitle[] : undefined,
          remove_seed_ids: Array.isArray(body.remove_seed_ids)
            ? body.remove_seed_ids.map(String)
            : undefined,
        });
        sendJson(res, 200, { ok: true, catalog });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'ai-catalogs' && parts[2] === 'delete') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'ai catalog writes are localhost-only');
        }
        const body = await readBody(req) as Record<string, unknown>;
        if (typeof body.slot_id !== 'string' || !body.slot_id.trim()) {
          throw new CatalogError(400, 'POST /voice/ai-catalogs/delete requires { slot_id }');
        }
        const removed = await deleteAiCatalog(core, body.slot_id.trim());
        sendJson(res, 200, { ok: true, removed });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'voice' && parts[1] === 'ai-catalogs' && parts[2] === 'refresh') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'ai catalog writes are localhost-only');
        }
        const body = await readBody(req) as Record<string, unknown>;
        if (typeof body.slot_id !== 'string' || !body.slot_id.trim()) {
          throw new CatalogError(400, 'POST /voice/ai-catalogs/refresh requires { slot_id }');
        }
        sendJson(res, 200, await refreshAiCatalogWithMigrate(core, body.slot_id.trim()));
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'now-playing') {
        sendJson(res, 200, await buildNowPlayingResponse());
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'voice' && parts[1] === 'continue') {
        const tab = parseCatalogTab(url.searchParams.get('tab'));
        sendJson(res, 200, buildContinuePlayTarget(tab));
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'ai' && parts[1] === 'context') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'companion context is available through HTTPS only');
        }
        sendJson(res, 200, await buildAiContextResponse());
        return;
      }

      if (req.method === 'GET' && parts.length === 2
        && parts[0] === 'health' && parts[1] === 'live') {
        sendJson(res, 200, {
          ok: true,
          process: 'live',
          pid: process.pid,
          uptime_seconds: Math.floor(process.uptime()),
          maintenance: readFreshRecommendationMaintenanceLease(),
          checked_at: Date.now(),
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'health') {
        sendJson(res, 200, core.health());
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'rails' && parts[1] === 'continue') {
        const tab = parseCatalogTab(url.searchParams.get('tab')) ?? 'movies';
        sendJson(
          res,
          200,
          await core.continueRailItems(tab, parseExpectedPersonalization(url.searchParams) ?? undefined),
        );
        return;
      }

      if (parts.length >= 1 && parts[0] === 'reliability') {
        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'state') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'reliability state is localhost-only');
          }
          sendJson(res, 200, await reliability.state());
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'controller') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'reliability controller state is localhost-only');
          }
          sendJson(res, 200, { ok: true, controller: await reliability.controller() });
          return;
        }

        if (req.method === 'GET' && parts.length === 2 && parts[1] === 'proofs') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'reliability proofs are localhost-only');
          }
          const limit = Number(url.searchParams.get('limit') || 20);
          sendJson(res, 200, {
            ok: true,
            proofs: reliability.proofs(Number.isFinite(limit) ? limit : 20),
          });
          return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[1] === 'proof' && parts[2] === 'run') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'reliability proof is localhost-only');
          }
          const body = await readBody(req) as Record<string, unknown>;
          let reason: string;
          const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : {};
          try {
            reason = sanitizeReliabilityProofReason(body.reason);
            sanitizeReliabilityProofMetadata(metadata);
          } catch (error) {
            throw new CatalogError(400, error instanceof Error ? error.message : String(error));
          }
          sendJson(res, 200, await reliability.runProof(reason, metadata));
          return;
        }

        if (req.method === 'POST' && parts.length === 2 && parts[1] === 'repair') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'reliability repair is localhost-only');
          }
          const result = await reliability.repair();
          sendJson(res, result.ok ? 202 : 409, result);
          return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[1] === 'controller' && parts[2] === 'repair') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'controller repair is localhost-only');
          }
          const result = await reliability.repairController();
          sendJson(res, result.ok ? 202 : 409, result);
          return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[1] === 'stack' && parts[2] === 'restart') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'stack restart is localhost-only');
          }
          const result = await reliability.restartStack();
          sendJson(res, result.ok ? 202 : 409, result);
          return;
        }

        if (req.method === 'POST' && parts.length === 3 && parts[1] === 'refresh' && parts[2] === 'run') {
          if (!isLocalRequest(req)) {
            throw new CatalogError(403, 'reliability refresh is localhost-only');
          }
          const result = await reliability.runRefresh();
          sendJson(res, result.ok ? 202 : 409, result);
          return;
        }
      }

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'rails') {
        const tab = parseCatalogTab(url.searchParams.get('tab'));
        if (url.searchParams.has('tab') && !tab) {
          throw new CatalogError(400, 'tab must be movies, series, or live');
        }
        sendJson(res, 200, core.rails(tab));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'playability' && parts[1] === 'refresh' && parts[2] === 'levels') {
        sendJson(res, 200, {
          ok: true,
          levels: listRefreshLevelsForUi(),
          shuffle: getRefreshLevel('shuffle_rails'),
        });
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'playability' && parts[1] === 'refresh' && parts[2] === 'tools') {
        sendJson(res, 200, { ok: true, ...buildLlmRefreshToolManifest() });
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'playability' && parts[1] === 'refresh') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'playability refresh is localhost-only');
        }
        const body = await readBody(req);
        const levelId = body.level;
        const refreshMode = body.mode;
        const refreshPreset = body.preset;

        if (refreshMode && typeof refreshMode === 'string') {
          if (refreshMode !== 'grow' && refreshMode !== 'stale' && refreshMode !== 'nightly') {
            throw new CatalogError(400, 'mode must be grow, stale, or nightly');
          }
          const preset =
            refreshPreset && typeof refreshPreset === 'string'
              ? (refreshPreset as GrowPresetId)
              : undefined;
          if (preset && !GROW_PRESETS[preset]) {
            throw new CatalogError(400, 'preset must be quick, nightly, or overnight');
          }
          const started = await startRefreshJob({
            mode: refreshMode,
            preset,
            detach: body.detach === true,
          });
          if (!started.ok) {
            if (started.busy) {
              sendJson(res, 409, {
                ok: false,
                error: started.error,
                active_run_id: started.active_run_id,
              });
              return;
            }
            throw new CatalogError(started.busy ? 409 : 400, started.error);
          }
          if (started.mode !== 'background') {
            throw new CatalogError(500, 'refresh job failed to start');
          }
          const level = getRefreshLevel(started.level);
          sendJson(res, 202, {
            ok: true,
            mode: 'background',
            refresh_mode: refreshMode,
            preset: preset ?? 'nightly',
            level: started.level,
            run_id: started.run_id,
            state: started.state,
            estimated_sec: level?.estimated_sec,
            estimated_label: level?.estimated_label,
            blocks_couch: level?.blocks_couch,
            category: level?.category,
            llm_hint: level?.llm_hint,
            detach_supported: level?.detach_supported,
          });
          return;
        }

        if (!levelId || typeof levelId !== 'string') {
          throw new CatalogError(400, 'POST /playability/refresh requires { level } or { mode, preset? }');
        }
        const resolvedLevel = resolveRefreshLevelId(levelId);
        const level = resolvedLevel ? getRefreshLevel(resolvedLevel) : null;
        if (!level) {
          throw new CatalogError(400, `unknown refresh level: ${levelId}`);
        }
        const started = await startRefreshLevel(levelId);
        if (!started.ok) {
          if (started.busy) {
            sendJson(res, 409, {
              ok: false,
              error: started.error,
              active_run_id: started.active_run_id,
            });
            return;
          }
          throw new CatalogError(started.busy ? 409 : 400, started.error);
        }
        if (started.mode === 'inline') {
          const sessionId = core.reshufflePlayabilitySession();
          sendJson(res, 200, {
            ok: true,
            level: started.level,
            requested_level: levelId !== started.level ? levelId : undefined,
            mode: 'inline',
            session_id: sessionId,
            estimated_sec: level.estimated_sec,
          });
          return;
        }
        sendJson(res, 202, {
          ok: true,
          level: started.level,
          requested_level: levelId !== started.level ? levelId : undefined,
          mode: 'background',
          run_id: started.run_id,
          state: started.state,
          estimated_sec: level.estimated_sec,
          estimated_label: level.estimated_label,
          blocks_couch: level.blocks_couch,
          category: level.category,
          llm_hint: level.llm_hint,
          detach_supported: level.detach_supported,
        });
        return;
      }

      if (req.method === 'POST' && parts.length === 3 && parts[0] === 'playability' && parts[1] === 'session' && parts[2] === 'reshuffle') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'session reshuffle is localhost-only');
        }
        const sessionId = core.reshufflePlayabilitySession();
        sendJson(res, 200, { ok: true, session_id: sessionId });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'playability' && parts[1] === 'status') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'playability status is localhost-only');
        }
        sendJson(res, 200, {
          ...await core.playabilityStatus(),
          playback_terminal: getRecentPlayRequestTerminalSummary(),
          policy: {
            ...PLAYABILITY_POLICY.policy,
            policy_hash: PLAYABILITY_POLICY.policy_hash,
          },
          runs: (() => {
            const history = listPlayabilityRunReceipts();
            return {
              current: history.find((run) => run.state === 'claimed') ?? null,
              last: history[0] ?? null,
              history,
            };
          })(),
        });
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'playability' && parts[1] === 'invalidate') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'playability invalidate is localhost-only');
        }
        const body = await readBody(req);
        if (!body.type || !body.id) {
          throw new CatalogError(400, 'POST /playability/invalidate requires {type,id}');
        }
        await invalidateTitle({
          rail_id: body.rail_id,
          type: body.type,
          id: body.id,
          reason: body.reason || 'manual',
        });
        core.invalidateStreams(body.type, body.id);
        if (body.reason === 'play_failure') {
          core.reshufflePlayabilitySession();
        } else {
          core.clearRailItemsCache(body.rail_id ?? undefined);
        }
        sendJson(res, 200, { ok: true, type: body.type, id: body.id });
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'rails' && parts[1] === 'items') {
        const tab = parseCatalogTab(url.searchParams.get('tab'));
        if (!tab) {
          throw new CatalogError(400, 'GET /rails/items requires tab=movies|series|live');
        }
        const reshuffle = url.searchParams.get('reshuffle') === '1'
          || url.searchParams.get('reshuffle') === 'true';
        const expectedPersonalization = tab === 'live'
          ? null
          : parseExpectedPersonalization(url.searchParams);
        sendJson(res, 200, await core.tabRailItems(tab, {
          reshuffle,
          expectedPersonalization,
        }));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'rails' && parts[2] === 'items') {
        sendJson(res, 200, await core.railItems(parts[1]));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'rails' && parts[2] === 'related') {
        const exclude = parseTitleExcludeQuery(url.searchParams.get('exclude'));
        const limit = Number(url.searchParams.get('limit') || 8);
        sendJson(res, 200, await core.railRelated(
          parts[1],
          exclude,
          Number.isFinite(limit) ? limit : 8,
        ));
        return;
      }

      if (req.method === 'GET' && parts.length === 4 && parts[0] === 'catalog' && parts[3] === 'related') {
        const contentType = parts[1];
        const contentId = normalizeResourceId(parts[2]);
        const exclude = parseTitleExcludeQuery(url.searchParams.get('exclude'));
        const limit = Number(url.searchParams.get('limit') || 8);
        sendJson(res, 200, await core.contentRelated(
          contentType,
          contentId,
          url.searchParams.get('rail_id'),
          exclude,
          Number.isFinite(limit) ? limit : 8,
        ));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'meta') {
        const contentType = parts[1];
        const contentId = normalizeResourceId(parts[2]);
        try {
          const meta = await core.metaCached(contentType, contentId);
          sendJson(res, 200, await withVerifyStateForLauncher(enrichMetaForLauncher(meta, contentId), contentType, contentId));
        } catch (error) {
          const stub = stubMetaForLauncher(contentType, contentId);
          if (stub) {
            sendJson(res, 200, await withVerifyStateForLauncher(stub, contentType, contentId));
            return;
          }
          throw error;
        }
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'series' && parts[2] === 'episodes') {
        sendJson(res, 200, await core.seriesEpisodes(normalizeResourceId(parts[1])));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'stream') {
        const overrides = parseFilterOverridesFromQuery(url.searchParams);
        const existingOnly = url.searchParams.get('existing_only') === '1';
        sendJson(res, 200, await core.streams(parts[1], normalizeResourceId(parts[2]), overrides, {
          existingOnly,
          identityHint: {
            title: url.searchParams.get('title') || undefined,
            year: url.searchParams.get('year') || undefined,
          },
        }));
        return;
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'play' && parts[1] === 'next-prompt') {
        const expectedPersonalization = parseExpectedPersonalization(url.searchParams);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before next-episode prompt loaded',
        );
        const pending = takePendingNextPrompt();
        if (!pending) {
          sendJson(res, 200, {
            show: false,
            profile_id: personalization.active_profile_id,
            personalization_updated_at: personalization.updated_at,
          });
          return;
        }
        const episodes = await core.seriesEpisodes(pending.series_id);
        sendJson(res, 200, {
          ...buildNextPromptResponse(
            pending,
            episodes.seasons,
            episodes.name,
          ),
          profile_id: personalization.active_profile_id,
          personalization_updated_at: personalization.updated_at,
        });
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'play-session') {
        const body = await readBody(req);
        const expectedPersonalization = parseExpectedPersonalizationBody(body);
        const personalization = getPersonalizationState();
        assertExpectedPersonalization(
          expectedPersonalization,
          personalization,
          'before playback accepted',
        );
        touchCouchActivity('catalog', body.source === 'youtube' ? 'youtube_play' : 'play');
        const overrides = parseFilterOverridesFromQuery(url.searchParams);
        const started = await startPlaybackSession(
          core,
          youtube,
          body,
          overrides,
          expectedPersonalization,
        );
        sendJson(res, started.created ? 202 : 200, {
          ok: true,
          accepted: true,
          created: started.created,
          session: started.session,
          profile_id: personalization.active_profile_id,
          personalization_updated_at: personalization.updated_at,
        });
        return;
      }

      if (parts.length >= 3 && parts[0] === 'play-session'
        && parts[1] === 'active' && parts[2] === 'streams') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'active stream controls are localhost-only');
        }
        if (!activeStreams) {
          throw new CatalogError(503, 'active stream controls are unavailable');
        }
        if (req.method === 'GET' && parts.length === 3) {
          const afterRevision = Number(url.searchParams.get('after_revision') || 0);
          const waitMs = Number(url.searchParams.get('wait_ms') || 0);
          sendJson(res, 200, {
            ok: true,
            streams: await activeStreams.state(
              Number.isFinite(afterRevision) ? afterRevision : 0,
              Number.isFinite(waitMs) ? waitMs : 0,
            ),
          });
          return;
        }
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'switch') {
          const body = await readBody(req) as Record<string, unknown>;
          try {
            const streams = await activeStreams.beginSwitch({
              sessionId: String(body.session_id || ''),
              revision: Number(body.revision),
              candidateId: String(body.candidate_id || ''),
              undo: body.undo === true,
            });
            sendJson(res, 202, { ok: true, accepted: true, streams });
          } catch (error) {
            if (error instanceof ActiveStreamConflictError) {
              throw new CatalogError(409, error.message);
            }
            throw error;
          }
          return;
        }
        if (req.method === 'POST' && parts.length === 4 && parts[3] === 'issue') {
          const body = await readBody(req) as Record<string, unknown>;
          try {
            const streams = await activeStreams.reportIssue({
              sessionId: String(body.session_id || ''),
              revision: Number(body.revision),
              reason: typeof body.reason === 'string' ? body.reason : undefined,
            });
            sendJson(res, 200, { ok: true, streams });
          } catch (error) {
            if (error instanceof ActiveStreamConflictError) {
              throw new CatalogError(409, error.message);
            }
            throw error;
          }
          return;
        }
        if (req.method === 'POST' && parts.length === 5
          && parts[3] === 'issue' && parts[4] === 'undo') {
          const body = await readBody(req) as Record<string, unknown>;
          try {
            const streams = await activeStreams.undoIssue({
              sessionId: String(body.session_id || ''),
              revision: Number(body.revision),
            });
            sendJson(res, 200, { ok: true, streams });
          } catch (error) {
            if (error instanceof ActiveStreamConflictError) {
              throw new CatalogError(409, error.message);
            }
            throw error;
          }
          return;
        }
      }

      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'play-session') {
        const sessionId = normalizePlayRequestId(parts[1]);
        if (!sessionId) {
          throw new CatalogError(400, 'invalid playback session id');
        }
        let session = await getPlaybackSession(sessionId);
        if (!session) {
          throw new CatalogError(404, 'playback session not found');
        }
        if (session.ever_ready && session.state === 'playing' && !await isMpvActive()) {
          session = await transitionPlaybackSession(sessionId, 'stopped') ?? session;
        }
        const afterVersion = Number(url.searchParams.get('after') || 0);
        const waitMs = Number(url.searchParams.get('wait_ms') || 0);
        if (Number.isFinite(afterVersion) && Number.isFinite(waitMs)
          && session.version <= afterVersion && waitMs > 0) {
          session = await waitForPlaybackSession(sessionId, afterVersion, waitMs) ?? session;
        }
        sendJson(res, 200, { ok: true, session });
        return;
      }

      if (req.method === 'POST' && parts.length === 2
        && parts[0] === 'play-session' && parts[1] === 'cancel') {
        const body = await readBody(req);
        const requestId = normalizePlayRequestId(body.request_id);
        if (!requestId) {
          throw new CatalogError(400, 'POST /play-session/cancel requires request_id');
        }
        const session = await getPlaybackSession(requestId);
        if (!session) {
          sendJson(res, 200, { ok: true, cancelled: false, request_id: requestId });
          return;
        }
        await transitionPlaybackSession(requestId, 'cancelled');
        const cancelled = await cancelPlayRequest(requestId);
        await flushWatchProgress();
        sendJson(res, 200, { ok: true, ...cancelled, request_id: requestId });
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'play') {
        const deadline = createPlayDeadline();
        const body = await readBody(req);
        // The compatibility /play route bypasses startPlaybackSession, so it
        // must capture attribution ownership here as well. Never trust a
        // caller-supplied profile id for recommendation outcomes.
        const acceptedAttribution = playbackRecommendationAttributionFromBody(body, 'vod');
        body.recommendation_profile_id = acceptedAttribution?.profile_id
          ?? recommendationOwnerForRollout('vod', activeViewerProfileId());
        touchCouchActivity('catalog', 'play');
        const overrides = parseFilterOverridesFromQuery(url.searchParams);
        const requestId = normalizePlayRequestId(body.request_id);
        let requestEpoch: number | undefined;
        let requestSucceeded = false;
        try {
          const result = await handlePlay(
            core,
            body,
            overrides,
            deadline,
            requestId,
            (epoch) => { requestEpoch = epoch; },
            undefined,
            acceptedAttribution,
          );
          requestSucceeded = true;
          sendJson(res, 200, result);
        } catch (error) {
          if (error instanceof CatalogError) {
            throw new CatalogError(
              error.status,
              error.message,
              publicPlayFailureDetails(error.details),
              { couchMessage: error.couchMessage },
            );
          }
          throw error;
        } finally {
          if (requestEpoch !== undefined) {
            finishPlayRequest(requestId, requestEpoch, requestSucceeded);
          }
        }
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'progress' && parts[1] === 'flush') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'progress flush is localhost-only');
        }
        const flushed = await flushWatchProgress();
        // Launcher startup performs a defensive empty flush. Only a flush that
        // actually persisted an active/last playback snapshot is couch
        // activity; otherwise every restart suppresses maintenance for the
        // full idle window despite no person or playback being present.
        if (flushed) touchCouchActivity('catalog', 'progress_flush');
        sendJson(res, 200, { ok: true, flushed });
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'play-cancel') {
        touchCouchActivity('catalog', 'play_cancel');
        const body = await readBody(req);
        const requestId = normalizePlayRequestId(body.request_id);
        const cancelled = await cancelPlayRequest(requestId);
        await flushWatchProgress();
        sendJson(res, 200, { ok: true, ...cancelled, request_id: requestId });
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    })().catch((error) => sendError(res, error));
  });

  server.listen(PORT, HOST, () => {
    console.log(`catalog-service listening http://${HOST}:${PORT}`);
    console.log(JSON.stringify(core.health()));
    void core.warmBrowseTabs()
      .then(() => console.log('catalog-service browse tabs warmed'))
      .catch(() => undefined);
  });
}

main().catch((error) => {
  console.error(`catalog-service failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
