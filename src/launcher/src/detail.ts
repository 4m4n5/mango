import {
  loadMeta,
  loadStreams,
  loadSeriesEpisodes,
  loadNextPrompt,
  playCard,
  cancelPlay,
  type CatalogMeta,
  type CatalogStream,
  type SeriesEpisodesResponse,
  type SeriesEpisodeRow,
  type NextPromptResponse,
} from "./catalog";
import type { ContentCard, BrowseTab } from "./types";
import { publishCurrentLibraryContext, saveCard, unsaveCard } from "./saved";
import { bindPosterImage, resolveCardPosterUrl } from "./poster";

export interface DetailCallbacks {
  onClose: () => void;
  onStatus: (message: string) => void;
  onSavedChanged?: () => void;
  onNextEpisodePrompt?: (hint: NextPromptResponse, card: ContentCard) => void;
}

export class DetailController {
  private card: ContentCard | null = null;
  private focusIndex = 0;
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
  private nextPromptPollTimer: number | undefined;
  private browseTab: BrowseTab = "movies";
  private saved = false;

  constructor(
    private readonly view: HTMLElement,
    private readonly poster: HTMLImageElement,
    private readonly eyebrow: HTMLElement,
    private readonly title: HTMLElement,
    private readonly meta: HTMLElement,
    private readonly description: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    private readonly saveButton: HTMLButtonElement,
    private readonly backButton: HTMLButtonElement,
    private readonly streamsWrap: HTMLElement,
    private readonly streamList: HTMLElement,
    private readonly episodesWrap: HTMLElement,
    private readonly episodeList: HTMLElement,
    private readonly callbacks: DetailCallbacks,
  ) {
    this.playButton.addEventListener("click", () => void this.play());
    this.saveButton.addEventListener("click", () => void this.toggleSaved());
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
    void cancelPlay();
    this.playButton.disabled = false;
    this.saveButton.disabled = false;
    this.backButton.disabled = false;
    for (const button of this.streamButtons) {
      button.disabled = false;
    }
    for (const button of this.episodeButtons()) {
      button.disabled = button.classList.contains("detail-episode--disabled");
    }
    const card = this.card;
    const isLive = card?.type === "tv" || this.browseTab === "live";
    this.callbacks.onStatus(
      isLive ? "B to watch live. Y to go back." : "B to play. Y to go back.",
    );
  }

  show(card: ContentCard, railLabel: string, tab: BrowseTab, saved = false): void {
    this.card = card;
    this.browseTab = tab;
    this.saved = saved;
    this.focusIndex = 0;
    this.streams = [];
    this.streamButtons = [];
    this.seriesEpisodes = null;
    this.listFocusables = [];
    this.selectedEpisodeId = null;
    this.streamList.replaceChildren();
    this.episodeList.replaceChildren();
    this.streamsWrap.hidden = true;
    this.episodesWrap.hidden = true;
    this.eyebrow.textContent = railLabel;
    this.title.textContent = card.title;
    this.meta.textContent = card.subtitle;
    this.description.textContent = card.description || "loading details…";
    this.poster.src = resolveCardPosterUrl(card, "large");
    bindPosterImage(this.poster, card.title);
    this.poster.alt = "";
    this.view.classList.remove("hidden");
    this.updateSaveButton();
    this.updatePlayButtonLabel();
    this.applyFocus();
    void publishCurrentLibraryContext(tab, card).catch(() => undefined);
    const isLive = card.type === "tv" || tab === "live";
    this.callbacks.onStatus(isLive ? "B to watch live. Y to go back." : "B to play. Y to go back.");
    void this.loadFullMeta(card);
    if (!isLive) {
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
    this.playAbort?.abort();
    this.playAbort = null;
    void cancelPlay();
    this.card = null;
    this.streams = [];
    this.streamButtons = [];
    this.seriesEpisodes = null;
    this.listFocusables = [];
    this.selectedEpisodeId = null;
    this.streamList.replaceChildren();
    this.episodeList.replaceChildren();
    this.streamsWrap.hidden = true;
    this.episodesWrap.hidden = true;
    this.view.classList.add("hidden");
    this.callbacks.onClose();
  }

  moveFocus(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    const controls = this.focusables();
    if (controls.length === 0) {
      return;
    }
    let next = this.focusIndex;
    for (let step = 0; step < controls.length; step += 1) {
      next = Math.min(Math.max(next + delta, 0), controls.length - 1);
      if (!(controls[next] as HTMLButtonElement).disabled) {
        break;
      }
      if (next === 0 && delta < 0) {
        break;
      }
      if (next === controls.length - 1 && delta > 0) {
        break;
      }
    }
    this.focusIndex = next;
    void this.onFocusChanged(controls[this.focusIndex]);
    this.applyFocus();
  }

  activate(): void {
    if (!this.isOpen) {
      return;
    }
    const target = this.focusables()[this.focusIndex];
    target?.click();
  }

  async play(preferUrl?: string): Promise<void> {
    const card = this.card;
    if (!card) {
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
    this.callbacks.onStatus(
      startSec
        ? "resuming…"
        : preferUrl
          ? "starting stream…"
          : card.type === "tv" || this.browseTab === "live"
            ? "tuning in…"
            : "finding stream…",
    );
    const startingTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        this.callbacks.onStatus(
          card.type === "tv" || this.browseTab === "live"
            ? "connecting to channel…"
            : "trying best match…",
        );
      }
    }, 2000);
    const alternateTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        if (card.type === "tv" || this.browseTab === "live") {
          return;
        }
        this.callbacks.onStatus("trying alternate release…");
      }
    }, 20000);
    const cachingTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        if (card.type === "tv" || this.browseTab === "live") {
          return;
        }
        this.callbacks.onStatus("caching stream on TorBox…");
      }
    }, 10000);
    try {
      const result = await playCard(card, {
        signal: abort.signal,
        preferUrl,
        startSec,
        episodeId: card.type === "series" ? episodeId : undefined,
      });
      if (this.playToken !== token) {
        return;
      }
      const label = result.stream?.display_label || result.stream?.quality;
      const quality = label ? ` · ${label}` : "";
      this.callbacks.onStatus(`playing${quality}. ⌂ returns home.`);
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
      this.callbacks.onStatus(
        message && !message.startsWith("HTTP ")
          ? message
          : "couldn't start playback. try another title.",
      );
    } finally {
      if (this.playAbort === abort) {
        this.playAbort = null;
      }
      this.resolvingPlay = false;
      window.clearTimeout(startingTimer);
      window.clearTimeout(alternateTimer);
      window.clearTimeout(cachingTimer);
      this.playButton.disabled = false;
      for (const button of this.streamButtons) {
        button.disabled = false;
      }
      for (const button of this.episodeButtons()) {
        button.disabled = button.classList.contains("detail-episode--disabled");
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
    if (this.selectedEpisodeId) {
      const selected = this.episodeButtonForId(this.selectedEpisodeId);
      if (selected && !selected.disabled) {
        return this.selectedEpisodeId;
      }
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

  private focusables(): HTMLElement[] {
    return [
      this.playButton,
      this.saveButton,
      this.backButton,
      ...this.listFocusables,
      ...this.streamButtons,
    ];
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
      if (child.classList.contains("detail-episode") && !child.disabled) {
        next.push(child);
      }
    }
    this.listFocusables = next;
    const controls = this.focusables();
    if (this.focusIndex >= controls.length) {
      this.focusIndex = Math.max(controls.length - 1, 0);
    }
  }

  private jumpToSeason(season: number): void {
    const block = this.seriesEpisodes?.seasons.find((row) => row.season === season);
    if (!block || block.episodes.length === 0) {
      return;
    }
    const targetEpisode = block.episodes.find((episode) => {
      const button = this.episodeButtonForId(episode.id);
      return button !== null && !button.disabled;
    }) ?? block.episodes[0];
    const button = this.episodeButtonForId(targetEpisode.id);
    if (!button) {
      return;
    }
    const controls = this.focusables();
    const index = controls.indexOf(button);
    if (index < 0) {
      return;
    }
    this.focusIndex = index;
    void this.selectEpisode(targetEpisode);
    this.applyFocus();
  }

  private setEpisodeHasStreams(episodeId: string, hasStreams: boolean): void {
    const button = this.episodeButtonForId(episodeId);
    if (!button) {
      return;
    }
    button.disabled = !hasStreams;
    button.classList.toggle("detail-episode--disabled", !hasStreams);
    button.setAttribute("aria-disabled", hasStreams ? "false" : "true");
    this.rebuildListFocusables();
    const controls = this.focusables();
    const current = controls[this.focusIndex];
    if (current instanceof HTMLButtonElement && current.disabled) {
      this.moveFocus(1);
    }
  }

  private updateSaveButton(): void {
    this.saveButton.textContent = this.saved ? "unsave" : "save";
    this.saveButton.setAttribute("aria-pressed", this.saved ? "true" : "false");
  }

  private updatePlayButtonLabel(): void {
    const card = this.card;
    if (!card) {
      return;
    }
    const isLive = card.type === "tv" || this.browseTab === "live";
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
    this.saveButton.disabled = true;
    try {
      if (this.saved) {
        await unsaveCard(card);
        this.saved = false;
        this.callbacks.onStatus("removed from saved.");
      } else {
        await saveCard(this.browseTab, card);
        this.saved = true;
        this.callbacks.onStatus("saved — find it in your Saved rail.");
      }
      this.updateSaveButton();
      this.callbacks.onSavedChanged?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "could not update saved";
      this.callbacks.onStatus(message);
    } finally {
      this.saveButton.disabled = false;
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
        void this.loadStreamList(card, initialEpisode);
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

        button.dataset.episodeId = episode.id;
        if (episode.playable === false) {
          button.disabled = true;
          button.classList.add("detail-episode--disabled");
          button.setAttribute("aria-disabled", "true");
        }
        button.append(label, progress);
        button.addEventListener("click", () => {
          void this.activateEpisode(episode);
        });
        this.episodeList.append(button);
      }
    }

    this.rebuildListFocusables();
    const scrollTarget = this.episodeList.querySelector<HTMLElement>("[data-scroll-target='true']");
    scrollTarget?.scrollIntoView({ block: "nearest", behavior: "instant" });
    this.focusIndex = Math.min(this.focusIndex, this.focusables().length - 1);
    this.applyFocus();
  }

  private async activateEpisode(episode: SeriesEpisodeRow): Promise<void> {
    const button = this.episodeButtonForId(episode.id);
    if (button?.disabled) {
      this.callbacks.onStatus("no streams for this episode.");
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
      this.callbacks.onStatus("no streams for this episode.");
      return;
    }
    this.selectedEpisodeId = episode.id;
    for (const button of this.episodeButtons()) {
      button.classList.toggle(
        "detail-episode--selected",
        button.dataset.episodeId === episode.id,
      );
    }
    await this.loadStreamList(card, episode.id);
  }

  private async onFocusChanged(target: HTMLElement | undefined): Promise<void> {
    if (target?.classList.contains("detail-season-header")) {
      return;
    }
    if (!target?.classList.contains("detail-episode")) {
      return;
    }
    if ((target as HTMLButtonElement).disabled) {
      return;
    }
    const episodeId = target.dataset.episodeId;
    if (!episodeId || episodeId === this.selectedEpisodeId) {
      return;
    }
    const episode = this.seriesEpisodes?.seasons
      .flatMap((block) => block.episodes)
      .find((row) => row.id === episodeId);
    if (!episode) {
      return;
    }
    await this.selectEpisode(episode);
  }

  private async loadStreamList(card: ContentCard, episodeId?: string): Promise<void> {
    const token = ++this.streamsLoadToken;
    this.streamsPending = true;
    if (this.card?.id === card.id) {
      this.callbacks.onStatus("loading streams…");
    }
    try {
      const result = await loadStreams(card, episodeId);
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = result.streams;
      if (episodeId) {
        this.setEpisodeHasStreams(episodeId, result.streams.length > 0);
      }
      this.renderStreams();
      if (this.card?.id === card.id && !this.resolvingPlay) {
        const count = result.streams.length;
        this.callbacks.onStatus(
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
        this.setEpisodeHasStreams(episodeId, false);
      }
      this.renderStreams();
    } finally {
      if (this.streamsLoadToken === token) {
        this.streamsPending = false;
      }
    }
  }

  private renderStreams(): void {
    this.streamList.replaceChildren();
    this.streamButtons = [];
    if (this.streams.length === 0) {
      this.streamsWrap.hidden = true;
      this.focusIndex = Math.min(this.focusIndex, this.focusables().length - 1);
      this.applyFocus();
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
      button.addEventListener("click", () => void this.play(stream.url));
      this.streamList.append(button);
      this.streamButtons.push(button);
    }
    this.focusIndex = Math.min(this.focusIndex, this.focusables().length - 1);
    this.applyFocus();
  }

  private async loadFullMeta(card: ContentCard): Promise<void> {
    try {
      const meta = await loadMeta(card);
      if (!this.card || this.card.id !== card.id || this.card.type !== card.type) {
        return;
      }
      this.title.textContent = meta.name || meta.title || card.title;
      this.meta.textContent = detailMetaLine(meta, card);
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

  private applyFocus(): void {
    const controls = this.focusables();
    for (const [index, control] of controls.entries()) {
      control.classList.toggle("focused", index === this.focusIndex);
    }
    const target = controls[this.focusIndex];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "nearest", behavior: "instant" });
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
