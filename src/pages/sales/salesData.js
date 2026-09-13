// Pure logic for Sales Analytics -- sibling to SalesAnalyticsPage.jsx per
// CONTEXT.md's convention (logic out of components so it stays
// independently reasoned-about and portable).
//
// The whole page runs off ONE in-memory array of ~5,000 cube cells. Every
// filter is an array filter and every chart is a reduce over the result,
// which is why cross-filtering here needs no server round-trip and no
// per-visual endpoint. Keep it that way: anything that reaches for the
// network on a filter change has misunderstood the design.
import { COUNTRIES } from '../../lib/constants.js';

export const CHANNELS = ['Showroom', 'Distribution', 'Ecommerce'];
export const COUNTRY_KEYS = COUNTRIES.map((c) => c.key);

/** A filter selection. Empty array ALWAYS means "no filter, everything" --
 * never "nothing selected therefore no data". Same convention as Stock
 * Analysis, deliberately, so the two pages behave identically. */
// `months` is the period WINDOW (the 3mo/6mo/From-To controls); `drill`
// is a single month reached by clicking a point on a chart. Kept apart
// because the charts must keep plotting the window while marking the
// drilled month -- collapsing both into one field left a chart with a
// single point and no way to step to the next one. Named `drill` rather
// than `month` because one letter between it and `months` is not enough
// to tell two different types apart at a glance.
// `item` is a single SKU reached by clicking a row in the items table.
// It is the one dimension the CUBE CANNOT EXPRESS -- cells are keyed by
// brand/country/channel/month and carry no item -- so it is answered by
// per-item endpoints instead. That is a property of the data, not a
// policy choice, which is why the cube-backed views below are blind to
// it by construction rather than by anyone remembering to opt out.
export const EMPTY = {
  brands: [], countries: [], channels: [], months: [], drill: null, item: null,
};

/** Which filter dimensions a given consumer honours.
 *
 * This is the ONE place that knowledge lives. Both the rows a view reads
 * and the sentence it prints about itself are derived from the same
 * entry, so a panel cannot describe a narrowing it did not apply. That
 * is not hypothetical: the order metrics once reported full-history
 * figures under a caption naming a single drilled month, because the
 * caption and the row filter each carried their own copy of the rule.
 *
 * `ignore` names the dimensions the view is blind to. Everything else
 * applies. */
// No cube cell carries an item, so any view that reads cells is blind to
// it -- and must SAY so, or its caption would claim a narrowing it never
// applied. Named once here so a new cube-backed view inherits the reason
// along with the rule.
const CUBE_BLIND = ['item'];

export const VIEWS = {
  // Charts and tables below the cards: the plain reading of the filter.
  full: { ignore: [...CUBE_BLIND] },
  // KPI cards expand INTO market x channel, so narrowing by those first
  // would open a matrix with one populated column -- the same collapse
  // the donuts avoid by ignoring their own dimension.
  card: { ignore: [...CUBE_BLIND, 'countries', 'channels'] },
  // The charts ARE the period selector: they plot the window and mark
  // the drilled month rather than collapsing onto it.
  // The only cube view that honours `item`, because it does not read the
  // cube when one is selected -- it swaps to that item's own series.
  chart: { ignore: ['drill'] },
  // An order spans brands (36% of them do, carrying 64% of value), so
  // order-level metrics have no brand dimension to filter on.
  order: { ignore: [...CUBE_BLIND, 'brands'] },
  // Customer concentration: live per scope, so it can honour every
  // dimension including the one the cube has no column for.
  customers: { ignore: [] },
};

/** The view a selector reads: blind to its OWN dimension so it stays
 *  whole and can be clicked. A country donut that filtered by country
 *  would be a single segment. */
export const selectorView = (dim) => ({ ignore: [...CUBE_BLIND, dim] });

// Cube predicates only. `item` is absent on purpose: there is no cell
// field to test, so it is never applied here and is enforced by whoever
// fetches the item's own rows.
const DIMS = {
  brands: (cell, f) => f.brands.includes(cell.brand),
  countries: (cell, f) => f.countries.includes(cell.country),
  channels: (cell, f) => f.channels.includes(cell.channel),
  months: (cell, f) => f.months.includes(cell.year_month),
  drill: (cell, f) => cell.year_month === f.drill,
};

// drill and item are single values; the rest are lists where empty means
// "everything" rather than "nothing".
const SCALARS = ['drill', 'item'];
const selected = (f, dim) => (SCALARS.includes(dim) ? !!f[dim] : f[dim].length > 0);

/** Whether `view` honours `dim` AND the user has narrowed it. */
export function applies(f, dim, view = VIEWS.full) {
  return !view.ignore.includes(dim) && selected(f, dim);
}

export function matchesFilter(cell, f, view = VIEWS.full) {
  return Object.keys(DIMS).every(
    (dim) => !applies(f, dim, view) || DIMS[dim](cell, f));
}

/** The last day of a month, as YYYY-MM-DD.
 *
 * Built by hand rather than via toISOString(): `new Date(y, m + 1, 0)`
 * is local midnight, and in UTC+4 that serialises to the 30th for a
 * 31-day month -- silently dropping the last day of sales from every
 * bounded query on both sales pages. */
export function endOfMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}
/** What a view actually covers, named one dimension at a time.
 *
 * Derived from the SAME view entry that selects the rows, so a figure
 * cannot claim a narrowing it did not apply. Each part names its
 * dimension whether or not the view honours it -- a panel that says
 * "all brands" while a brand is selected is telling the truth about
 * itself, and silence would not.
 *
 * Callers compose: a plain card prints the whole sentence, a split card
 * prints brand and period beside the measure (they qualify both halves)
 * and the market part under each figure. */
export function scopeParts(f, view = VIEWS.full) {
  const on = (dim) => applies(f, dim, view);
  const markets = [
    ...(on('countries') ? [f.countries.join(' + ')] : []),
    ...(on('channels') ? [f.channels.join(' + ')] : []),
  ];
  return {
    brands: on('brands')
      ? (f.brands.length <= 2 ? f.brands.join(' + ') : `${f.brands.length} brands`)
      : 'all brands',
    markets: markets.length ? markets.join(' · ') : 'all markets and channels',
    period: on('drill') ? periodLabel([f.drill])
      : (on('months') ? periodLabel(f.months) : 'full history'),
    item: on('item') ? f.item : 'all items',
  };
}

/** The whole sentence, for a figure that is not split. */
export function describeScope(f, view = VIEWS.full) {
  const p = scopeParts(f, view);
  return `${p.brands} · ${p.markets} · ${p.period} · ${p.item}`;
}

/** "Mar 26" for one month, "Jan–Mar 26" for a run, spelling out both
 *  years when the window straddles them. */
export function periodLabel(months) {
  if (!months.length) return '';
  const fmt = (m, withYear) => {
    const d = new Date(`${m}T00:00:00`);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return withYear ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon;
  };
  const a = months[0], b = months[months.length - 1];
  if (a === b) return fmt(a, true);
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${fmt(a, !sameYear)}–${fmt(b, true)}`;
}

/** Whether the country/channel selection makes a card's headline and the
 *  filtered figure differ at all. */
export function isNarrowed(f) {
  return f.countries.length > 0 || f.channels.length > 0;
}
/** Cells matching the filter.
 *
 * `ignore` drops ONE dimension from the filter, which is what makes a
 * donut usable as its own selector: a country donut filtered by country
 * would collapse to a single segment, so it reads the selection of every
 * OTHER dimension and shows its own dimension whole, marking the selected
 * slice instead. Same reasoning as the health treemap on Stock Analysis.
 */
export function scope(cells, f, view = VIEWS.full) {
  return cells.filter((c) => matchesFilter(c, f, view));
}

const ZERO = {
  units: 0, revenue: 0, cogs: 0, cogsImputed: 0,
  lines: 0, returnUnits: 0, returnRevenue: 0,
};

export function totals(cells) {
  return cells.reduce((a, c) => ({
    units: a.units + Number(c.units),
    revenue: a.revenue + Number(c.revenue),
    cogs: a.cogs + Number(c.cogs),
    // How much of that cost is imputed rather than the ledger's own
    // figure. Carried so a page can say so; older payloads have no such
    // key, which reads as "none of it", the safe direction.
    cogsImputed: a.cogsImputed + (Number(c.cogs_imputed) || 0),
    lines: a.lines + Number(c.lines),
    returnUnits: a.returnUnits + Number(c.return_units),
    returnRevenue: a.returnRevenue + Number(c.return_revenue),
  }), { ...ZERO });
}

/** Derived measures. Each returns null rather than 0 when undefined, so a
 * missing value renders as an em-dash instead of a confident zero. */
export function asp(t) {
  return t.units > 0 ? t.revenue / t.units : null;
}
export function margin(t) {
  return t.revenue - t.cogs;
}
export function marginPct(t) {
  return t.revenue > 0 ? (t.revenue - t.cogs) / t.revenue : null;
}
/** A return is ERPNext's is_return credit note, not merely a negative
 * quantity. This cube reads the live feed only, where that flag is
 * always present, so there is no unknown-status case to caveat. */
export function returnRate(t) {
  return t.revenue > 0 ? t.returnRevenue / t.revenue : null;
}

/** Units per week over the months actually in scope -- NOT a forecast.
 * CONTEXT.md reserves "velocity" for the forward-looking rate that feeds
 * demand; this is the retrospective one and is called run rate everywhere
 * so the two can never be read for each other. */
export function runRate(cells) {
  const months = new Set(cells.map((c) => c.year_month)).size;
  if (!months) return null;
  return totals(cells).units / (months * (52 / 12));
}

/** Sum one measure grouped by a dimension -- the shape every donut, bar
 * and share table wants. */
export function groupBy(cells, dim, measure = 'revenue') {
  const out = new Map();
  cells.forEach((c) => {
    const k = c[dim];
    out.set(k, (out.get(k) || 0) + Number(c[measure]));
  });
  return [...out.entries()]
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
}

/** Monthly series, gap-filled across the full observed range.
 *
 * Gap-filling matters: a month with no sales must plot as zero, not as a
 * line that skips it. A skipped month reads as continuity when it is
 * actually a hole, which is the more dangerous of the two errors. */
export function monthlySeries(cells, allMonths, measure = 'revenue') {
  const by = new Map();
  cells.forEach((c) => by.set(c.year_month, (by.get(c.year_month) || 0) + Number(c[measure])));
  return allMonths.map((m) => ({ month: m, value: by.get(m) || 0 }));
}

/** Monthly series split by a dimension -- one line per country/channel. */
export function monthlySeriesBy(cells, allMonths, dim, measure = 'revenue') {
  const keys = [...new Set(cells.map((c) => c[dim]))].sort();
  return keys.map((key) => ({
    key,
    points: monthlySeries(cells.filter((c) => c[dim] === key), allMonths, measure),
  }));
}

/** Axis labels for a month series, at a density that suits the span.
 *
 * Short spans get "Mar", a year or more gets "Mar 25" -- a bare month
 * name is ambiguous the moment the window covers two of them, which at
 * 28 months of history it usually does. */
export function monthLabels(months) {
  const spansYears = months.length > 0
    && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  return months.map((m) => {
    const d = new Date(`${m}T00:00:00`);
    const mon = d.toLocaleString('en-US', { month: 'short' });
    return spansYears ? `${mon} ${String(d.getFullYear()).slice(2)}` : mon;
  });
}

export function allMonthsIn(cells) {
  return [...new Set(cells.map((c) => c.year_month))].sort();
}

/** Month-over-month and year-over-year change for a measure.
 *
 * YoY returns null when there aren't 13 months of history rather than
 * comparing against nothing -- Qatar has 8 months, so a naive YoY there
 * would invent a number. The UI says why it's absent instead of showing a
 * dash that looks like zero growth. */
export function growth(series) {
  const n = series.length;
  if (n < 2) return { mom: null, yoy: null };
  const last = series[n - 1].value;
  const prev = series[n - 2].value;
  const mom = prev > 0 ? (last - prev) / prev : null;
  let yoy = null;
  if (n >= 13) {
    const yearAgo = series[n - 13].value;
    yoy = yearAgo > 0 ? (last - yearAgo) / yearAgo : null;
  }
  return { mom, yoy };
}

// ---- order-level (no brand dimension -- see schema.sql) ----

/** Order rows carry country, channel and month but no brand, which is
 *  exactly what VIEWS.order says -- so this is the ordinary filter, not
 *  a second implementation of it. The hand-written copy this replaces
 *  had already drifted: it never learned about the drilled month, and
 *  reported full-history figures under a caption naming one month. */
export function orderScope(orders, f) {
  return scope(orders, f, VIEWS.order);
}

export function orderTotals(rows) {
  const t = rows.reduce((a, o) => ({
    orders: a.orders + Number(o.orders),
    value: a.value + Number(o.order_value),
    lines: a.lines + Number(o.order_lines),
    units: a.units + Number(o.order_units),
  }), { orders: 0, value: 0, lines: 0, units: 0 });
  return {
    ...t,
    aov: t.orders > 0 ? t.value / t.orders : null,
    basketLines: t.orders > 0 ? t.lines / t.orders : null,
    basketUnits: t.orders > 0 ? t.units / t.orders : null,
  };
}

/** One measure broken out as channel (rows) x country (columns), with
 * row and column totals -- what a KPI card expands into.
 *
 * `compute` takes the totals of a subset and returns the number, so a
 * ratio like ASP is computed PER CELL rather than summed: averaging
 * averages, or summing a ratio, would produce a figure that is wrong in
 * every cell and wrong again in the totals.
 */
export function matrix(cells, compute, { full, pickedCountries, pickedChannels } = {}) {
  // `full` keeps every market and channel in the grid whether or not the
  // current selection has rows for them. An expanded card is a fixed slot
  // in the wide layout, and a matrix that dropped a column when you
  // deselected a market made the card change height under the cursor.
  const channels = full ? CHANNELS
    : [...new Set(cells.map((c) => c.channel))].sort();
  const countries = full ? COUNTRY_KEYS
    : COUNTRY_KEYS.filter((k) => cells.some((c) => c.country === k));
  // `on` says the selection asked for this row/column. Everything keeps
  // its place in the grid either way -- that is what holds the card's
  // size -- but the caller renders the rest blank rather than filling it
  // with dashes for something the reader has just said they do not want.
  const on = (picked, k) => !picked || !picked.length || picked.includes(k);
  const at = (chs, cos) => compute(totals(cells.filter(
    (c) => (!chs || chs.includes(c.channel)) && (!cos || cos.includes(c.country)))));
  return {
    countries,
    countryOn: countries.map((co) => on(pickedCountries, co)),
    rows: channels.map((ch) => ({
      channel: ch,
      on: on(pickedChannels, ch),
      cells: countries.map((co) => at([ch], [co])),
      total: at([ch], null),
    })),
    columnTotals: countries.map((co) => at(null, [co])),
    grandTotal: at(null, null),
  };
}

/** Weeks spanned by a set of months -- the denominator for a run rate
 * over the selected horizon.
 *
 * The whole window counts, including months before an item first sold.
 * That is the honest reading of "units per week over this period": an
 * item that sold 50 in one month of a year did average ~1/week over the
 * year, and pretending otherwise would make a one-off look like a
 * steady seller. But it does mean a NEW item looks slow over a long
 * horizon, which is the reason the column names its window. */
export function weeksIn(months) {
  return months.length * (52 / 12);
}

/** Per-item run rate over the selected horizon. Not a forecast -- see
 * CONTEXT.md on why this is never called velocity. */
export function itemRunRate(item, months) {
  const w = weeksIn(months);
  return w > 0 ? Number(item.units) / w : null;
}

/** The per-country unit keys, in the app's canonical country order.
 * Generated so a new market needs a row in constants.js and nothing
 * here -- the key NAMES are unchanged, which is the API contract. */
export const COUNTRY_UNIT_KEYS = COUNTRIES.map((c) => `${c.dot}_units`);

export const ITEM_SORTS = {
  ...Object.fromEntries(COUNTRY_UNIT_KEYS.map(
    (k) => [k, (r) => Number(r[k]) || 0])),
  item_code: (r) => r.item_code || '',
  item_name: (r) => r.item_name || '',
  brand: (r) => r.brand || '',
  units: (r) => Number(r.units) || 0,
  revenue: (r) => Number(r.revenue) || 0,
  margin: (r) => (Number(r.revenue) || 0) - (Number(r.cogs) || 0),
  asp: (r) => (Number(r.units) > 0 ? Number(r.revenue) / Number(r.units) : -Infinity),
  orders: (r) => Number(r.orders) || 0,
  runRate: (r) => Number(r.units) || 0,   // monotonic in units for a fixed window
};

export function sortSalesItems(rows, sort) {
  const get = ITEM_SORTS[sort.key] || ITEM_SORTS.revenue;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a); const y = get(b);
    return dir * (typeof x === 'string' ? x.localeCompare(y) : x - y);
  });
}

const CSV_HEADERS = ['brand', 'country', 'channel', 'month', 'units', 'revenue',
                     'cogs', 'margin', 'lines', 'return_units', 'return_revenue'];

function csvCell(val) {
  if (val == null) return '';
  const s = String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ITEM_CSV_HEADERS = ['item_code', 'item_name', 'brand', 'units',
                          ...COUNTRY_UNIT_KEYS, 'run_rate',
                          'revenue', 'cogs', 'margin', 'asp', 'orders'];

export function salesItemsCsv(rows, months) {
  const w = weeksIn(months);
  const lines = rows.map((r) => {
    const u = Number(r.units) || 0;
    return [
      r.item_code, r.item_name, r.brand, u,
      ...COUNTRY_UNIT_KEYS.map((k) => r[k]),
      w > 0 ? (u / w).toFixed(3) : '',
      r.revenue, r.cogs, (Number(r.revenue) || 0) - (Number(r.cogs) || 0),
      u > 0 ? (Number(r.revenue) / u).toFixed(2) : '',
      r.orders,
    ].map(csvCell).join(',');
  });
  return [ITEM_CSV_HEADERS.join(','), ...lines].join('\n');
}

const EXT_ITEM_HEADERS = ['source', 'item_code', 'item_name', 'brand', 'units',
                          'priced_units', 'revenue', 'orders', 'first_sold', 'last_sold'];

/** One CSV per source, so a file is never a blend of the two. The source
 * is still a column, because a file separated from its filename should
 * still say what it is. */
export function extendedItemsCsv(rows, source) {
  const lines = rows.map((r) => [
    source, r.item_code, r.item_name, r.brand, r.units,
    r.priced_units, r.revenue, r.orders, r.first_sold, r.last_sold,
  ].map(csvCell).join(','));
  return [EXT_ITEM_HEADERS.join(','), ...lines].join('\n');
}

/** Share of an item's units that carried a price. Live rows are ~always
 * 1; legacy rows routinely are not, and a revenue figure standing on
 * 20% of the units is a floor rather than a total. */
/** The date range a set of item rows actually covers.
 *
 * Worth showing per table because "pre-cutover" is not a synonym for
 * "old": each country cut over on its own date, and KSA's was
 * 2026-04-23, so a Jan-2026-onward filter legitimately returns 1,814
 * legacy KSA rows. Without the span on screen that reads as a broken
 * filter rather than as recent history from a manual export. */
/** Collapse split rows into one row per item, with the split values as
 * COLUMNS rather than as separate tables.
 *
 * The endpoint returns one row per (item, split) because the aggregation
 * has to happen in SQL to be correct. Rendering that as N tables meant
 * scrolling between them to compare one SKU across markets, which is the
 * comparison people actually want. Pivoting keeps a single row per item
 * and puts the dimension side by side.
 *
 * Only UNITS are spread across columns. Revenue per split as well would
 * double the column count for a table already carrying six, and units
 * are the measure this page is built on -- values here are a secondary
 * read, so they stay as one total.
 */
export function pivotBySplit(rows, keys) {
  const out = new Map();
  rows.forEach((r) => {
    let row = out.get(r.item_code);
    if (!row) {
      row = {
        item_code: r.item_code, item_name: r.item_name, brand: r.brand,
        units: 0, revenue: 0, lines: 0, orders: 0, priced_units: 0,
        first_sold: null, last_sold: null, bySplit: {},
      };
      keys.forEach((k) => { row.bySplit[k] = 0; });
      out.set(r.item_code, row);
    }
    row.units += Number(r.units) || 0;
    row.revenue += Number(r.revenue) || 0;
    row.lines += Number(r.lines) || 0;
    row.orders += Number(r.orders) || 0;
    row.priced_units += Number(r.priced_units) || 0;
    if (r.split != null) row.bySplit[r.split] = (row.bySplit[r.split] || 0) + (Number(r.units) || 0);
    if (r.first_sold && (!row.first_sold || r.first_sold < row.first_sold)) row.first_sold = r.first_sold;
    if (r.last_sold && (!row.last_sold || r.last_sold > row.last_sold)) row.last_sold = r.last_sold;
  });
  return [...out.values()];
}

/** Sort that also understands the pivoted split columns, which are not
 * fixed fields and so cannot live in ITEM_SORTS. */
export function sortPivoted(rows, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  const get = sort.key.startsWith('split:')
    ? (r) => (r.bySplit?.[sort.key.slice(6)] || 0)
    : (ITEM_SORTS[sort.key] || ITEM_SORTS.units);
  return [...rows].sort((a, b) => {
    const x = get(a); const y = get(b);
    return dir * (typeof x === 'string' ? x.localeCompare(y) : x - y);
  });
}

export function dateSpan(rows) {
  if (!rows || !rows.length) return null;
  let lo = null; let hi = null;
  rows.forEach((r) => {
    if (r.first_sold && (!lo || r.first_sold < lo)) lo = r.first_sold;
    if (r.last_sold && (!hi || r.last_sold > hi)) hi = r.last_sold;
  });
  return lo && hi ? { from: lo, to: hi } : null;
}

export function pricedShare(r) {
  const u = Number(r.units) || 0;
  return u > 0 ? (Number(r.priced_units) || 0) / u : null;
}

