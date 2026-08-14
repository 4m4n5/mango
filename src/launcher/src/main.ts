import "./style.css";
import { FocusGrid } from "./focus";
import {
  flushProgress,
  loadCatalogRails,
  loadContinueRail,
  loadMeta,
  noteYoutubeImpressions,
  noteVodRecommendationImpressions,
  stopPlaybackForVoice,
} from "./catalog";
import { DetailController, type DetailOriginContext } from "./detail";
import { NextEpisodePrompt } from "./next-prompt";
import {
  buildAppsRail,
  buildBrowseTabs,
  buildCatalogRails,
  buildCatalogRailsProgressive,
  BROWSE_TAB_ORDER,
  catalogImpressionFingerprint,
  catalogShuffleFingerprint,
  catalogStateAfterFailure,
  catalogStateAfterSuccess,
  catalogTabCacheIsWarm,
  hasCatalogItems,
  nonEmptyCatalogRails,
  sameCatalogPresentation,
  shufflePressDecision,
  usableCatalogRails,
  youtubeHistoryImportRefreshPolicy,
  type CatalogState,
  type HomeOptions,
} from "./home";
import { buildSettingsRefresh, reliabilityBadgeText, settingsFocusables } from "./settings";
import { fetchReliabilityState } from "./reliability";
import { startVoiceHud } from "./voice-hud";
import {
  showToast,
  toastToneForStatus,
  type LauncherStatusKind,
} from "./toast";
import {
  CatalogOwnershipChangedError,
  CatalogResponseError,
  catalogAvailabilityReason,
} from "./catalog-errors";
import { resolveVoiceWsUrls, startVoiceCommands } from "./voice-commands";
import { startPadNavPoll } from "./pad-nav";
import { cardSavedKey, fetchSavedIds } from "./saved";
import {
  cardFromPlaybackSnapshot,
  clearPlaybackReturnSnapshot,
  playbackReturnOwner,
  readPlaybackReturnFromContext,
  readPlaybackReturnSnapshot,
  tabForCard,
  type PlaybackReturnSnapshot,
} from "./playback-return";
import { SearchController, type SearchRestoreState } from "./search";
import { logPerf } from "./perf";
import { touchCouchActivity } from "./activity";
import { RatingSheetController } from "./ratings";
import {
  activeViewerProfile,
  canActivatePersonalizedCatalogCache,
  fetchPersonalizationState,
  moodDisplayLabel,
  PersonalizationOwnedCache,
  personalizationAriaLabel,
  personalizationControlsVisible,
  profileInitial,
  samePersonalizationOwner,
  samePersonalizationRequestVersion,
  type PersonalizationOwner,
  type PersonalizationPayload,
  type PersonalizationRequestVersion,
} from "./personalization";
import type { ApiInfo, AppCard, ContentCard, ContentRail, BrowseTab } from "./types";

const CONTINUE_RAIL_ID = "continue-watching";
const SAVED_RAIL_ID = "saved";

const homeView = mustGet<HTMLElement>("home-view");
const searchEntry = mustGet<HTMLButtonElement>("search-entry");
const searchView = mustGet<HTMLElement>("search-view");
const browseTabsEl = mustGet<HTMLElement>("browse-tabs");
const railsEl = mustGet<HTMLElement>("rails");
const personalizationEntry = mustGet<HTMLButtonElement>("personalization-entry");
const personalizationEntryAvatar = mustGet<HTMLElement>("personalization-entry-avatar");
const personalizationEntryName = mustGet<HTMLElement>("personalization-entry-name");
const personalizationEntryMood = mustGet<HTMLElement>("personalization-entry-mood");
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
const detailRate = mustGet<HTMLButtonElement>("detail-rate");
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
const detailRatingChips = mustGet<HTMLElement>("detail-rating-chips");
const detailRatingFireMarks = mustGet<HTMLElement>("detail-rating-fire-marks");
const detailRatingFireValue = mustGet<HTMLElement>("detail-rating-fire-value");
const detailRatingWaterMarks = mustGet<HTMLElement>("detail-rating-water-marks");
const detailRatingWaterValue = mustGet<HTMLElement>("detail-rating-water-value");
const detailRatingInvitation = mustGet<HTMLElement>("detail-rating-invitation");
const ratingSheetEl = mustGet<HTMLElement>("rating-sheet");
const ratingOwnerLabel = mustGet<HTMLElement>("rating-owner-label");
const ratingSheetTitle = mustGet<HTMLElement>("rating-sheet-title");
const ratingSheetError = mustGet<HTMLElement>("rating-sheet-error");
const ratingFireRow = mustGet<HTMLButtonElement>("rating-fire-row");
const ratingFireMarks = mustGet<HTMLElement>("rating-fire-marks");
const ratingFireValue = mustGet<HTMLElement>("rating-fire-value");
const ratingWaterRow = mustGet<HTMLButtonElement>("rating-water-row");
const ratingWaterMarks = mustGet<HTMLElement>("rating-water-marks");
const ratingWaterValue = mustGet<HTMLElement>("rating-water-value");
const ratingSave = mustGet<HTMLButtonElement>("rating-save");
const ratingCancel = mustGet<HTMLButtonElement>("rating-cancel");
const ratingClearConfirm = mustGet<HTMLElement>("rating-clear-confirm");
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
let catalogStateTab: BrowseTab = activeBrowseTab;
let catalogStateOwner: PersonalizationOwner | null = null;
let catalogRetryTimer: number | undefined;
let libraryRefreshInFlight = false;
let libraryRefreshPending = false;
let savedKeys = new Set<string>();
const tabCatalogCache = new PersonalizationOwnedCache<BrowseTab, ContentRail[]>();
const tabSavedCache = new PersonalizationOwnedCache<BrowseTab, Set<string>>();
let liveCatalogSessionCached = false;
let catalogRequestSeq = 0;
let pendingContinueRefreshTab: BrowseTab | null = null;
let pendingRatingRefreshTab: BrowseTab | null = null;
let continueRefreshInFlight = false;
let playbackReturnInFlight = false;
let personalizationCatalogDirty = false;
let personalizationStateUpdatedAt = 0;
let personalizationProfileId = "household";
let householdRecommendationIdentity = true;
let initialPersonalizationRead: Promise<void> | null = null;
let settingsBuildSeq = 0;
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
  freshness: "fresh" | "stale";
  container: HTMLElement;
  rows: HTMLElement[][];
}
const tabRenderCache = new Map<BrowseTab, TabRenderEntry>();
let lastImpressionFingerprint: string | null = null;
let nextCatalogPaintYield = false;
let homeRenderGeneration = 0;
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
    setStatus("B to play. Y to go back.", "hint");
  },
);

const ratingSheet = new RatingSheetController(
  ratingSheetEl,
  ratingSheetTitle,
  ratingSheetError,
  ratingFireRow,
  ratingFireMarks,
  ratingFireValue,
  ratingWaterRow,
  ratingWaterMarks,
  ratingWaterValue,
  ratingSave,
  ratingCancel,
  ratingClearConfirm,
  detailRate,
  detailRatingChips,
  detailRatingFireMarks,
  detailRatingFireValue,
  detailRatingWaterMarks,
  detailRatingWaterValue,
  detailRatingInvitation,
  () => {
    if (activeBrowseTab === "movies" || activeBrowseTab === "series") {
      pendingRatingRefreshTab = activeBrowseTab;
    }
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
  detailRate,
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
  ratingSheet,
  {
    onClose: restoreFromDetail,
    onStatus: setStatus,
    onSavedChanged: (card) => void reloadSavedAndCatalog(tabForCard(card, activeBrowseTab)),
    isSaved: (card) => savedKeys.has(cardSavedKey(card)),
    onPlayed: (card, result) => {
      if (result.first_time_verified) {
        showToast("added to library", { tone: "success" });
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
  personalizationEntry.dataset.focusKey = "browse:personalization";
  libraryRefreshBtn.dataset.focusKey = "browse:shuffle";
  personalizationEntry.hidden = true;

  backButton.addEventListener("click", showHome);
  searchEntry.addEventListener("click", () => void openSearch());
  personalizationEntry.addEventListener("click", () => showSettings(true));
  libraryRefreshBtn.addEventListener("click", () => void libraryRefresh());
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("click", () => touchCouchActivity("launcher", "click"), { capture: true });
  window.addEventListener("focus", () => void handlePlaybackReturn());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void handlePlaybackReturn();
    }
  });
  window.addEventListener("mango:library-refresh", () => {
    // Cross-domain Settings mutations happen while Home is hidden, where
    // libraryRefresh intentionally declines to repaint. Invalidate every
    // affected cache and defer the reload until the surface is visible again.
    catalogRequestSeq += 1;
    for (const tab of ["movies", "series", "youtube"] as const) {
      tabCatalogCache.delete(tab);
      tabSavedCache.delete(tab);
      tabRenderCache.delete(tab);
    }
    liveCatalogSessionCached = false;
    if (inSettings || detail.isOpen || search.isOpen) {
      personalizationCatalogDirty = true;
      return;
    }
    personalizationCatalogDirty = false;
    void libraryRefresh({ quiet: true });
  });
  window.addEventListener("mango:youtube-history-imported", () => {
    const surfaceBlocked = inSettings || detail.isOpen || search.isOpen
      || homeView.classList.contains("hidden");
    const policy = youtubeHistoryImportRefreshPolicy(activeBrowseTab, surfaceBlocked);
    tabCatalogCache.delete("youtube");
    tabSavedCache.delete("youtube");
    tabRenderCache.delete("youtube");
    if (policy.cancelActiveCatalogRequest) catalogRequestSeq += 1;
    if (policy.deferYoutubeReload) {
      personalizationCatalogDirty = true;
      return;
    }
    if (policy.reloadYoutubeNow) {
      personalizationCatalogDirty = false;
      void loadCatalog({ background: true });
    }
  });
  void loadInfo();
  void refreshPersonalizationChrome();
  // The command queue provides the immediate companion-profile handshake.
  // This low-rate fallback heals the TV if the orchestrator was restarting
  // after the server-side activation committed.
  window.setInterval(() => void synchronizeExternalPersonalization(), 30_000);
  // Matched-4K playback restarts Chromium after restore. Prefer the durable
  // playback-return snapshot over painting Movies+Search first, and never race
  // a cold catalog fetch ahead of that restore.
  const pendingPlaybackReturn = readPlaybackReturnSnapshot();
  if (pendingPlaybackReturn) {
    homeView.classList.add("hidden");
    void tryRestorePlaybackReturnOnBoot().finally(() => {
      if (!detail.isOpen && !search.isOpen) {
        homeView.classList.remove("hidden");
        renderHome();
        void loadCatalog();
      } else if (!search.isOpen) {
        void loadCatalog();
      }
    });
  } else {
    renderHome();
    void loadCatalog();
    tryRestoreSearchOnBoot();
    void tryRestorePlaybackReturnOnBoot();
  }
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
    onProfileChanged: synchronizeExternalPersonalization,
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
    detailBack: () => detail.back(),
    detailSecondary: () => detail.secondary(),

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
  const generation = ++homeRenderGeneration;
  const yieldPaint = nextCatalogPaintYield;
  nextCatalogPaintYield = false;
  const tabButtons = buildBrowseTabs(browseTabsEl, activeBrowseTab, handleBrowseTabChange);
  const showShuffle = catalogState.status === "ready"
    && catalogShuffleFingerprint(activeBrowseTab, catalogState.rails) !== null;
  libraryRefreshBtn.hidden = !showShuffle;
  const personalizationChrome = householdRecommendationIdentity ? [] : [personalizationEntry];
  const browseChrome = showShuffle
    ? [searchEntry, ...tabButtons, ...personalizationChrome, libraryRefreshBtn]
    : [searchEntry, ...tabButtons, ...personalizationChrome];
  ensureAppsSection();
  if (yieldPaint && catalogState.status === "ready") {
    tabRenderCache.delete(activeBrowseTab);
    const container = document.createElement("div");
    container.className = "rails__tab";
    container.dataset.tab = activeBrowseTab;
    mountRailsView(container);
    focusGridRows = [browseChrome, appsRow];
    focusGrid.setRows(focusGridRows, {
      preferredKey: tabFocusKeys.get(activeBrowseTab),
      fallbackPosition: tabFocusPositions.get(activeBrowseTab),
    });
    void (async () => {
      const rows = await buildCatalogRailsProgressive(container, {
        onContentSelect: handleContentSelect,
        onAppSelect: handleAppSelect,
      }, buildHomeOptions(), catalogState);
      if (generation !== homeRenderGeneration) return;
      tabRenderCache.set(activeBrowseTab, {
        railsRef: catalogState.rails,
        savedRef: savedKeys,
        freshness: catalogState.freshness,
        container,
        rows,
      });
      finishHomeRender(browseChrome, container, rows, false, started);
    })();
    return;
  }
  const { container: activeContainer, rows: catalogRows, reused } = renderActiveTabCatalog();
  finishHomeRender(browseChrome, activeContainer, catalogRows, reused, started);
}

function finishHomeRender(
  browseChrome: HTMLElement[],
  activeContainer: HTMLElement,
  catalogRows: HTMLElement[][],
  reused: boolean,
  started: number,
): void {
  mountRailsView(activeContainer);
  railsEl.setAttribute("aria-busy", String(catalogState.status === "loading"));
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
  noteCatalogImpressionsIfChanged();
  scheduleReliabilityBadge();
}

function noteCatalogImpressionsIfChanged(): void {
  if (catalogState.status !== "ready") return;
  const fingerprint = catalogImpressionFingerprint(activeBrowseTab, catalogState.rails);
  if (!fingerprint || fingerprint === lastImpressionFingerprint) return;
  lastImpressionFingerprint = fingerprint;
  if (activeBrowseTab === "youtube") {
    void noteYoutubeImpressions(catalogState.rails).catch(() => undefined);
  } else if (activeBrowseTab === "movies" || activeBrowseTab === "series") {
    void noteVodRecommendationImpressions(catalogState.rails).catch(() => undefined);
  }
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
  if (
    cached
    && cached.railsRef === catalogState.rails
    && cached.savedRef === savedKeys
    && cached.freshness === catalogState.freshness
  ) {
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
    freshness: catalogState.freshness,
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
    // Live shelves are curated inventories, not pool samples — show every
    // qualified card instead of clipping to one landscape row of four.
    railRowLimit: activeBrowseTab === "live" ? null : homeOptions.railRowLimit,
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
  // Warm per-tab cache is the instant switch path. First visit still loads.
  // Owner drift is confirmed in the background so a missed companion
  // notification cannot flash a loading skeleton on every L/R press.
  if (showCachedCatalog(tab)) {
    if (tab !== "live") {
      void confirmPersonalizedOwnerQuietly();
    }
    return;
  }
  activeBrowseTab = tab;
  catalogState = { status: "loading" };
  catalogStateTab = tab;
  catalogStateOwner = null;
  renderHome();
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
      detail.back();
      return;
    }
    if (event.key === "x" || event.key === "X") {
      event.preventDefault();
      detail.secondary();
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
  setStatus("Type with the D-pad. X deletes; hold X clears. B selects.", "hint");
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
  if (activeBrowseTab === "live") {
    if (!showCachedCatalog(activeBrowseTab)) void loadCatalog();
  } else {
    // Search can outlive a companion profile notification. Withhold its
    // personalized home cache until loadCatalog revalidates the active owner.
    catalogState = { status: "loading" };
    catalogStateTab = activeBrowseTab;
    catalogStateOwner = null;
    personalizationCatalogDirty = false;
    renderHome();
    void loadCatalog();
  }
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.", "hint");
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
  let detailOwner: PersonalizationOwner;
  try {
    await ensureInitialPersonalizationReady();
    detailOwner = currentPersonalizationOwner();
  } catch {
    search.restore(state);
    setStatus("profile is still loading — reopen this title in a moment", "warning");
    return;
  }
  const savedOwner = tab === "live" ? undefined : detailOwner;
  let searchSaved = false;
  try {
    const ids = await fetchSavedIds(tab, savedOwner);
    if (!samePersonalizationOwner(detailOwner, currentPersonalizationOwner())) {
      throw new CatalogOwnershipChangedError();
    }
    searchSaved = ids.has(cardSavedKey(card));
  } catch (error) {
    if (error instanceof CatalogOwnershipChangedError) {
      setStatus("profile changed — reopen this title from Search", "warning");
      void synchronizeExternalPersonalization();
      return;
    }
    // Preserve offline Search detail access, but never reuse a Saved result that
    // failed its owner handshake.
    searchSaved = false;
  }
  detail.show(card, railLabel, tab, detailOwner, searchSaved, [], {
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
    if (result.queued) showToast("queued for library verification", { tone: "success" });
    else if (result.already_queued) showToast("already queued for verification", { tone: "info" });
  } catch {
    // Stream-list state remains authoritative; queueing is best-effort.
  }
}

async function handleContentSelect(
  card: ContentCard,
  railLabel: string,
  tab?: BrowseTab,
): Promise<void> {
  if (card.type === "youtube_setup") {
    showSettings();
    return;
  }
  try {
    await ensureInitialPersonalizationReady();
  } catch {
    setStatus("profile is still loading — reopen this title in a moment", "warning");
    return;
  }
  const owner = currentPersonalizationOwner();
  inSettings = false;
  nextEpisodePrompt.dismiss();
  searchView.classList.add("hidden");
  homeView.classList.add("hidden");
  settingsView.classList.add("hidden");
  const browseTab = tab ?? activeBrowseTab;
  detail.show(
    card,
    railLabel,
    browseTab,
    owner,
    savedKeys.has(cardSavedKey(card)),
    findRailVisible(card),
  );
}

function openVoiceDetail(card: ContentCard, tab: BrowseTab): Promise<void> {
  return (async () => {
    nextEpisodePrompt.dismiss();
    if (detail.isOpen) {
      detail.hide();
    }
    await stopPlaybackForVoice();
    try {
      await ensureInitialPersonalizationReady();
    } catch {
      setStatus("profile is still loading — try that title again in a moment", "warning");
      return;
    }
    const owner = currentPersonalizationOwner();
    inSettings = false;
    settingsView.classList.add("hidden");
    searchView.classList.add("hidden");
    homeView.classList.add("hidden");
    activeBrowseTab = tab;
    setStatus(`Opening ${card.title}…`, "hint");
    detail.show(card, "voice", tab, owner, savedKeys.has(cardSavedKey(card)), []);
  })();
}

function handleAppSelect(app: AppCard): void {
  if (app.action === "settings") {
    showSettings();
  }
}

function showSettings(preferPersonalization = false): void {
  inSettings = true;
  detailView.classList.add("hidden");
  homeView.classList.add("hidden");
  searchView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  backButton.dataset.settingsFocus = "true";
  const items = settingsFocusables(settingsView);
  focusSettingsItem(items, 0);
  void refreshSettingsForCurrentOwner(preferPersonalization);
}

async function refreshSettingsForCurrentOwner(preferPersonalization = false): Promise<void> {
  const buildSeq = ++settingsBuildSeq;
  // Retry the non-blocking boot read whenever Settings opens. The exact state
  // read completes before profile-owned Hidden-title requests are constructed.
  await refreshPersonalizationChrome();
  if (!inSettings || buildSeq !== settingsBuildSeq) return;
  if (personalizationStateUpdatedAt <= 0) {
    setStatus("profile is still loading — reopen Settings in a moment", "warning");
    return;
  }
  const owner = currentPersonalizationOwner();
  await buildSettingsRefresh(
    settingsRefreshEl,
    setStatus,
    owner,
    async (payload) => {
      handlePersonalizationChanged(payload);
      if (inSettings) await refreshSettingsForCurrentOwner(true);
    },
  ).finally(() => {
    if (!inSettings || buildSeq !== settingsBuildSeq
      || !samePersonalizationOwner(owner, currentPersonalizationOwner())) {
      return;
    }
    const refreshed = settingsFocusables(settingsView);
    const personalizationTarget = preferPersonalization
      ? settingsView.querySelector<HTMLElement>("[data-personalization-primary]")
      : null;
    const preferredIndex = personalizationTarget ? refreshed.indexOf(personalizationTarget) : -1;
    focusSettingsItem(
      refreshed,
      preferredIndex >= 0
        ? preferredIndex
        : Math.min(settingsFocusIndex, Math.max(0, refreshed.length - 1)),
    );
    scheduleReliabilityBadge();
  });
}

async function refreshPersonalizationChrome(): Promise<void> {
  if (personalizationStateUpdatedAt === 0) {
    try {
      await ensureInitialPersonalizationReady();
    } catch {
      // Household-only is the fail-closed boot state while catalog-service starts.
    }
    return;
  }
  try {
    const payload = await fetchPersonalizationState();
    if (payload.state.updated_at > personalizationStateUpdatedAt) {
      handlePersonalizationChanged(payload);
    } else {
      applyPersonalizationChrome(payload);
    }
  } catch {
    // Household-only is the fail-closed boot state while catalog-service starts.
  }
}

async function ensureInitialPersonalizationReady(): Promise<void> {
  if (personalizationStateUpdatedAt > 0) return;
  if (!initialPersonalizationRead) {
    initialPersonalizationRead = fetchPersonalizationState()
      .then((payload) => applyPersonalizationChrome(payload))
      .finally(() => {
        initialPersonalizationRead = null;
      });
  }
  await initialPersonalizationRead;
  if (personalizationStateUpdatedAt <= 0) {
    throw new Error("Personalization owner is unavailable.");
  }
}

function applyPersonalizationChrome(payload: PersonalizationPayload): void {
  if (payload.state.updated_at < personalizationStateUpdatedAt) return;
  const nextHouseholdIdentity = !personalizationControlsVisible(payload);
  const identityChanged = householdRecommendationIdentity !== nextHouseholdIdentity;
  householdRecommendationIdentity = nextHouseholdIdentity;
  personalizationEntry.hidden = householdRecommendationIdentity;
  personalizationStateUpdatedAt = payload.state.updated_at;
  const profile = activeViewerProfile(payload);
  personalizationProfileId = profile.profile_id;
  const mood = moodDisplayLabel(payload.state.mood);
  personalizationEntryAvatar.textContent = profileInitial(profile.name);
  personalizationEntryName.textContent = profile.name;
  personalizationEntryMood.textContent = mood;
  personalizationEntry.classList.toggle("browse-personalization--mood", Boolean(payload.state.mood));
  personalizationEntry.setAttribute("aria-label", personalizationAriaLabel(payload));

  const owner = profile.kind === "household" ? "shared household" : profile.name;
  ratingOwnerLabel.textContent = `${owner} rating`;
  detailRatingChips.setAttribute("aria-label", `${owner} rating`);
  if (identityChanged && !homeView.classList.contains("hidden")) renderHome();
}

function handlePersonalizationChanged(payload: PersonalizationPayload): void {
  applyPersonalizationChrome(payload);
  // Invalidate any request that started under the previous profile/mood before
  // it can commit a stale rail payload into the shared launcher state.
  catalogRequestSeq += 1;
  personalizationCatalogDirty = true;
  for (const tab of ["movies", "series", "youtube"] as const) {
    tabCatalogCache.delete(tab);
    tabSavedCache.delete(tab);
    tabRenderCache.delete(tab);
  }
  if (activeBrowseTab !== "live") {
    catalogState = { status: "loading" };
    catalogStateTab = activeBrowseTab;
    catalogStateOwner = null;
  }
}

async function synchronizeExternalPersonalization(
  knownPayload?: PersonalizationPayload,
): Promise<void> {
  const previousUpdatedAt = personalizationStateUpdatedAt;
  const previousProfileId = personalizationProfileId;
  let payload: PersonalizationPayload;
  if (knownPayload) {
    payload = knownPayload;
  } else {
    try {
      payload = await fetchPersonalizationState();
    } catch {
      return;
    }
  }
  if (payload.state.updated_at <= previousUpdatedAt) return;
  handlePersonalizationChanged(payload);

  // A profile/mood switch invalidates the meaning of every visible
  // recommendation and detail action. Close those stale surfaces before
  // loading the new owner's cards; token validation also rejects a race at
  // the service boundary.
  if (detail.isOpen) detail.hide();
  if (search.isOpen) search.close();
  inSettings = false;
  settingsView.classList.add("hidden");
  detailView.classList.add("hidden");
  searchView.classList.add("hidden");
  homeView.classList.remove("hidden");
  clearPlaybackReturnSnapshot();
  personalizationCatalogDirty = false;
  catalogState = { status: "loading" };
  catalogStateTab = activeBrowseTab;
  catalogStateOwner = null;
  renderHome();
  await loadCatalog();
  const active = activeViewerProfile(payload);
  setStatus(
    previousProfileId === active.profile_id
      ? "recommendations updated"
      : `now browsing as ${active.name}`,
    "success",
  );
}

async function validatePersonalizedCatalogOwner(): Promise<boolean> {
  if (personalizationStateUpdatedAt === 0) {
    await ensureInitialPersonalizationReady();
    return true;
  }
  const cachedOwner = {
    profileId: personalizationProfileId,
    personalizationUpdatedAt: personalizationStateUpdatedAt,
  };
  const payload = await fetchPersonalizationState();
  if (canActivatePersonalizedCatalogCache(cachedOwner, payload.state)) return true;
  const beforeSyncRequestSeq = catalogRequestSeq;
  await synchronizeExternalPersonalization(payload);
  if (catalogRequestSeq === beforeSyncRequestSeq) scheduleCatalogRetry(5000);
  return false;
}

async function confirmPersonalizedOwnerQuietly(): Promise<void> {
  try {
    await validatePersonalizedCatalogOwner();
  } catch {
    // Keep the already-painted tab. loadCatalog still owns recovery.
  }
}

function currentPersonalizationOwner(): PersonalizationOwner {
  return {
    profileId: personalizationProfileId,
    personalizationUpdatedAt: personalizationStateUpdatedAt,
  };
}

function tabCacheValue<T>(
  cache: PersonalizationOwnedCache<BrowseTab, T>,
  tab: BrowseTab,
): T | undefined {
  return cache.get(tab, cacheOwnerForTab(tab));
}

function cacheOwnerForTab(tab: BrowseTab): PersonalizationOwner | null {
  return tab === "live" ? null : currentPersonalizationOwner();
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
  refreshDirtyCatalogOnVisibleHome();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.", "hint");
}

function refreshDirtyCatalogOnVisibleHome(): void {
  if (personalizationCatalogDirty && activeBrowseTab !== "live") {
    personalizationCatalogDirty = false;
    // Settings accepted a newer owner while Home was hidden. Paint the
    // already-recorded loading state before starting the strict reload so the
    // previous owner's mounted DOM is never revealed for a frame.
    renderHome();
    void loadCatalog({ background: true });
  }
}

function restoreFromDetail(origin: DetailOriginContext): void {
  // Leaving detail is the durable hand-off point. Keep the snapshot across a
  // same-process thaw so a matched-4K Chromium restart can still reopen detail.
  clearPlaybackReturnSnapshot();
  inSettings = false;
  settingsView.classList.add("hidden");
  if (origin.surface === "search") {
    homeView.classList.add("hidden");
    search.restore(origin.searchState);
    setStatus("Search restored. X deletes; hold X clears.", "hint");
    return;
  }
  searchView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  refreshDirtyCatalogOnVisibleHome();
  setStatus("D-pad to browse. L/R shoulders switch tabs. B to select.", "hint");
  const ratingTab = pendingRatingRefreshTab;
  pendingRatingRefreshTab = null;
  if (ratingTab) {
    tabCatalogCache.delete(ratingTab);
    if (ratingTab === activeBrowseTab) void loadCatalog();
  }
}

async function reloadSavedAndCatalog(tab = activeBrowseTab): Promise<void> {
  const expectedOwner = cacheOwnerForTab(tab);
  try {
    const nextSaved = await fetchSavedIds(tab, expectedOwner ?? undefined);
    if (expectedOwner && !samePersonalizationOwner(expectedOwner, currentPersonalizationOwner())) {
      return;
    }
    tabSavedCache.set(tab, nextSaved, expectedOwner);
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
  const decision = shufflePressDecision({
    inFlight: libraryRefreshInFlight,
    tab: activeBrowseTab,
    detailOpen: detail.isOpen,
    inSettings,
  });
  if (decision === "ignore") {
    if (activeBrowseTab === "live" && !options.quiet && !detail.isOpen && !inSettings) {
      setStatus("this tab refreshes from its own source.", "warning");
    }
    return;
  }
  if (decision === "queue") {
    libraryRefreshPending = true;
    libraryRefreshBtn.classList.add("browse-shuffle--active");
    return;
  }
  const beforeFingerprint = catalogState.status === "ready"
    ? catalogShuffleFingerprint(activeBrowseTab, catalogState.rails)
    : null;
  if (beforeFingerprint === null) {
    if (!options.quiet) {
      setStatus("Shuffle is available when recommendations are ready.", "warning");
    }
    return;
  }
  libraryRefreshInFlight = true;
  libraryRefreshBtn.classList.add("browse-shuffle--active");
  try {
    const result = await loadCatalog({ reshuffle: true });
    const afterFingerprint = result === "fresh" && catalogState.status === "ready"
      ? catalogShuffleFingerprint(activeBrowseTab, catalogState.rails)
      : null;
    if (!options.quiet && result === "fresh" && afterFingerprint === beforeFingerprint) {
      setStatus("No new recommendations are ready yet.", "warning");
    } else if (!options.quiet && result === "fresh" && afterFingerprint !== null) {
      setStatus("updated — keep browsing", "success");
    }
  } finally {
    libraryRefreshInFlight = false;
    if (libraryRefreshPending && shufflePressDecision({
      inFlight: false,
      tab: activeBrowseTab,
      detailOpen: detail.isOpen,
      inSettings,
    }) === "start") {
      libraryRefreshPending = false;
      void libraryRefresh(options);
    } else {
      libraryRefreshPending = false;
      libraryRefreshBtn.classList.remove("browse-shuffle--active");
    }
  }
}

type CatalogLoadResult = "fresh" | "stale" | "empty" | "offline" | "ignored";

async function loadCatalog(
  options: { reshuffle?: boolean; background?: boolean } = {},
): Promise<CatalogLoadResult> {
  const requestSeq = ++catalogRequestSeq;
  const requestedTab = activeBrowseTab;
  const started = performance.now();
  clearCatalogRetryTimer();
  const reshuffle = Boolean(options.reshuffle && requestedTab !== "live");
  const previousReadyRails = catalogStateTab === requestedTab
      && catalogState.status === "ready"
      && (requestedTab === "live" || (catalogStateOwner
        && samePersonalizationOwner(catalogStateOwner, currentPersonalizationOwner())))
    ? catalogState.rails
    : undefined;

  // A reshuffle is already fenced by the immutable owner sent to the catalog
  // and Saved endpoints below. Avoid a redundant personalization round trip;
  // a server-side 409 still enters the normal resynchronization path.
  if (requestedTab !== "live" && !reshuffle) {
    try {
      if (!await validatePersonalizedCatalogOwner()
        || requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) {
        return "ignored";
      }
    } catch (error) {
      if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) return "ignored";
      catalogState = catalogStateAfterFailure(catalogAvailabilityReason(error), undefined);
      catalogStateTab = requestedTab;
      catalogStateOwner = null;
      renderHome();
      scheduleCatalogRetry(5000);
      return "offline";
    }
  }

  if (requestedTab === "live" && liveCatalogSessionCached) {
    const frozen = tabCacheValue(tabCatalogCache, "live");
    if (frozen && frozen.length > 0) {
      savedKeys = await fetchSavedIds("live").catch(() => new Set<string>());
      tabSavedCache.set("live", savedKeys, null);
      if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) {
        return "ignored";
      }
      catalogState = { status: "ready", rails: frozen, freshness: "fresh" };
      catalogStateTab = requestedTab;
      catalogStateOwner = null;
      renderHome();
      return "fresh";
    }
  }

  const cachedSaved = tabCacheValue(tabSavedCache, requestedTab);
  const catalogCacheRefresh = tabCatalogCache.beginRefresh(
    requestedTab,
    cacheOwnerForTab(requestedTab),
    { bypassRead: reshuffle },
  );
  const cachedRailsCandidate = catalogCacheRefresh.cachedValue;
  // A personalized catalog cache is one coherent unit: recommendations and
  // Saved markers must have been produced for the same immutable owner.
  const cachedRails = requestedTab === "live" || cachedSaved !== undefined
    ? cachedRailsCandidate
    : undefined;
  const lastGoodRails = requestedTab === "live" || cachedSaved !== undefined
    ? catalogCacheRefresh.lastGoodValue
    : undefined;
  const fallbackRails = usableCatalogRails(cachedRails)
    ?? usableCatalogRails(previousReadyRails)
    ?? usableCatalogRails(lastGoodRails);
  if (!options.background && cachedRails && hasCatalogItems(cachedRails)) {
    savedKeys = cachedSaved ?? new Set<string>();
    catalogState = { status: "ready", rails: nonEmptyCatalogRails(cachedRails), freshness: "fresh" };
    catalogStateTab = requestedTab;
    catalogStateOwner = cacheOwnerForTab(requestedTab);
    renderHome();
  } else if (!options.background && !fallbackRails) {
    catalogState = { status: "loading" };
    catalogStateTab = requestedTab;
    catalogStateOwner = null;
    renderHome();
  }

  try {
    const expectedOwner: PersonalizationRequestVersion | undefined = requestedTab === "live"
      ? undefined
      : {
        catalogRequestSeq: requestSeq,
        profileId: personalizationProfileId,
        personalizationUpdatedAt: personalizationStateUpdatedAt,
      };
    const [catalog, saved] = await Promise.all([
      loadCatalogRails(requestedTab, { reshuffle, expectedOwner }),
      reshuffle && cachedSaved !== undefined
        ? Promise.resolve(cachedSaved)
        : expectedOwner
        ? fetchSavedIds(requestedTab, expectedOwner)
        : fetchSavedIds(requestedTab).catch(() => new Set<string>()),
    ]);
    const currentOwner: PersonalizationRequestVersion = {
      catalogRequestSeq,
      profileId: personalizationProfileId,
      personalizationUpdatedAt: personalizationStateUpdatedAt,
    };
    const responseOwner: PersonalizationRequestVersion | null = catalog.owner && expectedOwner
      ? {
        catalogRequestSeq: expectedOwner.catalogRequestSeq,
        profileId: catalog.owner.profileId,
        personalizationUpdatedAt: catalog.owner.personalizationUpdatedAt,
      }
      : null;
    if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab
      || (expectedOwner && (!responseOwner
        || !samePersonalizationRequestVersion(expectedOwner, currentOwner)
        || !samePersonalizationRequestVersion(expectedOwner, responseOwner)))) {
      logPerf("catalog_stale_response", {
        tab: requestedTab,
        duration_ms: Math.round(performance.now() - started),
      });
      return "ignored";
    }
    const rails = catalog.rails;
    savedKeys = saved;
    const completedOwner: PersonalizationOwner | null = expectedOwner
      ? {
        profileId: expectedOwner.profileId,
        personalizationUpdatedAt: expectedOwner.personalizationUpdatedAt,
      }
      : null;
    tabSavedCache.set(requestedTab, saved, completedOwner);
    const itemCount = rails.reduce((total, rail) => total + rail.cards.length, 0);
    if (itemCount === 0) {
      const nextState = catalogStateAfterSuccess(rails, fallbackRails);
      const presentationChanged = catalogStateTab !== requestedTab
        || !sameCatalogPresentation(catalogState, nextState);
      catalogState = nextState;
      if (nextState.status === "empty") {
        tabCatalogCache.delete(requestedTab);
      }
      catalogStateTab = requestedTab;
      catalogStateOwner = nextState.status === "ready" ? completedOwner : null;
      if (requestedTab === "live") liveCatalogSessionCached = false;
      if (presentationChanged) renderHome();
      scheduleCatalogRetry(30_000);
      logPerf("catalog_fetch", {
        tab: requestedTab,
        rails: rails.length,
        items: 0,
        reshuffle,
        duration_ms: Math.round(performance.now() - started),
      });
      return fallbackRails ? "stale" : "empty";
    }
    const usableRails = nonEmptyCatalogRails(rails);
    catalogCacheRefresh.commit(usableRails, completedOwner);
    if (requestedTab === "live") liveCatalogSessionCached = true;
    catalogState = { status: "ready", rails: usableRails, freshness: "fresh" };
    catalogStateTab = requestedTab;
    catalogStateOwner = completedOwner;
    nextCatalogPaintYield = reshuffle;
    renderHome();
    logPerf("catalog_fetch", {
      tab: requestedTab,
      rails: rails.length,
      items: itemCount,
      reshuffle,
      duration_ms: Math.round(performance.now() - started),
    });
    return "fresh";
  } catch (error) {
    if (requestSeq !== catalogRequestSeq || requestedTab !== activeBrowseTab) {
      return "ignored";
    }
    if (error instanceof CatalogOwnershipChangedError
      || (error instanceof CatalogResponseError && error.status === 409)) {
      const beforeSyncRequestSeq = catalogRequestSeq;
      await synchronizeExternalPersonalization();
      if (catalogRequestSeq === beforeSyncRequestSeq) scheduleCatalogRetry(5000);
      return "ignored";
    }
    const hasFallback = Boolean(fallbackRails?.length);
    const nextState = catalogStateAfterFailure(catalogAvailabilityReason(error), fallbackRails);
    const presentationChanged = catalogStateTab !== requestedTab
      || !sameCatalogPresentation(catalogState, nextState);
    catalogState = nextState;
    catalogStateTab = requestedTab;
    catalogStateOwner = nextState.status === "ready" ? cacheOwnerForTab(requestedTab) : null;
    if (presentationChanged) renderHome();
    // The persistent stale/offline surface owns retry feedback, including a
    // user-triggered refresh. Background attempts never create five-second
    // toast churn.
    scheduleCatalogRetry(5000);
    logPerf("catalog_error", {
      tab: requestedTab,
      reshuffle,
      duration_ms: Math.round(performance.now() - started),
    });
    return hasFallback ? "stale" : "offline";
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

function tryRestoreSearchOnBoot(): boolean {
  if (!search.restorePersisted()) {
    return false;
  }
  inSettings = false;
  nextEpisodePrompt.dismiss();
  homeView.classList.add("hidden");
  detailView.classList.add("hidden");
  settingsView.classList.add("hidden");
  setStatus("Search restored. X deletes; hold X clears.", "hint");
  return true;
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
      // Do not clear here. Matched-4K restore thaws Chromium before restarting
      // it for EGL rebuild; clearing on thaw races the kill and boots Home.
      // Snapshot clears when detail is left (restoreFromDetail) or after a
      // cold reopen via restoreDetailFromSnapshot / Live tab_home.
      return;
    }

    let snapshot = savedSnapshot;
    if (!snapshot) {
      try {
        await ensureInitialPersonalizationReady();
      } catch {
        return;
      }
      snapshot = await readPlaybackReturnFromContext(currentPersonalizationOwner());
    }
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
  try {
    await ensureInitialPersonalizationReady();
  } catch {
    clearPlaybackReturnSnapshot();
    showHome();
    setStatus("profile is still loading — playback return stayed on Home", "warning");
    return;
  }
  const owner = currentPersonalizationOwner();
  const snapshotOwner = playbackReturnOwner(snapshot);
  if (snapshotOwner && !samePersonalizationOwner(snapshotOwner, owner)) {
    clearPlaybackReturnSnapshot();
    showHome();
    setStatus("profile changed — returned Home safely", "warning");
    return;
  }
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
  if (!samePersonalizationOwner(owner, currentPersonalizationOwner())) {
    clearPlaybackReturnSnapshot();
    showHome();
    setStatus("profile changed — returned Home safely", "warning");
    return;
  }
  detail.restoreAfterPlayback(
    card,
    "continue",
    snapshot.tab,
    owner,
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
  const captured: PersonalizationRequestVersion = {
    catalogRequestSeq,
    profileId: personalizationProfileId,
    personalizationUpdatedAt: personalizationStateUpdatedAt,
  };
  const response = await loadContinueRail(tab, captured);
  const current: PersonalizationRequestVersion = {
    catalogRequestSeq,
    profileId: personalizationProfileId,
    personalizationUpdatedAt: personalizationStateUpdatedAt,
  };
  const responseOwner: PersonalizationRequestVersion = {
    catalogRequestSeq: captured.catalogRequestSeq,
    profileId: response.profileId,
    personalizationUpdatedAt: response.personalizationUpdatedAt,
  };
  if (!samePersonalizationRequestVersion(captured, current)
    || !samePersonalizationRequestVersion(captured, responseOwner)) {
    logPerf("continue_stale_response", { tab });
    return;
  }
  const nextContinueRail = response.rail;
  const cachedRails = tabCacheValue(tabCatalogCache, tab);
  const currentRails = tab === activeBrowseTab
      && catalogState.status === "ready"
      && catalogStateOwner
      && samePersonalizationOwner(catalogStateOwner, currentPersonalizationOwner())
    ? catalogState.rails
    : cachedRails;
  if (!currentRails) {
    return;
  }
  const nextRails = replaceContinueRail(currentRails, nextContinueRail);
  const owner: PersonalizationOwner = {
    profileId: captured.profileId,
    personalizationUpdatedAt: captured.personalizationUpdatedAt,
  };
  tabCatalogCache.set(tab, nextRails, owner);
  if (tab === activeBrowseTab) {
    catalogState = {
      status: "ready",
      rails: nextRails,
      freshness: catalogState.status === "ready" ? catalogState.freshness : "fresh",
    };
    catalogStateTab = tab;
    catalogStateOwner = owner;
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

function showCachedCatalog(tab: BrowseTab): boolean {
  const cachedRails = tabCacheValue(tabCatalogCache, tab);
  const cachedSaved = tabCacheValue(tabSavedCache, tab);
  if (!catalogTabCacheIsWarm(tab, cachedRails, cachedSaved) || !cachedRails) {
    return false;
  }
  clearCatalogRetryTimer();
  activeBrowseTab = tab;
  savedKeys = cachedSaved || new Set<string>();
  catalogState = { status: "ready", rails: nonEmptyCatalogRails(cachedRails), freshness: "fresh" };
  catalogStateTab = tab;
  catalogStateOwner = cacheOwnerForTab(tab);
  renderHome();
  return true;
}

function scheduleCatalogRetry(delayMs: number): void {
  clearCatalogRetryTimer();
  catalogRetryTimer = window.setTimeout(() => {
    catalogRetryTimer = undefined;
    void loadCatalog({ background: true });
  }, delayMs);
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

function setStatus(message: string, kind: LauncherStatusKind = "hint"): void {
  const tone = toastToneForStatus(kind);
  if (tone) showToast(message, { tone });
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
