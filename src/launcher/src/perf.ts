type PerfFields = Record<string, string | number | boolean | undefined>;

function perfEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return (
      window.location.search.includes("perf=1") ||
      window.localStorage.getItem("mango:perf") === "1"
    );
  } catch {
    return false;
  }
}

export function logPerf(event: string, fields: PerfFields = {}): void {
  if (!perfEnabled()) {
    return;
  }
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
