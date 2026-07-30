// Five 2:3 posters per row is where Prime Video, Disney+ and tvOS poster rows
// converge: 314x471px at 1080p with 96px safe margins and 40px gutters. Nine was
// 174x261px, below the ~255-280px floor platform research gives for 3m viewing.
export const RAIL_COLUMNS = 5;
// Four 16:9 cards per row is the documented Android TV target (196dp = 392px at
// 1080p) and what YouTube on TV shows; six landed at 227px wide, inside the band
// platform guidance calls too small for a card carrying title text.
export const RAIL_COLUMNS_LANDSCAPE = 4;

export function railColumns(landscape: boolean): number {
  return landscape ? RAIL_COLUMNS_LANDSCAPE : RAIL_COLUMNS;
}

export function applyRailLayout(track: HTMLElement, landscape = false): void {
  track.style.setProperty("--rail-cols", String(railColumns(landscape)));
}
