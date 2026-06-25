type PerfFields = Record<string, string | number | boolean | undefined>;

export function logPerf(event: string, fields: PerfFields = {}): void {
  const payload = {
    event,
    ts: Date.now(),
    ...fields,
  };
  void fetch("/api/perf", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => undefined);
}
