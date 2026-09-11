export function sourceAdvanceJump(pageSize: number, advancePages: number): number {
  return Math.max(0, pageSize) * Math.max(0, advancePages);
}

export type SourceCursorOutcome = {
  source_key: string;
  requested: number;
  returned: number;
  exhausted: boolean;
  catalog_errors?: number;
  rate_limited?: number;
};

function emptyExhaustedSourceKeys(
  sourceOutcomes: readonly SourceCursorOutcome[] | undefined,
): Set<string> {
  const keys = new Set<string>();
  for (const outcome of sourceOutcomes ?? []) {
    if (
      outcome.source_key
      && outcome.exhausted
      && outcome.requested > 0
      && outcome.returned === 0
      && (outcome.catalog_errors ?? 0) <= 0
      && (outcome.rate_limited ?? 0) <= 0
    ) {
      keys.add(outcome.source_key);
    }
  }
  return keys;
}

export function sourceOffsetsForGrowOutcome(options: {
  targetMet: boolean;
  usedDeepSourceAdvance: boolean;
  preDeepSourceOffsets?: ReadonlyMap<string, number>;
  finalSourceOffsets?: ReadonlyMap<string, number>;
  exhausted?: boolean;
  candidatesSeen?: number;
  sourceOutcomes?: readonly SourceCursorOutcome[];
}): Map<string, number> | undefined {
  if (!options.finalSourceOffsets) {
    return undefined;
  }

  const emptyExhaustedKeys = emptyExhaustedSourceKeys(options.sourceOutcomes);
  const hasSourceOutcomes = (options.sourceOutcomes?.length ?? 0) > 0;
  if (!options.targetMet && !hasSourceOutcomes && options.exhausted && (options.candidatesSeen ?? 0) === 0) {
    return new Map([...options.finalSourceOffsets.keys()].map((key) => [key, 0]));
  }

  const base = !options.targetMet && options.usedDeepSourceAdvance && options.preDeepSourceOffsets
    ? new Map(options.preDeepSourceOffsets)
    : new Map(options.finalSourceOffsets);
  for (const key of emptyExhaustedKeys) {
    if (base.has(key)) {
      base.set(key, 0);
    }
  }
  if (emptyExhaustedKeys.size > 0) {
    return base;
  }
  if (options.usedDeepSourceAdvance && !options.targetMet && options.preDeepSourceOffsets) {
    return new Map(options.preDeepSourceOffsets);
  }
  return new Map(options.finalSourceOffsets);
}
