// Pure logic for the Demand Glance page -- kept out of the component so it
// stays independently testable/reasoned-about (see CONTEXT.md's convention:
// every page pairs a <Tool>Page.jsx with a sibling pure-logic module).
//
// Sorting model mirrors purchase_assistant/web's DemandPage: brand order
// and item order are two INDEPENDENT sorts, never one flattened sort that
// abandons grouping. brandSort decides which brand card comes first;
// itemSort decides the order of rows within every expanded brand's table.
import { COUNTRIES } from '../../lib/constants.js';

const NO_BRAND = '(No brand)';

/** Flattens one /demand-glance row (its per-country keys) into
 * a per-country nested shape the table/sort logic works with. Some catalog
 * rows have no brand assigned (bare numeric codes, modifier SKUs) -- these
 * are grouped under NO_BRAND rather than left null, which would crash any
 * later .toLowerCase()/.includes() call on the brand string. */
export function normalizeRow(r) {
  const countries = {};
  for (const { key } of COUNTRIES) {
    const p = key.toLowerCase();
    const velocity = r[`${p}_velocity`];
    countries[key] = {
      stock: r[`${p}_stock`] == null ? 0 : Number(r[`${p}_stock`]),
      velocity: velocity == null ? null : Number(velocity),
      direction: r[`${p}_direction`],
      demand: r[`${p}_demand`] == null ? null : Number(r[`${p}_demand`]),
      demandValue: r[`${p}_demand_value`] == null ? null : Number(r[`${p}_demand_value`]),
      weeksOfStock: r[`${p}_weeks_of_stock`] == null ? null : Number(r[`${p}_weeks_of_stock`]),
    };
  }
  return {
    item_code: r.item_code,
    item_name: r.item_name,
    brand: r.brand || NO_BRAND,
    countries,
    net_order: Number(r.net_order),
    valuation_rate: Number(r.valuation_rate),
    net_order_value: Number(r.net_order_value),
  };
}

/** The qty or value figure for a given column key, per the active sort
 * mode. Negative per-country demand (a surplus) is clamped to 0 here too,
 * matching what's actually shown on screen -- sorting on the displayed
 * number, not the hidden signed one. */
export function metricFor(row, key, sortMode) {
  const qty = key === 'net' ? row.net_order : Math.max(0, row.countries[key]?.demand ?? 0);
  if (sortMode === 'value') {
    return key === 'net' ? row.net_order_value : Math.max(0, row.countries[key]?.demandValue ?? 0);
  }
  return qty;
}

export function groupByBrand(rows) {
  const byBrand = new Map();
  const order = [];
  for (const r of rows) {
    if (!byBrand.has(r.brand)) { byBrand.set(r.brand, []); order.push(r.brand); }
    byBrand.get(r.brand).push(r);
  }
  return { byBrand, order };
}

/** Orders brand names by the brand's own aggregate (net units or net
 * value, summed over that brand's full visible row set) or alphabetically. */
export function sortBrandOrder(order, byBrand, brandSort) {
  const { key, dir } = brandSort;
  const agg = (brand) => {
    const rows = byBrand.get(brand);
    if (key === 'name') return brand;
    if (key === 'units') return rows.reduce((s, r) => s + r.net_order, 0);
    return rows.reduce((s, r) => s + r.net_order_value, 0);
  };
  const sorted = [...order].sort((a, b) => {
    const x = agg(a), y = agg(b);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return dir === 'asc' ? c : -c;
  });
  return sorted;
}

/** Orders one brand's items by the shared itemSort -- applied identically
 * inside every expanded brand card, independent of brand order. */
export function sortItems(rows, itemSort) {
  const { key, mode, dir } = itemSort;
  return [...rows].sort((a, b) => (metricFor(a, key, mode) - metricFor(b, key, mode)) * dir);
}

/** Raw signed demand per country -- a country surplus stays negative here
 * even though the on-screen gauge clamps it to 0, because purchasing/
 * accounting needs the true figure, not the "nothing to order" display cue. */
function itemCsvRow(r) {
  return [
    r.item_code,
    r.countries.UAE.demand ?? '',
    r.countries.QAT.demand ?? '',
    r.countries.KSA.demand ?? '',
    r.net_order,
  ].join(',');
}
const CSV_HEADER = ['item_code',
  ...COUNTRIES.map((c) => `${c.dot}_demand`),
  'net_order'].join(',');

export function brandCsv(rows) {
  return [CSV_HEADER, ...rows.map(itemCsvRow)].join('\n');
}

/** All visible brands' items, in the current brand + item sort order. */
export function allVisibleCsv(brandOrder, byBrand) {
  const header = 'brand,' + CSV_HEADER;
  const lines = [];
  brandOrder.forEach((brand) => {
    byBrand.get(brand).forEach((r) => lines.push(brand.replace(/,/g, ' ') + ',' + itemCsvRow(r)));
  });
  return [header, ...lines].join('\n');
}
