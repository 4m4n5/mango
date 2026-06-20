import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  const payload = {
    updated_at: new Date().toISOString(),
    notes: trimmed,
  };
  const filePath = notesPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ok: true, updated_at: payload.updated_at, notes: trimmed };
}
