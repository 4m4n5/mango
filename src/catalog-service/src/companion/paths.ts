import path from 'node:path';

const DEFAULT_DIR = '/etc/mango/companion';

export function companionRoot(): string {
  return (process.env.MANGO_COMPANION_DIR || DEFAULT_DIR).trim() || DEFAULT_DIR;
}

export function profilePath(): string {
  return path.join(companionRoot(), 'profile.yaml');
}

export function journalPath(): string {
  return path.join(companionRoot(), 'companion.db');
}

export function compiledNotesPath(): string {
  return path.join(companionRoot(), 'compiled-notes.md');
}
