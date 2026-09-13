// Pure logic for Brand Analytics -- sibling to BrandAnalyticsPage.jsx per
// CONTEXT.md's convention (logic out of components so it stays
// independently reasoned-about and portable).
//
// This page is a JOIN of the two lenses that already exist: the sales cube
// (Sales Analytics) and the stock-health summary (Stock Analysis). It
// deliberately re-uses their math rather than re-deriving it -- computing
// GMROI or a tier value by hand here is precisely how two pages come to
// show different numbers for the same brand.
//
// TWO RULES GOVERN EVERY FIGURE ON THIS PAGE.
//
// 1. REVENUE IS CUBE REVENUE, and the stock-health figure now agrees
//    with it. Both read the `sales` table -- the live, priced ERP feed,
//    which begins at each market's cutover (UAE Sep 2025, QAT Jan 2026,
//    KSA Apr 2026).
//
//    That agreement is new and is why this note is shorter than it was.
//    stock_health_summary used to read `sales_all`, unioning a
//    pre-cutover export that left 91.4% of Distribution lines unpriced,
//    and it ran a MEDIAN 1.22x higher than the cube. Two revenues for one
//    brand meant neither could be shown beside the other. They are now
//    the same measurement and reconcile; shsRevenue is kept only so the
//    deep dive can demonstrate that, and is still never labelled
//    "revenue" twice on one screen.
//
//    Every money figure is therefore confined to the priced feed, whose
//    window differs per market -- see moneyWindows below.
//
// 2. RATIO BASIS SPLITS ON MONEY vs UNITS, because legacy data is
//    unreliable for money ONLY -- its quantities are sound, and that is
//    the whole reason sales_extended_cube exists as a units-only table.
//
//      GMROI and stock turn (cost)  -> RECOMPUTED here from the cube.
//        Not because the precomputed ones are wrong any more -- they were
//        (one brand's GMROI read negative against a real figure near
//        zero, from a brand-wide blended cost rate applied to a mix
//        that never sold, and the
//        remaining gap from unpriced legacy revenue), and both defects are
//        fixed at the source. They are recomputed because the precomputed
//        figure is one number per brand and cannot follow this page's
//        country, channel and period filters. Same formula, same inputs,
//        narrower scope.
//
//      Sell-through and stock turn (units) -> TAKEN AS GIVEN from
//        stock_health_summary. Both are units divided by units.
//        Recomputing them on the live feed would shorten the numerator's
//        history while the receipts denominator kept its own, which is a
//        worse number, not a better one. These two match Stock Analysis
//        exactly, by construction.
import { COUNTRIES } from '../../lib/constants.js';
import { fmtCurrency, fmtCurrencyCompact, fmtNum } from '../../lib/format.js';
import {
  CHANNELS, totals, asp, margin, marginPct, returnRate,
  groupBy, monthlySeries, allMonthsIn, monthLabels,
} from '../sales/salesData.js';
import {
  brandValue, brandUnits, brandTierStats, brandStockouts, brandSold,
  atRiskFrom, sortBrands, TIER_ORDER, TIER_TONE, TIER_SHADE,
} from '../stock-analysis/stockHealthData.js';

export { CHANNELS, monthLabels, TIER_ORDER, TIER_TONE, TIER_SHADE };
export const COUNTRY_KEYS = COUNTRIES.map((c) => c.key);

/** At most four brands compare legibly as columns, and there are four
 * colour slots to match. A slot means "column 2", not a brand -- the
 * colour is positional, which is why these are deliberately lower chroma
 * than the market hues and can never be read as a signal. */
export const MAX_PICKED = 4;
export const BRAND_SLOTS = ['brand-a', 'brand-b', 'brand-c', 'brand-d'];

/** The population a median is worth computing over.
 *
 * 114 of 188 brands hold under AED 50k of stock. A median across all of
 * them sits near zero and every real brand reads as "three times the
 * portfolio", which is a benchmark that flatters everything and settles
 * nothing. Material is the same cut the leaderboard defaults to, so the
 * table and the benchmark beside it always describe one set of brands. */
export const MATERIAL = { stockValue: 50000, revenue: 100000 };

// ---------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------

/** Which cube months can actually be compared, and what was dropped.
 *
 * Two months at the ends of the cube are not months:
 *
 *   - the NEWEST is the one in progress. The pipeline reloads nightly, so
 *     the current month is always partial and always low. Plotted, it
 *     draws a cliff that has not happened.
 *   - the OLDEST is a cutover stub. The UAE feed became authoritative on
 *     26 September 2025, so that month holds four days of trading.
 *
 * Both are derived rather than hardcoded: the newest month is always
 * partial by definition, and a leading month far below the median of the
 * rest is a stub. Hardcoding the date would silently start lying the
 * moment the cube grew a month at either end. */
export function usablePeriod(cells) {
  const all = allMonthsIn(cells);
  if (all.length < 3) return { months: all, partial: null, stub: null };
  const partial = all[all.length - 1];
  const body = all.slice(0, -1);
  const revBy = new Map();
  cells.forEach((c) => revBy.set(c.year_month, (revBy.get(c.year_month) || 0) + Number(c.revenue)));
  const med = medianOfValues(body.map((m) => revBy.get(m) || 0));
  const stub = med > 0 && (revBy.get(body[0]) || 0) < med * 0.25 ? body[0] : null;
  return { months: stub ? body.slice(1) : body, partial, stub };
}

/** The last `size` months of a usable period. */
export function windowMonths(months, size) {
  return size && size < months.length ? months.slice(-size) : months;
}

/** The first month a market has priced revenue, observed portfolio-wide.
 *
 * Portfolio-wide on purpose: a brand that simply does not sell in Saudi
 * must not be treated as a cutover case, and a per-brand reading would do
 * exactly that. */
export function firstPricedMonth(cells, country) {
  let first = null;
  cells.forEach((c) => {
    if (c.country !== country || Number(c.revenue) <= 0) return;
    if (first === null || c.year_month < first) first = c.year_month;
  });
  return first;
}

// ---------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------

/** Empty array ALWAYS means "no filter, everything" -- never "nothing
 * selected therefore no data". Same convention as Sales Analytics and
 * Stock Analysis, deliberately, so the three pages behave identically. */
export function scopeCells(cells, { brands, countries, channels, months } = {}) {
  return cells.filter((c) => (
    (!brands?.length || brands.includes(c.brand))
    && (!countries?.length || countries.includes(c.country))
    && (!channels?.length || channels.includes(c.channel))
    && (!months?.length || months.includes(c.year_month))
  ));
}

// ---------------------------------------------------------------------
// Medians
// ---------------------------------------------------------------------

// stockHealthData.js has an equivalent but does not export it, and
// reaching into another page's private helper is how a change over there
// silently breaks this page.
function medianOfValues(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function medianOf(rows, key) {
  return medianOfValues(rows.map((r) => r[key]));
}

// ---------------------------------------------------------------------
// The join
// ---------------------------------------------------------------------

/** One flat row per brand, over the UNION of both sources.
 *
 * A full outer join, because the two populations genuinely differ: 8
 * brands sell but hold no stock anywhere (stock health drops items with
 * zero stock in every country), and 51 hold stock but have no priced
 * sales. A missing side is null and renders as an em-dash -- never 0,
 * which would sort a sold-out brand to the bottom of a stock ranking as
 * though it were the worst performer rather than absent.
 *
 * Every derived measure is materialised as a flat field so one sort
 * comparator, one median and one CSV can all read the same object. */
export function joinBrands(cells, summary, filters = {}) {
  const { countries, channels, months } = filters;
  const scoped = scopeCells(cells, { countries, channels, months });
  const byBrand = new Map();
  scoped.forEach((c) => {
    if (!byBrand.has(c.brand)) byBrand.set(c.brand, []);
    byBrand.get(c.brand).push(c);
  });
  const stockBy = new Map((summary || []).map((b) => [b.brand, b]));

  const names = new Set([...byBrand.keys(), ...stockBy.keys()]);
  const rows = [...names].map((brand) => {
    const bc = byBrand.get(brand) || [];
    const sh = stockBy.get(brand) || null;
    const t = totals(bc);
    const inCube = bc.length > 0;
    const inStock = sh != null;

    const stockValue = inStock ? brandValue(sh, countries) : null;
    const stockUnits = inStock ? brandUnits(sh, countries) : null;
    const risk = inStock ? atRiskFrom(sh, countries) : null;
    const sold = inStock ? brandSold(sh, countries) : null;
    const marginAed = inCube ? margin(t) : null;

    // Money ratios, recomputed on the live feed -- see rule 2 above.
    const denom = stockValue && stockValue > 0 ? stockValue : null;
    return {
      brand,
      inCube,
      inStock,
      // --- sales (cube, priced feed) ---
      revenue: inCube ? t.revenue : null,
      units: inCube ? t.units : null,
      cogs: inCube ? t.cogs : null,
      marginAed,
      marginPct: inCube ? marginPct(t) : null,
      asp: inCube ? asp(t) : null,
      returnRate: inCube ? returnRate(t) : null,
      // --- stock (current position) ---
      stockValue,
      stockUnits,
      skuCount: inStock ? sh.sku_count : null,
      atRiskValue: risk ? risk.value : null,
      atRiskCount: risk ? risk.count : null,
      atRiskPct: risk && denom ? risk.value / denom : null,
      stockouts: inStock ? brandStockouts(sh, countries) : null,
      // --- efficiency ---
      gmroi: marginAed != null && denom ? marginAed / denom : null,
      turnCost: inCube && denom ? t.cogs / denom : null,
      turnUnits: inStock ? sh.turnover_ratio : null,
      sellThrough: inStock ? sh.sell_through_pct : null,
      revPerSku: inCube && inStock && sh.sku_count > 0 ? t.revenue / sh.sku_count : null,
      valuePerSku: inStock && sh.sku_count > 0 ? stockValue / sh.sku_count : null,
      // --- the other revenue, carried but never rendered as revenue ---
      shsRevenue: inStock ? Number(sh.l12m_revenue || 0) : null,
      shsUnitsSold: sold ? sold.units : null,
      // filled by withShares once the population total is known
      revShare: null,
      valueShare: null,
      lflPct: null,
      lflExcluded: [],
      _summary: sh,
      _cells: bc,
    };
  });
  return rows;
}

/** Shares are of the CURRENT population, not of all 188 brands -- a share
 * whose denominator is not the table it sits in is the classic silent
 * disagreement this codebase keeps warning about. */
export function withShares(rows) {
  const revTotal = rows.reduce((s, r) => s + (r.revenue || 0), 0);
  const valTotal = rows.reduce((s, r) => s + (r.stockValue || 0), 0);
  return rows.map((r) => ({
    ...r,
    revShare: revTotal > 0 && r.revenue != null ? r.revenue / revTotal : null,
    valueShare: valTotal > 0 && r.stockValue != null ? r.stockValue / valTotal : null,
  }));
}

export function population(rows, kind) {
  if (kind === 'all') return rows;
  if (kind === 'stocked') return rows.filter((r) => (r.stockValue || 0) > 0);
  return rows.filter((r) => (r.stockValue || 0) >= MATERIAL.stockValue
    || (r.revenue || 0) >= MATERIAL.revenue);
}

// ---------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------

/** Which measures a median means something for, and which it does not.
 *
 * A median is meaningful for a RATIO -- "this brand turns its stock more
 * slowly than half the portfolio" is a judgement. It is meaningless for a
 * TOTAL: the median of a revenue column is just the middle-sized brand,
 * so a large brand reads as "14x the benchmark" for no reason other than
 * being large, which the leaderboard already ranks by. Totals therefore
 * show the portfolio TOTAL and the brand's share of it, in the same
 * column, under a header that says which of the two it is. */
export const RATIO_KEYS = [
  'marginPct', 'returnRate', 'asp', 'gmroi', 'turnCost', 'turnUnits',
  'sellThrough', 'atRiskPct', 'revPerSku', 'valuePerSku', 'lflPct',
];
export const TOTAL_KEYS = [
  'revenue', 'units', 'marginAed', 'stockValue', 'stockUnits',
  'skuCount', 'atRiskValue', 'stockouts',
];

/** Higher is better for most ratios; for these it is not. Drives which
 * way the vs-median chip is toned, and getting it backwards would praise
 * a brand for holding dead stock. */
const LOWER_IS_BETTER = new Set(['returnRate', 'atRiskPct']);

/** Measures that can be NEGATIVE, where a ratio is not a comparison.
 *
 * Growth is the case: -18.1% against a portfolio median of -24.5% is a
 * brand doing BETTER than the portfolio, but the ratio of the two is
 * 0.74, which renders as "74%" and reads as worse. Dividing signed
 * numbers by each other is meaningless -- two negatives give a positive,
 * and a sign change gives a negative multiple. These compare by
 * DIFFERENCE in percentage points instead. */
const SIGNED = new Set(['lflPct']);

export function benchmark(rows) {
  const medians = {};
  RATIO_KEYS.forEach((k) => { medians[k] = medianOf(rows, k); });
  const totalsBy = {};
  TOTAL_KEYS.forEach((k) => {
    totalsBy[k] = rows.reduce((s, r) => s + (r[k] || 0), 0);
  });
  return { medians, totals: totalsBy, n: rows.length };
}

/** How a value sits against the median. Null when either side is missing
 * -- a brand with no stock has no turn, and inventing one as 0 would rank
 * it as the worst in the portfolio rather than absent. */
export function vsMedian(value, med, key) {
  if (value == null || med == null) return null;
  if (SIGNED.has(key)) {
    const points = (value - med) * 100;
    if (!Number.isFinite(points)) return null;
    return {
      signed: true,
      points,
      // Two points either way is noise at this sample size.
      tone: Math.abs(points) < 2 ? null : (points > 0 ? 'steady' : 'crit'),
    };
  }
  if (med === 0) return null;
  const ratio = value / med;
  const better = LOWER_IS_BETTER.has(key) ? ratio < 1 : ratio > 1;
  const far = Math.abs(Math.log(Math.abs(ratio) || 1)) > Math.log(1.15);
  return { ratio, tone: far ? (better ? 'steady' : 'crit') : null };
}

// ---------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------

const LFL_MONTHS = 3;

/** Which markets cannot appear in a like-for-like comparison.
 *
 * The staggered cutovers make a naive comparison wrong in a known
 * direction: Saudi's priced feed begins in April 2026, so a brand selling
 * there "grew" in May purely because its market's data started. Any
 * market whose first priced month falls inside the PRIOR window is
 * excluded from BOTH sides, and the UI names it.
 *
 * This depends only on the market, never on the brand, so it is computed
 * once for the whole table rather than inside the per-brand loop. */
export function excludedMarkets(cells, months, filters = {}) {
  const wanted = filters.countries?.length ? filters.countries : COUNTRY_KEYS;
  if (months.length < LFL_MONTHS * 2) return wanted;
  const priorStart = months[months.length - LFL_MONTHS * 2];
  return wanted.filter((c) => {
    const first = firstPricedMonth(cells, c);
    return first == null || first > priorStart;
  });
}


/** The per-market money windows in scope, when they differ.
 *
 * Cost of sale comes from the stock ledger, which begins at each market's
 * cutover, so every money figure is confined to the priced feed on both
 * sides -- and that feed starts on a different date in each market. A
 * "12-month" revenue is currently about 11 months of UAE, 8 of Qatar and
 * 5 of Saudi, so comparing markets on one is misleading by construction
 * however clean each side is.
 *
 * Returns null when the scope cannot mislead -- one market, or several
 * that happen to share a start -- so the mark is silent except where a
 * comparison is actually being drawn. Derived from the cube, never from
 * the cutover constant: KSA's declared cutover is 21 days later than its
 * data actually starts, and a market opening next year has no constant
 * to declare at all.
 *
 * Same shape and same reasoning as excludedMarkets above; that one guards
 * a growth comparison, this one guards every money figure on the page. */
/** What share of the cost in scope is the ERP's own figure rather than
 * an imputation. Null when there is no cost to describe.
 *
 * Stated because the two are different claims: cost from the stock ledger
 * is what the goods actually cost when they left, and an imputation is
 * units at the item's CURRENT rate. Measured on the lines where both
 * exist, the imputation is out by 0.4% -- small, but not nothing, and not
 * something a reader should have to already know. */
export function ledgerCostShare(cells) {
  const t = totals(cells);
  if (!t.cogs) return null;
  return (t.cogs - t.cogsImputed) / t.cogs;
}

export function moneyWindows(cells, months, filters = {}) {
  const wanted = filters.countries?.length ? filters.countries : COUNTRY_KEYS;
  const rows = wanted
    .map((country) => ({ country, first: firstPricedMonth(cells, country) }))
    .filter((r) => r.first != null);
  if (rows.length < 2) return null;
  const distinct = new Set(rows.map((r) => r.first));
  if (distinct.size < 2) return null;
  const last = months[months.length - 1];
  return rows
    .map((r) => ({
      country: r.country,
      from: r.first,
      months: months.filter((m) => m >= r.first && m <= last).length,
    }))
    .sort((a, b) => a.from.localeCompare(b.from));
}

/** Cells bucketed by brand, so a per-brand pass does not rescan the cube.
 * Built once per filter change and shared by every row. */
export function bucketByBrand(cells) {
  const out = new Map();
  cells.forEach((c) => {
    const list = out.get(c.brand);
    if (list) list.push(c); else out.set(c.brand, [c]);
  });
  return out;
}

/** Like-for-like revenue growth, last three usable months against the
 * three before, over the markets that existed in both.
 *
 * Returns null rather than Infinity when the prior figure is zero -- a
 * brand going from nothing to something has no percentage. */
export function lflGrowth(brandCells, months, excluded, filters = {}) {
  if (months.length < LFL_MONTHS * 2) return { pct: null, excluded, basis: [] };
  const wanted = filters.countries?.length ? filters.countries : COUNTRY_KEYS;
  const eligible = wanted.filter((c) => !excluded.includes(c));
  if (!eligible.length) return { pct: null, excluded, basis: eligible };
  const recent = new Set(months.slice(-LFL_MONTHS));
  const prior = new Set(months.slice(-LFL_MONTHS * 2, -LFL_MONTHS));
  const chans = filters.channels;
  let a = 0;
  let b = 0;
  (brandCells || []).forEach((c) => {
    if (!eligible.includes(c.country)) return;
    if (chans?.length && !chans.includes(c.channel)) return;
    if (prior.has(c.year_month)) a += Number(c.revenue);
    else if (recent.has(c.year_month)) b += Number(c.revenue);
  });
  return { pct: a > 0 ? (b - a) / a : null, excluded, basis: eligible };
}

export function withGrowth(rows, cells, months, filters = {}) {
  const excluded = excludedMarkets(cells, months, filters);
  const buckets = bucketByBrand(cells);
  return rows.map((r) => {
    const g = lflGrowth(buckets.get(r.brand), months, excluded, filters);
    return { ...r, lflPct: g.pct, lflExcluded: g.excluded };
  });
}

// ---------------------------------------------------------------------
// Series and mixes
// ---------------------------------------------------------------------

/** Shaped exactly for SalesTrendChart: `series` keyed by brand, `keys`
 * carrying the {key,label,dot} triple it wants. The dot is positional --
 * BRAND_SLOTS[i] -- and must resolve to a real --mkt-* token, because an
 * undefined custom property makes a stroke `none`, which is an invisible
 * line rather than an error. */
export function brandSeries(cells, brands, months, measure = 'revenue', filters = {}) {
  const series = {};
  brands.forEach((b) => {
    const bc = scopeCells(cells, {
      brands: [b], countries: filters.countries, channels: filters.channels, months,
    });
    series[b] = monthlySeries(bc, months, measure).map((p) => p.value);
  });
  return {
    series,
    keys: brands.map((b, i) => ({ key: b, label: b, dot: BRAND_SLOTS[i % BRAND_SLOTS.length] })),
  };
}

/** Tier composition by VALUE, ordered worst-last, for the mix bars. */
export function brandTierMix(summaryRow, countries) {
  if (!summaryRow) return [];
  const stats = brandTierStats(summaryRow, countries);
  const total = Object.values(stats).reduce((s, v) => s + v.value, 0);
  return TIER_ORDER
    .filter((t) => stats[t] && stats[t].value > 0)
    .map((tier) => ({
      tier,
      value: stats[tier].value,
      count: stats[tier].count,
      share: total > 0 ? stats[tier].value / total : 0,
      tone: TIER_TONE[tier],
      shade: TIER_SHADE[tier],
    }));
}

/** Revenue split by a cube dimension, as shares, for the small bars. */
export function brandSplit(cells, brand, dim, months, filters = {}) {
  const bc = scopeCells(cells, {
    brands: [brand], countries: filters.countries, channels: filters.channels, months,
  });
  const rows = groupBy(bc, dim, 'revenue');
  const total = rows.reduce((s, r) => s + r.value, 0);
  return rows.map((r) => ({ ...r, share: total > 0 ? r.value / total : 0 }));
}

// ---------------------------------------------------------------------
// Table model
// ---------------------------------------------------------------------

// TODO: this column descriptor, sortLeaderboard and the row model below
// are the generalisation the brand tables in SalesAnalyticsPage and
// SalesExtendedPage would both want. Left page-local on purpose for now
// -- extracting it means touching two shipped pages in the same change as
// a new data join. Lift to components/BrandTable.jsx once this has run.
export const LEADERBOARD_COLUMNS = [
  { key: 'revenue', label: 'Revenue', group: 'Sales', kind: 'money' },
  { key: 'revShare', label: 'Rev share', group: 'Sales', kind: 'pct' },
  { key: 'units', label: 'Units', group: 'Sales', kind: 'num' },
  { key: 'marginPct', label: 'Margin', group: 'Sales', kind: 'pct' },
  { key: 'lflPct', label: 'LFL 3m Δ', group: 'Sales', kind: 'delta' },
  { key: 'stockValue', label: 'Stock value', group: 'Stock', kind: 'money' },
  { key: 'valueShare', label: 'Val share', group: 'Stock', kind: 'pct' },
  { key: 'skuCount', label: 'SKUs', group: 'Stock', kind: 'num' },
  { key: 'atRiskValue', label: 'At risk', group: 'Stock', kind: 'money' },
  { key: 'atRiskPct', label: 'At risk %', group: 'Stock', kind: 'pct' },
  { key: 'turnCost', label: 'Turn', group: 'Efficiency', kind: 'ratio' },
  { key: 'gmroi', label: 'GMROI', group: 'Efficiency', kind: 'ratio' },
  { key: 'sellThrough', label: 'Sell-thru', group: 'Efficiency', kind: 'pctRaw' },
  { key: 'stockouts', label: 'Outs', group: 'Efficiency', kind: 'num' },
];

export function sortLeaderboard(rows, sort) {
  return sortBrands(rows, sort);
}

/** The versus matrix, as rows of measures against columns of brands.
 *
 * Grouped by lens so a reader can see which source each block comes from,
 * and each row carries the label its basis requires -- the labelling is
 * part of the model, not something a component remembers to add. */
export function versusRows() {
  return [
    { group: 'Sales', note: 'priced ERP feed, from each market cutover', rows: [
      { key: 'revenue', label: 'Revenue', kind: 'money' },
      { key: 'units', label: 'Units', kind: 'num' },
      { key: 'marginAed', label: 'Gross margin', kind: 'money' },
      { key: 'marginPct', label: 'Margin rate', kind: 'pct' },
      { key: 'asp', label: 'Revenue per unit', kind: 'money' },
      { key: 'returnRate', label: 'Return rate', kind: 'pct' },
      { key: 'lflPct', label: 'LFL 3m Δ', kind: 'delta' },
    ] },
    { group: 'Stock', note: 'current position — a snapshot, not a trend', rows: [
      { key: 'stockValue', label: 'Stock at cost', kind: 'money' },
      { key: 'stockUnits', label: 'Stock units', kind: 'num' },
      { key: 'skuCount', label: 'SKUs', kind: 'num' },
      { key: 'atRiskValue', label: 'Dead + critical', kind: 'money' },
      { key: 'atRiskPct', label: 'Dead + critical %', kind: 'pct' },
      { key: 'stockouts', label: 'Stock-outs', kind: 'num' },
      { key: 'valuePerSku', label: 'Value per SKU', kind: 'money' },
    ] },
    { group: 'Efficiency', note: 'money ratios on the priced feed; unit ratios on the full record', rows: [
      { key: 'turnCost', label: 'Stock turn (cost)', kind: 'ratio', basis: 'priced' },
      { key: 'turnUnits', label: 'Stock turn (units)', kind: 'ratio', basis: 'full' },
      { key: 'gmroi', label: 'GMROI', kind: 'ratio', basis: 'priced' },
      { key: 'sellThrough', label: 'Sell-through', kind: 'pctRaw', basis: 'full' },
      { key: 'revPerSku', label: 'Revenue per SKU', kind: 'money', basis: 'priced' },
    ] },
  ];
}

export function isRatio(key) {
  return RATIO_KEYS.includes(key);
}

/** One measure, formatted for its kind. Null renders as an em-dash, never
 * as 0 -- the difference between "this brand has no stock" and "this
 * brand has no stock left" is the whole point of the outer join. */
export function formatMeasure(value, kind, currency = 'AED') {
  if (value == null || Number.isNaN(value)) return '\u2014';
  switch (kind) {
    case 'money': return fmtCurrency(value, currency);
    case 'moneyCompact': return fmtCurrencyCompact(value, currency);
    case 'num': return fmtNum(value);
    case 'pct': return `${(value * 100).toFixed(1)}%`;
    case 'pctRaw': return `${Number(value).toFixed(1)}%`;
    case 'delta': return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
    case 'ratio': return Number(value).toFixed(2);
    default: return String(value);
  }
}
