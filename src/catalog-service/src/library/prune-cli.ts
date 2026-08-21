import { statSync } from 'node:fs';
import {
  initLibraryDb,
  libraryDatabase,
  libraryDbPath,
  pruneLibraryMaintenance,
  vacuumLibraryDatabase,
} from './db.js';
import { initYoutubeDb, pruneYoutubeMaintenance, vacuumYoutubeDatabase, youtubeDbPath } from '../youtube/db.js';
import {
  getPlayabilityDb,
  initPlayabilityDb,
  prunePlayabilityMaintenance,
  vacuumPlayabilityDatabase,
} from '../playability/db.js';

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function count(table: string): number {
  return Number(
    (libraryDatabase().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count,
  );
}

function fileBytes(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const libraryPath = libraryDbPath();
  const youtubePath = youtubeDbPath();
  initLibraryDb();
  await initPlayabilityDb();
  initYoutubeDb();
  const playabilityPath = getPlayabilityDb().name;
  const before = {
    library: fileBytes(libraryPath),
    playability: fileBytes(playabilityPath),
    youtube: fileBytes(youtubePath),
  };
  const library = pruneLibraryMaintenance();
  const youtube = pruneYoutubeMaintenance();
  const playability = prunePlayabilityMaintenance();
  if (flag('--vacuum')) {
    vacuumLibraryDatabase();
    vacuumPlayabilityDatabase();
    vacuumYoutubeDatabase();
  }
  process.stdout.write(`${JSON.stringify({
    pruned: { library, youtube, playability_deleted: playability },
    remaining: {
      story_generations: count('vod_story_dna_generations'),
      rank_generations: count('vod_rank_generations'),
      dna_documents: count('vod_story_dna_documents'),
      dna_edges: count('vod_story_dna_edges'),
      profile_edges: count('vod_content_profile_edges'),
      rank_items: count('vod_rank_items'),
      overlays: count('vod_story_dna_overlays'),
      refresh_jobs: count('recommendation_refresh_jobs'),
      saved: count('profile_saved_items'),
      ratings: count('profile_content_ratings'),
      takeout: count('youtube_takeout_history'),
    },
    bytes_before: before,
    bytes_after: {
      library: fileBytes(libraryPath),
      playability: fileBytes(playabilityPath),
      youtube: fileBytes(youtubePath),
    },
    vacuum: flag('--vacuum'),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
