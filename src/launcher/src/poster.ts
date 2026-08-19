/** Couch-safe poster: show title initials when artwork 404s or is missing. */

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const FRAGILE_YTIMG = /^https:\/\/i\.ytimg\.com\/vi\/([A-Za-z0-9_-]{11})\/(maxresdefault|sddefault|mqdefault)(?:\.(?:jpg|webp))?(?:[?#].*)?$/i;

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

export function youtubeVideoThumbnailUrl(id: string): string | undefined {
  const normalized = id.trim();
  if (!YOUTUBE_VIDEO_ID.test(normalized)) {
    return undefined;
  }
  return `https://i.ytimg.com/vi/${normalized}/hqdefault.jpg`;
}

export function rewriteFragileYoutubeThumbnail(url: string): string | undefined {
  const match = url.trim().match(FRAGILE_YTIMG);
  return match ? youtubeVideoThumbnailUrl(match[1]!) : undefined;
}

export function resolveCardPosterUrl(
  card: { id: string; posterUrl?: string; type?: string },
  size: "medium" | "large" = "medium",
): string {
  const explicit = card.posterUrl?.trim();
  if (explicit) {
    return rewriteFragileYoutubeThumbnail(explicit) || explicit;
  }
  if (card.type === "youtube_video" || (!card.type && YOUTUBE_VIDEO_ID.test(card.id.trim()))) {
    return youtubeVideoThumbnailUrl(card.id) || "";
  }
  return metahubPosterUrl(card.id, size) || youtubeVideoThumbnailUrl(card.id) || "";
}

export function bindPosterImage(img: HTMLImageElement, title: string): void {
  const applyFallback = (): void => {
    if (img.dataset.posterSrc) return;
    const failed = img.getAttribute("src")?.trim() || "";
    const retry = rewriteFragileYoutubeThumbnail(failed);
    if (retry && retry !== failed && img.dataset.posterRetry !== "1") {
      img.dataset.posterRetry = "1";
      img.src = retry;
      return;
    }
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

  img.addEventListener("error", applyFallback);
  if (!img.getAttribute("src")?.trim() && !img.dataset.posterSrc) {
    queueMicrotask(applyFallback);
  }
}

/** Prefetch one extra scrollport of posters so the next rail is already fetching. */
export const POSTER_SCROLLPORT_MARGIN_RATIO = 1;

type Box = { top: number; right: number; bottom: number; left: number };

/**
 * True when `img` overlaps the scrollport expanded by `marginPx`.
 * A zero-size image or scroller is not near — layout has not happened yet.
 */
export function posterIsNearScrollport(
  img: Box,
  root: Box,
  marginPx: { x: number; y: number },
): boolean {
  if (!posterScrollportHasBox(img) || !posterScrollportHasBox(root)) {
    return false;
  }
  return img.bottom >= root.top - marginPx.y
    && img.top <= root.bottom + marginPx.y
    && img.right >= root.left - marginPx.x
    && img.left <= root.right + marginPx.x;
}

/** False until the scroller (or card) has a real layout box. */
export function posterScrollportHasBox(box: Box): boolean {
  return box.right - box.left > 0 && box.bottom - box.top > 0;
}

function revealDeferredPoster(img: HTMLImageElement): void {
  const url = img.dataset.posterSrc?.trim();
  delete img.dataset.posterSrc;
  if (url) img.src = url;
}

const posterObservers = new WeakMap<Element, IntersectionObserver>();
const posterArmRootByScrollport = new WeakMap<Element, ParentNode>();
const watchedPosterScrollports = new WeakSet<Element>();
const posterArmFrameByScrollport = new WeakMap<Element, number>();

function posterLayoutBox(img: HTMLImageElement): DOMRect {
  const rect = img.getBoundingClientRect();
  if (posterScrollportHasBox(rect)) return rect;
  const host = img.closest(".poster-frame, .card--poster");
  return host instanceof Element ? host.getBoundingClientRect() : rect;
}

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

function schedulePosterArm(scrollport: Element): void {
  if (posterArmFrameByScrollport.has(scrollport)) return;
  const frame = requestAnimationFrame(() => {
    posterArmFrameByScrollport.delete(scrollport);
    const root = posterArmRootByScrollport.get(scrollport);
    if (root) armDeferredPosterSourcesNow(root, scrollport);
  });
  posterArmFrameByScrollport.set(scrollport, frame);
}

function watchPosterScrollport(scrollport: Element): void {
  if (watchedPosterScrollports.has(scrollport)) return;
  watchedPosterScrollports.add(scrollport);
  // Pi Chromium often skips the IntersectionObserver initial callback on an
  // overflow root until that root scrolls. D-pad scrollIntoView was making
  // in-view VOD art appear only after moving across rails.
  scrollport.addEventListener("scroll", () => schedulePosterArm(scrollport), { passive: true });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => schedulePosterArm(scrollport)).observe(scrollport);
  }
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

  const rootRect = port.getBoundingClientRect();
  if (!posterScrollportHasBox(rootRect)) {
    // Flex `.rails` can still be 0-height on the first attach frame. Observing
    // against a zero box never intersects; wait for resize/scroll instead.
    return;
  }

  const marginPx = {
    x: rootRect.width * POSTER_SCROLLPORT_MARGIN_RATIO,
    y: rootRect.height * POSTER_SCROLLPORT_MARGIN_RATIO,
  };
  const observer = posterObserverFor(port);
  for (const img of images) {
    if (posterIsNearScrollport(posterLayoutBox(img), rootRect, marginPx)) {
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
 *
 * IntersectionObserver is not enough on its own: a zero-size overflow root
 * and Chromium's missing initial callback both leave in-view cards blank
 * until a later D-pad `scrollIntoView`. Resize and scroll re-run the
 * layout-near check so first paint does not depend on focus movement.
 */
export function armDeferredPosterSources(
  root: ParentNode,
  scrollport?: Element | null,
): void {
  if (scrollport instanceof Element) {
    posterArmRootByScrollport.set(scrollport, root);
    watchPosterScrollport(scrollport);
  }
  armDeferredPosterSourcesNow(root, scrollport);
  if (!(scrollport instanceof Element)) return;
  if (root.querySelector("img[data-poster-src]") === null) return;
  schedulePosterArm(scrollport);
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
