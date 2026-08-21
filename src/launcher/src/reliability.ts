export type ReliabilityLevel = "green" | "yellow" | "red";
export type ReliabilityActionId = "repair" | "controller_repair" | "proof" | "stack_restart" | "refresh";

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

export interface YoutubeTakeoutImportResult {
  ok: boolean;
  import: {
    format: "zip" | "json" | "html";
    imported_history: number;
    replaced_subscriptions: number;
    noop: boolean;
    warnings: string[];
  };
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
        : action === "controller_repair"
          ? "/api/catalog/reliability/controller/repair"
        : "/api/catalog/reliability/repair";
  return fetchJson<ReliabilityActionResult>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export async function importYoutubeTakeout(file: File): Promise<YoutubeTakeoutImportResult> {
  const response = await fetch("/api/catalog/youtube/takeout/import", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/octet-stream",
      "x-mango-filename": file.name,
    },
    body: file,
  });
  const data = await response.json().catch(() => ({})) as Partial<YoutubeTakeoutImportResult> & {
    message?: string;
    error?: string;
  };
  if (!response.ok || !data.ok || !data.import) {
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }
  return data as YoutubeTakeoutImportResult;
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
