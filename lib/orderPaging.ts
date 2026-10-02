/**
 * Paging for the Orders tab's lists (2026-10-02). Plain TS — no React Native
 * imports — so the rules can be checked outside the app.
 *
 * The "Past" tab used to fetch the newest 50 deliveries and nothing else: the
 * server already reported `has_more` and accepted `?offset`, but the app
 * ignored both, so a rider's 51st-and-older deliveries were unreachable.
 */

/** Orders per request (the backend caps a page at 200). */
export const ORDERS_PAGE_SIZE = 50;

type WithId = { id: string };

/**
 * Append an older page. Drops ids already shown: a delivery completing between
 * page requests shifts every offset by one, so the next page can repeat the
 * last item of the previous one.
 */
export function appendPage<T extends WithId>(existing: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(existing.map((o) => o.id));
  return [...existing, ...page.filter((o) => !seen.has(o.id))];
}

/**
 * Refresh the newest page without throwing away older pages the rider has
 * already loaded (the screen refetches on every focus — e.g. after opening an
 * old delivery and coming back). The fresh first page wins for the ids it
 * contains; older loaded items follow, minus any now in the fresh page.
 */
export function mergeFirstPage<T extends WithId>(existing: readonly T[], firstPage: readonly T[]): T[] {
  const fresh = new Set(firstPage.map((o) => o.id));
  return [...firstPage, ...existing.filter((o) => !fresh.has(o.id))];
}
