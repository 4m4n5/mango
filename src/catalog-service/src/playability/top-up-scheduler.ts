import { spawn } from 'node:child_process';
import { join } from 'node:path';

const COOLDOWN_MS = Number(process.env.MANGO_PLAYABILITY_TOPUP_COOLDOWN_MS || 5 * 60 * 1000);
const lastScheduled = new Map<string, number>();

function repoDir(): string {
  if (process.env.MANGO_REPO_DIR) {
    return process.env.MANGO_REPO_DIR;
  }
  const cwd = process.cwd();
  if (cwd.endsWith('/src/catalog-service')) {
    return join(cwd, '..', '..');
  }
  return cwd;
}

/** Fire-and-forget background top-up (debounced per rail). No-op when disabled. */
export function schedulePlayabilityTopUp(railId: string): void {
  if (process.env.MANGO_PLAYABILITY_TOPUP_DISABLE === '1') {
    return;
  }
  const now = Date.now();
  const last = lastScheduled.get(railId) ?? 0;
  if (now - last < COOLDOWN_MS) {
    return;
  }
  lastScheduled.set(railId, now);

  const root = repoDir();
  const indexer = join(root, 'scripts/phase-n3c/playability-indexer.ts');
  const child = spawn(
    'npm',
    ['--prefix', join(root, 'src/catalog-service'), 'exec', 'tsx', '--', indexer, 'top-up', '--rail', railId],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
    },
  );
  child.unref();
}
