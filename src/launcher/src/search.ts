import { FocusGrid } from "./focus";
import { buildCatalogRails, splitFocusRows } from "./home";
import { launcherIcon } from "./icons";
import { railColumns } from "./layout";
import { armDeferredPosterSources } from "./poster";
import type { BrowseTab, ContentCard, ContentRail } from "./types";
import type { LauncherStatusReporter } from "./toast";

export type SearchScope = "all" | "movies" | "series" | "live" | "youtube";

type SearchResult = {
  key: string;
  source: "mango" | "youtube" | "external";
  library_source?: string;
  type: string;
  id: string;
  title: string;
  subtitle: string;
  poster?: string;
  year?: string;
  description?: string;
  tab: BrowseTab;
  kind?: "video" | "channel" | "playlist";
  live_status?: "none" | "live" | "upcoming" | "completed";
  in_library: boolean;
  queued_for_verify: boolean;
};

export type SearchGroup = {
  id: string;
  label: string;
  layout: "landscape" | "poster";
  items: SearchResult[];
  total: number;
  status: string;
  message?: string;
};

type SearchSnapshot = {
  ok: true;
  search_id: string;
  query: string;
  normalized_query: string;
  scope: SearchScope;
  revision: number;
  complete: boolean;
  groups: SearchGroup[];
  phases: Record<string, { status: string; message?: string }>;
  created_at: number;
  updated_at: number;
};

function emptySearchSnapshot(query: string, scope: SearchScope): SearchSnapshot {
  const now = Date.now();
  return {
    ok: true,
    search_id: `local-empty-${now}`,
    query,
    normalized_query: query.trim().toLowerCase(),
    scope,
    revision: 0,
    complete: true,
    groups: [],
    phases: {},
    created_at: now,
    updated_at: now,
  };
}

function omitSearchDescription(item: SearchResult): SearchResult {
  if (item.description === undefined) return item;
  const { description: _omit, ...rest } = item;
  return rest;
}

/** Search shows cards, never prose. Drop synopsis text before persist/parse work. */
export function slimSearchSnapshot(snapshot: SearchSnapshot | null): SearchSnapshot | null {
  if (!snapshot) return null;
  return {
    ...snapshot,
    groups: snapshot.groups.map((group) => ({
      ...group,
      items: group.items.map(omitSearchDescription),
    })),
  };
}

/** Frame, then a macrotask, so pad-nav fetch/ack can run before the next rail. */
export const SEARCH_YIELD_FALLBACK_MS = 50;

function yieldToPadInput(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    let frame = 0;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      if (frame && typeof globalThis.cancelAnimationFrame === "function") {
        globalThis.cancelAnimationFrame(frame);
      }
      // rAF runs before I/O tasks. Resume fill on a timer so Chromium can
      // apply D-pad commands that arrived during the previous rail's sync work.
      globalThis.setTimeout(resolve, 0);
    };
    const timer = globalThis.setTimeout(finish, SEARCH_YIELD_FALLBACK_MS);
    if (typeof globalThis.requestAnimationFrame === "function") {
      frame = globalThis.requestAnimationFrame(() => finish());
    }
  });
}

export function searchEmptyResultsFocusKey(scope: SearchScope): string {
  return `search:scope:${scope}`;
}

/** Rebuild focus rows in visible-group order from a per-rail map. */
export function mergeSearchResultRows<T>(
  visibleGroupIds: readonly string[],
  rowsByRailId: ReadonlyMap<string, T[][]>,
): T[][] {
  const rows: T[][] = [];
  for (const id of visibleGroupIds) {
    const railRows = rowsByRailId.get(id);
    if (!railRows) continue;
    rows.push(...railRows);
  }
  return rows;
}

type SearchStateResponse = {
  recents?: Array<{ normalized_query: string; display_query: string }>;
  starters?: Array<{
    title: string;
    type: string;
    source: string;
    poster?: string;
    tab?: BrowseTab;
  }>;
  preferences?: { youtube_safe_search?: string };
};

export type SearchRestoreState = {
  version: 1;
  savedAt: number;
  query: string;
  scope: SearchScope;
  submitted: boolean;
  snapshot: SearchSnapshot | null;
  pages: Record<string, number>;
  focusedKey?: string;
  position?: { row: number; col: number };
  homeTab?: BrowseTab;
  homeFocusKey?: string;
  homePosition?: { row: number; col: number };
};

type SearchCallbacks = {
  onClose: (state: SearchRestoreState) => void;
  onOpenDetail: (card: ContentCard, label: string, state: SearchRestoreState) => void;
  onStatus: LauncherStatusReporter;
};

const STORAGE_KEY = "mango.search-session.v1";
const STORAGE_NAV_KEY = "mango.search-session.v2.navigation";
const STORAGE_SNAPSHOT_KEY = "mango.search-session.v2.snapshot";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Delay before swapping suggestion preview or results atmosphere artwork. */
export const ARTWORK_DWELL_MS = 180;
/** Trailing window so D-pad can drain before a progressive result paint. */
export const SEARCH_RESULTS_PAINT_MS = 100;

export function isSearchPinnedChromeKey(key: string | undefined): boolean {
  if (!key) return false;
  return key === "search:edit" || key.startsWith("search:scope:");
}

/**
 * Downs pressed while only Edit/scopes exist are geometric no-ops. Keep the
 * net leftover until result rows can honor it, then drop it if the query
 * finished empty (focus stays on the active chip).
 */
export function nextPendingSearchRowDelta(input: {
  submitted: boolean;
  delta: number;
  moved: boolean;
  pending: number;
  resultsComplete: boolean;
  resultRowCount: number;
}): number {
  if (!input.submitted || input.moved) return 0;
  if (input.resultsComplete && input.resultRowCount === 0) return 0;
  if (input.delta <= 0) return input.pending;
  // The intent is "enter results when they exist", not a replay queue. A held
  // D-pad while the first rail is mounting must never jump several rows later.
  return 1;
}

const QUERY_PLACEHOLDER = "search mango";
// A page is whole rows of the result grid, so revealing one never leaves a
// half-filled row behind. Derived from the column count rather than written out,
// because the two were hardcoded independently (9 and 12 fitted the old 9-poster
// and 6-landscape grids exactly, and stopped fitting when those changed).
const PAGE_ROWS_POSTER = 2;
const PAGE_ROWS_LANDSCAPE = 3;
const SCOPES: Array<{ id: SearchScope; label: string }> = [
  { id: "all", label: "all" },
  { id: "movies", label: "movies" },
  { id: "series", label: "tv shows" },
  { id: "live", label: "live" },
  { id: "youtube", label: "youtube" },
];
export type SearchKeyAction = "char" | "space" | "delete" | "clear" | "submit";

export type SearchKeySpec = {
  id: string;
  label: string;
  action: SearchKeyAction;
};

/** Every compose row is this wide so Down/Up stay in the same visual column. */
export const SEARCH_KEYBOARD_COLUMNS = 10;

function letterKey(id: string): SearchKeySpec {
  return { id, label: id.toUpperCase(), action: "char" };
}

/**
 * Rectangular QWERTY: A/Z rows keep 10 cells by placing delete/space/clear/search
 * in the leftover slots instead of centering a short row (which made Down land
 * on the key to the right).
 */
export const SEARCH_KEYBOARD: SearchKeySpec[][] = [
  [..."1234567890"].map((id) => ({ id, label: id, action: "char" as const })),
  [..."qwertyuiop"].map(letterKey),
  [..."asdfghjkl"].map(letterKey).concat({ id: "delete", label: "del", action: "delete" }),
  [
    ...[..."zxcvbnm"].map(letterKey),
    { id: "space", label: "space", action: "space" },
    { id: "clear", label: "clear", action: "clear" },
    { id: "submit", label: "search", action: "submit" },
  ],
];

export function mergeComposeFocusRows<T>(keyboardRows: T[][], starterRows: T[][]): T[][] {
  const rowCount = Math.max(keyboardRows.length, starterRows.length);
  return Array.from({ length: rowCount }, (_, index) => [
    ...(keyboardRows[index] || []),
    ...(starterRows[index] || []),
  ]);
}

export function shouldClearSuggestions(query: string, suggestionCount: number): boolean {
  return query.trim().length < 2 && suggestionCount > 0;
}

/** Empty compose shows a leading caret before the placeholder; typed text keeps a trailing caret. */
export function searchQueryCaretLeading(query: string): boolean {
  return query.length === 0;
}

export function searchQueryDisplayText(query: string): string {
  return query || QUERY_PLACEHOLDER;
}

export function searchGroupPageSize(group: Pick<SearchGroup, "layout">): number {
  const landscape = group.layout === "landscape";
  return railColumns(landscape) * (landscape ? PAGE_ROWS_LANDSCAPE : PAGE_ROWS_POSTER);
}

export function searchGroupPageWindow(
  group: Pick<SearchGroup, "layout" | "items">,
  page: number,
): { items: SearchResult[]; hasMore: boolean; capacity: number } {
  const capacity = (Math.max(0, Math.floor(page)) + 1) * searchGroupPageSize(group);
  const hasMore = group.items.length > capacity;
  const cardLimit = hasMore ? capacity - 1 : capacity;
  return {
    items: group.items.slice(0, cardLimit),
    hasMore,
    capacity,
  };
}

/** A row in the suggestion/recent column, plus what the preview band needs. */
type SearchChoice = {
  label: string;
  query: string;
  meta: string;
  icon: "search" | "clock" | "play";
  poster?: string;
  detail?: string;
  landscape?: boolean;
};

type SearchIconName = "search" | "clock" | "play" | "edit" | "refresh";

function searchIcon(name: SearchIconName): SVGSVGElement {
  const svg = launcherIcon(name);
  svg.classList.add("search-icon");
  return svg;
}

function contentTypeLabel(type: string, source?: string): string {
  if (source === "youtube" || type.includes("youtube")) return "YouTube";
  if (type === "series") return "TV show";
  if (type === "tv") return "Live channel";
  if (type === "movie") return "Movie";
  return "From your library";
}

function isBrowseTab(value: unknown): value is BrowseTab {
  return value === "movies" || value === "series" || value === "live" || value === "youtube";
}

function resultToCard(item: SearchResult, railId: string): ContentCard {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    subtitle: item.subtitle,
    posterUrl: item.poster,
    year: item.year,
    source: item.source,
    librarySource: item.library_source,
    kind: item.kind,
    liveStatus: item.live_status,
    railId,
    inLibrary: item.in_library,
    queuedForVerify: item.queued_for_verify,
  };
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body as T;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function"
    && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function validRestoreState(value: unknown): SearchRestoreState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<SearchRestoreState>;
  if (
    state.version !== 1
    || !Number.isFinite(state.savedAt)
    || Date.now() - Number(state.savedAt) > MAX_AGE_MS
    || typeof state.query !== "string"
    || !SCOPES.some((scope) => scope.id === state.scope)
  ) return null;
  return {
    version: 1,
    savedAt: Number(state.savedAt),
    query: state.query,
    scope: state.scope as SearchScope,
    submitted: Boolean(state.submitted),
    snapshot: state.snapshot && typeof state.snapshot === "object" ? state.snapshot : null,
    pages: state.pages && typeof state.pages === "object" ? state.pages : {},
    focusedKey: typeof state.focusedKey === "string" ? state.focusedKey : undefined,
    position: state.position && Number.isFinite(state.position.row) && Number.isFinite(state.position.col)
      ? state.position
      : undefined,
    homeTab: isBrowseTab(state.homeTab) ? state.homeTab : undefined,
    homeFocusKey: typeof state.homeFocusKey === "string" ? state.homeFocusKey : undefined,
    homePosition: state.homePosition
      && Number.isFinite(state.homePosition.row)
      && Number.isFinite(state.homePosition.col)
      ? state.homePosition
      : undefined,
  };
}

export function readPersistedSearchState(
  storage: Pick<Storage, "getItem"> = localStorage,
): SearchRestoreState | null {
  try {
    const navigation = storage.getItem(STORAGE_NAV_KEY);
    if (navigation) {
      const parsed = JSON.parse(navigation) as Record<string, unknown>;
      const snapshot = JSON.parse(storage.getItem(STORAGE_SNAPSHOT_KEY) || "null");
      return validRestoreState({ ...parsed, snapshot });
    }
    return validRestoreState(JSON.parse(storage.getItem(STORAGE_KEY) || "null"));
  } catch {
    return null;
  }
}

export class SearchController {
  private state: SearchStateResponse = {};
  private query = "";
  private scope: SearchScope = "all";
  private submitted = false;
  private snapshot: SearchSnapshot | null = null;
  private pages: Record<string, number> = {};
  private suggestions: SearchResult[] = [];
  private activeSearchId: string | null = null;
  private pollToken = 0;
  private suggestTimer: number | undefined;
  private persistTimer: number | undefined;
  private persistSnapshotRequested = false;
  private persistedSnapshotIdentity: string | null = null;
  private focusedKey: string | undefined;
  private preferredPosition: { row: number; col: number } | undefined;
  private focusedElement: HTMLElement | null = null;
  private homeTab: BrowseTab = "movies";
  private homeFocusKey: string | undefined;
  private homePosition: { row: number; col: number } | undefined;
  private editRow: HTMLElement[] = [];
  private scopeRow: HTMLElement[] = [];
  private keyboardRows: HTMLElement[][] = [];
  private starterRows: HTMLElement[][] = [];
  private resultRows: HTMLElement[][] = [];
  private preview: HTMLElement | null = null;
  private previewChoice: SearchChoice | undefined;
  private previewTimer: number | undefined;
  private resultsPaint: number | undefined;
  private resultsPaintGeneration = 0;
  private railPaintActive = false;
  private resultsPaintDirty = false;
  private pendingRowDelta = 0;
  private resultRowsByRail = new Map<string, HTMLElement[][]>();
  private atmosphere: HTMLElement | null = null;
  private atmosphereImage: HTMLImageElement | null = null;
  private atmosphereTimer: number | undefined;
  private atmosphereUrl: string | null = null;
  private readonly focus = new FocusGrid((element) => {
    this.focusedElement?.classList.remove("focused");
    element.classList.add("focused");
    this.focusedElement = element;
    this.focusedKey = element.dataset.focusKey;
    this.preferredPosition = this.focus.position;
    this.scheduleResultsAtmosphere(element);
    this.persistSoon();
  });

  constructor(
    private readonly view: HTMLElement,
    private readonly callbacks: SearchCallbacks,
  ) {}

  get isOpen(): boolean {
    return !this.view.classList.contains("hidden");
  }

  async openFresh(
    homeTab: BrowseTab,
    homeFocusKey?: string,
    homePosition?: { row: number; col: number },
  ): Promise<void> {
    this.homeTab = homeTab;
    this.homeFocusKey = homeFocusKey;
    this.homePosition = homePosition;
    this.query = "";
    this.scope = "all";
    this.submitted = false;
    this.snapshot = null;
    this.pages = {};
    this.suggestions = [];
    this.focusedKey = "search:key:q";
    this.preferredPosition = undefined;
    this.pendingRowDelta = 0;
    this.activeSearchId = null;
    this.view.classList.remove("hidden");
    this.render();
    try {
      this.state = await fetchJson<SearchStateResponse>("/api/catalog/search/state");
      this.refreshStarters();
    } catch {
      // Recents and starter metadata are optional. Search itself remains usable.
    }
  }

  restore(input?: unknown): void {
    const state = validRestoreState(input) || this.readPersisted();
    const canReuseMountedDom = Boolean(
      state
      && this.view.childElementCount > 0
      && state.query === this.query
      && state.scope === this.scope
      && state.submitted === this.submitted
      && state.snapshot?.search_id === this.snapshot?.search_id,
    );
    if (state) {
      this.query = state.query;
      this.scope = state.scope;
      this.submitted = state.submitted;
      this.snapshot = slimSearchSnapshot(state.snapshot);
      this.pages = state.pages;
      this.focusedKey = state.focusedKey;
      this.preferredPosition = state.position;
      this.homeTab = state.homeTab || this.homeTab;
      this.homeFocusKey = state.homeFocusKey;
      this.homePosition = state.homePosition;
      this.pendingRowDelta = 0;
    }
    this.view.classList.remove("hidden");
    if (canReuseMountedDom) {
      this.applyFocusRows();
      return;
    }
    this.render();
  }

  restorePersisted(): boolean {
    const state = this.readPersisted();
    if (!state) return false;
    this.restore(state);
    return true;
  }

  hideForDetail(): void {
    this.persist();
    this.view.classList.add("hidden");
  }

  close(): void {
    const state = this.playbackState();
    void this.cancelActive();
    this.pollToken += 1;
    this.abortResultsPaint();
    this.pendingRowDelta = 0;
    this.view.classList.add("hidden");
    this.clearPersisted();
    this.callbacks.onClose(state);
  }

  moveRow(delta: number): void {
    const before = this.focus.position.row;
    this.focus.moveRow(delta);
    this.pendingRowDelta = nextPendingSearchRowDelta({
      submitted: this.submitted,
      delta,
      moved: this.focus.position.row !== before,
      pending: this.pendingRowDelta,
      resultsComplete: Boolean(this.snapshot?.complete),
      resultRowCount: this.resultRows.length,
    });
  }

  moveCol(delta: number): void {
    this.focus.moveCol(delta);
  }

  activate(): void {
    this.focus.focused?.click();
  }

  secondary(kind: "tap" | "hold"): void {
    if (kind === "hold") {
      this.setQuery("");
    } else {
      this.setQuery(this.query.slice(0, -1));
    }
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (event.key === "Escape") {
      this.close();
      return true;
    }
    if (event.key === "Backspace") {
      this.secondary("tap");
      return true;
    }
    if (event.key === "Enter") {
      void this.submit();
      return true;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      this.moveRow(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      this.moveCol(event.key === "ArrowRight" ? 1 : -1);
      return true;
    }
    if (event.key === "F5") {
      this.secondary(event.shiftKey ? "hold" : "tap");
      return true;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      this.setQuery(`${this.query}${event.key}`);
      return true;
    }
    return false;
  }

  playbackState(): SearchRestoreState {
    return {
      version: 1,
      savedAt: Date.now(),
      query: this.query,
      scope: this.scope,
      submitted: this.submitted,
      snapshot: slimSearchSnapshot(this.snapshot),
      pages: { ...this.pages },
      focusedKey: this.focusedKey,
      position: this.preferredPosition,
      homeTab: this.homeTab,
      homeFocusKey: this.homeFocusKey,
      homePosition: this.homePosition,
    };
  }

  private setQuery(value: string): void {
    const wasSubmitted = this.submitted;
    this.query = value.slice(0, 120);
    this.submitted = false;
    this.snapshot = null;
    this.pages = {};
    const clearSuggestions = shouldClearSuggestions(this.query, this.suggestions.length);
    if (clearSuggestions) this.suggestions = [];
    void this.cancelActive();
    if (wasSubmitted) {
      this.render();
    } else {
      this.updateQueryDisplay();
      if (clearSuggestions || this.query.length === 0) {
        this.refreshStarters();
      }
      this.persistSoon();
    }
    this.scheduleSuggestions();
  }

  private scheduleSuggestions(): void {
    if (this.suggestTimer !== undefined) window.clearTimeout(this.suggestTimer);
    const query = this.query.trim();
    if (query.length < 2) {
      this.suggestions = [];
      return;
    }
    this.suggestTimer = window.setTimeout(() => {
      void fetchJson<{ suggestions: SearchResult[] }>(
        `/api/catalog/search/suggestions?q=${encodeURIComponent(query)}&scope=${this.scope}&limit=9`,
      ).then((response) => {
        if (!this.submitted && this.query.trim() === query) {
          const suggestions = response.suggestions || [];
          const unchanged = suggestions.length === this.suggestions.length
            && suggestions.every((item, index) => item.key === this.suggestions[index]?.key);
          this.suggestions = suggestions;
          if (!unchanged) this.refreshStarters();
        }
      }).catch(() => undefined);
    }, 120);
  }

  private async submit(): Promise<void> {
    if (this.query.trim().length < 2) {
      this.callbacks.onStatus("type at least 2 characters", "warning");
      return;
    }
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.persistSnapshotRequested = false;
    try {
      this.persistNavigation({
        ...this.navigationState(),
        submitted: false,
        pages: {},
        focusedKey: "search:key:q",
        position: undefined,
      });
    } catch {
      // A restart can still reopen Search without durable browser storage.
    }
    // Ownership is fenced synchronously inside cancelActive (id/token/paint).
    // Sending the best-effort backend cancellation must not serialize the next
    // explicit Search behind another localhost round trip.
    void this.cancelActive();
    const priorSnapshot = this.submitted ? this.snapshot : null;
    const response = await fetchJson<SearchSnapshot>("/api/catalog/search/query", {
      method: "POST",
      body: JSON.stringify({
        query: this.query,
        scope: this.scope,
      }),
    }).catch(() => null);
    if (!response) {
      // A failed source or backend never becomes a TV error bubble. Preserve usable
      // prior results; on a first-query failure, render the same neutral empty state
      // as a successful zero-result query.
      if (priorSnapshot) {
        this.scope = priorSnapshot.scope;
        this.updateScopeState();
        return;
      }
      this.submitted = true;
      this.snapshot = emptySearchSnapshot(this.query, this.scope);
      this.pages = {};
      this.activeSearchId = null;
      this.focusedKey = searchEmptyResultsFocusKey(this.scope);
      this.render();
      return;
    }
    this.submitted = true;
    this.snapshot = slimSearchSnapshot(response);
    this.pages = {};
    this.activeSearchId = response.search_id;
    this.pendingRowDelta = 0;
    // Rails are not mounted yet. Prefer the active chip so focus cannot clamp
    // onto YouTube from the compose keyboard column, then snap to the first
    // card once it exists and steal a D-pad move.
    this.focusedKey = searchEmptyResultsFocusKey(this.scope);
    this.render();
    void this.poll(response.search_id, response.revision, ++this.pollToken);
  }

  private async poll(searchId: string, revision: number, token: number): Promise<void> {
    let after = revision;
    while (this.activeSearchId === searchId && token === this.pollToken) {
      const snapshot = await fetchJson<SearchSnapshot>(
        `/api/catalog/search/query/${encodeURIComponent(searchId)}?after_revision=${after}&wait_ms=20000`,
      ).catch(() => null);
      if (token !== this.pollToken || this.activeSearchId !== searchId) return;
      if (!snapshot) {
        // A broken progressive poll is an internal transport failure, not a
        // couch-visible endless "Searching" state. Keep any useful groups that
        // already arrived and settle an empty query into the neutral state.
        this.activeSearchId = null;
        this.snapshot = this.snapshot
          ? { ...this.snapshot, complete: true }
          : emptySearchSnapshot(this.query, this.scope);
        this.scheduleResultsRefresh();
        return;
      }
      if (snapshot.revision > after) {
        after = snapshot.revision;
        this.snapshot = slimSearchSnapshot(snapshot);
        this.scheduleResultsRefresh();
      }
      if (snapshot.complete) {
        this.activeSearchId = null;
        this.persistSoon(true);
        return;
      }
    }
  }

  private async cancelActive(): Promise<void> {
    const id = this.activeSearchId;
    this.activeSearchId = null;
    this.pollToken += 1;
    this.abortResultsPaint();
    if (!id) return;
    await fetch(`/api/catalog/search/query/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      cache: "no-store",
    }).catch(() => undefined);
  }

  private render(): void {
    this.abortResultsPaint();
    this.view.replaceChildren();
    this.view.classList.toggle("search--results", this.submitted);
    this.view.classList.toggle("search--compose", !this.submitted);
    this.clearArtworkTimers();

    const atmosphere = document.createElement("div");
    atmosphere.className = "search-atmosphere";
    atmosphere.setAttribute("aria-hidden", "true");
    const atmosphereImage = document.createElement("img");
    atmosphereImage.className = "search-atmosphere-image";
    atmosphereImage.alt = "";
    atmosphereImage.decoding = "async";
    atmosphere.appendChild(atmosphereImage);
    this.atmosphere = atmosphere;
    this.atmosphereImage = atmosphereImage;
    this.atmosphereUrl = null;

    const header = document.createElement("header");
    header.className = "search-head";
    header.setAttribute("aria-label", "Search");

    const queryShell = document.createElement("div");
    queryShell.className = "search-query-shell";
    queryShell.appendChild(searchIcon("search"));
    const query = document.createElement("div");
    query.className = "search-query";
    query.dataset.empty = String(this.query.length === 0);
    this.mountQueryContents(query);
    queryShell.appendChild(query);

    const edit = this.controlButton("edit", "search:edit", () => {
      this.submitted = false;
      this.snapshot = null;
      this.render();
    });
    edit.classList.add("search-edit");
    edit.hidden = !this.submitted;
    edit.prepend(searchIcon("edit"));
    queryShell.appendChild(edit);

    const scopes = document.createElement("nav");
    scopes.className = "search-scopes";
    scopes.setAttribute("aria-label", "Search scope");
    const scopeRow = SCOPES.map(({ id, label }) => {
      const button = this.controlButton(label, `search:scope:${id}`, () => {
        this.scope = id;
        this.updateScopeState();
        if (this.submitted) void this.submit();
        else {
          this.suggestions = [];
          this.scheduleSuggestions();
          this.refreshStarters();
        }
      });
      button.classList.toggle("search-chip--active", id === this.scope);
      button.setAttribute("aria-pressed", String(id === this.scope));
      scopes.appendChild(button);
      return button;
    });
    this.editRow = [edit];
    this.scopeRow = scopeRow;
    header.append(queryShell, scopes);
    this.view.append(atmosphere, header);

    if (!this.submitted) {
      const compose = document.createElement("div");
      compose.className = "search-compose-body";
      // Keyboard and preview share the left column, so the preview occupies the
      // band under the keys rather than becoming a third grid cell (which would
      // land below the suggestion column and fall off the view).
      const main = document.createElement("div");
      main.className = "search-compose-main";
      this.keyboardRows = this.renderKeyboard(main);
      this.renderPreview(main);
      compose.appendChild(main);
      this.starterRows = this.renderStarters(compose);
      this.resultRows = [];
      this.view.appendChild(compose);
      this.applyFocusRows();
    } else {
      this.keyboardRows = [];
      this.starterRows = [];
      this.preview = null;
      this.resultRows = [];
      this.resultRowsByRail.clear();
      const results = document.createElement("div");
      results.className = "search-results rails";
      this.view.appendChild(results);
      this.applyFocusRows();
      void this.fillResultsView(results);
    }
  }

  private mountQueryContents(query: HTMLElement): void {
    query.replaceChildren();
    const empty = this.query.length === 0;
    const caret = !this.submitted ? this.createCaret() : null;
    const text = document.createElement("span");
    text.className = "search-query-text";
    text.textContent = searchQueryDisplayText(this.query);
    if (caret && searchQueryCaretLeading(this.query)) {
      query.append(caret, text);
    } else if (caret) {
      query.append(text, caret);
    } else {
      query.append(text);
    }
    query.dataset.empty = String(empty);
  }

  private createCaret(): HTMLSpanElement {
    const caret = document.createElement("span");
    caret.className = "search-query-caret";
    caret.setAttribute("aria-hidden", "true");
    return caret;
  }

  private renderKeyboard(parent: HTMLElement): HTMLElement[][] {
    const keyboard = document.createElement("section");
    keyboard.className = "search-keyboard";
    keyboard.setAttribute("aria-label", "On-screen keyboard");
    const grid = document.createElement("div");
    grid.className = "search-keyboard-grid";
    const rows: HTMLElement[][] = [];
    for (const keyRow of SEARCH_KEYBOARD) {
      const row = document.createElement("div");
      row.className = "search-key-row";
      row.dataset.keyCount = String(SEARCH_KEYBOARD_COLUMNS);
      const buttons = keyRow.map((spec) => {
        const button = this.controlButton(
          spec.label,
          `search:key:${spec.id}`,
          () => this.activateKey(spec),
        );
        button.classList.add("search-key");
        if (spec.action !== "char") {
          button.classList.add("search-key-action", `search-key-${spec.action}`);
        }
        if (spec.action === "submit") {
          button.classList.add("search-submit");
          button.prepend(searchIcon("search"));
        }
        row.appendChild(button);
        return button;
      });
      grid.appendChild(row);
      rows.push(buttons);
    }
    keyboard.appendChild(grid);
    parent.appendChild(keyboard);
    return rows;
  }

  private activateKey(spec: SearchKeySpec): void {
    if (spec.action === "space") {
      this.setQuery(`${this.query} `);
      return;
    }
    if (spec.action === "delete") {
      this.secondary("tap");
      return;
    }
    if (spec.action === "clear") {
      this.secondary("hold");
      return;
    }
    if (spec.action === "submit") {
      void this.submit();
      return;
    }
    this.setQuery(`${this.query}${spec.id}`);
  }

  private renderStarters(parent: HTMLElement, replace?: HTMLElement): HTMLElement[][] {
    const choices: SearchChoice[] = [];
    if (this.suggestions.length > 0) {
      for (const item of this.suggestions) {
        choices.push({
          label: item.title,
          query: item.title,
          meta: contentTypeLabel(item.type, item.source),
          icon: "search",
          poster: item.poster,
          // Year for a film, channel for a video: whichever the source gave.
          detail: item.subtitle,
          landscape: item.source === "youtube" || item.tab === "live",
        });
      }
    } else if (this.query.length === 0) {
      for (const recent of this.state.recents || []) {
        choices.push({
          label: recent.display_query,
          query: recent.display_query,
          // No meta: under a "recent" heading, next to a clock icon, a row
          // reading "Recent search" repeats itself down the whole column.
          meta: "",
          icon: "clock",
        });
      }
      for (const starter of this.state.starters || []) {
        if (!choices.some((choice) => choice.query.toLowerCase() === starter.title.toLowerCase())) {
          choices.push({
            label: starter.title,
            query: starter.title,
            meta: contentTypeLabel(starter.type, starter.source),
            icon: "play",
            poster: starter.poster,
            landscape: starter.source === "youtube" || starter.tab === "live",
          });
        }
      }
    }
    const section = document.createElement("section");
    section.className = "search-starters search-discovery";
    const panelHead = document.createElement("div");
    panelHead.className = "search-panel-head";
    const heading = document.createElement("h2");
    // Derived from the same condition that builds `choices`, so the heading cannot
    // say "recent" above a column that is actually showing suggestions or the
    // typed-but-nothing-yet message.
    heading.className = "rail-title";
    heading.textContent = this.query.length === 0 && this.suggestions.length === 0
      ? "recent"
      : "suggestions";
    panelHead.appendChild(heading);
    section.appendChild(panelHead);
    const track = document.createElement("div");
    track.className = "search-starter-track";
    // Ten rows is what the column fits at the current row height; it was capped at
    // seven, which ended the column well above the keyboard's baseline.
    const visible = choices.slice(0, 10);
    const rows = visible.map((choice, index) => {
      const button = this.controlButton(choice.label, `search:starter:${index}`, () => {
        this.query = choice.query;
        this.updateQueryDisplay();
        this.persistSoon();
        void this.submit();
      });
      button.classList.add("search-starter");
      // Preview follows the highlighted row after a short dwell so rapid D-pad
      // scrubbing does not strobe artwork. A focus listener keeps pointer and
      // restoration paths correct without coupling to FocusGrid internals.
      button.addEventListener("focus", () => this.schedulePreview(choice));
      button.replaceChildren();
      const iconWrap = document.createElement("span");
      iconWrap.className = "search-starter-icon";
      iconWrap.appendChild(searchIcon(choice.icon));
      const copy = document.createElement("span");
      copy.className = "search-starter-copy";
      const label = document.createElement("span");
      label.className = "search-starter-title";
      label.textContent = choice.label;
      copy.append(label);
      if (choice.meta) {
        const meta = document.createElement("span");
        meta.className = "search-starter-meta";
        meta.textContent = choice.meta;
        copy.append(meta);
      }
      button.append(iconWrap, copy);
      track.appendChild(button);
      return [button];
    });
    if (choices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-starter-empty";
      empty.appendChild(searchIcon("search"));
      const emptyCopy = document.createElement("p");
      emptyCopy.textContent =
        this.query.length > 0 ? "no local suggestions yet." : "type to see suggestions.";
      empty.appendChild(emptyCopy);
      track.appendChild(empty);
    }
    section.appendChild(track);
    if (replace) replace.replaceWith(section);
    else parent.appendChild(section);
    // The top row, not the first row that happens to have art: the preview has no
    // label, so it only makes sense as "the thing highlighted in the column".
    this.schedulePreview(visible[0], true);
    return rows;
  }

  /**
   * The band under the keyboard, showing artwork for whichever suggestion is
   * highlighted. Deliberately not focusable and not a card rail: a rail here
   * would repeat the column beside it item for item, and suggestions mix 2:3
   * posters with 16:9 video thumbnails, which no single-aspect row renders
   * honestly. One preview at the item's own aspect sidesteps both. Recents
   * without art keep a typographic stage so the band never collapses.
   */
  private renderPreview(parent: HTMLElement): void {
    const preview = document.createElement("aside");
    preview.className = "search-preview";
    preview.setAttribute("aria-hidden", "true");
    const frame = document.createElement("div");
    frame.className = "search-preview-frame";
    const image = document.createElement("img");
    image.className = "search-preview-image";
    image.alt = "";
    image.decoding = "async";
    frame.appendChild(image);
    const fallback = document.createElement("div");
    fallback.className = "search-preview-fallback";
    fallback.hidden = true;
    const fallbackMark = document.createElement("span");
    fallbackMark.className = "search-preview-fallback-mark";
    fallbackMark.setAttribute("aria-hidden", "true");
    fallbackMark.textContent = "·";
    fallback.appendChild(fallbackMark);
    frame.appendChild(fallback);
    const copy = document.createElement("div");
    copy.className = "search-preview-copy";
    const title = document.createElement("p");
    title.className = "search-preview-title";
    const meta = document.createElement("p");
    meta.className = "search-preview-meta";
    copy.append(title, meta);
    preview.append(frame, copy);
    parent.appendChild(preview);
    this.preview = preview;
    this.applyPreview(this.previewChoice);
  }

  private schedulePreview(choice: SearchChoice | undefined, immediate = false): void {
    if (this.previewTimer !== undefined) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = undefined;
    }
    if (immediate || prefersReducedMotion()) {
      this.applyPreview(choice);
      return;
    }
    this.previewTimer = window.setTimeout(() => {
      this.previewTimer = undefined;
      this.applyPreview(choice);
    }, ARTWORK_DWELL_MS);
  }

  private applyPreview(choice: SearchChoice | undefined): void {
    this.previewChoice = choice;
    const preview = this.preview;
    if (!preview) return;
    const image = preview.querySelector<HTMLImageElement>(".search-preview-image");
    const fallback = preview.querySelector<HTMLElement>(".search-preview-fallback");
    const title = preview.querySelector<HTMLElement>(".search-preview-title");
    const meta = preview.querySelector<HTMLElement>(".search-preview-meta");
    if (!image || !fallback || !title || !meta) return;
    preview.hidden = false;
    preview.classList.toggle("search-preview--landscape", Boolean(choice?.landscape));
    preview.classList.toggle("search-preview--text", Boolean(choice && !choice.poster));
    title.textContent = choice?.label || "";
    meta.textContent = choice
      ? [choice.meta, choice.detail].filter(Boolean).join(" · ") || "recent search"
      : "";
    if (!choice) {
      image.removeAttribute("src");
      image.classList.remove("search-preview-image--ready");
      fallback.hidden = true;
      return;
    }
    if (!choice.poster) {
      image.removeAttribute("src");
      image.classList.remove("search-preview-image--ready");
      fallback.hidden = false;
      return;
    }
    fallback.hidden = true;
    if (image.getAttribute("src") === choice.poster) {
      image.classList.add("search-preview-image--ready");
      return;
    }
    image.classList.remove("search-preview-image--ready");
    const next = new Image();
    next.decoding = "async";
    next.onload = () => {
      if (this.previewChoice?.poster !== choice.poster) return;
      image.src = choice.poster!;
      image.classList.add("search-preview-image--ready");
    };
    next.onerror = () => {
      if (this.previewChoice?.poster !== choice.poster) return;
      image.removeAttribute("src");
      image.classList.remove("search-preview-image--ready");
      fallback.hidden = false;
      preview.classList.add("search-preview--text");
    };
    next.src = choice.poster;
  }

  /**
   * Reconcile progressive Search groups by rail ID.
   *
   * The API returns a full snapshot on each revision, but replacing the complete
   * result subtree forced Chromium to decode the same posters again and detached
   * the focused element on every provider response. Only a changed rail is rebuilt
   * now; stable rails, images, focus nodes and scroll state stay mounted. Newly
   * built rails yield to pad input so the first cards can move before later
   * groups monopolize the main thread.
   */
  private async fillResultsView(results: HTMLElement): Promise<void> {
    const generation = this.resultsPaintGeneration;
    this.railPaintActive = true;
    const groups = this.snapshot?.groups || [];
    const windows = new Map(groups.map((group) => [
      group.id,
      searchGroupPageWindow(group, this.pages[group.id] || 0),
    ]));
    const visibleGroups = groups.filter((group) => group.items.length > 0);
    const hasResults = visibleGroups.length > 0;

    for (const chrome of Array.from(
      results.querySelectorAll<HTMLElement>(":scope > .search-results-toolbar, :scope > .search-message"),
    )) {
      chrome.remove();
    }

    let chrome: HTMLElement | null = null;
    if (!this.snapshot?.complete && !hasResults) {
      const toolbar = document.createElement("div");
      toolbar.className = "search-results-toolbar";
      const progress = document.createElement("div");
      progress.className = "search-results-state";
      const progressMark = document.createElement("span");
      progressMark.className = "search-results-state-mark";
      progressMark.setAttribute("aria-hidden", "true");
      const progressCopy = document.createElement("span");
      progressCopy.textContent = "Searching";
      progress.append(progressMark, progressCopy);
      toolbar.appendChild(progress);
      chrome = toolbar;
    } else if (!hasResults) {
      const message = document.createElement("div");
      message.className = "search-message";
      message.appendChild(searchIcon("search"));
      const messageCopy = document.createElement("div");
      const messageTitle = document.createElement("h2");
      messageTitle.textContent = "No results";
      const messageBody = document.createElement("p");
      messageBody.textContent = this.query.trim()
        ? `No results for “${this.query.trim()}”. Try another title, channel or topic.`
        : "Try another title, channel or topic.";
      messageCopy.append(messageTitle, messageBody);
      message.appendChild(messageCopy);
      chrome = message;
    }
    if (chrome) results.prepend(chrome);

    const existingRails = new Map(
      Array.from(results.querySelectorAll<HTMLElement>(":scope > .rail"))
        .map((section) => [section.dataset.railId || "", section]),
    );
    const retained = new Set<HTMLElement>();
    let cursor: ChildNode | null = chrome ? chrome.nextSibling : results.firstChild;

    try {
      for (const group of visibleGroups) {
        if (generation !== this.resultsPaintGeneration) return;
        const window = windows.get(group.id);
        if (!window) continue;
        const signature = JSON.stringify([
          group.label,
          group.layout,
          window.hasMore,
          window.items.map((item) => item.key),
        ]);
        let section = existingRails.get(group.id);
        let built = false;
        if (!section || section.dataset.searchSignature !== signature) {
          // Pad polling and rail construction share Chromium's main thread.
          // Drain one input turn before each synchronous DOM burst: scope moves
          // apply immediately, while Down remains one pending enter-results intent.
          await yieldToPadInput();
          if (generation !== this.resultsPaintGeneration) return;
          const staging = document.createElement("div");
          const rail: ContentRail = {
            id: group.id,
            label: group.label,
            layout: group.layout,
            cards: window.items.map((item) => resultToCard(item, `search:${group.id}`)),
          };
          buildCatalogRails(staging, {
            onContentSelect: (card, railLabel) => this.openResult(card, railLabel),
            onAppSelect: () => undefined,
          }, {
            railRowLimit: null,
            deferPosterSrc: true,
            railTrailingAction: (_rail, landscape) => window.hasMore
              ? this.createMoreCard(group, landscape, window.items.length)
              : null,
          }, { status: "ready", rails: [rail], freshness: "fresh" });
          const replacement = staging.querySelector<HTMLElement>(":scope > .rail");
          if (!replacement) continue;
          replacement.dataset.searchSignature = signature;
          section = replacement;
          built = true;
        }
        if (!section) continue;
        retained.add(section);
        if (section !== cursor) {
          results.insertBefore(section, cursor);
        }
        cursor = section.nextSibling;
        if (built) {
          this.resultRowsByRail.set(
            group.id,
            this.collectRowsForRailSection(section, group.layout),
          );
          this.resultRows = mergeSearchResultRows(
            visibleGroups.map((visible) => visible.id),
            this.resultRowsByRail,
          );
          this.applyFocusRows();
          // Mount the first useful row in the same task as the submitted view.
          // Yield only after it is navigable; otherwise the active scope chip
          // paints alone and Down appears frozen while results already exist.
          await yieldToPadInput();
          armDeferredPosterSources(section, results);
        }
      }

      if (generation !== this.resultsPaintGeneration) return;
      for (const section of existingRails.values()) {
        if (!retained.has(section)) section.remove();
      }
      const visibleIds = new Set(visibleGroups.map((group) => group.id));
      for (const railId of [...this.resultRowsByRail.keys()]) {
        if (!visibleIds.has(railId)) this.resultRowsByRail.delete(railId);
      }
      this.resultRows = this.collectResultRows(results, visibleGroups);
      this.applyFocusRows();
    } finally {
      if (generation === this.resultsPaintGeneration) {
        this.railPaintActive = false;
        if (this.resultsPaintDirty) {
          this.resultsPaintDirty = false;
          void this.fillResultsView(results);
          return;
        }
        if (this.focusedElement && !isSearchPinnedChromeKey(this.focusedKey)) {
          this.scheduleResultsAtmosphere(this.focusedElement);
        }
      }
    }
  }

  private collectRowsForRailSection(
    section: HTMLElement,
    layout: SearchGroup["layout"],
  ): HTMLElement[][] {
    const items = Array.from(
      section.querySelectorAll<HTMLElement>(":scope > .rail-track > [data-focus-key]"),
    );
    return splitFocusRows(items, railColumns(layout === "landscape"));
  }

  private collectResultRows(
    results: HTMLElement,
    visibleGroups: SearchGroup[],
  ): HTMLElement[][] {
    const rowsByRailId = new Map<string, HTMLElement[][]>();
    const sections = Array.from(results.querySelectorAll<HTMLElement>(":scope > .rail"));
    for (const group of visibleGroups) {
      const section = sections.find((candidate) => candidate.dataset.railId === group.id);
      if (!section) continue;
      const rows = this.collectRowsForRailSection(section, group.layout);
      rowsByRailId.set(group.id, rows);
    }
    this.resultRowsByRail = rowsByRailId;
    return mergeSearchResultRows(visibleGroups.map((group) => group.id), rowsByRailId);
  }

  private createMoreCard(group: SearchGroup, landscape: boolean, shownCount: number): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card card--poster ${landscape ? "card--landscape" : "card--portrait"} search-more-card`;
    button.dataset.focusKey = `search:more:${group.id}`;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `More ${group.label}`);

    const glyph = document.createElement("span");
    glyph.className = "search-more-glyph";
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = "→";

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = "More";
    const subtitle = document.createElement("span");
    subtitle.className = "card-subtitle";
    subtitle.textContent = group.label;
    const content = document.createElement("span");
    content.className = "poster-content";
    content.append(title, subtitle);

    if (landscape) {
      const frame = document.createElement("span");
      frame.className = "poster-frame search-more-frame";
      frame.appendChild(glyph);
      button.append(frame, content);
    } else {
      button.append(glyph, content);
    }

    button.addEventListener("click", () => {
      const firstNew = group.items[shownCount];
      this.pages[group.id] = (this.pages[group.id] || 0) + 1;
      this.focusedKey = firstNew
        ? `rail:${group.id}:${firstNew.type}:${firstNew.id}`
        : `search:more:${group.id}`;
      this.refreshResults();
    });
    return button;
  }

  private updateQueryDisplay(): void {
    const query = this.view.querySelector<HTMLElement>(".search-query");
    if (!query) return;
    this.mountQueryContents(query);
  }

  private updateScopeState(): void {
    for (const { id } of SCOPES) {
      const button = this.view.querySelector<HTMLElement>(`[data-focus-key="search:scope:${id}"]`);
      if (!button) continue;
      button.classList.toggle("search-chip--active", id === this.scope);
      button.setAttribute("aria-pressed", String(id === this.scope));
    }
    this.persistSoon();
  }

  private refreshStarters(): void {
    if (this.submitted) return;
    const compose = this.view.querySelector<HTMLElement>(".search-compose-body");
    const current = compose?.querySelector<HTMLElement>(".search-discovery");
    if (!compose || !current) return;
    this.starterRows = this.renderStarters(compose, current);
    this.applyFocusRows();
  }

  private abortResultsPaint(): void {
    if (this.resultsPaint !== undefined) {
      window.clearTimeout(this.resultsPaint);
      this.resultsPaint = undefined;
    }
    this.resultsPaintGeneration += 1;
    this.railPaintActive = false;
    this.resultsPaintDirty = false;
  }

  private scheduleResultsRefresh(): void {
    if (!this.submitted) return;
    if (this.railPaintActive) {
      this.resultsPaintDirty = true;
      return;
    }
    if (this.resultsPaint !== undefined) {
      window.clearTimeout(this.resultsPaint);
      this.resultsPaint = undefined;
    }
    // Trailing timeout, not rAF: pad input also waits on animation frames, so
    // a leading-edge paint stole the turn that should have moved focus to the
    // pinned scopes. First cards still appear on a 0-delay macrotask; later
    // revisions wait out SEARCH_RESULTS_PAINT_MS so D-pad can drain. Each new
    // rail then yields again so later groups cannot pin the main thread.
    const hasRails = Boolean(this.view.querySelector(".search-results .rail"));
    const delay = hasRails ? SEARCH_RESULTS_PAINT_MS : 0;
    this.resultsPaint = window.setTimeout(() => {
      this.resultsPaint = undefined;
      this.refreshResults();
    }, delay);
  }

  private refreshResults(): void {
    if (!this.submitted) return;
    const current = this.view.querySelector<HTMLElement>(".search-results");
    if (!current) return;
    this.abortResultsPaint();
    void this.fillResultsView(current);
  }

  private applyFocusRows(): void {
    const rows = this.submitted
      ? [this.editRow, this.scopeRow, ...this.resultRows]
      : [this.scopeRow, ...mergeComposeFocusRows(this.keyboardRows, this.starterRows)];
    this.focus.setRows(rows, {
      preferredKey: this.focusedKey,
      fallbackPosition: this.preferredPosition,
    });
    if (this.pendingRowDelta !== 0 && this.resultRows.length > 0) {
      const before = this.focus.position.row;
      this.focus.moveRow(this.pendingRowDelta);
      if (this.focus.position.row !== before) this.pendingRowDelta = 0;
    } else if (this.snapshot?.complete && this.resultRows.length === 0) {
      this.pendingRowDelta = 0;
    }
    if (this.submitted && this.focusedElement && !isSearchPinnedChromeKey(this.focusedKey)) {
      this.scheduleResultsAtmosphere(this.focusedElement);
    }
  }

  private scheduleResultsAtmosphere(element: HTMLElement): void {
    if (!this.submitted || !this.atmosphere || !this.atmosphereImage) return;
    if (this.railPaintActive) return;
    if (this.atmosphereTimer !== undefined) {
      window.clearTimeout(this.atmosphereTimer);
      this.atmosphereTimer = undefined;
    }
    const key = element.dataset.focusKey || "";
    const isResultCard = key.startsWith("rail:");
    if (!isResultCard) {
      this.clearResultsAtmosphere();
      return;
    }
    const image = element.querySelector<HTMLImageElement>(".poster-image");
    const url = image?.currentSrc || image?.src || "";
    if (!url) {
      this.clearResultsAtmosphere();
      return;
    }
    if (this.atmosphereUrl === url && this.atmosphere.classList.contains("search-atmosphere--ready")) {
      return;
    }
    if (prefersReducedMotion()) {
      this.applyResultsAtmosphere(url);
      return;
    }
    this.atmosphereTimer = window.setTimeout(() => {
      this.atmosphereTimer = undefined;
      this.applyResultsAtmosphere(url);
    }, ARTWORK_DWELL_MS);
  }

  private applyResultsAtmosphere(url: string): void {
    if (!this.atmosphere || !this.atmosphereImage) return;
    if (this.atmosphereUrl === url) {
      this.atmosphere.classList.add("search-atmosphere--ready");
      return;
    }
    this.atmosphere.classList.remove("search-atmosphere--ready");
    const next = new Image();
    next.decoding = "async";
    next.onload = () => {
      if (!this.atmosphere || !this.atmosphereImage) return;
      this.atmosphereImage.src = url;
      this.atmosphereUrl = url;
      this.atmosphere.classList.add("search-atmosphere--ready");
    };
    next.onerror = () => this.clearResultsAtmosphere();
    next.src = url;
  }

  private clearResultsAtmosphere(): void {
    if (this.atmosphereTimer !== undefined) {
      window.clearTimeout(this.atmosphereTimer);
      this.atmosphereTimer = undefined;
    }
    this.atmosphereUrl = null;
    this.atmosphere?.classList.remove("search-atmosphere--ready");
    this.atmosphereImage?.removeAttribute("src");
  }

  private clearArtworkTimers(): void {
    if (this.previewTimer !== undefined) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = undefined;
    }
    this.clearResultsAtmosphere();
  }

  private openResult(card: ContentCard, label: string): void {
    const snapshot = this.playbackState();
    this.persist(snapshot);
    const item = this.snapshot?.groups.flatMap((group) => group.items)
      .find((candidate) => candidate.type === card.type && candidate.id === card.id);
    if (item && this.snapshot) {
      void fetch("/api/catalog/search/selection", {
        method: "POST",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          normalized_query: this.snapshot.normalized_query,
          key: item.key,
          source: item.source,
          type: item.type,
          id: item.id,
          title: item.title,
        }),
      }).catch(() => undefined);
    }
    this.hideForDetail();
    this.callbacks.onOpenDetail(card, label, snapshot);
  }

  private controlButton(label: string, key: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-control";
    button.textContent = label;
    button.dataset.focusKey = key;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  }

  private navigationState(restartSafeDuringSearch = false): Omit<SearchRestoreState, "snapshot"> {
    const state: Omit<SearchRestoreState, "snapshot"> = {
      version: 1,
      savedAt: Date.now(),
      query: this.query,
      scope: this.scope,
      submitted: this.submitted,
      pages: { ...this.pages },
      focusedKey: this.focusedKey,
      position: this.preferredPosition,
      homeTab: this.homeTab,
      homeFocusKey: this.homeFocusKey,
      homePosition: this.homePosition,
    };
    if (restartSafeDuringSearch && this.activeSearchId) {
      state.submitted = false;
      state.pages = {};
      state.focusedKey = "search:key:q";
      state.position = undefined;
    }
    return state;
  }

  private persistNavigation(state: Omit<SearchRestoreState, "snapshot">): void {
    localStorage.setItem(STORAGE_NAV_KEY, JSON.stringify(state));
  }

  private persistSnapshot(snapshot: SearchSnapshot | null): void {
    const identity = snapshot ? `${snapshot.search_id}:${snapshot.revision}` : "none";
    if (identity === this.persistedSnapshotIdentity) return;
    localStorage.setItem(STORAGE_SNAPSHOT_KEY, JSON.stringify(snapshot));
    this.persistedSnapshotIdentity = identity;
  }

  private persist(state = this.playbackState()): void {
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.persistSnapshotRequested = false;
    try {
      const { snapshot, ...navigation } = state;
      this.persistNavigation(navigation);
      this.persistSnapshot(snapshot);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Search remains functional when browser storage is unavailable.
    }
  }

  /**
   * Persist settled Search state, never every D-pad step synchronously.
   *
   * localStorage blocks the browser main thread. A full progressive snapshot can
   * be large, so serializing it inside the focus callback made rapid Search
   * navigation hitch. Detail entry and surface exit still call persist() directly;
   * ordinary focus/query movement is coalesced into one write after it settles.
   */
  private persistSoon(includeSnapshot = false): void {
    this.persistSnapshotRequested = this.persistSnapshotRequested || includeSnapshot;
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
    }
    this.persistTimer = window.setTimeout(() => {
      this.persistTimer = undefined;
      const shouldPersistSnapshot = this.persistSnapshotRequested;
      this.persistSnapshotRequested = false;
      try {
        this.persistNavigation(this.navigationState(!shouldPersistSnapshot));
        // Progressive revisions can be large. Persist them once after completion,
        // never as repeated synchronous work in every D-pad focus callback.
        if (shouldPersistSnapshot) {
          this.persistSnapshot(slimSearchSnapshot(this.snapshot));
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        // Search remains functional when browser storage is unavailable.
      }
    }, 250);
  }

  private readPersisted(): SearchRestoreState | null {
    return readPersistedSearchState();
  }

  private clearPersisted(): void {
    if (this.persistTimer !== undefined) {
      window.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.persistSnapshotRequested = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_NAV_KEY);
      localStorage.removeItem(STORAGE_SNAPSHOT_KEY);
      this.persistedSnapshotIdentity = null;
    } catch {
      // ignore
    }
  }
}
