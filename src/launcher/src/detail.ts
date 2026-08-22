import {
  loadMeta,
  loadStreams,
  loadSeriesEpisodes,
  loadYoutubeDetailCards,
  loadNextPrompt,
  loadRailRelatedCards,
  playCard,
  notInterestedCard,
  isNotInterestedCard,
  noteRecommendationDetailOpen,
  undoNotInterestedCard,
  type CatalogMeta,
  type CatalogStream,
  type SeriesEpisodesResponse,
  type SeriesEpisodeRow,
  type SeriesSeasonBlock,
  type NextPromptResponse,
  type PlayResult,
} from "./catalog";
import type { ContentCard, BrowseTab } from "./types";
import { showToast, type LauncherStatusReporter } from "./toast";
import { publishCurrentLibraryContext, saveCard, unsaveCard } from "./saved";
import {
  savePlaybackReturnSnapshot,
  clearPlaybackReturnSnapshot,
  type PlaybackOrigin,
} from "./playback-return";
import { armDeferredPosterSources, bindPosterImage, resolveCardPosterUrl } from "./poster";
import { isLandscapeCard, posterRevealMeta, shouldShowLivePill } from "./home";
import { MINIMAL_VOD_POSTER_LABELS } from "./ui-flags";
import { CatalogOwnershipChangedError, playErrorMessage } from "./catalog-errors";
import { reconcileEpisodePlayTimeout } from "./playback-reconciliation";
import { recoverTimedOutStreamList } from "./stream-list-recovery";
import { RatingSheetController } from "./ratings";
import { setControlLabel } from "./icons";
import {
  samePersonalizationOwner,
  type PersonalizationOwner,
} from "./personalization";
import { tabForCard } from "./library-tab";
import { PlayWaitCopy, PLAY_WAIT_ROTATE_MS } from "./play-wait-copy";

const playWaitCopy = new PlayWaitCopy();

// VOD related stays seven portrait cards across the full-width row. YouTube uses
// four landscape cards with titles under the thumb, matching Home rails.
const RELATED_DISPLAY_LIMIT = 7;
const YOUTUBE_RELATED_DISPLAY_LIMIT = 4;

export function relatedTitlesLimit(tab: BrowseTab): { display: number; fetch: number } {
  const display = tab === "youtube" ? YOUTUBE_RELATED_DISPLAY_LIMIT : RELATED_DISPLAY_LIMIT;
  return { display, fetch: display + 1 };
}

export function relatedLabelForTab(tab: BrowseTab): string {
  // YouTube detail resamples the same rail, so "Related" is misleading; VOD
  // cross-rail suggestions stay "Related".
  return tab === "youtube" ? "More to watch" : "Related";
}

export function cardHasCompleteDetailMeta(card: ContentCard): boolean {
  return Boolean(card.description?.trim() && (card.posterUrl || "").trim());
}

/** Play-only / floor steps — never styled as verified in the side-list. */
const UNVERIFIED_STREAM_STEPS = new Set([
  "obligation_floor",
  "last_resort",
  "4k_sdr_soft_cached",
  "1080p_uncached_fallback",
]);

export interface DetailCallbacks {
  onClose: (origin: DetailOriginContext) => void;
  onStatus: LauncherStatusReporter;
  onSavedChanged?: (card: ContentCard) => void;
  onPlayed?: (card: ContentCard, result: PlayResult) => void;
  isSaved?: (card: ContentCard) => boolean;
  onConfirmedUnavailable?: (card: ContentCard) => void;
}

export type DetailOriginContext = {
  surface: PlaybackOrigin;
  searchState?: unknown;
};

export class DetailController {
  private card: ContentCard | null = null;
  private focusedEl: HTMLElement | null = null;
  /** `undefined` = not looked up yet, `null` = looked up and absent. */
  /** `undefined` = not looked up yet. Scroll listeners are attached on first look-up. */
  private scrollListEls: HTMLElement[] | undefined = undefined;
  private playToken = 0;
  private playAbort: AbortController | null = null;
  private streams: CatalogStream[] = [];
  /** Picker hard-fail hide (~30 min) keyed by stream URL. */
  private hiddenStreamUntil = new Map<string, number>();
  private streamButtons: HTMLButtonElement[] = [];
  private streamsLoadToken = 0;
  private episodesLoadToken = 0;
  private resolvingPlay = false;
  private streamsPending = false;
  private seriesEpisodes: SeriesEpisodesResponse | null = null;
  /** Season chips + episode rows in the side panel — D-pad order. */
  private listFocusables: HTMLElement[] = [];
  private seasonChipButtons: HTMLButtonElement[] = [];
  private activeSeason: number | null = null;
  private selectedEpisodeId: string | null = null;
  private nextPromptPollTimer: number | undefined;
  private browseTab: BrowseTab = "movies";
  private saved = false;
  private notInterested = false;
  private relatedButtons: HTMLButtonElement[] = [];
  private homeVisibleCards: ContentCard[] = [];
  private relatedLoadToken = 0;
  /** Restored after playback when series episode was playing. */
  private pendingEpisodeRestore: string | null = null;
  /** Episode whose playback exit initiated the current detail restore. */
  private playbackReturnEpisodeId: string | null = null;
  private origin: DetailOriginContext = { surface: "home" };
  /** Immutable owner captured when this Detail instance opened. */
  private personalizationOwner: PersonalizationOwner | null = null;

  constructor(
    private readonly view: HTMLElement,
    private readonly poster: HTMLImageElement,
    private readonly eyebrow: HTMLElement,
    private readonly title: HTMLElement,
    private readonly meta: HTMLElement,
    private readonly verifyBadge: HTMLElement,
    private readonly description: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    private readonly saveButton: HTMLButtonElement,
    private readonly rateButton: HTMLButtonElement,
    private readonly notInterestedButton: HTMLButtonElement,
    private readonly streamsWrap: HTMLElement,
    private readonly streamList: HTMLElement,
    private readonly episodesWrap: HTMLElement,
    private readonly seasonList: HTMLElement,
    private readonly episodeList: HTMLElement,
    private readonly relatedWrap: HTMLElement,
    private readonly relatedTrack: HTMLElement,
    private readonly relatedLabel: HTMLElement,
    private readonly ratingSheet: RatingSheetController,
    private readonly callbacks: DetailCallbacks,
  ) {
    this.playButton.addEventListener("click", () => void this.play());
    this.saveButton.addEventListener("click", () => void this.toggleSaved());
    this.notInterestedButton.addEventListener("click", () => void this.markNotInterested());
    this.ratingSheet.connectNotForMe(() => void this.markNotInterested());
  }

  get isOpen(): boolean {
    return this.card !== null;
  }

  /** True while play resolve or stream list fetch is in flight — Y cancels instead of closing. */
  isResolving(): boolean {
    return this.resolvingPlay || this.streamsPending;
  }

  focusPlayButton(): void {
    for (const control of this.allFocusableElements()) {
      control.classList.remove("focused");
    }
    this.playButton.classList.add("focused");
    this.playButton.focus({ preventScroll: true });
    this.focusedEl = this.playButton;
  }

  focusAfterPlaybackReturn(): void {
    this.clearPlayBusy();
    this.updatePlayButtonLabel();
    if (!this.selectedEpisodeId || !this.focusEpisodeById(this.selectedEpisodeId)) {
      this.focusPlayButton();
    }
    this.maybePromptNextEpisode();
  }

  /** Refresh progress truth in place before restoring couch focus.
   *
   * Keeping pendingEpisodeRestore populated makes loadEpisodeList render and
   * focus the exact refreshed episode after its asynchronous DOM rebuild.
   */
  async refreshAfterPlayback(episodeId?: string): Promise<void> {
    const card = this.card;
    this.clearPlayBusy();
    const returningEpisodeId = episodeId ?? this.selectedEpisodeId;
    this.playbackReturnEpisodeId = returningEpisodeId ?? null;
    if (card?.type === "series") {
      this.pendingEpisodeRestore = returningEpisodeId;
      await this.loadEpisodeList(card);
    }
    if (this.card !== card) {
      return;
    }
    this.updatePlayButtonLabel();
    if (!returningEpisodeId || !this.focusEpisodeById(returningEpisodeId)) {
      this.focusPlayButton();
    }
    this.maybePromptNextEpisode();
  }

  restoreAfterPlayback(
    card: ContentCard,
    railLabel: string,
    tab: BrowseTab,
    owner: PersonalizationOwner,
    saved = false,
    homeVisible: ContentCard[] = [],
    episodeId?: string,
    origin: DetailOriginContext = { surface: "home" },
  ): void {
    this.pendingEpisodeRestore = episodeId ?? null;
    this.show(card, railLabel, tab, owner, saved, homeVisible, origin);
    this.playbackReturnEpisodeId = episodeId ?? null;
    this.maybePromptNextEpisode();
  }

  /** On return from playback, check once (briefly) whether the just-watched
   *  episode finished — the backend only holds a pending prompt when the exit
   *  was at/after the finish bar, so this never fires on a mid-watch exit. */
  private maybePromptNextEpisode(): void {
    if (this.card?.type !== "series") {
      return;
    }
    this.startNextPromptPoll();
  }

  cancelResolve(): void {
    if (!this.isResolving()) {
      return;
    }
    this.playToken += 1;
    this.streamsLoadToken += 1;
    this.playAbort?.abort();
    this.playAbort = null;
    clearPlaybackReturnSnapshot();
    this.resolvingPlay = false;
    this.streamsPending = false;
    this.clearPlayBusy();
    this.playButton.disabled = false;
    this.saveButton.disabled = false;
    this.setNotInterestedDisabled(false);
    for (const button of this.streamButtons) {
      button.disabled = false;
    }
    for (const button of this.episodeButtons()) {
      button.disabled = false;
    }
  }

  private playLabelEl(): HTMLElement {
    return this.playButton.querySelector(".detail-button-label") ?? this.playButton;
  }

  private setPlayButtonText(text: string): void {
    this.playLabelEl().textContent = text;
  }

  /** Play-resolve progress lives in the play button label only. */
  private publishPlayProgress(message: string): void {
    if (this.resolvingPlay) {
      this.setPlayBusyLabel(message);
    }
  }

  private setPlayBusyLabel(message: string): void {
    this.playButton.classList.add("detail-button--busy");
    this.setPlayButtonText(message);
  }

  private clearPlayBusy(): void {
    this.playButton.classList.remove("detail-button--busy");
    this.updatePlayButtonLabel();
  }

  show(
    card: ContentCard,
    railLabel: string,
    tab: BrowseTab,
    owner: PersonalizationOwner,
    saved = false,
    homeVisible: ContentCard[] = [],
    origin: DetailOriginContext = { surface: "home" },
  ): void {
    const openedAt = Date.now();
    const canonicalTab = tabForCard(card, tab);
    this.card = card;
    this.browseTab = canonicalTab;
    this.personalizationOwner = { ...owner };
    this.origin = origin;
    this.saved = saved;
    this.notInterested = false;
    this.setNotInterestedLabel("not for me");
    this.setNotInterestedDisabled(true);
    this.homeVisibleCards = homeVisible;
    this.streams = [];
    this.streamButtons = [];
    this.seriesEpisodes = null;
    this.listFocusables = [];
    this.seasonChipButtons = [];
    this.activeSeason = null;
    this.selectedEpisodeId = null;
    this.focusedEl = null;
    this.streamList.replaceChildren();
    this.seasonList.replaceChildren();
    this.seasonList.hidden = true;
    this.episodeList.replaceChildren();
    this.streamsWrap.hidden = true;
    this.episodesWrap.hidden = true;
    this.setListLabel("episodes");
    // The eyebrow echoes the rail label the card came from ("For You", "Top Picks");
    // preserve the catalog's casing rather than reformatting it.
    this.eyebrow.textContent = railLabel.trim();
    this.renderRelated([], railLabel, canonicalTab);
    void this.loadRelated(card, railLabel, canonicalTab);
    this.title.textContent = card.title;
    this.meta.textContent = card.subtitle;
    this.updateVerifyBadge(card.inLibrary, card.queuedForVerify);
    this.description.textContent = card.description || "loading details…";
    this.poster.src = resolveCardPosterUrl(card, "large");
    bindPosterImage(this.poster, card.title);
    this.poster.alt = "";
    const backdrop = this.view.querySelector<HTMLImageElement>("#detail-backdrop-image");
    if (backdrop) {
      backdrop.src = resolveCardPosterUrl(card, "large");
      bindPosterImage(backdrop, "");
    }
    this.view.classList.toggle("detail--youtube", canonicalTab === "youtube");
    this.view.classList.remove("hidden");
    const isLive = canonicalTab === "live";
    const isYoutube = canonicalTab === "youtube";
    this.notInterestedButton.hidden = card.type !== "youtube_video";
    if (["movie", "series", "youtube_video"].includes(card.type)) {
      void this.loadNotInterestedState(card, owner);
    }
    this.updateSaveButton();
    this.updatePlayButtonLabel();
    this.applyFocus();
    void publishCurrentLibraryContext(canonicalTab, card, owner, openedAt).catch(() => undefined);
    void noteRecommendationDetailOpen(card).catch(() => undefined);
    void this.ratingSheet.bindCard(
      card,
      !isLive && !isYoutube && (card.type === "movie" || card.type === "series"),
      owner,
    ).then(() => {
      if (this.card !== card) return;
      this.syncNotForMePlacement(card);
    });
    const playable = this.canPlayCard(card);
    void this.loadFullMeta(card);
    if (isYoutube && !playable) {
      void this.loadYoutubeList(card);
    } else if (!isLive && !isYoutube) {
      if (card.type === "series") {
        void this.loadEpisodeList(card);
      } else {
        void this.loadStreamList(card);
      }
    }
  }

  hide(): void {
    if (!this.isOpen) {
      return;
    }
    const origin = this.origin;
    void this.ratingSheet.detailClosing();
    this.stopNextPromptPoll();
    this.playToken += 1;
    this.streamsLoadToken += 1;
    this.episodesLoadToken += 1;
    this.resolvingPlay = false;
    this.streamsPending = false;
    this.clearPlayBusy();
    this.playAbort?.abort();
    this.playAbort = null;
    this.card = null;
    this.personalizationOwner = null;
    this.pendingEpisodeRestore = null;
    this.playbackReturnEpisodeId = null;
    clearPlaybackReturnSnapshot();
    this.streams = [];
    this.streamButtons = [];
    this.seriesEpisodes = null;
    this.listFocusables = [];
    this.seasonChipButtons = [];
    this.activeSeason = null;
    this.selectedEpisodeId = null;
    this.focusedEl = null;
    this.streamList.replaceChildren();
    this.seasonList.replaceChildren();
    this.seasonList.hidden = true;
    this.episodeList.replaceChildren();
    this.streamsWrap.hidden = true;
    this.episodesWrap.hidden = true;
    this.relatedTrack.replaceChildren();
    this.relatedButtons = [];
    this.relatedWrap.classList.add("hidden");
    this.updateVerifyBadge(undefined, undefined);
    this.homeVisibleCards = [];
    this.relatedLoadToken += 1;
    this.origin = { surface: "home" };
    this.view.classList.remove("detail--youtube");
    this.view.classList.add("hidden");
    this.callbacks.onClose(origin);
  }

  moveRow(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    if (this.ratingSheet.moveRow(delta)) return;
    this.navigate(delta > 0 ? "down" : "up");
  }

  moveCol(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    if (this.ratingSheet.moveCol(delta)) return;
    // D-pad only navigates the page spatially. Seasons are cycled exclusively by
    // the shoulder buttons (changeSeason) or by clicking a season chip — so
    // ←/→ on an episode escapes the list (e.g. back to the action buttons)
    // instead of being trapped cycling seasons.
    this.navigate(delta > 0 ? "right" : "left");
  }

  /** Shoulder buttons (L/R) or F6/F7 — cycle seasons while a season chip or any
   *  episode in the list is focused. No-op elsewhere. */
  changeSeason(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    if (this.ratingSheet.isOpen) return;
    this.tryChangeSeason(delta);
  }

  activate(): void {
    if (!this.isOpen) {
      return;
    }
    if (this.ratingSheet.activate()) return;
    if (this.focusedEl instanceof HTMLButtonElement && !this.focusedEl.disabled) {
      this.focusedEl.click();
    }
  }

  back(): void {
    if (this.ratingSheet.back()) return;
    if (this.isResolving()) {
      this.cancelResolve();
      return;
    }
    this.hide();
  }

  secondary(): void {
    this.ratingSheet.secondary();
  }

  /** @deprecated Use moveRow/moveCol */
  moveFocus(delta: number): void {
    this.moveRow(delta);
  }

  async play(preferUrl?: string, preferLadderStep?: string, episodeIdOverride?: string): Promise<void> {
    const card = this.card;
    const owner = this.personalizationOwner;
    if (!card || !owner) {
      return;
    }
    if (!this.canPlayCard(card)) {
      return;
    }
    const episodeId = episodeIdOverride ?? this.playEpisodeId();
    const startSec = this.playStartSec(episodeId);
    this.playButton.disabled = true;
    for (const button of this.streamButtons) {
      button.disabled = true;
    }
    for (const button of this.episodeButtons()) {
      button.disabled = true;
    }
    const token = ++this.playToken;
    const attemptStartedAt = Date.now();
    this.playAbort?.abort();
    const abort = new AbortController();
    this.playAbort = abort;
    this.resolvingPlay = true;
    savePlaybackReturnSnapshot(
      this.browseTab,
      card,
      episodeId,
      this.origin.surface,
      this.origin.searchState,
      owner,
    );
    this.publishPlayProgress(playWaitCopy.next());
    const waitCopyTimer = window.setInterval(() => {
      if (this.playToken === token && this.card?.id === card.id && this.resolvingPlay) {
        this.publishPlayProgress(playWaitCopy.next());
      }
    }, PLAY_WAIT_ROTATE_MS);
    try {
      const result = await playCard(card, {
        expectedOwner: owner,
        signal: abort.signal,
        preferUrl,
        preferLadderStep,
        startSec,
        episodeId: card.type === "series" ? episodeId : undefined,
      });
      if (this.playToken !== token) {
        return;
      }
      const label = result.stream?.display_label || result.stream?.quality;
      void label;
      // Series: clear any prior "tap to retry" grey once Phase A+B actually started.
      if (card.type === "series" && episodeId) {
        this.setEpisodeStreamBadge(episodeId, true);
      }
      this.callbacks.onPlayed?.(card, result);
      // Next-episode prompt is checked on playback RETURN (see
      // maybePromptNextEpisode) — never mid-play — so it only ever appears after
      // the episode is finished, not while the viewer is still watching.
    } catch (error) {
      if (abort.signal.aborted || (error instanceof Error && error.message === "play cancelled")) {
        if (this.playToken === token) {
          clearPlaybackReturnSnapshot();
        }
        return;
      }
      if (this.playToken !== token) {
        return;
      }
      if (error instanceof CatalogOwnershipChangedError) {
        clearPlaybackReturnSnapshot();
        showToast("profile changed — reopen this title", { tone: "warning" });
        return;
      }
      if (
        card.type === "series"
        && episodeId
        && await reconcileEpisodePlayTimeout(
          error,
          episodeId,
          attemptStartedAt,
          () => loadSeriesEpisodes(card.id),
        )
      ) {
        if (this.playToken === token && this.card?.id === card.id) {
          this.setEpisodeStreamBadge(episodeId, true);
          this.callbacks.onPlayed?.(card, { ok: true });
        }
        return;
      }
      if (
        card.type === "series"
        && card.source === "external"
        && this.origin.surface === "search"
        && isConfirmedNoStreamsError(error)
      ) {
        this.callbacks.onConfirmedUnavailable?.(card);
      }
      // Series: mark the episode retryable so a later click re-runs /play (Phase A+B).
      if (card.type === "series" && episodeId) {
        this.setEpisodeStreamBadge(episodeId, false);
      }
      // Q4A: picker hard-fail — hide that stream ~30 min (no ladder fallthrough).
      if (preferUrl) {
        this.hiddenStreamUntil.set(preferUrl, Date.now() + 30 * 60 * 1000);
        this.streams = this.visibleStreams(this.streams);
        this.renderStreams();
      }
      clearPlaybackReturnSnapshot();
      const message = error instanceof Error ? error.message : "couldn't start playback. try another title.";
      showToast(playErrorMessage(message), { tone: "error" });
    } finally {
      window.clearInterval(waitCopyTimer);
      if (this.playAbort === abort) {
        this.playAbort = null;
      }
      // Only the latest play owns the play button + resolving flag. A play that
      // was superseded (aborted by a newer resolve, e.g. picking a specific
      // stream) must NOT clear the busy label — doing so produced the
      // "progress → idle play/resume → progress again" flip mid-resolve.
      if (this.playToken === token) {
        this.resolvingPlay = false;
        this.clearPlayBusy();
        this.playButton.disabled = false;
        for (const button of this.streamButtons) {
          button.disabled = false;
        }
        for (const button of this.episodeButtons()) {
          button.disabled = false;
        }
      }
    }
  }

  private primaryEpisodeId(): string | undefined {
    const card = this.card;
    if (!card || card.type !== "series") {
      return undefined;
    }
    if (this.seriesEpisodes?.resume?.episode_id) {
      return this.seriesEpisodes.resume.episode_id;
    }
    if (this.seriesEpisodes?.default_episode_id) {
      return this.seriesEpisodes.default_episode_id;
    }
    if (card.playId?.includes(":")) {
      return card.playId;
    }
    return undefined;
  }

  private playEpisodeId(): string | undefined {
    const card = this.card;
    if (!card || card.type !== "series") {
      return undefined;
    }
    if (
      this.focusedEl?.classList.contains("detail-episode")
      && this.focusedEl.dataset.episodeId
    ) {
      return this.focusedEl.dataset.episodeId;
    }
    return this.primaryEpisodeId();
  }

  private playStartSec(episodeId?: string): number | undefined {
    const card = this.card;
    if (!card) {
      return undefined;
    }
    if (card.type === "series" && episodeId) {
      // Per-episode resume only — never borrow another episode's timestamp.
      if (this.seriesEpisodes?.resume?.episode_id === episodeId) {
        const position = this.seriesEpisodes.resume.position_sec;
        return typeof position === "number" && position > 0 ? position : undefined;
      }
      for (const block of this.seriesEpisodes?.seasons ?? []) {
        const row = block.episodes.find((episode) => episode.id === episodeId);
        if (row) {
          const position = row.position_sec;
          return typeof position === "number" && position > 0 ? position : undefined;
        }
      }
      return undefined;
    }
    if (!episodeId || episodeId === card.playId) {
      return card.resumeSec;
    }
    return undefined;
  }

  private actionButtons(): HTMLButtonElement[] {
    return [
      this.playButton,
      this.saveButton,
      this.rateButton,
    ].filter((control): control is HTMLButtonElement => !control.hidden);
  }

  private isFocusableEnabled(element: HTMLElement): boolean {
    if (element.hidden) {
      return false;
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      return false;
    }
    return true;
  }

  private focusElement(element: HTMLElement): void {
    this.focusEl(element);
  }

  private onGridFocused(element: HTMLElement): void {
    for (const control of this.allFocusableElements()) {
      control.classList.toggle("focused", control === element);
    }
    this.onEpisodeFocusChanged(element);
  }

  private allFocusableElements(): HTMLElement[] {
    return [
      ...this.actionButtons(),
      ...this.listFocusables,
      ...this.streamButtons,
      ...this.relatedButtons,
    ];
  }

  private enabledFocusables(): HTMLElement[] {
    return this.allFocusableElements().filter((el) => this.isFocusableEnabled(el));
  }

  private focusEl(el: HTMLElement): void {
    // Scroll first, then paint focus. Deferring the list correction by one rAF
    // produced a visible displaced frame: the newly focused row travelled with
    // the list and snapped back to the centre. The scrollTop write is synchronous,
    // so the ring now appears only at its final resting position.
    this.revealInSidePanel(el);
    this.focusedEl = el;
    el.focus({ preventScroll: true });
    this.onGridFocused(el);
  }

  /**
   * Scroll the side panel so the focused row sits at its vertical centre.
   *
   * `scrollIntoView({ block: "nearest" })` cannot be used here. "Nearest" scrolls
   * the minimum distance needed to make the row visible, which parks it flush
   * against the edge it entered from — measured at 0px of footroom for 9 of 14
   * stream rows, clipping the 3px focus ring and its 14px glow, since the panel
   * carries `--focus-gutter` on the inline axis only. Centring is also what makes
   * the per-item edge dissolve safe: the focused row is structurally incapable of
   * being in a dissolve band, so its ring can never be faded.
   *
   * A centred row's offset is a pure function of its index, so every resting
   * position lands on the same sub-pixel phase and the partially-visible rows at
   * the edges are always cut in the same place. That is what makes the cut read as
   * deliberate rather than as breakage.
   *
   * Rows outside the panel (action buttons, related posters) keep the default
   * behaviour — they are not in a scrollport that clips.
   */
  /**
   * The scrolling lists in the side column.
   *
   * The scrollport is each list, not the `.detail-side` column that holds them.
   * `.detail-side` used to scroll, which meant the "streams · 14 · 4K–SD" heading
   * scrolled away with the rows — losing the count and range at exactly the moment
   * the user starts scrolling and needs to know how far the ladder reaches. A heading
   * for a list should not be inside the list's scrollport.
   *
   * Streams and episodes are mutually exclusive in practice, but both are handled
   * rather than "the visible one" so nothing depends on render order.
   */
  private scrollLists(): HTMLElement[] {
    if (this.scrollListEls === undefined) {
      this.scrollListEls = [".detail-stream-list", ".detail-episode-list"]
        .map((selector) => this.view.querySelector<HTMLElement>(selector))
        .filter((el): el is HTMLElement => el !== null);
      for (const list of this.scrollListEls) {
        // Passive, and cheap: these lists have no `scroll-behavior: smooth`, so they
        // jump on focus changes rather than animating, and the handler fires at D-pad
        // rate instead of once per frame. Registered here rather than only in
        // revealInSidePanel so the fade stays correct if anything else scrolls them.
        list.addEventListener("scroll", () => this.updateEdgeFade(), { passive: true });
      }
    }
    return this.scrollListEls;
  }

  /** The scrolling list containing `el`, or null when `el` is outside them all. */
  private scrollListFor(el: HTMLElement): HTMLElement | null {
    return this.scrollLists().find((list) => list.contains(el)) ?? null;
  }

  /**
   * Size the panel's top and bottom edge fades to the content actually hidden.
   *
   * Each band is "how much is out of view on this side", capped at
   * `--panel-edge-fade`. That makes the fade structurally incapable of lying: it is 0
   * at the top of the list, 0 at the bottom, and 0 when the list is short enough not
   * to scroll — which was the specific failure of the container gradient this
   * replaces, a fade sitting at full strength over the last row with nothing beneath
   * it.
   *
   * It also removes the need to exempt the focused row. Centred focus keeps that row
   * mid-panel, and at the clamped first and last rows the band on the side it is
   * touching is 0, so its ring is never masked.
   *
   * Reports raw hidden distances and lets CSS cap them at `--panel-edge-fade`, rather
   * than reading that token here. Custom properties come back as specified rather
   * than resolved, so a `rem` band would need the root font size reconstructed in JS
   * to be useful — this way the band stays a pure style decision and this method
   * stays a pure measurement.
   */
  private updateEdgeFade(): void {
    for (const list of this.scrollLists()) {
      const hidden = Math.max(0, list.scrollHeight - list.clientHeight);
      const above = Math.max(0, Math.min(list.scrollTop, hidden));
      list.style.setProperty("--panel-hidden-top", `${above}px`);
      list.style.setProperty("--panel-hidden-bottom", `${hidden - above}px`);
    }
  }

  private revealInSidePanel(el: HTMLElement): void {
    const panel = this.scrollListFor(el);
    if (!panel) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      // Still refresh the fade. Arriving on the detail view focuses an action button,
      // which is outside the lists, and without this a freshly rendered list keeps a
      // 0px bottom band and hard-cuts its last visible row until focus first enters it.
      this.updateEdgeFade();
      return;
    }
    // Rects rather than offsetTop/offsetHeight: offsetTop is measured from the nearest
    // positioned ancestor, which is `.detail-side` and no longer the scrollport, so it
    // would carry the label's height as a constant error. Rect deltas are relative to
    // whatever element is actually scrolling.
    const listRect = panel.getBoundingClientRect();
    const rowRect = el.getBoundingClientRect();
    const offsetInContent = rowRect.top - listRect.top + panel.scrollTop;
    const target = offsetInContent - (panel.clientHeight - rowRect.height) / 2;
    // Clamped: at the first and last rows there is nothing left to scroll, so the
    // row sits off-centre by design rather than the list inventing empty space.
    // The focus gutter keeps the ring intact in exactly those two cases.
    const max = panel.scrollHeight - panel.clientHeight;
    panel.scrollTop = Math.max(0, Math.min(target, max));
    // Synchronously, not just via the scroll listener: assigning scrollTop queues the
    // scroll event, so waiting for it would leave the mask a frame stale, and a row
    // can visibly pop from masked to clear as focus lands on it.
    this.updateEdgeFade();
  }

  private navigate(direction: "up" | "down" | "left" | "right"): void {
    const current = this.focusedEl;
    if (!current) {
      return;
    }
    const curRect = current.getBoundingClientRect();
    const ccx = curRect.left + curRect.width / 2;
    const ccy = curRect.top + curRect.height / 2;
    const eps = 2;
    const horizontal = direction === "left" || direction === "right";
    // Episodes are a vertical list inside the right rail. Horizontal moves from
    // an episode should cross OUT to the left column (action buttons / related),
    // not land on a season chip that happens to sit up-and-left — so exclude the
    // in-rail list items (season chips + episodes) as horizontal targets here.
    const fromEpisode = current.classList.contains("detail-episode");
    // Left from an episode escapes the right rail straight to the action column
    // (play/save) rather than the spatially-closest related-title poster —
    // "press left on an episode → focus the buttons on the left" (issue 3).
    if (direction === "left" && fromEpisode) {
      const action = this.actionButtons().find((button) => this.isFocusableEnabled(button));
      if (action) {
        this.focusEl(action);
        return;
      }
    }
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const candidate of this.enabledFocusables()) {
      if (candidate === current) {
        continue;
      }
      if (
        horizontal
        && fromEpisode
        && (candidate.classList.contains("detail-episode")
          || candidate.classList.contains("detail-season-chip"))
      ) {
        continue;
      }
      const rect = candidate.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let keep: boolean;
      switch (direction) {
        case "right":
          keep = cx > ccx + eps;
          break;
        case "left":
          keep = cx < ccx - eps;
          break;
        case "down":
          keep = cy > ccy + eps;
          break;
        case "up":
        default:
          keep = cy < ccy - eps;
          break;
      }
      if (!keep) {
        continue;
      }
      let primary: number;
      let secondary: number;
      let beamAligned: boolean;
      if (horizontal) {
        primary = Math.abs(cx - ccx);
        secondary = Math.abs(cy - ccy);
        beamAligned = rect.bottom > curRect.top && rect.top < curRect.bottom;
      } else {
        primary = Math.abs(cy - ccy);
        secondary = Math.abs(cx - ccx);
        beamAligned = rect.right > curRect.left && rect.left < curRect.right;
      }
      const score = primary + secondary * 2 + (beamAligned ? 0 : 1_000_000);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) {
      this.focusEl(this.entryTarget(current, best));
    }
  }

  /**
   * Where focus should land when it crosses INTO the scrolling side panel.
   *
   * Spatial scoring picks whichever row is beam-aligned with the control focus just
   * left, which put entry at stream[4] arriving from `back` and stream[8] arriving
   * from below — partway down a list that is deliberately sorted best-first, so the
   * top of the ladder was never what the user saw first. Nothing was unreachable
   * (Up walks to the top) but the ordering only pays for itself if entry starts at
   * the top.
   *
   * Only redirects on the way in. Moves already inside the panel keep pure
   * geometry, so walking the list still behaves like walking a list.
   */
  private entryTarget(from: HTMLElement, to: HTMLElement): HTMLElement {
    const panel = this.scrollListFor(to);
    // Not entering a list at all, or already inside the one being entered — a season
    // chip sits outside the list and above it, so landing there is already entry at
    // the top and needs no redirect.
    if (!panel || panel.contains(from)) {
      return to;
    }
    const first = Array.from(panel.children)
      .filter((row): row is HTMLElement => row instanceof HTMLElement)
      .find((row) => this.isFocusableEnabled(row));
    return first ?? to;
  }

  private applyFocus(): void {
    const focusables = this.enabledFocusables();
    if (focusables.length === 0) {
      this.focusedEl = null;
      return;
    }
    const keep = this.focusedEl && focusables.includes(this.focusedEl) ? this.focusedEl : null;
    const play = !this.playButton.hidden && !this.playButton.disabled ? this.playButton : null;
    this.focusEl(keep ?? play ?? focusables[0]);
  }

  private async loadRelated(card: ContentCard, railLabel: string, tab: BrowseTab): Promise<void> {
    const token = this.relatedLoadToken + 1;
    this.relatedLoadToken = token;
    try {
      const related = await loadRailRelatedCards(
        card,
        this.homeVisibleCards,
        tab,
        relatedTitlesLimit(tab).fetch,
      );
      if (token !== this.relatedLoadToken || this.card?.id !== card.id || this.card?.type !== card.type) {
        return;
      }
      this.renderRelated(related, railLabel, tab);
      this.applyFocus();
    } catch {
      if (token !== this.relatedLoadToken) {
        return;
      }
      this.renderRelated([], railLabel, tab);
    }
  }

  private renderRelated(related: ContentCard[], railLabel: string, tab: BrowseTab): void {
    this.relatedTrack.replaceChildren();
    this.relatedButtons = [];
    const card = this.card;
    const siblings = related
      .filter((sibling) => !card || sibling.id !== card.id || sibling.type !== card.type)
      .slice(0, relatedTitlesLimit(tab).display);
    if (siblings.length === 0) {
      this.relatedWrap.classList.add("hidden");
      return;
    }
    this.relatedLabel.textContent = relatedLabelForTab(tab);
    // The provenance line ("from continue watching") is deliberately gone. It was
    // restating where the user just came from, which they know, and its 28px was
    // taken out of the stream/episode panel directly above — the one place on this
    // view that is actually short of room. The element stays in index.html and is
    // kept blank so the label's own layout is unaffected.
    const contextEl = this.relatedWrap.querySelector<HTMLElement>("#detail-related-context");
    if (contextEl) {
      contextEl.hidden = true;
      contextEl.textContent = "";
    }
    for (const sibling of siblings) {
      const button = this.createRelatedCard(sibling, railLabel, tab);
      this.relatedTrack.append(button);
      this.relatedButtons.push(button);
    }
    armDeferredPosterSources(this.relatedTrack);
    this.relatedWrap.classList.remove("hidden");
  }

  private createRelatedCard(
    sibling: ContentCard,
    railLabel: string,
    tab: BrowseTab,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    const landscape = isLandscapeCard(sibling, tab);
    // Same reveal-on-focus treatment as the home rails: a wall of permanently
    // labelled posters is duplicated text noise, since the art carries the title.
    // Gated on tab exactly as home.ts gates it, so the two surfaces cannot drift
    // into showing labels under different conditions. Landscape cards always show
    // title text under the thumb, matching Home YouTube rails.
    const minimalLabels = MINIMAL_VOD_POSTER_LABELS
      && !landscape
      && (tab === "movies" || tab === "series");
    button.className = `card card--poster card--related${landscape ? " card--landscape" : " card--portrait"}`;
    if (minimalLabels) {
      button.classList.add("card--poster-minimal");
    }
    button.dataset.focusKey = `detail:related:${sibling.type}:${sibling.id}`;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `${sibling.title}, ${sibling.subtitle}`);

    const poster = document.createElement("img");
    poster.className = "poster-image";
    poster.alt = "";
    poster.decoding = "async";
    const posterUrl = resolveCardPosterUrl(sibling);
    if (posterUrl) {
      poster.dataset.posterSrc = posterUrl;
    }
    bindPosterImage(poster, sibling.title);

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = sibling.title;

    const subtitle = document.createElement("span");
    subtitle.className = "card-subtitle";
    subtitle.textContent = minimalLabels ? posterRevealMeta(sibling) : sibling.subtitle;

    const content = document.createElement("span");
    content.className = "poster-content";
    content.append(title, subtitle);

    const livePill = shouldShowLivePill(sibling, tab)
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
      if (sibling.progressPct !== undefined && sibling.progressPct > 0) {
        const progress = document.createElement("span");
        progress.className = "poster-progress";
        progress.setAttribute("aria-hidden", "true");
        progress.style.setProperty("--progress", `${Math.round(sibling.progressPct * 100)}%`);
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

    button.addEventListener("click", () => {
      const saved = this.callbacks.isSaved?.(sibling) ?? false;
      const owner = this.personalizationOwner;
      if (!owner) return;
      this.show(sibling, railLabel, tab, owner, saved, this.homeVisibleCards, this.origin);
    });
    return button;
  }

  private episodeButtons(): HTMLButtonElement[] {
    return [...this.episodeList.querySelectorAll<HTMLButtonElement>("button.detail-episode")];
  }

  private episodeButtonForId(episodeId: string): HTMLButtonElement | null {
    return this.episodeList.querySelector<HTMLButtonElement>(
      `button.detail-episode[data-episode-id="${episodeId}"]`,
    );
  }

  /** Focus an episode across season boundaries without changing its play state. */
  private focusEpisodeById(episodeId: string): boolean {
    const season = this.seasonForEpisodeId(episodeId);
    if (season === null) {
      return false;
    }
    this.selectedEpisodeId = episodeId;
    if (season !== this.activeSeason) {
      this.setActiveSeason(season, { focusEpisodeId: episodeId });
      return this.focusedEl?.dataset.episodeId === episodeId;
    }
    const button = this.episodeButtonForId(episodeId);
    if (!button) {
      return false;
    }
    this.applyEpisodeSelectionVisual(episodeId);
    this.focusElement(button);
    return true;
  }

  private rebuildListFocusables(): void {
    this.listFocusables = [
      ...this.seasonChipButtons,
      ...this.episodeButtons(),
    ];
  }

  private hasMultipleSeasons(): boolean {
    return (this.seriesEpisodes?.seasons.length ?? 0) > 1;
  }

  private seasonBlock(season: number): SeriesSeasonBlock | undefined {
    return this.seriesEpisodes?.seasons.find((block) => block.season === season);
  }

  private seasonForEpisodeId(episodeId: string): number | null {
    for (const block of this.seriesEpisodes?.seasons ?? []) {
      if (block.episodes.some((episode) => episode.id === episodeId)) {
        return block.season;
      }
    }
    return null;
  }

  private resolveInitialSeason(episodes: SeriesEpisodesResponse): number {
    const seasonFor = (episodeId: string): number | null => {
      for (const block of episodes.seasons) {
        if (block.episodes.some((episode) => episode.id === episodeId)) {
          return block.season;
        }
      }
      return null;
    };
    if (episodes.resume?.episode_id) {
      const resumeSeason = seasonFor(episodes.resume.episode_id);
      if (resumeSeason !== null) {
        return resumeSeason;
      }
    }
    if (episodes.default_episode_id) {
      const defaultSeason = seasonFor(episodes.default_episode_id);
      if (defaultSeason !== null) {
        return defaultSeason;
      }
    }
    return episodes.seasons[0]?.season ?? 1;
  }

  private syncSeasonChipState(): void {
    for (const chip of this.seasonChipButtons) {
      const season = Number(chip.dataset.season || "0");
      chip.classList.toggle("detail-season-chip--active", season === this.activeSeason);
    }
  }

  private tryChangeSeason(delta: number): boolean {
    if (!this.hasMultipleSeasons() || this.activeSeason === null) {
      return false;
    }
    const focused = this.focusedEl;
    if (
      !focused?.classList.contains("detail-season-chip")
      && !focused?.classList.contains("detail-episode")
    ) {
      return false;
    }
    const seasons = this.seriesEpisodes?.seasons ?? [];
    const currentIndex = seasons.findIndex((block) => block.season === this.activeSeason);
    if (currentIndex < 0) {
      return false;
    }
    const nextIndex = (currentIndex + delta + seasons.length) % seasons.length;
    const nextSeason = seasons[nextIndex]?.season;
    if (nextSeason === undefined) {
      return false;
    }
    let focusEpisodeIndex = 0;
    if (focused.classList.contains("detail-episode")) {
      const block = this.seasonBlock(this.activeSeason);
      const episodeId = focused.dataset.episodeId;
      if (block && episodeId) {
        const index = block.episodes.findIndex((episode) => episode.id === episodeId);
        if (index >= 0) {
          focusEpisodeIndex = index;
        }
      }
    } else {
      const chipIndex = this.seasonChipButtons.indexOf(focused as HTMLButtonElement);
      if (chipIndex >= 0) {
        focusEpisodeIndex = 0;
      }
    }
    this.setActiveSeason(nextSeason, { focusEpisodeIndex, focusChip: focused.classList.contains("detail-season-chip") });
    return true;
  }

  private setActiveSeason(
    season: number,
    options: { focusEpisodeIndex?: number; focusEpisodeId?: string; focusChip?: boolean } = {},
  ): void {
    const block = this.seasonBlock(season);
    if (!block) {
      return;
    }
    this.activeSeason = season;
    this.renderActiveSeasonEpisodes(block);
    this.syncSeasonChipState();
    this.rebuildListFocusables();

    if (options.focusChip) {
      const chip = this.seasonChipButtons.find((button) => Number(button.dataset.season) === season);
      if (chip) {
        this.focusElement(chip);
        return;
      }
    }

    let target: HTMLButtonElement | null = null;
    if (options.focusEpisodeId) {
      target = this.episodeButtonForId(options.focusEpisodeId);
    }
    if (!target && options.focusEpisodeIndex !== undefined) {
      const episodes = this.episodeButtons();
      target = episodes[Math.min(options.focusEpisodeIndex, Math.max(episodes.length - 1, 0))] ?? null;
    }
    if (!target) {
      target = this.episodeButtons()[0] ?? null;
    }
    if (target) {
      this.focusElement(target);
    } else {
      this.applyFocus();
    }
  }

  private applyEpisodeSelectionVisual(episodeId: string): void {
    for (const button of this.episodeButtons()) {
      button.classList.toggle(
        "detail-episode--selected",
        button.dataset.episodeId === episodeId,
      );
    }
  }

  private setEpisodeStreamBadge(episodeId: string, hasStreams: boolean): void {
    const button = this.episodeButtonForId(episodeId);
    if (!button) {
      return;
    }
    button.classList.toggle("detail-episode--no-streams", !hasStreams);
    button.classList.toggle("detail-episode--has-streams", hasStreams);
    const badge = button.querySelector<HTMLElement>(".detail-episode-stream-badge");
    if (badge) {
      badge.textContent = hasStreams ? "" : "tap to retry";
      badge.hidden = hasStreams;
    }
  }

  private isYoutubeCard(card: ContentCard | null | undefined): boolean {
    return Boolean(card && tabForCard(card) === "youtube");
  }

  private canPlayCard(card: ContentCard | null | undefined): boolean {
    if (!card) {
      return false;
    }
    if (!this.isYoutubeCard(card)) {
      return true;
    }
    return card.type === "youtube_video" || card.kind === "video";
  }

  private canSaveCard(card: ContentCard | null | undefined): boolean {
    if (!card) {
      return false;
    }
    if (!this.isYoutubeCard(card)) {
      return true;
    }
    return card.type === "youtube_video" || card.kind === "video";
  }

  /** Renders the in_library / queued_for_verify chip — undefined/false hides it. */
  private updateVerifyBadge(inLibrary: boolean | undefined, queuedForVerify: boolean | undefined): void {
    if (inLibrary) {
      this.verifyBadge.hidden = false;
      this.verifyBadge.textContent = "in library";
      this.verifyBadge.dataset.state = "in_library";
      return;
    }
    if (queuedForVerify) {
      this.verifyBadge.hidden = false;
      this.verifyBadge.textContent = "queued";
      this.verifyBadge.dataset.state = "queued";
      return;
    }
    this.verifyBadge.hidden = true;
    this.verifyBadge.textContent = "";
    delete this.verifyBadge.dataset.state;
  }

  private setListLabel(label: string): void {
    const labelEl = this.episodesWrap.querySelector<HTMLElement>(".detail-episodes-label");
    if (labelEl) {
      labelEl.textContent = label;
    }
  }

  private updateSaveButton(): void {
    const card = this.card;
    const canSave = this.canSaveCard(card);
    setControlLabel(this.saveButton, this.saved ? "unsave" : "save");
    this.saveButton.setAttribute("aria-pressed", this.saved ? "true" : "false");
    this.saveButton.disabled = !canSave;
  }

  private updatePlayButtonLabel(): void {
    const card = this.card;
    if (!card) {
      return;
    }
    if (!this.canPlayCard(card)) {
      this.setPlayButtonText("select video");
      this.playButton.disabled = true;
      return;
    }
    this.playButton.disabled = false;
    const isLive = tabForCard(card, this.browseTab) === "live";
    if (this.isYoutubeCard(card)) {
      this.setPlayButtonText(card.liveStatus === "live" ? "watch live" : "play");
      return;
    }
    if (isLive) {
      this.setPlayButtonText("watch live");
      return;
    }
    const hasResume = Boolean(card.resumeSec)
      || Boolean(this.seriesEpisodes?.resume)
      || Boolean(card.playId?.includes(":"));
    this.setPlayButtonText(hasResume ? "resume" : "play");
  }

  private async toggleSaved(): Promise<void> {
    const card = this.card;
    const owner = this.personalizationOwner;
    if (!card || !owner) {
      return;
    }
    if (!this.canSaveCard(card)) {
      showToast("only YouTube videos can be saved.", { tone: "warning" });
      return;
    }
    this.saveButton.disabled = true;
    try {
      if (this.saved) {
        await unsaveCard(card, owner);
        this.saved = false;
        showToast("removed from saved.", { tone: "success" });
      } else {
        await saveCard(this.browseTab, card, owner);
        this.saved = true;
        showToast("saved — find it in your Saved rail.", { tone: "success" });
      }
      this.updateSaveButton();
      this.callbacks.onSavedChanged?.(card);
    } catch (error) {
      showToast(
        error instanceof CatalogOwnershipChangedError
          ? "profile changed — reopen this title"
          : "couldn't update saved",
        { tone: error instanceof CatalogOwnershipChangedError ? "warning" : "error" },
      );
    } finally {
      this.saveButton.disabled = !this.canSaveCard(this.card);
    }
  }

  private setNotInterestedLabel(text: string): void {
    setControlLabel(this.notInterestedButton, text);
    this.ratingSheet.setNotForMeLabel(text);
  }

  private setNotInterestedDisabled(disabled: boolean): void {
    this.notInterestedButton.disabled = disabled;
    this.ratingSheet.setNotForMeDisabled(disabled);
  }

  private syncNotForMePlacement(card: ContentCard): void {
    const canHide = ["movie", "series", "youtube_video"].includes(card.type);
    this.notInterestedButton.hidden = !canHide || !this.rateButton.hidden;
  }

  private async markNotInterested(): Promise<void> {
    const card = this.card;
    const owner = this.personalizationOwner;
    if (!card || !owner) {
      return;
    }
    this.setNotInterestedDisabled(true);
    try {
      if (this.notInterested) {
        await undoNotInterestedCard(card, this.browseTab, owner);
        this.notInterested = false;
        this.setNotInterestedLabel("not for me");
        showToast("back in recommendations.", { tone: "success" });
      } else {
        await notInterestedCard(card, this.browseTab, owner);
        this.notInterested = true;
        this.setNotInterestedLabel("undo not for me");
        showToast("removed from recommendations — undo is available here.", {
          tone: "success",
          durationMs: 6000,
        });
      }
      this.callbacks.onSavedChanged?.(card);
    } catch (error) {
      showToast(
        error instanceof CatalogOwnershipChangedError
          ? "profile changed — reopen this title"
          : "couldn't update recommendations",
        { tone: error instanceof CatalogOwnershipChangedError ? "warning" : "error" },
      );
    } finally {
      this.setNotInterestedDisabled(false);
    }
  }

  private async loadNotInterestedState(
    card: ContentCard,
    owner: PersonalizationOwner,
  ): Promise<void> {
    try {
      const hidden = await isNotInterestedCard(card, owner);
      if (this.card !== card || !this.personalizationOwner
        || !samePersonalizationOwner(this.personalizationOwner, owner)) return;
      this.notInterested = hidden;
      this.setNotInterestedLabel(hidden ? "undo not for me" : "not for me");
    } catch {
      // Last-good behavior: a state-read failure must not prevent an explicit
      // new choice. The mutation itself still fails closed with a toast.
      if (this.card !== card || !this.personalizationOwner
        || !samePersonalizationOwner(this.personalizationOwner, owner)) return;
      this.notInterested = false;
      this.setNotInterestedLabel("not for me");
    } finally {
      if (this.card === card && this.personalizationOwner
        && samePersonalizationOwner(this.personalizationOwner, owner)) {
        this.setNotInterestedDisabled(false);
      }
    }
  }

  private async loadEpisodeList(card: ContentCard): Promise<void> {
    const token = ++this.episodesLoadToken;
    try {
      const episodes = await loadSeriesEpisodes(seriesBareId(card.id));
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.seriesEpisodes = episodes;
      const restoringEpisode = this.pendingEpisodeRestore;
      this.pendingEpisodeRestore = null;
      const focusEpisodeId = restoringEpisode
        ?? episodes.resume?.episode_id
        ?? episodes.default_episode_id
        ?? null;
      if (focusEpisodeId) {
        this.selectedEpisodeId = focusEpisodeId;
      }
      this.renderEpisodes(episodes, focusEpisodeId);
      this.updatePlayButtonLabel();
      // Series never shows a stream list — playback resolves via /play (Phase A+B).
    } catch {
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.seriesEpisodes = null;
      this.episodesWrap.hidden = true;
      this.seasonList.hidden = true;
      this.streamsWrap.hidden = true;
    }
  }

  private async loadYoutubeList(card: ContentCard): Promise<void> {
    const token = ++this.episodesLoadToken;
    this.episodesWrap.hidden = false;
    this.setListLabel("videos");
    this.episodeList.replaceChildren();
    try {
      const cards = await loadYoutubeDetailCards(card);
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.renderYoutubeList(cards);
    } catch {
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.episodeList.replaceChildren();
      this.listFocusables = [];
      this.episodesWrap.hidden = true;
      this.applyFocus();
    }
  }

  private renderYoutubeList(cards: ContentCard[]): void {
    this.episodeList.replaceChildren();
    this.listFocusables = [];
    if (cards.length === 0) {
      this.episodesWrap.hidden = true;
      this.applyFocus();
      return;
    }
    this.episodesWrap.hidden = false;
    for (const video of cards) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "detail-episode";
      const label = document.createElement("span");
      label.className = "detail-episode-label";
      label.textContent = video.title;
      const progress = document.createElement("span");
      progress.className = "detail-episode-progress";
      progress.textContent = video.subtitle;
      button.append(label, progress);
      button.addEventListener("click", () => {
        const owner = this.personalizationOwner;
        if (!owner) return;
        this.show(video, "YouTube", "youtube", owner, false, [], this.origin);
      });
      this.episodeList.append(button);
    }
    this.rebuildListFocusables();
    this.applyFocus();
  }

  private renderEpisodes(
    episodes: SeriesEpisodesResponse,
    focusEpisodeId: string | null = null,
    options: { autoFocusEpisode?: boolean } = {},
  ): void {
    const autoFocusEpisode = options.autoFocusEpisode !== false;
    this.episodeList.replaceChildren();
    this.seasonList.replaceChildren();
    this.seasonChipButtons = [];
    this.listFocusables = [];
    const flatCount = episodes.seasons.reduce((total, block) => total + block.episodes.length, 0);
    if (flatCount === 0) {
      this.episodesWrap.hidden = true;
      this.seasonList.hidden = true;
      this.activeSeason = null;
      this.applyFocus();
      return;
    }

    this.episodesWrap.hidden = false;
    this.activeSeason = focusEpisodeId
      ? (this.seasonForEpisodeId(focusEpisodeId) ?? this.resolveInitialSeason(episodes))
      : this.resolveInitialSeason(episodes);
    this.renderSeasonChips(episodes);
    const block = this.seasonBlock(this.activeSeason);
    if (!block) {
      this.applyFocus();
      return;
    }
    this.renderActiveSeasonEpisodes(block, focusEpisodeId);
    this.rebuildListFocusables();

    const scrollTarget = focusEpisodeId ? this.episodeButtonForId(focusEpisodeId) : null;
    scrollTarget?.scrollIntoView({ block: "nearest", behavior: "instant" });
    if (autoFocusEpisode) {
      if (scrollTarget) {
        this.focusElement(scrollTarget);
      } else {
        this.applyFocus();
      }
    }
  }

  private renderSeasonChips(episodes: SeriesEpisodesResponse): void {
    if (episodes.seasons.length <= 1) {
      this.seasonList.hidden = true;
      return;
    }
    this.seasonList.hidden = false;
    for (const block of episodes.seasons) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "detail-season-chip";
      chip.dataset.season = String(block.season);
      chip.textContent = block.label;
      chip.addEventListener("click", () => {
        this.setActiveSeason(block.season, { focusEpisodeIndex: 0 });
      });
      this.seasonList.append(chip);
      this.seasonChipButtons.push(chip);
    }
    this.syncSeasonChipState();
  }

  private renderActiveSeasonEpisodes(
    block: SeriesSeasonBlock,
    scrollTargetId: string | null = null,
  ): void {
    this.setListLabel(`episodes · ${block.episodes.length}`);
    this.episodeList.replaceChildren();
    for (const episode of block.episodes) {
      this.episodeList.append(this.createEpisodeButton(episode, scrollTargetId));
    }
  }

  private createEpisodeButton(
    episode: SeriesEpisodeRow,
    scrollTargetId: string | null = null,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-episode";
    if (episode.id === this.selectedEpisodeId) {
      button.classList.add("detail-episode--selected");
    }
    if (episode.id === scrollTargetId) {
      button.dataset.scrollTarget = "true";
    }

    const label = document.createElement("span");
    label.className = "detail-episode-label";
    label.textContent = episodeRowLabel(episode);

    const progress = document.createElement("span");
    progress.className = "detail-episode-progress";
    progress.textContent = episodeProgressLabel(episode.progress_pct);

    const badge = document.createElement("span");
    badge.className = "detail-episode-stream-badge";
    badge.hidden = true;

    button.dataset.episodeId = episode.id;
    // Backend playability hint only — never block retry. Greyed episodes stay
    // clickable and re-run /play (Phase A+B) on activate.
    if (episode.playable === false) {
      button.classList.add("detail-episode--no-streams");
      badge.textContent = "tap to retry";
      badge.hidden = false;
    } else if (episode.playable === true) {
      button.classList.add("detail-episode--has-streams");
    }
    button.append(label, progress, badge);
    button.addEventListener("click", () => {
      void this.activateEpisode(episode);
    });
    return button;
  }

  private async activateEpisode(episode: SeriesEpisodeRow): Promise<void> {
    const card = this.card;
    if (!card) {
      return;
    }
    this.selectedEpisodeId = episode.id;
    this.applyEpisodeSelectionVisual(episode.id);
    // Series: no stream list. Click (including greyed "tap to retry") always
    // starts /play so the server re-resolves and runs Phase A + B.
    await this.play(undefined, undefined, episode.id);
  }

  private onEpisodeFocusChanged(_target: HTMLElement | undefined): void {
    // No dwell prefetch — series play resolves on activate via /play only.
  }

  /** Movies only — series never shows a stream list. */
  private async loadStreamList(card: ContentCard): Promise<void> {
    if (card.type === "series") {
      this.streams = [];
      this.streamsWrap.hidden = true;
      return;
    }
    const token = ++this.streamsLoadToken;
    this.streamsPending = true;
    this.streams = [];
    this.renderStreamsFinding();
    try {
      const result = await recoverTimedOutStreamList(
        () => loadStreams(card),
        () => loadStreams(card, undefined, { existingOnly: true }),
      );
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = this.visibleStreams(result.streams);
      this.renderStreams();
      if (
        this.streams.length === 0
        && this.origin.surface === "search"
        && card.source === "external"
      ) {
        this.callbacks.onConfirmedUnavailable?.(card);
      }
    } catch {
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = [];
      this.renderStreamsUnavailable();
    } finally {
      if (this.streamsLoadToken === token) {
        this.streamsPending = false;
      }
    }
  }

  private visibleStreams(streams: CatalogStream[]): CatalogStream[] {
    const now = Date.now();
    for (const [url, until] of [...this.hiddenStreamUntil]) {
      if (until <= now) this.hiddenStreamUntil.delete(url);
    }
    return streams.filter((stream) => {
      const until = this.hiddenStreamUntil.get(stream.url);
      return until === undefined;
    });
  }

  private renderStreamsFinding(): void {
    this.streamList.replaceChildren();
    this.streamButtons = [];
    this.streamsWrap.hidden = false;
    this.streamsWrap.classList.remove("detail-streams--unverified");
    const streamsLabel = this.streamsWrap.querySelector(".detail-streams-label");
    if (streamsLabel) {
      streamsLabel.textContent = "streams · finding…";
    }
  }

  private renderStreamsUnavailable(): void {
    this.streamList.replaceChildren();
    this.streamButtons = [];
    this.streamsWrap.hidden = false;
    this.streamsWrap.classList.remove("detail-streams--unverified");
    const streamsLabel = this.streamsWrap.querySelector(".detail-streams-label");
    if (streamsLabel) {
      streamsLabel.textContent = "streams · unavailable — Play retries";
    }
    this.applyFocus();
  }

  private renderStreams(): void {
    // Safety: series detail never surfaces stream bubbles.
    if (this.card?.type === "series") {
      this.streams = [];
      this.streamList.replaceChildren();
      this.streamButtons = [];
      this.streamsWrap.hidden = true;
      this.streamsWrap.classList.remove("detail-streams--unverified");
      return;
    }
    this.streamList.replaceChildren();
    this.streamButtons = [];
    if (this.streams.length === 0) {
      this.streamsWrap.hidden = false;
      this.streamsWrap.classList.remove("detail-streams--unverified");
      const streamsLabel = this.streamsWrap.querySelector(".detail-streams-label");
      if (streamsLabel) {
        streamsLabel.textContent = "streams · none found";
      }
      this.applyFocus();
      return;
    }

    this.streamsWrap.hidden = false;
    const floorOnly = this.streams.every(
      (stream) =>
        stream.unverified === true
        || UNVERIFIED_STREAM_STEPS.has(stream.ladder_step ?? ""),
    );
    this.streamsWrap.classList.toggle("detail-streams--unverified", floorOnly);
    const streamsLabel = this.streamsWrap.querySelector(".detail-streams-label");
    if (streamsLabel) {
      if (floorOnly) {
        // Count first, status second. The old label was "streams · unverified" with no
        // count at all, so the one case where the ladder is least trustworthy was also
        // the only case that refused to say how many options it had — and the count is
        // what decides whether scrolling is worth it. The resolution range is dropped
        // here rather than appended: an all-unverified ladder is usually one tier
        // (10 x 4K on the title this was found on), so the range would add width
        // without adding information, and "unverified" is the fact that has to survive.
        streamsLabel.textContent = `streams · ${this.streams.length} · unverified`;
      } else {
        // The label is lowercased by the shared rail-label style, which would render
        // the range as "4k-sd". Resolution names are proper nouns here and have to
        // match the badges in the rows below, so the summary opts out of the
        // transform in its own span.
        const summary = document.createElement("span");
        summary.className = "detail-streams-summary";
        summary.textContent = streamLadderSummary(this.streams);
        streamsLabel.replaceChildren(document.createTextNode("streams · "), summary);
      }
    }
    for (const stream of this.streams) {
      this.streamList.append(this.createStreamButton(stream));
    }
    this.applyFocus();
  }

  /** Builds one uniform stream bubble: a resolution badge + quality chips + an
   *  audio/size line. Only couch-relevant info, so every bubble is the same
   *  shape and height regardless of the raw release name. */
  private createStreamButton(stream: CatalogStream): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    const unverified =
      stream.unverified === true || UNVERIFIED_STREAM_STEPS.has(stream.ladder_step ?? "");
    button.className = unverified ? "detail-stream detail-stream--unverified" : "detail-stream";

    const primary = document.createElement("span");
    primary.className = "detail-stream-primary";
    const res = document.createElement("span");
    res.className = "detail-stream-res";
    res.dataset.res = streamResolutionLabel(stream).toLowerCase();
    res.textContent = streamResolutionLabel(stream);
    primary.append(res);
    for (const chip of streamQualityChips(stream)) {
      const chipEl = document.createElement("span");
      chipEl.className = `detail-stream-chip detail-stream-chip--${chip.kind}`;
      chipEl.textContent = chip.text;
      primary.append(chipEl);
    }

    const secondary = document.createElement("span");
    secondary.className = "detail-stream-secondary";
    const lang = streamLangLabel(stream);
    if (lang) {
      const langs = document.createElement("span");
      langs.className = "detail-stream-langs";
      langs.textContent = lang;
      secondary.append(langs);
    }
    const size = streamSizeLabel(stream);
    if (size) {
      const sizeEl = document.createElement("span");
      sizeEl.className = "detail-stream-size";
      sizeEl.textContent = size;
      secondary.append(sizeEl);
    }
    // No "unverified" word on the row. The state already has four visual signals —
    // dashed border, dimmed opacity, transparent fill, and a muted resolution badge —
    // so the word only restated what the row's own styling says, once per row. On a
    // title where every stream is unverified that meant the same word ten times down
    // the column, and a label that appears on every row distinguishes nothing.
    // It stays in the accessible name below: a border is not available to a screen
    // reader, so dropping the visual word must not drop the fact.

    button.append(primary, secondary);
    button.setAttribute("aria-label", streamAriaLabel(stream, unverified));
    button.addEventListener("click", () => void this.play(stream.url, stream.ladder_step));
    this.streamButtons.push(button);
    return button;
  }

  private async loadFullMeta(card: ContentCard): Promise<void> {
    if (cardHasCompleteDetailMeta(card)) {
      return;
    }
    try {
      const meta = await loadMeta(card);
      if (!this.card || this.card.id !== card.id || this.card.type !== card.type) {
        return;
      }
      this.title.textContent = meta.name || meta.title || card.title;
      this.meta.textContent = detailMetaLine(meta, card);
      this.updateVerifyBadge(meta.in_library, meta.queued_for_verify);
      this.description.textContent = meta.description || card.description || "no synopsis available";
      if (meta.poster) {
        this.poster.src = meta.poster;
        bindPosterImage(this.poster, meta.name || meta.title || card.title);
      } else {
        const fallback = resolveCardPosterUrl(card, "large");
        if (fallback) {
          this.poster.src = fallback;
          bindPosterImage(this.poster, meta.name || meta.title || card.title);
        }
      }
    } catch {
      if (this.card?.id === card.id) {
        this.description.textContent = card.description || "details unavailable";
        const fallback = resolveCardPosterUrl(card, "large");
        if (fallback && !this.poster.src) {
          this.poster.src = fallback;
          bindPosterImage(this.poster, card.title);
        }
      }
    }
  }

  private startNextPromptPoll(): void {
    this.stopNextPromptPoll();
    let attempts = 0;
    // Short window: the backend sets the pending prompt during the stop/flush,
    // so it is already available on return — a few polls just cover the flush
    // timing race (~9s max), never a long background loop during playback.
    void this.checkNextPrompt();
    this.nextPromptPollTimer = window.setInterval(() => {
      attempts += 1;
      void this.checkNextPrompt();
      if (attempts >= 12) {
        this.stopNextPromptPoll();
      }
    }, 750);
  }

  private stopNextPromptPoll(): void {
    if (this.nextPromptPollTimer !== undefined) {
      window.clearInterval(this.nextPromptPollTimer);
      this.nextPromptPollTimer = undefined;
    }
  }

  private async checkNextPrompt(): Promise<void> {
    const card = this.card;
    const owner = this.personalizationOwner;
    if (!card || !owner || card.type !== "series") {
      return;
    }
    try {
      const hint = await loadNextPrompt(owner);
      if (this.card !== card || !this.personalizationOwner
        || !samePersonalizationOwner(this.personalizationOwner, owner)) {
        return;
      }
      if (!hint.show || !hint.next) {
        return;
      }
      this.stopNextPromptPoll();
      const focusTarget = nextEpisodeFocusTarget(
        card.id,
        this.playbackReturnEpisodeId,
        hint,
      );
      if (!focusTarget) {
        return;
      }
      // On a cold Chromium restart the episode request may still be in flight.
      // Save the target so loadEpisodeList focuses it when rendering completes;
      // otherwise shift focus immediately, including across season boundaries.
      this.pendingEpisodeRestore = focusTarget;
      if (this.seriesEpisodes) {
        this.focusEpisodeById(focusTarget);
      }
      this.callbacks.onStatus(
        `next up: S${hint.next.season} E${hint.next.episode} · ${hint.next.title}`,
        "hint",
      );
    } catch {
      // keep polling until timeout
    }
  }
}

export function isConfirmedNoStreamsError(error: unknown): boolean {
  return error instanceof Error
    && error.message.trim().toLowerCase() === "no streams found for this title";
}

function seriesBareId(id: string): string {
  return id.includes(":") ? id.split(":")[0] : id;
}

/** Accept only the completion hint belonging to the detail/episode being restored. */
export function nextEpisodeFocusTarget(
  cardId: string,
  playbackEpisodeId: string | null | undefined,
  hint: NextPromptResponse,
): string | null {
  if (!hint.show || !hint.next) {
    return null;
  }
  const cardSeriesId = seriesBareId(cardId).toLowerCase();
  if (hint.series_id && seriesBareId(hint.series_id).toLowerCase() !== cardSeriesId) {
    return null;
  }
  if (seriesBareId(hint.next.id).toLowerCase() !== cardSeriesId) {
    return null;
  }
  if (
    playbackEpisodeId
    && hint.from_episode_id
    && hint.from_episode_id.toLowerCase() !== playbackEpisodeId.toLowerCase()
  ) {
    return null;
  }
  return hint.next.id;
}

function episodeRowLabel(episode: SeriesEpisodeRow): string {
  return `S${episode.season} E${episode.episode} · ${episode.title}`;
}

function episodeProgressLabel(progressPct: number | null): string {
  if (progressPct === null || progressPct <= 0) {
    return "";
  }
  return `${Math.round(progressPct * 100)}%`;
}

function detailMetaLine(meta: CatalogMeta, card: ContentCard): string {
  if (tabForCard(card) === "live") {
    return meta.releaseInfo || card.subtitle || "live";
  }
  const parts = [
    meta.year ?? meta.releaseInfo ?? card.year,
    meta.runtime,
    card.type,
  ].filter(Boolean).map(String);
  return parts.join(" · ") || card.subtitle;
}

const STREAM_LANG_CODES: Record<string, string> = {
  english: "EN",
  hindi: "HI",
  japanese: "JA",
  korean: "KO",
  french: "FR",
  german: "DE",
  spanish: "ES",
  italian: "IT",
  portuguese: "PT",
  russian: "RU",
  arabic: "AR",
  tamil: "TA",
  telugu: "TE",
  malayalam: "ML",
  kannada: "KN",
  bengali: "BN",
  punjabi: "PA",
  marathi: "MR",
};

function streamResolutionLabel(stream: CatalogStream): string {
  const haystack = `${stream.resolution ?? ""} ${stream.quality ?? ""} ${stream.display_label ?? ""}`.toLowerCase();
  // Match resolution digits that may carry a trailing p/i (e.g. "2160p") — a
  // plain \b after the digits fails there. Require a non-digit (or edge) before.
  if (/(^|\D)(2160|4320)/.test(haystack) || /\b(4k|uhd)\b/.test(haystack)) return "4K";
  if (/(^|\D)1440/.test(haystack) || /\b2k\b/.test(haystack)) return "1440p";
  if (/(^|\D)1080/.test(haystack)) return "1080p";
  if (/(^|\D)720/.test(haystack)) return "720p";
  if (/(^|\D)(480|576)/.test(haystack) || /\bsd\b/.test(haystack)) return "SD";
  return "auto";
}

function streamTierLabel(stream: CatalogStream): string | null {
  const raw = (stream.release_tier ?? "").toString().trim();
  if (!raw) return null;
  const tier = raw.toLowerCase();
  if (tier.includes("remux")) return "REMUX";
  if (tier.includes("bluray") || tier.includes("blu-ray") || tier === "bd") return "BluRay";
  if (tier.includes("web-dl") || tier.includes("webdl")) return "WEB-DL";
  if (tier.includes("webrip")) return "WEBRip";
  if (tier.includes("hdtv")) return "HDTV";
  if (tier.includes("dvd")) return "DVD";
  if (tier.includes("cam") || tier.includes("telesync")) return "CAM";
  return raw.toUpperCase().slice(0, 8);
}

function streamCodecLabel(stream: CatalogStream): string | null {
  const raw = (stream.encode ?? "").toString().toLowerCase();
  if (!raw) return null;
  if (raw.includes("hevc") || raw.includes("265")) return "HEVC";
  if (raw.includes("av1")) return "AV1";
  if (raw.includes("avc") || raw.includes("264")) return "H.264";
  return raw.toUpperCase().slice(0, 6);
}

function streamHdrLabel(stream: CatalogStream): string | null {
  const tags = Array.isArray(stream.hdr_tags)
    ? stream.hdr_tags.map((tag) => String(tag).toLowerCase()).join(" ")
    : "";
  if (!tags) return null;
  if (tags.includes("dv") || tags.includes("dolby")) return "DV";
  if (tags.includes("hlg")) return "HLG";
  // HDR10 and HDR10+ collapse to one label. The distinction is real in the file and
  // meaningless on this box: the X11 output path cannot emit HDR at all, and the
  // Kodi path that can emits HDR10 either way. Dolby
  // Vision stays separate because the ladder does treat it differently — it must
  // never pick a DV-only stream. Collapsing also reclaims up to 46px of a 332px
  // chip row that was overflowing and slicing "cached" off the end.
  if (tags.includes("hdr")) return "HDR";
  return null;
}

/**
 * Does the codec change whether this stream will actually play well here?
 *
 * The Pi 5's BCM2712 hardware-decodes HEVC only (4Kp60, 8- and 10-bit); H.264,
 * AV1 and VP9 are software-decoded — "Other CODECs run in software" per the
 * BCM2712 documentation. Measured on a 4K remux, software decode runs ~0.52x
 * realtime against 1.4-1.8x for hardware, which is why the play ladder enforces
 * `require_hevc` above 1080p. See docs/HARDWARE.md.
 *
 * So at 4K, a non-HEVC codec is the single most important fact about a stream, and
 * at 1080p and below software decode is comfortable and the codec is trivia. The
 * chip earns its place in the first row only in the former case — which is also
 * what keeps that row inside its 336px column instead of overflowing by up to
 * 109px and slicing the "cached" chip off the end.
 */
function codecIsDecodeRisk(stream: CatalogStream): boolean {
  const resolution = streamResolutionLabel(stream);
  if (resolution !== "4K") {
    return false;
  }
  const codec = streamCodecLabel(stream);
  return codec !== null && codec !== "HEVC";
}

/** Best-to-worst, so a range reads in the direction the list is sorted. */
const RESOLUTION_RANK = ["4K", "1440p", "1080p", "720p", "SD", "auto"];

/**
 * "14 · 4K–SD" — how many options there are, and how far the ladder actually
 * reaches.
 *
 * The panel shows five rows of a list sorted best-first, so on a well-served title
 * every visible row is 4K and the panel silently implies that is all there is. The
 * count says there is more; the range says what kind of more, which is the part
 * that decides whether scrolling is worth it.
 */
function streamLadderSummary(streams: CatalogStream[]): string {
  const present = streams.map(streamResolutionLabel);
  const ranked = RESOLUTION_RANK.filter((label) => present.includes(label));
  const count = `${streams.length}`;
  if (ranked.length === 0) {
    return count;
  }
  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return best === worst ? `${count} · ${best}` : `${count} · ${best}–${worst}`;
}

function streamQualityChips(stream: CatalogStream): Array<{ kind: string; text: string }> {
  const chips: Array<{ kind: string; text: string }> = [];
  const tier = streamTierLabel(stream);
  if (tier) chips.push({ kind: "tier", text: tier });
  if (codecIsDecodeRisk(stream)) {
    const codec = streamCodecLabel(stream);
    // Styled as a caution rather than a neutral fact: at 4K this codec means the
    // Pi has to decode in software, which it cannot do at realtime.
    if (codec) chips.push({ kind: "codec-risk", text: codec });
  }
  const hdr = streamHdrLabel(stream);
  if (hdr) chips.push({ kind: "hdr", text: hdr });
  if (stream.cache_status === "cached") chips.push({ kind: "cache", text: "cached" });
  return chips;
}

function streamLanguageList(stream: CatalogStream): string[] {
  return Array.isArray(stream.languages)
    ? stream.languages.filter((item) => typeof item === "string" && item.trim() !== "")
    : [];
}

function streamLangLabel(stream: CatalogStream): string | null {
  const languages = streamLanguageList(stream);
  if (languages.length === 0) {
    return null;
  }
  const codes = languages
    .slice(0, 3)
    .map((lang) => STREAM_LANG_CODES[lang.toLowerCase()] ?? lang.slice(0, 2).toUpperCase());
  const extra = languages.length > 3 ? ` +${languages.length - 3}` : "";
  return codes.join(" · ") + extra;
}

function streamSizeLabel(stream: CatalogStream): string | null {
  const gb = typeof stream.size_gb === "number" ? stream.size_gb : undefined;
  if (gb === undefined || !Number.isFinite(gb) || gb <= 0) {
    return null;
  }
  if (gb < 1) {
    return `${Math.round(gb * 1000)} MB`;
  }
  return `${gb.toFixed(1)} GB`;
}

function streamAriaLabel(stream: CatalogStream, unverified: boolean): string {
  const parts = [
    streamResolutionLabel(stream),
    ...streamQualityChips(stream).map((chip) => chip.text),
  ];
  // The visible chip row drops the codec unless it is a decode risk, purely to fit
  // 336px. The accessible name has no such budget, so it always states the codec.
  const codec = streamCodecLabel(stream);
  if (codec && !codecIsDecodeRisk(stream)) {
    parts.push(codec);
  }
  const languages = streamLanguageList(stream);
  if (languages.length > 0) {
    parts.push(`audio ${languages.slice(0, 3).join(", ")}`);
  }
  const size = streamSizeLabel(stream);
  if (size) parts.push(size);
  if (unverified) parts.push("unverified");
  return parts.join(", ");
}
