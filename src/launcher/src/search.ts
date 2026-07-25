import { FocusGrid } from "./focus";
import { buildCatalogRails } from "./home";
import type { BrowseTab, ContentCard, ContentRail } from "./types";

export type SearchScope = "all" | "movies" | "series" | "live" | "youtube";

type SearchResult = {
  key: string;
  source: "mango" | "youtube" | "external";
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

type SearchGroup = {
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
  onStatus: (message: string) => void;
};

const STORAGE_KEY = "mango.search-session.v1";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const PAGE_SIZE = 9;
const SCOPES: Array<{ id: SearchScope; label: string }> = [
  { id: "all", label: "all" },
  { id: "movies", label: "movies" },
  { id: "series", label: "tv shows" },
  { id: "live", label: "live" },
  { id: "youtube", label: "youtube" },
];
const KEYBOARD = [
  [..."1234567890"],
  [..."qwertyuiop"],
  [..."asdfghjkl"],
  [..."zxcvbnm"],
];

type SearchIconName = "search" | "clock" | "play" | "edit" | "refresh";

function searchIcon(name: SearchIconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("search-icon");
  const paths: Record<SearchIconName, string[]> = {
    search: ["M11 4a7 7 0 1 0 4.9 12l4.1 4.1", "M16 16l4 4"],
    clock: ["M12 5a7 7 0 1 0 7 7", "M12 8v4l3 2"],
    play: ["M8.5 6.5v11l9-5.5z"],
    edit: ["M5 19h4l10-10-4-4L5 15v4z", "M13.5 6.5l4 4"],
    refresh: ["M19 8a7 7 0 1 0 1 7", "M19 4v4h-4"],
  };
  for (const pathData of paths[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    if (name === "play") {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    }
    svg.appendChild(path);
  }
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
    description: item.description,
    source: item.source,
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
  private focusedKey: string | undefined;
  private preferredPosition: { row: number; col: number } | undefined;
  private focusedElement: HTMLElement | null = null;
  private homeTab: BrowseTab = "movies";
  private homeFocusKey: string | undefined;
  private homePosition: { row: number; col: number } | undefined;
  private readonly focus = new FocusGrid((element) => {
    this.focusedElement?.classList.remove("focused");
    element.classList.add("focused");
    this.focusedElement = element;
    this.focusedKey = element.dataset.focusKey;
    this.preferredPosition = this.focus.position;
    this.persist();
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
    this.activeSearchId = null;
    this.view.classList.remove("hidden");
    this.render();
    try {
      this.state = await fetchJson<SearchStateResponse>("/api/catalog/search/state");
      this.render();
    } catch {
      this.callbacks.onStatus("Search is ready. Recent activity is temporarily unavailable.");
    }
  }

  restore(input?: unknown): void {
    const state = validRestoreState(input) || this.readPersisted();
    if (state) {
      this.query = state.query;
      this.scope = state.scope;
      this.submitted = state.submitted;
      this.snapshot = state.snapshot;
      this.pages = state.pages;
      this.focusedKey = state.focusedKey;
      this.preferredPosition = state.position;
      this.homeTab = state.homeTab || this.homeTab;
      this.homeFocusKey = state.homeFocusKey;
      this.homePosition = state.homePosition;
    }
    this.view.classList.remove("hidden");
    this.render();
  }

  hideForDetail(): void {
    this.persist();
    this.view.classList.add("hidden");
  }

  close(): void {
    const state = this.playbackState();
    void this.cancelActive();
    this.pollToken += 1;
    this.view.classList.add("hidden");
    this.clearPersisted();
    this.callbacks.onClose(state);
  }

  moveRow(delta: number): void {
    this.focus.moveRow(delta);
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
      snapshot: this.snapshot,
      pages: { ...this.pages },
      focusedKey: this.focusedKey,
      position: this.preferredPosition,
      homeTab: this.homeTab,
      homeFocusKey: this.homeFocusKey,
      homePosition: this.homePosition,
    };
  }

  private setQuery(value: string): void {
    this.query = value.slice(0, 120);
    this.submitted = false;
    this.snapshot = null;
    this.pages = {};
    void this.cancelActive();
    this.scheduleSuggestions();
    this.render();
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
          this.suggestions = response.suggestions || [];
          this.render();
        }
      }).catch(() => undefined);
    }, 120);
  }

  private async submit(refreshYoutube = false): Promise<void> {
    if (this.query.trim().length < 2) {
      this.callbacks.onStatus("Type at least 2 characters.");
      return;
    }
    await this.cancelActive();
    const response = await fetchJson<SearchSnapshot>("/api/catalog/search/query", {
      method: "POST",
      body: JSON.stringify({
        query: this.query,
        scope: this.scope,
        refresh_youtube: refreshYoutube,
      }),
    }).catch((error) => {
      this.callbacks.onStatus(error instanceof Error ? error.message : "Search is temporarily unavailable.");
      return null;
    });
    if (!response) return;
    this.submitted = true;
    this.snapshot = response;
    this.pages = {};
    this.activeSearchId = response.search_id;
    this.focusedKey = response.groups[0]?.items[0]?.key
      ? `rail:${response.groups[0].id}:${response.groups[0].items[0].type}:${response.groups[0].items[0].id}`
      : "search:edit";
    this.render();
    this.callbacks.onStatus(response.complete ? "Search complete." : "Searching every source…");
    void this.poll(response.search_id, response.revision, ++this.pollToken);
  }

  private async poll(searchId: string, revision: number, token: number): Promise<void> {
    let after = revision;
    while (this.activeSearchId === searchId && token === this.pollToken) {
      const snapshot = await fetchJson<SearchSnapshot>(
        `/api/catalog/search/query/${encodeURIComponent(searchId)}?after_revision=${after}&wait_ms=20000`,
      ).catch(() => null);
      if (!snapshot || token !== this.pollToken || this.activeSearchId !== searchId) return;
      if (snapshot.revision > after) {
        after = snapshot.revision;
        this.snapshot = snapshot;
        this.render();
      }
      if (snapshot.complete) {
        this.activeSearchId = null;
        this.callbacks.onStatus(snapshot.groups.some((group) => group.items.length > 0)
          ? "Search complete."
          : "No matches. Try another title, channel, or topic.");
        return;
      }
    }
  }

  private async cancelActive(): Promise<void> {
    const id = this.activeSearchId;
    this.activeSearchId = null;
    this.pollToken += 1;
    if (!id) return;
    await fetch(`/api/catalog/search/query/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      cache: "no-store",
    }).catch(() => undefined);
  }

  private render(): void {
    this.view.replaceChildren();
    this.view.classList.toggle("search--results", this.submitted);
    this.view.classList.toggle("search--compose", !this.submitted);

    const atmosphere = document.createElement("div");
    atmosphere.className = "search-atmosphere";
    atmosphere.setAttribute("aria-hidden", "true");

    const header = document.createElement("header");
    header.className = "search-head";

    const identity = document.createElement("div");
    identity.className = "search-identity";
    const brand = document.createElement("p");
    brand.className = "search-brand";
    brand.textContent = "mango discovery";
    const title = document.createElement("h1");
    title.className = "search-title";
    title.textContent = this.submitted ? "Results" : "Find your next watch";
    const subtitle = document.createElement("p");
    subtitle.className = "search-subtitle";
    subtitle.textContent = this.submitted
      ? "One search across your entire Mango universe."
      : "Movies, TV shows, live channels and YouTube. All in one place.";
    identity.append(brand, title, subtitle);

    const queryShell = document.createElement("div");
    queryShell.className = "search-query-shell";
    queryShell.appendChild(searchIcon("search"));
    const query = document.createElement("div");
    query.className = "search-query";
    query.dataset.empty = String(this.query.length === 0);
    const queryText = document.createElement("span");
    queryText.className = "search-query-text";
    queryText.textContent = this.query || "Search by title, channel or mood";
    query.appendChild(queryText);
    if (!this.submitted) {
      const caret = document.createElement("span");
      caret.className = "search-query-caret";
      caret.setAttribute("aria-hidden", "true");
      query.appendChild(caret);
    }
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
        if (this.submitted) void this.submit();
        else {
          this.scheduleSuggestions();
          this.render();
        }
      });
      button.classList.toggle("search-chip--active", id === this.scope);
      button.setAttribute("aria-pressed", String(id === this.scope));
      scopes.appendChild(button);
      return button;
    });
    header.append(identity, queryShell, scopes);
    this.view.append(atmosphere, header);

    const rows: HTMLElement[][] = this.submitted ? [[edit], scopeRow] : [scopeRow];
    if (!this.submitted) {
      const compose = document.createElement("div");
      compose.className = "search-compose-body";
      rows.push(...this.renderKeyboard(compose));
      rows.push(...this.renderStarters(compose));
      this.view.appendChild(compose);
    } else {
      rows.push(...this.renderResults());
    }
    this.focus.setRows(rows, {
      preferredKey: this.focusedKey,
      fallbackPosition: this.preferredPosition,
    });
    this.persist();
  }

  private renderKeyboard(parent: HTMLElement): HTMLElement[][] {
    const keyboard = document.createElement("section");
    keyboard.className = "search-keyboard";
    keyboard.setAttribute("aria-label", "On-screen keyboard");
    const keyboardHead = document.createElement("div");
    keyboardHead.className = "search-panel-head";
    const heading = document.createElement("h2");
    heading.textContent = "Type with your D-pad";
    const hint = document.createElement("p");
    hint.textContent = "X delete  ·  hold X clear";
    keyboardHead.append(heading, hint);
    keyboard.appendChild(keyboardHead);
    const rows: HTMLElement[][] = [];
    for (const keyRow of KEYBOARD) {
      const row = document.createElement("div");
      row.className = "search-key-row";
      const buttons = keyRow.map((key) => {
        const button = this.controlButton(
          key.toUpperCase(),
          `search:key:${key}`,
          () => this.setQuery(`${this.query}${key}`),
        );
        button.classList.add("search-key");
        row.appendChild(button);
        return button;
      });
      keyboard.appendChild(row);
      rows.push(buttons);
    }
    const actions = document.createElement("div");
    actions.className = "search-key-row search-key-row--actions";
    const space = this.controlButton("space", "search:key:space", () => this.setQuery(`${this.query} `));
    const erase = this.controlButton("delete", "search:key:delete", () => this.secondary("tap"));
    const clear = this.controlButton("clear", "search:key:clear", () => this.secondary("hold"));
    const submit = this.controlButton("search", "search:key:submit", () => void this.submit());
    space.classList.add("search-key-action", "search-key-space");
    erase.classList.add("search-key-action");
    clear.classList.add("search-key-action");
    submit.classList.add("search-submit", "search-key-action");
    submit.prepend(searchIcon("search"));
    actions.append(space, erase, clear, submit);
    keyboard.appendChild(actions);
    rows.push([space, erase, clear, submit]);
    parent.appendChild(keyboard);
    return rows;
  }

  private renderStarters(parent: HTMLElement): HTMLElement[][] {
    const choices: Array<{
      label: string;
      query: string;
      meta: string;
      icon: "search" | "clock" | "play";
    }> = [];
    if (this.suggestions.length > 0) {
      for (const item of this.suggestions) {
        choices.push({
          label: item.title,
          query: item.title,
          meta: contentTypeLabel(item.type, item.source),
          icon: "search",
        });
      }
    } else if (this.query.length === 0) {
      for (const recent of this.state.recents || []) {
        choices.push({
          label: recent.display_query,
          query: recent.display_query,
          meta: "Recent search",
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
          });
        }
      }
    }
    const section = document.createElement("section");
    section.className = "search-starters search-discovery";
    const panelHead = document.createElement("div");
    panelHead.className = "search-panel-head";
    const heading = document.createElement("h2");
    heading.textContent = this.suggestions.length > 0 ? "Suggestions" : "Jump back in";
    const hint = document.createElement("p");
    hint.textContent = this.suggestions.length > 0 ? "Local matches as you type" : "Recent searches and your library";
    panelHead.append(heading, hint);
    section.appendChild(panelHead);
    const track = document.createElement("div");
    track.className = "search-starter-track";
    const rows = choices.slice(0, 7).map((choice, index) => {
      const button = this.controlButton(choice.label, `search:starter:${index}`, () => {
        this.query = choice.query;
        void this.submit();
      });
      button.classList.add("search-starter");
      button.replaceChildren();
      const iconWrap = document.createElement("span");
      iconWrap.className = "search-starter-icon";
      iconWrap.appendChild(searchIcon(choice.icon));
      const copy = document.createElement("span");
      copy.className = "search-starter-copy";
      const label = document.createElement("span");
      label.className = "search-starter-title";
      label.textContent = choice.label;
      const meta = document.createElement("span");
      meta.className = "search-starter-meta";
      meta.textContent = choice.meta;
      copy.append(label, meta);
      button.append(iconWrap, copy);
      track.appendChild(button);
      return [button];
    });
    if (choices.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-starter-empty";
      empty.appendChild(searchIcon("search"));
      const emptyCopy = document.createElement("p");
      emptyCopy.textContent = "Start typing to search everything Mango can play.";
      empty.appendChild(emptyCopy);
      track.appendChild(empty);
    }
    section.appendChild(track);
    parent.appendChild(section);
    return rows;
  }

  private renderResults(): HTMLElement[][] {
    const results = document.createElement("div");
    results.className = "search-results rails";
    const toolbar = document.createElement("div");
    toolbar.className = "search-results-toolbar";
    const progress = document.createElement("div");
    progress.className = "search-results-state";
    const progressMark = document.createElement("span");
    progressMark.className = "search-results-state-mark";
    progressMark.setAttribute("aria-hidden", "true");
    const progressCopy = document.createElement("span");
    progressCopy.textContent = this.snapshot?.complete ? "Results ready" : "Searching every source";
    progress.append(progressMark, progressCopy);
    toolbar.appendChild(progress);

    const groups = this.snapshot?.groups || [];
    const rails: ContentRail[] = groups
      .filter((group) => group.items.length > 0)
      .map((group) => ({
        id: group.id,
        label: group.label,
        layout: group.layout,
        cards: group.items
          .slice(0, ((this.pages[group.id] || 0) + 1) * PAGE_SIZE)
          .map((item) => resultToCard(item, `search:${group.id}`)),
      }));
    const rows = buildCatalogRails(results, {
      onContentSelect: (card, railLabel) => this.openResult(card, railLabel),
      onAppSelect: () => undefined,
    }, {}, { status: "ready", rails });

    for (const group of groups) {
      const shown = ((this.pages[group.id] || 0) + 1) * PAGE_SIZE;
      if (group.items.length <= shown) continue;
      const section = results.querySelector<HTMLElement>(`[data-rail-id="${CSS.escape(group.id)}"]`);
      if (!section) continue;
      const more = this.controlButton(
        `more ${group.label.toLowerCase()}`,
        `search:more:${group.id}`,
        () => {
          this.pages[group.id] = (this.pages[group.id] || 0) + 1;
          this.focusedKey = `search:more:${group.id}`;
          this.render();
        },
      );
      more.classList.add("search-more");
      section.appendChild(more);
      rows.push([more]);
    }

    if (rails.length === 0) {
      const message = document.createElement("div");
      message.className = "search-message";
      const pending = !this.snapshot?.complete;
      message.appendChild(searchIcon("search"));
      const messageCopy = document.createElement("div");
      const messageTitle = document.createElement("h2");
      messageTitle.textContent = pending ? "Looking everywhere" : "Nothing matched yet";
      const messageBody = document.createElement("p");
      messageBody.textContent = pending
        ? "Mango is checking your library, Live and YouTube."
        : "Try a title, person, channel or a broader mood.";
      messageCopy.append(messageTitle, messageBody);
      message.appendChild(messageCopy);
      results.appendChild(message);
    }

    const degraded = Object.values(this.snapshot?.phases || {})
      .filter((phase) => phase.status === "degraded" || phase.status === "failed")
      .map((phase) => phase.message)
      .find(Boolean);
    if (degraded) {
      const note = document.createElement("p");
      note.className = "search-degraded";
      note.textContent = degraded;
      toolbar.appendChild(note);
    }

    if (this.scope === "all" || this.scope === "youtube") {
      const refresh = this.controlButton(
        "refresh YouTube results",
        "search:refresh-youtube",
        () => void this.submit(true),
      );
      refresh.classList.add("search-refresh-youtube");
      refresh.prepend(searchIcon("refresh"));
      toolbar.appendChild(refresh);
      rows.unshift([refresh]);
    }
    results.prepend(toolbar);
    this.view.appendChild(results);
    return rows;
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

  private persist(state = this.playbackState()): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Search remains functional when browser storage is unavailable.
    }
  }

  private readPersisted(): SearchRestoreState | null {
    try {
      return validRestoreState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"));
    } catch {
      return null;
    }
  }

  private clearPersisted(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
