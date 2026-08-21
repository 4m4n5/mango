import { CatalogTimeoutError } from './catalog-errors';

/**
 * A detail-list timeout does not mean the server-side provider search stopped.
 * Recover by joining that exact work; other failures retain their original
 * semantics and never cause an automatic second request.
 */
export async function recoverTimedOutStreamList<T>(
  initial: () => Promise<T>,
  joinExisting: () => Promise<T>,
): Promise<T> {
  try {
    return await initial();
  } catch (error) {
    if (!(error instanceof CatalogTimeoutError)) {
      throw error;
    }
    return joinExisting();
  }
}
