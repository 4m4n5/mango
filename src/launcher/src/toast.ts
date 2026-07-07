/**
 * Minimal couch toast — brief, auto-dismissing confirmations (e.g. "added to
 * library"). Purely presentational: no focusables, pointer-events:none, so it
 * never blocks D-pad navigation or playback.
 */

const DEFAULT_VISIBLE_MS = 3000;

let dismissTimer: number | undefined;

export function showToast(message: string, durationMs = DEFAULT_VISIBLE_MS): void {
  const el = document.getElementById("toast");
  if (el === null) {
    return;
  }
  el.textContent = message;
  el.dataset.visible = "true";
  el.setAttribute("aria-hidden", "false");
  window.clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => {
    el.dataset.visible = "false";
    el.setAttribute("aria-hidden", "true");
  }, durationMs);
}
