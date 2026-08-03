import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initLibraryDb } from './db.js';
import {
  RatingValidationError,
  hashSeedManifest,
  importSeedManifest,
  validateSeedManifest,
  type SeedManifest,
} from './ratings.js';

function usage(): never {
  throw new Error('usage: seed-cli <dry-run|validate|import> <manifest.json>');
}

function readManifest(path: string): SeedManifest {
  const parsed = JSON.parse(readFileSync(resolve(path), 'utf8')) as SeedManifest;
  if (!parsed || !Array.isArray(parsed.items)) throw new RatingValidationError('invalid seed manifest JSON');
  return parsed;
}

function main(): void {
  const mode = process.argv[2];
  const path = process.argv[3];
  if (!path || !['dry-run', 'validate', 'import'].includes(mode || '')) usage();
  const manifest = readManifest(path);
  const validated = validateSeedManifest(manifest);
  const summary = {
    ok: true,
    mode,
    manifest_name: manifest.manifest_name,
    manifest_hash: hashSeedManifest(manifest),
    source_rows: manifest.items.length,
    approved: validated.approved.length,
    excluded: validated.excluded,
  };
  if (mode === 'import') {
    initLibraryDb();
    process.stdout.write(`${JSON.stringify({ ...summary, result: importSeedManifest(manifest) }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
