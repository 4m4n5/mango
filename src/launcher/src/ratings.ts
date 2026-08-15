import type { ContentCard } from "./types";
import { recommendationAttributionPayload } from "./recommendation-attribution";
import { showToast } from "./toast";
import { setControlLabel } from "./icons";
import {
  personalizationExpectationBody,
  personalizationExpectationParams,
  personalizationOwnerFromPayload,
  samePersonalizationOwner,
  type PersonalizationOwner,
  type PersonalizationOwnerPayload,
} from "./personalization";
import { CatalogOwnershipChangedError } from "./catalog-errors";

export type HalfStepRating =
  | 0 | 0.5 | 1 | 1.5 | 2 | 2.5
  | 3 | 3.5 | 4 | 4.5 | 5;

export const NEUTRAL_FIRE_WATER_RATING: HalfStepRating = 2;

export function initialRatingAxisValue(value: HalfStepRating | null): HalfStepRating {
  return value ?? NEUTRAL_FIRE_WATER_RATING;
}

export function nudgeHalfStep(value: HalfStepRating | null, delta: number): HalfStepRating {
  const current = initialRatingAxisValue(value);
  const next = current + Math.sign(delta) * 0.5;
  return Math.max(0, Math.min(5, next)) as HalfStepRating;
}

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
} & PersonalizationOwnerPayload;

type Axis = "fire" | "water";
type FocusTarget = Axis | "save" | "not_for_me";

async function responseJson<T extends PersonalizationOwnerPayload>(
  response: Response,
  expectedOwner: PersonalizationOwner,
): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) {
    if (response.status === 409) throw new CatalogOwnershipChangedError();
    throw new Error(payload.error || "Rating could not be saved.");
  }
  const responseOwner = personalizationOwnerFromPayload(payload);
  if (!responseOwner || !samePersonalizationOwner(responseOwner, expectedOwner)) {
    throw new CatalogOwnershipChangedError();
  }
  return payload;
}

export async function loadFireWaterRating(
  card: ContentCard,
  expectedOwner: PersonalizationOwner,
): Promise<RatingResponse> {
  const query = personalizationExpectationParams(expectedOwner);
  query.set("type", card.type);
  query.set("id", card.id);
  return responseJson<RatingResponse>(await fetch(`/api/catalog/library/ratings?${query}`, {
    cache: "no-store",
  }), expectedOwner);
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
    const emptyGlyph = document.createElement("span");
    emptyGlyph.className = "rating-mark-glyph";
    emptyGlyph.textContent = symbol;
    empty.append(emptyGlyph);
    const fill = document.createElement("span");
    fill.className = "rating-mark-fill";
    // Clip the fill layer; keep the glyph at full mark width so 50% is the
    // left half of the emoji ink, not a squashed/over-wide color emoji box.
    fill.style.width = `${markValue * 100}%`;
    const fillGlyph = document.createElement("span");
    fillGlyph.className = "rating-mark-glyph";
    fillGlyph.textContent = symbol;
    fill.append(fillGlyph);
    mark.append(empty, fill);
    target.append(mark);
  }
}

export class RatingSheetController {
  private card: ContentCard | null = null;
  private owner: PersonalizationOwner | null = null;
  private current: FireWaterRating | null = null;
  private values: Record<Axis, number | null> = { fire: null, water: null };
  private confirmed: Record<Axis, boolean> = { fire: false, water: false };
  private focus: FocusTarget = "fire";
  private saving = false;
  private clearConfirm = false;
  private invitationEligible = false;
  private notForMeAction: (() => void) | null = null;

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
    private readonly notForMeButton: HTMLButtonElement,
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
    this.notForMeButton.addEventListener("click", () => this.notForMeAction?.());
  }

  connectNotForMe(action: () => void): void {
    this.notForMeAction = action;
  }

  setNotForMeLabel(text: string): void {
    setControlLabel(this.notForMeButton, text);
  }

  setNotForMeDisabled(disabled: boolean): void {
    this.notForMeButton.disabled = disabled;
  }

  get isOpen(): boolean {
    return !this.sheet.classList.contains("hidden");
  }

  async bindCard(
    card: ContentCard,
    eligible: boolean,
    owner: PersonalizationOwner,
  ): Promise<void> {
    this.card = card;
    this.owner = { ...owner };
    this.current = null;
    this.invitationEligible = false;
    this.detailRateButton.hidden = !eligible;
    this.detailChips.hidden = true;
    this.invitation.hidden = true;
    if (!eligible) return;
    try {
      const response = await loadFireWaterRating(card, owner);
      if (this.card !== card || !this.owner || !samePersonalizationOwner(this.owner, owner)) return;
      if (!response.enabled) {
        this.detailRateButton.hidden = true;
        return;
      }
      this.current = response.rating;
      this.invitationEligible = response.prompt.eligible;
      this.renderDetailState();
    } catch {
      if (this.card === card) {
        setControlLabel(this.detailRateButton, "rate");
        this.detailRateButton.hidden = false;
      }
    }
  }

  async detailClosing(): Promise<void> {
    const card = this.card;
    const owner = this.owner;
    if (card && owner && this.invitationEligible && !this.current) {
      await responseJson(await fetch("/api/catalog/library/rating-prompts/dismiss", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: card.type,
          id: card.id,
          disposition: "left_detail",
          ...personalizationExpectationBody(owner),
        }),
      }), owner).catch(() => undefined);
    }
    this.close(false);
    this.card = null;
    this.owner = null;
  }

  private renderDetailState(): void {
    const rating = this.current;
    setControlLabel(this.detailRateButton, rating ? "edit rating" : "rate");
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
    this.saving = false;
    this.clearConfirm = false;
    this.title.textContent = this.current ? `edit · ${card.title}` : `rate · ${card.title}`;
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

  private focusTargets(): FocusTarget[] {
    const targets: FocusTarget[] = ["fire", "water", "save"];
    if (!this.notForMeButton.hidden) targets.push("not_for_me");
    return targets;
  }

  moveRow(delta: number): boolean {
    if (!this.isOpen || this.saving) return this.isOpen;
    if (this.clearConfirm) return true;
    const targets = this.focusTargets();
    const index = targets.indexOf(this.focus);
    this.focus = targets[Math.max(0, Math.min(targets.length - 1, index + Math.sign(delta)))]!;
    this.render();
    return true;
  }

  moveCol(delta: number): boolean {
    if (!this.isOpen || this.saving || this.clearConfirm) return this.isOpen;
    if (this.focus === "fire" || this.focus === "water") {
      this.values[this.focus] = nudgeHalfStep(this.values[this.focus] as HalfStepRating | null, delta);
      this.confirmed[this.focus] = true;
      this.render();
      return true;
    }
    if (this.focus === "save" || this.focus === "not_for_me") {
      if (!this.notForMeButton.hidden) {
        this.focus = this.focus === "save" ? "not_for_me" : "save";
        this.render();
      }
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
    this.clearBand.hidden = false;
    this.render();
    return true;
  }

  private activateTarget(target: FocusTarget): void {
    if (target === "fire" || target === "water") {
      this.focus = target;
      this.render();
    } else if (target === "save") {
      void this.save();
    } else {
      this.notForMeAction?.();
    }
  }

  private render(): void {
    const rows = { fire: this.fireRow, water: this.waterRow };
    for (const axis of ["fire", "water"] as const) {
      const row = rows[axis];
      row.classList.toggle("focused", this.focus === axis);
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
    this.notForMeButton.classList.toggle("focused", this.focus === "not_for_me");
    const focused = this.focus === "fire"
      ? this.fireRow
      : this.focus === "water"
        ? this.waterRow
        : this.focus === "save"
          ? this.saveButton
          : this.notForMeButton;
    focused.focus({ preventScroll: true });
  }

  private async save(): Promise<void> {
    const card = this.card;
    const owner = this.owner;
    if (!card || !owner || this.saving || !this.confirmed.fire || !this.confirmed.water
      || this.values.fire === null || this.values.water === null) return;
    this.saving = true;
    this.errorBand.hidden = true;
    setControlLabel(this.saveButton, "saving…");
    this.render();
    try {
      const response = await responseJson<{
        rating: FireWaterRating;
        profile_id?: unknown;
        personalization_updated_at?: unknown;
      }>(await fetch(
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
            ...recommendationAttributionPayload(card),
            ...personalizationExpectationBody(owner),
          }),
        },
      ), owner);
      if (this.card !== card || !this.owner || !samePersonalizationOwner(this.owner, owner)) {
        throw new CatalogOwnershipChangedError();
      }
      this.current = response.rating;
      this.invitationEligible = false;
      this.renderDetailState();
      this.close();
      this.onChanged(response.rating);
      showToast("rating saved", { tone: "success" });
    } catch (error) {
      this.saving = false;
      setControlLabel(this.saveButton, "save");
      this.errorBand.textContent = error instanceof Error ? error.message : "Rating could not be saved.";
      this.errorBand.hidden = false;
      this.render();
    } finally {
      if (!this.isOpen) setControlLabel(this.saveButton, "save");
    }
  }

  private async clear(): Promise<void> {
    const card = this.card;
    const current = this.current;
    const owner = this.owner;
    if (!card || !current || !owner || this.saving) return;
    this.saving = true;
    this.errorBand.hidden = true;
    try {
      const query = personalizationExpectationParams(owner);
      query.set("type", card.type);
      query.set("id", card.id);
      query.set("expected_revision", String(current.revision));
      for (const [key, value] of Object.entries(recommendationAttributionPayload(card))) {
        if (value !== undefined) query.set(key, String(value));
      }
      await responseJson(await fetch(
        `/api/catalog/library/ratings?${query}`,
        { method: "DELETE" },
      ), owner);
      if (this.card !== card || !this.owner || !samePersonalizationOwner(this.owner, owner)) {
        throw new CatalogOwnershipChangedError();
      }
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
