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

/** Assign deferred poster URLs after the owning rail has yielded to pad input. */
export function armDeferredPosterSources(root: ParentNode): void {
  for (const img of Array.from(root.querySelectorAll<HTMLImageElement>("img[data-poster-src]"))) {
    const url = img.dataset.posterSrc?.trim();
    delete img.dataset.posterSrc;
    if (url) img.src = url;
  }
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
