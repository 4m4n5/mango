import { appendJournalEvent } from './journal.js';
import { patchProfile, readProfile } from './profile.js';
import { writeCompiledNotes } from './compile-notes.js';

export type LightReflectInput = {
  transcript: string;
  reply?: string;
  tools_used?: string[];
};

const HATE = /\b(?:i\s+)?(?:hate|don'?t\s+like|pasand\s+nahi|nahi\s+pasand)\s+(.+)/i;
const LOVE = /\b(?:i\s+)?(?:love|like|pasand\s+hai|pasand\s+he)\s+(.+)/i;
const FORGET = /\b(?:forget|don'?t\s+remember|yaad\s+mat\s+rakh)\b/i;

function cleanPreference(raw: string): string {
  return raw.trim().replace(/[.!?]+$/, '').slice(0, 120);
}

export function extractPreferencePatches(transcript: string): {
  append_loves?: string[];
  append_avoids?: string[];
} {
  const patch: { append_loves?: string[]; append_avoids?: string[] } = {};
  const hate = HATE.exec(transcript);
  if (hate?.[1]) {
    patch.append_avoids = [cleanPreference(hate[1])];
  }
  const love = LOVE.exec(transcript);
  if (love?.[1]) {
    patch.append_loves = [cleanPreference(love[1])];
  }
  return patch;
}

export async function processLightReflect(input: LightReflectInput): Promise<{ ok: true; skipped?: boolean }> {
  const transcript = input.transcript.trim();
  const tools = input.tools_used ?? [];
  const wordCount = transcript.split(/\s+/).filter(Boolean).length;
  if (wordCount < 3 && tools.length === 0) {
    return { ok: true, skipped: true };
  }

  appendJournalEvent('voice_turn', {
    transcript,
    reply: input.reply?.slice(0, 500) ?? '',
    tools_used: tools,
    word_count: wordCount,
  });

  if (FORGET.test(transcript)) {
    appendJournalEvent('explicit_feedback', { kind: 'forget_request', transcript });
  }

  const current = await readProfile();
  const updated = await patchProfile({
    familiarity: { sessions: current.familiarity.sessions + 1 },
    ...extractPreferencePatches(transcript),
  });
  await writeCompiledNotes(updated);

  return { ok: true };
}

export async function consolidateCompanionNightly(): Promise<{ ok: true; events: number }> {
  const { readProfile } = await import('./profile.js');
  const { listJournalEvents } = await import('./journal.js');
  const profile = await readProfile();
  const events = listJournalEvents(200);
  await writeCompiledNotes(profile);
  appendJournalEvent('nightly_consolidate', { event_count: events.length });
  return { ok: true, events: events.length };
}
