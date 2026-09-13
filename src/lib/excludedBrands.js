// Brands the buyer is not responsible for.
//
// A standing decision ("we don't buy this brand"), not a per-visit
// filter, so it outlives the session. localStorage rather than the URL
// because it is a preference, not a view worth sharing.
//
// ONE key across every page that offers the exclusion. Demand Glance and
// Sales Analytics already shared this string by having each declared its
// own copy of it, which worked only for as long as nobody typo'd the
// third one -- so the key, the reader and the writer live here now and
// the pages import them.
const KEY = 'runwayiq.excludedBrands';

export function loadExcludedBrands() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); }
  catch { return new Set(); }
}

/** Writes and returns the set, so a state updater can be a one-liner.
 *  Failure is swallowed: private-mode storage throws on write, and
 *  losing a preference is not worth breaking the page over. */
export function saveExcludedBrands(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* private mode */ }
  return set;
}

/** Toggle one brand, persist, and hand back a new Set. */
export function toggleExcludedBrand(current, brand) {
  const next = new Set(current);
  if (next.has(brand)) next.delete(brand); else next.add(brand);
  return saveExcludedBrands(next);
}
