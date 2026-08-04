import { CatalogError } from '../catalog-errors.js';
import {
  activeViewerProfileId,
  resolveRecommendationServedSlate,
  type RecommendationServedSlate,
} from '../library/db.js';

type RecommendationDomain = 'vod' | 'youtube';

const ATTRIBUTION_PROOF_FIELDS = [
  'attribution_token',
  'slate_revision',
] as const;

/**
 * Recommendation cards carry an opaque server-issued ownership proof. Mutations
 * from ordinary Search, voice, Saved, and catalog cards remain valid without
 * that proof; once any proof field is present, however, the complete tuple must
 * resolve to the exact item and the profile must still be active.
 */
export function validateOptionalRecommendationMutationAttribution(
  body: Record<string, unknown>,
  domain: RecommendationDomain,
  item: { type: string; id: string },
): RecommendationServedSlate | null {
  // Every ordinary catalog card has a rail id. A rail id by itself is display
  // context, not proof that the card came from a server-issued recommendation
  // slate. Token/revision opt in; once either appears, the complete tuple is
  // mandatory and resolves against immutable membership below.
  if (!ATTRIBUTION_PROOF_FIELDS.some((field) => body[field] !== undefined)) return null;

  const token = body.attribution_token;
  const railId = body.rail_id;
  const rawRevision = body.slate_revision;
  const revision = typeof rawRevision === 'number'
    ? rawRevision
    : typeof rawRevision === 'string' && /^(0|[1-9]\d*)$/.test(rawRevision)
      ? Number(rawRevision)
      : Number.NaN;
  if (typeof token !== 'string' || !token.trim()
    || typeof railId !== 'string' || !railId.trim()
    || !Number.isInteger(revision) || revision < 0) {
    throw new CatalogError(409, 'stale or incomplete recommendation slate');
  }

  let served: RecommendationServedSlate;
  try {
    served = resolveRecommendationServedSlate({
      attribution_token: token,
      domain,
      rail_id: railId,
      slate_revision: revision,
      item,
    });
  } catch {
    throw new CatalogError(409, 'this recommendation slate is no longer current');
  }
  if (served.profile_id !== activeViewerProfileId()) {
    throw new CatalogError(409, 'profile changed; reload recommendations before acting');
  }
  return served;
}
