import type { RefreshLevelCategory, RefreshLevelId } from "./types";

export interface RefreshLevel {
  id: RefreshLevelId;
  label: string;
  description: string;
  category: RefreshLevelCategory;
  estimated_sec: number;
  estimated_label: string;
  blocks_couch: boolean;
  llm_hint: string;
  script?: string;
  detach_supported?: boolean;
}

export interface RefreshLevelsResponse {
  ok: boolean;
  levels: RefreshLevel[];
  shuffle?: RefreshLevel | null;
}

export interface RefreshStartResponse {
  ok: boolean;
  level: RefreshLevelId;
  mode: "inline" | "background";
  session_id?: string;
  pid?: number;
  estimated_sec?: number;
  estimated_label?: string;
  blocks_couch?: boolean;
  category?: RefreshLevelCategory;
  llm_hint?: string;
  detach_supported?: boolean;
  error?: string;
}

export async function fetchRefreshLevels(): Promise<RefreshLevel[]> {
  const data = await fetchJson<RefreshLevelsResponse>("/api/catalog/playability/refresh/levels");
  return data.levels;
}

export async function startRefreshLevel(level: RefreshLevelId): Promise<RefreshStartResponse> {
  return fetchJson<RefreshStartResponse>("/api/catalog/playability/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ level }),
  });
}

export async function reshuffleRails(): Promise<void> {
  await fetchJson("/api/catalog/playability/session/reshuffle", { method: "POST" });
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
    const message = typeof (data as { error?: string }).error === "string"
      ? (data as { error: string }).error
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}
