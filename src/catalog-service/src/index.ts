import http from 'node:http';
import { CatalogCore, CatalogError } from './core.js';
import { couchPlayFailureMessage } from './catalog-errors.js';
import { playUrl } from './mpv.js';
import { playWithLadder } from './play-orchestrator.js';
import { bumpPlayEpoch, PlayCancelledError } from './play-cancel.js';
import { invalidateTitle, getTitleVerifyProfile, recordVerifyResult } from './playability/db.js';
import { seriesBareId } from './playability/ids.js';
import { playabilityVerifyTtlMs } from './playability/config.js';
import { initProgressDb, getWatchProgressForTitle } from './progress/db.js';
import { resolvePosterFromMeta } from './poster.js';
import { flushWatchProgress, startWatchSessionFromPlay } from './progress/watcher.js';
import { resolveSeriesPlayTarget } from './series-play.js';
import {
  getRefreshLevel,
  listRefreshLevels,
  startRefreshLevel,
} from './playability/refresh-control.js';
import { parseCatalogTab } from './rails.js';
import {
  addUserPin,
  listUserPins,
  removeUserPin,
} from './user-pins.js';
import { streamUrlHash } from './stream-filters.js';
import {
  parseFilterOverridesFromQuery,
  type StreamFilterOverrides,
} from './stream-filters.js';

const HOST = process.env.MANGO_CATALOG_HOST || '127.0.0.1';
const PORT = Number(process.env.MANGO_CATALOG_PORT || 3020);
const BODY_LIMIT = 64 * 1024;

type PlayBody = StreamFilterOverrides & {
  type?: string;
  id?: string;
  rail_id?: string;
  reason?: string;
  url?: string;
  /** Picker row — prefer this stream in the play ladder (ideal step first). */
  prefer_url?: string;
  /** Resume playback at this position (seconds). */
  start_sec?: number;
  /** Lookup saved progress for {type,id} and resume. */
  resume?: boolean;
  /** Live IPTV channel — skip VOD ladder and min-duration probe. */
  live?: boolean;
  language?: string | null;
  level?: string;
};

function playPickHint(preferUrl: string | undefined): import('./stream-filters.js').VerifiedStreamHint | undefined {
  if (!preferUrl || !/^https?:\/\//i.test(preferUrl)) {
    return undefined;
  }
  return {
    win_url_hash: streamUrlHash(preferUrl),
    win_ladder_step: 'ideal',
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
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 500, { error: 'catalog temporarily unavailable' });
}

function routeParts(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
}

function isLocalRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
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

async function attachWatchSession(core: CatalogCore, type: string, playId: string): Promise<void> {
  try {
    const metaId = type === 'series' ? (seriesBareId(playId) || playId) : playId;
    const meta = await core.meta(type, metaId);
    await startWatchSessionFromPlay({
      type,
      id: playId,
      title: typeof meta.name === 'string' ? meta.name : null,
      poster: resolvePosterFromMeta(meta),
    });
  } catch {
    await startWatchSessionFromPlay({ type, id: playId });
  }
}

async function handlePlay(
  core: CatalogCore,
  body: PlayBody,
  queryOverrides: StreamFilterOverrides = {},
): Promise<Record<string, unknown>> {
  let playUrlValue = body.url;

  if (playUrlValue) {
    if (!/^https?:\/\//i.test(playUrlValue)) {
      throw new CatalogError(400, 'play url must be http(s)');
    }
    const started = Date.now();
    const startSec = typeof body.start_sec === 'number' && body.start_sec > 0
      ? body.start_sec
      : undefined;
    const playback = await playUrl(playUrlValue, 90000, { startSec });
    if (body.type && body.id) {
      await attachWatchSession(core, body.type, body.id);
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
    const started = Date.now();
    const playEpoch = await bumpPlayEpoch();
    const resolved = await core.resolveForPlay(body.type, body.id, overrides);
    const stream = resolved.streams.find((candidate) => typeof candidate.url === 'string' && candidate.url)
      || resolved.streams[0];
    const streamUrl = typeof stream?.url === 'string' ? stream.url : '';
    if (!streamUrl) {
      throw new CatalogError(502, 'no_playable_stream');
    }
    const playback = await playUrl(streamUrl, 90000, { live: true, playEpoch });
    return {
      ok: playback.ok,
      live: true,
      ttff_ms: playback.ttff_ms,
      total_ms: Date.now() - started,
      attempts: 1,
      play_id: body.id,
      stream: {
        url: streamUrl,
        source: typeof stream.source === 'string' ? stream.source : undefined,
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
  const saved = getWatchProgressForTitle(body.type, body.id);
  const playTarget = resolveSeriesPlayTarget(body.type, body.id, {
    saved,
    resume: body.resume,
    startSec,
  });
  playId = playTarget.playId;
  startSec = playTarget.startSec;

  const playEpoch = await bumpPlayEpoch();
  const now = Date.now();
  const profile = await getTitleVerifyProfile(body.type, playId);
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
  const pickerHint = playPickHint(body.prefer_url);
  const verifiedHint = pickerHint
    ? { ...profileHint, ...pickerHint }
    : profileHint;

  const resolved = await core.resolveForPlay(body.type, playId, overrides);

  try {
    const playback = await playWithLadder(resolved.streams, resolved.filters, {
      contentType: body.type,
      filterContext: resolved.filterContext,
      verified_hint: verifiedHint,
      playEpoch,
      startSec,
    });

    await recordVerifyResult({
      type: body.type,
      id: playId,
      status: 'verified',
      rail_id: body.rail_id ?? null,
      best_source: typeof playback.stream.source === 'string' ? playback.stream.source : null,
      cache_status: typeof playback.stream.cache_status === 'string' ? playback.stream.cache_status : null,
      debrid_service: typeof playback.stream.debrid_service === 'string' ? playback.stream.debrid_service : null,
      probe_ms: playback.ttff_ms,
      win_url_hash: playback.win_url_hash,
      win_ladder_step: playback.win_ladder_step,
      expires_at: Date.now() + playabilityVerifyTtlMs(),
      stage: 'play',
      outcome: 'verified',
    }).catch((writeError) => {
      console.warn(
        `playability refresh on play failed type=${body.type} id=${body.id}: ${
          writeError instanceof Error ? writeError.message : String(writeError)
        }`,
      );
    });

    await attachWatchSession(core, body.type, playId);

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
    };
  } catch (error) {
    if (error instanceof PlayCancelledError) {
      throw new CatalogError(499, 'play cancelled');
    }
    const details = error instanceof CatalogError
      ? (error.details as { attempts?: unknown[]; candidates?: number } | undefined)
      : undefined;
    const attempts = details?.attempts;
    const probedStreams = Array.isArray(attempts) && attempts.length > 0;
    if (probedStreams) {
      await invalidateTitle({
        rail_id: body.rail_id,
        type: body.type,
        id: playId,
        reason: 'play_failure',
        preserve_session: true,
      }).catch((invalidateError) => {
        console.warn(
          `playability invalidate failed type=${body.type} id=${body.id}: ${
            invalidateError instanceof Error ? invalidateError.message : String(invalidateError)
          }`,
        );
      });
    }
    if (error instanceof CatalogError) {
      if (error.message === 'no_playable_stream') {
        error.couchMessage = couchPlayFailureMessage(
          details?.attempts as Array<{ error?: string }> | undefined,
        );
      }
      error.details = {
        ...(error.details || {}),
        filters: {
          applied: resolved.filters,
          play_ladder: resolved.filters.play_ladder.map((step) => step.step),
        },
      };
    }
    throw error;
  }
}

async function main(): Promise<void> {
  await initProgressDb();
  const core = await CatalogCore.create();
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      const parts = routeParts(url);

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

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'health') {
        sendJson(res, 200, core.health());
        return;
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
        sendJson(res, 200, { ok: true, levels: listRefreshLevels() });
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'playability' && parts[1] === 'refresh') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'playability refresh is localhost-only');
        }
        const body = await readBody(req);
        const levelId = body.level;
        if (!levelId || typeof levelId !== 'string') {
          throw new CatalogError(400, 'POST /playability/refresh requires { level }');
        }
        const level = getRefreshLevel(levelId);
        if (!level) {
          throw new CatalogError(400, `unknown refresh level: ${levelId}`);
        }
        const started = await startRefreshLevel(levelId);
        if (!started.ok) {
          throw new CatalogError(started.busy ? 409 : 400, started.error);
        }
        if (started.mode === 'inline') {
          const sessionId = core.reshufflePlayabilitySession();
          sendJson(res, 200, {
            ok: true,
            level: levelId,
            mode: 'inline',
            session_id: sessionId,
            estimated_sec: level.estimated_sec,
          });
          return;
        }
        sendJson(res, 202, {
          ok: true,
          level: levelId,
          mode: 'background',
          pid: started.pid,
          estimated_sec: level.estimated_sec,
          blocks_couch: level.blocks_couch,
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
        sendJson(res, 200, await core.playabilityStatus());
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
        core.clearRailItemsCache(body.rail_id ?? undefined);
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
        sendJson(res, 200, await core.tabRailItems(tab, { reshuffle }));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'rails' && parts[2] === 'items') {
        sendJson(res, 200, await core.railItems(parts[1]));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'meta') {
        sendJson(res, 200, await core.meta(parts[1], parts[2]));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'series' && parts[2] === 'episodes') {
        sendJson(res, 200, await core.seriesEpisodes(parts[1]));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'stream') {
        const overrides = parseFilterOverridesFromQuery(url.searchParams);
        sendJson(res, 200, await core.streams(parts[1], parts[2], overrides));
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'play') {
        const body = await readBody(req);
        const overrides = parseFilterOverridesFromQuery(url.searchParams);
        sendJson(res, 200, await handlePlay(core, body, overrides));
        return;
      }

      if (req.method === 'POST' && parts.length === 2 && parts[0] === 'progress' && parts[1] === 'flush') {
        if (!isLocalRequest(req)) {
          throw new CatalogError(403, 'progress flush is localhost-only');
        }
        const flushed = await flushWatchProgress();
        sendJson(res, 200, { ok: true, flushed });
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'play-cancel') {
        await bumpPlayEpoch();
        await flushWatchProgress();
        sendJson(res, 200, { ok: true, cancelled: true });
        return;
      }

      sendJson(res, 404, { error: 'not found' });
    })().catch((error) => sendError(res, error));
  });

  server.listen(PORT, HOST, () => {
    console.log(`catalog-service listening http://${HOST}:${PORT}`);
    console.log(JSON.stringify(core.health()));
  });
}

main().catch((error) => {
  console.error(`catalog-service failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
