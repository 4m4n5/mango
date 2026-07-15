export type AioStreamsUncachedPolicy = {
  excludeUncached?: unknown;
  excludeUncachedMode?: unknown;
  excludeUncachedFromServices?: unknown;
  excludeUncachedFromStreamTypes?: unknown;
};

function normalizedList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.toLowerCase()) : [];
}

/** AIOStreams applies the service and stream-type uncached exclusions with OR semantics. */
export function targetPolicyExcludesUncached(
  policy: AioStreamsUncachedPolicy,
  service: string,
  streamType = 'debrid',
): boolean {
  if (policy.excludeUncached === true) return true;
  return normalizedList(policy.excludeUncachedFromServices).includes(service.toLowerCase())
    || normalizedList(policy.excludeUncachedFromStreamTypes).includes(streamType.toLowerCase());
}

export function validateAioStreamsTargetPolicy(policy: AioStreamsUncachedPolicy): void {
  if (policy.excludeUncached === true) {
    throw new Error('AIOStreams target policy must not exclude every uncached stream');
  }
  if (String(policy.excludeUncachedMode ?? 'or').toLowerCase() !== 'or') {
    throw new Error('AIOStreams target policy requires OR cache-filter semantics');
  }
  if (targetPolicyExcludesUncached(policy, 'torbox')) {
    throw new Error('AIOStreams target policy must retain uncached TorBox');
  }
  if (!targetPolicyExcludesUncached(policy, 'realdebrid')) {
    throw new Error('AIOStreams target policy must exclude uncached Real-Debrid');
  }
}
