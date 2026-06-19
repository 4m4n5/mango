#!/usr/bin/env -S npm --prefix src/catalog-service exec tsx --

import { CatalogCore } from '../../src/catalog-service/src/core.js';
import { topUpRail } from '../../src/catalog-service/src/playability/top-up.js';
import { verifyTitle } from '../../src/catalog-service/src/playability/verify.js';

function usage(): never {
  console.error([
    'usage:',
    '  playability-indexer.ts verify --type <movie|series> --id <id>',
    '  playability-indexer.ts top-up --rail <rail-id>',
  ].join('\n'));
  process.exit(2);
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function writeJsonAndExit(value: unknown, exitCode: number): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  process.exit(exitCode);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'verify') {
    const type = readFlag(args, '--type');
    const id = readFlag(args, '--id');
    if (!type || !id) {
      usage();
    }

    const core = await CatalogCore.create();
    const result = await verifyTitle(core, type, id);
    await writeJsonAndExit(result, result.ok ? 0 : 1);
  }

  if (command === 'top-up') {
    const railId = readFlag(args, '--rail');
    if (!railId) {
      usage();
    }

    const core = await CatalogCore.create();
    const result = await topUpRail(core, railId);
    await writeJsonAndExit(result, 0);
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
