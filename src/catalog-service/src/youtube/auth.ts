import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { CatalogError } from '../catalog-errors.js';
import type { YoutubeConfig } from './config.js';
import {
  deleteYoutubeAuthSession,
  getYoutubeAuthSession,
  saveYoutubeAuthSession,
  updateYoutubeAuthSession,
  type YoutubeAuthSession,
} from './db.js';

const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

type OAuthClient = {
  client_id: string;
  client_secret?: string;
};

export type YoutubeAuthToken = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  scope?: string;
  token_type?: string;
  saved_at?: number;
};

export type YoutubeAuthSummary = {
  configured: boolean;
  authenticated: boolean;
  token_file: string;
  expires_at: number | null;
  scopes: string[];
};

function nowMs(): number {
  return Date.now();
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

function oauthClient(config: YoutubeConfig): OAuthClient {
  if (!existsSync(config.oauth_client_file)) {
    throw new CatalogError(503, 'YouTube OAuth client is not configured');
  }
  const raw = readJsonFile(config.oauth_client_file);
  const candidate = raw && typeof raw === 'object'
    ? (raw as Record<string, unknown>)
    : {};
  const nested = (
    (candidate.installed && typeof candidate.installed === 'object' ? candidate.installed : null)
    || (candidate.web && typeof candidate.web === 'object' ? candidate.web : null)
    || candidate
  ) as Record<string, unknown>;
  const clientId = typeof nested.client_id === 'string' ? nested.client_id.trim() : '';
  const clientSecret = typeof nested.client_secret === 'string' ? nested.client_secret.trim() : '';
  if (!clientId) {
    throw new CatalogError(503, 'YouTube OAuth client file is missing client_id');
  }
  return {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  };
}

function tokenFromResponse(payload: Record<string, unknown>): YoutubeAuthToken {
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  if (!accessToken) {
    throw new CatalogError(502, 'YouTube auth did not return an access token');
  }
  const expiresIn = Number(payload.expires_in ?? 3600);
  const savedAt = nowMs();
  return {
    access_token: accessToken,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined,
    expires_in: Number.isFinite(expiresIn) ? expiresIn : 3600,
    expires_at: savedAt + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000,
    scope: typeof payload.scope === 'string' ? payload.scope : undefined,
    token_type: typeof payload.token_type === 'string' ? payload.token_type : undefined,
    saved_at: savedAt,
  };
}

export function readYoutubeToken(config: YoutubeConfig): YoutubeAuthToken | null {
  try {
    const raw = readJsonFile(config.auth_token_file);
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const token = raw as YoutubeAuthToken;
    return typeof token.access_token === 'string' ? token : null;
  } catch {
    return null;
  }
}

function writeYoutubeToken(config: YoutubeConfig, token: YoutubeAuthToken): void {
  mkdirSync(dirname(config.auth_token_file), { recursive: true });
  writeFileSync(config.auth_token_file, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  chmodSync(config.auth_token_file, 0o600);
}

export function clearYoutubeAuth(config: YoutubeConfig): void {
  try {
    rmSync(config.auth_token_file, { force: true });
  } catch {
    // best effort
  }
}

export function youtubeAuthSummary(config: YoutubeConfig): YoutubeAuthSummary {
  const token = readYoutubeToken(config);
  return {
    configured: existsSync(config.oauth_client_file),
    authenticated: Boolean(token?.access_token),
    token_file: config.auth_token_file,
    expires_at: token?.expires_at ?? null,
    scopes: token?.scope ? token.scope.split(/\s+/).filter(Boolean) : [],
  };
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const error = typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
    const description = typeof payload.error_description === 'string' ? payload.error_description : error;
    throw new CatalogError(response.status >= 500 ? 502 : response.status, description, { auth_error: error });
  }
  return payload;
}

export async function startYoutubeDeviceAuth(config: YoutubeConfig): Promise<{
  ok: true;
  session_id: string;
  user_code: string;
  verification_url: string;
  verification_url_complete?: string;
  expires_at: number;
  interval_sec: number;
}> {
  const client = oauthClient(config);
  const payload = await postForm(DEVICE_CODE_URL, {
    client_id: client.client_id,
    scope: YOUTUBE_READONLY_SCOPE,
  });
  const deviceCode = typeof payload.device_code === 'string' ? payload.device_code : '';
  const userCode = typeof payload.user_code === 'string' ? payload.user_code : '';
  const verificationUrl = typeof payload.verification_url === 'string'
    ? payload.verification_url
    : typeof payload.verification_uri === 'string'
      ? payload.verification_uri
      : '';
  if (!deviceCode || !userCode || !verificationUrl) {
    throw new CatalogError(502, 'YouTube auth did not return a device code');
  }
  const intervalSec = Math.max(1, Number(payload.interval ?? 5));
  const expiresIn = Math.max(60, Number(payload.expires_in ?? 1800));
  const session: YoutubeAuthSession = {
    session_id: randomUUID(),
    device_code: deviceCode,
    user_code: userCode,
    verification_url: verificationUrl,
    expires_at: nowMs() + expiresIn * 1000,
    interval_sec: intervalSec,
    created_at: nowMs(),
    last_poll_at: null,
    status: 'pending',
  };
  saveYoutubeAuthSession(session);
  return {
    ok: true,
    session_id: session.session_id,
    user_code: userCode,
    verification_url: verificationUrl,
    verification_url_complete: typeof payload.verification_url_complete === 'string'
      ? payload.verification_url_complete
      : undefined,
    expires_at: session.expires_at,
    interval_sec: intervalSec,
  };
}

export async function pollYoutubeDeviceAuth(config: YoutubeConfig, sessionId: string): Promise<{
  ok: true;
  status: 'pending' | 'slow_down' | 'expired' | 'authenticated';
  interval_sec?: number;
  auth?: YoutubeAuthSummary;
}> {
  const session = getYoutubeAuthSession(sessionId);
  if (!session) {
    throw new CatalogError(404, 'unknown YouTube auth session');
  }
  if (session.expires_at <= nowMs()) {
    updateYoutubeAuthSession(sessionId, { status: 'expired', last_poll_at: nowMs() });
    return { ok: true, status: 'expired' };
  }
  const client = oauthClient(config);
  try {
    const payload = await postForm(TOKEN_URL, {
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      device_code: session.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const token = tokenFromResponse(payload);
    writeYoutubeToken(config, token);
    updateYoutubeAuthSession(sessionId, { status: 'authenticated', last_poll_at: nowMs() });
    deleteYoutubeAuthSession(sessionId);
    return { ok: true, status: 'authenticated', auth: youtubeAuthSummary(config) };
  } catch (error) {
    if (error instanceof CatalogError) {
      const authError = typeof error.details?.auth_error === 'string' ? error.details.auth_error : '';
      if (authError === 'authorization_pending') {
        updateYoutubeAuthSession(sessionId, { status: 'pending', last_poll_at: nowMs() });
        return { ok: true, status: 'pending', interval_sec: session.interval_sec };
      }
      if (authError === 'slow_down') {
        const interval = session.interval_sec + 5;
        updateYoutubeAuthSession(sessionId, { status: 'slow_down', last_poll_at: nowMs(), interval_sec: interval });
        return { ok: true, status: 'slow_down', interval_sec: interval };
      }
      if (authError === 'expired_token' || authError === 'access_denied') {
        updateYoutubeAuthSession(sessionId, { status: 'expired', last_poll_at: nowMs() });
        return { ok: true, status: 'expired' };
      }
    }
    throw error;
  }
}

async function refreshYoutubeToken(config: YoutubeConfig, token: YoutubeAuthToken): Promise<YoutubeAuthToken> {
  const refreshToken = token.refresh_token;
  if (!refreshToken) {
    throw new CatalogError(401, 'YouTube account needs reconnect');
  }
  const client = oauthClient(config);
  const payload = await postForm(TOKEN_URL, {
    client_id: client.client_id,
    ...(client.client_secret ? { client_secret: client.client_secret } : {}),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  const refreshed = tokenFromResponse({
    ...payload,
    refresh_token: typeof payload.refresh_token === 'string' ? payload.refresh_token : refreshToken,
  });
  writeYoutubeToken(config, refreshed);
  return refreshed;
}

export async function youtubeAccessToken(config: YoutubeConfig): Promise<string | null> {
  const token = readYoutubeToken(config);
  if (!token?.access_token) {
    return null;
  }
  if ((token.expires_at ?? 0) > nowMs() + 60_000) {
    return token.access_token;
  }
  const refreshed = await refreshYoutubeToken(config, token);
  return refreshed.access_token;
}
