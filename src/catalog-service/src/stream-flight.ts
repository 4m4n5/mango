export type StreamFlightOptions = {
  seriesCrossProbeLimit?: number;
  zeroStreamRetryAttempts?: number;
  zeroStreamRetryDelayMs?: number;
  requestClass?: 'user' | 'background';
  deadlineAtMs?: number;
};

export function streamFlightBehaviorKey(options: StreamFlightOptions = {}): string {
  return JSON.stringify({
    seriesCrossProbeLimit: options.seriesCrossProbeLimit ?? 0,
    zeroStreamRetryAttempts: options.zeroStreamRetryAttempts ?? 0,
    zeroStreamRetryDelayMs: options.zeroStreamRetryDelayMs ?? 0,
  });
}

export function streamFlightKey(baseKey: string, options: StreamFlightOptions = {}): string {
  return `${baseKey}|class=${options.requestClass ?? 'background'}|behavior=${streamFlightBehaviorKey(options)}`;
}
