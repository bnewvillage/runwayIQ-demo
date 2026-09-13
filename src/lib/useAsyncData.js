import { useEffect, useState } from 'react';
import { cachedFetch, peek } from './dataCache.js';

/**
 * One fetch-into-state effect, instead of seven copies of it.
 *
 * Every page here had grown the same block by hand -- `let cancelled =
 * false`, an async IIFE, try/catch/finally, and an `if (!cancelled)`
 * guard before every setState. Four copies were in StockAnalysisPage
 * alone. They were identical in shape and differed only in which fetch
 * ran and which state it filled, which is the definition of a missing
 * helper rather than a style preference.
 *
 * The cancelled flag is the part worth centralising: forgetting it means
 * a slow response from a previous selection lands after a newer one and
 * silently overwrites it with stale data. That bug is invisible in
 * testing and obvious in production, so it should not depend on each
 * call site remembering to write the guard.
 *
 * `enabled: false` resets to the idle state rather than fetching, which
 * is what the conditional-fetch call sites were open-coding with an
 * early `return` after clearing state.
 *
 * `cacheKey` opts a call site into the page-lifetime cache (dataCache.js):
 * the response is fetched once and then served from memory until a reload.
 * Only pass one for a fetch that takes NO parameters -- the key must
 * identify the whole response, and a per-filter endpoint has more keys than
 * a session should hold. Two call sites sharing a key share the fetch,
 * which is the point: Sales Analytics and Brand Analytics both read the
 * cube, and the second one to mount should not re-pull 0.2 MB.
 *
 * Returns { data, error, loading }. `data` is null whenever it is not
 * currently valid -- while loading, after a failure, or while disabled --
 * so a caller can never render a previous selection's data under a new
 * selection's label.
 */
export function useAsyncData(fetcher, deps, { enabled = true, cacheKey = null } = {}) {
  // Seeded from the cache so a hit is already present on the FIRST paint.
  // Letting it fall through to the effect would render null -> value across
  // two paints and flash a loading state for something in memory.
  const seed = cacheKey && enabled ? peek(cacheKey) : undefined;
  const [state, setState] = useState(seed === undefined
    ? { data: null, error: null, loading: false }
    : { data: seed, error: null, loading: false });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!enabled) {
        if (!cancelled) setState({ data: null, error: null, loading: false });
        return;
      }
      const hit = cacheKey ? peek(cacheKey) : undefined;
      if (hit !== undefined) {
        if (!cancelled) setState({ data: hit, error: null, loading: false });
        return;
      }
      if (!cancelled) setState({ data: null, error: null, loading: true });
      try {
        const data = await (cacheKey ? cachedFetch(cacheKey, fetcher) : fetcher());
        if (!cancelled) setState({ data, error: null, loading: false });
      } catch (err) {
        if (!cancelled) setState({ data: null, error: err.message, loading: false });
      }
    })();
    return () => { cancelled = true; };
    // The fetcher is intentionally not a dependency: it is written inline
    // at every call site, so a new identity on each render would loop
    // forever. `deps` is the real trigger, exactly as with useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, cacheKey, ...deps]);

  return state;
}
