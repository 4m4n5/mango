import { resolve } from 'node:path';
import { importYoutubeTakeoutFile } from './takeout.js';
import { refreshYoutubeAfterTakeoutImport } from './service.js';

const inputPath = process.argv[2]?.trim();
if (!inputPath) {
  console.error('usage: npm run youtube:takeout -- /path/to/takeout.zip');
  process.exitCode = 2;
} else {
  try {
    const absolutePath = resolve(inputPath);
    const result = await importYoutubeTakeoutFile(absolutePath, {
      filename: absolutePath.split('/').at(-1) || 'youtube-takeout',
    });
    const recommendationRefresh = await refreshYoutubeAfterTakeoutImport({ changed: !result.noop });
    console.log(JSON.stringify({
      ok: true,
      ...result,
      recommendation_refresh: recommendationRefresh,
    }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
