import type { LauncherStatusReporter } from "./toast";

export interface ViewerProfile {
  profile_id: string;
  name: string;
  kind: "household" | "personal";
  onboarding_complete: boolean;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface PersonalizationState {
  active_profile_id: string;
  mood: string | null;
  mood_started_at: number | null;
  mood_expires_at: number | null;
  updated_at: number;
}

export interface PersonalizationPayload {
  ok: boolean;
  profiles: ViewerProfile[];
  state: PersonalizationState;
  household_only?: boolean;
}

/** Fail closed while the catalog service is starting: profile chrome is shown only on an explicit profile-mode response. */
export function personalizationControlsVisible(payload: PersonalizationPayload | null): boolean {
  return payload?.household_only === false;
}

export type PersonalizationChanged = (
  payload: PersonalizationPayload,
) => void | Promise<void>;

export interface PersonalizationRequestVersion {
  catalogRequestSeq: number;
  profileId: string;
  personalizationUpdatedAt: number;
}

export interface PersonalizationOwner {
  profileId: string;
  personalizationUpdatedAt: number;
}

export interface PersonalizationOwnedValue<T> {
  value: T;
  owner: PersonalizationOwner | null;
}

export interface PersonalizationOwnedCacheRefresh<T> {
  /** Value eligible for immediate read-through during this load. */
  cachedValue: T | undefined;
  /** Durable owner-valid value retained until a successful commit. */
  lastGoodValue: T | undefined;
  commit: (value: T, owner: PersonalizationOwner | null) => void;
}

export type PersonalizationOwnerPayload = {
  profile_id?: unknown;
  personalization_updated_at?: unknown;
};

export function personalizationExpectationParams(
  owner: PersonalizationOwner,
): URLSearchParams {
  return new URLSearchParams({
    expected_profile_id: owner.profileId,
    expected_personalization_updated_at: String(owner.personalizationUpdatedAt),
  });
}

/** Immutable ownership pair for profile-owned mutations and playback starts. */
export function personalizationExpectationBody(
  owner: PersonalizationOwner,
): {
  expected_profile_id: string;
  expected_personalization_updated_at: number;
} {
  return {
    expected_profile_id: owner.profileId,
    expected_personalization_updated_at: owner.personalizationUpdatedAt,
  };
}

export function personalizationOwnerFromPayload(
  payload: PersonalizationOwnerPayload,
): PersonalizationOwner | null {
  if (typeof payload.profile_id !== "string" || !payload.profile_id.trim()
    || !Number.isSafeInteger(payload.personalization_updated_at)
    || Number(payload.personalization_updated_at) < 0) {
    return null;
  }
  return {
    profileId: payload.profile_id,
    personalizationUpdatedAt: Number(payload.personalization_updated_at),
  };
}

export function samePersonalizationOwner(
  left: PersonalizationOwner,
  right: PersonalizationOwner,
): boolean {
  return left.profileId === right.profileId
    && left.personalizationUpdatedAt === right.personalizationUpdatedAt;
}

export function personalizationOwnerFromState(
  state: Pick<PersonalizationState, "active_profile_id" | "updated_at">,
): PersonalizationOwner {
  return {
    profileId: state.active_profile_id,
    personalizationUpdatedAt: state.updated_at,
  };
}

/** A cached personalized tab is paintable only after a fresh server read. */
export function canActivatePersonalizedCatalogCache(
  cachedOwner: PersonalizationOwner,
  currentServerState: Pick<PersonalizationState, "active_profile_id" | "updated_at">,
): boolean {
  return samePersonalizationOwner(cachedOwner, personalizationOwnerFromState(currentServerState));
}

/** Returns a cached personalized value only when its immutable owner is current. */
export function personalizationOwnedValue<T>(
  entry: PersonalizationOwnedValue<T> | undefined,
  currentOwner: PersonalizationOwner,
): T | undefined {
  if (!entry?.owner || !samePersonalizationOwner(entry.owner, currentOwner)) {
    return undefined;
  }
  return entry.value;
}

/** Small owner-aware cache used by launcher tabs; unowned values are explicit. */
export class PersonalizationOwnedCache<K, T> {
  private readonly entries = new Map<K, PersonalizationOwnedValue<T>>();

  set(key: K, value: T, owner: PersonalizationOwner | null): void {
    this.entries.set(key, { value, owner: owner ? { ...owner } : null });
  }

  get(key: K, currentOwner: PersonalizationOwner | null): T | undefined {
    const entry = this.entries.get(key);
    if (currentOwner === null) {
      return entry?.owner === null ? entry.value : undefined;
    }
    return personalizationOwnedValue(entry, currentOwner);
  }

  /**
   * Starts a non-destructive cache refresh. A forced load can bypass immediate
   * read-through without deleting the owner-valid last-good value; the caller
   * replaces that value only after its complete response has been validated.
   */
  beginRefresh(
    key: K,
    currentOwner: PersonalizationOwner | null,
    options: { bypassRead?: boolean } = {},
  ): PersonalizationOwnedCacheRefresh<T> {
    const lastGoodValue = this.get(key, currentOwner);
    return {
      cachedValue: options.bypassRead ? undefined : lastGoodValue,
      lastGoodValue,
      commit: (value, owner) => this.set(key, value, owner),
    };
  }

  delete(key: K): boolean {
    return this.entries.delete(key);
  }
}

export function samePersonalizationRequestVersion(
  left: PersonalizationRequestVersion,
  right: PersonalizationRequestVersion,
): boolean {
  return left.catalogRequestSeq === right.catalogRequestSeq
    && left.profileId === right.profileId
    && left.personalizationUpdatedAt === right.personalizationUpdatedAt;
}

type MoodChoice = {
  id: string | null;
  label: string;
  description: string;
};

// Explicit, compact intents rather than inferred context. The backend keeps the
// selection time-bounded, so this changes the current couch session rather than
// becoming a permanent taste label.
export const MOOD_CHOICES: readonly MoodChoice[] = [
  { id: null, label: "Any mood", description: "use my full taste" },
  { id: "cozy", label: "Cozy", description: "warm and easy" },
  { id: "laugh", label: "Make me laugh", description: "light and funny" },
  { id: "thrilling", label: "Thrilling", description: "pace and tension" },
  { id: "deep", label: "Thoughtful", description: "deep and reflective" },
  { id: "family", label: "Family time", description: "good for the room" },
];

const MOOD_LABELS = new Map(
  MOOD_CHOICES.filter((choice) => choice.id !== null)
    .map((choice) => [choice.id as string, choice.label]),
);

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || "Personalization is unavailable.");
  }
  return payload;
}

export async function fetchPersonalizationState(): Promise<PersonalizationPayload> {
  return responseJson<PersonalizationPayload>(await fetch(
    "/api/catalog/personalization/state",
    { cache: "no-store" },
  ));
}

export function activeViewerProfile(payload: PersonalizationPayload): ViewerProfile {
  return payload.profiles.find((profile) => profile.profile_id === payload.state.active_profile_id)
    ?? payload.profiles.find((profile) => profile.kind === "household")
    ?? payload.profiles[0]
    ?? {
      profile_id: "household",
      name: "Household",
      kind: "household",
      onboarding_complete: true,
      sort_order: 0,
      created_at: 0,
      updated_at: 0,
    };
}

export function moodDisplayLabel(mood: string | null): string {
  if (!mood) return "Any mood";
  const known = MOOD_LABELS.get(mood);
  if (known) return known;
  const readable = mood.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return readable ? `${readable[0].toUpperCase()}${readable.slice(1)}` : "Any mood";
}

export function personalizationAriaLabel(payload: PersonalizationPayload): string {
  const profile = activeViewerProfile(payload);
  return `Personalization settings. ${profile.name} profile. ${moodDisplayLabel(payload.state.mood)}.`;
}

export function needsProfileOnboarding(payload: PersonalizationPayload): boolean {
  const profile = activeViewerProfile(payload);
  return profile.kind === "personal" && !profile.onboarding_complete;
}

export async function buildPersonalizationSettings(
  container: HTMLElement,
  onStatus: LauncherStatusReporter,
  onChanged: PersonalizationChanged = () => undefined,
): Promise<void> {
  const section = document.createElement("section");
  section.className = "personalization-section";
  section.setAttribute("aria-labelledby", "personalization-settings-heading");

  const heading = document.createElement("h2");
  heading.id = "personalization-settings-heading";
  heading.className = "settings-heading";
  heading.textContent = "Personalization";
  section.append(heading);
  container.append(section);

  try {
    const payload = await fetchPersonalizationState();
    if (!personalizationControlsVisible(payload)) {
      section.remove();
      return;
    }
    renderPersonalizationSection(section, payload, onStatus, onChanged);
  } catch {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = "Personalization is unavailable while the catalog is starting.";
    section.append(fallback);
  }
}

function renderPersonalizationSection(
  section: HTMLElement,
  payload: PersonalizationPayload,
  onStatus: LauncherStatusReporter,
  onChanged: PersonalizationChanged,
  restoreFocusKey?: string,
): void {
  const heading = section.querySelector<HTMLHeadingElement>("#personalization-settings-heading")
    ?? document.createElement("h2");
  heading.id = "personalization-settings-heading";
  heading.className = "settings-heading";
  heading.textContent = "Personalization";
  section.replaceChildren(heading);

  const profile = activeViewerProfile(payload);
  const summary = document.createElement("div");
  summary.className = "personalization-summary";
  summary.setAttribute("aria-live", "polite");

  const avatar = document.createElement("span");
  avatar.className = "personalization-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = profileInitial(profile.name);

  const summaryCopy = document.createElement("span");
  summaryCopy.className = "personalization-summary-copy";
  summaryCopy.append(
    actionSpan("personalization-summary-name", profile.name),
    actionSpan(
      "personalization-summary-meta",
      profile.kind === "household"
        ? "shared taste · balanced for everyone"
        : "your ratings, history, and recommendations",
    ),
  );

  const mood = document.createElement("span");
  mood.className = `personalization-mood${payload.state.mood ? " personalization-mood--active" : ""}`;
  mood.textContent = moodDisplayLabel(payload.state.mood);
  summary.append(avatar, summaryCopy, mood);

  const onboarding = document.createElement("div");
  onboarding.className = "personalization-onboarding";
  if (needsProfileOnboarding(payload)) {
    const onboardingTitle = document.createElement("h3");
    onboardingTitle.className = "settings-subheading";
    onboardingTitle.textContent = "Make this profile yours";
    const onboardingCopy = document.createElement("p");
    onboardingCopy.className = "settings-note";
    onboardingCopy.textContent = "Rate a few movies or shows with Fire and Water as you browse. You can skip setup now; Mango will learn gently from watching and saving.";
    const finish = settingsChoice(
      "Start watching",
      "skip setup · ratings remain available in every title",
      false,
      `onboarding:${profile.profile_id}`,
    );
    finish.addEventListener("click", () => {
      void updatePersonalization(
        section,
        "/api/catalog/personalization/profiles",
        { action: "complete_onboarding", profile_id: profile.profile_id },
        `profile:${profile.profile_id}`,
        `${profile.name} is ready. Rate any title whenever you like.`,
        onStatus,
        onChanged,
      );
    });
    onboarding.append(onboardingTitle, onboardingCopy, finish);
  }

  const profileHeading = document.createElement("h3");
  profileHeading.className = "settings-subheading";
  profileHeading.textContent = "Who is watching?";

  const profileChoices = document.createElement("div");
  profileChoices.className = "settings-actions-row personalization-options personalization-profile-options";
  for (const choice of payload.profiles) {
    const selected = choice.profile_id === payload.state.active_profile_id;
    const button = settingsChoice(
      choice.name,
      selected
        ? "watching now"
        : choice.kind === "household" ? "shared household taste" : "personal taste",
      selected,
      `profile:${choice.profile_id}`,
    );
    if (selected) button.dataset.personalizationPrimary = "true";
    button.setAttribute("aria-label", `${choice.name} profile${selected ? ", active" : ""}`);
    button.addEventListener("click", () => {
      if (selected) {
        onStatus(`${choice.name} is already active.`, "hint");
        return;
      }
      void updatePersonalization(
        section,
        "/api/catalog/personalization/activate",
        { profile_id: choice.profile_id },
        `profile:${choice.profile_id}`,
        `${choice.name} is now watching. Mood cleared.`,
        onStatus,
        onChanged,
      );
    });
    profileChoices.append(button);
  }

  const profileNote = document.createElement("p");
  profileNote.className = "settings-note personalization-companion-note";
  profileNote.textContent = "Create or rename personal profiles in the Mango companion. They appear here automatically.";

  const moodHeading = document.createElement("h3");
  moodHeading.className = "settings-subheading";
  moodHeading.textContent = "What fits right now?";

  const moodIntro = document.createElement("p");
  moodIntro.className = "settings-note";
  moodIntro.textContent = "Optional for this session. It nudges recommendations without changing your Fire and Water ratings.";

  const moodChoices = document.createElement("div");
  moodChoices.className = "settings-actions-row personalization-options personalization-mood-options";
  for (const choice of MOOD_CHOICES) {
    const selected = choice.id === payload.state.mood;
    const key = `mood:${choice.id ?? "any"}`;
    const clearAction = choice.id === null && payload.state.mood !== null;
    const visibleLabel = clearAction ? "Clear mood" : choice.label;
    const button = settingsChoice(
      visibleLabel,
      selected ? "selected · use my full taste" : clearAction ? "return to my full taste" : choice.description,
      selected,
      key,
    );
    button.setAttribute("aria-label", `${visibleLabel}${selected ? ", selected" : ""}`);
    button.addEventListener("click", () => {
      if (selected) {
        onStatus(`${choice.label} is already selected.`, "hint");
        return;
      }
      void updatePersonalization(
        section,
        "/api/catalog/personalization/mood",
        { mood: choice.id, ttl_ms: 4 * 60 * 60 * 1000 },
        key,
        choice.id ? `${choice.label} mood set for this session.` : "Mood cleared. Using your full taste.",
        onStatus,
        onChanged,
      );
    });
    moodChoices.append(button);
  }

  section.append(
    summary,
    onboarding,
    profileHeading,
    profileChoices,
    profileNote,
    moodHeading,
    moodIntro,
    moodChoices,
  );

  if (restoreFocusKey) {
    const target = Array.from(section.querySelectorAll<HTMLElement>("[data-personalization-key]"))
      .find((element) => element.dataset.personalizationKey === restoreFocusKey);
    target?.classList.add("focused");
    target?.focus({ preventScroll: true });
  }
}

async function updatePersonalization(
  section: HTMLElement,
  endpoint: string,
  body: Record<string, unknown>,
  focusKey: string,
  successMessage: string,
  onStatus: LauncherStatusReporter,
  onChanged: PersonalizationChanged,
): Promise<void> {
  if (section.dataset.busy === "true") return;
  section.dataset.busy = "true";
  const controls = section.querySelectorAll<HTMLButtonElement>("button[data-settings-focus]");
  controls.forEach((control) => { control.disabled = true; });
  onStatus("Updating recommendations…", "progress");
  try {
    await responseJson(await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    const payload = await fetchPersonalizationState();
    await onChanged(payload);
    renderPersonalizationSection(section, payload, onStatus, onChanged, focusKey);
    onStatus(successMessage, "success");
  } catch {
    onStatus("Couldn't update personalization. Try again.", "error");
    controls.forEach((control) => { control.disabled = false; });
  } finally {
    section.dataset.busy = "false";
  }
}

function settingsChoice(
  title: string,
  meta: string,
  selected: boolean,
  key: string,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `settings-action settings-action--quick${selected ? " settings-action--selected" : ""}`;
  button.dataset.settingsFocus = "true";
  button.dataset.personalizationKey = key;
  button.setAttribute("aria-pressed", String(selected));
  button.append(actionSpan("settings-action-title", title));
  button.append(actionSpan("settings-action-meta", meta));
  return button;
}

function actionSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

export function profileInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() || "M";
}
