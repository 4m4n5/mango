import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import test from 'node:test';
import {
  activateViewerProfile,
  appendProfileRecommendationEvent,
  clearLibraryFeedback,
  completeViewerProfileOnboarding,
  clearSearchActivity,
  backupLibraryDbBeforeFireWaterMigration,
  createViewerProfile,
  getSearchPreferences,
  getPersonalizationState,
  getLatestEpisodeWatchProgress,
  getLibraryContext,
  getLibraryState,
  initLibraryDb,
  isLibrarySaveAllowed,
  libraryDomainForItem,
  libraryDatabase,
  libraryItemKey,
  libraryTabForItem,
  listLatestEpisodeWatchProgress,
  listSavedLibraryItems,
  listLibraryFeedback,
  listProfileLibraryFeedback,
  listViewerProfiles,
  listProfileRecommendationEvents,
  listProfileRecommendationSignals,
  listRecommendationLibrarySignals,
  listRecommendationAttribution,
  listSearchHistory,
  listSearchSelections,
  listWatchHistory,
  listUniqueWatchHistory,
  normalizeLibraryIdentity,
  recordLibraryWatch,
  recordRecommendationDetailOpen,
  recordRecommendationImpressions,
  recordRecommendationPlayStart,
  recordRecommendationProgress,
  registerRecommendationServedSlate,
  registerRecommendationServedSlates,
  recordSearchQuery,
  recordSearchSelection,
  renameViewerProfile,
  resetLibraryDbForTests,
  resolveRecommendationServedSlate,
  saveLibraryItem,
  setLibraryContext,
  setLibraryFeedback,
  setViewerMood,
  setSearchPreferences,
  unsaveLibraryItem,
} from './db.js';

function withTempLibrary<T>(fn: (dir: string) => T | Promise<T>): Promise<T> | T {
  const dir = mkdtempSync(join(tmpdir(), 'mango-library-'));
  process.env.MANGO_LIBRARY_DB_PATH = join(dir, 'library.db');
  process.env.MANGO_USER_PINS_PATH = join(dir, 'user-pins.json');
  resetLibraryDbForTests();
  const cleanup = () => {
    resetLibraryDbForTests();
    delete process.env.MANGO_LIBRARY_DB_PATH;
    delete process.env.MANGO_USER_PINS_PATH;
    rmSync(dir, { recursive: true, force: true });
  };
  try {
    const result = fn(dir);
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

test('libraryItemKey is source-aware and collapses series episodes', () => {
  assert.equal(libraryItemKey('mango', 'series', 'tt123:1:2'), 'mango:series:tt123');
  assert.equal(libraryItemKey('youtube', 'youtube_video', 'AbC_123-XyZ'), 'youtube:youtube_video:AbC_123-XyZ');
  assert.equal(libraryItemKey(undefined, 'youtube_video', 'AbC_123-XyZ'), 'mango:youtube_video:AbC_123-XyZ');
  assert.equal(libraryItemKey('mango', 'youtube_video', 'AbC_123-XyZ'), 'mango:youtube_video:AbC_123-XyZ');
  assert.notEqual(
    libraryItemKey('mango', 'movie', 'tt0111161'),
    libraryItemKey('youtube', 'movie', 'tt0111161'),
  );
});

test('YouTube type preserves item-key source while channel and playlist saves stay forbidden', () => {
  assert.deepEqual(normalizeLibraryIdentity(undefined, 'youtube_video'), {
    source: 'mango', type: 'youtube_video',
  });
  assert.deepEqual(normalizeLibraryIdentity('mango', 'YouTube_Video'), {
    source: 'mango', type: 'youtube_video',
  });
  assert.equal(isLibrarySaveAllowed(undefined, 'youtube_video'), true);
  assert.equal(isLibrarySaveAllowed('mango', 'youtube_video'), true);
  assert.equal(isLibrarySaveAllowed('youtube', 'youtube_channel'), false);
  assert.equal(isLibrarySaveAllowed(undefined, 'youtube_playlist'), false);
  assert.equal(isLibrarySaveAllowed('youtube', 'movie'), false);
  assert.equal(isLibrarySaveAllowed('mango', 'movie'), true);
  assert.equal(libraryDomainForItem('mango', 'youtube_video'), 'youtube');
  assert.equal(libraryDomainForItem('youtube', 'movie'), 'youtube');
  assert.equal(libraryDomainForItem('mango', 'movie'), 'vod');
});

test('known source and media type own the library tab over navigation fallback', () => {
  assert.equal(libraryTabForItem('youtube', 'movie', 'series'), 'youtube');
  assert.equal(libraryTabForItem('mango', 'youtube_video', 'movies'), 'youtube');
  assert.equal(libraryTabForItem('mango', 'series', 'movies'), 'series');
  assert.equal(libraryTabForItem('mango', 'tv', 'movies'), 'live');
  assert.equal(libraryTabForItem('mango', 'channel', 'series'), 'live');
  assert.equal(libraryTabForItem('mango', 'film', 'series'), 'movies');
  assert.equal(libraryTabForItem('mango', '', 'series'), 'movies');
  assert.equal(libraryTabForItem('mango', 'legacy_special', 'series'), 'series');
  assert.equal(libraryTabForItem('mango', 'legacy_special'), 'movies');
});

test('initLibraryDb creates WAL schema and migration row', () => withTempLibrary((dir) => {
  initLibraryDb();
  const db = new Database(join(dir, 'library.db'));
  try {
    const mode = db.pragma('journal_mode', { simple: true });
    assert.equal(String(mode).toLowerCase(), 'wal');
    const rows = db.prepare('SELECT version FROM library_migrations').all() as Array<{ version: number }>;
    assert.deepEqual(rows.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    const v2Tables = db.prepare(`
SELECT name FROM sqlite_master
WHERE type = 'table' AND name IN (
  'vod_story_dna_generations', 'vod_story_dna_documents',
  'vod_ontology_nodes', 'vod_ontology_edges', 'vod_story_dna_edges',
  'vod_taste_generations', 'vod_taste_threads',
  'vod_rank_generations', 'vod_rank_items',
  'vod_active_generations', 'vod_cached_slates', 'vod_cached_slate_items',
  'recommendation_refresh_jobs', 'vod_story_graph_low_water_requests'
)
ORDER BY name
`).all() as Array<{ name: string }>;
    assert.equal(v2Tables.length, 14);
    const progressiveTables = db.prepare(`
SELECT name FROM sqlite_master
WHERE type = 'table' AND name IN (
  'vod_content_profile_edges', 'vod_story_dna_overlays',
  'vod_semantic_frontier_queue', 'vod_semantic_metadata_cache',
  'vod_semantic_reference_items', 'vod_semantic_calibration', 'vod_story_dna_usage'
)
ORDER BY name
`).all() as Array<{ name: string }>;
    assert.equal(progressiveTables.length, 7);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='vod_story_graph_backgrounds'")
        .get() as { count: number }).count,
      1,
    );
    const slatePrimaryKey = db.prepare('PRAGMA table_info(vod_cached_slates)').all() as Array<{
      name: string;
      pk: number;
    }>;
    assert.deepEqual(
      slatePrimaryKey.filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name),
      ['rank_generation_id', 'content_type', 'shuffle_epoch'],
    );
  } finally {
    db.close();
  }
}));

test('progressive migrations and off-mode rollback preserve historical and StoryDNA data byte-for-byte', () => withTempLibrary(() => {
  initLibraryDb();
  const db = libraryDatabase();
  const featureJson = '{"schema_version":"story-dna-v1","title":"Preserved"}';
  const overlayJson = '{"identity":{"content_id":"tt-preserved"}}';
  db.prepare(`
INSERT INTO recommendation_features(
  content_type, content_id, feature_version, metadata_hash, provenance,
  confidence, features_json, model_version, prompt_version, input_hash,
  created_at, updated_at
) VALUES ('movie', 'tt-preserved', 'story-dna-v1', 'metadata-hash', 'ai',
          0.9, ?, 'teacher-model', 'story-dna-prompt-v1', 'input-hash', 10, 11)
`).run(featureJson);
  db.prepare(`
INSERT INTO vod_story_dna_overlays(
  content_type, content_id, semantic_evidence_hash, document_hash, document_json,
  schema_version, ontology_version, prompt_version, model_version, created_at
) VALUES ('movie', 'tt-preserved', 'semantic-hash', 'document-hash', ?,
          'story-dna-v1', 'story-dna-core-v1', 'story-dna-prompt-v1', 'teacher-model', 12)
`).run(overlayJson);
  const personal = createViewerProfile('Preserved Viewer');
  saveLibraryItem({
    profile_id: personal.profile_id,
    source: 'mango',
    type: 'movie',
    id: 'tt-preserved',
    title: 'Preserved',
    tab: 'movies',
    saved_at: 13,
  });

  process.env.MANGO_VOD_RECS_V2 = 'off';
  process.env.MANGO_YOUTUBE_RECS_V2 = 'off';
  resetLibraryDbForTests();
  initLibraryDb();

  const reopened = libraryDatabase();
  assert.equal((reopened.prepare(`
SELECT features_json FROM recommendation_features
WHERE content_type = 'movie' AND content_id = 'tt-preserved' AND feature_version = 'story-dna-v1'
`).get() as { features_json: string }).features_json, featureJson);
  assert.equal((reopened.prepare(`
SELECT document_json FROM vod_story_dna_overlays
WHERE content_type = 'movie' AND content_id = 'tt-preserved' AND semantic_evidence_hash = 'semantic-hash'
`).get() as { document_json: string }).document_json, overlayJson);
  assert.deepEqual(
    listSavedLibraryItems('movies', undefined, {
      profile_id: personal.profile_id,
      household_blend: false,
    }).map((item) => item.id),
    ['tt-preserved'],
  );
  assert.deepEqual(
    (reopened.prepare('SELECT version FROM library_migrations ORDER BY version').all() as Array<{ version: number }>)
      .map((row) => row.version),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  );
  delete process.env.MANGO_VOD_RECS_V2;
  delete process.env.MANGO_YOUTUBE_RECS_V2;
}));

test('a failed later migration rolls back its schema, backfills, and version markers together', () => withTempLibrary((dir) => {
  const path = join(dir, 'library.db');
  const seeded = new Database(path);
  seeded.exec(`
CREATE TABLE library_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
INSERT INTO library_migrations(version, applied_at) VALUES (1, 1), (2, 2), (3, 3), (4, 4);
-- Deliberately incompatible pre-existing v5 table: the Household insert must
-- fail after v5 has created other tables, exercising whole-graph rollback.
CREATE TABLE viewer_profiles(incompatible TEXT NOT NULL);
`);
  seeded.close();

  assert.throws(() => initLibraryDb(), /profile_id|no column/i);
  resetLibraryDbForTests();
  const inspected = new Database(path, { readonly: true });
  try {
    const versions = inspected.prepare('SELECT version FROM library_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4]);
    const partial = inspected.prepare(`
SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'personalization_state'
`).get();
    assert.equal(partial, undefined);
  } finally {
    inspected.close();
  }
}));

test('v8 creates profile metrics without attributing or mutating legacy global rows', () => withTempLibrary((dir) => {
  initLibraryDb();
  resetLibraryDbForTests();
  const path = join(dir, 'library.db');
  let db = new Database(path);
  db.exec(`
INSERT INTO recommendation_metrics(metric_name, metric_value, updated_at)
VALUES ('legacy_metric', 77, 123);
DROP TABLE profile_recommendation_metrics;
DELETE FROM library_migrations WHERE version = 8;
`);
  db.close();

  initLibraryDb();
  resetLibraryDbForTests();
  db = new Database(path, { readonly: true });
  try {
    const migration = db.prepare('SELECT version FROM library_migrations WHERE version = 8').get();
    assert.ok(migration);
    const scopedCount = db.prepare('SELECT COUNT(*) AS count FROM profile_recommendation_metrics')
      .get() as { count: number };
    assert.equal(scopedCount.count, 0);
    const legacy = db.prepare(`
SELECT metric_value, updated_at FROM recommendation_metrics WHERE metric_name = 'legacy_metric'
`).get();
    assert.deepEqual(legacy, { metric_value: 77, updated_at: 123 });
  } finally {
    db.close();
  }
}));

test('v10 assigns legacy watch state to Household without mutating the rollback row', () => withTempLibrary((dir) => {
  initLibraryDb();
  resetLibraryDbForTests();
  const path = join(dir, 'library.db');
  let db = new Database(path);
  db.exec(`
INSERT INTO library_items(
  item_key, source, type, id, title, poster, year, description, tab,
  hidden, hidden_at, hide_reason, blocked, blocked_at, block_reason,
  first_seen_at, updated_at
) VALUES (
  'mango:movie:tt-legacy-state', 'mango', 'movie', 'tt-legacy-state',
  'Legacy state', NULL, NULL, NULL, 'movies',
  0, NULL, NULL, 0, NULL, NULL, 100, 100
);
INSERT INTO watch_state(
  item_key, latest_play_id, position_sec, duration_sec, progress_pct,
  last_watched_at, finished_at
) VALUES ('mango:movie:tt-legacy-state', 'tt-legacy-state', 1200, 6000, 0.2, 1234, NULL);
DROP TABLE profile_watch_state;
DELETE FROM library_migrations WHERE version = 10;
`);
  db.close();

  initLibraryDb();
  assert.equal(getLibraryState({
    type: 'movie', id: 'tt-legacy-state', profile_id: 'household',
  }).latest_watch?.position_sec, 1200);
  const alice = createViewerProfile('Legacy State Alice');
  assert.equal(getLibraryState({
    type: 'movie', id: 'tt-legacy-state', profile_id: alice.profile_id,
  }).latest_watch, null);

  resetLibraryDbForTests();
  db = new Database(path, { readonly: true });
  try {
    const legacy = db.prepare(`
SELECT position_sec, last_watched_at FROM watch_state
WHERE item_key = 'mango:movie:tt-legacy-state'
`).get();
    assert.deepEqual(legacy, { position_sec: 1200, last_watched_at: 1234 });
  } finally {
    db.close();
  }
}));

test('v11 adds served-slate context without destroying existing tokens or membership', () => withTempLibrary((dir) => {
  const alice = createViewerProfile('Legacy Served Alice');
  const served = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'vod',
    rail_id: 'for-you-movies',
    source_revision: 41,
    now: 1_000,
    items: [{ type: 'movie', id: 'tt-preserved', rank: 0 }],
  });
  resetLibraryDbForTests();
  const path = join(dir, 'library.db');
  let db = new Database(path);
  db.exec(`
ALTER TABLE profile_recommendation_served_slates DROP COLUMN context_id;
DELETE FROM library_migrations WHERE version = 11;
`);
  db.close();

  initLibraryDb();
  assert.deepEqual(resolveRecommendationServedSlate({
    attribution_token: served.attribution_token,
    domain: 'vod',
    rail_id: served.rail_id,
    slate_revision: served.slate_revision,
    items: served.items,
    now: 2_000,
  }), {
    ...served,
    context_id: '',
  });
  resetLibraryDbForTests();
  db = new Database(path, { readonly: true });
  try {
    const columns = db.prepare('PRAGMA table_info(profile_recommendation_served_slates)')
      .all() as Array<{ name: string }>;
    assert.equal(columns.some((column) => column.name === 'context_id'), true);
    assert.ok(db.prepare('SELECT 1 FROM library_migrations WHERE version = 11').get());
  } finally {
    db.close();
  }
}));

test('viewer profile lifecycle is explicit, sanitized, stable, and preserves Household invariants', () => withTempLibrary(() => {
  const initialProfiles = listViewerProfiles();
  assert.deepEqual(initialProfiles.map((profile) => ({
    id: profile.profile_id,
    name: profile.name,
    kind: profile.kind,
    onboarding: profile.onboarding_complete,
  })), [{ id: 'household', name: 'Household', kind: 'household', onboarding: true }]);
  assert.equal(getPersonalizationState().active_profile_id, 'household');
  setViewerMood('Cozy');

  const created = createViewerProfile('  Alice    Smith  ');
  assert.equal(created.profile_id, 'alice-smith');
  assert.equal(created.name, 'Alice Smith');
  assert.equal(created.kind, 'personal');
  assert.equal(created.onboarding_complete, false);
  // Creation never switches profiles or introduces a startup prompt.
  assert.equal(getPersonalizationState().active_profile_id, 'household');
  assert.equal(getPersonalizationState().mood, 'Cozy');
  assert.throws(() => createViewerProfile('alice smith'), /already exists/);

  const renamed = renameViewerProfile(created.profile_id, '  Alice   Prime ');
  assert.equal(renamed.profile_id, created.profile_id);
  assert.equal(renamed.name, 'Alice Prime');
  assert.equal(renamed.onboarding_complete, false);
  assert.throws(() => renameViewerProfile('household', 'Family'), /cannot be renamed/);

  const activated = activateViewerProfile(created.profile_id.toUpperCase());
  assert.equal(activated.active_profile_id, created.profile_id);
  assert.equal(activated.mood, null);
  assert.equal(listViewerProfiles().find((profile) => profile.profile_id === created.profile_id)
    ?.onboarding_complete, false);

  const completed = completeViewerProfileOnboarding(created.profile_id);
  assert.equal(completed.onboarding_complete, true);
  assert.deepEqual(completeViewerProfileOnboarding(created.profile_id), completed);
  assert.equal(completeViewerProfileOnboarding('household').name, 'Household');
}));

test('personalization revisions advance monotonically even when wall time does not', () => withTempLibrary(() => {
  const alice = createViewerProfile('Revision Alice');
  const db = libraryDatabase();
  const futureRevision = 9_000_000_000_000;
  db.prepare('UPDATE personalization_state SET updated_at = ? WHERE state_id = 1')
    .run(futureRevision);

  const activated = activateViewerProfile(alice.profile_id);
  assert.equal(activated.updated_at, futureRevision + 1);

  db.prepare(`
UPDATE personalization_state
SET mood = 'expired', mood_started_at = 1, mood_expires_at = 2, updated_at = ?
WHERE state_id = 1
`).run(futureRevision + 10);
  const expired = getPersonalizationState(3);
  assert.equal(expired.mood, null);
  assert.equal(expired.updated_at, futureRevision + 11);

  const mood = setViewerMood('Cozy');
  assert.equal(mood.updated_at, futureRevision + 12);
}));

test('pre-ratings migration uses SQLite online backup once and preserves legacy state', () => withTempLibrary(async (dir) => {
  const path = join(dir, 'library.db');
  const legacy = new Database(path);
  legacy.exec(`
CREATE TABLE library_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
INSERT INTO library_migrations(version, applied_at) VALUES (1, 1), (2, 2), (3, 3);
CREATE TABLE legacy_proof(value TEXT NOT NULL);
INSERT INTO legacy_proof(value) VALUES ('preserved');
`);
  legacy.close();

  const backup = await backupLibraryDbBeforeFireWaterMigration();
  assert.equal(backup, `${path}.pre-fire-water-v4.bak`);
  assert.equal(existsSync(backup!), true);
  const backedUp = new Database(backup!, { readonly: true });
  assert.equal((backedUp.prepare('SELECT value FROM legacy_proof').get() as { value: string }).value, 'preserved');
  backedUp.close();
  assert.equal(await backupLibraryDbBeforeFireWaterMigration(), backup);
}));

test('search activity keeps 12 unique recents and clear removes learning too', () => withTempLibrary(() => {
  for (let index = 0; index < 14; index += 1) {
    recordSearchQuery(`query ${index}`, `Query ${index}`, 1_000 + index);
  }
  recordSearchQuery('query 13', 'Query Thirteen', 2_000);
  recordSearchSelection({
    normalized_query: 'query 13',
    entity_key: 'mango:movie:tt13',
    source: 'mango',
    type: 'movie',
    id: 'tt13',
    title: 'Query Thirteen',
    selected_at: 2_001,
  });
  recordSearchSelection({
    normalized_query: 'query 13',
    entity_key: 'mango:movie:tt13',
    source: 'mango',
    type: 'movie',
    id: 'tt13',
    title: 'Query Thirteen',
    selected_at: 2_002,
  });

  const recents = listSearchHistory();
  assert.equal(recents.length, 12);
  assert.equal(recents[0]?.display_query, 'Query Thirteen');
  assert.equal(listSearchSelections('query 13')[0]?.selection_count, 2);
  assert.deepEqual(clearSearchActivity(), { history: 12, selections: 1 });
  assert.deepEqual(listSearchHistory(), []);
  assert.deepEqual(listSearchSelections('query 13'), []);
}));

test('search SafeSearch defaults moderate and persists valid choices', () => withTempLibrary(() => {
  assert.equal(getSearchPreferences().youtube_safe_search, 'moderate');
  assert.equal(setSearchPreferences({ youtube_safe_search: 'strict' }).youtube_safe_search, 'strict');
  assert.equal(getSearchPreferences().youtube_safe_search, 'strict');
  assert.throws(
    () => setSearchPreferences({ youtube_safe_search: 'unsafe' as 'strict' }),
    /moderate, strict, or none/,
  );
}));

test('library feedback stores local source-aware negative signals', () => withTempLibrary(() => {
  const feedback = setLibraryFeedback({
    source: 'youtube',
    type: 'youtube_video',
    id: 'abc123',
    title: 'Nope',
    tab: 'youtube',
    feedback: 'not_interested',
    reason: 'user',
    created_at: 3000,
  });
  assert.equal(feedback.source, 'youtube');
  assert.equal(feedback.type, 'youtube_video');
  assert.equal(feedback.feedback, 'not_interested');
  const rows = listLibraryFeedback('not_interested', 'youtube');
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, 'abc123');
}));

test('saved upsert and delete are idempotent', () => withTempLibrary(() => {
  const first = saveLibraryItem({
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    tab: 'movies',
  });
  const second = saveLibraryItem({
    type: 'movie',
    id: 'tt0111161',
    title: 'The Shawshank Redemption',
    tab: 'movies',
  });
  assert.equal(first.item_key, second.item_key);
  assert.equal(listSavedLibraryItems('movies').length, 1);
  assert.equal(getLibraryState({ type: 'movie', id: 'tt0111161' }).saved, true);
  assert.equal(unsaveLibraryItem({ type: 'movie', id: 'tt0111161' }), true);
  assert.equal(unsaveLibraryItem({ type: 'movie', id: 'tt0111161' }), false);
  assert.equal(getLibraryState({ type: 'movie', id: 'tt0111161' }).saved, false);
}));

test('Dune saved from TV Search stays movie-owned across every library write and read', () => withTempLibrary(() => {
  const dune = {
    source: 'mango',
    type: 'movie',
    id: 'tt1160419',
    title: 'Dune',
    tab: 'series' as const,
  };
  const saved = saveLibraryItem({ ...dune, saved_at: 1_000 });
  assert.equal(saved.tab, 'movies');
  assert.deepEqual(listSavedLibraryItems('movies').map((row) => row.id), ['tt1160419']);
  assert.deepEqual(listSavedLibraryItems('series'), []);

  // A direct malformed row cannot leak through a read boundary while waiting
  // for the next startup migration/upsert to repair its derived field.
  libraryDatabase().prepare('UPDATE library_items SET tab = ? WHERE item_key = ?')
    .run('series', saved.item_key);
  assert.deepEqual(listSavedLibraryItems('movies').map((row) => row.id), ['tt1160419']);
  assert.deepEqual(listSavedLibraryItems('series'), []);
  assert.equal(getLibraryState(dune).tab, 'movies');

  assert.equal(setLibraryContext(dune, { opened_at: 2_000 }).tab, 'movies');
  assert.equal(getLibraryContext()?.tab, 'movies');
  recordLibraryWatch({
    ...dune,
    position_sec: 120,
    duration_sec: 600,
    watched_at: 3_000,
  });
  assert.equal(getLibraryState(dune).tab, 'movies');
  const feedback = setLibraryFeedback({
    ...dune,
    feedback: 'not_interested',
    created_at: 4_000,
  });
  assert.equal(feedback.tab, 'movies');
  assert.equal(listLibraryFeedback('not_interested')[0]?.tab, 'movies');
  assert.equal(
    (libraryDatabase().prepare('SELECT tab FROM library_items WHERE item_key = ?')
      .get(saved.item_key) as { tab: string }).tab,
    'movies',
  );
}));

test('missing library state derives its tab from source and type together', () => withTempLibrary(() => {
  assert.equal(getLibraryState({
    source: 'youtube', type: 'legacy_special', id: 'missing-youtube',
  }).tab, 'youtube');
  assert.equal(getLibraryState({
    source: 'mango', type: 'youtube_video', id: 'MissingVideo',
  }).tab, 'youtube');
  assert.equal(getLibraryState({
    source: 'mango', type: 'movie', id: 'tt-missing',
  }).tab, 'movies');
}));

test('YouTube video tab is canonical without rekeying a missing or contradictory source', () => withTempLibrary(() => {
  const first = saveLibraryItem({
    type: 'youtube_video', id: 'CaseSensitiveVideo', title: 'Video', tab: 'series', saved_at: 1_000,
  });
  assert.equal(first.source, 'mango');
  assert.equal(first.item_key, 'mango:youtube_video:CaseSensitiveVideo');
  assert.equal(first.tab, 'youtube');
  assert.equal(getLibraryState({ type: 'youtube_video', id: 'CaseSensitiveVideo' }).saved, true);

  const second = saveLibraryItem({
    source: 'mango', type: 'youtube_video', id: 'CaseSensitiveVideo',
    title: 'Updated video', tab: 'movies', saved_at: 2_000,
  });
  assert.equal(second.item_key, first.item_key);
  assert.equal(second.source, 'mango');
  assert.equal(second.tab, 'youtube');
  assert.equal(listSavedLibraryItems('youtube').length, 1);
  assert.deepEqual(listSavedLibraryItems('movies'), []);

  recordLibraryWatch({
    type: 'youtube_video', id: 'CaseSensitiveVideo', title: 'Updated video', tab: 'movies',
    event: 'play', watched_at: 3_000,
  });
  assert.equal(listWatchHistory(1)[0]?.source, 'mango');
  assert.equal(
    listProfileRecommendationEvents({ domain: 'youtube' })
      .some((event) => event.item_id === 'CaseSensitiveVideo'),
    true,
  );
  assert.equal(unsaveLibraryItem({ type: 'youtube_video', id: 'CaseSensitiveVideo' }), true);
}));

test('migration 18 repairs only tabs and is idempotent', () => withTempLibrary(() => {
  const dune = saveLibraryItem({
    source: 'mango', type: 'movie', id: 'tt1160419', title: 'Dune',
    poster: 'dune.jpg', year: '2021', description: 'Arrakis', tab: 'movies', saved_at: 1_000,
  });
  recordLibraryWatch({
    source: 'mango', type: 'movie', id: 'tt1160419', title: 'Dune', tab: 'movies',
    play_id: 'play-dune', position_sec: 240, duration_sec: 600, watched_at: 2_000,
  });
  setLibraryFeedback({
    source: 'mango', type: 'movie', id: 'tt1160419', title: 'Dune', tab: 'movies',
    feedback: 'not_interested', reason: 'fixture', created_at: 3_000,
  });
  setLibraryContext({
    source: 'mango', type: 'movie', id: 'tt1160419', title: 'Dune', tab: 'movies',
  }, { opened_at: 4_000 });
  const series = saveLibraryItem({
    source: 'mango', type: 'series', id: 'tt-series', title: 'Series', tab: 'series', saved_at: 5_000,
  });
  const youtube = saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'VideoCase', title: 'Video',
    tab: 'youtube', saved_at: 6_000,
  });
  const alreadyCanonical = saveLibraryItem({
    source: 'mango', type: 'movie', id: 'tt-canonical', title: 'Already canonical',
    tab: 'movies', saved_at: 6_100,
  });

  const db = libraryDatabase();
  db.prepare(`
INSERT INTO content_ratings(
  content_type, content_id, title, fire_steps, water_steps, origin, revision, created_at, updated_at
) VALUES ('movie', 'tt1160419', 'Dune', 9, 8, 'couch', 1, 6500, 6500)
`).run();
  db.prepare(`
INSERT INTO profile_content_ratings(
  profile_id, content_type, content_id, title,
  fire_steps, water_steps, origin, revision, created_at, updated_at
) VALUES ('household', 'movie', 'tt1160419', 'Dune', 9, 8, 'couch', 1, 6500, 6500)
`).run();
  db.prepare('UPDATE library_items SET tab = ? WHERE item_key = ?').run('series', dune.item_key);
  db.prepare('UPDATE library_items SET tab = ? WHERE item_key = ?').run('movies', series.item_key);
  db.prepare('UPDATE library_items SET tab = ? WHERE item_key = ?').run('series', youtube.item_key);
  db.exec(`
CREATE TABLE migration_18_update_audit(item_key TEXT NOT NULL);
CREATE TRIGGER migration_18_update_audit_trigger
AFTER UPDATE OF tab ON library_items
BEGIN
  INSERT INTO migration_18_update_audit(item_key) VALUES (NEW.item_key);
END;
`);
  db.prepare('DELETE FROM library_migrations WHERE version = 18').run();

  const tableNames = [
    'viewer_profiles',
    'personalization_state',
    'saved_items',
    'profile_saved_items',
    'watch_state',
    'profile_watch_state',
    'watch_history',
    'profile_watch_history',
    'library_feedback',
    'profile_library_feedback',
    'library_context',
    'content_ratings',
    'profile_content_ratings',
    'profile_recommendation_events',
  ];
  const snapshotTables = (database: Database.Database): Record<string, unknown[]> => Object.fromEntries(
    tableNames.map((table) => [table, database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
  );
  const beforeItems = db.prepare('SELECT * FROM library_items ORDER BY item_key').all() as Array<Record<string, unknown>>;
  const beforeReferences = snapshotTables(db);

  resetLibraryDbForTests();
  initLibraryDb();
  const migrated = libraryDatabase();
  const afterItems = migrated.prepare('SELECT * FROM library_items ORDER BY item_key').all() as Array<Record<string, unknown>>;
  const stripTab = (row: Record<string, unknown>): Record<string, unknown> => {
    const { tab: _tab, ...rest } = row;
    return rest;
  };
  assert.deepEqual(afterItems.map(stripTab), beforeItems.map(stripTab));
  assert.deepEqual(snapshotTables(migrated), beforeReferences);
  assert.deepEqual(
    Object.fromEntries(afterItems.map((row) => [String(row.item_key), row.tab])),
    {
      [dune.item_key]: 'movies',
      [series.item_key]: 'series',
      [youtube.item_key]: 'youtube',
      [alreadyCanonical.item_key]: 'movies',
    },
  );
  assert.deepEqual(
    migrated.prepare('SELECT item_key FROM migration_18_update_audit ORDER BY item_key').all(),
    [dune.item_key, series.item_key, youtube.item_key]
      .sort()
      .map((item_key) => ({ item_key })),
  );
  assert.equal(
    (migrated.prepare('SELECT COUNT(*) AS count FROM library_migrations WHERE version = 18')
      .get() as { count: number }).count,
    1,
  );

  const afterReferences = snapshotTables(migrated);
  resetLibraryDbForTests();
  initLibraryDb();
  const reopened = libraryDatabase();
  assert.deepEqual(
    reopened.prepare('SELECT * FROM library_items ORDER BY item_key').all(),
    afterItems,
  );
  assert.deepEqual(snapshotTables(reopened), afterReferences);
  assert.equal(
    (reopened.prepare('SELECT COUNT(*) AS count FROM migration_18_update_audit')
      .get() as { count: number }).count,
    3,
  );
  assert.equal(
    (reopened.prepare('SELECT COUNT(*) AS count FROM library_migrations WHERE version = 18')
      .get() as { count: number }).count,
    1,
  );
}));

test('migration 18 rolls back every tab repair and its marker on failure', () => withTempLibrary((dir) => {
  const dune = saveLibraryItem({
    source: 'mango', type: 'movie', id: 'tt1160419', title: 'Dune', tab: 'movies', saved_at: 1_000,
  });
  const series = saveLibraryItem({
    source: 'mango', type: 'series', id: 'tt-series-rollback', title: 'Series', tab: 'series', saved_at: 2_000,
  });
  const db = libraryDatabase();
  db.prepare('UPDATE library_items SET tab = ? WHERE item_key = ?').run('series', dune.item_key);
  db.prepare('UPDATE library_items SET tab = ? WHERE item_key = ?').run('movies', series.item_key);
  db.prepare('DELETE FROM library_migrations WHERE version = 18').run();
  db.exec(`
CREATE TRIGGER fail_migration_18_before_second_repair
BEFORE UPDATE OF tab ON library_items
WHEN NEW.item_key = '${series.item_key}'
BEGIN
  SELECT RAISE(ABORT, 'migration 18 rollback fixture');
END;
`);
  resetLibraryDbForTests();

  assert.throws(() => initLibraryDb(), /migration 18 rollback fixture/);
  resetLibraryDbForTests();
  const failed = new Database(join(dir, 'library.db'));
  assert.deepEqual(
    failed.prepare('SELECT item_key, tab FROM library_items WHERE item_key IN (?, ?) ORDER BY item_key')
      .all(dune.item_key, series.item_key),
    [
      { item_key: dune.item_key, tab: 'series' },
      { item_key: series.item_key, tab: 'movies' },
    ].sort((left, right) => left.item_key.localeCompare(right.item_key)),
  );
  assert.equal(
    (failed.prepare('SELECT COUNT(*) AS count FROM library_migrations WHERE version = 18')
      .get() as { count: number }).count,
    0,
  );
  failed.exec('DROP TRIGGER fail_migration_18_before_second_repair');
  failed.close();

  initLibraryDb();
  const recovered = libraryDatabase();
  assert.deepEqual(
    recovered.prepare('SELECT item_key, tab FROM library_items WHERE item_key IN (?, ?) ORDER BY item_key')
      .all(dune.item_key, series.item_key),
    [
      { item_key: dune.item_key, tab: 'movies' },
      { item_key: series.item_key, tab: 'series' },
    ].sort((left, right) => left.item_key.localeCompare(right.item_key)),
  );
  assert.equal(
    (recovered.prepare('SELECT COUNT(*) AS count FROM library_migrations WHERE version = 18')
      .get() as { count: number }).count,
    1,
  );
}));

test('explicit domain owner writes Household utility state without switching the active profile', () => withTempLibrary(() => {
  const personal = createViewerProfile('Mixed Utility Owner');
  activateViewerProfile(personal.profile_id);

  saveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'HouseholdSaved',
    title: 'Household saved',
    tab: 'youtube',
    profile_id: 'household',
  });
  assert.deepEqual(listSavedLibraryItems('youtube'), []);
  assert.deepEqual(listSavedLibraryItems('youtube', 10, {
    profile_id: 'household',
    household_blend: false,
  }).map((row) => row.id), ['HouseholdSaved']);
  assert.equal(getLibraryState({
    source: 'youtube',
    type: 'youtube_video',
    id: 'HouseholdSaved',
    profile_id: 'household',
  }).saved, true);
  assert.equal(unsaveLibraryItem({
    source: 'youtube',
    type: 'youtube_video',
    id: 'HouseholdSaved',
    profile_id: 'household',
  }), true);

  setLibraryFeedback({
    source: 'youtube',
    type: 'youtube_video',
    id: 'HouseholdVeto',
    title: 'Household veto',
    tab: 'youtube',
    feedback: 'not_interested',
    profile_id: 'household',
  });
  assert.deepEqual(listProfileLibraryFeedback('not_interested', 'youtube', {
    profile_id: personal.profile_id,
    household_blend: false,
  }), []);
  assert.deepEqual(listProfileLibraryFeedback('not_interested', 'youtube', {
    profile_id: 'household',
    household_blend: false,
  }).map((row) => row.id), ['HouseholdVeto']);
  assert.equal(clearLibraryFeedback({
    source: 'youtube',
    type: 'youtube_video',
    id: 'HouseholdVeto',
    feedback: 'not_interested',
    profile_id: 'household',
  }), true);
}));

test('unsave prunes unreferenced metadata but keeps watched metadata', () => withTempLibrary((dir) => {
  saveLibraryItem({ source: 'gate', type: 'movie', id: 'tt0000001', title: 'Gate' });
  assert.equal(unsaveLibraryItem({ source: 'gate', type: 'movie', id: 'tt0000001' }), true);

  let db = new Database(join(dir, 'library.db'));
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM library_items WHERE source = 'gate'")
      .get() as { count: number }).count,
    0,
  );
  db.close();

  saveLibraryItem({ type: 'movie', id: 'tt0111161', title: 'Watched' });
  recordLibraryWatch({
    type: 'movie',
    id: 'tt0111161',
    position_sec: 10,
    duration_sec: 100,
  });
  assert.equal(unsaveLibraryItem({ type: 'movie', id: 'tt0111161' }), true);

  db = new Database(join(dir, 'library.db'));
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS count FROM library_items WHERE id = 'tt0111161'")
      .get() as { count: number }).count,
    1,
  );
  db.close();
}));

test('legacy user-pins import runs once into Saved rows', () => withTempLibrary((dir) => {
  writeFileSync(
    join(dir, 'user-pins.json'),
    JSON.stringify({
      version: 1,
      pins: [
        {
          tab: 'movies',
          type: 'movie',
          id: 'tt0468569',
          title: 'The Dark Knight',
          poster: 'https://example.test/dark.jpg',
          pinned_at: 1234,
        },
        {
          tab: 'series',
          type: 'youtube_video',
          id: 'LegacyVideoCase',
          title: 'Legacy YouTube video',
          pinned_at: 1235,
        },
      ],
    }),
    'utf8',
  );

  initLibraryDb();
  assert.equal(listSavedLibraryItems('movies').length, 1);
  assert.deepEqual(listSavedLibraryItems('youtube').map((row) => row.item_key), [
    'mango:youtube_video:LegacyVideoCase',
  ]);
  assert.equal(
    listProfileRecommendationEvents({ domain: 'youtube' })
      .some((event) => event.item_id === 'LegacyVideoCase' && event.event_type === 'saved'),
    true,
  );
  resetLibraryDbForTests();
  initLibraryDb();
  const saved = listSavedLibraryItems('movies');
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.saved_at, 1234);
  assert.equal(listSavedLibraryItems('youtube').length, 1);
}));

test('watch history is indefinite and finished state uses 90 percent cutoff', () => withTempLibrary(() => {
  recordLibraryWatch({
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    position_sec: 30,
    duration_sec: 600,
    watched_at: 1000,
  });
  recordLibraryWatch({
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    position_sec: 540,
    duration_sec: 600,
    watched_at: 2000,
  });
  const history = listWatchHistory(10);
  assert.equal(history.length, 2);
  assert.equal(history[0]?.event, 'finished');
  const state = getLibraryState({ type: 'movie', id: 'tt0111161' });
  assert.equal(state.finished, true);
  assert.equal(state.finished_at, 2000);
  assert.equal(state.latest_watch?.progress_pct, 0.9);
}));

test('listLatestEpisodeWatchProgress keeps one row per episode play_id', () => withTempLibrary(() => {
  recordLibraryWatch({
    type: 'series',
    id: 'tt12004706',
    play_id: 'tt12004706:1:1',
    title: 'Panchayat',
    position_sec: 100,
    duration_sec: 1800,
    watched_at: 1000,
  });
  recordLibraryWatch({
    type: 'series',
    id: 'tt12004706',
    play_id: 'tt12004706:1:1',
    title: 'Panchayat',
    position_sec: 240,
    duration_sec: 1800,
    watched_at: 2000,
  });
  recordLibraryWatch({
    type: 'series',
    id: 'tt12004706',
    play_id: 'tt12004706:1:2',
    title: 'Panchayat',
    position_sec: 60,
    duration_sec: 1800,
    watched_at: 3000,
  });
  const rows = listLatestEpisodeWatchProgress('tt12004706');
  assert.equal(rows.length, 2);
  const byId = new Map(rows.map((row) => [row.play_id, row]));
  assert.equal(byId.get('tt12004706:1:1')?.position_sec, 240);
  assert.equal(byId.get('tt12004706:1:2')?.position_sec, 60);
  assert.equal(getLatestEpisodeWatchProgress('tt12004706', 'tt12004706:1:1')?.position_sec, 240);
  assert.equal(getLatestEpisodeWatchProgress('tt12004706', 'tt12004706:2:9'), null);
}));

test('library watch state and per-episode resume remain exact to the playback owner', () => withTempLibrary(() => {
  const alice = createViewerProfile('State Alice');
  const bob = createViewerProfile('State Bob');
  const base = {
    type: 'series',
    id: 'tt-profile-series',
    play_id: 'tt-profile-series:1:1',
    title: 'Profile Series',
    duration_sec: 1_000,
  };
  recordLibraryWatch({
    ...base,
    profile_id: alice.profile_id,
    position_sec: 200,
    watched_at: 1_000,
  });
  recordLibraryWatch({
    ...base,
    profile_id: bob.profile_id,
    position_sec: 700,
    watched_at: 2_000,
  });

  assert.equal(getLibraryState({
    type: 'series', id: base.id, profile_id: alice.profile_id,
  }).latest_watch?.position_sec, 200);
  assert.equal(getLibraryState({
    type: 'series', id: base.id, profile_id: bob.profile_id,
  }).latest_watch?.position_sec, 700);
  assert.equal(getLatestEpisodeWatchProgress(base.id, base.play_id, {
    profile_id: alice.profile_id,
  })?.position_sec, 200);
  assert.equal(getLatestEpisodeWatchProgress(base.id, base.play_id, {
    profile_id: bob.profile_id,
  })?.position_sec, 700);

  const clean = createViewerProfile('State Clean');
  assert.equal(getLibraryState({
    type: 'series', id: base.id, profile_id: clean.profile_id,
  }).latest_watch, null);
  assert.deepEqual(listLatestEpisodeWatchProgress(base.id, {
    profile_id: clean.profile_id,
  }), []);
  // Household exact resume never borrows a personal profile's position.
  assert.equal(getLibraryState({
    type: 'series', id: base.id, profile_id: 'household',
  }).latest_watch, null);
}));

test('unique watch history returns latest row per source-aware item', () => withTempLibrary(() => {
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'VideoA',
    title: 'Video A old',
    tab: 'youtube',
    watched_at: 1000,
  });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'VideoA',
    title: 'Video A latest',
    tab: 'youtube',
    watched_at: 2000,
  });
  recordLibraryWatch({
    source: 'youtube',
    type: 'youtube_video',
    id: 'VideoB',
    title: 'Video B',
    tab: 'youtube',
    watched_at: 3000,
  });
  recordLibraryWatch({
    source: 'mango',
    type: 'movie',
    id: 'tt0111161',
    title: 'Shawshank',
    tab: 'movies',
    watched_at: 4000,
  });

  const history = listUniqueWatchHistory({ source: 'youtube', type: 'youtube_video' });
  assert.deepEqual(history.map((row) => row.id), ['VideoB', 'VideoA']);
  assert.equal(history[1]?.title, 'Video A latest');
}));

test('v6 signal migration preserves legacy rows and exposes them to Household', () => withTempLibrary((dir) => {
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'LegacySaved', title: 'Legacy saved', tab: 'youtube',
    saved_at: 1_000,
  });
  recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: 'LegacyWatched', title: 'Legacy watched', tab: 'youtube',
    event: 'play', watched_at: 2_000,
  });
  setLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: 'LegacyNope', title: 'Legacy nope', tab: 'youtube',
    feedback: 'not_interested', created_at: 3_000,
  });
  resetLibraryDbForTests();

  const path = join(dir, 'library.db');
  let db = new Database(path);
  db.exec(`
DELETE FROM profile_recommendation_events;
DROP TABLE profile_library_feedback;
DROP TABLE profile_watch_history;
DROP TABLE profile_saved_items;
DELETE FROM library_migrations WHERE version = 6;
`);
  db.close();

  initLibraryDb();
  assert.deepEqual(listSavedLibraryItems('youtube').map((row) => row.id), ['LegacySaved']);
  assert.deepEqual(
    listUniqueWatchHistory({ source: 'youtube', type: 'youtube_video' }).map((row) => row.id),
    ['LegacyWatched'],
  );
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube').map((row) => row.id), ['LegacyNope']);
  const signals = listProfileRecommendationSignals({ profile_id: 'household', domain: 'youtube' });
  assert.equal(signals.find((row) => row.item_id === 'LegacySaved')?.saved, true);
  assert.equal(signals.find((row) => row.item_id === 'LegacyWatched')?.watched, true);
  assert.equal(signals.find((row) => row.item_id === 'LegacyNope')?.not_interested, true);

  resetLibraryDbForTests();
  db = new Database(path, { readonly: true });
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM saved_items').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM watch_history').get() as { count: number }).count, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM library_feedback').get() as { count: number }).count, 1);
  db.close();
}));

test('personal signals are isolated while Household blends saves, watches, and exact vetoes', () => withTempLibrary(() => {
  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'HouseSaved', title: 'House saved', tab: 'youtube',
    saved_at: 1_000,
  });
  recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: 'HouseWatched', title: 'House watched', tab: 'youtube',
    event: 'play', watched_at: 1_100,
  });
  setLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: 'SharedVeto', title: 'Shared veto', tab: 'youtube',
    feedback: 'not_interested', created_at: 1_200,
  });

  const alice = createViewerProfile('Alice');
  activateViewerProfile(alice.profile_id);
  assert.deepEqual(listSavedLibraryItems('youtube'), []);
  assert.deepEqual(listUniqueWatchHistory({ source: 'youtube', type: 'youtube_video' }), []);
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube'), []);

  saveLibraryItem({
    source: 'youtube', type: 'youtube_video', id: 'AliceSaved', title: 'Alice saved', tab: 'youtube',
    saved_at: 2_000,
  });
  recordLibraryWatch({
    source: 'youtube', type: 'youtube_video', id: 'AliceWatched', title: 'Alice watched', tab: 'youtube',
    event: 'play', watched_at: 2_100,
  });
  setLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: 'SharedVeto', title: 'Shared veto', tab: 'youtube',
    feedback: 'not_interested', created_at: 2_200,
  });

  const bob = createViewerProfile('Bob');
  activateViewerProfile(bob.profile_id);
  assert.deepEqual(listSavedLibraryItems('youtube'), []);
  assert.deepEqual(listUniqueWatchHistory({ source: 'youtube', type: 'youtube_video' }), []);
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube'), []);

  activateViewerProfile('household');
  assert.deepEqual(
    new Set(listSavedLibraryItems('youtube').map((row) => row.id)),
    new Set(['HouseSaved', 'AliceSaved']),
  );
  assert.deepEqual(
    new Set(listUniqueWatchHistory({ source: 'youtube', type: 'youtube_video' }).map((row) => row.id)),
    new Set(['HouseWatched', 'AliceWatched']),
  );
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube').map((row) => row.id), ['SharedVeto']);
  assert.equal(clearLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: 'SharedVeto', feedback: 'not_interested',
  }), true);
  // Alice's exact negative remains a Household veto even after Household clears its own copy.
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube').map((row) => row.id), ['SharedVeto']);

  activateViewerProfile(alice.profile_id);
  assert.equal(clearLibraryFeedback({
    source: 'youtube', type: 'youtube_video', id: 'SharedVeto', feedback: 'not_interested',
  }), true);
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube'), []);
  activateViewerProfile('household');
  assert.deepEqual(listLibraryFeedback('not_interested', 'youtube'), []);
}));

test('recommendation library signals honor an explicit captured profile owner', () => withTempLibrary(() => {
  const alice = createViewerProfile('Alice');
  const bob = createViewerProfile('Bob');
  activateViewerProfile(alice.profile_id);
  saveLibraryItem({
    source: 'mango', type: 'movie', id: 'AliceMovie', title: 'Alice movie', tab: 'movies',
  });
  activateViewerProfile(bob.profile_id);
  saveLibraryItem({
    source: 'mango', type: 'movie', id: 'BobMovie', title: 'Bob movie', tab: 'movies',
  });

  // A refresh accepted for Alice stays Alice-owned even if Bob becomes the
  // active couch profile before the synchronous signal read.
  assert.deepEqual(
    listRecommendationLibrarySignals({ profile_id: alice.profile_id })
      .filter((row) => row.saved)
      .map((row) => row.id),
    ['alicemovie'],
  );
  assert.deepEqual(
    listRecommendationLibrarySignals().filter((row) => row.saved).map((row) => row.id),
    ['bobmovie'],
  );
}));

test('watch signals use positive thresholds without duplicating periodic progress', () => withTempLibrary(() => {
  const profile = createViewerProfile('Progress Viewer');
  activateViewerProfile(profile.profile_id);
  const base = {
    source: 'youtube', type: 'youtube_video', id: 'ExactWatched', title: 'Exact watched', tab: 'youtube' as const,
    duration_sec: 100,
  };
  recordLibraryWatch({ ...base, event: 'play', position_sec: 0, watched_at: 1_000 });
  recordLibraryWatch({ ...base, event: 'progress', position_sec: 10, watched_at: 1_100 });
  recordLibraryWatch({ ...base, event: 'progress', position_sec: 20, watched_at: 1_200 });
  recordLibraryWatch({ ...base, event: 'progress', position_sec: 30, watched_at: 1_300 });
  recordLibraryWatch({ ...base, event: 'stopped', position_sec: 10, watched_at: 1_400 });

  const events = listProfileRecommendationEvents({
    profile_id: profile.profile_id,
    domain: 'youtube',
    limit: 20,
  }).filter((event) => event.item_id === 'ExactWatched');
  assert.deepEqual(events.map((event) => event.strength).sort(), [0.55]);
  assert.equal(events.every((event) => event.strength >= 0), true);
  assert.equal(
    listProfileRecommendationSignals({ profile_id: profile.profile_id, domain: 'youtube' })
      .find((signal) => signal.item_id === 'ExactWatched')?.watched,
    true,
  );
  assert.deepEqual(
    listUniqueWatchHistory({
      profile_id: profile.profile_id,
      source: 'youtube',
      type: 'youtube_video',
    }).map((row) => row.id),
    ['ExactWatched'],
  );

  const other = createViewerProfile('Other Viewer');
  assert.deepEqual(listUniqueWatchHistory({
    profile_id: other.profile_id,
    source: 'youtube',
    type: 'youtube_video',
  }), []);
}));

test('neutral reversals do not rejuvenate stale positive recommendation evidence', () => withTempLibrary(() => {
  const profile = createViewerProfile('Recency Viewer');
  appendProfileRecommendationEvent({
    profile_id: profile.profile_id,
    domain: 'youtube',
    event_type: 'saved',
    item_type: 'youtube_video',
    item_id: 'old-positive',
    strength: 0.8,
    occurred_at: 1_000,
  });
  appendProfileRecommendationEvent({
    profile_id: profile.profile_id,
    domain: 'youtube',
    event_type: 'unsaved',
    item_type: 'youtube_video',
    item_id: 'old-positive',
    strength: 0,
    occurred_at: 9_000,
  });
  const signal = listProfileRecommendationSignals({
    profile_id: profile.profile_id,
    domain: 'youtube',
  }).find((entry) => entry.item_id === 'old-positive');
  assert.equal(signal?.last_positive_at, 1_000);
  assert.equal(signal?.last_event_at, 9_000);

  appendProfileRecommendationEvent({
    profile_id: profile.profile_id,
    domain: 'youtube',
    event_type: 'not_interested',
    item_type: 'youtube_video',
    item_id: 'negative-recency',
    strength: -1,
    occurred_at: 2_000,
  });
  appendProfileRecommendationEvent({
    profile_id: profile.profile_id,
    domain: 'youtube',
    event_type: 'play',
    item_type: 'youtube_video',
    item_id: 'negative-recency',
    strength: 0.05,
    occurred_at: 8_000,
  });
  let negative = listProfileRecommendationSignals({
    profile_id: profile.profile_id,
    domain: 'youtube',
  }).find((entry) => entry.item_id === 'negative-recency');
  assert.equal(negative?.last_not_interested_at, 2_000);
  appendProfileRecommendationEvent({
    profile_id: profile.profile_id,
    domain: 'youtube',
    event_type: 'not_interested_cleared',
    item_type: 'youtube_video',
    item_id: 'negative-recency',
    strength: 0,
    occurred_at: 9_500,
  });
  negative = listProfileRecommendationSignals({
    profile_id: profile.profile_id,
    domain: 'youtube',
  }).find((entry) => entry.item_id === 'negative-recency');
  assert.equal(negative?.not_interested, false);
  assert.equal(negative?.last_not_interested_at, 0);
}));

test('recommendation attribution is profile-scoped, idempotent, and keeps max satisfaction', () => withTempLibrary(() => {
  const alice = createViewerProfile('Attribution Alice');
  const slate = {
    profile_id: alice.profile_id,
    domain: 'vod' as const,
    rail_id: 'for-you-movies',
    slate_revision: 7,
  };
  assert.equal(recordRecommendationImpressions({
    ...slate,
    shown_at: 1_000,
    items: [
      { type: 'movie', id: 'tt-one', rank: 0 },
      { type: 'movie', id: 'tt-two', rank: 1 },
    ],
  }), 2);
  assert.equal(recordRecommendationImpressions({
    ...slate,
    shown_at: 2_000,
    items: [{ type: 'movie', id: 'tt-one', rank: 0 }],
  }), 0);
  const title = { ...slate, item_type: 'movie', item_id: 'tt-one' };
  recordRecommendationDetailOpen({ ...title, occurred_at: 1_100 });
  assert.equal(recordRecommendationPlayStart({ ...title, occurred_at: 1_200 }), true);
  assert.equal(recordRecommendationPlayStart({ ...title, occurred_at: 1_250 }), false);
  recordRecommendationProgress({ ...title, progress_pct: 0.6, occurred_at: 1_300 });
  recordRecommendationProgress({ ...title, progress_pct: 0.2, occurred_at: 1_400 });
  recordRecommendationProgress({ ...title, progress_pct: 0.95, occurred_at: 1_500 });
  assert.deepEqual(listRecommendationAttribution(alice.profile_id), [{
    profile_id: alice.profile_id,
    domain: 'vod',
    rail_id: 'for-you-movies',
    slate_revision: 7,
    item_type: 'movie',
    item_id: 'tt-one',
    detail_opened_at: 1_100,
    play_started_at: 1_200,
    max_progress_pct: 0.95,
    completed_at: 1_500,
    updated_at: 1_500,
  }]);
  const bob = createViewerProfile('Attribution Bob');
  assert.deepEqual(listRecommendationAttribution(bob.profile_id), []);
}));

test('served-slate tokens bind exact membership to an immutable owner and never reuse revisions', () => withTempLibrary(() => {
  const alice = createViewerProfile('Served Alice');
  const bob = createViewerProfile('Served Bob');
  const first = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'vod',
    rail_id: 'for-you-movies',
    source_revision: 11,
    now: 1_000,
    items: [
      { type: 'movie', id: 'tt-one', rank: 0 },
      { type: 'movie', id: 'tt-two', rank: 1 },
    ],
  });
  activateViewerProfile(bob.profile_id);
  assert.equal(resolveRecommendationServedSlate({
    attribution_token: first.attribution_token,
    domain: 'vod',
    rail_id: first.rail_id,
    slate_revision: first.slate_revision,
    items: first.items,
    now: 2_000,
  }).profile_id, alice.profile_id);
  assert.equal(resolveRecommendationServedSlate({
    attribution_token: first.attribution_token,
    domain: 'vod',
    rail_id: first.rail_id,
    slate_revision: first.slate_revision,
    item: { type: 'movie', id: 'tt-two' },
    now: 2_000,
  }).profile_id, alice.profile_id);
  assert.throws(() => resolveRecommendationServedSlate({
    attribution_token: first.attribution_token,
    domain: 'vod',
    rail_id: first.rail_id,
    slate_revision: first.slate_revision,
    items: [{ type: 'movie', id: 'injected', rank: 0 }],
    now: 2_000,
  }), /do not match rendered membership/);
  assert.throws(() => resolveRecommendationServedSlate({
    attribution_token: first.attribution_token,
    domain: 'youtube',
    rail_id: first.rail_id,
    slate_revision: first.slate_revision,
    now: 2_000,
  }), /ownership mismatch/);

  const contextual = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'youtube',
    rail_id: 'because_you_watched',
    source_revision: 27,
    context_id: 'seed-video-a',
    now: 2_000,
    items: [{ type: 'youtube_video', id: 'follow-up-a', rank: 0 }],
  });
  const resolvedContextual = resolveRecommendationServedSlate({
    attribution_token: contextual.attribution_token,
    domain: 'youtube',
    rail_id: contextual.rail_id,
    slate_revision: contextual.slate_revision,
    items: contextual.items,
    now: 3_000,
  });
  assert.equal(resolvedContextual.source_revision, 27);
  assert.equal(resolvedContextual.context_id, 'seed-video-a');
  assert.throws(() => registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'youtube',
    rail_id: 'because_you_watched',
    source_revision: 28,
    items: [{ type: 'youtube_video', id: 'follow-up-b', rank: 0 }],
  }), /requires an attribution context/);

  // The first token expires and is pruned, but its durable revision counter
  // must not reset and collide with historical impression/outcome rows.
  const afterExpiry = registerRecommendationServedSlate({
    profile_id: alice.profile_id,
    domain: 'vod',
    rail_id: 'for-you-movies',
    source_revision: 12,
    now: 40 * 24 * 60 * 60 * 1_000,
    items: [{ type: 'movie', id: 'tt-three', rank: 0 }],
  });
  assert.equal(afterExpiry.slate_revision, first.slate_revision + 1);
  assert.throws(() => resolveRecommendationServedSlate({
    attribution_token: first.attribution_token,
    domain: 'vod',
    rail_id: first.rail_id,
    slate_revision: first.slate_revision,
    now: 40 * 24 * 60 * 60 * 1_000,
  }), /unknown or expired/);
}));

test('served-slate batches preserve per-rail attribution and reject duplicate rails atomically', () => withTempLibrary(() => {
  const household = getPersonalizationState().active_profile_id;
  const served = registerRecommendationServedSlates([
    {
      profile_id: household,
      domain: 'youtube',
      rail_id: 'for_you',
      source_revision: 41,
      now: 1_000,
      items: [{ type: 'youtube_video', id: 'video-one', rank: 0 }],
    },
    {
      profile_id: household,
      domain: 'youtube',
      rail_id: 'more_like',
      source_revision: 41,
      context_id: 'seed-one',
      now: 1_000,
      items: [{ type: 'youtube_video', id: 'video-two', rank: 0 }],
    },
  ]);
  assert.deepEqual(served.map((row) => row.rail_id), ['for_you', 'more_like']);
  for (const row of served) {
    const resolved = resolveRecommendationServedSlate({
      attribution_token: row.attribution_token,
      domain: 'youtube',
      rail_id: row.rail_id,
      slate_revision: row.slate_revision,
      items: row.items,
      now: 2_000,
    });
    assert.equal(resolved.profile_id, household);
    assert.equal(resolved.source_revision, 41);
  }
  const before = libraryDatabase().prepare(
    'SELECT COUNT(*) AS count FROM profile_recommendation_served_slates',
  ).get() as { count: number };
  assert.throws(() => registerRecommendationServedSlates([
    {
      profile_id: household,
      domain: 'youtube',
      rail_id: 'beyond',
      source_revision: 42,
      items: [{ type: 'youtube_video', id: 'video-three', rank: 0 }],
    },
    {
      profile_id: household,
      domain: 'youtube',
      rail_id: 'beyond',
      source_revision: 42,
      items: [{ type: 'youtube_video', id: 'video-four', rank: 0 }],
    },
  ]), /unique rails/);
  const after = libraryDatabase().prepare(
    'SELECT COUNT(*) AS count FROM profile_recommendation_served_slates',
  ).get() as { count: number };
  assert.equal(after.count, before.count);
}));

test('captured playback ownership survives an active-profile switch before progress writes', () => withTempLibrary(() => {
  const alice = createViewerProfile('Playback Alice');
  const bob = createViewerProfile('Playback Bob');
  activateViewerProfile(bob.profile_id);
  recordLibraryWatch({
    profile_id: alice.profile_id,
    source: 'youtube',
    type: 'youtube_video',
    id: 'captured-owner',
    title: 'Captured owner',
    tab: 'youtube',
    position_sec: 95,
    duration_sec: 100,
    watched_at: 5_000,
  });
  assert.equal(listProfileRecommendationEvents({
    profile_id: alice.profile_id,
    domain: 'youtube',
  }).some((event) => event.item_id === 'captured-owner'), true);
  assert.equal(listProfileRecommendationEvents({
    profile_id: bob.profile_id,
    domain: 'youtube',
  }).some((event) => event.item_id === 'captured-owner'), false);
  activateViewerProfile(alice.profile_id);
  assert.equal(listWatchHistory({ source: 'youtube' }).length, 1);
  activateViewerProfile(bob.profile_id);
  assert.equal(listWatchHistory({ source: 'youtube' }).length, 0);
}));

test('a completed VOD title creates no cooled-rewatch recommendation lane', () => withTempLibrary(() => {
  const profile = createViewerProfile('Rewatch Viewer');
  activateViewerProfile(profile.profile_id);
  const day = 24 * 60 * 60 * 1_000;
  const input = {
    source: 'mango', type: 'movie', id: 'tt-rewatch', title: 'Rewatch', tab: 'movies' as const,
    duration_sec: 100,
  };
  recordLibraryWatch({ ...input, event: 'finished', position_sec: 100, watched_at: 1_000 });
  recordLibraryWatch({ ...input, event: 'play', position_sec: 0, watched_at: 1_000 + 6 * day });
  recordLibraryWatch({ ...input, event: 'play', position_sec: 0, watched_at: 1_000 + 8 * day });
  const events = listProfileRecommendationEvents({
    profile_id: profile.profile_id,
    domain: 'vod',
    limit: 10,
  }).filter((event) => event.item_id === 'tt-rewatch');
  assert.deepEqual(events.map((event) => [event.event_type, event.strength]), [
    ['finished', 1],
  ]);
}));
