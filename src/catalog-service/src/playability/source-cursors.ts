import type { ListSource } from './list-source.js';
import {
  ensureRailSourceIngestOffsets,
  setRailSourceIngestOffsetsBulk,
} from './db.js';

export const AI_SEED_CURSOR_KEY = '__seeds__';

export function catalogSourceKey(addon: string, catalog: string): string {
  return `${addon}:${catalog}`;
}

export interface SourceCursorListSource extends ListSource {
  listSourceKeys(): string[];
  readSourceOffsets(): ReadonlyMap<string, number>;
  writeSourceOffsets(offsets: Map<string, number>): void;
  resetAllSourceOffsets(): void;
  /** True when every catalog source has returned a short/empty page (no more pages). */
  areAllSourcesExhausted(): boolean;
}

export function isSourceCursorListSource(source: ListSource): source is SourceCursorListSource {
  return typeof (source as SourceCursorListSource).listSourceKeys === 'function';
}

export async function loadSourceOffsetsForListSource(
  railId: string,
  source: ListSource,
): Promise<Map<string, number> | undefined> {
  if (!isSourceCursorListSource(source)) {
    return undefined;
  }
  const keys = source.listSourceKeys();
  if (keys.length === 0) {
    return undefined;
  }
  return ensureRailSourceIngestOffsets(railId, keys);
}

export async function persistSourceOffsetsForListSource(
  railId: string,
  source: ListSource,
): Promise<void> {
  if (!isSourceCursorListSource(source)) {
    return;
  }
  const offsets = new Map(source.readSourceOffsets());
  await setRailSourceIngestOffsetsBulk(railId, offsets);
}
