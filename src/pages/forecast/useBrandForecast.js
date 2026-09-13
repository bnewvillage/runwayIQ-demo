import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrandForecast } from '../../lib/api.js';
import { generationKey, readCached, writeCached, clearCache } from '../../lib/forecastCache.js';
import { useMeta } from '../../app/MetaProvider.jsx';

/**
 * Forecast rows for one selection, with day-long caching and freshness
 * checking. Extracted from the page because this is one cohesive job with
 * a narrow interface -- selection in, rows out -- and because a race here
 * shipped wrong data to production: the guard that decides whether a
 * response may paint sat a hundred lines away from the state it protects,
 * surrounded by unrelated concerns, and was quietly narrower than it
 * needed to be.
 *
 * Two rules do all the work:
 *
 *   1. A response may only paint if its effect has not been superseded.
 *      `cancelled` is the effect's own cleanup flag and therefore covers
 *      every input -- brand, horizon, weights, signed, markers. Anything
 *      narrower (an earlier version compared only the horizon) lets a
 *      stale response overwrite a newer one along the dimension it forgot.
 *
 *   2. A response is always cached, superseded or not. The work is done,
 *      and returning to that selection is exactly what the cache is for.
 *
 * Freshness is never inferred from the clock. The nightly pipeline drifts,
 * retries, and can be dispatched by hand, so "it is past 02:00 UTC" says
 * nothing about whether new data landed. Entries are stamped with the
 * core_load marker they were fetched under and discarded on read when it
 * no longer matches.
 */
export function useBrandForecast({ brand, months, signed, channelWeights }) {
  const [rows, setRows] = useState([]);
  const [inactiveOmitted, setInactiveOmitted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const { meta, reload: reloadMeta } = useMeta();

  // Which fetches are genuinely in flight, keyed as the cache is. A single
  // boolean cannot express this: superseded fetches keep running and still
  // populate the cache, so their horizon keeps its spinner until the data
  // actually lands rather than going dark the moment the selection moves.
  const [inFlight, setInFlight] = useState(() => new Set());
  const markFlight = (key, on) => setInFlight((cur) => {
    const next = new Set(cur);
    if (on) next.add(key); else next.delete(key);
    return next;
  });

  const genKey = useMemo(
    () => generationKey(brand, signed, channelWeights),
    [brand, signed, channelWeights],
  );

  useEffect(() => {
    // Wait for markers to resolve either way before touching the cache.
    if (!brand || meta === null) return;
    let cancelled = false;
    const flightKey = `${genKey}::${months}`;
    // Forecast Analytics computes from the core tables, so core_load is
    // the marker governing its cache -- not demand_glance's, which belongs
    // to a step that fails independently and feeds a different page.
    const version = meta.core_load ?? null;

    (async () => {
      const cached = await readCached(genKey, months, version);
      if (cancelled) return;
      if (cached) {
        setRows(cached.items);
        setInactiveOmitted(cached.inactiveOmitted);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      markFlight(flightKey, true);
      try {
        const data = await getBrandForecast(brand, {
          months, signed,
          showroom: channelWeights.Showroom,
          distribution: channelWeights.Distribution,
          ecommerce: channelWeights.Ecommerce,
        });
        writeCached(genKey, months, version, data.items, data.inactive_omitted ?? 0);
        if (!cancelled) {
          setRows(data.items);
          setInactiveOmitted(data.inactive_omitted ?? 0);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        markFlight(flightKey, false);
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [brand, genKey, months, signed, channelWeights, meta, refreshNonce]);

  const refresh = useCallback(async () => {
    await clearCache();
    await reloadMeta();
    // Re-runs the fetch effect even when nothing else changed, so the
    // button visibly reloads instead of silently emptying storage.
    setRefreshNonce((n) => n + 1);
  }, [reloadMeta]);

  // Exposed as a predicate rather than the set plus the key, so the key
  // format stays an implementation detail of this hook.
  const isFetching = useCallback(
    (m) => inFlight.has(`${genKey}::${m}`),
    [inFlight, genKey],
  );

  return { rows, inactiveOmitted, loading, error, meta, isFetching, refresh };
}
