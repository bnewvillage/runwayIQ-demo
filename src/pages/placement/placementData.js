// Pure logic for UAE Stock Placement -- sibling to
// StockPlacementPage.jsx per CONTEXT.md's convention (logic out of
// components so it stays independently reasoned-about and portable).
import { matchQuery } from '../../lib/searchMatch.js';

export const EMPTY = { search: '', tiers: [], shortOnly: true };

// Worst-last, the same order Stock Analysis uses. Named here only so the
// filter chips render in a stable sequence -- the server decides which
// tiers are in scope, this does not get a vote, and chips are drawn from
// what actually came back.
export const TIER_ORDER = [
  'fast_mover', 'active', 'slow_mover', 'aging',
  'critical', 'new_stock', 'dead_stock', 'undetermined',
];

export const TIER_LABEL = {
  fast_mover: 'Fast mover', active: 'Active', slow_mover: 'Slow mover',
  aging: 'Aging', critical: 'Critical', new_stock: 'New stock',
  dead_stock: 'Dead stock', undetermined: 'Undetermined',
};

/** The tiers actually present, in ladder order -- so the chips describe
 *  the payload rather than a list that might not match it. */
export function tiersIn(rows) {
  const seen = new Set(rows.map((r) => r.health));
  return TIER_ORDER.filter((t) => seen.has(t));
}

export function filterRows(rows, filter) {
  return rows.filter((r) => {
    if (filter.shortOnly && !(r.move > 0)) return false;
    if (filter.tiers.length && !filter.tiers.includes(r.health)) return false;
    if (filter.search) {
      // The app's one search grammar (,, = AND, // = OR, --term
      // excludes), same as Compare and Basket -- a second parser for a
      // second search box is how two boxes end up behaving differently.
      const hay = `${r.item_code} ${r.item_name} ${r.brand}`;
      if (!matchQuery(hay, filter.search)) return false;
    }
    return true;
  });
}

export function sortRows(rows, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null && y == null) return 0;
    // Nulls last in both directions: a missing last-sale date is the
    // absence of an answer, not the earliest one.
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string' || typeof y === 'string') {
      return String(x).localeCompare(String(y)) * dir;
    }
    return (x - y) * dir;
  });
}

/** Totals over whatever is on screen, so the headline cannot describe a
 *  different set of rows than the table under it.
 *
 *  Deliberately only the SHORTFALL figures. Summing what Motor City and
 *  Jebel Ali hold across `rows` reads as context but is really the
 *  filter talking -- with the default "needs moving" view it reported 40
 *  units at Motor City against a real 3,272. A number that changes
 *  meaning when you click a filter does not belong in a headline. */
export function totals(rows) {
  const short = rows.filter((r) => r.move > 0);
  return {
    items: rows.length,
    itemsShort: short.length,
    unitsToMove: short.reduce((s, r) => s + r.move, 0),
    valueToMove: short.reduce((s, r) => s + r.move_value, 0),
  };
}

/** New stock holding something at Jebel Ali, stranded-first then by the
 *  value sitting there.
 *
 *  No move column and no target: the new_stock tier is reached only by
 *  NOT selling, so every row has zero customer demand and the rule has
 *  nothing to compute from. This is a list to check by eye, which is why
 *  it ranks by what is at stake rather than by an answer. */
export function newStockRows(rows) {
  return rows
    .filter((r) => r.jebel_ali > 0)
    .map((r) => ({ ...r, stranded: r.jebel_ali * (r.valuation_rate || 0) }))
    .sort((a, b) => (b.motor_city === 0) - (a.motor_city === 0)
      || b.stranded - a.stranded);
}

const NEW_COLUMNS = [
  ['item_code', 'Item code'],
  ['item_name', 'Item name'],
  ['brand', 'Brand'],
  ['motor_city', 'Motor City'],
  ['jebel_ali', 'Jebel Ali'],
  ['stranded', 'Value at Jebel Ali'],
];

const COLUMNS = [
  ['item_code', 'Item code'],
  ['item_name', 'Item name'],
  ['brand', 'Brand'],
  ['health', 'Tier'],
  ['motor_city', 'Motor City'],
  ['jebel_ali', 'Jebel Ali'],
  ['units_12m', 'Sold 12m'],
  ['last_sale', 'Last sale'],
  ['peak', 'Peak day'],
  ['peak_3d', 'Peak 3d'],
  ['move', 'Move'],
];

function cell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(columns, rows) {
  return [
    columns.map(([, label]) => label).join(','),
    ...rows.map((r) => columns.map(([key]) => cell(r[key])).join(',')),
  ].join('\n');
}

/** The rows as they appear on screen -- a picking list, so it carries
 *  what someone walking the aisle needs and nothing else. */
export function placementCsv(rows) {
  return toCsv(COLUMNS, rows);
}

/** The review list, same order it is shown in. Value is rounded because
 *  it is a ranking aid, not an accounting figure. */
export function newStockCsv(rows) {
  return toCsv(NEW_COLUMNS, rows.map((r) => ({ ...r, stranded: Math.round(r.stranded) })));
}
