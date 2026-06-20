import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

export type RefreshLevelId =
  | 'shuffle_rails'
  | 'stale_refresh'
  | 'topup_low_rails'
  | 'full_maintenance';

export type RefreshLevel = {
  id: RefreshLevelId;
  label: string;
  description: string;
  /** Couch-safe estimate for UI / LLM planners. */
  estimated_sec: number;
  estimated_label: string;
  blocks_couch: boolean;
  /** Machine hint for voice/LLM tools. */
  llm_hint: string;
};

export const REFRESH_LEVELS: RefreshLevel[] = [
  {
    id: 'shuffle_rails',
    label: 'Shuffle home rails',
    description: 'Re-pick posters from the verified pool. No new stream checks.',
    estimated_sec: 5,
    estimated_label: '~5 sec',
    blocks_couch: false,
    llm_hint: 'Use when the user wants different titles on home without re-verifying streams.',
  },
  {
    id: 'stale_refresh',
    label: 'Refresh stale titles',
    description: 'Re-probe titles marked stale only. Verified library rows are kept.',
    estimated_sec: 300,
    estimated_label: '~5 min',
    blocks_couch: true,
    llm_hint: 'Use when play failures marked titles stale. Does not replace verified rows.',
  },
  {
    id: 'topup_low_rails',
    label: 'Grow thin rails',
    description: 'Add newly verified titles toward pool targets. Additive only.',
    estimated_sec: 900,
    estimated_label: '~15 min',
    blocks_couch: true,
    llm_hint: 'Use when home rows look sparse. Adds titles; does not remove verified pool rows.',
  },
  {
    id: 'full_maintenance',
    label: 'Full library growth',
    description: 'Wide additive pass across all rails below pool ceiling. No pool purge.',
    estimated_sec: 2400,
    estimated_label: '~40 min',
    blocks_couch: true,
    llm_hint: 'Use overnight to grow verified pools. Never replaces existing verified titles.',
  },
];

const LEVEL_IDS = new Set(REFRESH_LEVELS.map((level) => level.id));

export function listRefreshLevels(): RefreshLevel[] {
  return [...REFRESH_LEVELS];
}

export function getRefreshLevel(id: string): RefreshLevel | null {
  return REFRESH_LEVELS.find((level) => level.id === id) ?? null;
}

function repoDir(): string {
  return process.env.MANGO_REPO_DIR || path.resolve(process.cwd(), '../..');
}

async function maintenanceLockActive(): Promise<boolean> {
  const lockPath = path.join(
    process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '/tmp', '.cache'),
    'mango',
    'playability-maintenance.lock',
  );
  try {
    await access(lockPath);
    return true;
  } catch {
    return false;
  }
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

  if (await maintenanceLockActive()) {
    return { ok: false, error: 'maintenance already running', busy: true };
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
