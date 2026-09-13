// Pure logic for Demand Forecast -- sibling to DemandForecastPage.jsx per
// CONTEXT.md's convention (logic out of components so it stays
// independently reasoned-about and portable).
import { COUNTRIES } from '../../lib/constants.js';
import { matchQuery } from '../../lib/searchMatch.js';

export const EMPTY = { search: '', brands: [] };

/** How a country's rate was arrived at, as the forecast module labels it.
 *
 *  Shown because it is the honest caveat on every row: the trend model is
 *  trusted far less often than the tier names suggest. At three months
 *  36 of 3,864 country-slots use Holt and the rest fall back to a
 *  weighted average; at twelve it is 91 of 12,258. A reader treating a
 *  long-horizon figure as a trend projection is usually wrong, and the
 *  row can say so rather than leaving them to assume. */
export const METHOD_LABEL = {
  'holt-short': 'Holt · short',
  'holt-long': 'Holt · long',
  'wma-short-fallback': 'WMA · short',
  'wma-mid': 'WMA · mid',
  'wma-long-fallback': 'WMA · long',
};

/** The methods actually used across a run, commonest first -- so the page
 *  can state what it really ran rather than what the tier is called. */
export function methodMix(rows) {
  const seen = new Map();
  rows.forEach((r) => COUNTRIES.forEach((c) => {
    const m = r.velocity?.[c.key]?.method;
    if (m) seen.set(m, (seen.get(m) || 0) + 1);
  }));
  return [...seen.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([method, count]) => ({ method, count, label: METHOD_LABEL[method] || method }));
}

export function filterRows(rows, filter) {
  return rows.filter((r) => {
    if (filter.brands.length && !filter.brands.includes(r.brand)) return false;
    if (filter.search) {
      // The app's one search grammar (,, = AND, // = OR, --term excludes),
      // same as Compare, Basket and Placement.
      if (!matchQuery(`${r.item_code} ${r.item_name} ${r.brand}`, filter.search)) return false;
    }
    return true;
  });
}

/** Sort on a top-level field, or on `stock`/`demand` for one country --
 *  those are country-keyed objects, so "UAE demand" is a key path rather
 *  than a column name. */
export function sortRows(rows, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const read = (r) => (sort.country ? (r[sort.key] || {})[sort.country] : r[sort.key]);
  return [...rows].sort((a, b) => {
    const x = read(a), y = read(b);
    if (x == null && y == null) return 0;
    // Nulls last in both directions: a market with no figure is the
    // absence of an answer, not the smallest one.
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x).localeCompare(String(y)) * dir;
    }
    return (x - y) * dir;
  });
}

export function totals(rows) {
  return {
    items: rows.length,
    netOrder: rows.reduce((s, r) => s + (r.net_order || 0), 0),
    netOrderValue: rows.reduce((s, r) => s + (r.net_order_value || 0), 0),
    brands: new Set(rows.map((r) => r.brand).filter(Boolean)).size,
  };
}

const COLUMNS = [
  ['item_code', 'Item code'],
  ['item_name', 'Item name'],
  ['brand', 'Brand'],
  ...COUNTRIES.flatMap((c) => [
    [`stock.${c.key}`, `${c.key} stock`],
    [`demand.${c.key}`, `${c.key} demand`],
    [`velocity.${c.key}.method`, `${c.key} method`],
  ]),
  ['net_order', 'Net order'],
  ['net_order_value', 'Net order value'],
];

const at = (row, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), row);

function cell(v) {
  if (v == null) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Every country's figures, flattened -- this export is the reason to run
 *  the thing, so it carries the per-market detail the table has to
 *  summarise, including which method produced each rate. */
export function forecastCsv(rows) {
  return [
    COLUMNS.map(([, label]) => label).join(','),
    ...rows.map((r) => COLUMNS.map(([path]) => cell(at(r, path))).join(',')),
  ].join('\n');
}
