import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ReliabilityProofRecord } from './types.js';

const DEFAULT_RELIABILITY_DIR = '/etc/mango/reliability';
const RETENTION_DAYS = 30;
const MAX_READ_LINES = 500;

export function reliabilityDir(): string {
  return process.env.MANGO_RELIABILITY_DIR || DEFAULT_RELIABILITY_DIR;
}

export function reliabilityProofPath(): string {
  return process.env.MANGO_RELIABILITY_PROOF_PATH || join(reliabilityDir(), 'proofs.jsonl');
}

export function resetReliabilityStoreForTests(): void {
  // Store is file-backed and stateless; tests reset by pointing env to a temp dir.
}

function parseProof(line: string): ReliabilityProofRecord | null {
  try {
    const parsed = JSON.parse(line) as ReliabilityProofRecord;
    if (!parsed || typeof parsed.proof_id !== 'string' || typeof parsed.generated_at !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function listReliabilityProofs(limit = 20): ReliabilityProofRecord[] {
  const path = reliabilityProofPath();
  let lines: string[];
  try {
    lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return lines
    .slice(-MAX_READ_LINES)
    .map(parseProof)
    .filter((proof): proof is ReliabilityProofRecord => proof !== null)
    .sort((left, right) => right.generated_at - left.generated_at)
    .slice(0, Math.max(1, Math.min(100, limit)));
}

export function latestReliabilityProof(): ReliabilityProofRecord | null {
  return listReliabilityProofs(1)[0] ?? null;
}

export function appendReliabilityProof(record: ReliabilityProofRecord): void {
  const path = reliabilityProofPath();
  mkdirSync(dirname(path), { recursive: true });
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const kept = listReliabilityProofs(1000)
    .filter((proof) => proof.generated_at >= cutoff)
    .reverse();
  kept.push(record);
  const tmp = `${path}.tmp`;
  writeFileSync(
    tmp,
    kept.map((proof) => JSON.stringify(proof)).join('\n') + '\n',
    { encoding: 'utf8', mode: 0o600 },
  );
  renameSync(tmp, path);
}
