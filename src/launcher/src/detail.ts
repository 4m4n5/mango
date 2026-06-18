import { loadMeta, playCard, type CatalogMeta } from "./catalog";
import type { ContentCard } from "./types";

export interface DetailCallbacks {
  onClose: () => void;
  onStatus: (message: string) => void;
}

export class DetailController {
  private card: ContentCard | null = null;
  private focusIndex = 0;
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
  }

  hide(): void {
    if (!this.isOpen) {
      return;
    }
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
    this.callbacks.onStatus("resolving…");
    try {
      const result = await playCard(card);
      const ttff = result.ttff_ms ? ` ${result.ttff_ms} ms` : "";
      const quality = result.stream?.quality ? ` · ${result.stream.quality}` : "";
      this.callbacks.onStatus(`playing${quality}${ttff}. ⌂ returns home.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      this.callbacks.onStatus(`could not play: ${message}`);
    } finally {
      this.playButton.disabled = false;
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
