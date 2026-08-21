import {
  fetchRefreshLevels,
  startRefreshLevel,
  type RefreshLevel,
} from "./refresh";
import {
  fetchReliabilityState,
  importYoutubeTakeout,
  runReliabilityAction,
  type ReliabilityAction,
  type ReliabilityActionId,
  type ReliabilityComponent,
  type ReliabilityLevel,
  type ReliabilityState,
} from "./reliability";
import type { RefreshLevelId } from "./types";
import type { LauncherStatusReporter } from "./toast";
import {
  buildPersonalizationSettings,
  personalizationExpectationParams,
  personalizationOwnerFromPayload,
  samePersonalizationOwner,
  type PersonalizationChanged,
  type PersonalizationOwner,
} from "./personalization";
import {
  CatalogOwnershipChangedError,
  CatalogResponseError,
} from "./catalog-errors";

export async function buildSettingsRefresh(
  container: HTMLElement,
  onStatus: LauncherStatusReporter,
  owner: PersonalizationOwner,
  onPersonalizationChanged: PersonalizationChanged = () => undefined,
): Promise<void> {
  container.replaceChildren();

  // Every recursive Settings rebuild retains the immutable owner captured when
  // the surface opened. A profile/mood change receives a new owner from main.ts
  // and starts a fresh build instead of silently weakening this boundary.
  const rebuild = () => buildSettingsRefresh(
    container,
    onStatus,
    owner,
    onPersonalizationChanged,
  );

  await buildPersonalizationSettings(container, onStatus, onPersonalizationChanged);
  await buildHiddenTitlesSettings(container, onStatus, owner);
  await buildReliabilityCenter(container, onStatus, rebuild);
  await buildSearchSettings(container, onStatus, rebuild);

  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Library refresh";

  const intro = document.createElement("p");
  intro.className = "settings-note";
  intro.textContent = "Shuffle re-picks verified titles on Movies, TV Shows, and YouTube. Live channels stay cached — no reshuffle.";

  container.append(heading, intro);

  try {
    const levels = await fetchRefreshLevels();
    container.append(createShuffleButton(onStatus));
    appendLevelGroup(container, "quick", levels.filter((level) => level.category === "quick"), onStatus);
    appendLevelGroup(container, "standard", levels.filter((level) => level.category === "standard"), onStatus);
    appendLevelGroup(container, "overnight", levels.filter((level) => level.category === "overnight"), onStatus);
  } catch {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = "Refresh options unavailable — catalog-service may be starting.";
    container.append(fallback);
  }

  const creditsHeading = document.createElement("h2");
  creditsHeading.className = "settings-heading";
  creditsHeading.textContent = "Data credits";
  const credits = document.createElement("p");
  credits.className = "settings-note";
  credits.textContent = "This product uses the TMDB API but is not endorsed or certified by TMDB.";
  container.append(creditsHeading, credits);
}

function createYoutubeTakeoutImport(onStatus: LauncherStatusReporter): HTMLElement {
  const group = document.createElement("div");
  group.className = "settings-actions-row";

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.json,.html,.htm,text/html,application/json,application/zip";
  input.hidden = true;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-action settings-action--reliability settings-action--standard";
  button.dataset.settingsFocus = "true";
  button.append(actionSpan("settings-action-title", "Import YouTube history"));
  button.append(actionSpan("settings-action-meta", "Google Takeout ZIP, JSON, or HTML"));
  let importing = false;
  button.addEventListener("click", () => {
    if (!importing) input.click();
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (!file) return;
    importing = true;
    button.setAttribute("aria-busy", "true");
    onStatus("importing YouTube Takeout…", "progress");
    void importYoutubeTakeout(file)
      .then((result) => {
        const imported = result.import.imported_history;
        const message = result.import.noop
          ? "YouTube Takeout was already imported."
          : `Imported ${imported} YouTube watches.`;
        onStatus(message, "success");
        window.dispatchEvent(new CustomEvent("mango:youtube-history-imported"));
      })
      .catch((error: unknown) => {
        onStatus(
          error instanceof Error ? error.message : "couldn't import YouTube Takeout",
          "error",
        );
      })
      .finally(() => {
        input.value = "";
        importing = false;
        button.removeAttribute("aria-busy");
      });
  });

  group.append(button, input);
  return group;
}

export type HiddenRecommendationItem = {
  source: string;
  type: string;
  id: string;
  title: string | null;
  tab: string | null;
};

async function buildHiddenTitlesSettings(
  container: HTMLElement,
  onStatus: LauncherStatusReporter,
  owner: PersonalizationOwner,
): Promise<void> {
  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Hidden from recommendations";
  container.append(heading);

  const note = document.createElement("p");
  note.className = "settings-note";
  note.textContent = "Not for me is profile-specific. Restore a title here at any time.";
  container.append(note);

  try {
    const items = await fetchHiddenTitlesForOwner(owner);
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-note";
      empty.textContent = "No titles hidden for this profile.";
      container.append(empty);
      return;
    }
    const actions = document.createElement("div");
    actions.className = "settings-actions-row";
    for (const item of items) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "settings-action settings-action--standard";
      button.dataset.settingsFocus = "true";
      button.append(actionSpan("settings-action-title", item.title || item.id));
      button.append(actionSpan(
        "settings-action-meta",
        `${item.source === "youtube" ? "YouTube" : item.type === "series" ? "TV show" : "Movie"} · restore`,
      ));
      button.addEventListener("click", () => {
        void restoreHiddenTitle(item, button, actions, onStatus, owner);
      });
      actions.append(button);
    }
    container.append(actions);
  } catch (error) {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = error instanceof CatalogOwnershipChangedError
      ? "Profile changed — close and reopen Settings to refresh hidden titles."
      : "Hidden-title settings unavailable — catalog-service may be starting.";
    container.append(fallback);
    if (error instanceof CatalogOwnershipChangedError) {
      onStatus("profile changed — reopen Settings to refresh hidden titles", "warning");
    }
  }
}

export async function fetchHiddenTitlesForOwner(
  owner: PersonalizationOwner,
): Promise<HiddenRecommendationItem[]> {
  const params = personalizationExpectationParams(owner);
  const response = await fetch(
    `/api/catalog/library/not-interested?${params.toString()}`,
    { cache: "no-store" },
  );
  const payload = await response.json().catch(() => ({})) as {
    profile_id?: unknown;
    personalization_updated_at?: unknown;
    items?: HiddenRecommendationItem[];
    error?: string;
  };
  if (!response.ok) {
    if (response.status === 409) throw new CatalogOwnershipChangedError();
    throw new CatalogResponseError(
      response.status,
      typeof payload.error === "string" ? payload.error : "hidden titles unavailable",
    );
  }
  assertSettingsResponseOwner(payload, owner);
  return Array.isArray(payload.items) ? payload.items : [];
}

function assertSettingsResponseOwner(
  payload: { profile_id?: unknown; personalization_updated_at?: unknown },
  expectedOwner: PersonalizationOwner,
): void {
  const responseOwner = personalizationOwnerFromPayload(payload);
  if (!responseOwner || !samePersonalizationOwner(responseOwner, expectedOwner)) {
    throw new CatalogOwnershipChangedError();
  }
}

async function restoreHiddenTitle(
  item: HiddenRecommendationItem,
  button: HTMLButtonElement,
  actions: HTMLElement,
  onStatus: LauncherStatusReporter,
  owner: PersonalizationOwner,
): Promise<void> {
  button.disabled = true;
  try {
    await restoreHiddenTitleForOwner(item, owner);
    button.remove();
    if (actions.childElementCount === 0) {
      const empty = document.createElement("p");
      empty.className = "settings-note";
      empty.textContent = "No titles hidden for this profile.";
      actions.replaceWith(empty);
    }
    window.dispatchEvent(new CustomEvent("mango:library-refresh"));
    onStatus(`${item.title || "Title"} is back in recommendations.`, "success");
  } catch (error) {
    if (error instanceof CatalogOwnershipChangedError) {
      actions.querySelectorAll<HTMLButtonElement>("button").forEach((control) => {
        control.disabled = true;
      });
      onStatus("profile changed — reopen Settings before restoring a title", "warning");
    } else {
      button.disabled = false;
      onStatus("couldn't restore that title. try again.", "error");
    }
  }
}

export async function restoreHiddenTitleForOwner(
  item: HiddenRecommendationItem,
  owner: PersonalizationOwner,
): Promise<void> {
  const response = await fetch("/api/catalog/library/not-interested", {
    method: "DELETE",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...item,
      expected_profile_id: owner.profileId,
      expected_personalization_updated_at: owner.personalizationUpdatedAt,
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    profile_id?: unknown;
    personalization_updated_at?: unknown;
    error?: string;
  };
  if (!response.ok) {
    if (response.status === 409) throw new CatalogOwnershipChangedError();
    throw new CatalogResponseError(
      response.status,
      typeof payload.error === "string" ? payload.error : "restore failed",
    );
  }
  assertSettingsResponseOwner(payload, owner);
}

async function buildSearchSettings(
  container: HTMLElement,
  onStatus: LauncherStatusReporter,
  rebuildSettings: () => Promise<void>,
): Promise<void> {
  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Search";
  container.append(heading);

  const intro = document.createElement("p");
  intro.className = "settings-note";
  intro.textContent = "SafeSearch applies to fresh YouTube search. Clear activity removes recent queries and local selection learning.";
  container.append(intro);

  try {
    const response = await fetch("/api/catalog/search/preferences", { cache: "no-store" });
    if (!response.ok) throw new Error("preferences unavailable");
    const payload = await response.json() as { preferences?: { youtube_safe_search?: string } };
    const active = payload.preferences?.youtube_safe_search || "moderate";
    const choices = document.createElement("div");
    choices.className = "settings-actions-row";
    for (const option of [
      { id: "moderate", label: "Moderate" },
      { id: "strict", label: "Strict" },
      { id: "none", label: "Off" },
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `settings-action settings-action--quick${active === option.id ? " settings-action--selected" : ""}`;
      button.dataset.settingsFocus = "true";
      button.append(actionSpan("settings-action-title", option.label));
      button.append(actionSpan("settings-action-meta", active === option.id ? "selected" : "YouTube SafeSearch"));
      button.addEventListener("click", () => {
        void updateSearchPreference(option.id, onStatus, rebuildSettings);
      });
      choices.append(button);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "settings-action settings-action--standard";
    clear.dataset.settingsFocus = "true";
    clear.append(actionSpan("settings-action-title", "Clear search activity"));
    clear.append(actionSpan("settings-action-meta", "recents and local learning"));
    clear.addEventListener("click", () => void clearSearchActivity(clear, onStatus));
    choices.append(clear);
    container.append(choices);
  } catch {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = "Search settings unavailable — catalog-service may be starting.";
    container.append(fallback);
  }
}

async function updateSearchPreference(
  safeSearch: string,
  onStatus: LauncherStatusReporter,
  rebuildSettings: () => Promise<void>,
): Promise<void> {
  try {
    const response = await fetch("/api/catalog/search/preferences", {
      method: "PUT",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ youtube_safe_search: safeSearch }),
    });
    if (!response.ok) throw new Error("could not update Search");
    onStatus(`Search SafeSearch set to ${safeSearch === "none" ? "off" : safeSearch}.`, "success");
    await rebuildSettings();
  } catch {
    onStatus("couldn't update Search settings. try again.", "error");
  }
}

async function clearSearchActivity(
  button: HTMLButtonElement,
  onStatus: LauncherStatusReporter,
): Promise<void> {
  button.disabled = true;
  try {
    const response = await fetch("/api/catalog/search/history", {
      method: "DELETE",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("could not clear Search activity");
    onStatus("Search activity cleared.", "success");
  } catch {
    onStatus("couldn't clear Search activity. try again.", "error");
  } finally {
    button.disabled = false;
  }
}

async function buildReliabilityCenter(
  container: HTMLElement,
  onStatus: LauncherStatusReporter,
  rebuildSettings: () => Promise<void>,
): Promise<void> {
  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Reliability center";
  container.append(heading);

  try {
    const state = await fetchReliabilityState();
    container.append(createReliabilitySummary(state));
    const grid = document.createElement("div");
    grid.className = "reliability-grid";
    for (const component of state.components) {
      grid.append(createReliabilityCard(component));
    }
    container.append(grid);
    container.append(createReliabilityActions(state.actions, onStatus, () => {
      void rebuildSettings();
    }));
  } catch {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = "Reliability status unavailable — catalog-service may be starting.";
    container.append(fallback);
  }
  container.append(createYoutubeTakeoutImport(onStatus));
}

function createReliabilitySummary(state: ReliabilityState): HTMLElement {
  const panel = document.createElement("div");
  panel.className = `reliability-summary reliability-summary--${state.status}`;

  const status = document.createElement("span");
  status.className = "reliability-status";
  status.textContent = state.status;

  const copy = document.createElement("span");
  copy.className = "reliability-copy";
  const idle = state.idle.idle ? "idle" : `active ${state.idle.age_sec}s ago`;
  copy.textContent = `${state.summary} Last proof: ${state.last_proof?.status ?? "none"}. Couch: ${idle}.`;

  panel.append(status, copy);
  return panel;
}

function createReliabilityCard(component: ReliabilityComponent): HTMLElement {
  const card = document.createElement("div");
  card.className = `reliability-card reliability-card--${component.status}`;

  const title = document.createElement("span");
  title.className = "reliability-card-title";
  title.textContent = component.label;

  const summary = document.createElement("span");
  summary.className = "reliability-card-summary";
  summary.textContent = component.summary;

  card.append(title, summary);
  return card;
}

function createReliabilityActions(
  actions: ReliabilityAction[],
  onStatus: LauncherStatusReporter,
  onDone: () => void,
): HTMLElement {
  const group = document.createElement("div");
  group.className = "settings-actions-row";
  const order: ReliabilityActionId[] = ["repair", "proof", "stack_restart", "refresh"];
  for (const actionId of order) {
    const action = actions.find((entry) => entry.id === actionId);
    if (!action) {
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.className = `settings-action settings-action--reliability settings-action--${action.destructive ? "standard" : "quick"}`;
    button.dataset.settingsFocus = "true";
    button.disabled = !action.enabled;
    const meta = action.requires_idle ? "idle only" : "safe anytime";
    button.append(actionSpan("settings-action-title", action.label));
    button.append(actionSpan("settings-action-meta", action.enabled ? meta : action.reason || meta));
    button.addEventListener("click", () => {
      void runReliabilityButton(action.id, button, onStatus, onDone);
    });
    group.append(button);
  }
  return group;
}

function actionSpan(className: string, text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

async function runReliabilityButton(
  action: ReliabilityActionId,
  button: HTMLButtonElement,
  onStatus: LauncherStatusReporter,
  onDone: () => void,
): Promise<void> {
  if (button.disabled) {
    return;
  }
  button.disabled = true;
  onStatus(action === "proof" ? "running proof…" : `starting ${action.replace(/_/g, " ")}…`, "progress");
  try {
    await runReliabilityAction(action);
    onStatus(action === "proof" ? "reliability proof started" : `${action.replace(/_/g, " ")} started`, "success");
    window.setTimeout(onDone, action === "proof" ? 400 : 1800);
  } catch {
    onStatus(`couldn't start ${action.replace(/_/g, " ")}`, "error");
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
    }, 3000);
  }
}

export function reliabilityBadgeText(status: ReliabilityLevel): string {
  if (status === "red") return "needs repair";
  if (status === "yellow") return "check health";
  return "";
}

function appendLevelGroup(
  container: HTMLElement,
  title: string,
  levels: RefreshLevel[],
  onStatus: LauncherStatusReporter,
): void {
  if (levels.length === 0) {
    return;
  }
  const subheading = document.createElement("h3");
  subheading.className = "settings-subheading";
  subheading.textContent = title;
  container.append(subheading);
  for (const level of levels) {
    container.append(createRefreshButton(level, onStatus));
  }
}

function createShuffleButton(onStatus: LauncherStatusReporter): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-action settings-action--primary settings-action--instant";
  button.dataset.settingsFocus = "true";
  button.innerHTML = "<span class=\"settings-action-title\">refresh library</span><span class=\"settings-action-meta\">~5 sec · diverse re-pick · TV stays on</span>";
  button.addEventListener("click", () => {
    void runRefresh("shuffle_rails", onStatus, button);
  });
  return button;
}

function createRefreshButton(
  level: RefreshLevel,
  onStatus: LauncherStatusReporter,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `settings-action settings-action--${level.category}`;
  button.dataset.settingsFocus = "true";
  const couchNote = level.blocks_couch ? " · pauses TV UI" : "";
  const detachNote = level.detach_supported ? " · runs in background" : "";
  button.innerHTML = `<span class="settings-action-title">${level.label}</span><span class="settings-action-meta">${level.estimated_label}${couchNote}${detachNote}</span><span class="settings-action-body">${level.description}</span>`;
  button.addEventListener("click", () => {
    void runRefresh(level.id, onStatus, button);
  });
  return button;
}

async function runRefresh(
  level: RefreshLevelId,
  onStatus: LauncherStatusReporter,
  button: HTMLButtonElement,
): Promise<void> {
  if (button.disabled) {
    return;
  }
  button.disabled = true;
  onStatus(`starting ${level.replace(/_/g, " ")}…`, "progress");
  try {
    const result = await startRefreshLevel(level);
    if (result.mode === "inline") {
      onStatus("library refreshed — shuffle on the pad or browse bar to reshuffle", "success");
      window.dispatchEvent(new CustomEvent("mango:library-refresh"));
      return;
    }
    const label = result.estimated_label || `~${Math.max(1, Math.round((result.estimated_sec ?? 600) / 60))} min`;
    onStatus(`${level.replace(/_/g, " ")} running (${label}). TV pauses until done.`, "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh failed";
    onStatus(
      message.includes("already running") ? "a library job is already running" : "couldn't start library refresh",
      message.includes("already running") ? "warning" : "error",
    );
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
    }, 3000);
  }
}

export function settingsFocusables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-settings-focus]"));
}
