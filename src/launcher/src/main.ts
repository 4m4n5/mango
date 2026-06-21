import "./style.css";
import { FocusGrid } from "./focus";
import { loadCatalogRails, stopPlaybackForVoice } from "./catalog";
import { DetailController } from "./detail";
import { NextEpisodePrompt } from "./next-prompt";
import { buildHomeRails, buildBrowseTabs, BROWSE_TAB_ORDER, type CatalogState, type HomeOptions } from "./home";
import { buildSettingsRefresh, settingsFocusables } from "./settings";
import { startVoiceHud } from "./voice-hud";
import { resolveVoiceWsUrls, startVoiceCommands } from "./voice-commands";
import { fetchPinnedIds } from "./pins";
import type { ApiInfo, AppCard, ContentCard, ContentRail, LaunchAction, BrowseTab } from "./types";

const homeView = mustGet<HTMLElement>("home-view");
const browseTabsEl = mustGet<HTMLElement>("browse-tabs");
const railsEl = mustGet<HTMLElement>("rails");
const libraryRefreshBtn = mustGet<HTMLButtonElement>("library-refresh");
const detailView = mustGet<HTMLElement>("detail-view");
const detailPoster = mustGet<HTMLImageElement>("detail-poster");
const detailEyebrow = mustGet<HTMLElement>("detail-eyebrow");
const detailTitle = mustGet<HTMLElement>("detail-title");
const detailMeta = mustGet<HTMLElement>("detail-meta");
const detailDescription = mustGet<HTMLElement>("detail-description");
const detailPlay = mustGet<HTMLButtonElement>("detail-play");
const detailPin = mustGet<HTMLButtonElement>("detail-pin");
const detailBack = mustGet<HTMLButtonElement>("detail-back");
const detailStreams = mustGet<HTMLElement>("detail-streams");
const detailStreamList = mustGet<HTMLElement>("detail-stream-list");
const detailEpisodes = mustGet<HTMLElement>("detail-episodes");
const detailEpisodeList = mustGet<HTMLElement>("detail-episode-list");
const nextPromptView = mustGet<HTMLElement>("next-episode-prompt");
const nextPromptTitle = mustGet<HTMLElement>("next-prompt-title");
const nextPromptMeta = mustGet<HTMLElement>("next-prompt-meta");
const nextPromptPlay = mustGet<HTMLButtonElement>("next-prompt-play");
const nextPromptDismiss = mustGet<HTMLButtonElement>("next-prompt-dismiss");
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
let libraryRefreshInFlight = false;
let pinnedKeys = new Set<string>();
const tabCatalogCache = new Map<BrowseTab, ContentRail[]>();
const tabCatalogPrefetching = new Set<BrowseTab>();
let liveCatalogSessionCached = false;

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
let focusBrowseTabOnRender = false;

let nextPromptFocusIndex = 0;

const nextEpisodePrompt = new NextEpisodePrompt(
  nextPromptView,
  nextPromptTitle,
  nextPromptMeta,
  nextPromptPlay,
  nextPromptDismiss,
  setStatus,
  () => {
    nextPromptFocusIndex = 0;
    setStatus("B to play. Y to go back.");
  },
);

const detail = new DetailController(
  detailView,
  detailPoster,
  detailEyebrow,
  detailTitle,
  detailMeta,
  detailDescription,
  detailPlay,
  detailPin,
  detailBack,
  detailStreams,
  detailStreamList,
  detailEpisodes,
  detailEpisodeList,
  {
    onClose: restoreHomeFromDetail,
    onStatus: setStatus,
    onPinsChanged: () => void reloadPinsAndCatalog(),
    onNextEpisodePrompt: (hint, card) => {
      nextEpisodePrompt.show(hint, card);
      nextPromptFocusIndex = 0;
      nextEpisodePrompt.applyFocus(nextPromptFocusIndex);
    },
  },
);

init();

function init(): void {
  renderHome();

  backButton.addEventListener("click", showHome);
  libraryRefreshBtn.addEventListener("click", () => void libraryRefresh());
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("mango:library-refresh", () => void libraryRefresh({ quiet: true }));
  void loadInfo();
  void loadCatalog();
  startVoiceHud();
  startVoiceCommands(resolveVoiceWsUrls(), {
    onHome: showHome,
    onBack: () => {
      if (detail.isOpen) {
        detail.hide();
        return;
      }
      if (inSettings) {
        showHome();
      }
    },
    onSettings: showSettings,
    onTab: (tab) => {
      if (detail.isOpen) {
        detail.hide();
      }
      if (inSettings) {
        inSettings = false;
        settingsView.classList.add("hidden");
        homeView.classList.remove("hidden");
      }
      focusBrowseTabOnRender = true;
      handleBrowseTabChange(tab);
    },
    onOpenDetail: (card, tab) => openVoiceDetail(card, tab),
  });
}

function renderHome(): void {
  const tabButtons = buildBrowseTabs(browseTabsEl, activeBrowseTab, handleBrowseTabChange);
  const showShuffle = activeBrowseTab !== "live";
  libraryRefreshBtn.hidden = !showShuffle;
  const browseChrome = showShuffle ? [...tabButtons, libraryRefreshBtn] : tabButtons;
  focusGridRows = [
    browseChrome,
    ...buildHomeRails(railsEl, {
      onContentSelect: handleContentSelect,
      onAppSelect: handleAppSelect,
    }, {
      ...homeOptions,
      browseTab: activeBrowseTab,
      onBrowseTabChange: handleBrowseTabChange,
      pinnedKeys,
    }, catalogState),
  ];
  focusGrid.setRows(focusGridRows);
  if (focusBrowseTabOnRender) {
    focusBrowseTabOnRender = false;
    const tabIndex = BROWSE_TAB_ORDER.indexOf(activeBrowseTab);
    if (tabIndex >= 0) {
      focusGrid.setPosition(0, tabIndex);
    }
  }
}

function handleBrowseTabChange(tab: BrowseTab): void {
  if (tab === activeBrowseTab) {
    return;
  }
  activeBrowseTab = tab;
  void loadCatalog();
}

function cycleBrowseTab(delta: number): void {
  if (detail.isOpen || inSettings || homeView.classList.contains("hidden")) {
    return;
  }
  const index = BROWSE_TAB_ORDER.indexOf(activeBrowseTab);
  if (index < 0) {
    return;
  }
  const next = BROWSE_TAB_ORDER[
    (index + delta + BROWSE_TAB_ORDER.length) % BROWSE_TAB_ORDER.length
  ];
  focusBrowseTabOnRender = true;
  handleBrowseTabChange(next);
}

function handleKeydown(event: KeyboardEvent): void {
  if (nextEpisodePrompt.isOpen) {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      nextEpisodePrompt.dismiss();
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      nextPromptFocusIndex = nextEpisodePrompt.moveFocus(1, nextPromptFocusIndex);
      nextEpisodePrompt.applyFocus(nextPromptFocusIndex);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      nextPromptFocusIndex = nextEpisodePrompt.moveFocus(-1, nextPromptFocusIndex);
      nextEpisodePrompt.applyFocus(nextPromptFocusIndex);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      nextEpisodePrompt.activateFocused(nextPromptFocusIndex);
      return;
    }
  }

  if (detail.isOpen) {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      if (detail.isResolving()) {
        detail.cancelResolve();
        return;
      }
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
    void libraryRefresh();
    return;
  }

  if (
    (event.key === "F6" || event.key === "F7")
    && !detail.isOpen
    && !inSettings
    && !homeView.classList.contains("hidden")
  ) {
    event.preventDefault();
    cycleBrowseTab(event.key === "F7" ? 1 : -1);
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

function handleContentSelect(card: ContentCard, railLabel: string, tab?: BrowseTab): void {
  inSettings = false;
  nextEpisodePrompt.dismiss();
  homeView.classList.add("hidden");
  settingsView.classList.add("hidden");
  const browseTab = tab ?? activeBrowseTab;
  detail.show(card, railLabel, browseTab, pinnedKeys.has(`${card.type}:${card.id}`));
}

function openVoiceDetail(card: ContentCard, tab: BrowseTab): Promise<void> {
  return (async () => {
    nextEpisodePrompt.dismiss();
    await stopPlaybackForVoice();
    inSettings = false;
    settingsView.classList.add("hidden");
    homeView.classList.add("hidden");
    activeBrowseTab = tab;
    setStatus(`Opening ${card.title}…`);
    detail.show(card, "voice", tab, pinnedKeys.has(`${card.type}:${card.id}`));
  })();
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
  target.focus();
  target.scrollIntoView({ block: "nearest", behavior: "instant" });
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
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.");
}

function restoreHomeFromDetail(): void {
  inSettings = false;
  settingsView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.");
}

async function reloadPinsAndCatalog(): Promise<void> {
  try {
    pinnedKeys = await fetchPinnedIds(activeBrowseTab);
  } catch {
    pinnedKeys = new Set();
  }
  await loadCatalog();
}

async function libraryRefresh(options: { quiet?: boolean } = {}): Promise<void> {
  if (libraryRefreshInFlight || detail.isOpen || inSettings) {
    return;
  }
  if (activeBrowseTab === "live") {
    if (!options.quiet) {
      setStatus("live channels stay fixed — shuffle movies & tv shows only.");
    }
    return;
  }
  libraryRefreshInFlight = true;
  libraryRefreshBtn.classList.add("browse-shuffle--active");
  railsEl.classList.remove("rails--refresh-settled");
  railsEl.classList.add("rails--refreshing");
  if (!options.quiet) {
    setStatus("refreshing…");
  }
  try {
    await loadCatalog({ reshuffle: true });
    if (!options.quiet) {
      setStatus("updated — keep browsing");
    }
  } finally {
    libraryRefreshInFlight = false;
    libraryRefreshBtn.classList.remove("browse-shuffle--active");
    railsEl.classList.remove("rails--refreshing");
    railsEl.classList.add("rails--refresh-settled");
    window.setTimeout(() => railsEl.classList.remove("rails--refresh-settled"), 320);
  }
}

async function loadCatalog(options: { reshuffle?: boolean } = {}): Promise<void> {
  if (catalogRetryTimer !== undefined) {
    window.clearTimeout(catalogRetryTimer);
    catalogRetryTimer = undefined;
  }
  const reshuffle = Boolean(options.reshuffle && activeBrowseTab !== "live");
  if (reshuffle) {
    tabCatalogCache.delete(activeBrowseTab);
    setStatus("refreshing…");
  }

  if (activeBrowseTab === "live" && liveCatalogSessionCached) {
    const frozen = tabCatalogCache.get("live");
    if (frozen && frozen.length > 0) {
      pinnedKeys = await fetchPinnedIds("live").catch(() => new Set<string>());
      catalogState = { status: "ready", rails: frozen };
      renderHome();
      return;
    }
  }

  const cachedRails = !reshuffle ? tabCatalogCache.get(activeBrowseTab) : undefined;
  if (cachedRails && cachedRails.length > 0) {
    catalogState = { status: "ready", rails: cachedRails };
    renderHome();
  } else if (!reshuffle || catalogState.status !== "ready") {
    catalogState = { status: "loading" };
    renderHome();
  }

  try {
    const [rails, pins] = await Promise.all([
      loadCatalogRails(activeBrowseTab, { reshuffle }),
      fetchPinnedIds(activeBrowseTab).catch(() => new Set<string>()),
    ]);
    pinnedKeys = pins;
    tabCatalogCache.set(activeBrowseTab, rails);
    if (activeBrowseTab === "live") {
      liveCatalogSessionCached = true;
    }
    catalogState = { status: "ready", rails };
    renderHome();
    const itemCount = rails.reduce((total, rail) => total + rail.cards.length, 0);
    setStatus(itemCount > 0
      ? options.reshuffle
        ? "updated — keep browsing."
        : "D-pad to browse. L/R shoulders switch tabs. B to select."
      : "catalog loaded with no posters");
    if (!reshuffle) {
      for (const tab of BROWSE_TAB_ORDER) {
        if (tab !== activeBrowseTab && tab !== "live") {
          prefetchCatalogTab(tab);
        }
      }
    }
  } catch (error) {
    if (!cachedRails?.length) {
      catalogState = {
        status: "error",
        message: error instanceof Error ? error.message : "catalog unavailable",
      };
      renderHome();
    }
    setStatus(catalogRetryStatus(error, reshuffle));
    catalogRetryTimer = window.setTimeout(() => {
      void loadCatalog();
    }, 5000);
  }
}

function catalogRetryStatus(error: unknown, reshuffle: boolean): string {
  const message = error instanceof Error ? error.message : "catalog unavailable";
  const lower = message.toLowerCase();
  if (lower.includes("temporarily unavailable") || lower.includes("catalog unavailable")) {
    return "catalog temporarily unavailable — retrying…";
  }
  if (lower.includes("rate limit") || lower.includes("busy")) {
    return "catalog is busy — try again in a moment.";
  }
  if (reshuffle) {
    return "refreshing…";
  }
  return "catalog is reconnecting…";
}

function prefetchCatalogTab(tab: BrowseTab): void {
  if (tab === "live" || tab === activeBrowseTab || tabCatalogCache.has(tab) || tabCatalogPrefetching.has(tab)) {
    return;
  }
  tabCatalogPrefetching.add(tab);
  void loadCatalogRails(tab)
    .then((rails) => {
      tabCatalogCache.set(tab, rails);
    })
    .catch(() => undefined)
    .finally(() => {
      tabCatalogPrefetching.delete(tab);
    });
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
