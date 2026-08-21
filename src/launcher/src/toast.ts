/**
 * Couch notice — brief, auto-dismissing feedback that never takes focus.
 * Severity is explicit at the callsite; TV copy must never be classified by
 * matching words in the message.
 */

export type ToastTone = "info" | "success" | "warning" | "error";
export type LauncherStatusKind = "hint" | "progress" | "success" | "warning" | "error";
export type LauncherStatusReporter = (message: string, kind: LauncherStatusKind) => void;

export interface ToastOptions {
  tone?: ToastTone;
  durationMs?: number;
}

export interface ToastPolicy {
  tone: ToastTone;
  durationMs: number;
  role: "status" | "alert";
  live: "polite" | "assertive";
}

const TONE_DURATION_MS: Record<ToastTone, number> = {
  info: 3000,
  success: 3000,
  warning: 4500,
  error: 6000,
};

let dismissTimer: number | undefined;
let toastSequence = 0;

export function toastToneForStatus(kind: LauncherStatusKind): ToastTone | null {
  if (kind === "hint") return null;
  if (kind === "progress") return "info";
  return kind;
}

export function toastPolicy(options: ToastOptions = {}): ToastPolicy {
  const tone = options.tone ?? "info";
  return {
    tone,
    durationMs: options.durationMs ?? TONE_DURATION_MS[tone],
    role: tone === "error" ? "alert" : "status",
    live: tone === "error" ? "assertive" : "polite",
  };
}

export function showToast(message: string, options: ToastOptions = {}): void {
  const el = document.getElementById("toast");
  if (el === null) {
    return;
  }
  const policy = toastPolicy(options);
  const sequence = ++toastSequence;
  el.dataset.tone = policy.tone;
  el.setAttribute("role", policy.role);
  el.setAttribute("aria-live", policy.live);
  el.setAttribute("aria-atomic", "true");
  el.textContent = message;
  el.dataset.visible = "true";
  window.clearTimeout(dismissTimer);
  dismissTimer = window.setTimeout(() => {
    el.dataset.visible = "false";
    window.setTimeout(() => {
      if (toastSequence === sequence) el.textContent = "";
    }, 300);
  }, policy.durationMs);
}
