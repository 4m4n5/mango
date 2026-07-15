export type AioStreamsUncachedPolicy = {
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
  return normalizedList(policy.excludeUncachedFromServices).includes(service.toLowerCase())
    || normalizedList(policy.excludeUncachedFromStreamTypes).includes(streamType.toLowerCase());
}

export function validateAioStreamsTargetPolicy(policy: AioStreamsUncachedPolicy): void {
  if (targetPolicyExcludesUncached(policy, 'torbox')) {
    throw new Error('AIOStreams target policy must retain uncached TorBox');
  }
  if (!targetPolicyExcludesUncached(policy, 'realdebrid')) {
    throw new Error('AIOStreams target policy must exclude uncached Real-Debrid');
  }
}
