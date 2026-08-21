import os from 'node:os';

/** Operator home for cache and X11 paths. Never hardcode a household user. */
export function mangoHome(): string {
  return process.env.HOME || os.homedir();
}

export function mangoCachePath(...parts: string[]): string {
  return [mangoHome(), '.cache', 'mango', ...parts].join('/');
}
