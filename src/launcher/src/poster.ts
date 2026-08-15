/** Couch-safe poster: show title initials when artwork 404s or is missing. */

/** Cinemeta CDN fallback when pool / voice payloads omit artwork. */
export function metahubPosterUrl(
  id: string,
  size: "medium" | "large" = "medium",
): string | undefined {
  const bare = id.trim().split(":")[0];
  if (!bare || !/^tt\d+$/i.test(bare)) {
    return undefined;
  }
  return `https://images.metahub.space/poster/${size}/${bare}/img`;
}

export function resolveCardPosterUrl(
  card: { id: string; posterUrl?: string },
  size: "medium" | "large" = "medium",
): string {
  const explicit = card.posterUrl?.trim();
  if (explicit) {
    return explicit;
  }
  return metahubPosterUrl(card.id, size) || "";
}

export function bindPosterImage(img: HTMLImageElement, title: string): void {
  const applyFallback = (): void => {
    if (img.dataset.posterSrc) return;
    img.classList.add("poster-image--missing");
    img.removeAttribute("src");
    // Cards bind handlers before they are attached. Resolve the host only when
    // fallback is needed so the placeholder lands inside the live image frame.
    const host = img.closest(".poster-frame, .card--poster, .detail-poster-wrap");
    if (!host || host.querySelector(".poster-fallback")) {
      return;
    }
    const fallback = document.createElement("span");
    fallback.className = "poster-fallback";
    fallback.setAttribute("aria-hidden", "true");
    fallback.textContent = posterInitials(title);
    host.append(fallback);
  };

  img.addEventListener("error", applyFallback, { once: true });
  if (!img.getAttribute("src")?.trim() && !img.dataset.posterSrc) {
    queueMicrotask(applyFallback);
  }
}

/** Prefetch one extra scrollport of posters so the next rail is already fetching. */
export const POSTER_SCROLLPORT_MARGIN_RATIO = 1;

type Box = { top: number; right: number; bottom: number; left: number };

/**
 * True when `img` overlaps the scrollport expanded by `marginPx`.
 * A zero-size box is not near — layout has not happened yet, so callers
 * should observe instead of assigning `src`.
 */
export function posterIsNearScrollport(
  img: Box,
  root: Box,
  marginPx: { x: number; y: number },
): boolean {
  if (img.right - img.left <= 0 || img.bottom - img.top <= 0) {
    return false;
  }
  return img.bottom >= root.top - marginPx.y
    && img.top <= root.bottom + marginPx.y
    && img.right >= root.left - marginPx.x
    && img.left <= root.right + marginPx.x;
}

function revealDeferredPoster(img: HTMLImageElement): void {
  const url = img.dataset.posterSrc?.trim();
  delete img.dataset.posterSrc;
  if (url) img.src = url;
}

const posterObservers = new WeakMap<Element, IntersectionObserver>();

function posterObserverFor(root: Element): IntersectionObserver {
  const existing = posterObservers.get(root);
  if (existing) return existing;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const img = entry.target;
      if (!(img instanceof HTMLImageElement)) continue;
      if (!entry.isIntersecting) {
        if (!img.isConnected) observer.unobserve(img);
        continue;
      }
      observer.unobserve(img);
      revealDeferredPoster(img);
    }
  }, {
    root,
    // Percentage is relative to the root box, so this stays one extra screen
    // of prefetch if the scrollport is resized.
    rootMargin: `${POSTER_SCROLLPORT_MARGIN_RATIO * 100}%`,
  });
  posterObservers.set(root, observer);
  return observer;
}

function armDeferredPosterSourcesNow(
  root: ParentNode,
  scrollport: Element | null | undefined,
): void {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img[data-poster-src]"));
  if (images.length === 0) return;

  const port = scrollport instanceof Element ? scrollport : null;
  if (!port || typeof IntersectionObserver === "undefined") {
    for (const img of images) revealDeferredPoster(img);
    return;
  }

  // Reading layout here is the point: native loading=lazy skipped fetch when
  // src was assigned on a disconnected node, then often never re-checked
  // after attach or programmatic D-pad scroll inside .rails.
  const rootRect = port.getBoundingClientRect();
  const marginPx = {
    x: rootRect.width * POSTER_SCROLLPORT_MARGIN_RATIO,
    y: rootRect.height * POSTER_SCROLLPORT_MARGIN_RATIO,
  };
  const observer = posterObserverFor(port);
  for (const img of images) {
    if (posterIsNearScrollport(img.getBoundingClientRect(), rootRect, marginPx)) {
      observer.unobserve(img);
      revealDeferredPoster(img);
    } else {
      observer.observe(img);
    }
  }
}

/**
 * Assign deferred poster URLs once cards are in the live scrollport.
 *
 * Without `scrollport`, every deferred image under `root` starts fetching
 * (Detail related: a handful of already-attached cards). With `scrollport`,
 * only posters near that box fetch now; the rest wait on an observer rooted
 * at the actual scroller, not the layout viewport.
 */
export function armDeferredPosterSources(
  root: ParentNode,
  scrollport?: Element | null,
): void {
  armDeferredPosterSourcesNow(root, scrollport);
  if (!(scrollport instanceof Element)) return;
  if (root.querySelector("img[data-poster-src]") === null) return;
  requestAnimationFrame(() => {
    armDeferredPosterSourcesNow(root, scrollport);
  });
}

function posterInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] ?? ""}${words[1][0] ?? ""}`.toUpperCase();
}
