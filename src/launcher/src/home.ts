import type { AppCard, ContentCard, ContentRail, BrowseTab } from "./types";
import { bindPosterImage, resolveCardPosterUrl } from "./poster";
import { applyRailLayout, railColumns } from "./layout";
import { cardSavedKey } from "./saved";
import { MINIMAL_VOD_POSTER_LABELS } from "./ui-flags";

export interface HomeCallbacks {
  onContentSelect: (card: ContentCard, railLabel: string) => void;
  onAppSelect: (card: AppCard) => void;
}

export interface HomeOptions {
  browseTab?: BrowseTab;
  onBrowseTabChange?: (tab: BrowseTab) => void;
  savedKeys?: Set<string>;
  onLayoutApplied?: () => void;
  railTrailingAction?: (rail: ContentRail, landscape: boolean) => HTMLElement | null;
  /**
   * Rows a rail may occupy. Browse tabs use 1: a rail there is a sample of a
   * bigger pool, so a part-filled second row reads as a load failure. Search
   * passes null because a result group is a grid the viewer asked for — its
   * last row being short means "that is all there is", and capping it would
   * hide results the viewer requested.
   */
  railRowLimit?: number | null;
  /**
   * Search paints a full result page in one rail. Assigning poster `src` in
   * that loop starts decode on every in-viewport image and starves D-pad.
   * Cards mount first; the caller arms sources after a pad yield.
   */
  deferPosterSrc?: boolean;
}

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; rails: ContentRail[]; freshness: "fresh" | "stale" }
  | { status: "empty" }
  | { status: "offline"; reason: "busy" | "timeout" | "unavailable" };

const DEFAULT_APP_CARDS: AppCard[] = [
  { id: "settings", action: "settings", kicker: "system", title: "settings" },
];

export const BROWSE_TAB_ORDER: BrowseTab[] = ["movies", "series", "live", "youtube"];

const YOUTUBE_SHUFFLE_RAIL_IDS = new Set([
  "for_you",
  "beyond",
  "more_like",
  "new_from_subscriptions",
  "frequently_watched",
  "live_now",
  "history",
]);

export function shuffleableCatalogRails(tab: BrowseTab, rails: ContentRail[]): ContentRail[] {
  if (tab === "live") return [];
  if (tab === "youtube") {
    return rails.filter((rail) => YOUTUBE_SHUFFLE_RAIL_IDS.has(rail.id) && rail.cards.length > 0);
  }
  return rails.filter((rail) => rail.cards.length > 0);
}

export function catalogShuffleFingerprint(tab: BrowseTab, rails: ContentRail[]): string | null {
  const shuffleable = shuffleableCatalogRails(tab, rails);
  if (shuffleable.length === 0) return null;
  return shuffleable.map((rail) => (
    `${rail.id}:${rail.cards.map((card) => `${card.type}:${card.id}`).join(",")}`
  )).join("|");
}

/** Slate + rail + card identity for impression POST gating. */
export function catalogImpressionFingerprint(tab: BrowseTab, rails: ContentRail[]): string | null {
  if (tab !== "youtube" && tab !== "movies" && tab !== "series") return null;
  const parts: string[] = [tab];
  for (const rail of rails) {
    const sequence = tab === "youtube" ? rail.sourceSlateSequence : rail.slateSequence;
    parts.push(
      rail.id,
      String(sequence ?? ""),
      rail.attributionToken ?? "",
      rail.cards.map((card) => `${card.type}:${card.id}`).join(","),
    );
  }
  return parts.join("|");
}

export type ShufflePressDecision = "start" | "queue" | "ignore";

export function shufflePressDecision(input: {
  inFlight: boolean;
  tab: BrowseTab;
  detailOpen: boolean;
  inSettings: boolean;
}): ShufflePressDecision {
  if (input.detailOpen || input.inSettings || input.tab === "live") return "ignore";
  if (input.inFlight) return "queue";
  return "start";
}

/**
 * After Shuffle, card ids change so a stored focus key would miss and clamp
 * onto chrome. Restore the poster slot instead: the rail row/column at press
 * time, or the last catalog slot if Shuffle was pressed from chrome.
 */
export function shuffleFocusRestore(input: {
  currentKey?: string;
  currentPosition?: { row: number; col: number };
  lastCatalogPosition?: { row: number; col: number };
}): { fallbackPosition?: { row: number; col: number } } {
  if (input.currentKey?.startsWith("rail:") && input.currentPosition) {
    return { fallbackPosition: input.currentPosition };
  }
  return { fallbackPosition: input.lastCatalogPosition ?? input.currentPosition };
}

export type YoutubeHistoryImportRefreshPolicy = {
  cancelActiveCatalogRequest: boolean;
  reloadYoutubeNow: boolean;
  deferYoutubeReload: boolean;
};

/**
 * A Takeout import changes YouTube history only. Keeping this policy pure and
 * explicit prevents a late upload completion from shuffling whichever VOD tab
 * happens to be visible after the viewer has left Settings.
 */
export function youtubeHistoryImportRefreshPolicy(
  activeTab: BrowseTab,
  surfaceBlocked: boolean,
): YoutubeHistoryImportRefreshPolicy {
  const youtubeActive = activeTab === "youtube";
  return {
    cancelActiveCatalogRequest: youtubeActive,
    reloadYoutubeNow: youtubeActive && !surfaceBlocked,
    deferYoutubeReload: youtubeActive && surfaceBlocked,
  };
}

export function buildBrowseTabs(
  container: HTMLElement,
  activeTab: BrowseTab,
  onTabChange: (tab: BrowseTab) => void,
): HTMLElement[] {
  const existing = Array.from(container.querySelectorAll<HTMLElement>(":scope > .browse-tab"));
  if (browseTabsCanReuse(existing.map((button) => button.dataset.tab))) {
    for (const button of existing) {
      button.classList.toggle("browse-tab--active", button.dataset.tab === activeTab);
    }
    return existing;
  }
  container.replaceChildren();
  const buttons: HTMLElement[] = [];
  for (const tab of BROWSE_TAB_ORDER.map((id) => ({
    id,
    label: id === "series" ? "tv shows" : id,
  }))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `browse-tab${tab.id === activeTab ? " browse-tab--active" : ""}`;
    button.dataset.tab = tab.id;
    button.dataset.focusKey = `browse:${tab.id}`;
    button.textContent = tab.label;
    button.addEventListener("click", () => {
      onTabChange(tab.id);
    });
    container.appendChild(button);
    buttons.push(button);
  }
  return buttons;
}

export function browseTabsCanReuse(
  existingTabs: Array<string | undefined>,
  order: readonly BrowseTab[] = BROWSE_TAB_ORDER,
): boolean {
  return existingTabs.length === order.length
    && existingTabs.every((tab, index) => tab === order[index]);
}

export function buildHomeRails(
  container: HTMLElement,
  callbacks: HomeCallbacks,
  options: HomeOptions = {},
  catalogState: CatalogState = { status: "loading" },
): HTMLElement[][] {
  container.replaceChildren();

  const rows: HTMLElement[][] = [];

  rows.push(...buildCatalogRails(container, callbacks, options, catalogState));

  const apps = buildAppsRail(callbacks);
  container.appendChild(apps.section);
  rows.push(apps.row);

  return rows;
}

/**
 * Builds catalog rail sections into `container` (which the caller owns and is
 * expected to have cleared beforehand) and returns the focus rows for the
 * built posters. Emits the onLayoutApplied callback on next frame when the
 * catalog is ready. Split out from buildHomeRails so the launcher can cache
 * per-tab catalog DOM independently of the shared apps rail.
 */
export function buildCatalogRails(
  container: HTMLElement,
  callbacks: HomeCallbacks,
  options: HomeOptions,
  catalogState: CatalogState,
): HTMLElement[][] {
  const rows = appendCatalogSections(container, callbacks, catalogState, options);
  if (catalogState.status === "ready") {
    window.requestAnimationFrame(() => options.onLayoutApplied?.());
  }
  return rows;
}

/**
 * Builds the shared apps rail (currently a single Settings tile with the
 * reliability badge). Callers are expected to build this once and reuse the
 * DOM across tab switches; the reliability badge is refreshed in place via
 * a document-scoped querySelector, so keeping a single instance in the DOM
 * avoids stale-badge selection ambiguity.
 */
export function buildAppsRail(callbacks: HomeCallbacks): { section: HTMLElement; row: HTMLElement[] } {
  const section = document.createElement("section");
  section.className = "rail rail--apps";
  section.dataset.railId = "apps";

  const heading = document.createElement("h2");
  heading.className = "rail-title";
  heading.textContent = "apps";
  section.appendChild(heading);

  const track = document.createElement("div");
  track.className = "rail-track rail-track--apps";
  track.setAttribute("role", "list");

  const row: HTMLElement[] = [];
  for (const app of DEFAULT_APP_CARDS) {
    const button = createAppCard(app, callbacks);
    track.appendChild(button);
    row.push(button);
  }

  section.appendChild(track);
  return { section, row };
}

function appendCatalogSections(
  container: HTMLElement,
  callbacks: HomeCallbacks,
  catalogState: CatalogState,
  options: HomeOptions,
): HTMLElement[][] {
  const preamble = appendCatalogPreamble(container, catalogState, options);
  if (preamble !== null) return preamble;
  if (catalogState.status !== "ready") return [];

  const rows: HTMLElement[][] = [];
  for (const rail of nonEmptyCatalogRails(catalogState.rails)) {
    rows.push(...appendOneCatalogRail(container, rail, callbacks, options));
  }
  return rows;
}

function appendCatalogPreamble(
  container: HTMLElement,
  catalogState: CatalogState,
  options: HomeOptions,
): HTMLElement[][] | null {
  if (catalogState.status === "loading") {
    container.appendChild(createCatalogSkeleton(options.browseTab ?? "movies"));
    return [];
  }

  if (catalogState.status === "empty") {
    const copy = catalogEmptyCopy(options.browseTab ?? "movies");
    container.appendChild(createCatalogMessage("empty", copy.heading, copy.title, copy.body));
    return [];
  }

  if (catalogState.status === "offline") {
    const copy = catalogOfflineCopy(catalogState.reason);
    container.appendChild(createCatalogMessage("offline", copy.heading, copy.title, copy.body));
    return [];
  }

  if (catalogState.freshness === "stale") {
    container.appendChild(createCatalogStaleBanner());
  }
  return null;
}

function appendOneCatalogRail(
  container: HTMLElement,
  rail: ContentRail,
  callbacks: HomeCallbacks,
  options: HomeOptions,
): HTMLElement[][] {
  const section = document.createElement("section");
  section.className = "rail rail--catalog";
  section.dataset.railId = rail.id;

  const heading = document.createElement("h2");
  heading.className = "rail-title";
  heading.textContent = formatRailLabel(rail.label);
  section.appendChild(heading);

  const track = document.createElement("div");
  track.className = "rail-track rail-track--posters";
  track.setAttribute("role", "list");

  const landscape = rail.layout === "landscape"
    || (rail.layout !== "poster" && isLandscapeCard(rail.cards[0], options.browseTab));
  const cols = railColumns(landscape);
  const trailingAction = options.railTrailingAction?.(rail, landscape);
  const rowLimit = options.railRowLimit === undefined ? 1 : options.railRowLimit;
  const rowBudget = rowLimit === null
    ? rail.cards.length
    : cols * rowLimit - (trailingAction ? 1 : 0);
  const items: HTMLElement[] = [];
  for (const card of rail.cards.slice(0, rowBudget)) {
    const button = createPosterCard(card, rail, callbacks, options, landscape);
    track.appendChild(button);
    items.push(button);
  }
  if (trailingAction) {
    track.appendChild(trailingAction);
    items.push(trailingAction);
  }
  applyRailLayout(track, landscape);
  section.appendChild(track);
  container.appendChild(section);
  return splitFocusRows(items, cols);
}

export function nonEmptyCatalogRails(rails: ContentRail[]): ContentRail[] {
  return rails.filter((rail) => rail.cards.length > 0);
}

export function hasCatalogItems(rails: ContentRail[]): boolean {
  return rails.some((rail) => rail.cards.length > 0);
}

export function usableCatalogRails(rails: ContentRail[] | undefined): ContentRail[] | undefined {
  if (!rails || !hasCatalogItems(rails)) return undefined;
  const usable = nonEmptyCatalogRails(rails);
  return usable.length === rails.length ? rails : usable;
}

export function sameCatalogPresentation(left: CatalogState, right: CatalogState): boolean {
  if (left.status !== right.status) return false;
  if (left.status === "ready" && right.status === "ready") {
    return left.rails === right.rails && left.freshness === right.freshness;
  }
  if (left.status === "offline" && right.status === "offline") return left.reason === right.reason;
  return true;
}

export function catalogTabCacheIsWarm(
  tab: BrowseTab,
  rails: ContentRail[] | undefined,
  saved: Set<string> | undefined,
): boolean {
  if (!rails || !hasCatalogItems(rails)) return false;
  return tab === "live" || saved !== undefined;
}

export type BrowseTabSwitchPlan = "noop" | "paint-cache" | "load";

export function browseTabSwitchPlan(
  currentTab: BrowseTab,
  nextTab: BrowseTab,
  hasWarmCache: boolean,
): BrowseTabSwitchPlan {
  if (nextTab === currentTab) return "noop";
  if (hasWarmCache) return "paint-cache";
  return "load";
}

export function catalogStateAfterSuccess(
  incoming: ContentRail[],
  fallback: ContentRail[] | undefined,
): CatalogState {
  const usableIncoming = usableCatalogRails(incoming);
  if (usableIncoming) return { status: "ready", rails: usableIncoming, freshness: "fresh" };
  const usableFallback = usableCatalogRails(fallback);
  if (usableFallback) return { status: "ready", rails: usableFallback, freshness: "stale" };
  return { status: "empty" };
}

export function catalogStateAfterFailure(
  reason: "busy" | "timeout" | "unavailable",
  fallback: ContentRail[] | undefined,
): CatalogState {
  const usableFallback = usableCatalogRails(fallback);
  if (usableFallback) return { status: "ready", rails: usableFallback, freshness: "stale" };
  return { status: "offline", reason };
}

interface CatalogStateCopy {
  heading: string;
  title: string;
  body: string;
}

export function catalogEmptyCopy(tab: BrowseTab): CatalogStateCopy {
  if (tab === "youtube") {
    return {
      heading: "YouTube",
      title: "make YouTube yours",
      body: "connect subscriptions, import Google Takeout in Settings, or watch a video to grow For You.",
    };
  }
  const tabLabel = tab === "series" ? "tv shows" : tab;
  const refreshCopy = tab === "live"
    ? "try another tab or check back soon."
    : "try another tab; recommendations will appear here when ready.";
  return {
    heading: tabLabel,
    title: "nothing ready here yet",
    body: refreshCopy,
  };
}

export function catalogOfflineCopy(reason: "busy" | "timeout" | "unavailable"): CatalogStateCopy {
  if (reason === "busy") {
    return {
      heading: "waiting",
      title: "the library is catching up",
      body: "mango will try again in a moment.",
    };
  }
  return {
    heading: "offline",
    title: reason === "timeout" ? "the library took too long" : "can't reach the library",
    body: "mango will keep trying in the background.",
  };
}

function createCatalogSkeleton(tab: BrowseTab): HTMLElement {
  const landscape = tab === "live" || tab === "youtube";
  const section = document.createElement("section");
  section.className = "rail rail--catalog-state catalog-state catalog-state--loading";
  section.dataset.catalogState = "loading";
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");
  section.setAttribute("aria-atomic", "true");

  const heading = document.createElement("h2");
  heading.className = "rail-title";
  heading.textContent = `loading ${tab === "series" ? "tv shows" : tab}…`;

  const status = document.createElement("p");
  status.className = "sr-only";
  status.textContent = "getting your shelves ready";

  const track = document.createElement("div");
  track.className = "rail-track--posters catalog-skeleton-grid";
  track.setAttribute("aria-hidden", "true");
  applyRailLayout(track, landscape);
  for (let index = 0; index < railColumns(landscape); index += 1) {
    const card = document.createElement("div");
    card.className = `catalog-skeleton-card catalog-skeleton-card--${landscape ? "landscape" : "portrait"}`;
    const art = document.createElement("span");
    art.className = "catalog-skeleton-art";
    card.appendChild(art);
    if (landscape) {
      const title = document.createElement("span");
      title.className = "catalog-skeleton-line catalog-skeleton-line--title";
      const meta = document.createElement("span");
      meta.className = "catalog-skeleton-line catalog-skeleton-line--meta";
      card.append(title, meta);
    }
    track.appendChild(card);
  }
  section.append(heading, status, track);
  return section;
}

function createCatalogStaleBanner(): HTMLElement {
  const banner = document.createElement("section");
  banner.className = "catalog-stale-banner";
  banner.dataset.catalogState = "stale";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-atomic", "true");
  const title = document.createElement("span");
  title.className = "catalog-stale-title";
  title.textContent = "offline · showing recently loaded titles";
  const body = document.createElement("span");
  body.className = "catalog-stale-body";
  body.textContent = "mango is reconnecting";
  banner.append(title, body);
  return banner;
}

export function splitFocusRows<T>(items: T[], columns: number): T[][] {
  const rows: T[][] = [];
  const safeColumns = Math.max(1, Math.floor(columns));
  for (let i = 0; i < items.length; i += safeColumns) {
    rows.push(items.slice(i, i + safeColumns));
  }
  return rows;
}

function createCatalogMessage(
  state: "empty" | "offline",
  headingText: string,
  titleText: string,
  bodyText: string,
): HTMLElement {
  const section = document.createElement("section");
  section.className = `rail rail--catalog-state catalog-state catalog-state--${state}`;
  section.dataset.railId = "catalog-state";
  section.dataset.catalogState = state;
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");
  section.setAttribute("aria-atomic", "true");

  const heading = document.createElement("h2");
  heading.className = "rail-title";
  heading.textContent = formatRailLabel(headingText);

  const panel = document.createElement("div");
  panel.className = "empty-state";

  const title = document.createElement("p");
  title.className = "empty-state-title";
  title.textContent = titleText;

  const body = document.createElement("p");
  body.className = "empty-state-body";
  body.textContent = bodyText;

  panel.append(title, body);
  section.append(heading, panel);
  return section;
}

export function formatRailLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Subtitles that only restate the content type, which the tab already says. */
const BARE_TYPE_SUBTITLES = new Set(["movie", "movies", "tv", "tv show", "tv shows", "series", "show"]);

/**
 * The one supporting fact worth a second line under a revealed poster title.
 *
 * Discovery and Saved rails already carry the release year in `subtitle`, and it
 * is the fact that disambiguates remakes sharing a name. Continue watching has no
 * year but puts progress there instead, which is more useful than a year would be
 * on a title you are part-way through. A bare content type is dropped: on the
 * Movies tab, "movie" is not information.
 *
 * Exported because the detail view's related row reveals labels the same way, and
 * two copies of this rule would drift.
 */
export function posterRevealMeta(card: ContentCard): string {
  if (card.year !== undefined && card.year !== null && String(card.year).trim()) {
    return String(card.year).trim();
  }
  const subtitle = card.subtitle?.trim() ?? "";
  return BARE_TYPE_SUBTITLES.has(subtitle.toLowerCase()) ? "" : subtitle;
}

export function isLandscapeCard(card: ContentCard, browseTab?: BrowseTab): boolean {
  return browseTab === "live"
    || browseTab === "youtube"
    || card.source === "youtube"
    || card.type === "tv"
    || card.type.startsWith("youtube_")
    || Boolean(card.liveStatus);
}

export function shouldShowLivePill(card: ContentCard, browseTab?: BrowseTab): boolean {
  return card.liveStatus === "live" || (browseTab === "live" && card.type === "tv");
}

function createPosterCard(
  card: ContentCard,
  rail: ContentRail,
  callbacks: HomeCallbacks,
  options: HomeOptions = {},
  forceLandscape?: boolean,
): HTMLButtonElement {
  const savedKeys = options.savedKeys ?? new Set<string>();
  const landscape = forceLandscape ?? isLandscapeCard(card, options.browseTab);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card card--poster${landscape ? " card--landscape" : " card--portrait"}`;
  const minimalLabels = MINIMAL_VOD_POSTER_LABELS
    && !landscape
    && (options.browseTab === "movies" || options.browseTab === "series");
  if (minimalLabels) {
    button.classList.add("card--poster-minimal");
  }
  button.dataset.focusKey = `rail:${rail.id}:${card.type}:${card.id}`;
  if (savedKeys.has(cardSavedKey(card))) {
    button.classList.add("card--saved");
  }
  button.setAttribute("role", "listitem");
  button.setAttribute("aria-label", `${card.title}, ${card.subtitle}`);

  const poster = document.createElement("img");
  poster.className = "poster-image";
  poster.alt = "";
  poster.loading = "lazy";
  poster.decoding = "async";
  const posterUrl = resolveCardPosterUrl(card);
  if (options.deferPosterSrc && posterUrl) {
    poster.dataset.posterSrc = posterUrl;
  } else {
    poster.src = posterUrl;
  }
  bindPosterImage(poster, card.title);

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = card.title;

  const subtitle = document.createElement("span");
  subtitle.className = "card-subtitle";
  // A minimal poster's label only appears on focus, so its second line is edited
  // down to the one fact worth reading there rather than the full card subtitle.
  subtitle.textContent = minimalLabels ? posterRevealMeta(card) : card.subtitle;

  const content = document.createElement("span");
  content.className = "poster-content";
  content.append(title, subtitle);

  const livePill = shouldShowLivePill(card, options.browseTab)
    ? (() => {
        const pill = document.createElement("span");
        pill.className = "card-live-pill";
        pill.textContent = "live";
        pill.setAttribute("aria-hidden", "true");
        return pill;
      })()
    : null;

  if (landscape) {
    const frame = document.createElement("span");
    frame.className = "poster-frame";
    frame.append(poster);
    if (card.progressPct !== undefined && card.progressPct > 0) {
      const progress = document.createElement("span");
      progress.className = "poster-progress";
      progress.setAttribute("aria-hidden", "true");
      progress.style.setProperty("--progress", `${Math.round(card.progressPct * 100)}%`);
      frame.append(progress);
    }
    if (livePill) {
      frame.append(livePill);
    }
    button.append(frame, content);
  } else {
    const shade = document.createElement("span");
    shade.className = "poster-shade";
    shade.setAttribute("aria-hidden", "true");
    button.append(poster, shade, content);
    if (livePill) {
      button.append(livePill);
    }
  }
  if (!landscape && card.progressPct !== undefined && card.progressPct > 0) {
    const progress = document.createElement("span");
    progress.className = "poster-progress";
    progress.setAttribute("aria-hidden", "true");
    progress.style.setProperty("--progress", `${Math.round(card.progressPct * 100)}%`);
    button.append(progress);
  }
  button.addEventListener("click", () => callbacks.onContentSelect(card, rail.label));
  return button;
}

function createAppCard(app: AppCard, callbacks: HomeCallbacks): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card card--app";
  button.dataset.action = app.action;
  button.dataset.focusKey = `app:${app.action}`;
  button.setAttribute("role", "listitem");
  button.setAttribute("aria-label", app.title);

  const kicker = document.createElement("span");
  kicker.className = "card-kicker";
  kicker.textContent = app.kicker;

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = app.title;

  button.append(kicker, title);
  if (app.action === "settings") {
    const badge = document.createElement("span");
    badge.className = "card-health-badge hidden";
    badge.dataset.settingsHealth = "true";
    button.append(badge);
  }
  button.addEventListener("click", () => callbacks.onAppSelect(app));
  return button;
}
