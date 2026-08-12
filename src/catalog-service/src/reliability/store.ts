import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
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
  const lockPath = `${path}.lock`;
  const writer = spawnSync('python3', ['-c', `
import fcntl
import json
import os
import sys
import tempfile

path, lock_path, cutoff = sys.argv[1], sys.argv[2], int(sys.argv[3])
record = json.loads(sys.stdin.read())
lock_fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
try:
    fcntl.flock(lock_fd, fcntl.LOCK_EX)
    kept = []
    try:
        with open(path, encoding="utf-8") as handle:
            for line in handle:
                try:
                    parsed = json.loads(line)
                except Exception:
                    continue
                if int(parsed.get("generated_at", 0)) >= cutoff:
                    kept.append(parsed)
    except FileNotFoundError:
        pass
    kept.append(record)
    directory = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=".proofs-", suffix=".jsonl", dir=directory)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for proof in kept:
                handle.write(json.dumps(proof, separators=(",", ":"), sort_keys=True) + "\\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        dir_fd = os.open(directory, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
finally:
    os.close(lock_fd)
`, path, lockPath, String(cutoff)], {
    encoding: 'utf8',
    input: JSON.stringify(record),
  });
  if (writer.status !== 0) {
    throw new Error(`failed to append reliability proof: ${writer.stderr.trim() || `rc=${writer.status}`}`);
  }
}
