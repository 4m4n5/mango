#!/usr/bin/env node

import Database from 'better-sqlite3';
import {
  DEEP_WEIGHTED_ALGORITHM_VERSION,
  deepSamplingMasses,
  deepWeightedDeal,
} from '../dist/recommendations/vod-browse-v3.js';

const dbPath = process.env.MANGO_PLAYABILITY_DB || '/etc/mango/playability.db';
const epochsArg = process.argv.find((value) => value.startsWith('--epochs='));
const epochs = Math.max(1, Number.parseInt(epochsArg?.split('=')[1] ?? '10000', 10));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

try {
  const rows = db.prepare(`
SELECT generations.tab, generations.generation_id, generations.source_revision,
       rails.rail_id, rails.payload_json
FROM vod_browse_active_reservoirs_v3 active
JOIN vod_browse_reservoir_generations_v3 generations
  ON generations.generation_id = active.active_generation_id
JOIN vod_browse_reservoir_rails_v3 rails ON rails.generation_id = generations.generation_id
WHERE generations.state = 'ready'
ORDER BY generations.tab, rails.rail_id
`).all();
  if (rows.length === 0) throw new Error('no active Browse v3 eligibility snapshots');
  const proof = [];
  for (const row of rows) {
    if (!String(row.source_revision).startsWith(`${DEEP_WEIGHTED_ALGORITHM_VERSION}:`)) {
      throw new Error(`${row.rail_id} is not a ${DEEP_WEIGHTED_ALGORITHM_VERSION} snapshot`);
    }
    const payload = JSON.parse(row.payload_json);
    const candidates = payload.filter((item) => item.trusted === true);
    const masses = deepSamplingMasses(candidates);
    if (masses.some((mass) => !Number.isFinite(mass) || mass <= 0)) {
      throw new Error(`${row.rail_id} contains a zero/non-finite sampling mass`);
    }
    const seen = new Set();
    const started = performance.now();
    for (let epoch = 0; epoch < epochs; epoch += 1) {
      for (const item of deepWeightedDeal(
        candidates,
        Math.min(9, candidates.length),
        `${row.tab}:proof:${row.generation_id}:${epoch}:${row.rail_id}`,
      )) seen.add(`${item.type}:${item.id}`);
    }
    proof.push({
      tab: row.tab,
      rail_id: row.rail_id,
      generation_id: row.generation_id,
      eligible: candidates.length,
      source_backed: candidates.filter((item) => item.membership_kind === 'source_backed').length,
      derived: candidates.filter((item) => item.membership_kind === 'derived').length,
      reached: seen.size,
      all_reached: seen.size === candidates.length,
      minimum_mass: masses.length > 0 ? Math.min(...masses) : 0,
      epochs,
      elapsed_ms: Number((performance.now() - started).toFixed(3)),
    });
  }
  const output = {
    ok: proof.every((rail) => rail.all_reached && rail.minimum_mass > 0),
    algorithm: DEEP_WEIGHTED_ALGORITHM_VERSION,
    db_path: dbPath,
    rails: proof,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.ok) process.exitCode = 1;
} finally {
  db.close();
}
