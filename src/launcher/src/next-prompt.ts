import type { ContentCard } from "./types";
import type { LauncherStatusReporter } from "./toast";
import { playErrorMessage } from "./catalog-errors";
import { playCard, type NextPromptResponse } from "./catalog";
import {
  clearPlaybackReturnSnapshot,
  savePlaybackReturnSnapshot,
  tabForCard,
} from "./playback-return";

export class NextEpisodePrompt {
  private hint: NextPromptResponse | null = null;
  private card: ContentCard | null = null;
  private playToken = 0;
  private playAbort: AbortController | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly titleEl: HTMLElement,
    private readonly metaEl: HTMLElement,
    private readonly playButton: HTMLButtonElement,
    private readonly dismissButton: HTMLButtonElement,
    private readonly onStatus: LauncherStatusReporter,
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
    this.playButton.disabled = false;
    this.dismissButton.disabled = false;
    const next = hint.next;
    this.titleEl.textContent = hint.series_name || card.title;
    this.metaEl.textContent = `S${next.season} E${next.episode} · ${next.title}`;
    this.root.classList.remove("hidden");
    this.root.setAttribute("aria-hidden", "false");
    this.onStatus("B to play next episode. Y to stay on detail.", "hint");
    this.playButton.focus({ preventScroll: true });
  }

  dismiss(): void {
    if (!this.isOpen) {
      return;
    }
    this.playToken += 1;
    const cancelledPlay = this.playAbort !== null;
    this.playAbort?.abort();
    this.playAbort = null;
    if (cancelledPlay) {
      clearPlaybackReturnSnapshot();
    }
    this.playButton.disabled = false;
    this.dismissButton.disabled = false;
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
    this.playAbort?.abort();
    const abort = new AbortController();
    this.playAbort = abort;
    this.playButton.disabled = true;
    this.dismissButton.disabled = true;
    this.onStatus("starting next episode…", "progress");
    savePlaybackReturnSnapshot(tabForCard(card, "series"), card, hint.next.id);
    try {
      await playCard(card, { episodeId: hint.next.id, signal: abort.signal });
      if (this.playToken !== token) {
        return;
      }
      this.playAbort = null;
      this.dismiss();
      this.onStatus("playing next episode. ⌂ returns home.", "success");
    } catch (error) {
      if (abort.signal.aborted || this.playToken !== token) {
        return;
      }
      clearPlaybackReturnSnapshot();
      const message = error instanceof Error ? error.message : "couldn't start next episode.";
      this.onStatus(playErrorMessage(message), "error");
    } finally {
      if (this.playAbort === abort) {
        this.playAbort = null;
      }
      if (this.playToken === token) {
        this.playButton.disabled = false;
        this.dismissButton.disabled = false;
      }
    }
  }
}
