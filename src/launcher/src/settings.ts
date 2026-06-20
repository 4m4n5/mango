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
  intro.textContent = "Shuffle re-picks verified titles only. Growth jobs add titles — verified rows stay unless marked stale.";

  container.append(heading, intro);

  void fetchRefreshLevels()
    .then((levels) => {
      container.append(createShuffleButton(onStatus));
      for (const level of levels) {
        if (level.id === "shuffle_rails") {
          continue;
        }
        container.append(createRefreshButton(level, onStatus));
      }
    })
    .catch(() => {
      const fallback = document.createElement("p");
      fallback.className = "settings-note";
      fallback.textContent = "Refresh options unavailable — catalog-service may be starting.";
      container.append(fallback);
    });
}

function createShuffleButton(onStatus: (message: string) => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-action settings-action--primary";
  button.dataset.settingsFocus = "true";
  button.innerHTML = "<span class=\"settings-action-title\">Refresh library</span><span class=\"settings-action-meta\">~5 sec · diverse re-pick</span>";
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
  button.className = "settings-action";
  button.dataset.settingsFocus = "true";
  const couchNote = level.blocks_couch ? " · pauses TV UI" : "";
  button.innerHTML = `<span class="settings-action-title">${level.label}</span><span class="settings-action-meta">${level.estimated_label}${couchNote}</span><span class="settings-action-body">${level.description}</span>`;
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
      onStatus("library refreshed — press − on the pad to refresh again");
      return;
    }
    const minutes = Math.max(1, Math.round((result.estimated_sec ?? 300) / 60));
    onStatus(`${level.replace(/_/g, " ")} running (~${minutes} min). TV may pause briefly.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "refresh failed";
    onStatus(message);
  } finally {
    window.setTimeout(() => {
      button.disabled = false;
    }, 3000);
  }
}

export function settingsFocusables(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>("[data-settings-focus]"));
}
