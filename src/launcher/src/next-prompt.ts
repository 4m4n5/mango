import type { ContentCard } from "./types";
import { playCard, type NextPromptResponse } from "./catalog";

export class NextEpisodePrompt {
  private hint: NextPromptResponse | null = null;
  private card: ContentCard | null = null;
  private playToken = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly titleEl: HTMLElement,
    private readonly metaEl: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    private readonly dismissButton: HTMLButtonElement,
    private readonly onStatus: (message: string) => void,
    private readonly onDismiss: () => void,
  ) {
    this.playButton.addEventListener("click", () => void this.playNext());
    this.dismissButton.addEventListener("click", () => this.dismiss());
  }

  get isOpen(): boolean {
    return this.hint !== null;
  }

  show(hint: NextPromptResponse, card: ContentCard): void {
    if (!hint.show || !hint.next) {
      return;
    }
    this.hint = hint;
    this.card = card;
    const next = hint.next;
    this.titleEl.textContent = hint.series_name || card.title;
    this.metaEl.textContent = `S${next.season} E${next.episode} · ${next.title}`;
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.onStatus("B to play next episode. Y to stay on detail.");
    this.playButton.focus({ preventScroll: true });
  }

  dismiss(): void {
    if (!this.isOpen) {
      return;
    }
    this.hint = null;
    this.card = null;
    this.root.classList.add("hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.onDismiss();
  }

  activateFocused(focusIndex: number): void {
    if (!this.isOpen) {
      return;
    }
    if (focusIndex === 0) {
      void this.playNext();
      return;
    }
    this.dismiss();
  }

  moveFocus(delta: number, focusIndex: number): number {
    if (!this.isOpen) {
      return focusIndex;
    }
    return Math.min(Math.max(focusIndex + delta, 0), 1);
  }

  applyFocus(focusIndex: number): void {
    const buttons = [this.playButton, this.dismissButton];
    for (const [index, button] of buttons.entries()) {
      button.classList.toggle("focused", index === focusIndex);
    }
    buttons[focusIndex]?.focus({ preventScroll: true });
  }

  private async playNext(): Promise<void> {
    const hint = this.hint;
    const card = this.card;
    if (!hint?.next || !card) {
      return;
    }
    const token = ++this.playToken;
    this.playButton.disabled = true;
    this.dismissButton.disabled = true;
    this.onStatus("starting next episode…");
    try {
      await playCard(card, { episodeId: hint.next.id });
      if (this.playToken !== token) {
        return;
      }
      this.dismiss();
      this.onStatus("playing next episode. ⌂ returns home.");
    } catch (error) {
      if (this.playToken !== token) {
        return;
      }
      const message = error instanceof Error ? error.message : "couldn't start next episode.";
      this.onStatus(message);
    } finally {
      if (this.playToken === token) {
        this.playButton.disabled = false;
        this.dismissButton.disabled = false;
      }
    }
  }
}
