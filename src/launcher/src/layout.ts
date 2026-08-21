// Six 2:3 posters per row: 255x382px at 1080p with 96px safe margins and 40px
// gutters. Five (314x471px) is where Prime Video, Disney+ and tvOS converge, but
// six trades that headroom for one more title per rail and still clears the
// ~248-255px floor platform research gives for 3m viewing. Do not go past six —
// seven lands at 217px, inside the band guidance calls too small for poster art.
export const RAIL_COLUMNS = 6;
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
