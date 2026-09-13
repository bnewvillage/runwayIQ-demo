/**
 * Page-lifetime cache for whole-dataset fetches.
 *
 * A module-level Map, deliberately NOT sessionStorage: the requirement is
 * that a refresh clears it, and sessionStorage survives refresh (it clears
 * on tab close). Nothing is serialised either, so an entry costs a
 * reference rather than a stringify/parse of ~5,000 objects.
 *
 * Safe to hold for a whole session because every figure the app reads was
 * written by the 02:00 UTC pipeline (see CONTEXT.md on "on-demand" -- the
 * arithmetic is per-request, the DATA is not). Within one sitting the
 * underlying numbers cannot change, so re-pulling the cube on every visit
 * to a page buys nothing.
 *
 * The exception is a tab left open across that nightly run, which keeps
 * showing the previous day's figures until reloaded. Every cached payload
 * carries the batch time it came from, so a page that wants to say so can.
 *
 * ONLY for fetches with a fixed key -- no parameters, one possible
 * response. Per-filter endpoints (/sales/items, /sales/customers) are keyed
 * by country x channel x brand x range x limit, so caching them would grow
 * an unbounded Map over a session; they need a bounded policy, which is a
 * separate decision.
 */

const entries = new Map();   // key -> { promise, value }

/**
 * Fetch once per key, then serve from memory.
 *
 * Stores the PROMISE rather than only the settled value, so two components
 * mounting in the same tick share one request instead of both firing it --
 * which is the actual case on Brand Analytics, where the cube and the stock
 * summary mount together.
 *
 * A rejection evicts the entry. Caching failures would mean one dropped
 * connection during navigation poisons that key for the rest of the
 * session, with no way back short of a reload.
 */
export function cachedFetch(key, fetcher) {
  let entry = entries.get(key);
  if (!entry) {
    entry = {};
    entry.promise = fetcher()
      .then((value) => { entry.value = value; return value; })
      .catch((err) => { entries.delete(key); throw err; });
    entries.set(key, entry);
  }
  return entry.promise;
}

/**
 * Synchronous read of an already-settled entry, or undefined.
 *
 * This is the part that removes the loading flash: without it a cache hit
 * still renders null -> value across two paints, which is most of what
 * makes returning to a page feel like a fresh load.
 */
export function peek(key) {
  return entries.get(key)?.value;
}

/** Drop everything. For a manual refresh control, if one is ever added. */
export function clearCache() {
  entries.clear();
}
