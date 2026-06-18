#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const EXPORT_PATH = process.argv[2] || '/etc/mango/stremio-export.json';
const MANIFEST_TIMEOUT_MS = Number(process.env.MANGO_CORE_SPIKE_MANIFEST_TIMEOUT_MS || 12000);

function normalizeAddons(data) {
  const raw = Array.isArray(data?.addons)
    ? data.addons
    : Array.isArray(data?.addons?.addons)
      ? data.addons.addons
      : [];
  return raw
    .map((addon) => {
      const manifest = typeof addon.manifest === 'object' && addon.manifest !== null
        ? addon.manifest
        : {};
      const manifestUrl = addon.manifestUrl || addon.transportUrl || addon.url;
      const name = addon.name || manifest.name || (manifestUrl ? new URL(manifestUrl).hostname : 'unknown');
      return manifestUrl ? { name: String(name), manifestUrl: String(manifestUrl) } : null;
    })
    .filter(Boolean);
}

async function loadExport(path) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  const addons = normalizeAddons(data);
  if (addons.length === 0) {
    throw new Error(`${path} has no addons with manifest URLs`);
  }
  return addons;
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function installNodeShims() {
  const realFetch = globalThis.fetch;
  globalThis.self = globalThis;
  globalThis.document = { baseURI: 'file:///' };
  globalThis.navigator ??= { language: 'en-US' };
  globalThis.WorkerGlobalScope ??= Object;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url;
    if (typeof url === 'string' && url.startsWith('http://127.0.0.1:11470/')) {
      const path = new URL(url).pathname;
      const body = path === '/device-info'
        ? { os: 'linux', arch: process.arch, shell: 'mango-n1-spike' }
        : path === '/network-info'
          ? { available: true }
          : path === '/casting'
            ? { devices: [] }
            : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input, init);
  };
  const store = new Map();
  globalThis.get_location_hash = async () => '';
  globalThis.local_storage_get_item = async (key) => store.get(key) ?? null;
  globalThis.local_storage_set_item = async (key, value) => {
    store.set(key, value);
    return null;
  };
  globalThis.local_storage_remove_item = async (key) => {
    store.delete(key);
    return null;
  };
}

async function bootCore() {
  installNodeShims();
  const packageJsonPath = require.resolve('@stremio/stremio-core-web/package.json');
  const wasmPath = require.resolve('@stremio/stremio-core-web/stremio_core_web_bg.wasm');
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
  const core = require('@stremio/stremio-core-web');
  const wasmBytes = await readFile(wasmPath);

  await core.default({ module_or_path: wasmBytes });
  await core.initialize_runtime((event) => {
    if (process.env.MANGO_CORE_SPIKE_EVENTS === '1') {
      console.log(`core_event ${JSON.stringify(event).slice(0, 500)}`);
    }
  });
  return {
    version: packageJson.version,
    packageDir: dirname(packageJsonPath),
    runtimeStateType: 'initialized',
  };
}

async function loadManifests(addons) {
  const rows = [];
  for (const addon of addons) {
    const manifest = await fetchJson(addon.manifestUrl, MANIFEST_TIMEOUT_MS);
    rows.push({
      name: manifest.name || addon.name,
      version: manifest.version || '',
      resources: Array.isArray(manifest.resources) ? manifest.resources.map((resource) => {
        if (typeof resource === 'string') return resource;
        return resource.name || 'unknown';
      }) : [],
      types: Array.isArray(manifest.types) ? manifest.types : [],
    });
  }
  return rows;
}

async function main() {
  const addons = await loadExport(EXPORT_PATH);
  const core = await bootCore();
  const manifests = await loadManifests(addons);
  const names = manifests.map((manifest) => manifest.name.toLowerCase()).join(' ');

  if (!names.includes('cinemeta')) {
    throw new Error('Cinemeta manifest missing from export');
  }
  if (!names.includes('torrentio') && !names.includes('aiostreams') && !names.includes('aio')) {
    throw new Error('No stream addon manifest matched Torrentio/AIOStreams');
  }

  console.log(`stremio-core ready version=${core.version} state=${core.runtimeStateType}`);
  console.log(`addon manifests loaded count=${manifests.length}`);
  for (const manifest of manifests) {
    console.log(`addon name="${manifest.name}" resources=${manifest.resources.join(',') || '-'} types=${manifest.types.join(',') || '-'}`);
  }
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(`FAIL: ${error.message || error}`);
  process.exit(1);
});
