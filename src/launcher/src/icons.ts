/**
 * Shared 24×24 mango glyphs. Search, Detail, and the Rate card all mount
 * these so play/save/rate never drift into a second icon family.
 *
 * Stroke 1.8 / round caps match `.search-icon`. Play is filled in Search
 * (dark chrome) and outlined on cream primary chips. Save uses the same
 * five-point star as the poster Saved marker.
 */
export type LauncherIconName =
  | "search"
  | "clock"
  | "play"
  | "edit"
  | "refresh"
  | "star"
  | "flame"
  | "waves"
  | "eye-off";

export const LAUNCHER_ICON_PATHS: Record<LauncherIconName, string[]> = {
  search: ["M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14", "M16 16l4 4"],
  clock: ["M12 5a7 7 0 1 0 7 7", "M12 8v4l3 2"],
  play: ["M8.5 6.5v11l9-5.5z"],
  edit: ["M5 19h4l10-10-4-4L5 15v4z", "M13.5 6.5l4 4"],
  refresh: ["M19 8a7 7 0 1 0 1 7", "M19 4v4h-4"],
  star: ["M12 2.6l2.86 5.8 6.4.93-4.63 4.51 1.09 6.36L12 17.77 6.28 20.2l1.09-6.36L2.74 9.33l6.4-.93L12 2.6z"],
  flame: [
    "M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",
  ],
  waves: [
    "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
  ],
  "eye-off": [
    "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
    "M14.084 14.158a3 3 0 0 1-4.242-4.242",
    "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
    "m2 2 20 20",
  ],
};

const FILLED_BY_DEFAULT = new Set<LauncherIconName>(["play", "star"]);

export function launcherIcon(
  name: LauncherIconName,
  options: { outline?: boolean } = {},
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("mango-icon");
  const filled = FILLED_BY_DEFAULT.has(name) && !options.outline;
  if (filled) svg.classList.add("mango-icon--fill");
  for (const pathData of LAUNCHER_ICON_PATHS[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    if (filled) {
      path.setAttribute("fill", "currentColor");
      path.setAttribute("stroke", "none");
    }
    svg.appendChild(path);
  }
  return svg;
}

/** Fill `[data-icon]` slots in static markup without wiping sibling labels. */
export function mountLauncherIcons(root: ParentNode = document): void {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    if (slot.querySelector("svg")) continue;
    const name = slot.dataset.icon as LauncherIconName | undefined;
    if (!name || !(name in LAUNCHER_ICON_PATHS)) continue;
    slot.append(launcherIcon(name, { outline: slot.dataset.iconOutline === "true" }));
  }
}

export function setControlLabel(control: HTMLElement, text: string): void {
  const label = control.querySelector(".detail-button-label");
  if (label) {
    label.textContent = text;
    return;
  }
  control.textContent = text;
}
