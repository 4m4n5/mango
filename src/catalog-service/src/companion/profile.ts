import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  FRIEND_COMPLETED_WATCHES,
  FRIEND_SESSIONS,
  REGULAR_SESSIONS,
  TITLE_LOVES_CAP,
  defaultProfile,
  type CompanionProfile,
  type FamiliarityStage,
  type TitleRef,
} from './types.js';
import { profilePath } from './paths.js';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '');
}

function asTitleRefs(value: unknown): TitleRef[] {
  if (!Array.isArray(value)) return [];
  const refs: TitleRef[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.type !== 'string' || typeof record.id !== 'string') continue;
    refs.push({
      type: record.type.trim(),
      id: record.id.trim(),
      title: typeof record.title === 'string' ? record.title.trim() : undefined,
    });
  }
  return refs;
}

export function normalizeProfile(raw: unknown): CompanionProfile {
  const base = defaultProfile();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return base;
  }
  const record = raw as Record<string, unknown>;
  const familiarity = typeof record.familiarity === 'object' && record.familiarity !== null
    ? record.familiarity as Record<string, unknown>
    : {};
  const identity = typeof record.identity === 'object' && record.identity !== null
    ? record.identity as Record<string, unknown>
    : {};
  const taste = typeof record.taste === 'object' && record.taste !== null
    ? record.taste as Record<string, unknown>
    : {};
  const mood = typeof taste.mood_defaults === 'object' && taste.mood_defaults !== null
    ? taste.mood_defaults as Record<string, unknown>
    : {};
  const behavior = typeof record.behavior === 'object' && record.behavior !== null
    ? record.behavior as Record<string, unknown>
    : {};

  const stage = familiarity.stage;
  const familiarityStage = stage === 'regular' || stage === 'friend' ? stage : 'stranger';

  return {
    version: Number(record.version ?? base.version) || base.version,
    updated_at: typeof record.updated_at === 'string' ? record.updated_at : base.updated_at,
    familiarity: {
      stage: familiarityStage,
      score: Number.isFinite(Number(familiarity.score)) ? Number(familiarity.score) : 0,
      sessions: Number.isFinite(Number(familiarity.sessions)) ? Number(familiarity.sessions) : 0,
      completed_watches: Number.isFinite(Number(familiarity.completed_watches))
        ? Number(familiarity.completed_watches)
        : 0,
    },
    identity: {
      languages: asStringArray(identity.languages).length
        ? asStringArray(identity.languages)
        : base.identity.languages,
      reply_style: typeof identity.reply_style === 'string'
        ? identity.reply_style
        : base.identity.reply_style,
    },
    taste: {
      loves: asStringArray(taste.loves),
      avoids: asStringArray(taste.avoids),
      title_loves: asTitleRefs(taste.title_loves).slice(0, TITLE_LOVES_CAP),
      title_avoids: asTitleRefs(taste.title_avoids),
      mood_defaults: {
        weeknight: typeof mood.weeknight === 'string' ? mood.weeknight : null,
        weekend: typeof mood.weekend === 'string' ? mood.weekend : null,
      },
    },
    facts: asStringArray(record.facts),
    open_questions: asStringArray(record.open_questions),
    behavior: {
      proactive_opt_in: behavior.proactive_opt_in === true,
    },
    session_notes: asStringArray(record.session_notes),
  };
}

export function computeFamiliarityStage(profile: CompanionProfile): FamiliarityStage {
  const { sessions, completed_watches } = profile.familiarity;
  if (sessions >= FRIEND_SESSIONS && completed_watches >= FRIEND_COMPLETED_WATCHES) {
    return 'friend';
  }
  if (sessions >= REGULAR_SESSIONS) {
    return 'regular';
  }
  return 'stranger';
}

export function applyFamiliarityStage(profile: CompanionProfile): CompanionProfile {
  const stage = computeFamiliarityStage(profile);
  const score = Math.min(
    1,
    (profile.familiarity.sessions / FRIEND_SESSIONS) * 0.6
      + (profile.familiarity.completed_watches / FRIEND_COMPLETED_WATCHES) * 0.4,
  );
  return {
    ...profile,
    familiarity: {
      ...profile.familiarity,
      stage,
      score: Math.round(score * 100) / 100,
    },
  };
}

export async function readProfile(): Promise<CompanionProfile> {
  try {
    const raw = await readFile(profilePath(), 'utf8');
    return normalizeProfile(parseYaml(raw));
  } catch {
    return defaultProfile();
  }
}

export async function writeProfile(profile: CompanionProfile): Promise<CompanionProfile> {
  const next: CompanionProfile = {
    ...profile,
    updated_at: new Date().toISOString(),
    taste: {
      ...profile.taste,
      title_loves: profile.taste.title_loves.slice(0, TITLE_LOVES_CAP),
    },
  };
  const filePath = profilePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${stringifyYaml(next)}\n`, 'utf8');
  return next;
}

export type ProfilePatch = Partial<{
  familiarity: Partial<CompanionProfile['familiarity']>;
  identity: Partial<CompanionProfile['identity']>;
  taste: Partial<CompanionProfile['taste']>;
  facts: string[];
  open_questions: string[];
  behavior: Partial<CompanionProfile['behavior']>;
  append_facts: string[];
  append_loves: string[];
  append_avoids: string[];
  append_title_loves: TitleRef[];
  append_session_notes: string[];
}>;

export async function patchProfile(patch: ProfilePatch): Promise<CompanionProfile> {
  const current = await readProfile();
  const tastePatch = patch.taste ?? {};
  const merged: CompanionProfile = {
    ...current,
    familiarity: { ...current.familiarity, ...(patch.familiarity ?? {}) },
    identity: { ...current.identity, ...(patch.identity ?? {}) },
    taste: {
      ...current.taste,
      ...tastePatch,
      loves: tastePatch.loves ?? current.taste.loves,
      avoids: tastePatch.avoids ?? current.taste.avoids,
      title_loves: tastePatch.title_loves ?? current.taste.title_loves,
      title_avoids: tastePatch.title_avoids ?? current.taste.title_avoids,
      mood_defaults: {
        ...current.taste.mood_defaults,
        ...(tastePatch.mood_defaults ?? {}),
      },
    },
    facts: patch.facts ?? current.facts,
    open_questions: patch.open_questions ?? current.open_questions,
    behavior: { ...current.behavior, ...(patch.behavior ?? {}) },
    session_notes: current.session_notes ?? [],
  };

  if (patch.append_facts?.length) {
    merged.facts = [...merged.facts, ...patch.append_facts.map((f) => f.trim()).filter(Boolean)];
  }
  if (patch.append_loves?.length) {
    merged.taste.loves = [...merged.taste.loves, ...patch.append_loves.map((f) => f.trim()).filter(Boolean)];
  }
  if (patch.append_avoids?.length) {
    merged.taste.avoids = [...merged.taste.avoids, ...patch.append_avoids.map((f) => f.trim()).filter(Boolean)];
  }
  if (patch.append_title_loves?.length) {
    const seen = new Set(merged.taste.title_loves.map((t) => `${t.type}:${t.id}`));
    for (const ref of patch.append_title_loves) {
      const key = `${ref.type}:${ref.id}`;
      if (!seen.has(key)) {
        merged.taste.title_loves.push(ref);
        seen.add(key);
      }
    }
    merged.taste.title_loves = merged.taste.title_loves.slice(0, TITLE_LOVES_CAP);
  }
  if (patch.append_session_notes?.length) {
    const notes = [...(merged.session_notes ?? []), ...patch.append_session_notes.map((n) => n.trim()).filter(Boolean)];
    merged.session_notes = notes.slice(-5);
  }

  return writeProfile(merged);
}

export function profileSummary(profile: CompanionProfile): string {
  const lines: string[] = [];
  lines.push(`Familiarity: ${profile.familiarity.stage} (${profile.familiarity.sessions} sessions).`);
  if (profile.taste.loves.length) {
    lines.push(`Loves: ${profile.taste.loves.slice(0, 8).join(', ')}.`);
  }
  if (profile.taste.avoids.length) {
    lines.push(`Avoids: ${profile.taste.avoids.slice(0, 8).join(', ')}.`);
  }
  if (profile.taste.title_loves.length) {
    const titles = profile.taste.title_loves
      .slice(0, 6)
      .map((t) => t.title || t.id)
      .join(', ');
    lines.push(`Title favorites: ${titles}.`);
  }
  if (profile.facts.length) {
    lines.push(`Notes: ${profile.facts.slice(-3).join(' ')}`);
  }
  return lines.join(' ');
}
