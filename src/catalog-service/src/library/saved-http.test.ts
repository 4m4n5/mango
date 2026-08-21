import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type SavedItem = {
  source: string;
  item_key: string;
  type: string;
  id: string;
  title: string;
  poster: string | null;
  year: string | null;
  description: string | null;
  tab: string;
  saved_at: number;
  saved_by: string;
};

type SavedResponse = {
  ok: boolean;
  saved: SavedItem[];
};

type SaveResponse = {
  ok: boolean;
  saved: SavedItem;
  state: {
    saved: boolean;
    tab: string;
  };
};

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('test server did not bind a TCP port'));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function availablePort(): Promise<number> {
  const reservation = http.createServer();
  const port = await listen(reservation);
  await close(reservation);
  return port;
}

function waitUntilListening(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => {
      reject(new Error(`catalog-service startup timed out:\n${output}`));
    }, 20_000);
    timeout.unref();

    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      child.stdout.off('data', onOutput);
      child.stderr.off('data', onOutput);
      child.off('error', onError);
      child.off('exit', onExit);
      if (error) reject(error);
      else resolve();
    };
    const onOutput = (chunk: Buffer): void => {
      output += chunk.toString();
      if (output.includes('catalog-service listening')) finish();
    };
    const onError = (error: Error): void => finish(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      finish(new Error(
        `catalog-service exited before listening (code=${String(code)}, signal=${String(signal)}):\n${output}`,
      ));
    };

    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2_000);
    timeout.unref();
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json() as T;
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

test('Saved HTTP API keeps a movie submitted from the TV Shows tab out of the series rail', {
  timeout: 30_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'mango-saved-http-'));
  const addonServer = http.createServer((request, response) => {
    if (request.url !== '/manifest.json') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      id: 'org.mango.saved-http-test',
      version: '1.0.0',
      name: 'Saved HTTP fixture',
      description: 'No-resource fixture for catalog-service route tests',
      resources: [],
      types: ['movie', 'series'],
      catalogs: [],
    }));
  });
  const addonPort = await listen(addonServer);
  const catalogPort = await availablePort();
  const exportPath = join(directory, 'addons.json');
  const configPath = join(directory, 'config.yaml');
  const filtersPath = join(directory, 'filters.json');
  const railsPath = join(directory, 'catalog.yaml');
  const aiCatalogsPath = join(directory, 'ai-catalogs');
  mkdirSync(aiCatalogsPath);
  writeFileSync(exportPath, JSON.stringify({
    addons: [{
      name: 'Saved HTTP fixture',
      manifestUrl: `http://127.0.0.1:${addonPort}/manifest.json`,
    }],
  }));
  writeFileSync(configPath, 'youtube:\n  enabled: false\n');
  writeFileSync(filtersPath, '{}\n');
  writeFileSync(railsPath, 'version: 1\nrails: []\n');

  const serviceEntry = fileURLToPath(new URL('../index.js', import.meta.url));
  const child = spawn(process.execPath, [serviceEntry], {
    env: {
      ...process.env,
      XDG_CACHE_HOME: join(directory, 'cache'),
      MANGO_CATALOG_HOST: '127.0.0.1',
      MANGO_CATALOG_PORT: String(catalogPort),
      MANGO_STREMIO_EXPORT: exportPath,
      MANGO_CONFIG: configPath,
      MANGO_CATALOG_FILTERS: filtersPath,
      MANGO_CATALOG_YAML: railsPath,
      MANGO_CATALOG_LIVE_YAML: join(directory, 'missing-live.yaml'),
      MANGO_AI_CATALOGS_DIR: aiCatalogsPath,
      MANGO_LIBRARY_DB_PATH: join(directory, 'library.db'),
      MANGO_USER_PINS_PATH: join(directory, 'user-pins.json'),
      MANGO_PROGRESS_DB_PATH: join(directory, 'progress.db'),
      MANGO_PLAYABILITY_DB: join(directory, 'playability.db'),
      MANGO_YOUTUBE_DB_PATH: join(directory, 'youtube.db'),
      MANGO_ACTIVE_STREAMS_PATH: join(directory, 'active-streams.json'),
      MANGO_MEDIAFUSION_MANIFEST: join(directory, 'missing-mediafusion.manifest'),
      MANGO_PLAYBACK_CAPABILITY_PROFILE: 'test-headless',
      MANGO_VOD_RECS_V2: 'off',
      MANGO_VOD_BROWSE_V3: 'off',
      MANGO_YOUTUBE_RECS_V2: 'off',
      MANGO_YOUTUBE: '0',
      MANGO_TRIGGER_CONSUMER: '0',
      MANGO_TMDB_METADATA: 'off',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    await waitUntilListening(child);
    const origin = `http://127.0.0.1:${catalogPort}`;
    const saved = await jsonResponse<SaveResponse>(await fetch(`${origin}/library/saved`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: 'mango',
        type: 'movie',
        id: 'tt1160419',
        title: 'Dune',
        tab: 'series',
      }),
    }));
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.saved, {
      source: 'mango',
      item_key: 'mango:movie:tt1160419',
      type: 'movie',
      id: 'tt1160419',
      title: 'Dune',
      poster: null,
      year: null,
      description: null,
      tab: 'movies',
      saved_at: saved.saved.saved_at,
      saved_by: 'user',
    });
    assert.equal(saved.state.saved, true);
    assert.equal(saved.state.tab, 'movies');

    const seriesRail = await jsonResponse<SavedResponse>(
      await fetch(`${origin}/library/saved?tab=series`),
    );
    assert.equal(seriesRail.ok, true);
    assert.deepEqual(seriesRail.saved, []);

    const moviesRail = await jsonResponse<SavedResponse>(
      await fetch(`${origin}/library/saved?tab=movies`),
    );
    assert.equal(moviesRail.ok, true);
    assert.equal(moviesRail.saved.length, 1);
    assert.equal(moviesRail.saved[0]?.id, 'tt1160419');
    assert.equal(moviesRail.saved[0]?.type, 'movie');
    assert.equal(moviesRail.saved[0]?.tab, 'movies');
  } finally {
    await stop(child);
    await close(addonServer);
    rmSync(directory, { recursive: true, force: true });
  }
});
