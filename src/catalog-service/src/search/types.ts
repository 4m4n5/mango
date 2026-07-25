export type SearchScope = 'all' | 'movies' | 'series' | 'live' | 'youtube';
export type SearchPhaseStatus = 'pending' | 'ready' | 'empty' | 'degraded' | 'skipped' | 'failed';

export type SearchResult = {
  key: string;
  source: 'mango' | 'youtube' | 'external';
  type: string;
  id: string;
  title: string;
  subtitle: string;
  poster?: string;
  year?: string;
  description?: string;
  tab: 'movies' | 'series' | 'live' | 'youtube';
  kind?: 'video' | 'channel' | 'playlist';
  live_status?: 'none' | 'live' | 'upcoming' | 'completed';
  in_library: boolean;
  queued_for_verify: boolean;
  score: number;
  match: 'exact' | 'prefix' | 'contains' | 'tokens' | 'related';
};

export type SearchGroup = {
  id: string;
  label: string;
  layout: 'landscape' | 'poster';
  items: SearchResult[];
  total: number;
  status: SearchPhaseStatus;
  message?: string;
};

export type SearchPhase = {
  status: SearchPhaseStatus;
  message?: string;
  duration_ms?: number;
};

export type SearchSnapshot = {
  ok: true;
  search_id: string;
  query: string;
  normalized_query: string;
  scope: SearchScope;
  revision: number;
  complete: boolean;
  groups: SearchGroup[];
  phases: Record<string, SearchPhase>;
  created_at: number;
  updated_at: number;
};
