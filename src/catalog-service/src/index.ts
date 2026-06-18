import http from 'node:http';
import { CatalogCore, CatalogError } from './core.js';
import { playUrl } from './mpv.js';

const HOST = process.env.MANGO_CATALOG_HOST || '127.0.0.1';
const PORT = Number(process.env.MANGO_CATALOG_PORT || 3020);
const BODY_LIMIT = 64 * 1024;

type PlayBody = {
  type?: string;
  id?: string;
  url?: string;
};

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
    sendJson(res, error.status, { error: error.message });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 500, { error: message });
}

function routeParts(url: URL): string[] {
  return url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
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

async function handlePlay(core: CatalogCore, body: PlayBody): Promise<Record<string, unknown>> {
  let playUrlValue = body.url;
  let streamInfo: Record<string, unknown> | undefined;

  if (!playUrlValue) {
    if (!body.type || !body.id) {
      throw new CatalogError(400, 'POST /play requires {url} or {type,id}');
    }
    const result = await core.streams(body.type, body.id);
    const stream = result.streams[0];
    if (!stream) {
      throw new CatalogError(502, `no playable stream for ${body.type}/${body.id}`);
    }
    playUrlValue = stream.url;
    streamInfo = {
      source: stream.source,
      title: stream.title,
      quality: stream.quality,
      resolve_ms: result.resolve_ms,
    };
  }

  if (!/^https?:\/\//i.test(playUrlValue)) {
    throw new CatalogError(400, 'play url must be http(s)');
  }

  const playback = await playUrl(playUrlValue);
  return { ...playback, stream: streamInfo };
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

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'meta') {
        sendJson(res, 200, await core.meta(parts[1], parts[2]));
        return;
      }

      if (req.method === 'GET' && parts.length === 3 && parts[0] === 'stream') {
        sendJson(res, 200, await core.streams(parts[1], parts[2]));
        return;
      }

      if (req.method === 'POST' && parts.length === 1 && parts[0] === 'play') {
        sendJson(res, 200, await handlePlay(core, await readBody(req)));
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
