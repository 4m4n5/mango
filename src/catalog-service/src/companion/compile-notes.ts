import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CompanionProfile } from './types.js';
import { compiledNotesPath } from './paths.js';

export function compileNotesFromProfile(profile: CompanionProfile): string {
  const lines: string[] = ['# Mango librarian notes', ''];
  lines.push(`_Updated: ${profile.updated_at}_`, '');
  if (profile.taste.loves.length) {
    lines.push('## Loves');
    for (const item of profile.taste.loves) lines.push(`- ${item}`);
    lines.push('');
  }
  if (profile.taste.avoids.length) {
    lines.push('## Avoids');
    for (const item of profile.taste.avoids) lines.push(`- ${item}`);
    lines.push('');
  }
  if (profile.taste.title_loves.length) {
    lines.push('## Title favorites');
    for (const ref of profile.taste.title_loves.slice(0, 20)) {
      lines.push(`- ${ref.title || ref.id} (${ref.type}:${ref.id})`);
    }
    lines.push('');
  }
  if (profile.facts.length) {
    lines.push('## Facts');
    for (const fact of profile.facts.slice(-20)) lines.push(`- ${fact}`);
    lines.push('');
  }
  if (profile.session_notes?.length) {
    lines.push('## Recent sessions');
    for (const note of profile.session_notes) lines.push(`- ${note}`);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

export async function readCompiledNotes(): Promise<string> {
  try {
    return await readFile(compiledNotesPath(), 'utf8');
  } catch {
    return '';
  }
}

export async function writeCompiledNotes(profile: CompanionProfile): Promise<string> {
  const markdown = compileNotesFromProfile(profile);
  const filePath = compiledNotesPath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, markdown, 'utf8');
  return markdown;
}

export function compiledNotesExcerpt(markdown: string, maxChars = 1200): string {
  const trimmed = markdown.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars).trim()}…`;
}
