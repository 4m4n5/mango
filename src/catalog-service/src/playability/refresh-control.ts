import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

export type RefreshLevelId =
  | 'shuffle_rails'
  | 'stale_refresh'
  | 'topup_low_rails'
  | 'quick_topup'
  | 'full_maintenance'
  | 'growth_pass'
  | 'overnight_grow';

export type RefreshLevelCategory = 'instant' | 'quick' | 'standard' | 'overnight';

export type RefreshLevel = {
  id: RefreshLevelId;
  label: string;
  description: string;
  category: RefreshLevelCategory;
  /** Couch-safe estimate for UI / LLM planners. */
  estimated_sec: number;
  estimated_label: string;
  blocks_couch: boolean;
  /** Machine hint for voice/LLM tools. */
  llm_hint: string;
  /** Shell entrypoint under repo scripts/phase-n3c (for ops docs). */
  script: string;
  detach_supported: boolean;
};

export const REFRESH_LEVELS: RefreshLevel[] = [
  {
    id: 'shuffle_rails',
    label: 'Refresh library',
    description: 'Re-pick diverse titles from verified pools across every rail.',
    category: 'instant',
    estimated_sec: 5,
    estimated_label: '~5 sec',
    blocks_couch: false,
    llm_hint: 'Use when the user wants different titles on home without re-verifying streams.',
    script: 'playability-refresh-level.sh shuffle_rails',
    detach_supported: false,
  },
  {
    id: 'quick_topup',
    label: 'Quick top-up',
    description: 'Short additive pass — 10 fresh probes per rail, up to +8 verified each.',
    category: 'quick',
    estimated_sec: 600,
    estimated_label: '~10 min',
    blocks_couch: true,
    llm_hint: 'Use when the user steps away for ~10 minutes. Paginated ingest; couch restores on exit.',
    script: 'quick-playability-topup.sh',
    detach_supported: true,
  },
  {
    id: 'stale_refresh',
    label: 'Refresh stale titles',
    description: 'Re-probe titles marked stale only. Verified library rows are kept.',
    category: 'quick',
    estimated_sec: 300,
    estimated_label: '~5 min',
    blocks_couch: true,
    llm_hint: 'Use when play failures marked titles stale. Does not replace verified rows.',
    script: 'playability-maintenance.sh --mode stale',
    detach_supported: false,
  },
  {
    id: 'topup_low_rails',
    label: 'Grow thin rails',
    description: 'Standard additive pass using catalog defaults. Additive only.',
    category: 'standard',
    estimated_sec: 900,
    estimated_label: '~15 min',
    blocks_couch: true,
    llm_hint: 'Use when home rows look sparse. Adds titles; does not remove verified pool rows.',
    script: 'playability-maintenance.sh --mode full',
    detach_supported: false,
  },
  {
    id: 'full_maintenance',
    label: 'Nightly pass',
    description: 'Deep single pass — 40 fresh probes per rail, up to +15 verified each.',
    category: 'standard',
    estimated_sec: 2700,
    estimated_label: '~45 min',
    blocks_couch: true,
    llm_hint: 'Use for a deep library grow before bed (single pass). Never replaces verified titles.',
    script: 'playability-maintenance.sh --mode full (nightly env)',
    detach_supported: false,
  },
  {
    id: 'growth_pass',
    label: 'Growth pass',
    description: 'Quota-driven pass — verify up to growth_quota (default 20) new titles per rail; unbounded pool depth.',
    category: 'standard',
    estimated_sec: 3600,
    estimated_label: '~60 min',
    blocks_couch: true,
    llm_hint: 'Default nightly mode. Each rail targets +20 probe-verified titles; no pool_max stop.',
    script: 'playability-maintenance.sh --mode growth',
    detach_supported: false,
  },
  {
    id: 'overnight_grow',
    label: 'Overnight grow',
    description: 'Loop nightly passes for up to 4 hours — max library depth while you sleep.',
    category: 'overnight',
    estimated_sec: 14400,
    estimated_label: '~4 hours',
    blocks_couch: true,
    llm_hint: 'Use when away for hours. Runs detached; couch restores when complete or stalled.',
    script: 'overnight-playability-grow.sh --detach',
    detach_supported: true,
  },
];

const LEVEL_IDS = new Set(REFRESH_LEVELS.map((level) => level.id));

/** UI order: quick → standard → overnight (shuffle handled separately). */
export const REFRESH_LEVEL_UI_ORDER: RefreshLevelId[] = [
  'quick_topup',
  'stale_refresh',
  'topup_low_rails',
  'growth_pass',
  'full_maintenance',
  'overnight_grow',
];

export function listRefreshLevels(): RefreshLevel[] {
  return [...REFRESH_LEVELS];
}

export function listRefreshLevelsForUi(): RefreshLevel[] {
  const byId = new Map(REFRESH_LEVELS.map((level) => [level.id, level]));
  return REFRESH_LEVEL_UI_ORDER
    .map((id) => byId.get(id))
    .filter((level): level is RefreshLevel => level !== undefined);
}

export function getRefreshLevel(id: string): RefreshLevel | null {
  return REFRESH_LEVELS.find((level) => level.id === id) ?? null;
}

export type LlmRefreshToolManifest = {
  tool_name: string;
  description: string;
  endpoint: string;
  method: 'POST';
  parameters: {
    type: 'object';
    required: ['level'];
    properties: {
      level: {
        type: 'string';
        enum: RefreshLevelId[];
        description: string;
      };
    };
  };
  levels: Array<{
    id: RefreshLevelId;
    label: string;
    category: RefreshLevelCategory;
    estimated_sec: number;
    estimated_label: string;
    blocks_couch: boolean;
    llm_hint: string;
    detach_supported: boolean;
  }>;
};

export function buildLlmRefreshToolManifest(): LlmRefreshToolManifest {
  const actionable = REFRESH_LEVELS.filter((level) => level.id !== 'shuffle_rails');
  return {
    tool_name: 'mango_playability_refresh',
    description: 'Start an additive playability library growth job on the mango TV box. Verified titles are kept unless stale.',
    endpoint: 'POST /playability/refresh',
    method: 'POST',
    parameters: {
      type: 'object',
      required: ['level'],
      properties: {
        level: {
          type: 'string',
          enum: actionable.map((level) => level.id),
          description: 'Refresh job tier. Prefer quick_topup for brief away time; overnight_grow for sleep.',
        },
      },
    },
    levels: actionable.map((level) => ({
      id: level.id,
      label: level.label,
      category: level.category,
      estimated_sec: level.estimated_sec,
      estimated_label: level.estimated_label,
      blocks_couch: level.blocks_couch,
      llm_hint: level.llm_hint,
      detach_supported: level.detach_supported,
    })),
  };
}

function repoDir(): string {
  return process.env.MANGO_REPO_DIR || path.resolve(process.cwd(), '../..');
}

function cacheDir(): string {
  return process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '/tmp', '.cache', 'mango');
}

async function lockFileActive(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(cacheDir(), relativePath));
    return true;
  } catch {
    return false;
  }
}

async function pidFileRunning(relativePath: string): Promise<boolean> {
  try {
    const pid = Number((await readFile(path.join(cacheDir(), relativePath), 'utf8')).trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      return false;
    }
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function playabilityJobBusy(): Promise<boolean> {
  if (await lockFileActive('playability-maintenance.lock')) {
    return true;
  }
  if (await pidFileRunning('overnight-fill.pid')) {
    return true;
  }
  if (await pidFileRunning('quick-topup.pid')) {
    return true;
  }
  return false;
}

export type StartRefreshResult =
  | { ok: true; level: RefreshLevelId; mode: 'inline' }
  | { ok: true; level: RefreshLevelId; mode: 'background'; pid: number }
  | { ok: false; error: string; busy?: boolean };

export async function startRefreshLevel(levelId: string): Promise<StartRefreshResult> {
  if (!LEVEL_IDS.has(levelId as RefreshLevelId)) {
    return { ok: false, error: `unknown refresh level: ${levelId}` };
  }
  const level = levelId as RefreshLevelId;
  if (level === 'shuffle_rails') {
    return { ok: true, level, mode: 'inline' };
  }

  if (await playabilityJobBusy()) {
    return { ok: false, error: 'playability job already running', busy: true };
  }

  const script = path.join(repoDir(), 'scripts/phase-n3c/playability-refresh-level.sh');
  const child = spawn('bash', [script, level], {
    cwd: repoDir(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      MANGO_REPO_DIR: repoDir(),
      MANGO_MAINTENANCE_SKIP_GATE: '1',
    },
  });
  child.unref();
  return { ok: true, level, mode: 'background', pid: child.pid ?? 0 };
}
