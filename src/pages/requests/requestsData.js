// Pure logic for the Requests page -- sibling to RequestsPage.jsx per
// CONTEXT.md's convention.
//
// The whole page runs off one array of ~250 outstanding request lines,
// so every filter is an array filter and every grouping is a reduce.
import { matchQuery } from '../../lib/searchMatch.js';
import { COUNTRIES as MARKETS } from '../../lib/constants.js';

// Derived, not declared. This was its own hardcoded ['UAE','QAT','KSA']
// -- a third copy of the country list beside shared/companies.py and
// lib/constants.js, and a third place to edit when a market opens. The
// export keeps its name and its shape (bare keys), so every caller is
// untouched.
export const COUNTRIES = MARKETS.map((c) => c.key);

export const EMPTY = { countries: [], brands: [], search: '' };

/** Days between a request's date and today, floored at 0.
 *
 * Age is the column that turns a list into a queue: a request raised
 * eleven months ago and still unordered is a different problem from one
 * raised yesterday, and nothing else on the row says which it is. */
export function ageDays(dateStr, now = new Date()) {
  if (!dateStr) return null;
  const then = new Date(`${dateStr}T00:00:00Z`);
  const days = Math.floor((now - then) / 86400000);
  return days < 0 ? 0 : days;
}

/** A request is "new" for a week. Long enough that a Monday still shows
 *  what came in on the previous Tuesday, short enough that the list stays
 *  a heads-up rather than a second copy of the table. */
export const NEW_DAYS = 7;

/** Lines raised within NEW_DAYS, newest first.
 *
 * A future-dated request (they exist -- a schedule can be set ahead of
 * the transaction) has its age floored at 0 by ageDays, so it counts as
 * new rather than falling out for being negative. */
export function recentRows(rows, days = NEW_DAYS, now = new Date()) {
  return rows
    .filter((r) => ageDays(r.transaction_date, now) <= days)
    .sort((a, b) => (a.transaction_date < b.transaction_date ? 1 : -1));
}

export function filterRows(rows, f) {
  const q = f.search.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.countries.length && !f.countries.includes(r.country)) return false;
    // Normalised to '' so an empty brand is selectable rather than
    // unmatchable: the snapshot shows brandless items under one card,
    // and [''].includes(null) is false.
    if (f.brands.length && !f.brands.includes(r.brand || '')) return false;
    // The requester joins the haystack rather than getting its own
    // control: "who asked for this" is usually a follow-up to an item you
    // are already looking at, and the grammar already does ,,and //or
    // --exclude across everything else on the row.
    if (q && !matchQuery(
      `${r.item_code}\n${r.item_name || ''}\n${r.request_id}\n${r.requested_by || ''}`,
      q)) return false;
    return true;
  });
}

/** One row per ITEM instead of per request line.
 *
 * Quantities sum; STOCK DOES NOT. Stock is a property of the item, so
 * the three market columns are identical on every line for a given item
 * and summing them would multiply the shelf by the number of people who
 * asked for it -- the single most tempting bug in this whole page.
 *
 * `requests` counts the distinct documents asking, which is the fact
 * aggregation adds: three separate requests for the same part is a
 * different signal from one request for three of them.
 */
export function aggregateByItem(rows) {
  const by = new Map();
  for (const r of rows) {
    let a = by.get(r.item_code);
    if (!a) {
      by.set(r.item_code, (a = {
        item_code: r.item_code,
        item_name: r.item_name,
        brand: r.brand,
        // One numeric field per market, keyed exactly as the API sends
        // them. Generated, so a new market needs no edit here.
        ...Object.fromEntries(MARKETS.map(
          (c) => [`${c.dot}_stock`, Number(r[`${c.dot}_stock`])])),
        outstanding_qty: 0,
        requests: new Set(),
        countries: new Set(),
        people: new Set(),
        oldest: r.transaction_date,
      }));
    }
    a.outstanding_qty += Number(r.outstanding_qty);
    a.requests.add(r.request_id);
    if (r.country) a.countries.add(r.country);
    if (r.requested_by) a.people.add(r.requested_by);
    if (r.transaction_date < a.oldest) a.oldest = r.transaction_date;
  }
  return [...by.values()].map((a) => ({
    ...a,
    requests: a.requests.size,
    // Named when one person wants it, counted when several do -- three
    // people asking for the same part independently is itself the
    // signal, and three names would not fit the column anyway.
    requested_by: a.people.size === 1 ? [...a.people][0] : `${a.people.size} people`,
    // Oldest, not newest: how long the need has gone unmet is the
    // question, and the newest request would hide that.
    transaction_date: a.oldest,
    country: [...a.countries].sort().join(', '),
  }));
}

/** Rows grouped under brand headings, with the subtotal a section needs
 *  to be worth having. Brandless items collect under one heading rather
 *  than vanishing -- an item with no brand is usually a service or a
 *  mis-keyed code, and that is worth seeing, not hiding. */
export function sectionByBrand(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.brand || '(no brand)';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r);
  }
  return [...by.entries()]
    .map(([brand, items]) => ({
      brand,
      rows: items,
      lines: items.length,
      outstanding: items.reduce((s, r) => s + Number(r.outstanding_qty), 0),
    }))
    .sort((a, b) => b.outstanding - a.outstanding || a.brand.localeCompare(b.brand));
}

export function sortRows(rows, { key, dir }) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    if (typeof x === 'string' && typeof y === 'string') return x.localeCompare(y) * sign;
    return (Number(x) - Number(y)) * sign;
  });
}

/** Outstanding units per brand, split by the market that asked.
 *
 * Units rather than lines: the page's headline figure is units still to
 * order, and one line for 110 units is not the same problem as 110
 * lines for one each.
 *
 * `other` catches a request whose company maps to no country. There are
 * none today, and the column hides itself when the count is zero -- but
 * folding such a row silently into the total would leave the three
 * market columns not adding up, which is the sort of small lie that
 * costs an hour to track down later.
 */
export function brandSnapshot(rows) {
  const by = new Map();
  for (const r of rows) {
    const key = r.brand || '(no brand)';
    let b = by.get(key);
    if (!b) {
      by.set(key, (b = {
        brand: key, UAE: 0, QAT: 0, KSA: 0, other: 0, total: 0, lines: 0,
        oldest: r.transaction_date, newest: r.transaction_date,
      }));
    }
    const q = Number(r.outstanding_qty);
    if (COUNTRIES.includes(r.country)) b[r.country] += q; else b.other += q;
    b.total += q;
    b.lines += 1;
    // ISO dates, so string comparison IS date comparison.
    if (r.transaction_date < b.oldest) b.oldest = r.transaction_date;
    if (r.transaction_date > b.newest) b.newest = r.transaction_date;
  }
  return [...by.values()].sort((a, b) => b.total - a.total || a.brand.localeCompare(b.brand));
}

/** "27 Sep 25" -- short enough for a card, unambiguous about the year.
 *
 *  Parsed as UTC so a local timezone cannot shift the day backwards, and
 *  the month is clipped to three letters because en-GB renders September
 *  as "Sept" and every other month as three -- a one-character wobble in
 *  a nowrap column that has to line up. */
export function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00Z`);
  const mon = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }).slice(0, 3);
  return `${d.getUTCDate()} ${mon} ${String(d.getUTCFullYear()).slice(2)}`;
}

/** Totals for the summary line. Distinct items and requests rather than
 *  a row count, because one row is one line and nobody orders lines. */
export function totals(rows) {
  return {
    lines: rows.length,
    items: new Set(rows.map((r) => r.item_code)).size,
    requests: new Set(rows.map((r) => r.request_id)).size,
    units: rows.reduce((s, r) => s + Number(r.outstanding_qty), 0),
  };
}


/** The table's rows from a filtered set: shape, then sort.
 *
 * One definition, used by the page and by the export. The export runs the
 * same pipeline over a different starting set (with or without the
 * excluded brands), and a CSV whose rows were shaped by a second copy of
 * this logic is a CSV that will eventually disagree with the screen. */
export function shapeRows(rows, aggregate, sort) {
  return sortRows(aggregate ? aggregateByItem(rows) : rows, sort);
}

// Stock is one column per market, keyed as the API sends it.
const STOCK_COLUMNS = MARKETS.map((c) => `${c.dot}_stock`);

// The two shapes, as column lists rather than as two builders.
// aggregateByItem reuses the per-line key names for everything the shapes
// share, so a single row builder serves both.
const LINE_COLUMNS = [
  'request_id', 'transaction_date', 'schedule_date', 'status', 'country',
  'item_code', 'item_name', 'brand', 'requested_by',
  'qty', 'ordered_qty', 'outstanding_qty', 'uom', ...STOCK_COLUMNS,
];

// No request_id, qty or schedule_date: an aggregate row spans several
// requests, so those are facts about lines that no longer exist here.
// `requests` counts them instead, and transaction_date is the OLDEST --
// how long the need has gone unmet.
const ITEM_COLUMNS = [
  'item_code', 'item_name', 'brand', 'country', 'requested_by',
  'requests', 'outstanding_qty', 'transaction_date', ...STOCK_COLUMNS,
];

function csvCell(val) {
  if (val == null) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The visible table as CSV, in whichever shape it is currently in. */
export function requestsCsv(rows, aggregate) {
  const cols = aggregate ? ITEM_COLUMNS : LINE_COLUMNS;
  return [
    cols.join(','),
    ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(',')),
  ].join('\n');
}
