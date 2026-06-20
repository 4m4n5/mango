export const RAIL_COLUMNS = 9;

export function applyRailLayout(track: HTMLElement): void {
  track.style.setProperty("--rail-cols", String(RAIL_COLUMNS));
}

export function observeRailLayouts(container: HTMLElement): () => void {
  const tracks = Array.from(container.querySelectorAll<HTMLElement>(".rail-track--posters"));
  for (const track of tracks) {
    applyRailLayout(track);
  }
  const resize = (): void => {
    for (const track of tracks) {
      applyRailLayout(track);
    }
  };
  const observer = new ResizeObserver(() => resize());
  for (const track of tracks) {
    observer.observe(track);
  }
  return () => observer.disconnect();
}
