import type { AppCard, ContentCard, ContentRail, BrowseTab } from "./types";
import { bindPosterImage, resolveCardPosterUrl } from "./poster";
import { applyRailLayout } from "./layout";

export interface HomeCallbacks {
  onContentSelect: (card: ContentCard, railLabel: string) => void;
  onAppSelect: (card: AppCard) => void;
}

export interface HomeOptions {
  browseTab?: BrowseTab;
  onBrowseTabChange?: (tab: BrowseTab) => void;
  pinnedKeys?: Set<string>;
  onLayoutApplied?: () => void;
}

export type CatalogState =
  | { status: "loading" }
  | { status: "ready"; rails: ContentRail[] }
  | { status: "error"; message: string };

const DEFAULT_APP_CARDS: AppCard[] = [
  { id: "settings", action: "settings", kicker: "System", title: "Settings" },
];

export const BROWSE_TAB_ORDER: BrowseTab[] = ["movies", "series", "live"];

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

  rows.push(...appendCatalogSections(container, callbacks, catalogState, options));

  if (catalogState.status === "ready") {
    window.requestAnimationFrame(() => options.onLayoutApplied?.());
  }

  const appsSection = document.createElement("section");
  appsSection.className = "rail rail--apps";
  appsSection.dataset.railId = "apps";

  const appsHeading = document.createElement("h2");
  appsHeading.className = "rail-title";
  appsHeading.textContent = "Apps";
  appsSection.appendChild(appsHeading);

  const appsTrack = document.createElement("div");
  appsTrack.className = "rail-track rail-track--apps";
  appsTrack.setAttribute("role", "list");

  const appItems: HTMLElement[] = [];
  for (const app of DEFAULT_APP_CARDS) {
  const button = createAppCard(app, callbacks);
    appsTrack.appendChild(button);
    appItems.push(button);
  }

  appsSection.appendChild(appsTrack);
  container.appendChild(appsSection);
  rows.push(appItems);

  return rows;
}

function appendCatalogSections(
  container: HTMLElement,
  callbacks: HomeCallbacks,
  catalogState: CatalogState,
  options: HomeOptions,
): HTMLElement[][] {
  if (catalogState.status === "loading") {
    container.appendChild(createCatalogMessage("catalog", "loading", "loading catalog…", "posters will appear here when the Pi responds."));
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
    heading.textContent = rail.label;
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
      const button = createPosterCard(card, rail, callbacks, options.pinnedKeys);
      track.appendChild(button);
      items.push(button);
    }
    applyRailLayout(track);
    section.appendChild(track);
    container.appendChild(section);
    rows.push(items);
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
  heading.textContent = headingText;

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

function createPosterCard(
  card: ContentCard,
  rail: ContentRail,
  callbacks: HomeCallbacks,
  pinnedKeys: Set<string> = new Set(),
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card card--poster";
  button.dataset.focusKey = `rail:${rail.id}:${card.type}:${card.id}`;
  if (pinnedKeys.has(`${card.type}:${card.id}`)) {
    button.classList.add("card--pinned");
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

  const shade = document.createElement("span");
  shade.className = "poster-shade";
  shade.setAttribute("aria-hidden", "true");

  const content = document.createElement("span");
  content.className = "poster-content";

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = card.title;

  const subtitle = document.createElement("span");
  subtitle.className = "card-subtitle";
  subtitle.textContent = card.subtitle;

  content.append(title, subtitle);
  button.append(poster, shade, content);
  if (card.progressPct !== undefined && card.progressPct > 0) {
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
  button.addEventListener("click", () => callbacks.onAppSelect(app));
  return button;
}
