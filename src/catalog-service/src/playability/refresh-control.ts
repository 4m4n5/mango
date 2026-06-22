import { spawn } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { GrowPresetId } from './grow-target.js';
import { GROW_PRESETS } from './grow-target.js';

/** Canonical Library Grower refresh level ids (PR4). */
export type RefreshLevelId =
  | 'shuffle_rails'
  | 'stale_refresh'
  | 'grow_quick'
  | 'grow_nightly'
  | 'grow_overnight';

/** Deprecated ids still accepted by API / settings UI. */
export type LegacyRefreshLevelId =
  | 'quick_topup'
  | 'topup_low_rails'
  | 'full_maintenance'
  | 'growth_pass'
  | 'overnight_grow';

export type AnyRefreshLevelId = RefreshLevelId | LegacyRefreshLevelId;

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
  /** Grow preset wall/attempt limits when applicable. */
  grow_preset?: GrowPresetId;
};

const LEGACY_LEVEL_ALIASES: Record<LegacyRefreshLevelId, RefreshLevelId> = {
  quick_topup: 'grow_quick',
  topup_low_rails: 'grow_quick',
  full_maintenance: 'grow_nightly',
  growth_pass: 'grow_nightly',
  overnight_grow: 'grow_overnight',
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
    id: 'grow_quick',
    label: 'Quick grow',
    description: 'Short grow pass — ~10 min wall, up to 200 probe attempts per rail.',
    category: 'quick',
    estimated_sec: Math.round(GROW_PRESETS.quick.wall_ms / 1000),
    estimated_label: '~10 min',
    blocks_couch: true,
    llm_hint: 'Use when the user steps away for ~10 minutes. Paginated ingest; couch restores on exit.',
    script: 'playability-grow.sh --mode grow --preset quick --detach',
    detach_supported: true,
    grow_preset: 'quick',
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
    script: 'playability-grow.sh --mode stale',
    detach_supported: false,
  },
  {
    id: 'grow_nightly',
    label: 'Nightly grow',
    description: 'Stale refresh all rails, then grow pass — ~90 min wall per rail (Pi timer default).',
    category: 'standard',
    estimated_sec: Math.round(GROW_PRESETS.nightly.wall_ms / 1000),
    estimated_label: '~90 min',
    blocks_couch: true,
    llm_hint: 'Default nightly mode. Stale pass then additive grow; never replaces verified titles.',
    script: 'playability-grow.sh --mode nightly --preset nightly',
    detach_supported: false,
    grow_preset: 'nightly',
  },
  {
    id: 'grow_overnight',
    label: 'Overnight grow',
    description: 'Loop grow chunks for up to 4 hours — max library depth while you sleep.',
    category: 'overnight',
    estimated_sec: Math.round(GROW_PRESETS.overnight.wall_ms / 1000),
    estimated_label: '~4 hours',
    blocks_couch: true,
    llm_hint: 'Use when away for hours. Runs detached; couch restores when complete or stalled.',
    script: 'overnight-playability-grow.sh --detach',
    detach_supported: true,
    grow_preset: 'overnight',
  },
];

const LEVEL_IDS = new Set<RefreshLevelId>(REFRESH_LEVELS.map((level) => level.id));

/** UI order: quick → nightly → overnight (shuffle handled separately). */
export const REFRESH_LEVEL_UI_ORDER: RefreshLevelId[] = [
  'grow_quick',
  'stale_refresh',
  'grow_nightly',
  'grow_overnight',
];

export function resolveRefreshLevelId(id: string): RefreshLevelId | null {
  if (LEVEL_IDS.has(id as RefreshLevelId)) {
    return id as RefreshLevelId;
  }
  const alias = LEGACY_LEVEL_ALIASES[id as LegacyRefreshLevelId];
  return alias ?? null;
}

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
  const resolved = resolveRefreshLevelId(id);
  if (!resolved) {
    return null;
  }
  return REFRESH_LEVELS.find((level) => level.id === resolved) ?? null;
}

export type RefreshJobMode = 'grow' | 'stale' | 'nightly';

export type LlmRefreshToolManifest = {
  tool_name: string;
  description: string;
  endpoint: string;
  method: 'POST';
  parameters: {
    type: 'object';
    properties: {
      level: {
        type: 'string';
        enum: Array<AnyRefreshLevelId>;
        description: string;
      };
      mode: {
        type: 'string';
        enum: ['grow', 'stale', 'nightly'];
        description: string;
      };
      preset: {
        type: 'string';
        enum: ['quick', 'nightly', 'overnight'];
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
    grow_preset?: GrowPresetId;
  }>;
};

export function buildLlmRefreshToolManifest(): LlmRefreshToolManifest {
  const actionable = REFRESH_LEVELS.filter((level) => level.id !== 'shuffle_rails');
  const legacyIds = Object.keys(LEGACY_LEVEL_ALIASES) as LegacyRefreshLevelId[];
  return {
    tool_name: 'mango_playability_refresh',
    description: 'Start an additive playability library growth job on the mango TV box. Verified titles are kept unless stale.',
    endpoint: 'POST /playability/refresh',
    method: 'POST',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: [...actionable.map((level) => level.id), ...legacyIds],
          description: 'Refresh job tier. Prefer grow_quick for brief away time; grow_overnight for sleep.',
        },
        mode: {
          type: 'string',
          enum: ['grow', 'stale', 'nightly'],
          description: 'Alternative to level: grow (additive), stale (re-probe), nightly (stale then grow).',
        },
        preset: {
          type: 'string',
          enum: ['quick', 'nightly', 'overnight'],
          description: 'Grow wall/attempt preset when using mode grow or nightly.',
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
      grow_preset: level.grow_preset,
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
  if (await pidFileRunning('playability-grow.pid')) {
    return true;
  }
  return false;
}

export type StartRefreshResult =
  | { ok: true; level: RefreshLevelId; mode: 'inline' }
  | { ok: true; level: RefreshLevelId; mode: 'background'; pid: number }
  | { ok: false; error: string; busy?: boolean };

function spawnDetached(args: string[]): { pid: number } {
  const script = path.join(repoDir(), 'scripts/phase-n3c/playability-grow.sh');
  const child = spawn('bash', [script, ...args], {
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
  return { pid: child.pid ?? 0 };
}

function spawnRefreshLevelScript(levelId: string): { pid: number } {
  const script = path.join(repoDir(), 'scripts/phase-n3c/playability-refresh-level.sh');
  const child = spawn('bash', [script, levelId], {
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
  return { pid: child.pid ?? 0 };
}

export async function startRefreshLevel(levelId: string): Promise<StartRefreshResult> {
  const resolved = resolveRefreshLevelId(levelId);
  if (!resolved) {
    return { ok: false, error: `unknown refresh level: ${levelId}` };
  }
  if (resolved === 'shuffle_rails') {
    return { ok: true, level: resolved, mode: 'inline' };
  }

  if (await playabilityJobBusy()) {
    return { ok: false, error: 'playability job already running', busy: true };
  }

  const { pid } = spawnRefreshLevelScript(levelId);
  return { ok: true, level: resolved, mode: 'background', pid };
}

export async function startRefreshJob(options: {
  mode: RefreshJobMode;
  preset?: GrowPresetId;
  detach?: boolean;
}): Promise<StartRefreshResult> {
  const mode = options.mode;
  if (mode !== 'grow' && mode !== 'stale' && mode !== 'nightly') {
    return { ok: false, error: `unknown refresh mode: ${mode}` };
  }
  const preset = options.preset ?? 'nightly';
  if (!GROW_PRESETS[preset]) {
    return { ok: false, error: `unknown grow preset: ${preset}` };
  }

  if (await playabilityJobBusy()) {
    return { ok: false, error: 'playability job already running', busy: true };
  }

  const args = ['--mode', mode, '--preset', preset];
  if (options.detach) {
    args.push('--detach');
  }
  const { pid } = spawnDetached(args);

  const level: RefreshLevelId =
    mode === 'stale' ? 'stale_refresh'
    : mode === 'nightly' ? 'grow_nightly'
    : preset === 'quick' ? 'grow_quick'
    : preset === 'overnight' ? 'grow_overnight'
    : 'grow_nightly';

  return { ok: true, level, mode: 'background', pid };
}
