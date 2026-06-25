export const RAIL_COLUMNS = 9;

export function applyRailLayout(track: HTMLElement): void {
  track.style.setProperty("--rail-cols", String(RAIL_COLUMNS));
}
