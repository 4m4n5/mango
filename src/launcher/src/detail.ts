import {
  loadMeta,
  loadStreams,
  loadSeriesEpisodes,
  loadYoutubeDetailCards,
  loadNextPrompt,
  loadRailRelatedCards,
  playCard,
  notInterestedYoutubeCard,
  type CatalogMeta,
  type CatalogStream,
  type SeriesEpisodesResponse,
  type SeriesEpisodeRow,
  type SeriesSeasonBlock,
  type NextPromptResponse,
  type PlayResult,
} from "./catalog";
import type { ContentCard, BrowseTab } from "./types";
import { publishCurrentLibraryContext, saveCard, unsaveCard } from "./saved";
import { savePlaybackReturnSnapshot, clearPlaybackReturnSnapshot } from "./playback-return";
import { bindPosterImage, resolveCardPosterUrl } from "./poster";
import { formatRailLabel } from "./home";
import { showToast } from "./toast";
import { reconcileEpisodePlayTimeout } from "./playback-reconciliation";
import { recoverTimedOutStreamList } from "./stream-list-recovery";

const RELATED_DISPLAY_LIMIT = 7;

/** Play-only / floor steps — never styled as verified in the side-list. */
const UNVERIFIED_STREAM_STEPS = new Set([
  "obligation_floor",
  "last_resort",
  "4k_sdr_soft_cached",
  "1080p_uncached_fallback",
]);

export interface DetailCallbacks {
  onClose: () => void;
  onStatus: (message: string) => void;
  onSavedChanged?: () => void;
  onPlayed?: (card: ContentCard, result: PlayResult) => void;
  isSaved?: (card: ContentCard) => boolean;
}

export class DetailController {
  private card: ContentCard | null = null;
  private focusedEl: HTMLElement | null = null;
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
  private relatedButtons: HTMLButtonElement[] = [];
  private homeVisibleCards: ContentCard[] = [];
  private relatedLoadToken = 0;
  /** Restored after playback when series episode was playing. */
  private pendingEpisodeRestore: string | null = null;
  /** Episode whose playback exit initiated the current detail restore. */
  private playbackReturnEpisodeId: string | null = null;

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
    private readonly notInterestedButton: HTMLButtonElement,
    private readonly backButton: HTMLButtonElement,
    private readonly streamsWrap: HTMLElement,
    private readonly streamList: HTMLElement,
    private readonly episodesWrap: HTMLElement,
    private readonly seasonList: HTMLElement,
    private readonly episodeList: HTMLElement,
    private readonly relatedWrap: HTMLElement,
    private readonly relatedTrack: HTMLElement,
    private readonly relatedLabel: HTMLElement,
    private readonly callbacks: DetailCallbacks,
  ) {
    this.playButton.addEventListener("click", () => void this.play());
    this.saveButton.addEventListener("click", () => void this.toggleSaved());
    this.notInterestedButton.addEventListener("click", () => void this.markNotInterested());
    this.backButton.addEventListener("click", () => this.hide());
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
    saved = false,
    homeVisible: ContentCard[] = [],
    episodeId?: string,
  ): void {
    this.pendingEpisodeRestore = episodeId ?? null;
    this.show(card, railLabel, tab, saved, homeVisible);
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
    this.notInterestedButton.disabled = false;
    this.backButton.disabled = false;
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
    saved = false,
    homeVisible: ContentCard[] = [],
  ): void {
    this.card = card;
    this.browseTab = tab;
    this.saved = saved;
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
    this.eyebrow.textContent = formatRailLabel(railLabel);
    this.renderRelated([], railLabel, tab);
    void this.loadRelated(card, railLabel, tab);
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
    this.view.classList.remove("hidden");
    this.notInterestedButton.hidden = tab !== "youtube" && card.source !== "youtube";
    this.updateSaveButton();
    this.updatePlayButtonLabel();
    this.applyFocus();
    void publishCurrentLibraryContext(tab, card).catch(() => undefined);
    const isLive = card.type === "tv" || tab === "live";
    const isYoutube = this.isYoutubeCard(card);
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
    this.view.classList.add("hidden");
    this.callbacks.onClose();
  }

  moveRow(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    this.navigate(delta > 0 ? "down" : "up");
  }

  moveCol(delta: number): void {
    if (!this.isOpen) {
      return;
    }
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
    this.tryChangeSeason(delta);
  }

  activate(): void {
    if (!this.isOpen) {
      return;
    }
    if (this.focusedEl instanceof HTMLButtonElement && !this.focusedEl.disabled) {
      this.focusedEl.click();
    }
  }

  /** @deprecated Use moveRow/moveCol */
  moveFocus(delta: number): void {
    this.moveRow(delta);
  }

  async play(preferUrl?: string, preferLadderStep?: string, episodeIdOverride?: string): Promise<void> {
    const card = this.card;
    if (!card) {
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
    savePlaybackReturnSnapshot(this.browseTab, card, episodeId);
    this.publishPlayProgress(
      startSec
        ? "resuming…"
        : this.isYoutubeCard(card)
          ? "starting YouTube…"
          : preferUrl
          ? "starting stream…"
          : card.type === "tv" || this.browseTab === "live"
            ? "tuning in…"
            : "finding stream…",
    );
    const startingTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        this.publishPlayProgress(
          this.isYoutubeCard(card)
            ? "resolving YouTube…"
            : card.type === "tv" || this.browseTab === "live"
            ? "connecting to channel…"
            : "still finding a playable stream…",
        );
      }
    }, 2000);
    const slowResolveTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        if (this.isYoutubeCard(card) || card.type === "tv" || this.browseTab === "live") {
          return;
        }
        this.publishPlayProgress("still finding a playable stream…");
      }
    }, 10000);
    const longResolveTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        if (this.isYoutubeCard(card) || card.type === "tv" || this.browseTab === "live") {
          return;
        }
        this.publishPlayProgress("this is taking longer than usual…");
      }
    }, 20000);
    try {
      const result = await playCard(card, {
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
      showToast(
        message && !message.startsWith("HTTP ")
          ? message
          : "couldn't start playback. try another title.",
      );
    } finally {
      window.clearTimeout(startingTimer);
      window.clearTimeout(slowResolveTimer);
      window.clearTimeout(longResolveTimer);
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
      this.notInterestedButton,
      this.backButton,
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
    this.focusedEl = el;
    el.focus({ preventScroll: true });
    requestAnimationFrame(() => el.scrollIntoView({ block: "nearest", inline: "nearest" }));
    this.onGridFocused(el);
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
    // (play/save/back) rather than the spatially-closest related-title poster —
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
      this.focusEl(best);
    }
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
      const related = await loadRailRelatedCards(card, this.homeVisibleCards, tab, RELATED_DISPLAY_LIMIT);
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
      .slice(0, RELATED_DISPLAY_LIMIT);
    if (siblings.length === 0) {
      this.relatedWrap.classList.add("hidden");
      return;
    }
    this.relatedLabel.textContent = "related titles";
    const contextEl = this.relatedWrap.querySelector<HTMLElement>("#detail-related-context");
    const context = formatRailLabel(railLabel).toLowerCase();
    if (contextEl) {
      if (railLabel.trim().toLowerCase() === "voice" || !context) {
        contextEl.hidden = true;
        contextEl.textContent = "";
      } else {
        contextEl.hidden = false;
        contextEl.textContent = `from ${context}`;
      }
    }
    for (const sibling of siblings) {
      const button = this.createRelatedCard(sibling, railLabel, tab);
      this.relatedTrack.append(button);
      this.relatedButtons.push(button);
    }
    this.relatedWrap.classList.remove("hidden");
  }

  private createRelatedCard(
    sibling: ContentCard,
    railLabel: string,
    tab: BrowseTab,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "card card--poster card--portrait card--related";
    button.dataset.focusKey = `detail:related:${sibling.type}:${sibling.id}`;
    button.setAttribute("role", "listitem");
    button.setAttribute("aria-label", `${sibling.title}, ${sibling.subtitle}`);

    const poster = document.createElement("img");
    poster.className = "poster-image";
    poster.alt = "";
    poster.loading = "lazy";
    poster.decoding = "async";
    poster.src = resolveCardPosterUrl(sibling);
    bindPosterImage(poster, sibling.title);

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = sibling.title;

    const subtitle = document.createElement("span");
    subtitle.className = "card-subtitle";
    subtitle.textContent = sibling.subtitle;

    const content = document.createElement("span");
    content.className = "poster-content";
    content.append(title, subtitle);

    const shade = document.createElement("span");
    shade.className = "poster-shade";
    shade.setAttribute("aria-hidden", "true");
    button.append(poster, shade, content);

    button.addEventListener("click", () => {
      const saved = this.callbacks.isSaved?.(sibling) ?? false;
      this.show(sibling, railLabel, tab, saved, this.homeVisibleCards);
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
    return Boolean(card && (card.source === "youtube" || card.type.startsWith("youtube_")));
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
    this.saveButton.textContent = this.saved ? "unsave" : "save";
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
    const isLive = card.type === "tv" || this.browseTab === "live";
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
    if (!card) {
      return;
    }
    if (!this.canSaveCard(card)) {
      showToast("only YouTube videos can be saved.");
      return;
    }
    this.saveButton.disabled = true;
    try {
      if (this.saved) {
        await unsaveCard(card);
        this.saved = false;
        showToast("removed from saved.");
      } else {
        await saveCard(this.browseTab, card);
        this.saved = true;
        showToast("saved — find it in your Saved rail.");
      }
      this.updateSaveButton();
      this.callbacks.onSavedChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not update saved";
      showToast(message);
    } finally {
      this.saveButton.disabled = !this.canSaveCard(this.card);
    }
  }

  private async markNotInterested(): Promise<void> {
    const card = this.card;
    if (!card || !this.isYoutubeCard(card)) {
      return;
    }
    this.notInterestedButton.disabled = true;
    try {
      await notInterestedYoutubeCard(card);
      showToast("removed from YouTube recommendations.");
      this.hide();
      this.callbacks.onSavedChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not update YouTube recommendations";
      showToast(message);
    } finally {
      this.notInterestedButton.disabled = false;
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
        this.show(video, "YouTube", "youtube", false);
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
      streamsLabel.textContent = floorOnly ? "streams · unverified" : "streams";
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
    const langs = document.createElement("span");
    langs.className = "detail-stream-langs";
    langs.textContent = streamLangLabel(stream);
    secondary.append(langs);
    const size = streamSizeLabel(stream);
    if (size) {
      const sizeEl = document.createElement("span");
      sizeEl.className = "detail-stream-size";
      sizeEl.textContent = size;
      secondary.append(sizeEl);
    }
    if (unverified) {
      const flag = document.createElement("span");
      flag.className = "detail-stream-flag";
      flag.textContent = "unverified";
      secondary.append(flag);
    }

    button.append(primary, secondary);
    button.setAttribute("aria-label", streamAriaLabel(stream, unverified));
    button.addEventListener("click", () => void this.play(stream.url, stream.ladder_step));
    this.streamButtons.push(button);
    return button;
  }

  private async loadFullMeta(card: ContentCard): Promise<void> {
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
    if (!card || card.type !== "series") {
      return;
    }
    try {
      const hint = await loadNextPrompt();
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
      );
    } catch {
      // keep polling until timeout
    }
  }
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
  if (card.type === "tv") {
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
  if (tags.includes("hdr10+")) return "HDR10+";
  if (tags.includes("hdr10")) return "HDR10";
  if (tags.includes("hlg")) return "HLG";
  if (tags.includes("hdr")) return "HDR";
  return null;
}

function streamQualityChips(stream: CatalogStream): Array<{ kind: string; text: string }> {
  const chips: Array<{ kind: string; text: string }> = [];
  const tier = streamTierLabel(stream);
  if (tier) chips.push({ kind: "tier", text: tier });
  const codec = streamCodecLabel(stream);
  if (codec) chips.push({ kind: "codec", text: codec });
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

function streamLangLabel(stream: CatalogStream): string {
  const languages = streamLanguageList(stream);
  if (languages.length === 0) {
    return "audio n/a";
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
  const languages = streamLanguageList(stream);
  if (languages.length > 0) {
    parts.push(`audio ${languages.slice(0, 3).join(", ")}`);
  }
  const size = streamSizeLabel(stream);
  if (size) parts.push(size);
  if (unverified) parts.push("unverified");
  return parts.join(", ");
}
