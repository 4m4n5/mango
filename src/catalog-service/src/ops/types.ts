export type OpsEventKind =
  | 'playability_refresh'
  | 'playability_topup'
  | 'playability_maintenance'
  | 'playability_growth'
  | 'companion_consolidate'
  | 'companion_gardener'
  | 'companion_llm'
  | 'ai_catalog_bootstrap'
  | 'ai_catalog_create'
  | 'ai_catalog_migrate'
  | 'ai_catalog_refresh'
  | 'companion_nightly';

export type OpsRailDelta = {
  rail_id: string;
  label?: string;
  verified_before: number;
  verified_after: number;
  verified_added: number;
  pool_before?: number;
  pool_after?: number;
  failed?: number;
  candidates_seen?: number;
  exhausted?: boolean;
};

export type OpsEvent = {
  ts: string;
  kind: OpsEventKind;
  run_id?: string;
  source: string;
  summary: string;
  payload: Record<string, unknown>;
};
