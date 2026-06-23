#!/usr/bin/env node
/** CLI — thematic rail_pool reorganization. Run: bash scripts/m3-play/playability/rail-pool-retheme.sh */

import { CatalogCore } from '../core.js';
import { rethemeRailPools } from './rail-pool-retheme.js';

function usage(): never {
  console.error(`usage:
  rail-pool-retheme recover
  rail-pool-retheme dry-run [--rail <id>] [--include-orphans] [--limit <n>] [--no-meta] [--no-preserve]
  rail-pool-retheme apply [--rail <id>] [--include-orphans] [--limit <n>] [--no-meta] [--no-preserve]

  dry-run (default): score pool memberships; print summary + sample actions
  --include-orphans: also attach active verified titles with no rail_pool row to best-fit rail
  --limit: cap orphan attachments when --include-orphans is set
  apply: move mismatches to best-fit rail; titles land on anchor rail if no strong fit
  --rail: limit to one rail id
  --no-meta: title/pool fields only (faster; weaker signals)
  --no-preserve: prune without upserting into another rail
`);
  process.exit(2);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function argNumber(flag: string): number | undefined {
  const raw = argValue(flag);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function summarizeByRail(actions: Awaited<ReturnType<typeof rethemeRailPools>>['actions']): void {
  const counts = new Map<string, { attach: number; remove: number; relocate: number; keep: number }>();
  for (const action of actions) {
    const railId = action.action === 'relocate' ? action.from_rail : action.rail_id;
    const bucket = counts.get(railId) ?? { attach: 0, remove: 0, relocate: 0, keep: 0 };
    if (action.action === 'attach') bucket.attach += 1;
    if (action.action === 'remove') bucket.remove += 1;
    if (action.action === 'relocate') bucket.relocate += 1;
    if (action.action === 'keep') bucket.keep += 1;
    counts.set(railId, bucket);
  }
  const rows = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [railId, stats] of rows) {
    if (stats.attach === 0 && stats.remove === 0 && stats.relocate === 0) continue;
    console.log(`  ${railId}: attach=${stats.attach} remove=${stats.remove} relocate=${stats.relocate} keep=${stats.keep}`);
  }
}

async function cmdRecover(): Promise<void> {
  const { recoverOrphanVerifiedPoolTitles } = await import('./db.js');
  const recovered = await recoverOrphanVerifiedPoolTitles();
  console.log(JSON.stringify({ ok: true, recovered }, null, 2));
  await clearRailSessionsFromRecover(recovered);
}

async function clearRailSessionsFromRecover(recovered: number): Promise<void> {
  if (recovered <= 0) return;
  const { clearRailSessions } = await import('./db.js');
  await clearRailSessions(['movies-global-popular', 'series-global-popular']);
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command === 'recover') {
    await cmdRecover();
    return;
  }
  if (!command || (command !== 'dry-run' && command !== 'apply')) {
    usage();
  }

  const dryRun = command === 'dry-run';
  const core = await CatalogCore.create();
  const result = await rethemeRailPools(core, {
    dryRun,
    withMeta: !process.argv.includes('--no-meta'),
    preserveTitles: !process.argv.includes('--no-preserve'),
    railFilter: argValue('--rail'),
    includeOrphans: process.argv.includes('--include-orphans'),
    orphanLimit: argNumber('--limit'),
  });

  console.log(JSON.stringify({
    ok: result.ok,
    dry_run: result.dry_run,
    include_orphans: result.include_orphans,
    memberships_scanned: result.memberships_scanned,
    orphans_scanned: result.orphans_scanned,
    unique_titles: result.unique_titles,
    kept: result.kept,
    removed: result.removed,
    relocated: result.relocated,
    attached: result.attached,
    meta_fetched: result.meta_fetched,
    rails_touched: result.rails_touched,
  }, null, 2));

  console.log('by_rail:');
  summarizeByRail(result.actions);

  const sample = result.actions.filter((action) => action.action !== 'keep').slice(0, 40);
  if (sample.length > 0) {
    console.log('sample_actions:');
    for (const action of sample) {
      console.log(`  ${JSON.stringify(action)}`);
    }
    if (result.actions.filter((action) => action.action !== 'keep').length > sample.length) {
      console.log(`  … ${result.actions.filter((action) => action.action !== 'keep').length - sample.length} more`);
    }
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
