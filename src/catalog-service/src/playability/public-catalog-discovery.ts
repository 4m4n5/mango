import { lookup as dnsLookup } from 'node:dns/promises';
import https from 'node:https';
import { isIP } from 'node:net';
import type { PlayabilityPolicy } from './policy.js';

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

type ResolvedAddress = { address: string; family: number };
type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
type TransportResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
type Transport = (url: URL, address: ResolvedAddress, maxBytes: number, timeoutMs: number) => Promise<TransportResponse>;

export type PublicCatalogDescriptor = {
  addon_id: string;
  addon_name: string;
  manifest_url: string;
  content_type: 'movie' | 'series';
  catalog_id: string;
};

export type PublicSourceLifecycleState = {
  state: 'sandbox' | 'canary' | 'promoted' | 'quarantined' | 'retired';
  successful_nights: number;
  unique_candidates: number;
  exact_main_wins: number;
  attempted_candidates: number;
  failed_recanaries: number;
  first_canary_at: number | null;
  quarantine_until: number | null;
  protocol_violations: number;
  consecutive_fetch_failures: number;
  candidates_since_exact_main_win: number;
};

function ipv4Private(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19));
}

export function isPublicNetworkAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !ipv4Private(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1') return false;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return false;
  if (/^fe[89ab]/.test(normalized)) return false;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  return mapped ? !ipv4Private(mapped) : true;
}

export function validatePublicMetadataUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('public catalog URL must use HTTPS');
  if (url.username || url.password) throw new Error('public catalog URL must not contain credentials');
  if (url.port && url.port !== '443') throw new Error('public catalog URL must use the standard HTTPS port');
  if (!url.hostname || url.hostname === 'localhost') throw new Error('public catalog URL hostname is not public');
  const literalHost = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literalHost) && !isPublicNetworkAddress(literalHost)) {
    throw new Error('public catalog URL uses a non-public address');
  }
  return url;
}

async function defaultResolver(hostname: string): Promise<ResolvedAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

async function pinnedHttpsTransport(
  url: URL,
  address: ResolvedAddress,
  maxBytes: number,
  timeoutMs: number,
): Promise<TransportResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'Mango-Metadata-Canary/1' },
      servername: url.hostname,
      lookup: (_hostname, _options, callback) => callback(null, address.address, address.family),
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new Error('public catalog response exceeds size limit'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('public catalog request timed out')));
    request.on('error', reject);
    request.end();
  });
}

export async function fetchIsolatedPublicJson(
  value: string,
  options: {
    resolver?: Resolver;
    transport?: Transport;
    maxBytes?: number;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const resolver = options.resolver ?? defaultResolver;
  const transport = options.transport ?? pinnedHttpsTransport;
  const maxBytes = Math.min(DEFAULT_MAX_BYTES, Math.max(1024, options.maxBytes ?? DEFAULT_MAX_BYTES));
  const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.max(250, options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  let url = validatePublicMetadataUrl(value);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const addresses = await resolver(url.hostname);
    if (addresses.length === 0 || addresses.some((entry) => !isPublicNetworkAddress(entry.address))) {
      throw new Error('public catalog DNS resolved to a non-public address');
    }
    const response = await transport(url, addresses[0], maxBytes, timeoutMs);
    if (Buffer.byteLength(response.body, 'utf8') > maxBytes) {
      throw new Error('public catalog response exceeds size limit');
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      const next = Array.isArray(location) ? location[0] : location;
      if (!next || redirects === MAX_REDIRECTS) throw new Error('public catalog redirect limit exceeded');
      url = validatePublicMetadataUrl(new URL(next, url).toString());
      continue;
    }
    if (response.status !== 200) throw new Error(`public catalog HTTP ${response.status}`);
    try {
      return JSON.parse(response.body);
    } catch {
      throw new Error('public catalog returned invalid JSON');
    }
  }
  throw new Error('public catalog redirect limit exceeded');
}

function supportsCatalog(resources: unknown): boolean {
  return Array.isArray(resources) && resources.some((resource) => (
    resource === 'catalog'
    || (resource && typeof resource === 'object' && (resource as { name?: unknown }).name === 'catalog')
  ));
}

/** Parse only catalog descriptors. Stream/subtitle resources are intentionally ignored. */
export function metadataCatalogsFromCommunityCollection(input: unknown): PublicCatalogDescriptor[] {
  if (!Array.isArray(input) || input.length > 1000) throw new Error('invalid community addon collection');
  const output: PublicCatalogDescriptor[] = [];
  for (const descriptor of input) {
    if (!descriptor || typeof descriptor !== 'object') continue;
    const row = descriptor as Record<string, unknown>;
    const manifest = row.manifest && typeof row.manifest === 'object'
      ? row.manifest as Record<string, unknown>
      : null;
    if (!manifest || !supportsCatalog(manifest.resources)) continue;
    const addonId = typeof manifest.id === 'string' ? manifest.id.slice(0, 128) : '';
    const addonName = typeof manifest.name === 'string' ? manifest.name.slice(0, 128) : addonId;
    const manifestUrl = typeof row.transportUrl === 'string' ? row.transportUrl : '';
    if (!addonId || !manifestUrl) continue;
    validatePublicMetadataUrl(manifestUrl);
    const catalogs = Array.isArray(manifest.catalogs) ? manifest.catalogs : [];
    for (const catalog of catalogs.slice(0, 100)) {
      if (!catalog || typeof catalog !== 'object') continue;
      const candidate = catalog as Record<string, unknown>;
      const type = candidate.type;
      const id = candidate.id;
      if ((type !== 'movie' && type !== 'series') || typeof id !== 'string' || !id || id.length > 128) continue;
      output.push({ addon_id: addonId, addon_name: addonName, manifest_url: manifestUrl, content_type: type, catalog_id: id });
    }
  }
  return output;
}

export function evaluatePublicSourceLifecycle(
  current: PublicSourceLifecycleState,
  observation: {
    successful_night: boolean;
    unique_candidates: number;
    attempted_candidates: number;
    exact_main_wins: number;
    protocol_violation?: boolean;
    recanary_failed?: boolean;
    fetch_failed?: boolean;
  },
  policy: PlayabilityPolicy['source_lifecycle'],
  now = Date.now(),
): PublicSourceLifecycleState {
  if (current.state === 'retired') return current;
  if (current.state === 'quarantined' && now < (current.quarantine_until ?? 0)) return current;
  const exactMainWins = Math.max(0, observation.exact_main_wins);
  const next = {
    ...current,
    successful_nights: current.successful_nights + (observation.successful_night ? 1 : 0),
    unique_candidates: current.unique_candidates + Math.max(0, observation.unique_candidates),
    attempted_candidates: current.attempted_candidates + Math.max(0, observation.attempted_candidates),
    exact_main_wins: current.exact_main_wins + exactMainWins,
    failed_recanaries: current.failed_recanaries + (observation.recanary_failed ? 1 : 0),
    first_canary_at: current.first_canary_at ?? now,
    protocol_violations: current.protocol_violations + (observation.protocol_violation ? 1 : 0),
    consecutive_fetch_failures: observation.fetch_failed
      ? (current.consecutive_fetch_failures ?? 0) + 1
      : 0,
    candidates_since_exact_main_win: exactMainWins > 0
      ? 0
      : (current.candidates_since_exact_main_win ?? 0) + Math.max(0, observation.attempted_candidates),
  };
  if (observation.protocol_violation) {
    return { ...next, state: 'quarantined', quarantine_until: now + policy.quarantine_days * 86_400_000 };
  }
  if (
    next.failed_recanaries >= policy.retire_failed_recanaries
    && now - (next.first_canary_at ?? now) >= policy.retire_min_days * 86_400_000
  ) return { ...next, state: 'retired', quarantine_until: null };
  if (
    observation.recanary_failed
    || next.consecutive_fetch_failures >= policy.consecutive_fetch_failures
    || next.candidates_since_exact_main_win >= policy.no_win_candidate_limit
  ) {
    return { ...next, state: 'quarantined', quarantine_until: now + policy.quarantine_days * 86_400_000 };
  }
  const yieldRate = next.exact_main_wins / Math.max(1, next.attempted_candidates);
  if (
    next.successful_nights >= policy.promotion_nights
    && next.unique_candidates >= policy.promotion_unique_candidates
    && next.exact_main_wins >= policy.promotion_exact_main_wins
    && yieldRate >= policy.promotion_min_yield
  ) return { ...next, state: 'promoted', quarantine_until: null };
  return { ...next, state: 'canary', quarantine_until: null };
}
