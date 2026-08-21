#!/usr/bin/env node
/** CLI — remove legacy rail_pool rows not in catalog.yaml. */

import { pruneLegacyPoolRails } from './rail-pool-legacy-prune.js';

function usage(): never {
  console.error(`usage:
  rail-pool-legacy-prune dry-run
  rail-pool-legacy-prune apply

  Removes pool memberships for: featured-global, popular-global, popular-india, trending-india.
  Titles remain in the global verified library; only legacy rail_pool rows are deleted.
`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  if (command !== 'dry-run' && command !== 'apply') {
    usage();
  }

  const result = await pruneLegacyPoolRails(command === 'dry-run');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
