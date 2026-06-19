#!/usr/bin/env -S npm --prefix src/catalog-service exec tsx --

import { CatalogCore } from '../../src/catalog-service/src/core.js';
import { verifyTitle } from '../../src/catalog-service/src/playability/verify.js';

function usage(): never {
  console.error('usage: playability-indexer.ts verify --type <movie|series> --id <id>');
  process.exit(2);
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command !== 'verify') {
    usage();
  }

  const type = readFlag(args, '--type');
  const id = readFlag(args, '--id');
  if (!type || !id) {
    usage();
  }

  const core = await CatalogCore.create();
  const result = await verifyTitle(core, type, id);
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
