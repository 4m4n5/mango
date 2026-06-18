import { MOCK_RAILS } from "./mock-catalog";
import type { AppCard, ContentCard } from "./types";

export interface HomeCallbacks {
  onContentSelect: (card: ContentCard, railLabel: string) => void;
  onAppSelect: (card: AppCard) => void;
}

const APP_CARDS: AppCard[] = [
  { id: "stremio", action: "stremio", kicker: "Movies and shows", title: "Stremio" },
  { id: "kodi", action: "kodi", kicker: "Kodi add-on", title: "YouTube" },
  { id: "settings", action: "settings", kicker: "System", title: "Settings" },
];

export function buildHomeRails(container: HTMLElement, callbacks: HomeCallbacks): HTMLElement[][] {
  container.replaceChildren();

  const rows: HTMLElement[][] = [];

  for (const rail of MOCK_RAILS) {
    const section = document.createElement("section");
    section.className = "rail";
    section.dataset.railId = rail.id;

    const heading = document.createElement("h2");
    heading.className = "rail-title";
    heading.textContent = rail.label;
    section.appendChild(heading);

    const track = document.createElement("div");
    track.className = "rail-track";
    track.setAttribute("role", "list");

    const rowItems: HTMLElement[] = [];
    for (const card of rail.cards) {
      const button = createContentCard(card, rail.label, callbacks);
      track.appendChild(button);
      rowItems.push(button);
    }

    section.appendChild(track);
    container.appendChild(section);
    rows.push(rowItems);
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
  for (const app of APP_CARDS) {
    const button = createAppCard(app, callbacks);
    appsTrack.appendChild(button);
    appItems.push(button);
  }

  appsSection.appendChild(appsTrack);
  container.appendChild(appsSection);
  rows.push(appItems);

  return rows;
}

function createContentCard(
  card: ContentCard,
  railLabel: string,
  callbacks: HomeCallbacks,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card card--poster";
  button.dataset.cardId = card.id;
  button.style.setProperty("--card-accent", card.accent);
  button.setAttribute("role", "listitem");
  button.setAttribute("aria-label", `${card.title}. ${card.subtitle}`);

  const title = document.createElement("span");
  title.className = "card-title";
  title.textContent = card.title;

  const subtitle = document.createElement("span");
  subtitle.className = "card-subtitle";
  subtitle.textContent = card.subtitle;

  button.append(title, subtitle);
  button.addEventListener("click", () => callbacks.onContentSelect(card, railLabel));
  return button;
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
