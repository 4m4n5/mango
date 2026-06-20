/** TV rail layout — fit posters edge-to-edge with no horizontal scroll. */

export const MAX_RAIL_COLUMNS = 9;
const MIN_CARD_PX = 118;

export function computeRailColumns(track: HTMLElement): number {
  const styles = getComputedStyle(track);
  const gap = Number.parseFloat(styles.columnGap || styles.gap) || 16;
  const width = track.clientWidth;
  if (width <= 0) {
    return MAX_RAIL_COLUMNS;
  }
  const cols = Math.floor((width + gap) / (MIN_CARD_PX + gap));
  return Math.min(MAX_RAIL_COLUMNS, Math.max(3, cols));
}

export function applyRailLayout(track: HTMLElement, itemCount: number): number {
  const cols = Math.min(computeRailColumns(track), itemCount);
  track.style.setProperty("--rail-cols", String(cols));
  return cols;
}

export function observeRailLayouts(container: HTMLElement): () => void {
  const tracks = Array.from(container.querySelectorAll<HTMLElement>(".rail-track--posters"));
  const resize = (): void => {
    for (const track of tracks) {
      const cards = track.querySelectorAll(".card--poster").length;
      if (cards > 0) {
        applyRailLayout(track, cards);
      }
    }
  };
  resize();
  const observer = new ResizeObserver(() => resize());
  for (const track of tracks) {
    observer.observe(track);
  }
  return () => observer.disconnect();
}
