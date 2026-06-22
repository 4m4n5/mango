#!/usr/bin/env -S npm --prefix src/catalog-service exec tsx --

import { CatalogCore } from '../../src/catalog-service/src/core.js';
import { refreshAllRails } from '../../src/catalog-service/src/playability/refresh.js';
import { normalizeRefreshMode } from '../../src/catalog-service/src/playability/grow-target.js';
import { topUpRail } from '../../src/catalog-service/src/playability/top-up.js';
import { verifyTitle } from '../../src/catalog-service/src/playability/verify.js';

function usage(): never {
  console.error([
    'usage:',
    '  playability-indexer.ts verify --type <movie|series> --id <id>',
    '  playability-indexer.ts top-up --rail <rail-id> [--bootstrap] [--pool-target <n>] [--candidate-limit <n>]',
    '  playability-indexer.ts top-up --all [--pool-target <n>] [--candidate-limit <n>]',
    '  playability-indexer.ts refresh --all [--mode grow|stale] [--bootstrap] [--pool-target <n>] [--candidate-limit <n>]',
  ].join('\n'));
  process.exit(2);
}

function readFlag(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function readPositiveIntegerFlag(args: string[], name: string): number | undefined {
  const value = readFlag(args, name);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    usage();
  }
  return parsed;
}

function readRefreshMode(args: string[]) {
  const value = readFlag(args, '--mode') ?? 'stale';
  try {
    return normalizeRefreshMode(value);
  } catch {
    usage();
  }
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
    const all = args.includes('--all');
    if ((!railId && !all) || (railId && all)) {
      usage();
    }
    if (args.includes('--bootstrap')) {
      process.env.MANGO_PLAYABILITY_BOOTSTRAP = '1';
    }
    const poolTarget = readPositiveIntegerFlag(args, '--pool-target');
    const candidateLimit = readPositiveIntegerFlag(args, '--candidate-limit');

    const core = await CatalogCore.create();
    if (all) {
      const rails = [];
      for (const rail of core.browsableRails()) {
        rails.push(await topUpRail(core, rail.id, { poolTarget, candidateLimit }));
      }
      await writeJsonAndExit({ ok: true, rails }, 0);
    }
    if (!railId) {
      usage();
    }
    const result = await topUpRail(core, railId, { poolTarget, candidateLimit });
    await writeJsonAndExit(result, 0);
  }

  if (command === 'refresh') {
    const all = args.includes('--all');
    if (!all) {
      usage();
    }
    const mode = readRefreshMode(args);
    const bootstrap = args.includes('--bootstrap');
    const poolTarget = readPositiveIntegerFlag(args, '--pool-target');
    const candidateLimit = readPositiveIntegerFlag(args, '--candidate-limit');

    const core = await CatalogCore.create();
    const result = await refreshAllRails(core, { mode, bootstrap, poolTarget, candidateLimit });
    await writeJsonAndExit(result, result.ok ? 0 : 1);
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
