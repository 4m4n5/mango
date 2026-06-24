export function sourceAdvanceJump(pageSize: number, advancePages: number): number {
  return Math.max(0, pageSize) * Math.max(0, advancePages);
}

export function sourceOffsetsForGrowOutcome(options: {
  targetMet: boolean;
  usedDeepSourceAdvance: boolean;
  preDeepSourceOffsets?: ReadonlyMap<string, number>;
  finalSourceOffsets?: ReadonlyMap<string, number>;
}): Map<string, number> | undefined {
  if (!options.finalSourceOffsets) {
    return undefined;
  }
  if (options.usedDeepSourceAdvance && !options.targetMet && options.preDeepSourceOffsets) {
    return new Map(options.preDeepSourceOffsets);
  }
  return new Map(options.finalSourceOffsets);
}
