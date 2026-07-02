import "./style.css";
import { FocusGrid } from "./focus";
import { loadCatalogRails, stopPlaybackForVoice } from "./catalog";
import { DetailController } from "./detail";
import { NextEpisodePrompt } from "./next-prompt";
import { buildHomeRails, buildBrowseTabs, BROWSE_TAB_ORDER, type CatalogState, type HomeOptions } from "./home";
import { buildSettingsRefresh, reliabilityBadgeText, settingsFocusables } from "./settings";
import { fetchReliabilityState } from "./reliability";
import { startVoiceHud } from "./voice-hud";
import { resolveVoiceWsUrls, startVoiceCommands } from "./voice-commands";
import { cardSavedKey, fetchSavedIds } from "./saved";
import { logPerf } from "./perf";
import { touchCouchActivity } from "./activity";
import type { ApiInfo, AppCard, ContentCard, ContentRail, BrowseTab } from "./types";

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
const detailSave = mustGet<HTMLButtonElement>("detail-save");
const detailNotInterested = mustGet<HTMLButtonElement>("detail-not-interested");
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
let homeOptions: HomeOptions = {};
let activeBrowseTab: BrowseTab = "movies";
let catalogState: CatalogState = { status: "loading" };
let catalogRetryTimer: number | undefined;
let libraryRefreshInFlight = false;
let savedKeys = new Set<string>();
const tabCatalogCache = new Map<BrowseTab, ContentRail[]>();
const tabCatalogPrefetching = new Set<BrowseTab>();
let liveCatalogSessionCached = false;
let catalogRequestSeq = 0;
let livePrefetchStarted = false;
let youtubeCatalogDirty = false;
const tabFocusKeys = new Map<BrowseTab, string>();
const tabFocusPositions = new Map<BrowseTab, { row: number; col: number }>();

const focusGrid = new FocusGrid((element) => {
  const started = performance.now();
  element.classList.add("focused");
  for (const row of focusGridRows) {
    for (const item of row) {
      if (item !== element) {
        item.classList.remove("focused");
      }
    }
  }
  if (!detail.isOpen && !inSettings && !homeView.classList.contains("hidden")) {
    const key = element.dataset.focusKey;
    if (key) {
      tabFocusKeys.set(activeBrowseTab, key);
    }
    tabFocusPositions.set(activeBrowseTab, focusGrid.position);
  }
  logPerf("focus", {
    tab: activeBrowseTab,
    key: element.dataset.focusKey,
    row: focusGrid.position.row,
    col: focusGrid.position.col,
    duration_ms: Math.round(performance.now() - started),
  });
});

let focusGridRows: HTMLElement[][] = [];
let focusBrowseTabOnRender = false;
let reliabilityBadgeTimer: number | undefined;

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
  detailSave,
  detailNotInterested,
  detailBack,
  detailStreams,
  detailStreamList,
  detailEpisodes,
  detailEpisodeList,
  {
    onClose: restoreHomeFromDetail,
    onStatus: setStatus,
    onSavedChanged: () => void reloadSavedAndCatalog(),
    onPlayed: (card) => {
      if (card.source === "youtube" || card.type.startsWith("youtube_")) {
        tabCatalogCache.delete("youtube");
        youtubeCatalogDirty = true;
      }
    },
    onNextEpisodePrompt: (hint, card) => {
      nextEpisodePrompt.show(hint, card);
      nextPromptFocusIndex = 0;
      nextEpisodePrompt.applyFocus(nextPromptFocusIndex);
    },
  },
);

init();

function init(): void {
  libraryRefreshBtn.dataset.focusKey = "browse:shuffle";
  renderHome();

  backButton.addEventListener("click", showHome);
  libraryRefreshBtn.addEventListener("click", () => void libraryRefresh());
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", () => touchCouchActivity("launcher", "click"), { capture: true });
  window.addEventListener("mango:library-refresh", () => void libraryRefresh({ quiet: true }));
  void loadInfo();
  void loadCatalog();
  window.requestAnimationFrame(() => {
    window.setTimeout(() => prefetchCatalogTab("live", { allowLive: true }), 750);
  });
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
  const started = performance.now();
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
      savedKeys,
    }, catalogState),
  ];
  focusGrid.setRows(focusGridRows, {
    preferredKey: tabFocusKeys.get(activeBrowseTab),
    fallbackPosition: tabFocusPositions.get(activeBrowseTab),
  });
  if (focusBrowseTabOnRender) {
    focusBrowseTabOnRender = false;
    const tabIndex = BROWSE_TAB_ORDER.indexOf(activeBrowseTab);
    if (tabIndex >= 0) {
      focusGrid.setPosition(0, tabIndex);
    }
  }
  logPerf("render_home", {
    tab: activeBrowseTab,
    rows: focusGridRows.length,
    state: catalogState.status,
    duration_ms: Math.round(performance.now() - started),
  });
  scheduleReliabilityBadge();
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
  touchCouchActivity("launcher", `key:${event.key}`);
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
  detail.show(card, railLabel, browseTab, savedKeys.has(cardSavedKey(card)));
}

function openVoiceDetail(card: ContentCard, tab: BrowseTab): Promise<void> {
  return (async () => {
    nextEpisodePrompt.dismiss();
    if (detail.isOpen) {
      detail.hide();
    }
    await stopPlaybackForVoice();
    inSettings = false;
    settingsView.classList.add("hidden");
    homeView.classList.add("hidden");
    activeBrowseTab = tab;
    setStatus(`Opening ${card.title}…`);
    detail.show(card, "voice", tab, savedKeys.has(cardSavedKey(card)));
  })();
}

function handleAppSelect(app: AppCard): void {
  if (app.action === "settings") {
    showSettings();
  }
}

function showSettings(): void {
  inSettings = true;
  detailView.classList.add("hidden");
  homeView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  backButton.dataset.settingsFocus = "true";
  const items = settingsFocusables(settingsView);
  focusSettingsItem(items, 0);
  void buildSettingsRefresh(settingsRefreshEl, setStatus).finally(() => {
    const refreshed = settingsFocusables(settingsView);
    focusSettingsItem(refreshed, Math.min(settingsFocusIndex, Math.max(0, refreshed.length - 1)));
    scheduleReliabilityBadge();
  });
}

function scheduleReliabilityBadge(): void {
  if (reliabilityBadgeTimer !== undefined) {
    return;
  }
  reliabilityBadgeTimer = window.setTimeout(() => {
    reliabilityBadgeTimer = undefined;
    void refreshReliabilityBadge();
  }, 500);
}

async function refreshReliabilityBadge(): Promise<void> {
  const badge = document.querySelector<HTMLElement>("[data-settings-health]");
  if (!badge) {
    return;
  }
  try {
    const state = await fetchReliabilityState();
    const text = reliabilityBadgeText(state.status);
    badge.textContent = text;
    badge.classList.toggle("hidden", text.length === 0);
    badge.dataset.status = state.status;
  } catch {
    badge.classList.add("hidden");
    badge.textContent = "";
  }
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
  if (youtubeCatalogDirty && activeBrowseTab === "youtube") {
    youtubeCatalogDirty = false;
    void loadCatalog();
  }
}

async function reloadSavedAndCatalog(): Promise<void> {
  try {
    savedKeys = await fetchSavedIds(activeBrowseTab);
  } catch {
    savedKeys = new Set();
  }
  tabCatalogCache.delete(activeBrowseTab);
  if (activeBrowseTab === "live" || activeBrowseTab === "youtube") {
    liveCatalogSessionCached = false;
  }
  await loadCatalog();
}

async function libraryRefresh(options: { quiet?: boolean } = {}): Promise<void> {
  if (libraryRefreshInFlight || detail.isOpen || inSettings) {
    return;
  }
  if (activeBrowseTab === "live") {
    if (!options.quiet) {
      setStatus("this tab refreshes from its own source.");
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
  const requestSeq = ++catalogRequestSeq;
  const requestedTab = activeBrowseTab;
  const started = performance.now();
  if (catalogRetryTimer !== undefined) {
    window.clearTimeout(catalogRetryTimer);
    catalogRetryTimer = undefined;
  }
  const reshuffle = Boolean(options.reshuffle && requestedTab !== "live");
  if (reshuffle) {
    tabCatalogCache.delete(requestedTab);
    setStatus("refreshing…");
  }

  if (requestedTab === "live" && liveCatalogSessionCached) {
    const frozen = tabCatalogCache.get("live");
    if (frozen && frozen.length > 0) {
      savedKeys = await fetchSavedIds("live").catch(() => new Set<string>());
      if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) {
        return;
      }
      catalogState = { status: "ready", rails: frozen };
      renderHome();
      return;
    }
  }

  const cachedRails = !reshuffle ? tabCatalogCache.get(requestedTab) : undefined;
  if (cachedRails && cachedRails.length > 0) {
    catalogState = { status: "ready", rails: cachedRails };
    renderHome();
  } else if (!reshuffle || catalogState.status !== "ready") {
    catalogState = { status: "loading" };
    renderHome();
  }

  try {
    const [rails, saved] = await Promise.all([
      loadCatalogRails(requestedTab, { reshuffle }),
      fetchSavedIds(requestedTab).catch(() => new Set<string>()),
    ]);
    if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) {
      logPerf("catalog_stale_response", {
        tab: requestedTab,
        duration_ms: Math.round(performance.now() - started),
      });
      return;
    }
    savedKeys = saved;
    tabCatalogCache.set(requestedTab, rails);
    if (requestedTab === "live") {
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
        if (tab !== requestedTab && tab !== "live") {
          prefetchCatalogTab(tab);
        }
      }
    }
    logPerf("catalog_fetch", {
      tab: requestedTab,
      rails: rails.length,
      items: itemCount,
      reshuffle,
      duration_ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) {
      return;
    }
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
    logPerf("catalog_error", {
      tab: requestedTab,
      reshuffle,
      duration_ms: Math.round(performance.now() - started),
    });
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

function prefetchCatalogTab(tab: BrowseTab, options: { allowLive?: boolean } = {}): void {
  if (
    (!options.allowLive && tab === "live")
    || tab === activeBrowseTab
    || tabCatalogCache.has(tab)
    || tabCatalogPrefetching.has(tab)
    || (tab === "live" && livePrefetchStarted)
  ) {
    return;
  }
  if (tab === "live") {
    livePrefetchStarted = true;
  }
  const started = performance.now();
  tabCatalogPrefetching.add(tab);
  void loadCatalogRails(tab)
    .then((rails) => {
      tabCatalogCache.set(tab, rails);
      if (tab === "live" && rails.length > 0) {
        liveCatalogSessionCached = true;
      }
      logPerf("catalog_prefetch", {
        tab,
        rails: rails.length,
        items: rails.reduce((total, rail) => total + rail.cards.length, 0),
        duration_ms: Math.round(performance.now() - started),
      });
    })
    .catch(() => {
      logPerf("catalog_prefetch_error", {
        tab,
        duration_ms: Math.round(performance.now() - started),
      });
    })
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
