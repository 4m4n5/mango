import http from 'node:http';
import { CatalogCore, CatalogError } from './core.js';
import { playUrl } from './mpv.js';
import { playWithFallback } from './play-orchestrator.js';
import { invalidateTitle, getTitleVerifyProfile } from './playability/db.js';
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
};

function filterOverridesFromBody(body: PlayBody): StreamFilterOverrides {
  const overrides: StreamFilterOverrides = {};
  if (body.include_uncached === true) overrides.include_uncached = true;
  if (typeof body.strict_unknown_cache === 'boolean') {
    overrides.strict_unknown_cache = body.strict_unknown_cache;
  }
  if (body.max_quality !== undefined) overrides.max_quality = body.max_quality;
  if (typeof body.exclude_remux === 'boolean') overrides.exclude_remux = body.exclude_remux;
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
    const playback = await playUrl(playUrlValue);
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
  const result = await core.streams(body.type, body.id, overrides);
  const now = Date.now();
  const profile = await getTitleVerifyProfile(body.type, body.id);
  const verifiedHint = profile?.status === 'verified'
    && (profile.expires_at === null || profile.expires_at > now)
    ? {
      best_source: profile.best_source,
      cache_status: profile.cache_status,
      debrid_service: profile.debrid_service,
      win_url_hash: profile.win_url_hash,
    }
    : undefined;
  try {
    const playback = await playWithFallback(result.streams, result.filters.applied, {
      allow_uncached_torbox: result.filters.torbox_uncached_fallback === true,
      allow_rd_safe_unknown: result.filters.rd_safe_unknown_fallback === true,
      contentType: body.type,
      verified_hint: verifiedHint,
    });
    return {
      ok: playback.ok,
      ttff_ms: playback.ttff_ms,
      total_ms: playback.total_ms,
      attempts: playback.attempts.length,
      candidate_count: playback.candidate_count,
      stream: {
        ...playback.stream,
        resolve_ms: result.resolve_ms,
        cached: result.cached,
      },
      filters: result.filters,
    };
  } catch (error) {
    await invalidateTitle({
      rail_id: body.rail_id,
      type: body.type,
      id: body.id,
      reason: 'play_failure',
    }).catch((invalidateError) => {
      console.warn(
        `playability invalidate failed type=${body.type} id=${body.id}: ${
          invalidateError instanceof Error ? invalidateError.message : String(invalidateError)
        }`,
      );
    });
    core.clearRailItemsCache(body.rail_id ?? undefined);
    if (error instanceof CatalogError) {
      error.details = {
        ...(error.details || {}),
        filters: result.filters,
      };
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const core = await CatalogCore.create();
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
      const parts = routeParts(url);

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'health') {
        sendJson(res, 200, core.health());
        return;
      }

      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'rails') {
        sendJson(res, 200, core.rails());
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

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'rails' && parts[2] === 'items') {
        sendJson(res, 200, await core.railItems(parts[1]));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'meta') {
        sendJson(res, 200, await core.meta(parts[1], parts[2]));
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
