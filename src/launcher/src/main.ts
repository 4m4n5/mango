import "./style.css";
import { FocusGrid } from "./focus";
import { flushProgress, loadCatalogRails, loadContinueRail, loadMeta, stopPlaybackForVoice } from "./catalog";
import { DetailController, type DetailOriginContext } from "./detail";
import { NextEpisodePrompt } from "./next-prompt";
import {
  buildAppsRail,
  buildBrowseTabs,
  buildCatalogRails,
  BROWSE_TAB_ORDER,
  type CatalogState,
  type HomeOptions,
} from "./home";
import { buildSettingsRefresh, reliabilityBadgeText, settingsFocusables } from "./settings";
import { fetchReliabilityState } from "./reliability";
import { startVoiceHud } from "./voice-hud";
import { showToast } from "./toast";
import { resolveVoiceWsUrls, startVoiceCommands } from "./voice-commands";
import { startPadNavPoll } from "./pad-nav";
import { cardSavedKey, fetchSavedIds } from "./saved";
import {
  cardFromPlaybackSnapshot,
  clearPlaybackReturnSnapshot,
  readPlaybackReturnFromContext,
  readPlaybackReturnSnapshot,
  tabForCard,
  type PlaybackReturnSnapshot,
} from "./playback-return";
import { SearchController, type SearchRestoreState } from "./search";
import { logPerf } from "./perf";
import { touchCouchActivity } from "./activity";
import type { ApiInfo, AppCard, ContentCard, ContentRail, BrowseTab } from "./types";

const CONTINUE_RAIL_ID = "continue-watching";
const SAVED_RAIL_ID = "saved";

const homeView = mustGet<HTMLElement>("home-view");
const searchEntry = mustGet<HTMLButtonElement>("search-entry");
const searchView = mustGet<HTMLElement>("search-view");
const browseTabsEl = mustGet<HTMLElement>("browse-tabs");
const railsEl = mustGet<HTMLElement>("rails");
const libraryRefreshBtn = mustGet<HTMLButtonElement>("library-refresh");
const detailView = mustGet<HTMLElement>("detail-view");
const detailPoster = mustGet<HTMLImageElement>("detail-poster");
const detailEyebrow = mustGet<HTMLElement>("detail-eyebrow");
const detailTitle = mustGet<HTMLElement>("detail-title");
const detailMeta = mustGet<HTMLElement>("detail-meta");
const detailVerifyBadge = mustGet<HTMLElement>("detail-verify-badge");
const detailDescription = mustGet<HTMLElement>("detail-description");
const detailPlay = mustGet<HTMLButtonElement>("detail-play");
const detailSave = mustGet<HTMLButtonElement>("detail-save");
const detailNotInterested = mustGet<HTMLButtonElement>("detail-not-interested");
const detailBack = mustGet<HTMLButtonElement>("detail-back");
const detailStreams = mustGet<HTMLElement>("detail-streams");
const detailStreamList = mustGet<HTMLElement>("detail-stream-list");
const detailEpisodes = mustGet<HTMLElement>("detail-episodes");
const detailSeasonList = mustGet<HTMLElement>("detail-season-list");
const detailEpisodeList = mustGet<HTMLElement>("detail-episode-list");
const detailRelated = mustGet<HTMLElement>("detail-related");
const detailRelatedTrack = mustGet<HTMLElement>("detail-related-track");
const detailRelatedLabel = mustGet<HTMLElement>("detail-related-label");
const nextPromptView = mustGet<HTMLElement>("next-episode-prompt");
const nextPromptTitle = mustGet<HTMLElement>("next-prompt-title");
const nextPromptMeta = mustGet<HTMLElement>("next-prompt-meta");
const nextPromptPlay = mustGet<HTMLButtonElement>("next-prompt-play");
const nextPromptDismiss = mustGet<HTMLButtonElement>("next-prompt-dismiss");
const settingsView = mustGet<HTMLElement>("settings-view");
const settingsRefreshEl = mustGet<HTMLElement>("settings-refresh");
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
const tabSavedCache = new Map<BrowseTab, Set<string>>();
let liveCatalogSessionCached = false;
let catalogRequestSeq = 0;
let pendingContinueRefreshTab: BrowseTab | null = null;
let continueRefreshInFlight = false;
let playbackReturnInFlight = false;
const tabFocusKeys = new Map<BrowseTab, string>();
const tabFocusPositions = new Map<BrowseTab, { row: number; col: number }>();

// Per-tab cache of built catalog DOM + focus rows. Keyed by tab, validated by
// identity of the ContentRail[] and savedKeys Set — a genuine catalog refresh,
// reshuffle, continue-rail update, or saved add/remove all produce a fresh
// reference and therefore invalidate the cache. Loading/error states never
// populate this cache. Bounded by BROWSE_TAB_ORDER.length (4).
interface TabRenderEntry {
  railsRef: ContentRail[];
  savedRef: Set<string>;
  container: HTMLElement;
  rows: HTMLElement[][];
}
const tabRenderCache = new Map<BrowseTab, TabRenderEntry>();
let appsSection: HTMLElement | null = null;
let appsRow: HTMLElement[] = [];
let focusedBrowseElement: HTMLElement | null = null;

const focusGrid = new FocusGrid((element) => {
  const started = performance.now();
  if (focusedBrowseElement !== null && focusedBrowseElement !== element) {
    focusedBrowseElement.classList.remove("focused");
  }
  element.classList.add("focused");
  focusedBrowseElement = element;
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
let search!: SearchController;

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
  detailVerifyBadge,
  detailDescription,
  detailPlay,
  detailSave,
  detailNotInterested,
  detailBack,
  detailStreams,
  detailStreamList,
  detailEpisodes,
  detailSeasonList,
  detailEpisodeList,
  detailRelated,
  detailRelatedTrack,
  detailRelatedLabel,
  {
    onClose: restoreFromDetail,
    onStatus: setStatus,
    onSavedChanged: (card) => void reloadSavedAndCatalog(tabForCard(card, activeBrowseTab)),
    isSaved: (card) => savedKeys.has(cardSavedKey(card)),
    onPlayed: (card, result) => {
      if (result.first_time_verified) {
        showToast("added to library");
      }
      const playedTab = tabForCard(card, activeBrowseTab);
      if (playedTab === "movies" || playedTab === "series") {
        pendingContinueRefreshTab = playedTab;
        void handlePlaybackReturn();
      }
    },
    onConfirmedUnavailable: (card) => void queueSearchExternal(card),
  },
);

search = new SearchController(searchView, {
  onClose: (state) => restoreHomeFromSearch(state),
  onOpenDetail: (card, label, state) => void openSearchDetail(card, label, state),
  onStatus: setStatus,
});

init();

function init(): void {
  searchEntry.dataset.focusKey = "browse:search";
  libraryRefreshBtn.dataset.focusKey = "browse:shuffle";
  renderHome();

  backButton.addEventListener("click", showHome);
  searchEntry.addEventListener("click", () => void openSearch());
  libraryRefreshBtn.addEventListener("click", () => void libraryRefresh());
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", () => touchCouchActivity("launcher", "click"), { capture: true });
  window.addEventListener("focus", () => void handlePlaybackReturn());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void handlePlaybackReturn();
    }
  });
  window.addEventListener("mango:library-refresh", () => void libraryRefresh({ quiet: true }));
  void loadInfo();
  // A matched-display playback can restart Chromium. Restore the durable
  // playback surface first instead of racing a cold catalog fetch against it.
  if (!readPlaybackReturnSnapshot()) {
    void loadCatalog();
  }
  void tryRestorePlaybackReturnOnBoot();
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
  startPadNavPoll({
    isNextPromptOpen: () => nextEpisodePrompt.isOpen,
    nextPromptSelect: () => nextEpisodePrompt.activateFocused(nextPromptFocusIndex),
    nextPromptBack: () => nextEpisodePrompt.dismiss(),
    nextPromptMove: (delta) => {
      nextPromptFocusIndex = nextEpisodePrompt.moveFocus(delta, nextPromptFocusIndex);
      nextEpisodePrompt.applyFocus(nextPromptFocusIndex);
    },

    isDetailOpen: () => detail.isOpen,
    detailMoveRow: (delta) => detail.moveRow(delta),
    detailMoveCol: (delta) => detail.moveCol(delta),
    detailChangeSeason: (delta) => detail.changeSeason(delta),
    detailSelect: () => detail.activate(),
    detailBack: () => {
      if (detail.isResolving()) {
        detail.cancelResolve();
        return;
      }
      detail.hide();
    },

    isInSettings: () => inSettings,
    settingsMove: (direction) => {
      const items = settingsFocusables(settingsView);
      if (items.length === 0) {
        return;
      }
      if (direction === "down" || direction === "right") {
        focusSettingsItem(items, settingsFocusIndex + 1);
      } else if (direction === "up" || direction === "left") {
        focusSettingsItem(items, settingsFocusIndex - 1);
      }
    },
    settingsSelect: () => {
      const items = settingsFocusables(settingsView);
      items[settingsFocusIndex]?.click();
    },
    settingsBack: () => showHome(),

    isInSearch: () => search.isOpen,
    searchMoveRow: (delta) => search.moveRow(delta),
    searchMoveCol: (delta) => search.moveCol(delta),
    searchSelect: () => search.activate(),
    searchBack: () => search.close(),
    searchSecondary: (kind) => search.secondary(kind),

    homeMoveRow: (delta) => focusGrid.moveRow(delta),
    homeMoveCol: (delta) => focusGrid.moveCol(delta),
    homeSelect: () => activateFocused(),
    homeBack: () => {},
    homeTab: (delta) => cycleBrowseTab(delta),
    homeShuffle: () => void libraryRefresh(),
    homeSecondary: () => void libraryRefresh(),
  });
}

function renderHome(): void {
  const started = performance.now();
  const tabButtons = buildBrowseTabs(browseTabsEl, activeBrowseTab, handleBrowseTabChange);
  const showShuffle = activeBrowseTab !== "live";
  libraryRefreshBtn.hidden = !showShuffle;
  const browseChrome = showShuffle
    ? [searchEntry, ...tabButtons, libraryRefreshBtn]
    : [searchEntry, ...tabButtons];
  ensureAppsSection();
  const { container: activeContainer, rows: catalogRows, reused } = renderActiveTabCatalog();
  mountRailsView(activeContainer);
  focusGridRows = [browseChrome, ...catalogRows, appsRow];
  focusGrid.setRows(focusGridRows, {
    preferredKey: tabFocusKeys.get(activeBrowseTab),
    fallbackPosition: tabFocusPositions.get(activeBrowseTab),
  });
  if (focusBrowseTabOnRender) {
    focusBrowseTabOnRender = false;
    const tabIndex = BROWSE_TAB_ORDER.indexOf(activeBrowseTab);
    if (tabIndex >= 0) {
      focusGrid.setPosition(0, tabIndex + 1);
    }
  }
  logPerf("render_home", {
    tab: activeBrowseTab,
    rows: focusGridRows.length,
    state: catalogState.status,
    cache: reused ? "hit" : "miss",
    duration_ms: Math.round(performance.now() - started),
  });
  scheduleReliabilityBadge();
}

function ensureAppsSection(): void {
  if (appsSection) {
    return;
  }
  const built = buildAppsRail({
    onContentSelect: handleContentSelect,
    onAppSelect: handleAppSelect,
  });
  appsSection = built.section;
  appsRow = built.row;
}

interface ActiveTabRender {
  container: HTMLElement;
  rows: HTMLElement[][];
  reused: boolean;
}

function renderActiveTabCatalog(): ActiveTabRender {
  // Loading/error states are never cached — always render fresh into a
  // throwaway container so a stale posters DOM never leaks into these states.
  if (catalogState.status !== "ready") {
    tabRenderCache.delete(activeBrowseTab);
    const container = document.createElement("div");
    container.className = "rails__tab";
    container.dataset.tab = activeBrowseTab;
    const rows = buildCatalogRails(container, {
      onContentSelect: handleContentSelect,
      onAppSelect: handleAppSelect,
    }, buildHomeOptions(), catalogState);
    return { container, rows, reused: false };
  }

  const cached = tabRenderCache.get(activeBrowseTab);
  if (cached && cached.railsRef === catalogState.rails && cached.savedRef === savedKeys) {
    return { container: cached.container, rows: cached.rows, reused: true };
  }

  const container = document.createElement("div");
  container.className = "rails__tab";
  container.dataset.tab = activeBrowseTab;
  const rows = buildCatalogRails(container, {
    onContentSelect: handleContentSelect,
    onAppSelect: handleAppSelect,
  }, buildHomeOptions(), catalogState);
  tabRenderCache.set(activeBrowseTab, {
    railsRef: catalogState.rails,
    savedRef: savedKeys,
    container,
    rows,
  });
  return { container, rows, reused: false };
}

function buildHomeOptions(): HomeOptions {
  return {
    ...homeOptions,
    browseTab: activeBrowseTab,
    onBrowseTabChange: handleBrowseTabChange,
    savedKeys,
  };
}

// Ensures `railsEl` shows exactly [activeContainer, appsSection]. Any other
// cached tab containers currently attached are detached (they stay alive in
// tabRenderCache for reuse). No-op writes when the DOM is already correct so
// same-tab re-renders (cache hit) don't churn.
function mountRailsView(activeContainer: HTMLElement): void {
  for (let i = railsEl.childNodes.length - 1; i >= 0; i -= 1) {
    const child = railsEl.childNodes[i];
    if (child === appsSection || child === activeContainer) {
      continue;
    }
    railsEl.removeChild(child);
  }
  // appsSection must be in railsEl before insertBefore(activeContainer, appsSection).
  // On first mount it is only created by ensureAppsSection(), not yet attached.
  if (appsSection && appsSection.parentNode !== railsEl) {
    railsEl.appendChild(appsSection);
  }
  if (activeContainer.parentNode !== railsEl) {
    if (appsSection && appsSection.parentNode === railsEl) {
      railsEl.insertBefore(activeContainer, appsSection);
    } else {
      railsEl.appendChild(activeContainer);
    }
  }
  if (appsSection && appsSection.parentNode === railsEl && appsSection !== railsEl.lastChild) {
    railsEl.appendChild(appsSection);
  }
}

function handleBrowseTabChange(tab: BrowseTab): void {
  if (tab === activeBrowseTab) {
    return;
  }
  activeBrowseTab = tab;
  if (showCachedCatalog(tab)) {
    return;
  }
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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      detail.moveRow(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      detail.moveRow(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      detail.moveCol(1);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      detail.moveCol(-1);
      return;
    }
    if (event.key === "F6" || event.key === "F7") {
      event.preventDefault();
      detail.changeSeason(event.key === "F7" ? 1 : -1);
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

  if (search.isOpen) {
    if (search.handleKeydown(event)) {
      event.preventDefault();
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

function findRailVisible(card: ContentCard): ContentCard[] {
  if (catalogState.status !== "ready") {
    return [];
  }
  for (const rail of catalogState.rails) {
    if (rail.cards.some((c) => c.id === card.id && c.type === card.type)) {
      return rail.cards;
    }
  }
  return [];
}

async function openSearch(): Promise<void> {
  inSettings = false;
  nextEpisodePrompt.dismiss();
  homeView.classList.add("hidden");
  detailView.classList.add("hidden");
  settingsView.classList.add("hidden");
  await search.openFresh(
    activeBrowseTab,
    focusGrid.focused?.dataset.focusKey,
    focusGrid.position,
  );
  setStatus("Type with the D-pad. X deletes; hold X clears. B selects.");
}

function restoreHomeFromSearch(state: SearchRestoreState): void {
  inSettings = false;
  activeBrowseTab = state.homeTab || activeBrowseTab;
  if (state.homeFocusKey) tabFocusKeys.set(activeBrowseTab, state.homeFocusKey);
  if (state.homePosition) tabFocusPositions.set(activeBrowseTab, state.homePosition);
  searchView.classList.add("hidden");
  settingsView.classList.add("hidden");
  detailView.classList.add("hidden");
  homeView.classList.remove("hidden");
  if (!showCachedCatalog(activeBrowseTab)) {
    void loadCatalog();
  }
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.");
}

async function openSearchDetail(
  card: ContentCard,
  railLabel: string,
  state: SearchRestoreState,
): Promise<void> {
  inSettings = false;
  nextEpisodePrompt.dismiss();
  homeView.classList.add("hidden");
  settingsView.classList.add("hidden");
  const tab = tabForCard(card, activeBrowseTab);
  const searchSaved = await fetchSavedIds(tab)
    .then((ids) => ids.has(cardSavedKey(card)))
    .catch(() => false);
  detail.show(card, railLabel, tab, searchSaved, [], {
    surface: "search",
    searchState: state,
  });
}

async function queueSearchExternal(card: ContentCard): Promise<void> {
  if (card.source !== "external" || (card.type !== "movie" && card.type !== "series")) {
    return;
  }
  try {
    const response = await fetch("/api/catalog/search/external/queue", {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: card.type,
        id: card.id,
        title: card.title,
        poster: card.posterUrl,
        year: card.year,
      }),
    });
    if (!response.ok) return;
    const result = await response.json() as { queued?: boolean; already_queued?: boolean };
    if (result.queued) showToast("queued for library verification");
    else if (result.already_queued) showToast("already queued for verification");
  } catch {
    // Stream-list state remains authoritative; queueing is best-effort.
  }
}

function handleContentSelect(card: ContentCard, railLabel: string, tab?: BrowseTab): void {
  inSettings = false;
  nextEpisodePrompt.dismiss();
  searchView.classList.add("hidden");
  homeView.classList.add("hidden");
  settingsView.classList.add("hidden");
  const browseTab = tab ?? activeBrowseTab;
  detail.show(card, railLabel, browseTab, savedKeys.has(cardSavedKey(card)), findRailVisible(card));
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
    searchView.classList.add("hidden");
    homeView.classList.add("hidden");
    activeBrowseTab = tab;
    setStatus(`Opening ${card.title}…`);
    detail.show(card, "voice", tab, savedKeys.has(cardSavedKey(card)), []);
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
  searchView.classList.add("hidden");
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
  if (search.isOpen) {
    search.close();
    return;
  }
  inSettings = false;
  settingsView.classList.add("hidden");
  detailView.classList.add("hidden");
  searchView.classList.add("hidden");
  homeView.classList.remove("hidden");
  clearPlaybackReturnSnapshot();
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.");
}

function restoreFromDetail(origin: DetailOriginContext): void {
  inSettings = false;
  settingsView.classList.add("hidden");
  if (origin.surface === "search") {
    homeView.classList.add("hidden");
    search.restore(origin.searchState);
    setStatus("Search restored. X deletes; hold X clears.");
    return;
  }
  searchView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.");
}

async function reloadSavedAndCatalog(tab = activeBrowseTab): Promise<void> {
  try {
    const nextSaved = await fetchSavedIds(tab);
    tabSavedCache.set(tab, nextSaved);
    if (tab === activeBrowseTab) {
      savedKeys = nextSaved;
    }
  } catch {
    if (tab === activeBrowseTab) {
      savedKeys = new Set();
    }
  }
  tabCatalogCache.delete(tab);
  if (tab === "live" || tab === "youtube") {
    liveCatalogSessionCached = false;
  }
  if (tab === activeBrowseTab && !search.isOpen) {
    await loadCatalog();
  }
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
  clearCatalogRetryTimer();
  const reshuffle = Boolean(options.reshuffle && requestedTab !== "live");
  if (reshuffle) {
    tabCatalogCache.delete(requestedTab);
    setStatus("refreshing…");
  }

  if (requestedTab === "live" && liveCatalogSessionCached) {
    const frozen = tabCatalogCache.get("live");
    if (frozen && frozen.length > 0) {
      savedKeys = await fetchSavedIds("live").catch(() => new Set<string>());
      tabSavedCache.set("live", savedKeys);
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
    tabSavedCache.set(requestedTab, saved);
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
        message: error instanceof Error ? error.message : "catalog temporarily unavailable",
      };
      renderHome();
    }
    const returningFromPlayback = Boolean(readPlaybackReturnSnapshot())
      || detail.isOpen
      || playbackReturnInFlight;
    const homeNeedsError = !cachedRails?.length
      && !returningFromPlayback
      && !homeView.classList.contains("hidden");
    if (reshuffle || homeNeedsError) {
      setStatus(catalogRetryStatus(error, reshuffle));
    }
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

async function handlePlaybackReturn(): Promise<void> {
  await restorePlaybackSurfaceIfNeeded();

  const tab = pendingContinueRefreshTab;
  if (!tab || continueRefreshInFlight || document.visibilityState === "hidden") {
    return;
  }
  continueRefreshInFlight = true;
  pendingContinueRefreshTab = null;
  try {
    await flushProgress();
    await refreshContinueRail(tab);
  } catch {
    pendingContinueRefreshTab = tab;
  } finally {
    continueRefreshInFlight = false;
  }
}

async function tryRestorePlaybackReturnOnBoot(): Promise<void> {
  if (!readPlaybackReturnSnapshot()) {
    return;
  }
  await restorePlaybackSurfaceIfNeeded();
}

async function restorePlaybackSurfaceIfNeeded(): Promise<void> {
  if (playbackReturnInFlight || inSettings || nextEpisodePrompt.isOpen) {
    return;
  }
  playbackReturnInFlight = true;
  try {
    const savedSnapshot = readPlaybackReturnSnapshot();
    if (detail.isOpen) {
      if (savedSnapshot) {
        await flushProgress();
        await detail.refreshAfterPlayback(savedSnapshot.episodeId);
      } else {
        detail.focusAfterPlaybackReturn();
      }
      clearPlaybackReturnSnapshot();
      return;
    }

    const snapshot =
      savedSnapshot
      ?? await readPlaybackReturnFromContext();
    if (!snapshot) {
      return;
    }

    await flushProgress();

    if (snapshot.returnSurface === "tab_home") {
      restoreLiveTabHome(snapshot.tab);
      return;
    }

    await restoreDetailFromSnapshot(snapshot);
  } finally {
    playbackReturnInFlight = false;
  }
}

function restoreLiveTabHome(tab: BrowseTab): void {
  clearPlaybackReturnSnapshot();
  inSettings = false;
  nextEpisodePrompt.dismiss();
  if (detail.isOpen) {
    detail.hide();
  }
  activeBrowseTab = tab;
  buildBrowseTabs(browseTabsEl, activeBrowseTab, handleBrowseTabChange);
  homeView.classList.remove("hidden");
  searchView.classList.add("hidden");
  settingsView.classList.add("hidden");
  detailView.classList.add("hidden");
  if (!showCachedCatalog(tab)) {
    void loadCatalog();
  } else {
    renderHome();
  }
  focusGrid.restoreFocus();
}

async function restoreDetailFromSnapshot(snapshot: PlaybackReturnSnapshot): Promise<void> {
  const card = cardFromPlaybackSnapshot(snapshot);
  const searchOrigin = snapshot.origin === "search";
  if (searchOrigin) {
    search.restore(snapshot.searchState);
    search.hideForDetail();
  } else {
    activeBrowseTab = snapshot.tab;
  }
  buildBrowseTabs(browseTabsEl, activeBrowseTab, handleBrowseTabChange);
  inSettings = false;
  nextEpisodePrompt.dismiss();
  homeView.classList.add("hidden");
  searchView.classList.add("hidden");
  settingsView.classList.add("hidden");
  try {
    const meta = await loadMeta(card);
    if (meta.description) {
      card.description = meta.description;
    }
    if (meta.year !== undefined) {
      card.year = meta.year;
    }
    const subtitle = meta.releaseInfo || (meta.runtime ? String(meta.runtime) : "");
    if (subtitle) {
      card.subtitle = subtitle;
    }
    if (meta.poster) {
      card.posterUrl = meta.poster;
    }
  } catch {
    // snapshot card is enough to reopen detail
  }
  detail.restoreAfterPlayback(
    card,
    "continue",
    snapshot.tab,
    savedKeys.has(cardSavedKey(card)),
    [],
    snapshot.episodeId,
    searchOrigin
      ? { surface: "search", searchState: snapshot.searchState }
      : { surface: "home" },
  );
  clearPlaybackReturnSnapshot();
}

async function refreshContinueRail(tab: BrowseTab): Promise<void> {
  if (tab !== "movies" && tab !== "series") {
    return;
  }
  const nextContinueRail = await loadContinueRail(tab);
  const currentRails = tab === activeBrowseTab && catalogState.status === "ready"
    ? catalogState.rails
    : tabCatalogCache.get(tab);
  if (!currentRails) {
    return;
  }
  const nextRails = replaceContinueRail(currentRails, nextContinueRail);
  tabCatalogCache.set(tab, nextRails);
  if (tab === activeBrowseTab) {
    catalogState = { status: "ready", rails: nextRails };
    if (!detail.isOpen && !inSettings && !homeView.classList.contains("hidden")) {
      renderHome();
    }
  }
}

function replaceContinueRail(rails: ContentRail[], continueRail: ContentRail): ContentRail[] {
  const withoutContinue = rails.filter((rail) => rail.id !== CONTINUE_RAIL_ID);
  if (continueRail.cards.length === 0) {
    return withoutContinue;
  }
  const savedIndex = withoutContinue.findIndex((rail) => rail.id === SAVED_RAIL_ID);
  const insertIndex = savedIndex >= 0 ? savedIndex : 0;
  return [
    ...withoutContinue.slice(0, insertIndex),
    continueRail,
    ...withoutContinue.slice(insertIndex),
  ];
}

function catalogRetryStatus(error: unknown, reshuffle: boolean): string {
  const message = error instanceof Error ? error.message : "catalog temporarily unavailable";
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

function showCachedCatalog(tab: BrowseTab): boolean {
  const cachedRails = tabCatalogCache.get(tab);
  if (!cachedRails || cachedRails.length === 0) {
    return false;
  }
  clearCatalogRetryTimer();
  activeBrowseTab = tab;
  savedKeys = tabSavedCache.get(tab) || new Set<string>();
  catalogState = { status: "ready", rails: cachedRails };
  renderHome();
  return true;
}

function clearCatalogRetryTimer(): void {
  if (catalogRetryTimer === undefined) {
    return;
  }
  window.clearTimeout(catalogRetryTimer);
  catalogRetryTimer = undefined;
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
  // The launcher intentionally has no persistent status strip. Reuse the
  // existing non-focusable toast for actionable failures while keeping routine
  // navigation/progress copy on its owning control.
  if (/couldn|failed|unavailable|timed? out|try again|no playable|not start/i.test(message)) {
    showToast(message);
  }
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
