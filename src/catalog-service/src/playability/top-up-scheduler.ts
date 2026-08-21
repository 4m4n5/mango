import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

/** Fire-and-forget background top-up (debounced per rail). Off by default — use timer or manual CLI. */
export function schedulePlayabilityTopUp(railId: string): void {
  if (process.env.MANGO_PLAYABILITY_BACKGROUND_TOPUP !== '1') {
    return;
  }
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
  const coordinator = join(root, 'scripts/m3-play/playability/playability-coordinator.sh');
  const runId = `background-${randomUUID()}`;
  const child = spawn(
    'bash',
    [coordinator, '--run-id', runId, '--level', 'grow_quick'],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, MANGO_REPO_DIR: root, MANGO_PLAYABILITY_TARGET_RAIL: railId },
    },
  );
  child.unref();
}
