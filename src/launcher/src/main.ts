import "./style.css";
import { FocusGrid } from "./focus";
import { buildHomeRails } from "./home";
import { startVoiceHud } from "./voice-hud";
import type { ApiInfo, AppCard, ContentCard, LaunchAction } from "./types";

const homeView = mustGet<HTMLElement>("home-view");
const railsEl = mustGet<HTMLElement>("rails");
const settingsView = mustGet<HTMLElement>("settings-view");
const statusEl = mustGet<HTMLElement>("status");
const backButton = mustGet<HTMLButtonElement>("back-button");

let inSettings = false;
let launchInFlight = false;

const focusGrid = new FocusGrid((element) => {
  element.classList.add("focused");
  for (const row of focusGridRows) {
    for (const item of row) {
      if (item !== element) {
        item.classList.remove("focused");
      }
    }
  }
});

let focusGridRows: HTMLElement[][] = [];

init();

function init(): void {
  focusGridRows = buildHomeRails(railsEl, {
    onContentSelect: handleContentSelect,
    onAppSelect: handleAppSelect,
  });
  focusGrid.setRows(focusGridRows);

  backButton.addEventListener("click", showHome);
  document.addEventListener("keydown", handleKeydown);
  void loadInfo();
  startVoiceHud();
}

function handleKeydown(event: KeyboardEvent): void {
  if (inSettings) {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      showHome();
    }
    return;
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    focusGrid.moveCol(1);
    return;
  }
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    focusGrid.moveCol(-1);
    return;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    focusGrid.moveRow(1);
    return;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    focusGrid.moveRow(-1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateFocused();
  }
}

function activateFocused(): void {
  const focused = focusGrid.focused;
  if (focused === null) {
    return;
  }
  focused.click();
}

function handleContentSelect(card: ContentCard, _railLabel: string): void {
  setStatus(`${card.title} — catalog play ships next. Use Apps or voice for now.`);
}

function handleAppSelect(app: AppCard): void {
  if (app.action === "settings") {
    showSettings();
    return;
  }
  void launch(app.action);
}

async function launch(action: LaunchAction): Promise<void> {
  if (launchInFlight) {
    return;
  }
  launchInFlight = true;
  const label = action === "kodi" ? "YouTube" : "Stremio";
  setStatus(`Opening ${label}…`);
  try {
    const response = await fetch(`/api/launch/${action}`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setStatus(`${label} is starting. ⌂ button returns home.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Could not launch ${label}: ${message}`);
  } finally {
    launchInFlight = false;
  }
}

function showSettings(): void {
  inSettings = true;
  homeView.classList.add("hidden");
  settingsView.classList.remove("hidden");
  backButton.focus({ preventScroll: true });
}

function showHome(): void {
  inSettings = false;
  settingsView.classList.add("hidden");
  homeView.classList.remove("hidden");
  focusGrid.restoreFocus();
  setStatus("D-pad to browse. B to select. ⌂ for home.");
}

async function loadInfo(): Promise<void> {
  try {
    const response = await fetch("/api/info");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const info = (await response.json()) as ApiInfo;
    setText("hostname", info.hostname);
    setText("ip-address", info.ip);
    setText("launcher-url", `http://${info.ip}:${info.launcher_port}`);
    setText("companion-url", `https://${info.ip}:${info.companion_port}`);
  } catch {
    setText("hostname", "mango");
    setText("ip-address", "10.0.0.174");
    setText("launcher-url", "http://10.0.0.174:3000");
    setText("companion-url", "https://10.0.0.174:3001");
  }
}

function setStatus(message: string): void {
  statusEl.textContent = message;
}

function setText(id: string, value: string): void {
  mustGet<HTMLElement>(id).textContent = value;
}

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error(`Missing element #${id}`);
  }
  return element as T;
}
