import { loadMeta, playCard, prefetchStreams, cancelPlay, type CatalogMeta } from "./catalog";
import type { ContentCard } from "./types";

export interface DetailCallbacks {
  onClose: () => void;
  onStatus: (message: string) => void;
}

export class DetailController {
  private card: ContentCard | null = null;
  private focusIndex = 0;
  private playToken = 0;
  private playAbort: AbortController | null = null;
  private readonly controls: HTMLButtonElement[];

  constructor(
    private readonly view: HTMLElement,
    private readonly poster: HTMLImageElement,
    private readonly eyebrow: HTMLElement,
    private readonly title: HTMLElement,
    private readonly meta: HTMLElement,
    private readonly description: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    private readonly backButton: HTMLButtonElement,
    private readonly callbacks: DetailCallbacks,
  ) {
    this.controls = [this.playButton, this.backButton];
    this.playButton.addEventListener("click", () => void this.play());
    this.backButton.addEventListener("click", () => this.hide());
  }

  get isOpen(): boolean {
    return this.card !== null;
  }

  show(card: ContentCard, railLabel: string): void {
    this.card = card;
    this.focusIndex = 0;
    this.eyebrow.textContent = railLabel;
    this.title.textContent = card.title;
    this.meta.textContent = card.subtitle;
    this.description.textContent = card.description || "loading details…";
    this.poster.src = card.posterUrl || "";
    this.poster.alt = "";
    this.view.classList.remove("hidden");
    this.applyFocus();
    this.callbacks.onStatus("B to play. Y to go back.");
    void this.loadFullMeta(card);
    void this.prefetch(card);
  }

  hide(): void {
    if (!this.isOpen) {
      return;
    }
    this.playToken += 1;
    this.playAbort?.abort();
    this.playAbort = null;
    void cancelPlay();
    this.card = null;
    this.view.classList.add("hidden");
    this.callbacks.onClose();
  }

  moveFocus(delta: number): void {
    if (!this.isOpen) {
      return;
    }
    this.focusIndex = Math.min(Math.max(this.focusIndex + delta, 0), this.controls.length - 1);
    this.applyFocus();
  }

  activate(): void {
    if (!this.isOpen) {
      return;
    }
    this.controls[this.focusIndex]?.click();
  }

  async play(): Promise<void> {
    const card = this.card;
    if (!card) {
      return;
    }
    this.playButton.disabled = true;
    const token = ++this.playToken;
    this.playAbort?.abort();
    const abort = new AbortController();
    this.playAbort = abort;
    this.callbacks.onStatus("finding stream…");
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
      const result = await playCard(card, abort.signal);
      if (this.playToken !== token) {
        return;
      }
      const quality = result.stream?.quality ? ` · ${result.stream.quality}` : "";
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
    }
  }

  private async prefetch(card: ContentCard): Promise<void> {
    try {
      await prefetchStreams(card);
    } catch (error) {
      console.debug("stream prefetch failed", error);
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
      this.description.textContent = meta.description || card.description || "no synopsis available";
      if (meta.poster) {
        this.poster.src = meta.poster;
      }
    } catch {
      if (this.card?.id === card.id) {
        this.description.textContent = card.description || "details unavailable";
      }
    }
  }

  private applyFocus(): void {
    for (const [index, control] of this.controls.entries()) {
      control.classList.toggle("focused", index === this.focusIndex);
    }
    this.controls[this.focusIndex]?.focus({ preventScroll: true });
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
