import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readCompiledNotes, writeCompiledNotes } from '../companion/compile-notes.js';
import { appendJournalEvent } from '../companion/journal.js';
import { readProfile } from '../companion/profile.js';
import { compiledNotesPath } from '../companion/paths.js';

export type LibrarianNotes = {
  ok: true;
  updated_at: string;
  notes: string;
};

function notesPath(): string {
  if (process.env.MANGO_VOICE_LIBRARIAN_NOTES) {
    return process.env.MANGO_VOICE_LIBRARIAN_NOTES;
  }
  const cache = process.env.XDG_CACHE_HOME || path.join(process.env.HOME || '/tmp', '.cache', 'mango');
  return path.join(cache, 'voice-librarian-notes.json');
}

export async function readLibrarianNotes(): Promise<LibrarianNotes> {
  const compiled = await readCompiledNotes();
  if (compiled.trim()) {
    const profile = await readProfile();
    return {
      ok: true,
      updated_at: profile.updated_at,
      notes: compiled.trim(),
    };
  }
  try {
    const raw = await readFile(notesPath(), 'utf8');
    const parsed = JSON.parse(raw) as { updated_at?: string; notes?: string };
    return {
      ok: true,
      updated_at: typeof parsed.updated_at === 'string' ? parsed.updated_at : '',
      notes: typeof parsed.notes === 'string' ? parsed.notes : '',
    };
  } catch {
    return { ok: true, updated_at: '', notes: '' };
  }
}

export async function writeLibrarianNotes(notes: string): Promise<LibrarianNotes> {
  const trimmed = notes.trim();
  const profile = await readProfile();
  await writeCompiledNotes({ ...profile, session_notes: trimmed.split('\n').filter(Boolean).slice(-5) });
  appendJournalEvent('librarian_notes_replace', { length: trimmed.length });
  try {
    await writeFile(compiledNotesPath(), `${trimmed}\n`, 'utf8');
  } catch {
    // companion dir may be read-only in dev — still return ok for API contract
  }
  return { ok: true, updated_at: new Date().toISOString(), notes: trimmed };
}
