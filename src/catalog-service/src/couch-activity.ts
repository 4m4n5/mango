import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

function statePath(): string {
  return process.env.MANGO_COUCH_ACTIVITY_STATE
    || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'mango/couch-activity.json');
}

export function touchCouchActivity(source: string, hint = ''): void {
  try {
    const path = statePath();
    mkdirSync(dirname(path), { recursive: true });
    const payload = {
      ts: Date.now(),
      source: source.slice(0, 64),
      hint: hint.slice(0, 96),
      pid: process.pid,
    };
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload)}\n`, 'utf8');
    renameSync(tmp, path);
  } catch {
    // Activity markers are operator diagnostics and must never break playback.
  }
}
