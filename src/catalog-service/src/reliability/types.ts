export type ReliabilityLevel = 'green' | 'yellow' | 'red';

export type ReliabilityActionId = 'repair' | 'proof' | 'stack_restart' | 'refresh';

export type ReliabilityComponent = {
  id: string;
  label: string;
  status: ReliabilityLevel;
  summary: string;
  detail?: string;
};

export type ReliabilityAction = {
  id: ReliabilityActionId;
  label: string;
  enabled: boolean;
  destructive: boolean;
  requires_idle: boolean;
  reason?: string;
};

export type ReliabilityProofRecord = {
  proof_id: string;
  reason: string;
  status: ReliabilityLevel;
  ok: boolean;
  summary: string;
  generated_at: number;
  generated_at_iso: string;
  commit: string;
  idle: boolean;
  metadata: Record<string, unknown>;
  components: ReliabilityComponent[];
};

export type ReliabilityState = {
  ok: boolean;
  status: ReliabilityLevel;
  generated_at: number;
  generated_at_iso: string;
  commit: string;
  summary: string;
  quiet_badge: boolean;
  couch_message: string | null;
  idle: {
    ok: boolean;
    idle: boolean;
    age_sec: number;
    idle_after_sec: number;
    source: string;
    hint: string;
    ts: number;
    path: string;
  };
  components: ReliabilityComponent[];
  actions: ReliabilityAction[];
  last_proof: ReliabilityProofRecord | null;
};

export type ReliabilityFacts = {
  generated_at: number;
  commit: string;
  idle: ReliabilityState['idle'];
  catalog: {
    ok: boolean;
    core: string;
    rails_ready: boolean;
    live_ready: boolean;
    live_stale_fallback: boolean;
    rss_mb?: number | null;
  };
  launcher: {
    ok: boolean;
    browser: boolean;
    openbox: boolean;
    catalog_proxy: boolean;
  };
  controller: {
    ok: boolean;
    fallback: boolean;
    reason: string;
  };
  playability: {
    ok: boolean;
    rail_count: number;
    verified_total: number;
    thin_rails: Array<{ rail_id: string; verified_pool: number }>;
    last_indexer_run_at: number | null;
    error?: string;
  };
  youtube: {
    enabled: boolean;
    configured: boolean;
    videos: number;
    rail_count: number;
    last_success_at: number | null;
    last_error: string | null;
    failed_phases: string[];
  };
  voice: {
    expected: boolean;
    ok: boolean;
  };
  processes: {
    launcher_browsers: number;
    stremio: number;
    kodi: number;
    mpv: number;
    indexer: number;
    orphan_debug: number;
    pad_processes: number;
    remapper_processes: number;
  };
  maintenance: {
    busy: boolean;
    stale_locks: string[];
  };
  last_proof: ReliabilityProofRecord | null;
};
