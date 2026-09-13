// =========================================================
// One item's month-end stock as a chart series -- the mirror panel's
// data.
//
// Deliberately NOT reusing salesData's monthlySeries, which gap-fills
// with zero. That is right for sales (a month with no sales sold
// nothing) and wrong for stock in one specific place: a month below a
// market's floor is stock we never counted, not stock we know was
// absent. Zero there draws a restocking ramp that never happened, so
// this gap-fills with null below the floor and zero above it.
//
// Above the floor zero IS the right fill: stock_snapshots_monthly does
// not store zero balances, so a missing row above the floor means the
// shelf was genuinely empty.
// =========================================================

/** One series per market over `allMonths`, summing `measure`.
 *
 * `countries` is the page's market filter; an empty or absent list means
 * all. There is no channel argument and no brand argument on purpose --
 * stock sits in a warehouse, not a sales channel, and this is only ever
 * drawn for a single selected item, so there is nothing to aggregate.
 *
 * Each market carries its own floor, so a market still being onboarded
 * is blank rather than flat at zero while the others plot normally. */
export function itemStockSeries(points, allMonths, measure, floors, countries) {
  const rows = (points || []).filter(
    (p) => !countries?.length || countries.includes(p.country));
  const keys = [...new Set(rows.map((p) => p.country))].filter(Boolean).sort();

  const series = {};
  keys.forEach((key) => {
    const floor = floors?.[key] ?? null;
    const by = new Map();
    rows.filter((p) => p.country === key).forEach((p) => {
      by.set(p.year_month, (by.get(p.year_month) || 0) + Number(p[measure] || 0));
    });
    series[key] = allMonths.map((m) => {
      // No floor at all means this market's stock has never been
      // counted, so every month of it is unknown rather than empty.
      if (!floor || m < floor) return null;
      return by.get(m) || 0;
    });
  });
  return { series, keys };
}
