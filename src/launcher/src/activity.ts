let lastTouchAt = 0;

export function touchCouchActivity(source: string, hint = ""): void {
  const now = Date.now();
  if (now - lastTouchAt < 3000) {
    return;
  }
  lastTouchAt = now;
  void fetch("/api/activity/touch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, hint }),
  }).catch(() => undefined);
}
