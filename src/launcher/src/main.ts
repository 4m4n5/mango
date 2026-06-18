import "./style.css";

type LaunchAction = "stremio" | "kodi";
type TileAction = LaunchAction | "settings";

interface ApiInfo {
  hostname: string;
  ip: string;
  launcher_port: number;
  companion_port: number;
}

const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>(".tile"));
const homeView = mustGet<HTMLElement>("home-view");
const settingsView = mustGet<HTMLElement>("settings-view");
const statusEl = mustGet<HTMLElement>("status");
const backButton = mustGet<HTMLButtonElement>("back-button");

let selectedIndex = 0;
let inSettings = false;

init();

function init(): void {
  tiles.forEach((tile, index) => {
    tile.addEventListener("click", () => activateTile(tile));
    tile.addEventListener("focus", () => setSelectedIndex(index));
  });
  backButton.addEventListener("click", showHome);
  document.addEventListener("keydown", handleKeydown);
  setSelectedIndex(0);
  void loadInfo();
}

function handleKeydown(event: KeyboardEvent): void {
  if (inSettings) {
    if (event.key === "Escape" || event.key === "Backspace") {
      event.preventDefault();
      showHome();
    }
    return;
  }

  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    moveSelection(1);
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    moveSelection(-1);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activateTile(tiles[selectedIndex]);
  }
}

function moveSelection(delta: number): void {
  const nextIndex = (selectedIndex + delta + tiles.length) % tiles.length;
  setSelectedIndex(nextIndex);
}

function setSelectedIndex(index: number): void {
  selectedIndex = index;
  tiles.forEach((tile, tileIndex) => {
    const selected = tileIndex === selectedIndex;
    tile.classList.toggle("selected", selected);
    tile.setAttribute("aria-selected", String(selected));
  });
  tiles[selectedIndex].focus({ preventScroll: true });
}

function activateTile(tile: HTMLButtonElement): void {
  const action = tile.dataset.action as TileAction | undefined;
  if (action === "settings") {
    showSettings();
    return;
  }
  if (action === "stremio" || action === "kodi") {
    void launch(action);
  }
}

async function launch(action: LaunchAction): Promise<void> {
  const label = action === "kodi" ? "YouTube" : "Stremio";
  setStatus(`Opening ${label}…`);
  try {
    const response = await fetch(`/api/launch/${action}`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    setStatus(`${label} is starting. − button returns home.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    setStatus(`Could not launch ${label}: ${message}`);
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
  setSelectedIndex(selectedIndex);
  setStatus("D-pad to move. B to select. − for home.");
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
