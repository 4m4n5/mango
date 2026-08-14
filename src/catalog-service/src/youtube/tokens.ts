/** Shared YouTube title/tag tokenization and IDF-weighted overlap. */

export const TITLE_TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'this',
  'that',
  'live',
  'official',
  'video',
  'episode',
  'full',
]);

export function youtubeTitleTokens(title: string): Set<string> {
  return new Set(
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => Array.from(token).length >= 2 && !TITLE_TOKEN_STOPWORDS.has(token)),
  );
}

export function tokenOverlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, Math.min(left.size, right.size));
}

export type YoutubeIdfTable = {
  document_count: number;
  df: Map<string, number>;
};

export function buildYoutubeIdfTable(documents: readonly string[]): YoutubeIdfTable {
  const df = new Map<string, number>();
  let documentCount = 0;
  for (const document of documents) {
    const tokens = youtubeTitleTokens(document);
    if (tokens.size === 0) continue;
    documentCount += 1;
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return { document_count: documentCount, df };
}

export function youtubeIdf(token: string, table: YoutubeIdfTable): number {
  const df = table.df.get(token) ?? 0;
  return Math.log((table.document_count + 1) / (df + 1)) + 1;
}

/** Cosine of IDF-weighted token vectors. Falls back to raw overlap when the table is empty. */
export function idfWeightedOverlap(
  left: Set<string>,
  right: Set<string>,
  table: YoutubeIdfTable | null,
): number {
  if (!table || table.document_count < 2) return tokenOverlapScore(left, right);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const token of left) {
    const weight = youtubeIdf(token, table);
    leftNorm += weight * weight;
    if (right.has(token)) dot += weight * weight;
  }
  for (const token of right) {
    const weight = youtubeIdf(token, table);
    rightNorm += weight * weight;
  }
  if (leftNorm <= 0 || rightNorm <= 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}
