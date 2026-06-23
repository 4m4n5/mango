#!/usr/bin/env -S npm --prefix src/catalog-service exec tsx --

import { CatalogCore } from '../../../src/catalog-service/src/core.js';
import { isAddonRateLimitMessage } from '../../../src/catalog-service/src/catalog-errors.js';
import { refreshAllRails } from '../../../src/catalog-service/src/playability/refresh.js';
import { normalizeRefreshMode, type GrowPresetId } from '../../../src/catalog-service/src/playability/grow-target.js';
import { topUpRail } from '../../../src/catalog-service/src/playability/top-up.js';
import { verifyTitle } from '../../../src/catalog-service/src/playability/verify.js';

function usage(): never {
  console.error([
    'usage:',
    '  playability-indexer.ts verify --type <movie|series> --id <id>',
    '  playability-indexer.ts top-up --rail <rail-id> [--bootstrap] [--pool-target <n>] [--candidate-limit <n>]',
    '  playability-indexer.ts top-up --all [--pool-target <n>] [--candidate-limit <n>]',
    '  playability-indexer.ts refresh --all [--mode grow|stale|nightly] [--preset quick|nightly|overnight] [--bootstrap] [--pool-target <n>] [--candidate-limit <n>]',
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

function readGrowPreset(args: string[]): GrowPresetId | undefined {
  const value = readFlag(args, '--preset');
  if (value === null) return undefined;
  if (value !== 'quick' && value !== 'nightly' && value !== 'overnight') {
    usage();
  }
  return value;
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

function failureCategory(error: unknown, stage: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (isAddonRateLimitMessage(message)) {
    return 'rate_limited';
  }
  if (/timeout|abort/i.test(message)) {
    return stage === 'core_boot' ? 'catalog_boot_failed' : 'time_budget_exceeded';
  }
  return stage === 'core_boot' ? 'catalog_boot_failed' : 'source_exhausted';
}

function repairSuggestions(category: string): string[] {
  if (category === 'rate_limited') {
    return [
      'Use playability VOD boot or stagger addon access; optional Live/IPTV manifests must not block movie/series grow.',
    ];
  }
  if (category === 'catalog_boot_failed') {
    return [
      'Check required VOD addon manifests in the Stremio export; Live/IPTV addons are skipped only in playability_vod mode.',
    ];
  }
  if (category === 'time_budget_exceeded') {
    return [
      'Increase grow wall time or reduce slow sources; do not satisfy rail grow quota with existing verified links.',
    ];
  }
  return [
    'Review same-theme source membership and runtime source weights; generated suggestions are advisory only.',
  ];
}

function structuredRefreshFailure(options: {
  mode: string;
  stage: string;
  startedAt: number;
  error: unknown;
}): Record<string, unknown> {
  const category = failureCategory(options.error, options.stage);
  const message = options.error instanceof Error ? options.error.message : String(options.error);
  const finishedAt = Date.now();
  return {
    ok: false,
    mode: options.mode,
    bootstrap: false,
    strict_grow_sla: true,
    started_at: options.startedAt,
    finished_at: finishedAt,
    duration_ms: finishedAt - options.startedAt,
    stage: options.stage,
    failure_category: category,
    error: message,
    repair_suggestions: repairSuggestions(category),
    unique_candidates: 0,
    verify_queue_size: 0,
    linked_existing: 0,
    verified: 0,
    failed: 0,
    skipped_existing: 0,
    skipped_recent_failed: 0,
    batch_flush: { verify_count: 0, pool_count: 0 },
    pruned_pool_entries: 0,
    ingest_fresh_queued: 0,
    ingest_scanned: 0,
    rails: [],
  };
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
    const growPreset = readGrowPreset(args);
    const bootstrap = args.includes('--bootstrap');
    const poolTarget = readPositiveIntegerFlag(args, '--pool-target');
    const candidateLimit = readPositiveIntegerFlag(args, '--candidate-limit');

    const startedAt = Date.now();
    let core: CatalogCore;
    try {
      core = await CatalogCore.create({ purpose: 'playability_vod' });
    } catch (error) {
      await writeJsonAndExit(structuredRefreshFailure({
        mode,
        stage: 'core_boot',
        startedAt,
        error,
      }), 1);
    }
    try {
      const result = await refreshAllRails(core, { mode, bootstrap, poolTarget, candidateLimit, growPreset });
      await writeJsonAndExit(result, result.ok ? 0 : 1);
    } catch (error) {
      await writeJsonAndExit(structuredRefreshFailure({
        mode,
        stage: 'refresh_run',
        startedAt,
        error,
      }), 1);
    }
  }

  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
