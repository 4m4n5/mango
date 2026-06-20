import {
  loadMeta,
  loadStreams,
  playCard,
  cancelPlay,
  type CatalogMeta,
  type CatalogStream,
} from "./catalog";
import type { ContentCard } from "./types";
import { bindPosterImage } from "./poster";

export interface DetailCallbacks {
  onClose: () => void;
  onStatus: (message: string) => void;
}

export class DetailController {
  private card: ContentCard | null = null;
  private focusIndex = 0;
  private playToken = 0;
  private playAbort: AbortController | null = null;
  private streams: CatalogStream[] = [];
  private streamButtons: HTMLButtonElement[] = [];
  private streamsLoadToken = 0;

  constructor(
    private readonly view: HTMLElement,
    private readonly poster: HTMLImageElement,
    private readonly eyebrow: HTMLElement,
    private readonly title: HTMLElement,
    private readonly meta: HTMLElement,
    private readonly description: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    private readonly backButton: HTMLButtonElement,
    private readonly streamsWrap: HTMLElement,
    private readonly streamList: HTMLElement,
    private readonly callbacks: DetailCallbacks,
  ) {
    this.playButton.addEventListener("click", () => void this.play());
    this.backButton.addEventListener("click", () => this.hide());
  }

  get isOpen(): boolean {
    return this.card !== null;
  }

  show(card: ContentCard, railLabel: string): void {
    this.card = card;
    this.focusIndex = 0;
    this.streams = [];
    this.streamButtons = [];
    this.streamList.replaceChildren();
    this.streamsWrap.hidden = true;
    this.eyebrow.textContent = railLabel;
    this.title.textContent = card.title;
    this.meta.textContent = card.subtitle;
    this.description.textContent = card.description || "loading details…";
    this.poster.src = card.posterUrl || "";
    bindPosterImage(this.poster, card.title);
    this.poster.alt = "";
    this.view.classList.remove("hidden");
    this.applyFocus();
    this.callbacks.onStatus("B to play. Y to go back.");
    void this.loadFullMeta(card);
    void this.loadStreamList(card);
  }

  hide(): void {
    if (!this.isOpen) {
      return;
    }
    this.playToken += 1;
    this.streamsLoadToken += 1;
    this.playAbort?.abort();
    this.playAbort = null;
    void cancelPlay();
    this.card = null;
    this.streams = [];
    this.streamButtons = [];
    this.streamList.replaceChildren();
    this.streamsWrap.hidden = true;
    this.view.classList.add("hidden");
    this.callbacks.onClose();
  }

  moveFocus(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    const controls = this.focusables();
    this.focusIndex = Math.min(Math.max(this.focusIndex + delta, 0), controls.length - 1);
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
    this.playButton.disabled = true;
    for (const button of this.streamButtons) {
      button.disabled = true;
    }
    const token = ++this.playToken;
    this.playAbort?.abort();
    const abort = new AbortController();
    this.playAbort = abort;
    this.callbacks.onStatus(
      card.resumeSec
        ? "resuming…"
        : preferUrl
          ? "starting stream…"
          : "finding stream…",
    );
    const startingTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        this.callbacks.onStatus("trying best match…");
      }
    }, 2000);
    const alternateTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        this.callbacks.onStatus("trying alternate release…");
      }
    }, 20000);
    const cachingTimer = window.setTimeout(() => {
      if (this.playToken === token && this.card?.id === card.id) {
        this.callbacks.onStatus("caching stream on TorBox…");
      }
    }, 10000);
    try {
      const result = await playCard(card, {
        signal: abort.signal,
        preferUrl,
        startSec: card.resumeSec,
      });
      if (this.playToken !== token) {
        return;
      }
      const label = result.stream?.display_label || result.stream?.quality;
      const quality = label ? ` · ${label}` : "";
      this.callbacks.onStatus(`playing${quality}. ⌂ returns home.`);
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
      window.clearTimeout(startingTimer);
      window.clearTimeout(alternateTimer);
      window.clearTimeout(cachingTimer);
      this.playButton.disabled = false;
      for (const button of this.streamButtons) {
        button.disabled = false;
      }
    }
  }

  private focusables(): HTMLElement[] {
    return [this.playButton, this.backButton, ...this.streamButtons];
  }

  private async loadStreamList(card: ContentCard): Promise<void> {
    const token = ++this.streamsLoadToken;
    try {
      const result = await loadStreams(card);
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = result.streams;
      this.renderStreams();
    } catch {
      if (this.streamsLoadToken !== token || !this.card || this.card.id !== card.id) {
        return;
      }
      this.streams = [];
      this.renderStreams();
    }
  }

  private renderStreams(): void {
    this.streamList.replaceChildren();
    this.streamButtons = [];
    if (this.streams.length === 0) {
      this.streamsWrap.hidden = true;
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
      }
    } catch {
      if (this.card?.id === card.id) {
        this.description.textContent = card.description || "details unavailable";
      }
    }
  }

  private applyFocus(): void {
    const controls = this.focusables();
    for (const [index, control] of controls.entries()) {
      control.classList.toggle("focused", index === this.focusIndex);
    }
    controls[this.focusIndex]?.focus({ preventScroll: true });
  }
}

function detailMetaLine(meta: CatalogMeta, card: ContentCard): string {
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
