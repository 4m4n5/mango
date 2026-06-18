import type { AppCard, ContentCard } from "./types";

export interface HomeCallbacks {
  onContentSelect: (card: ContentCard, railLabel: string) => void;
  onAppSelect: (card: AppCard) => void;
}

export interface HomeOptions {
  fallbackStremio: boolean;
  legacyYoutube: boolean;
}

const DEFAULT_APP_CARDS: AppCard[] = [
  { id: "settings", action: "settings", kicker: "System", title: "Settings" },
];

export function buildHomeRails(
  container: HTMLElement,
  callbacks: HomeCallbacks,
  options: HomeOptions = { fallbackStremio: false, legacyYoutube: false },
): HTMLElement[][] {
  container.replaceChildren();

  const rows: HTMLElement[][] = [];

  container.appendChild(createCatalogEmptyState());

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

  const fallbackCards = buildFallbackCards(options);
  if (fallbackCards.length > 0) {
    const fallbackSection = document.createElement("section");
    fallbackSection.className = "rail rail--advanced";
    fallbackSection.dataset.railId = "advanced";

    const fallbackHeading = document.createElement("h2");
    fallbackHeading.className = "rail-title";
    fallbackHeading.textContent = "Advanced fallback";
    fallbackSection.appendChild(fallbackHeading);

    const fallbackTrack = document.createElement("div");
    fallbackTrack.className = "rail-track rail-track--apps";
    fallbackTrack.setAttribute("role", "list");

    const fallbackItems: HTMLElement[] = [];
    for (const app of fallbackCards) {
      const button = createAppCard(app, callbacks);
      fallbackTrack.appendChild(button);
      fallbackItems.push(button);
    }
    fallbackSection.appendChild(fallbackTrack);
    container.appendChild(fallbackSection);
    rows.push(fallbackItems);
  }

  return rows;
}

function createCatalogEmptyState(): HTMLElement {
  const section = document.createElement("section");
  section.className = "rail rail--empty";
  section.dataset.railId = "catalog";

  const heading = document.createElement("h2");
  heading.className = "rail-title";
  heading.textContent = "Catalog";

  const panel = document.createElement("div");
  panel.className = "empty-state";

  const title = document.createElement("p");
  title.className = "empty-state-title";
  title.textContent = "browse rails ship in N2";

  const body = document.createElement("p");
  body.className = "empty-state-body";
  body.textContent =
    "Catalog service is live on the Pi — play works via API until browse UI lands. Voice and settings stay available.";

  panel.append(title, body);
  section.append(heading, panel);
  return section;
}

function createAppCard(app: AppCard, callbacks: HomeCallbacks): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card card--app";
  button.dataset.action = app.action;
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

function buildFallbackCards(options: HomeOptions): AppCard[] {
  const cards: AppCard[] = [];
  if (options.fallbackStremio) {
    cards.push({
      id: "fallback-stremio",
      action: "stremio",
      kicker: "Fallback only",
      title: "Stremio",
    });
  }
  if (options.legacyYoutube) {
    cards.push({
      id: "legacy-youtube",
      action: "kodi",
      kicker: "Legacy only",
      title: "YouTube",
    });
  }
  return cards;
}
