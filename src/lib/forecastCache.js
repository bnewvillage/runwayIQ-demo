// =========================================================
// Persistent cache for Forecast Analytics' per-horizon responses.
//
// Why persistent rather than a React ref: switching horizons on a brand
// you already looked at should be instant for the whole working day, not
// just until the tab reloads. The forecast math is expensive server-side
// and the underlying data only changes once a night.
//
// Correctness rests on one rule: every entry is stamped with the
// `core_load` pipeline marker it was fetched under (see api/main.py's
// /meta), and is discarded on read if that marker no longer matches. The
// client never guesses freshness from the clock -- the nightly run drifts,
// retries up to 3 times and can be dispatched by hand, so "it's past
// 02:00 UTC" tells you nothing about whether new data actually landed.
//
// IndexedDB rather than localStorage: a single brand's forecast can run to
// tens of thousands of items with per-country weekly arrays. localStorage
// is synchronous (janks the main thread) and caps around 5-10MB, where
// exceeding the quota throws rather than degrading.
// =========================================================

const DB_NAME = 'runwayiq';
const DB_VERSION = 1;
const STORE = 'forecasts';

// Cap on retained entries, evicted least-recently-used first. Entries are
// per (brand-generation, horizon), and HORIZONS currently has 8 values, so
// this must be a multiple of that or a brand evicts its own earlier
// horizons as you explore it -- which is exactly what a cap of 5 did:
// clicking through all 8 horizons left only the last 5, and going back to
// the first refetched. Sized at two brands' worth so switching between a
// pair of brands stays instant.
const HORIZON_COUNT = 8;
const MAX_ENTRIES = HORIZON_COUNT * 2;

// Responses above this many items are served but never persisted, as a
// backstop against a single pathological record. Deliberately set above
// the largest brand in the catalogue: the big brands are the
// slow fetches, so they're the ones the cache exists for -- excluding them
// would leave it helping only the brands that were already fast. Quota
// exhaustion is handled by writeCached's catch, so the browser's own limit
// is the real ceiling; this only stops one absurd response from trying.
const MAX_PERSIST_ITEMS = 60000;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    try {
      result = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function req(request) {
  return { __req: request };
}

/** Cache key: the full set of inputs that change the response. months is
 * excluded -- it's the per-entry dimension within a generation. */
export function generationKey(brand, signed, channelWeights, includeInactive) {
  return JSON.stringify([brand, signed, channelWeights, includeInactive]);
}

function entryKey(genKey, months) {
  return `${genKey}::${months}`;
}

/** Returns {items, inactiveOmitted}, or null on any miss -- wrong pipeline
 * marker, absent entry, or IndexedDB being unavailable (private browsing,
 * quota, disabled). A cache is an optimisation; failing to read one is
 * never an error worth surfacing. */
export async function readCached(genKey, months, dataVersion) {
  try {
    const rec = await tx('readonly', (s) => req(s.get(entryKey(genKey, months))));
    if (!rec) return null;
    // dataVersion null means /meta was unreachable. Serve what we have
    // rather than erroring: if the marker endpoint is down the forecast
    // endpoint almost certainly is too, so refusing the cache turns a
    // usable-but-unverified table into a blank page. The caller shows an
    // explicit "freshness unverified" label so this is never mistaken for
    // confirmed-current data.
    if (dataVersion == null) { touch(entryKey(genKey, months)); return unpack(rec); }
    // Lazy expiry: stale entries are dropped when something tries to read
    // them, rather than swept proactively on load. Combined with the LRU
    // cap above, dead entries can't accumulate without bound.
    if (rec.dataVersion !== dataVersion) return null;
    touch(entryKey(genKey, months));
    return unpack(rec);
  } catch {
    return null;
  }
}

function unpack(rec) {
  return { items: rec.items, inactiveOmitted: rec.inactiveOmitted || 0 };
}

/** Best-effort write. Oversized responses are deliberately skipped. */
export async function writeCached(genKey, months, dataVersion, items, inactiveOmitted = 0) {
  if (!dataVersion || items.length > MAX_PERSIST_ITEMS) return;
  try {
    await tx('readwrite', (s) => {
      s.put({ items, inactiveOmitted, dataVersion, usedAt: Date.now() }, entryKey(genKey, months));
    });
    await evictOverCap();
  } catch {
    /* cache writes are optional -- quota, private browsing, etc. */
  }
}

async function touch(key) {
  try {
    await tx('readwrite', (s) => {
      const g = s.get(key);
      g.onsuccess = () => {
        if (g.result) s.put({ ...g.result, usedAt: Date.now() }, key);
      };
    });
  } catch { /* best effort */ }
}

async function evictOverCap() {
  try {
    const db = await openDb();
    const entries = await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, 'readonly');
      const s = t.objectStore(STORE);
      const out = [];
      const c = s.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) { resolve(out); return; }
        out.push({ key: cur.key, usedAt: cur.value.usedAt || 0 });
        cur.continue();
      };
      c.onerror = () => reject(c.error);
    });
    if (entries.length <= MAX_ENTRIES) return;
    entries.sort((a, b) => a.usedAt - b.usedAt);
    const doomed = entries.slice(0, entries.length - MAX_ENTRIES);
    await tx('readwrite', (s) => doomed.forEach((e) => s.delete(e.key)));
  } catch { /* best effort */ }
}

/** Wipes everything -- backs the "Refresh data" button. */
export async function clearCache() {
  try {
    await tx('readwrite', (s) => { s.clear(); });
  } catch { /* best effort */ }
}
