import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getMeta } from '../lib/api.js';
import { assessFreshness } from '../lib/freshness.js';

/**
 * One source of truth for the pipeline freshness markers.
 *
 * They drive three separate things -- the header's staleness verdict, the
 * forecast cache's invalidation, and the refresh flow's completion check --
 * and two independent fetchers would disagree with each other at exactly
 * the moment the disagreement matters.
 */
const MetaContext = createContext(null);

// null = not resolved yet, {} = /meta failed, object = known. The three
// states must stay distinct: serving unverified cache is right when the
// endpoint is down, but premature while its request is still in flight.
export function MetaProvider({ children }) {
  const [meta, setMeta] = useState(null);

  // Returning the previous object when markers are unchanged matters: meta
  // feeds effect dependency arrays downstream, so a fresh object on every
  // poll would re-run them for nothing.
  const apply = useCallback((next) => setMeta((prev) => (
    prev && next && prev.core_load === next.core_load
      && prev.demand_glance === next.demand_glance ? prev : next
  )), []);

  const reload = useCallback(() => getMeta().then(apply).catch(() => apply({})), [apply]);

  // Re-read on tab focus, not just on mount. A tab parked overnight would
  // otherwise hold the pre-run marker, keep matching its own cached entries
  // against it, and serve yesterday's numbers all morning.
  useEffect(() => {
    reload();
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [reload]);

  const value = useMemo(() => ({
    meta,
    reload,
    freshness: assessFreshness(meta),
  }), [meta, reload]);

  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta() {
  const ctx = useContext(MetaContext);
  if (!ctx) throw new Error('useMeta must be used inside MetaProvider');
  return ctx;
}
