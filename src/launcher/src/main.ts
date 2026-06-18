import "./style.css";
import { FocusGrid } from "./focus";
import { loadCatalogRails } from "./catalog";
import { DetailController } from "./detail";
import { buildHomeRails, type CatalogState, type HomeOptions } from "./home";
import { startVoiceHud } from "./voice-hud";
import type { ApiInfo, AppCard, ContentCard, LaunchAction } from "./types";

const homeView = mustGet<HTMLElement>("home-view");
const railsEl = mustGet<HTMLElement>("rails");
const detailView = mustGet<HTMLElement>("detail-view");
const detailPoster = mustGet<HTMLImageElement>("detail-poster");
const detailEyebrow = mustGet<HTMLElement>("detail-eyebrow");
const detailTitle = mustGet<HTMLElement>("detail-title");
const detailMeta = mustGet<HTMLElement>("detail-meta");
const detailDescription = mustGet<HTMLElement>("detail-description");
const detailPlay = mustGet<HTMLButtonElement>("detail-play");
const detailBack = mustGet<HTMLButtonElement>("detail-back");
const settingsView = mustGet<HTMLElement>("settings-view");
const statusEl = mustGet<HTMLElement>("status");
const backButton = mustGet<HTMLButtonElement>("back-button");

let inSettings = false;
let launchInFlight = false;
let homeOptions: HomeOptions = { fallbackStremio: false, legacyYoutube: false };
let catalogState: CatalogState = { status: "loading" };

const focusGrid = new FocusGrid((element) => {
  element.classList.add("focused");
  for (const row of focusGridRows) {
    for (const item of row) {
      if (item !== element) {
        item.classList.remove("focused");
      }
    }
  }
});

let focusGridRows: HTMLElement[][] = [];

const detail = new DetailController(
  detailView,
  detailPoster,
  detailEyebrow,
  detailTitle,
  detailMeta,
  detailDescription,
  detailPlay,
  detailBack,
  {
    onClose: restoreHomeFromDetail,
    onStatus: setStatus,
  },
);

init();

function init(): void {
  renderHome();

  backButton.addEventListener("click", showHome);
  document.addEventListener("keydown", handleKeydown);
  void loadInfo();
  void loadCatalog();
  startVoiceHud();
}

function renderHome(): void {
  focusGridRows = buildHomeRails(railsEl, {
    onContentSelect: handleContentSelect,
    onAppSelect: handleAppSelect,
  }, homeOptions, catalogState);
  focusGrid.setRows(focusGridRows);
}

function handleKeydown(event: KeyboardEvent): void {
  if (detail.isOpen) {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      detail.hide();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      detail.moveFocus(1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      detail.moveFocus(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      detail.activate();
      return;
    }
  }

  if (inSettings) {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      showHome();
    }
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    focusGrid.moveCol(1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    focusGrid.moveCol(-1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusGrid.moveRow(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusGrid.moveRow(-1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateFocused();
  }
}

function activateFocused(): void {
  const focused = focusGrid.focused;
  if (focused === null) {
    return;
  }
  focused.click();
}

function handleContentSelect(card: ContentCard, railLabel: string): void {
  inSettings = false;
  homeView.classList.add("hidden");
  settingsView.classList.add("hidden");
  detail.show(card, railLabel);
}

function handleAppSelect(app: AppCard): void {
  if (app.action === "settings") {
    showSettings();
    return;
  }
  void launch(app.action);
}

async function launch(action: LaunchAction): Promise<void> {
  if (launchInFlight) {
    return;
  }
  launchInFlight = true;
  const label = action === "kodi" ? "YouTube" : "Stremio";
  setStatus(`Opening ${label}…`);
  try {
    const response = await fetch(`/api/launch/${action}`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setStatus(`${label} is starting. ⌂ button returns home.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Could not launch ${label}: ${message}`);
  } finally {
    launchInFlight = false;
  }
}

function showSettings(): void {
  inSettings = true;
  detailView.classList.add("hidden");
  homeView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  backButton.focus({ preventScroll: true });
}

function showHome(): void {
  if (detail.isOpen) {
    detail.hide();
    return;
  }
  inSettings = false;
  settingsView.classList.add("hidden");
  detailView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. B to select. ⌂ for home.");
}

function restoreHomeFromDetail(): void {
  inSettings = false;
  settingsView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. B to select. ⌂ for home.");
}

async function loadCatalog(): Promise<void> {
  catalogState = { status: "loading" };
  renderHome();
  try {
    const rails = await loadCatalogRails();
    catalogState = { status: "ready", rails };
    renderHome();
    const itemCount = rails.reduce((total, rail) => total + rail.cards.length, 0);
    setStatus(itemCount > 0 ? "D-pad to browse. B to select. ⌂ for home." : "catalog loaded with no posters");
  } catch (error) {
    catalogState = {
      status: "error",
      message: error instanceof Error ? error.message : "catalog unavailable",
    };
    renderHome();
    setStatus("catalog unavailable. settings still work.");
  }
}

async function loadInfo(): Promise<void> {
  try {
    const response = await fetch("/api/info");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const info = (await response.json()) as ApiInfo;
    setText("hostname", info.hostname);
    setText("ip-address", info.ip);
    setText("launcher-url", `http://${info.ip}:${info.launcher_port}`);
    setText("companion-url", `https://${info.ip}:${info.companion_port}`);
    const nextOptions = {
      fallbackStremio: Boolean(info.fallback_stremio),
      legacyYoutube: Boolean(info.legacy_youtube),
    };
    if (
      nextOptions.fallbackStremio !== homeOptions.fallbackStremio ||
      nextOptions.legacyYoutube !== homeOptions.legacyYoutube
    ) {
      homeOptions = nextOptions;
      renderHome();
    }
  } catch {
    setText("hostname", "mango");
    setText("ip-address", "10.0.0.174");
    setText("launcher-url", "http://10.0.0.174:3000");
    setText("companion-url", "https://10.0.0.174:3001");
  }
}

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function setText(id: string, value: string): void {
  mustGet<HTMLElement>(id).textContent = value;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}
