#!/usr/bin/env node
/** CLI — manual rail pins/blocks. Run from repo: bash scripts/m3-play/playability/rail-curation.sh */

import { readFile, writeFile } from 'node:fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { CatalogCore } from '../core.js';
import { applyRailCuration } from './rail-curation.js';
import {
  invalidateRailCurationCache,
  loadRailCurationOverrides,
  parseRailCurationOverrides,
  railCurationOverridesPath,
  type RailCurationPin,
} from './rail-overrides.js';

async function overridesFile(): Promise<string> {
  const path = process.env.MANGO_RAIL_CURATION_OVERRIDES?.trim()
    || railCurationOverridesPath();
  return path;
}

async function readOverridesFile(): Promise<{ path: string; data: ReturnType<typeof parseRailCurationOverrides> }> {
  const path = await overridesFile();
  const text = await readFile(path, 'utf8');
  return { path, data: parseRailCurationOverrides(text) };
}

async function writeOverridesFile(
  path: string,
  data: ReturnType<typeof parseRailCurationOverrides>,
): Promise<void> {
  const body = stringifyYaml(data, { lineWidth: 0 });
  await writeFile(path, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
  invalidateRailCurationCache();
}

function usage(): never {
  console.error(`usage:
  rail-curation list
  rail-curation apply [--dry-run]
  rail-curation pin add --rail <id> --type <movie|series> --id <imdb> [--label text] [--score n] [--skip-title-filter 1|0] [--slot n]
  rail-curation pin remove --rail <id> --id <imdb>
`);
  process.exit(2);
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function cmdList(): Promise<void> {
  const { path, data } = await readOverridesFile();
  console.log(`file: ${path}`);
  console.log(`pins: ${data.pins.length}  blocks: ${data.blocks.length}`);
  for (const pin of data.pins) {
    console.log(
      `  pin  ${pin.rail_id}  ${pin.type}/${pin.id}`
      + `${pin.label ? `  (${pin.label})` : ''}`
      + `  score=${pin.score}`
      + `${pin.skip_title_filter ? '  skip_title_filter' : ''}`
      + `${pin.session_slot !== null ? `  slot=${pin.session_slot}` : ''}`,
    );
  }
  for (const block of data.blocks) {
    console.log(
      `  block  ${block.rail_id ?? '*'}  ${block.type}/${block.id}`
      + `${block.reason ? `  — ${block.reason}` : ''}`,
    );
  }
}

async function cmdApply(dryRun: boolean): Promise<void> {
  const { data } = await readOverridesFile();
  if (dryRun) {
    console.log('dry-run — would apply:');
    await cmdList();
    return;
  }
  const core = await CatalogCore.create();
  const result = await applyRailCuration(core, data);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pins_failed > 0 ? 1 : 0);
}

async function cmdPinAdd(): Promise<void> {
  const railId = argValue('--rail');
  const type = argValue('--type');
  const id = argValue('--id');
  if (!railId || !type || !id) usage();

  const { path, data } = await readOverridesFile();
  const pin: RailCurationPin = {
    rail_id: railId,
    type,
    id,
    label: argValue('--label'),
    score: Number(argValue('--score') ?? 9999),
    skip_title_filter: argValue('--skip-title-filter') !== '0',
    session_slot: argValue('--slot') === undefined ? 0 : Number(argValue('--slot')),
    verify_probe: argValue('--verify-probe') === '1',
  };
  data.pins = data.pins.filter((entry) => !(entry.rail_id === railId && entry.id === id && entry.type === type));
  data.pins.push(pin);
  await writeOverridesFile(path, data);
  console.log(`added pin ${railId} ${type}/${id} → ${path}`);
}

async function cmdPinRemove(): Promise<void> {
  const railId = argValue('--rail');
  const id = argValue('--id');
  const type = argValue('--type') ?? 'series';
  if (!railId || !id) usage();
  const { path, data } = await readOverridesFile();
  const before = data.pins.length;
  data.pins = data.pins.filter((entry) => !(entry.rail_id === railId && entry.id === id && entry.type === type));
  await writeOverridesFile(path, data);
  console.log(`removed ${before - data.pins.length} pin(s) from ${path}`);
}

async function main(): Promise<void> {
  const [command, subcommand] = process.argv.slice(2);
  if (command === 'list') {
    await cmdList();
    return;
  }
  if (command === 'apply') {
    await cmdApply(process.argv.includes('--dry-run'));
    return;
  }
  if (command === 'pin' && subcommand === 'add') {
    await cmdPinAdd();
    return;
  }
  if (command === 'pin' && subcommand === 'remove') {
    await cmdPinRemove();
    return;
  }
  usage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
