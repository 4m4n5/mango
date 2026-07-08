import {
  loadMeta,
  loadStreams,
  loadSeriesEpisodes,
  loadYoutubeDetailCards,
  loadNextPrompt,
  loadRailRelatedCards,
  playCard,
  cancelPlay,
  notInterestedYoutubeCard,
  type CatalogMeta,
  type CatalogStream,
  type SeriesEpisodesResponse,
  type SeriesEpisodeRow,
  type NextPromptResponse,
  type PlayResult,
} from "./catalog";
import type { ContentCard, BrowseTab } from "./types";
import { publishCurrentLibraryContext, saveCard, unsaveCard } from "./saved";
import { bindPosterImage, resolveCardPosterUrl } from "./poster";
import { formatRailLabel } from "./home";

const RELATED_DISPLAY_LIMIT = 7;
/** Idle dwell before background stream prefetch while browsing episodes. */
const EPISODE_DWELL_MS = 450;

export interface DetailCallbacks {
  onClose: () => void;
  onStatus: (message: string) => void;
  onSavedChanged?: () => void;
  onPlayed?: (card: ContentCard, result: PlayResult) => void;
  onNextEpisodePrompt?: (hint: NextPromptResponse, card: ContentCard) => void;
  isSaved?: (card: ContentCard) => boolean;
}

export class DetailController {
  private card: ContentCard | null = null;
  private focusedEl: HTMLElement | null = null;
  private playToken = 0;
  private playAbort: AbortController | null = null;
  private streams: CatalogStream[] = [];
  private streamButtons: HTMLButtonElement[] = [];
  private streamsLoadToken = 0;
  private episodesLoadToken = 0;
  private resolvingPlay = false;
  private streamsPending = false;
  private seriesEpisodes: SeriesEpisodesResponse | null = null;
  /** Season headers + enabled episode rows — D-pad order in the list. */
  private listFocusables: HTMLElement[] = [];
  private selectedEpisodeId: string | null = null;
  /** D-pad focus — navigation only; does not trigger stream resolve. */
  private focusedEpisodeId: string | null = null;
  private episodeStreamCache = new Map<string, CatalogStream[]>();
  private episodeDwellTimer: number | undefined;
  private nextPromptPollTimer: number | undefined;
  private browseTab: BrowseTab = "movies";
  private saved = false;
  private relatedButtons: HTMLButtonElement[] = [];
  private homeVisibleCards: ContentCard[] = [];
  private relatedLoadToken = 0;

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
    private readonly statusEl: HTMLElement,
    private readonly streamsWrap: HTMLElement,
    private readonly streamList: HTMLElement,
    private readonly episodesWrap: HTMLElement,
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

  cancelResolve(): void {
    if (!this.isResolving()) {
      return;
    }
    this.playToken += 1;
    this.streamsLoadToken += 1;
    this.playAbort?.abort();
    this.playAbort = null;
    this.resolvingPlay = false;
    this.streamsPending = false;
    this.clearPlayBusy();
    this.hideStatus();
    void cancelPlay();
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
    const card = this.card;
    const isLive = card?.type === "tv" || this.browseTab === "live";
    const isYoutube = this.isYoutubeCard(card);
    this.publishStatus(
      isLive
        ? "B to watch live. Y to go back."
        : isYoutube
          ? "B to play YouTube. Y to go back."
          : "B to play. Y to go back.",
    );
  }

  private publishStatus(message: string, options: { hold?: boolean } = {}): void {
    this.callbacks.onStatus(message);
    if (this.resolvingPlay) {
      this.showStatus(message);
      this.setPlayBusyLabel(message);
      return;
    }
    if (this.streamsPending && /^loading/i.test(message)) {
      this.showStatus(message);
      return;
    }
    if (options.hold) {
      this.showStatus(message);
    }
  }

  private showStatus(message: string): void {
    const trimmed = message.trim();
    if (!trimmed) {
      this.hideStatus();
      return;
    }
    this.statusEl.hidden = false;
    this.statusEl.textContent = trimmed;
  }

  private hideStatus(): void {
    this.statusEl.hidden = true;
    this.statusEl.textContent = "";
  }

  private setPlayBusyLabel(message: string): void {
    this.playButton.classList.add("detail-button--busy");
    this.playButton.textContent = message;
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
    this.selectedEpisodeId = null;
    this.focusedEpisodeId = null;
    this.focusedEl = null;
    this.episodeStreamCache.clear();
    this.clearEpisodeDwell();
    this.streamList.replaceChildren();
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
    this.hideStatus();
    this.updateSaveButton();
    this.updatePlayButtonLabel();
    this.applyFocus();
    void publishCurrentLibraryContext(tab, card).catch(() => undefined);
    const isLive = card.type === "tv" || tab === "live";
    const isYoutube = this.isYoutubeCard(card);
    const playable = this.canPlayCard(card);
    this.publishStatus(
      isLive
        ? "B to watch live. Y to go back."
        : isYoutube && !playable
          ? "choose a video. Y to go back."
          : isYoutube
            ? "B to play YouTube. Y to go back."
            : "B to play. Y to go back.",
    );
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
    this.hideStatus();
    this.playAbort?.abort();
    this.playAbort = null;
    void cancelPlay();
    this.card = null;
    this.streams = [];
    this.streamButtons = [];
    this.seriesEpisodes = null;
    this.listFocusables = [];
    this.selectedEpisodeId = null;
    this.focusedEpisodeId = null;
    this.focusedEl = null;
    this.episodeStreamCache.clear();
    this.clearEpisodeDwell();
    this.streamList.replaceChildren();
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
    this.navigate(delta > 0 ? "right" : "left");
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

  async play(preferUrl?: string, preferLadderStep?: string): Promise<void> {
    const card = this.card;
    if (!card) {
      return;
    }
    if (!this.canPlayCard(card)) {
      this.publishStatus("choose a video first.");
      return;
    }
    const episodeId = this.playEpisodeId();
    const startSec = this.playStartSec(episodeId);
    this.playButton.disabled = true;
    for (const button of this.streamButtons) {
      button.disabled = true;
    }
    for (const button of this.episodeButtons()) {
      button.disabled = true;
    }
    const token = ++this.playToken;
    this.playAbort?.abort();
    const abort = new AbortController();
    this.playAbort = abort;
    this.resolvingPlay = true;
    this.publishStatus(
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
        this.publishStatus(
          this.isYoutubeCard(card)
            ? "resolving YouTube…"
            : card.type === "tv" || this.browseTab === "live"
            ? "connecting to channel…"
            : "trying best match…",
        );
      }
    }, 2000);
    const alternateTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        if (this.isYoutubeCard(card) || card.type === "tv" || this.browseTab === "live") {
          return;
        }
        this.publishStatus("trying alternate release…");
      }
    }, 20000);
    const cachingTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        if (this.isYoutubeCard(card) || card.type === "tv" || this.browseTab === "live") {
          return;
        }
        this.publishStatus("caching stream on TorBox…");
      }
    }, 10000);
    let playFailed = false;
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
      const quality = label ? ` · ${label}` : "";
      this.publishStatus(`playing${quality}. ⌂ returns home.`);
      this.callbacks.onPlayed?.(card, result);
      if (card.type === "series") {
        this.startNextPromptPoll();
      }
    } catch (error) {
      if (abort.signal.aborted || (error instanceof Error && error.message === "play cancelled")) {
        return;
      }
      if (this.playToken !== token) {
        return;
      }
      const message = error instanceof Error ? error.message : "couldn't start playback. try another title.";
      playFailed = true;
      this.publishStatus(
        message && !message.startsWith("HTTP ")
          ? message
          : "couldn't start playback. try another title.",
        { hold: true },
      );
    } finally {
      if (this.playAbort === abort) {
        this.playAbort = null;
      }
      this.resolvingPlay = false;
      window.clearTimeout(startingTimer);
      window.clearTimeout(alternateTimer);
      window.clearTimeout(cachingTimer);
      this.clearPlayBusy();
      if (!playFailed) {
        this.hideStatus();
      }
      this.playButton.disabled = false;
      for (const button of this.streamButtons) {
        button.disabled = false;
      }
      for (const button of this.episodeButtons()) {
        button.disabled = false;
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
    if (this.focusedEpisodeId) {
      return this.focusedEpisodeId;
    }
    if (this.selectedEpisodeId) {
      return this.selectedEpisodeId;
    }
    return this.primaryEpisodeId();
  }

  private playStartSec(episodeId?: string): number | undefined {
    const card = this.card;
    if (!card) {
      return undefined;
    }
    if (episodeId && this.seriesEpisodes?.resume?.episode_id === episodeId) {
      return this.seriesEpisodes.resume.position_sec;
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
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const candidate of this.enabledFocusables()) {
      if (candidate === current) {
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

  private rebuildListFocusables(): void {
    const next: HTMLElement[] = [];
    for (const child of this.episodeList.children) {
      if (!(child instanceof HTMLButtonElement)) {
        continue;
      }
      if (child.classList.contains("detail-season-header")) {
        next.push(child);
        continue;
      }
      if (child.classList.contains("detail-episode")) {
        next.push(child);
      }
    }
    this.listFocusables = next;
  }

  private jumpToSeason(season: number): void {
    const block = this.seriesEpisodes?.seasons.find((row) => row.season === season);
    if (!block || block.episodes.length === 0) {
      return;
    }
    const targetEpisode = block.episodes[0];
    const button = this.episodeButtonForId(targetEpisode.id);
    if (!button) {
      return;
    }
    this.focusElement(button);
  }

  private findEpisode(episodeId: string): SeriesEpisodeRow | undefined {
    return this.seriesEpisodes?.seasons
      .flatMap((block) => block.episodes)
      .find((row) => row.id === episodeId);
  }

  private clearEpisodeDwell(): void {
    if (this.episodeDwellTimer !== undefined) {
      window.clearTimeout(this.episodeDwellTimer);
      this.episodeDwellTimer = undefined;
    }
  }

  private scheduleEpisodeDwell(episodeId: string): void {
    this.clearEpisodeDwell();
    this.episodeDwellTimer = window.setTimeout(() => {
      this.episodeDwellTimer = undefined;
      if (this.focusedEpisodeId !== episodeId) {
        return;
      }
      const card = this.card;
      if (!card || card.type !== "series") {
        return;
      }
      void this.prefetchEpisodeStreams(card, episodeId, { updatePanel: true });
    }, EPISODE_DWELL_MS);
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
      badge.textContent = hasStreams ? "" : "no streams";
      badge.hidden = hasStreams;
    }
  }

  private async prefetchEpisodeStreams(
    card: ContentCard,
    episodeId: string,
    options: { updatePanel?: boolean } = {},
  ): Promise<void> {
    if (this.episodeStreamCache.has(episodeId)) {
      if (options.updatePanel && this.focusedEpisodeId === episodeId) {
        await this.selectEpisodeStreams(card, episodeId, { quiet: true });
      }
      return;
    }
    const episode = this.findEpisode(episodeId);
    if (episode?.playable === false) {
      this.episodeStreamCache.set(episodeId, []);
      this.setEpisodeStreamBadge(episodeId, false);
      return;
    }
    try {
      const result = await loadStreams(card, episodeId);
      if (!this.card || this.card.id !== card.id) {
        return;
      }
      this.episodeStreamCache.set(episodeId, result.streams);
      this.setEpisodeStreamBadge(episodeId, result.streams.length > 0);
      if (options.updatePanel && this.focusedEpisodeId === episodeId) {
        await this.selectEpisodeStreams(card, episodeId, { quiet: true });
      }
    } catch {
      // leave badge unchanged — play path will resolve on B
    }
  }

  private prefetchAdjacentEpisodes(card: ContentCard, centerId: string): void {
    const flat = this.seriesEpisodes?.seasons.flatMap((block) => block.episodes) ?? [];
    const index = flat.findIndex((row) => row.id === centerId);
    if (index < 0) {
      return;
    }
    for (const offset of [-1, 1]) {
      const episode = flat[index + offset];
      if (episode && episode.playable !== false) {
        void this.prefetchEpisodeStreams(card, episode.id);
      }
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
      this.playButton.textContent = "select video";
      this.playButton.disabled = true;
      return;
    }
    this.playButton.disabled = false;
    const isLive = card.type === "tv" || this.browseTab === "live";
    if (this.isYoutubeCard(card)) {
      this.playButton.textContent = card.liveStatus === "live" ? "watch live" : "play";
      return;
    }
    if (isLive) {
      this.playButton.textContent = "watch live";
      return;
    }
    const hasResume = Boolean(card.resumeSec)
      || Boolean(this.seriesEpisodes?.resume)
      || Boolean(card.playId?.includes(":"));
    this.playButton.textContent = hasResume ? "resume" : "play";
  }

  private async toggleSaved(): Promise<void> {
    const card = this.card;
    if (!card) {
      return;
    }
    if (!this.canSaveCard(card)) {
      this.publishStatus("only YouTube videos can be saved.");
      return;
    }
    this.saveButton.disabled = true;
    try {
      if (this.saved) {
        await unsaveCard(card);
        this.saved = false;
        this.publishStatus("removed from saved.");
      } else {
        await saveCard(this.browseTab, card);
        this.saved = true;
        this.publishStatus("saved — find it in your Saved rail.");
      }
      this.updateSaveButton();
      this.callbacks.onSavedChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not update saved";
      this.publishStatus(message);
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
      this.publishStatus("removed from YouTube recommendations.");
      this.hide();
      this.callbacks.onSavedChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not update YouTube recommendations";
      this.publishStatus(message);
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
      this.renderEpisodes(episodes);
      this.updatePlayButtonLabel();
      const initialEpisode = episodes.resume?.episode_id
        || episodes.default_episode_id
        || null;
      if (initialEpisode) {
        this.selectedEpisodeId = initialEpisode;
        this.focusedEpisodeId = initialEpisode;
        void this.loadStreamList(card, initialEpisode);
        this.prefetchAdjacentEpisodes(card, initialEpisode);
      }
    } catch {
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.seriesEpisodes = null;
      this.episodesWrap.hidden = true;
      void this.loadStreamList(card);
    }
  }

  private async loadYoutubeList(card: ContentCard): Promise<void> {
    const token = ++this.episodesLoadToken;
    this.episodesWrap.hidden = false;
    this.setListLabel("videos");
    this.episodeList.replaceChildren();
    this.publishStatus("loading YouTube videos…");
    try {
      const cards = await loadYoutubeDetailCards(card);
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.renderYoutubeList(cards);
      this.publishStatus(
        cards.length > 0
          ? "choose a video. Y to go back."
          : "no videos found here yet.",
      );
    } catch {
      if (this.episodesLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.episodeList.replaceChildren();
      this.listFocusables = [];
      this.episodesWrap.hidden = true;
      this.publishStatus("YouTube list unavailable.");
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

  private renderEpisodes(episodes: SeriesEpisodesResponse): void {
    this.episodeList.replaceChildren();
    this.listFocusables = [];
    const flatCount = episodes.seasons.reduce((total, block) => total + block.episodes.length, 0);
    if (flatCount === 0) {
      this.episodesWrap.hidden = true;
      this.applyFocus();
      return;
    }

    this.episodesWrap.hidden = false;
    const scrollTargetId = episodes.resume?.episode_id
      || episodes.default_episode_id
      || null;

    for (const block of episodes.seasons) {
      const header = document.createElement("button");
      header.type = "button";
      header.className = "detail-season-header";
      header.textContent = block.label;
      header.dataset.season = String(block.season);
      header.addEventListener("click", () => this.jumpToSeason(block.season));
      this.episodeList.append(header);

      for (const episode of block.episodes) {
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
        if (episode.playable === false) {
          this.episodeStreamCache.set(episode.id, []);
          button.classList.add("detail-episode--no-streams");
          badge.textContent = "no streams";
          badge.hidden = false;
        } else if (episode.playable === true) {
          button.classList.add("detail-episode--has-streams");
        }
        button.append(label, progress, badge);
        button.addEventListener("click", () => {
          void this.activateEpisode(episode);
        });
        this.episodeList.append(button);
      }
    }

    this.rebuildListFocusables();
    const scrollTarget = this.episodeList.querySelector<HTMLElement>("[data-scroll-target='true']");
    scrollTarget?.scrollIntoView({ block: "nearest", behavior: "instant" });
    if (scrollTarget instanceof HTMLElement) {
      this.focusElement(scrollTarget);
    } else {
      this.applyFocus();
    }
  }

  private async activateEpisode(episode: SeriesEpisodeRow): Promise<void> {
    if (episode.playable === false) {
      this.publishStatus("no streams for this episode.");
      return;
    }
    const cached = this.episodeStreamCache.get(episode.id);
    if (cached !== undefined && cached.length === 0) {
      this.publishStatus("no streams for this episode.");
      return;
    }
    await this.selectEpisode(episode);
    await this.play();
  }

  private async selectEpisode(episode: SeriesEpisodeRow): Promise<void> {
    const card = this.card;
    if (!card) {
      return;
    }
    if (episode.playable === false) {
      this.publishStatus("no streams for this episode.");
      return;
    }
    await this.selectEpisodeStreams(card, episode.id);
  }

  private async selectEpisodeStreams(
    card: ContentCard,
    episodeId: string,
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    this.selectedEpisodeId = episodeId;
    this.applyEpisodeSelectionVisual(episodeId);
    const cached = this.episodeStreamCache.get(episodeId);
    if (cached !== undefined) {
      this.streams = cached;
      this.setEpisodeStreamBadge(episodeId, cached.length > 0);
      this.renderStreams();
      if (!options.quiet && this.card?.id === card.id && !this.resolvingPlay) {
        const count = cached.length;
        this.publishStatus(
          count > 0
            ? `${count} stream${count === 1 ? "" : "s"} ready. B to play. Y to go back.`
            : "no streams found for this episode.",
        );
      }
      return;
    }
    await this.loadStreamList(card, episodeId, options);
  }

  private onEpisodeFocusChanged(target: HTMLElement | undefined): void {
    if (this.card?.type !== "series") {
      return;
    }
    if (target?.classList.contains("detail-season-header")) {
      return;
    }
    if (!target?.classList.contains("detail-episode")) {
      return;
    }
    const episodeId = target.dataset.episodeId;
    if (!episodeId) {
      return;
    }
    this.focusedEpisodeId = episodeId;
    const episode = this.findEpisode(episodeId);
    if (episode) {
      this.publishStatus(`${episodeRowLabel(episode)} — B to play`);
    }
    this.scheduleEpisodeDwell(episodeId);
  }

  private async loadStreamList(
    card: ContentCard,
    episodeId?: string,
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    if (episodeId && this.episodeStreamCache.has(episodeId)) {
      const cached = this.episodeStreamCache.get(episodeId)!;
      this.streams = cached;
      this.setEpisodeStreamBadge(episodeId, cached.length > 0);
      this.renderStreams();
      return;
    }
    const token = ++this.streamsLoadToken;
    this.streamsPending = true;
    if (this.card?.id === card.id && !options.quiet) {
      this.publishStatus("loading streams…");
    }
    try {
      const result = await loadStreams(card, episodeId);
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = result.streams;
      if (episodeId) {
        this.episodeStreamCache.set(episodeId, result.streams);
        this.setEpisodeStreamBadge(episodeId, result.streams.length > 0);
      }
      this.renderStreams();
      if (this.card?.id === card.id && !this.resolvingPlay && !options.quiet) {
        const count = result.streams.length;
        this.publishStatus(
          count > 0
            ? `${count} stream${count === 1 ? "" : "s"} ready. B to play. Y to go back.`
            : "no streams found for this title.",
        );
      }
    } catch {
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = [];
      if (episodeId) {
        this.episodeStreamCache.set(episodeId, []);
        this.setEpisodeStreamBadge(episodeId, false);
      }
      this.renderStreams();
    } finally {
      if (this.streamsLoadToken === token) {
        this.streamsPending = false;
        if (!this.resolvingPlay) {
          this.hideStatus();
        }
      }
    }
  }

  private renderStreams(): void {
    const keepEpisodeFocus = this.focusedEl?.classList.contains("detail-episode") ?? false;
    this.streamList.replaceChildren();
    this.streamButtons = [];
    if (this.streams.length === 0) {
      this.streamsWrap.hidden = true;
      if (!keepEpisodeFocus) {
        this.applyFocus();
      }
      return;
    }

    this.streamsWrap.hidden = false;
    for (const stream of this.streams) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "detail-stream";
      const label = document.createElement("span");
      label.className = "detail-stream-label";
      label.textContent = streamPrimaryLabel(stream);
      const audio = document.createElement("span");
      audio.className = "detail-stream-audio";
      audio.textContent = streamAudioLabel(stream);
      button.append(label, audio);
      button.addEventListener("click", () => void this.play(stream.url, stream.ladder_step));
      this.streamList.append(button);
      this.streamButtons.push(button);
    }
    if (!keepEpisodeFocus) {
      this.applyFocus();
    }
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
    this.nextPromptPollTimer = window.setInterval(() => {
      attempts += 1;
      void this.checkNextPrompt();
      if (attempts >= 120) {
        this.stopNextPromptPoll();
      }
    }, 1500);
  }

  private stopNextPromptPoll(): void {
    if (this.nextPromptPollTimer !== undefined) {
      window.clearInterval(this.nextPromptPollTimer);
      this.nextPromptPollTimer = undefined;
    }
  }

  private async checkNextPrompt(): Promise<void> {
    const card = this.card;
    if (!card || card.type !== "series" || !this.callbacks.onNextEpisodePrompt) {
      return;
    }
    try {
      const hint = await loadNextPrompt();
      if (!hint.show || !hint.next) {
        return;
      }
      this.stopNextPromptPoll();
      this.callbacks.onNextEpisodePrompt(hint, card);
    } catch {
      // keep polling until timeout
    }
  }
}

function seriesBareId(id: string): string {
  return id.includes(":") ? id.split(":")[0] : id;
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

function streamPrimaryLabel(stream: CatalogStream): string {
  const label = stream.display_label?.trim();
  if (label) {
    return label;
  }
  return stream.title?.trim() || stream.name?.trim() || stream.quality?.trim() || "stream";
}

function streamAudioLabel(stream: CatalogStream): string {
  const languages = Array.isArray(stream.languages)
    ? stream.languages.filter((item) => typeof item === "string" && item.trim() !== "")
    : [];
  if (languages.length === 0) {
    return "audio unknown";
  }
  return languages.slice(0, 3).join(" · ");
}
