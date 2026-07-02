export type ReliabilityLevel = "green" | "yellow" | "red";
export type ReliabilityActionId = "repair" | "proof" | "stack_restart" | "refresh";

export interface ReliabilityComponent {
  id: string;
  label: string;
  status: ReliabilityLevel;
  summary: string;
  detail?: string;
}

export interface ReliabilityAction {
  id: ReliabilityActionId;
  label: string;
  enabled: boolean;
  destructive: boolean;
  requires_idle: boolean;
  reason?: string;
}

export interface ReliabilityProof {
  proof_id: string;
  reason: string;
  status: ReliabilityLevel;
  ok: boolean;
  summary: string;
  generated_at: number;
  generated_at_iso: string;
  commit: string;
  idle: boolean;
}

export interface ReliabilityState {
  ok: boolean;
  status: ReliabilityLevel;
  generated_at: number;
  generated_at_iso: string;
  commit: string;
  summary: string;
  quiet_badge: boolean;
  couch_message: string | null;
  idle: {
    idle: boolean;
    age_sec: number;
    idle_after_sec: number;
    source: string;
    hint: string;
  };
  components: ReliabilityComponent[];
  actions: ReliabilityAction[];
  last_proof: ReliabilityProof | null;
}

export interface ReliabilityActionResult {
  ok: boolean;
  action: string;
  pid?: number;
  message: string;
  error?: string;
}

export async function fetchReliabilityState(): Promise<ReliabilityState> {
  return fetchJson<ReliabilityState>("/api/catalog/reliability/state");
}

export async function runReliabilityAction(action: ReliabilityActionId): Promise<ReliabilityActionResult> {
  if (action === "proof") {
    const data = await fetchJson<{ ok: boolean; proof?: ReliabilityProof; state?: ReliabilityState }>(
      "/api/catalog/reliability/proof/run",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "launcher_settings" }),
      },
    );
    return {
      ok: data.ok,
      action,
      message: data.proof?.summary || data.state?.summary || "proof recorded",
    };
  }
  const path = action === "stack_restart"
      ? "/api/catalog/reliability/stack/restart"
      : action === "refresh"
        ? "/api/catalog/reliability/refresh/run"
        : "/api/catalog/reliability/repair";
  return fetchJson<ReliabilityActionResult>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof (data as { message?: string; error?: string }).message === "string"
      ? (data as { message: string }).message
      : typeof (data as { error?: string }).error === "string"
        ? (data as { error: string }).error
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
