import {
  fetchRefreshLevels,
  startRefreshLevel,
  type RefreshLevel,
} from "./refresh";
import {
  fetchReliabilityState,
  runReliabilityAction,
  type ReliabilityAction,
  type ReliabilityActionId,
  type ReliabilityComponent,
  type ReliabilityLevel,
  type ReliabilityState,
} from "./reliability";
import type { RefreshLevelId } from "./types";

export async function buildSettingsRefresh(
  container: HTMLElement,
  onStatus: (message: string) => void,
): Promise<void> {
  container.replaceChildren();

  await buildReliabilityCenter(container, onStatus);

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
    appendLevelGroup(container, "Quick", levels.filter((level) => level.category === "quick"), onStatus);
    appendLevelGroup(container, "Standard", levels.filter((level) => level.category === "standard"), onStatus);
    appendLevelGroup(container, "Overnight", levels.filter((level) => level.category === "overnight"), onStatus);
  } catch {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = "Refresh options unavailable — catalog-service may be starting.";
    container.append(fallback);
  }
}

async function buildReliabilityCenter(
  container: HTMLElement,
  onStatus: (message: string) => void,
): Promise<void> {
  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Reliability Center";
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
      void buildSettingsRefresh(container, onStatus);
    }));
  } catch {
    const fallback = document.createElement("p");
    fallback.className = "settings-note";
    fallback.textContent = "Reliability status unavailable — catalog-service may be starting.";
    container.append(fallback);
  }
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
  onStatus: (message: string) => void,
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
  onStatus: (message: string) => void,
  onDone: () => void,
): Promise<void> {
  if (button.disabled) {
    return;
  }
  button.disabled = true;
  onStatus(action === "proof" ? "running proof…" : `starting ${action.replace(/_/g, " ")}…`);
  try {
    const result = await runReliabilityAction(action);
    onStatus(result.pid ? `${result.message} (pid ${result.pid})` : result.message);
    window.setTimeout(onDone, action === "proof" ? 400 : 1800);
  } catch (error) {
    onStatus(error instanceof Error ? error.message : "reliability action failed");
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
    }, 3000);
  }
}

export function reliabilityBadgeText(status: ReliabilityLevel): string {
  if (status === "red") return "Needs repair";
  if (status === "yellow") return "Check health";
  return "";
}

function appendLevelGroup(
  container: HTMLElement,
  title: string,
  levels: RefreshLevel[],
  onStatus: (message: string) => void,
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

function createShuffleButton(onStatus: (message: string) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-action settings-action--primary settings-action--instant";
  button.dataset.settingsFocus = "true";
  button.innerHTML = "<span class=\"settings-action-title\">Refresh library</span><span class=\"settings-action-meta\">~5 sec · diverse re-pick · TV stays on</span>";
  button.addEventListener("click", () => {
    void runRefresh("shuffle_rails", onStatus, button);
  });
  return button;
}

function createRefreshButton(
  level: RefreshLevel,
  onStatus: (message: string) => void,
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
  onStatus: (message: string) => void,
  button: HTMLButtonElement,
): Promise<void> {
  if (button.disabled) {
    return;
  }
  button.disabled = true;
  onStatus(`starting ${level.replace(/_/g, " ")}…`);
  try {
    const result = await startRefreshLevel(level);
    if (result.mode === "inline") {
      onStatus("library refreshed — shuffle on the pad or browse bar to reshuffle");
      window.dispatchEvent(new CustomEvent("mango:library-refresh"));
      return;
    }
    const label = result.estimated_label || `~${Math.max(1, Math.round((result.estimated_sec ?? 600) / 60))} min`;
    onStatus(`${level.replace(/_/g, " ")} running (${label}). TV pauses until done.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh failed";
    onStatus(message.includes("already running") ? "a library job is already running" : message);
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
    }, 3000);
  }
}

export function settingsFocusables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-settings-focus]"));
}
