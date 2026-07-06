import type { AppCard, ContentCard, ContentRail, BrowseTab } from "./types";
import { bindPosterImage, resolveCardPosterUrl } from "./poster";
import { applyRailLayout, RAIL_COLUMNS, RAIL_COLUMNS_LANDSCAPE } from "./layout";
import { cardSavedKey } from "./saved";

export interface HomeCallbacks {
  onContentSelect: (card: ContentCard, railLabel: string) => void;
  onAppSelect: (card: AppCard) => void;
}

export interface HomeOptions {
  browseTab?: BrowseTab;
  onBrowseTabChange?: (tab: BrowseTab) => void;
  savedKeys?: Set<string>;
  onLayoutApplied?: () => void;
}

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; rails: ContentRail[] }
  | { status: "error"; message: string };

const DEFAULT_APP_CARDS: AppCard[] = [
  { id: "settings", action: "settings", kicker: "system", title: "settings" },
];

export const BROWSE_TAB_ORDER: BrowseTab[] = ["movies", "series", "live", "youtube"];

export function buildBrowseTabs(
  container: HTMLElement,
  activeTab: BrowseTab,
  onTabChange: (tab: BrowseTab) => void,
): HTMLElement[] {
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
      if (tab.id !== activeTab) {
        onTabChange(tab.id);
      }
    });
    container.appendChild(button);
    buttons.push(button);
  }
  return buttons;
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
  if (catalogState.status === "loading") {
    container.appendChild(createCatalogMessage("catalog", "loading", "Loading catalog…", "posters will appear here when the Pi responds."));
    return [];
  }

  if (catalogState.status === "error") {
    container.appendChild(createCatalogMessage("catalog", "catalog offline", catalogState.message, "check catalog-service and N2 prereqs."));
    return [];
  }

  const rows: HTMLElement[][] = [];
  for (const rail of catalogState.rails) {
    const section = document.createElement("section");
    section.className = "rail rail--catalog";
    section.dataset.railId = rail.id;

    const heading = document.createElement("h2");
    heading.className = "rail-title";
    heading.textContent = formatRailLabel(rail.label);
    section.appendChild(heading);

    if (rail.cards.length === 0) {
      const empty = document.createElement("p");
      empty.className = "rail-empty";
      empty.textContent = "nothing resolved yet";
      section.appendChild(empty);
      container.appendChild(section);
      continue;
    }

    const track = document.createElement("div");
    track.className = "rail-track rail-track--posters";
    track.setAttribute("role", "list");

    const items: HTMLElement[] = [];
    for (const card of rail.cards) {
      const button = createPosterCard(card, rail, callbacks, options);
      track.appendChild(button);
      items.push(button);
    }
    const landscape = isLandscapeCard(rail.cards[0], options.browseTab);
    applyRailLayout(track, landscape);
    section.appendChild(track);
    container.appendChild(section);
    // Split the rail into visual rows matching the CSS grid column count so
    // that a rail wrapping onto multiple rows is navigable with Down/Up, not
    // only by holding Right through every card.
    const cols = landscape ? RAIL_COLUMNS_LANDSCAPE : RAIL_COLUMNS;
    for (let i = 0; i < items.length; i += cols) {
      rows.push(items.slice(i, i + cols));
    }
  }
  return rows;
}

function createCatalogMessage(
  railId: string,
  headingText: string,
  titleText: string,
  bodyText: string,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "rail rail--empty";
  section.dataset.railId = railId;

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

function isLandscapeCard(card: ContentCard, browseTab?: BrowseTab): boolean {
  return browseTab === "live"
    || browseTab === "youtube"
    || card.source === "youtube"
    || card.type === "tv"
    || card.type.startsWith("youtube_")
    || Boolean(card.liveStatus);
}

function shouldShowLivePill(card: ContentCard, browseTab?: BrowseTab): boolean {
  return card.liveStatus === "live" || (browseTab === "live" && card.type === "tv");
}

function createPosterCard(
  card: ContentCard,
  rail: ContentRail,
  callbacks: HomeCallbacks,
  options: HomeOptions = {},
): HTMLButtonElement {
  const savedKeys = options.savedKeys ?? new Set<string>();
  const landscape = isLandscapeCard(card, options.browseTab);
  const button = document.createElement("button");
  button.type = "button";
  button.className = `card card--poster${landscape ? " card--landscape" : " card--portrait"}`;
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
  poster.src = resolveCardPosterUrl(card);
  bindPosterImage(poster, card.title);

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = card.title;

  const subtitle = document.createElement("span");
  subtitle.className = "card-subtitle";
  subtitle.textContent = card.subtitle;

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
