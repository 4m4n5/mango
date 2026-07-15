export type PlaybackTelemetryValue = string | number | boolean | null | undefined;

const SENSITIVE_FIELD = /(?:url|token|credential|user_?data|secret)/i;

/** Structured playback diagnostics with a deliberately count/identity-only schema. */
export function playbackTelemetryRecord(
  event: string,
  fields: Record<string, PlaybackTelemetryValue>,
  nowMs = Date.now(),
): Record<string, string | number | boolean | null> {
  const record: Record<string, string | number | boolean | null> = {
    component: 'catalog-playback',
    event,
    ts_ms: nowMs,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || SENSITIVE_FIELD.test(key)) continue;
    record[key] = value;
  }
  return record;
}

export function emitPlaybackTelemetry(
  event: string,
  fields: Record<string, PlaybackTelemetryValue>,
): void {
  if (process.env.MANGO_PLAYBACK_TELEMETRY === '0') return;
  console.log(JSON.stringify(playbackTelemetryRecord(event, fields)));
}
