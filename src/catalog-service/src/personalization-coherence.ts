export type PersonalizationSnapshot = {
  active_profile_id: string;
  updated_at: number;
};

export type StagedPersonalizationResult<T> = {
  value: T;
  /** Commit request-owned cache writes only after the captured owner is current. */
  commit?: () => void;
  /** Remove writes if the owner changes during the synchronous commit boundary. */
  rollback?: () => void;
};

export class PersonalizationChangedDuringRequestError extends Error {
  constructor() {
    super('personalization changed while building the request');
    this.name = 'PersonalizationChangedDuringRequestError';
  }
}

export function samePersonalizationSnapshot(
  left: PersonalizationSnapshot,
  right: PersonalizationSnapshot,
): boolean {
  return left.active_profile_id === right.active_profile_id
    && left.updated_at === right.updated_at;
}

export function personalizationScopedCacheKey(
  scope: string,
  snapshot: PersonalizationSnapshot,
): string {
  return `${scope}\u0000${snapshot.active_profile_id}\u0000${snapshot.updated_at}`;
}

/**
 * Build against one immutable profile revision. A profile/mood change discards
 * the first result and retries once; a second change fails closed. Staged cache
 * writes are committed only after a matching read-back and are rolled back if
 * the owner changes across that final synchronous commit boundary.
 */
export async function runPersonalizationCoherentRequest<T>(input: {
  readSnapshot: () => PersonalizationSnapshot;
  build: (
    snapshot: PersonalizationSnapshot,
    attempt: number,
  ) => Promise<StagedPersonalizationResult<T>>;
  maxAttempts?: number;
}): Promise<{ value: T; snapshot: PersonalizationSnapshot }> {
  const maxAttempts = Math.max(1, Math.floor(input.maxAttempts ?? 2));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const snapshot = input.readSnapshot();
    const staged = await input.build(snapshot, attempt);
    if (!samePersonalizationSnapshot(snapshot, input.readSnapshot())) {
      continue;
    }
    staged.commit?.();
    if (!samePersonalizationSnapshot(snapshot, input.readSnapshot())) {
      staged.rollback?.();
      continue;
    }
    return { value: staged.value, snapshot };
  }
  throw new PersonalizationChangedDuringRequestError();
}
