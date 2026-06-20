import {
  fetchRefreshLevels,
  startRefreshLevel,
  type RefreshLevel,
} from "./refresh";
import type { RefreshLevelId } from "./types";

export function buildSettingsRefresh(
  container: HTMLElement,
  onStatus: (message: string) => void,
): void {
  container.replaceChildren();

  const heading = document.createElement("h2");
  heading.className = "settings-heading";
  heading.textContent = "Library refresh";

  const intro = document.createElement("p");
  intro.className = "settings-note";
  intro.textContent = "Shuffle re-picks verified titles only. Growth jobs add new playable titles — verified rows stay unless marked stale.";

  container.append(heading, intro);

  void fetchRefreshLevels()
    .then((levels) => {
      container.append(createShuffleButton(onStatus));
      appendLevelGroup(container, "Quick", levels.filter((level) => level.category === "quick"), onStatus);
      appendLevelGroup(container, "Standard", levels.filter((level) => level.category === "standard"), onStatus);
      appendLevelGroup(container, "Overnight", levels.filter((level) => level.category === "overnight"), onStatus);
    })
    .catch(() => {
      const fallback = document.createElement("p");
      fallback.className = "settings-note";
      fallback.textContent = "Refresh options unavailable — catalog-service may be starting.";
      container.append(fallback);
    });
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
