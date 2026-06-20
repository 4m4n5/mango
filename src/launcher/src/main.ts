import "./style.css";
import { FocusGrid } from "./focus";
import { loadCatalogRails } from "./catalog";
import { DetailController } from "./detail";
import { buildHomeRails, buildBrowseTabs, type CatalogState, type HomeOptions } from "./home";
import { buildSettingsRefresh, settingsFocusables } from "./settings";
import { startVoiceHud } from "./voice-hud";
import type { ApiInfo, AppCard, ContentCard, LaunchAction, BrowseTab } from "./types";

const homeView = mustGet<HTMLElement>("home-view");
const browseTabsEl = mustGet<HTMLElement>("browse-tabs");
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
const settingsRefreshEl = mustGet<HTMLElement>("settings-refresh");
const statusEl = mustGet<HTMLElement>("status");
const backButton = mustGet<HTMLButtonElement>("back-button");

let inSettings = false;
let settingsFocusIndex = 0;
let launchInFlight = false;
let homeOptions: HomeOptions = { fallbackStremio: false, legacyYoutube: false };
let activeBrowseTab: BrowseTab = "movies";
let catalogState: CatalogState = { status: "loading" };
let catalogRetryTimer: number | undefined;

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
  const tabButtons = buildBrowseTabs(browseTabsEl, activeBrowseTab, handleBrowseTabChange);
  focusGridRows = [
    tabButtons,
    ...buildHomeRails(railsEl, {
      onContentSelect: handleContentSelect,
      onAppSelect: handleAppSelect,
    }, {
      ...homeOptions,
      browseTab: activeBrowseTab,
      onBrowseTabChange: handleBrowseTabChange,
    }, catalogState),
  ];
  focusGrid.setRows(focusGridRows);
}

function handleBrowseTabChange(tab: BrowseTab): void {
  if (tab === activeBrowseTab) {
    return;
  }
  activeBrowseTab = tab;
  void loadCatalog();
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
      return;
    }
    const items = settingsFocusables(settingsView);
    if (items.length === 0) {
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusSettingsItem(items, settingsFocusIndex + 1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusSettingsItem(items, settingsFocusIndex - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      items[settingsFocusIndex]?.click();
    }
    return;
  }

  if (event.key === "F5" && !detail.isOpen && !homeView.classList.contains("hidden")) {
    event.preventDefault();
    void loadCatalog({ reshuffle: true });
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
  backButton.dataset.settingsFocus = "true";
  buildSettingsRefresh(settingsRefreshEl, setStatus);
  const items = settingsFocusables(settingsView);
  focusSettingsItem(items, 0);
}

function focusSettingsItem(items: HTMLElement[], index: number): void {
  if (items.length === 0) {
    return;
  }
  const wrapped = ((index % items.length) + items.length) % items.length;
  settingsFocusIndex = wrapped;
  for (const item of items) {
    item.classList.remove("focused");
  }
  const target = items[wrapped];
  target.classList.add("focused");
  target.focus({ preventScroll: true });
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
  setStatus("D-pad to browse. B to select. ⌂ on home shuffles rails.");
}

function restoreHomeFromDetail(): void {
  inSettings = false;
  settingsView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. B to select. ⌂ on home shuffles rails.");
}

async function loadCatalog(options: { reshuffle?: boolean } = {}): Promise<void> {
  if (catalogRetryTimer !== undefined) {
    window.clearTimeout(catalogRetryTimer);
    catalogRetryTimer = undefined;
  }
  if (options.reshuffle) {
    setStatus("shuffling home rails…");
  }
  catalogState = { status: "loading" };
  renderHome();
  try {
    const rails = await loadCatalogRails(activeBrowseTab, { reshuffle: options.reshuffle });
    catalogState = { status: "ready", rails };
    renderHome();
    const itemCount = rails.reduce((total, rail) => total + rail.cards.length, 0);
    setStatus(itemCount > 0
      ? options.reshuffle
        ? "home rails shuffled. D-pad to browse."
        : "D-pad to browse. B to select. ⌂ on home shuffles rails."
      : "catalog loaded with no posters");
  } catch (error) {
    catalogState = {
      status: "error",
      message: error instanceof Error ? error.message : "catalog unavailable",
    };
    renderHome();
    setStatus("catalog is refreshing — try again in a moment.");
    catalogRetryTimer = window.setTimeout(() => {
      void loadCatalog();
    }, 5000);
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
