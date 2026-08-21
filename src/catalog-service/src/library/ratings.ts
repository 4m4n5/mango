import { createHash } from 'node:crypto';
import { seriesBareId } from '../playability/ids.js';
import { activeViewerProfileId, libraryDatabase } from './db.js';

export type RatingContentType = 'movie' | 'series';
export type RatingOrigin = 'seed' | 'couch';
export type HalfStepRating = 0 | 0.5 | 1 | 1.5 | 2 | 2.5 | 3 | 3.5 | 4 | 4.5 | 5;

export type FireWaterRating = {
  profile_id: string;
  type: RatingContentType;
  id: string;
  title: string;
  year: string | null;
  fire: HalfStepRating;
  water: HalfStepRating;
  revision: number;
  origin: RatingOrigin;
  /** Stable, bounded semantic tags retained from the reviewed seed/enrichment path. */
  taste_tags: string[];
  updated_at: number;
};

export type RatingPromptState = {
  type: RatingContentType;
  id: string;
  eligible: boolean;
  eligible_at: number | null;
  presented_at: number | null;
  disposition: 'dismissed' | 'rated' | 'left_detail' | null;
  resolved_at: number | null;
};

export type SeedManifestItem = {
  status: 'approved' | 'excluded' | 'review';
  type: RatingContentType;
  id?: string;
  title: string;
  year?: string | number | null;
  director?: string | null;
  fire_steps?: number;
  water_steps?: number;
  caption_hash?: string | null;
  taste_tags?: string[];
  match_evidence?: {
    exact_title?: boolean;
    exact_year?: boolean;
    director_match?: boolean;
    candidate_count?: number;
  };
  exclusion_reason?: string;
};

export type SeedManifest = {
  manifest_name: string;
  manifest_version: number;
  source_hash: string;
  generated_at: string;
  items: SeedManifestItem[];
};

type RatingRow = {
  profile_id: string;
  content_type: RatingContentType;
  content_id: string;
  title: string;
  year: string | null;
  fire_steps: number;
  water_steps: number;
  origin: RatingOrigin;
  taste_tags_json: string;
  revision: number;
  event_revision: number | null;
  updated_at: number;
};

function parseTasteTags(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 32);
  } catch {
    return [];
  }
}

export class RatingValidationError extends Error {}
export class RatingRevisionConflictError extends Error {
  constructor(readonly current: FireWaterRating | null) {
    super('rating revision conflict');
  }
}

function nowMs(): number {
  return Date.now();
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashSeedManifest(manifest: SeedManifest): string {
  return createHash('sha256').update(stableJson(manifest)).digest('hex');
}

export function canonicalRatingIdentity(
  type: string,
  id: string,
  options: { rejectEpisode?: boolean } = {},
): { type: RatingContentType; id: string } {
  const normalizedType = type.trim().toLowerCase() === 'film' ? 'movie' : type.trim().toLowerCase();
  if (normalizedType !== 'movie' && normalizedType !== 'series') {
    throw new RatingValidationError('ratings require movie or series type');
  }
  const trimmed = id.trim();
  if (!trimmed) throw new RatingValidationError('ratings require a stable content id');
  if (normalizedType === 'series') {
    const bare = seriesBareId(trimmed) ?? trimmed;
    if (options.rejectEpisode && bare !== trimmed) {
      throw new RatingValidationError('series ratings require the show id, not an episode id');
    }
    return { type: 'series', id: bare.toLowerCase() };
  }
  return { type: 'movie', id: trimmed.toLowerCase() };
}

export function ratingToSteps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 5) {
    throw new RatingValidationError('rating must be a number from 0 to 5');
  }
  const steps = value * 2;
  if (!Number.isInteger(steps)) {
    throw new RatingValidationError('rating must use 0.5 increments');
  }
  return steps;
}

export function stepsToRating(steps: number): HalfStepRating {
  if (!Number.isInteger(steps) || steps < 0 || steps > 10) {
    throw new RatingValidationError('rating steps must be an integer from 0 to 10');
  }
  return (steps / 2) as HalfStepRating;
}

function rowToRating(row: RatingRow): FireWaterRating {
  return {
    profile_id: row.profile_id,
    type: row.content_type,
    id: row.content_id,
    title: row.title,
    year: row.year,
    fire: stepsToRating(row.fire_steps),
    water: stepsToRating(row.water_steps),
    // The event log is the durable identity clock. In addition to preserving a
    // clear tombstone, taking its maximum heals rows written by older builds
    // that could accidentally restart at revision 1 after a clear.
    revision: Math.max(row.revision, row.event_revision ?? 0),
    origin: row.origin,
    taste_tags: parseTasteTags(row.taste_tags_json),
    updated_at: row.updated_at,
  };
}

export function getRating(type: string, id: string, profileId = activeViewerProfileId()): FireWaterRating | null {
  const identity = canonicalRatingIdentity(type, id);
  const row = libraryDatabase().prepare(`
SELECT ratings.profile_id, ratings.content_type, ratings.content_id, ratings.title, ratings.year,
       ratings.fire_steps, ratings.water_steps, ratings.origin, ratings.taste_tags_json,
       ratings.revision,
       (
         SELECT MAX(events.revision)
         FROM profile_content_rating_events AS events
         WHERE events.profile_id = ratings.profile_id
           AND events.content_type = ratings.content_type
           AND events.content_id = ratings.content_id
       ) AS event_revision,
       ratings.updated_at
FROM profile_content_ratings AS ratings
WHERE ratings.profile_id = ? AND ratings.content_type = ? AND ratings.content_id = ?
`).get(profileId, identity.type, identity.id) as RatingRow | undefined;
  return row ? rowToRating(row) : null;
}

export function listRatings(type?: RatingContentType, profileId = activeViewerProfileId()): FireWaterRating[] {
  const rows = libraryDatabase().prepare(`
SELECT ratings.profile_id, ratings.content_type, ratings.content_id, ratings.title, ratings.year,
       ratings.fire_steps, ratings.water_steps, ratings.origin, ratings.taste_tags_json,
       ratings.revision,
       (
         SELECT MAX(events.revision)
         FROM profile_content_rating_events AS events
         WHERE events.profile_id = ratings.profile_id
           AND events.content_type = ratings.content_type
           AND events.content_id = ratings.content_id
       ) AS event_revision,
       ratings.updated_at
FROM profile_content_ratings AS ratings
WHERE ratings.profile_id = @profile_id
  AND (@type IS NULL OR ratings.content_type = @type)
ORDER BY ratings.updated_at DESC, ratings.content_type, ratings.content_id
`).all({ profile_id: profileId, type: type ?? null }) as RatingRow[];
  return rows.map(rowToRating);
}

function latestRatingEventRevision(
  type: RatingContentType,
  id: string,
  profileId: string,
): number {
  const row = libraryDatabase().prepare(`
SELECT MAX(revision) AS revision
FROM profile_content_rating_events
WHERE profile_id = ? AND content_type = ? AND content_id = ?
`).get(profileId, type, id) as { revision: number | null } | undefined;
  return row?.revision ?? 0;
}

export function hasCouchRatingHistory(
  type: RatingContentType,
  id: string,
  profileId = activeViewerProfileId(),
): boolean {
  const row = libraryDatabase().prepare(`
SELECT 1 AS found FROM profile_content_rating_events
WHERE profile_id = ? AND content_type = ? AND content_id = ? AND origin = 'couch'
LIMIT 1
`).get(profileId, type, id) as { found?: number } | undefined;
  return Boolean(row?.found);
}

export function putRating(input: {
  type: string;
  id: string;
  title: string;
  year?: string | number | null;
  fire: unknown;
  water: unknown;
  expected_revision: number;
  origin?: RatingOrigin;
  seed_manifest?: string | null;
  seed_manifest_hash?: string | null;
  caption_hash?: string | null;
  taste_tags?: string[];
  reject_episode?: boolean;
  profile_id?: string;
}): FireWaterRating | null {
  const identity = canonicalRatingIdentity(input.type, input.id, {
    rejectEpisode: input.reject_episode ?? false,
  });
  const title = input.title.trim();
  if (!title) throw new RatingValidationError('rating requires a title');
  if (!Number.isInteger(input.expected_revision) || input.expected_revision < 0) {
    throw new RatingValidationError('expected_revision must be a non-negative integer');
  }
  const fireSteps = ratingToSteps(input.fire);
  const waterSteps = ratingToSteps(input.water);
  const origin = input.origin ?? 'couch';
  const profileId = origin === 'seed' ? 'household' : (input.profile_id ?? activeViewerProfileId());
  const timestamp = nowMs();
  const db = libraryDatabase();

  const write = db.transaction(() => {
    const current = getRating(identity.type, identity.id, profileId);
    if (origin === 'seed' && hasCouchRatingHistory(identity.type, identity.id, profileId)) {
      return current;
    }
    const identityRevision = current?.revision
      ?? latestRatingEventRevision(identity.type, identity.id, profileId);
    if (identityRevision !== input.expected_revision) {
      throw new RatingRevisionConflictError(current);
    }
    const revision = identityRevision + 1;
    db.prepare(`
INSERT INTO profile_content_ratings (
  profile_id, content_type, content_id, title, year, fire_steps, water_steps, origin, revision,
  seed_manifest, seed_manifest_hash, caption_hash, taste_tags_json, created_at, updated_at
) VALUES (
  @profile_id, @content_type, @content_id, @title, @year, @fire_steps, @water_steps, @origin, @revision,
  @seed_manifest, @seed_manifest_hash, @caption_hash, @taste_tags_json, @created_at, @updated_at
)
ON CONFLICT(profile_id, content_type, content_id) DO UPDATE SET
  title = excluded.title,
  year = COALESCE(excluded.year, profile_content_ratings.year),
  fire_steps = excluded.fire_steps,
  water_steps = excluded.water_steps,
  origin = excluded.origin,
  revision = excluded.revision,
  seed_manifest = excluded.seed_manifest,
  seed_manifest_hash = excluded.seed_manifest_hash,
  caption_hash = excluded.caption_hash,
  taste_tags_json = excluded.taste_tags_json,
  updated_at = excluded.updated_at
`).run({
      profile_id: profileId,
      content_type: identity.type,
      content_id: identity.id,
      title,
      year: input.year == null ? null : String(input.year),
      fire_steps: fireSteps,
      water_steps: waterSteps,
      origin,
      revision,
      seed_manifest: input.seed_manifest ?? null,
      seed_manifest_hash: input.seed_manifest_hash ?? null,
      caption_hash: input.caption_hash ?? null,
      // Couch edits must not erase reviewed seed/enrichment semantics. A caller
      // may replace tags explicitly; otherwise preserve the current bounded set.
      taste_tags_json: JSON.stringify((input.taste_tags ?? current?.taste_tags ?? [])
        .map((tag) => tag.trim()).filter(Boolean).slice(0, 32)),
      created_at: timestamp,
      updated_at: timestamp,
    });
    db.prepare(`
INSERT INTO profile_content_rating_events (
  profile_id, content_type, content_id, action, origin, previous_fire_steps, previous_water_steps,
  fire_steps, water_steps, revision, manifest_name, manifest_hash, occurred_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
      profileId,
      identity.type,
      identity.id,
      origin === 'seed' ? 'import' : current ? 'edit' : 'set',
      origin,
      current ? ratingToSteps(current.fire) : null,
      current ? ratingToSteps(current.water) : null,
      fireSteps,
      waterSteps,
      revision,
      input.seed_manifest ?? null,
      input.seed_manifest_hash ?? null,
      timestamp,
    );
    if (origin === 'couch') resolveRatingPrompt(identity.type, identity.id, 'rated', timestamp);
    return getRating(identity.type, identity.id, profileId);
  });
  const rating = write();
  if (!rating && origin !== 'seed') throw new Error('rating missing after write');
  return rating;
}

export function clearRating(input: {
  type: string;
  id: string;
  expected_revision: number;
  profile_id?: string;
}): { cleared: boolean; revision: number } {
  const identity = canonicalRatingIdentity(input.type, input.id, { rejectEpisode: true });
  if (!Number.isInteger(input.expected_revision) || input.expected_revision < 1) {
    throw new RatingValidationError('expected_revision must identify the current rating');
  }
  const db = libraryDatabase();
  const profileId = input.profile_id ?? activeViewerProfileId();
  return db.transaction(() => {
    const current = getRating(identity.type, identity.id, profileId);
    if (!current || current.revision !== input.expected_revision) {
      throw new RatingRevisionConflictError(current);
    }
    const nextRevision = current.revision + 1;
    db.prepare(`
INSERT INTO profile_content_rating_events (
  profile_id, content_type, content_id, action, origin, previous_fire_steps, previous_water_steps,
  fire_steps, water_steps, revision, occurred_at
) VALUES (?, ?, ?, 'clear', 'couch', ?, ?, NULL, NULL, ?, ?)
`).run(
      profileId,
      identity.type,
      identity.id,
      ratingToSteps(current.fire),
      ratingToSteps(current.water),
      nextRevision,
      nowMs(),
    );
    db.prepare('DELETE FROM profile_content_ratings WHERE profile_id = ? AND content_type = ? AND content_id = ?')
      .run(profileId, identity.type, identity.id);
    return { cleared: true, revision: nextRevision };
  })();
}

export function getRatingPromptState(type: string, id: string): RatingPromptState {
  const identity = canonicalRatingIdentity(type, id);
  const profileId = activeViewerProfileId();
  const row = libraryDatabase().prepare(`
SELECT eligible_at, presented_at, disposition, resolved_at
FROM profile_rating_prompt_state WHERE profile_id = ? AND content_type = ? AND content_id = ?
`).get(profileId, identity.type, identity.id) as {
    eligible_at: number | null;
    presented_at: number | null;
    disposition: RatingPromptState['disposition'];
    resolved_at: number | null;
  } | undefined;
  return {
    ...identity,
    eligible: Boolean(row?.eligible_at && !row.resolved_at && !getRating(identity.type, identity.id, profileId)),
    eligible_at: row?.eligible_at ?? null,
    presented_at: row?.presented_at ?? null,
    disposition: row?.disposition ?? null,
    resolved_at: row?.resolved_at ?? null,
  };
}

export function markRatingPromptEligible(type: string, id: string, eligibleAt = nowMs()): RatingPromptState {
  const identity = canonicalRatingIdentity(type, id);
  const profileId = activeViewerProfileId();
  libraryDatabase().prepare(`
INSERT INTO profile_rating_prompt_state(profile_id, content_type, content_id, eligible_at, updated_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(profile_id, content_type, content_id) DO UPDATE SET
  eligible_at = CASE WHEN profile_rating_prompt_state.resolved_at IS NULL THEN COALESCE(profile_rating_prompt_state.eligible_at, excluded.eligible_at) ELSE profile_rating_prompt_state.eligible_at END,
  updated_at = excluded.updated_at
`).run(profileId, identity.type, identity.id, eligibleAt, nowMs());
  return getRatingPromptState(identity.type, identity.id);
}

export function markRatingPromptPresented(type: string, id: string): RatingPromptState {
  const identity = canonicalRatingIdentity(type, id);
  const profileId = activeViewerProfileId();
  libraryDatabase().prepare(`
UPDATE profile_rating_prompt_state
SET presented_at = COALESCE(presented_at, ?), updated_at = ?
WHERE profile_id = ? AND content_type = ? AND content_id = ? AND resolved_at IS NULL
`).run(nowMs(), nowMs(), profileId, identity.type, identity.id);
  return getRatingPromptState(identity.type, identity.id);
}

export function resolveRatingPrompt(
  type: string,
  id: string,
  disposition: 'dismissed' | 'rated' | 'left_detail',
  timestamp = nowMs(),
): RatingPromptState {
  const identity = canonicalRatingIdentity(type, id);
  const profileId = activeViewerProfileId();
  libraryDatabase().prepare(`
INSERT INTO profile_rating_prompt_state(profile_id, content_type, content_id, disposition, resolved_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(profile_id, content_type, content_id) DO UPDATE SET
  disposition = CASE WHEN profile_rating_prompt_state.resolved_at IS NULL THEN excluded.disposition ELSE profile_rating_prompt_state.disposition END,
  resolved_at = COALESCE(profile_rating_prompt_state.resolved_at, excluded.resolved_at),
  updated_at = excluded.updated_at
`).run(profileId, identity.type, identity.id, disposition, timestamp, timestamp);
  return getRatingPromptState(identity.type, identity.id);
}

export function validateSeedManifest(manifest: SeedManifest): { approved: SeedManifestItem[]; excluded: number } {
  if (!manifest.manifest_name?.trim() || !Number.isInteger(manifest.manifest_version) || manifest.manifest_version < 1) {
    throw new RatingValidationError('seed manifest requires a name and positive version');
  }
  if (!/^[a-f0-9]{64}$/i.test(manifest.source_hash || '')) {
    throw new RatingValidationError('seed manifest requires a SHA-256 source hash');
  }
  const unresolved = manifest.items.filter((item) => item.status === 'review');
  if (unresolved.length) {
    throw new RatingValidationError(`seed manifest has ${unresolved.length} unresolved row(s)`);
  }
  const seen = new Map<string, string>();
  const approved: SeedManifestItem[] = [];
  let excluded = 0;
  for (const item of manifest.items) {
    const unsafe = item as SeedManifestItem & Record<string, unknown>;
    if ('caption' in unsafe || 'raw_caption' in unsafe || 'sheet_url' in unsafe || 'url' in unsafe) {
      throw new RatingValidationError(`seed row ${item.title} contains forbidden raw source text or URL`);
    }
    if (item.status === 'excluded') {
      if (!item.exclusion_reason?.trim()) throw new RatingValidationError(`excluded row ${item.title} requires a reason`);
      excluded += 1;
      continue;
    }
    if (!item.id) throw new RatingValidationError(`approved row ${item.title} requires a stable id`);
    const identity = canonicalRatingIdentity(item.type, item.id);
    if (!Number.isInteger(item.fire_steps) || !Number.isInteger(item.water_steps)
      || Number(item.fire_steps) < 0 || Number(item.fire_steps) > 10
      || Number(item.water_steps) < 0 || Number(item.water_steps) > 10) {
      throw new RatingValidationError(`approved row ${item.title} requires integer half-steps from 0 to 10`);
    }
    const evidence = item.match_evidence;
    if (!evidence?.exact_title || !evidence.exact_year || evidence.candidate_count !== 1) {
      throw new RatingValidationError(`approved row ${item.title} lacks unique exact title/year evidence`);
    }
    const key = `${identity.type}:${identity.id}`;
    const values = `${item.fire_steps}:${item.water_steps}`;
    const previous = seen.get(key);
    if (previous && previous !== values) throw new RatingValidationError(`conflicting duplicate rating for ${key}`);
    seen.set(key, values);
    approved.push({ ...item, ...identity });
  }
  return { approved, excluded };
}

export function importSeedManifest(manifest: SeedManifest): {
  manifest_hash: string;
  imported: number;
  skipped_couch: number;
  excluded: number;
  noop: boolean;
} {
  const validated = validateSeedManifest(manifest);
  const manifestHash = hashSeedManifest(manifest);
  const db = libraryDatabase();
  const existing = db.prepare(`
SELECT imported_count, skipped_couch_count FROM rating_seed_imports
WHERE manifest_name = ? AND manifest_hash = ?
`).get(manifest.manifest_name, manifestHash) as {
    imported_count: number;
    skipped_couch_count: number;
  } | undefined;
  if (existing) {
    return {
      manifest_hash: manifestHash,
      imported: existing.imported_count,
      skipped_couch: existing.skipped_couch_count,
      excluded: validated.excluded,
      noop: true,
    };
  }
  let imported = 0;
  let skippedCouch = 0;
  db.transaction(() => {
    for (const item of validated.approved) {
      const identity = canonicalRatingIdentity(item.type, item.id!);
      if (hasCouchRatingHistory(identity.type, identity.id)) {
        skippedCouch += 1;
        continue;
      }
      const current = getRating(identity.type, identity.id);
      putRating({
        ...identity,
        title: item.title,
        year: item.year,
        fire: Number(item.fire_steps) / 2,
        water: Number(item.water_steps) / 2,
        expected_revision: current?.revision ?? 0,
        origin: 'seed',
        seed_manifest: manifest.manifest_name,
        seed_manifest_hash: manifestHash,
        caption_hash: item.caption_hash ?? null,
        taste_tags: item.taste_tags ?? [],
      });
      imported += 1;
    }
    db.prepare(`
INSERT INTO rating_seed_imports(
  manifest_name, manifest_hash, imported_at, imported_count, skipped_couch_count
) VALUES (?, ?, ?, ?, ?)
`).run(manifest.manifest_name, manifestHash, nowMs(), imported, skippedCouch);
  })();
  return {
    manifest_hash: manifestHash,
    imported,
    skipped_couch: skippedCouch,
    excluded: validated.excluded,
    noop: false,
  };
}
