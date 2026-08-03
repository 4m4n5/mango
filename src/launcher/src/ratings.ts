import type { ContentCard } from "./types";
import { showToast } from "./toast";

export type HalfStepRating =
  | 0 | 0.5 | 1 | 1.5 | 2 | 2.5
  | 3 | 3.5 | 4 | 4.5 | 5;

export type FireWaterRating = {
  type: "movie" | "series";
  id: string;
  title: string;
  year: string | null;
  fire: HalfStepRating;
  water: HalfStepRating;
  revision: number;
  origin: "seed" | "couch";
  updated_at: number;
};

type RatingResponse = {
  ok: boolean;
  enabled: boolean;
  rating: FireWaterRating | null;
  prompt: {
    eligible: boolean;
    presented_at: number | null;
    resolved_at: number | null;
  };
};

type Axis = "fire" | "water";
type FocusTarget = Axis | "save" | "cancel";

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || "Rating could not be saved.");
  return payload;
}

export async function loadFireWaterRating(card: ContentCard): Promise<RatingResponse> {
  const query = new URLSearchParams({ type: card.type, id: card.id });
  return responseJson<RatingResponse>(await fetch(`/api/catalog/library/ratings?${query}`, {
    cache: "no-store",
  }));
}

function ratingLabel(value: number | null): string {
  return value === null ? "Not set" : `${value.toFixed(1)} out of 5`;
}

/**
 * Five familiar emoji marks, matching the household rating sheet: saturated
 * flame/wave fill, grayscale remainder, and a clipped foreground for half marks.
 */
export function renderRatingMarks(
  target: HTMLElement,
  axis: Axis,
  value: number | null,
  compact = false,
): void {
  target.replaceChildren();
  target.classList.toggle("rating-marks--compact", compact);
  target.dataset.axis = axis;
  const symbol = axis === "fire" ? "🔥" : "🌊";
  for (let index = 0; index < 5; index += 1) {
    const markValue = value === null ? 0 : Math.max(0, Math.min(1, value - index));
    const mark = document.createElement("span");
    mark.className = "rating-mark";
    mark.setAttribute("aria-hidden", "true");
    const empty = document.createElement("span");
    empty.className = "rating-mark-empty";
    empty.textContent = symbol;
    const fill = document.createElement("span");
    fill.className = "rating-mark-fill";
    fill.style.width = `${markValue * 100}%`;
    fill.textContent = symbol;
    mark.append(empty, fill);
    target.append(mark);
  }
}

export class RatingSheetController {
  private card: ContentCard | null = null;
  private current: FireWaterRating | null = null;
  private values: Record<Axis, number | null> = { fire: null, water: null };
  private confirmed: Record<Axis, boolean> = { fire: false, water: false };
  private focus: FocusTarget = "fire";
  private adjusting: Axis | null = null;
  private saving = false;
  private clearConfirm = false;
  private invitationEligible = false;

  constructor(
    private readonly sheet: HTMLElement,
    private readonly title: HTMLElement,
    private readonly errorBand: HTMLElement,
    private readonly fireRow: HTMLButtonElement,
    private readonly fireMarks: HTMLElement,
    private readonly fireValue: HTMLElement,
    private readonly waterRow: HTMLButtonElement,
    private readonly waterMarks: HTMLElement,
    private readonly waterValue: HTMLElement,
    private readonly saveButton: HTMLButtonElement,
    private readonly cancelButton: HTMLButtonElement,
    private readonly clearBand: HTMLElement,
    private readonly detailRateButton: HTMLButtonElement,
    private readonly detailChips: HTMLElement,
    private readonly detailFireMarks: HTMLElement,
    private readonly detailFireValue: HTMLElement,
    private readonly detailWaterMarks: HTMLElement,
    private readonly detailWaterValue: HTMLElement,
    private readonly invitation: HTMLElement,
    private readonly onChanged: (rating: FireWaterRating | null) => void,
  ) {
    this.detailRateButton.addEventListener("click", () => this.open());
    this.fireRow.addEventListener("click", () => this.activateTarget("fire"));
    this.waterRow.addEventListener("click", () => this.activateTarget("water"));
    this.saveButton.addEventListener("click", () => void this.save());
    this.cancelButton.addEventListener("click", () => this.close());
  }

  get isOpen(): boolean {
    return !this.sheet.classList.contains("hidden");
  }

  async bindCard(card: ContentCard, eligible: boolean): Promise<void> {
    this.card = card;
    this.current = null;
    this.invitationEligible = false;
    this.detailRateButton.hidden = !eligible;
    this.detailChips.hidden = true;
    this.invitation.hidden = true;
    if (!eligible) return;
    try {
      const response = await loadFireWaterRating(card);
      if (this.card !== card) return;
      if (!response.enabled) {
        this.detailRateButton.hidden = true;
        return;
      }
      this.current = response.rating;
      this.invitationEligible = response.prompt.eligible;
      this.renderDetailState();
    } catch {
      if (this.card === card) {
        this.detailRateButton.textContent = "rate";
        this.detailRateButton.hidden = false;
      }
    }
  }

  async detailClosing(): Promise<void> {
    const card = this.card;
    if (card && this.invitationEligible && !this.current) {
      await fetch("/api/catalog/library/rating-prompts/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: card.type, id: card.id, disposition: "left_detail" }),
      }).catch(() => undefined);
    }
    this.close(false);
    this.card = null;
  }

  private renderDetailState(): void {
    const rating = this.current;
    this.detailRateButton.textContent = rating ? "edit rating" : "rate";
    this.detailRateButton.classList.toggle("detail-button--rating-cue", this.invitationEligible && !rating);
    this.invitation.hidden = !this.invitationEligible || Boolean(rating);
    this.detailChips.hidden = !rating;
    if (!rating) return;
    renderRatingMarks(this.detailFireMarks, "fire", rating.fire, true);
    renderRatingMarks(this.detailWaterMarks, "water", rating.water, true);
    this.detailFireValue.textContent = rating.fire.toFixed(1);
    this.detailWaterValue.textContent = rating.water.toFixed(1);
  }

  open(): void {
    const card = this.card;
    if (!card || this.detailRateButton.hidden) return;
    this.values = {
      fire: this.current?.fire ?? null,
      water: this.current?.water ?? null,
    };
    this.confirmed = {
      fire: Boolean(this.current),
      water: Boolean(this.current),
    };
    this.focus = "fire";
    this.adjusting = null;
    this.saving = false;
    this.clearConfirm = false;
    this.title.textContent = this.current ? `Edit rating · ${card.title}` : `Rate · ${card.title}`;
    this.errorBand.hidden = true;
    this.clearBand.hidden = true;
    const clearHelp = this.sheet.querySelector<HTMLElement>(".rating-sheet-clear-help");
    if (clearHelp) clearHelp.hidden = !this.current;
    this.sheet.classList.remove("hidden");
    this.sheet.setAttribute("aria-hidden", "false");
    this.render();
  }

  close(restoreFocus = true): void {
    if (!this.isOpen) return;
    this.sheet.classList.add("hidden");
    this.sheet.setAttribute("aria-hidden", "true");
    this.adjusting = null;
    this.saving = false;
    this.clearConfirm = false;
    if (restoreFocus) {
      this.detailRateButton.focus({ preventScroll: true });
      this.detailRateButton.classList.add("focused");
    }
  }

  back(): boolean {
    if (!this.isOpen) return false;
    if (this.clearConfirm) {
      this.clearConfirm = false;
      this.clearBand.hidden = true;
      this.render();
      return true;
    }
    this.close();
    return true;
  }

  moveRow(delta: number): boolean {
    if (!this.isOpen || this.saving) return this.isOpen;
    if (this.adjusting || this.clearConfirm) return true;
    const targets: FocusTarget[] = ["fire", "water", "save", "cancel"];
    const index = targets.indexOf(this.focus);
    this.focus = targets[Math.max(0, Math.min(targets.length - 1, index + Math.sign(delta)))]!;
    this.render();
    return true;
  }

  moveCol(delta: number): boolean {
    if (!this.isOpen || this.saving || this.clearConfirm) return this.isOpen;
    if (this.adjusting) {
      const current = this.values[this.adjusting] ?? 2.5;
      this.values[this.adjusting] = Math.max(0, Math.min(5, current + Math.sign(delta) * 0.5));
      this.render();
      return true;
    }
    if (this.focus === "save" || this.focus === "cancel") {
      this.focus = this.focus === "save" ? "cancel" : "save";
      this.render();
    }
    return true;
  }

  activate(): boolean {
    if (!this.isOpen || this.saving) return this.isOpen;
    if (this.clearConfirm) {
      void this.clear();
      return true;
    }
    this.activateTarget(this.focus);
    return true;
  }

  secondary(): boolean {
    if (!this.isOpen) return false;
    if (!this.current || this.saving) return true;
    this.clearConfirm = true;
    this.adjusting = null;
    this.clearBand.hidden = false;
    this.render();
    return true;
  }

  private activateTarget(target: FocusTarget): void {
    if (target === "fire" || target === "water") {
      this.focus = target;
      if (this.adjusting === target) {
        this.adjusting = null;
        this.confirmed[target] = true;
      } else {
        this.adjusting = target;
        if (this.values[target] === null) this.values[target] = 2.5;
      }
      this.render();
    } else if (target === "save") {
      void this.save();
    } else {
      this.close();
    }
  }

  private render(): void {
    const rows = { fire: this.fireRow, water: this.waterRow };
    for (const axis of ["fire", "water"] as const) {
      const row = rows[axis];
      row.classList.toggle("focused", this.focus === axis);
      row.classList.toggle("rating-axis--adjusting", this.adjusting === axis);
      row.setAttribute("aria-valuenow", String(this.values[axis] ?? 0));
      row.setAttribute("aria-valuetext", ratingLabel(this.values[axis]));
    }
    renderRatingMarks(this.fireMarks, "fire", this.values.fire);
    renderRatingMarks(this.waterMarks, "water", this.values.water);
    this.fireValue.textContent = ratingLabel(this.values.fire);
    this.waterValue.textContent = ratingLabel(this.values.water);
    const canSave = this.confirmed.fire && this.confirmed.water
      && this.values.fire !== null && this.values.water !== null && !this.saving;
    this.saveButton.disabled = !canSave;
    this.saveButton.classList.toggle("focused", this.focus === "save");
    this.cancelButton.classList.toggle("focused", this.focus === "cancel");
    const focused = this.focus === "fire"
      ? this.fireRow
      : this.focus === "water"
        ? this.waterRow
        : this.focus === "save"
          ? this.saveButton
          : this.cancelButton;
    focused.focus({ preventScroll: true });
  }

  private async save(): Promise<void> {
    const card = this.card;
    if (!card || this.saving || !this.confirmed.fire || !this.confirmed.water
      || this.values.fire === null || this.values.water === null) return;
    this.saving = true;
    this.errorBand.hidden = true;
    this.saveButton.textContent = "saving…";
    this.render();
    try {
      const response = await responseJson<{ rating: FireWaterRating }>(await fetch(
        "/api/catalog/library/ratings",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: card.type,
            id: card.id,
            title: card.title,
            year: card.year ?? null,
            fire: this.values.fire,
            water: this.values.water,
            expected_revision: this.current?.revision ?? 0,
          }),
        },
      ));
      this.current = response.rating;
      this.invitationEligible = false;
      this.renderDetailState();
      this.close();
      this.onChanged(response.rating);
      showToast("rating saved", { tone: "success" });
    } catch (error) {
      this.saving = false;
      this.saveButton.textContent = "save rating";
      this.errorBand.textContent = error instanceof Error ? error.message : "Rating could not be saved.";
      this.errorBand.hidden = false;
      this.render();
    } finally {
      if (!this.isOpen) this.saveButton.textContent = "save rating";
    }
  }

  private async clear(): Promise<void> {
    const card = this.card;
    const current = this.current;
    if (!card || !current || this.saving) return;
    this.saving = true;
    this.errorBand.hidden = true;
    try {
      const query = new URLSearchParams({
        type: card.type,
        id: card.id,
        expected_revision: String(current.revision),
      });
      await responseJson(await fetch(`/api/catalog/library/ratings?${query}`, { method: "DELETE" }));
      this.current = null;
      this.invitationEligible = false;
      this.renderDetailState();
      this.close();
      this.onChanged(null);
      showToast("rating cleared", { tone: "success" });
    } catch (error) {
      this.saving = false;
      this.clearConfirm = false;
      this.clearBand.hidden = true;
      this.errorBand.textContent = error instanceof Error ? error.message : "Rating could not be cleared.";
      this.errorBand.hidden = false;
      this.render();
    }
  }
}
