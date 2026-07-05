export const RAIL_COLUMNS = 9;
export const RAIL_COLUMNS_LANDSCAPE = 6;

export function applyRailLayout(track: HTMLElement, landscape = false): void {
  track.style.setProperty(
    "--rail-cols",
    String(landscape ? RAIL_COLUMNS_LANDSCAPE : RAIL_COLUMNS),
  );
}
