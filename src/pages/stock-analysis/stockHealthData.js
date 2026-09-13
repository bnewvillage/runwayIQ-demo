// Pure logic for Stock Analysis -- sibling to StockAnalysisPage.jsx per
// CONTEXT.md's convention (logic out of components so it stays
// independently reasoned-about and portable).
import { COUNTRIES } from '../../lib/constants.js';

// Health tiers, in the same order the backend defines them (worst-case
// order for a purchasing read: fast_mover first, dead_stock last). Kept
// here as a fallback shape only -- the real labels/descriptions always
// come from GET /stock-health/tiers, never hardcoded, same reasoning as
// HORIZONS on Forecast Analytics.
export const TIER_ORDER = [
  'fast_mover', 'active', 'slow_mover', 'aging', 'critical', 'new_stock', 'dead_stock',
  // Last because it is not a severity -- it is the absence of a
  // verdict. Reached only where there is no evidence the item was ever
  // in that country, or the market has no sales record at all. Empty
  // today, and kept because a market on its opening day genuinely has
  // nothing to check against.
  'undetermined',
];

// Four tones, not seven -- this app's signal colours are deliberately
// scarce (see styles.css: "these four are the ONLY colours that carry
// meaning"). Grouping the seven tiers onto that same four-colour vocabulary
// keeps Stock Analysis speaking the same visual language as the runway bar
// and freshness badge rather than inventing a fifth palette:
//   steady (green)  -- genuinely healthy, selling normally
//   caution (amber) -- slowing down, worth watching
//   crit (red)      -- the two tiers a purchaser should act on
//   info (blue)     -- new_stock specifically: not bad, just not yet
//                       judgeable -- a different KIND of "not green",
//                       not a lesser degree of the same warning.
export const TIER_TONE = {
  fast_mover: 'steady', active: 'steady',
  slow_mover: 'caution', aging: 'caution',
  critical: 'crit', dead_stock: 'crit',
  // info, not crit: "we cannot say yet" is the same kind of statement
  // as new_stock's "too new to judge", and colouring it red would put
  // a missing answer in the palette reserved for findings.
  new_stock: 'info', undetermined: 'info',
};

// Three of the four tones are shared by two tiers each, and those pairs
// sit adjacent in TIER_ORDER (nothing else separates them), so on the
// donut and mix bars they visually merge into one blob of colour -- the
// exact "not easily distinguishable" complaint. Rather than adding a
// fifth-plus hue (breaking the "four colours carry meaning" rule), the
// second/worse tier in each pair renders dimmer: same hue (still reads
// as the same tone at a glance), but a perceptibly different shade up
// close. new_stock is alone in its tone, so it stays full-strength.
export const TIER_SHADE = {
  fast_mover: 1, active: 0.55,
  slow_mover: 1, aging: 0.55,
  critical: 1, dead_stock: 0.55,
  new_stock: 1, undetermined: 0.55,
};

export function sortBrands(brands, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...brands].sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x == null && y == null) return 0;
    if (x == null) return 1;   // nulls (e.g. no turnover data) sort last regardless of direction
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return dir * c;
  });
}

/** Share of the catalog's total stock value this brand represents --
 * drives the bar-length in the brand table, same "physical proportion"
 * idea as the runway bar. */
export function valueShare(brand, totalValue) {
  return totalValue > 0 ? brand.stock_value / totalValue : 0;
}

/** dead_stock + new_stock's sibling tiers rolled into one "needs a
 * decision" count for the brand-row summary line -- critical and
 * dead_stock specifically, not the whole caution band, since aging/
 * slow_mover are still selling and don't need one. */
export function atRiskCount(tierCounts) {
  return (tierCounts.critical || 0) + (tierCounts.dead_stock || 0);
}

export function atRiskValue(brand) {
  const risk = atRiskCount(brand.tier_counts);
  const total = Object.values(brand.tier_counts).reduce((s, n) => s + n, 0);
  return total > 0 ? brand.stock_value * (risk / total) : 0;
}

// --------------------------------------------------------------------
// Scoping -- the redesigned page lets a brand and/or a country apply as
// independent, stackable filters, and every visual (KPI strip, donut,
// country chart, left list) re-scopes to whatever's currently selected.
// These helpers compute one consistent {value, tierCounts, atRiskValue,
// skuCount} shape for either scope level (whole-catalog `summary` rows,
// or one brand's `compute_brand_stock_health` item rows) so the
// component doesn't duplicate the aggregation logic per visual.
// --------------------------------------------------------------------

/** Every scoping helper below reads ONE nested source: country_tier_stats,
 * shaped {country: {tier: {count, units, value}}}. It replaced three
 * parallel fields (country_value / country_units / country_tier_counts)
 * that were all projections of it -- and, crucially, made tier-filtered
 * VALUE derivable. Counts alone can't answer "what is the Critical stock
 * in UAE worth", which is exactly what BI-style cross-filtering needs.
 *
 * Empty selection always means "no filter, everything" -- never "nothing
 * selected therefore zero".
 */
const ALL_COUNTRIES = COUNTRIES.map((c) => c.key);

function cells(brand, countries, tiers) {
  const cs = countries && countries.length ? countries : ALL_COUNTRIES;
  const out = [];
  cs.forEach((c) => {
    const perTier = brand.country_tier_stats?.[c] || {};
    const ts = tiers && tiers.length ? tiers : Object.keys(perTier);
    ts.forEach((t) => { if (perTier[t]) out.push(perTier[t]); });
  });
  return out;
}

export function brandValue(brand, countries, tiers) {
  return cells(brand, countries, tiers).reduce((s, x) => s + x.value, 0);
}

export function brandUnits(brand, countries, tiers) {
  return cells(brand, countries, tiers).reduce((s, x) => s + x.units, 0);
}

/** Deliberately NOT tier-filtered: this feeds the treemap, which is the
 * tier selector itself. Narrowing it to the selected tier would collapse
 * the map to a single rectangle -- selection is shown by outline and
 * dimming instead, so the distribution stays readable while filtered. */
export function brandTierCounts(brand, countries) {
  const cs = countries && countries.length ? countries : ALL_COUNTRIES;
  const out = {};
  cs.forEach((c) => {
    Object.entries(brand.country_tier_stats?.[c] || {}).forEach(([tier, v]) => {
      out[tier] = (out[tier] || 0) + v.count;
    });
  });
  return out;
}

/** All three measures per tier, so the treemap can be sized by SKU count,
 * units or value without a second data source. They answer genuinely
 * different questions and can disagree sharply: dead stock is usually a
 * large share of SKU COUNT but a much smaller share of VALUE (lots of
 * cheap stragglers), while one expensive slow-moving line can dominate
 * value while barely registering as a count. */
export function brandTierStats(brand, countries) {
  const cs = countries && countries.length ? countries : ALL_COUNTRIES;
  const out = {};
  cs.forEach((c) => {
    Object.entries(brand.country_tier_stats?.[c] || {}).forEach(([tier, v]) => {
      if (!out[tier]) out[tier] = { count: 0, units: 0, value: 0 };
      out[tier].count += v.count;
      out[tier].units += v.units;
      out[tier].value += v.value;
    });
  });
  return out;
}

export function sumTierStats(list) {
  const out = {};
  list.forEach((ts) => Object.entries(ts || {}).forEach(([tier, v]) => {
    if (!out[tier]) out[tier] = { count: 0, units: 0, value: 0 };
    out[tier].count += v.count;
    out[tier].units += v.units;
    out[tier].value += v.value;
  }));
  return out;
}

/** Units/revenue sold, narrowed by country only. Sales cannot be
 * attributed to a health tier -- an item's tier is DERIVED from its sales
 * history -- so tier-filtering this would be circular. Turnover is
 * therefore country-scoped but never tier-scoped, and the UI says so. */
export function brandStockouts(brand, countries) {
  const cs = countries && countries.length ? countries : ALL_COUNTRIES;
  return cs.reduce((n, c) => n + (brand.country_stockouts?.[c] || 0), 0);
}

/** Units, revenue and COGS sold in the trailing year, country-scoped.
 *
 * COGS rides along with the other two rather than being derived here:
 * the pipeline sums it per sales line at each item's own cost, and any
 * attempt to rebuild it from brand totals reintroduces a blended rate.
 * Older payloads have no cogs key, so it falls back to 0 rather than
 * NaN -- an API this page is several deploys ahead of is the normal
 * case, not an error. */
export function brandSold(brand, countries) {
  const cs = countries && countries.length ? countries : ALL_COUNTRIES;
  return cs.reduce((acc, c) => {
    const v = brand.country_sold?.[c] || { units: 0, revenue: 0, cogs: 0 };
    return {
      units: acc.units + v.units,
      revenue: acc.revenue + v.revenue,
      cogs: acc.cogs + (v.cogs || 0),
    };
  }, { units: 0, revenue: 0, cogs: 0 });
}

export function sumTierCounts(list) {
  const out = {};
  list.forEach((tc) => Object.entries(tc || {}).forEach(([tier, n]) => {
    out[tier] = (out[tier] || 0) + n;
  }));
  return out;
}

export function tierTotal(tierCounts) {
  return Object.values(tierCounts || {}).reduce((s, n) => s + n, 0);
}

// The tiers that count as capital at risk. One definition, because
// this was written out twice in this file -- once as a cells() filter and
// once as an inline OR eighty lines below -- and the figure it produces
// just moved from AED 2.67m to 11.27m. Two copies of a policy that both
// still return *a* number is how they drift unnoticed.
export const AT_RISK_TIERS = ['critical', 'dead_stock'];

/** At-risk = critical + dead. Country-scoped but not tier-scoped: it
 * describes the mix being displayed, so narrowing it by the selected tier
 * would make it either the entire figure or zero -- which is exactly why
 * it moved off the KPI row and under the treemap it describes. */
export function atRiskFrom(brand, countries) {
  const risk = cells(brand, countries, AT_RISK_TIERS);
  return {
    value: risk.reduce((s, x) => s + x.value, 0),
    count: risk.reduce((s, x) => s + x.count, 0),
  };
}

/** Whole-catalog scope (no brand selected), narrowed by any combination
 * of countries and tiers. */
export function catalogScope(summary, countries, tiers) {
  const rows = summary || [];
  const tierCounts = sumTierCounts(rows.map((b) => brandTierCounts(b, countries)));
  const tierStats = sumTierStats(rows.map((b) => brandTierStats(b, countries)));
  const value = rows.reduce((s, b) => s + brandValue(b, countries, tiers), 0);
  const units = rows.reduce((s, b) => s + brandUnits(b, countries, tiers), 0);
  const sold = rows.reduce((acc, b) => {
    const v = brandSold(b, countries);
    return {
      units: acc.units + v.units,
      revenue: acc.revenue + v.revenue,
      cogs: acc.cogs + v.cogs,
    };
  }, { units: 0, revenue: 0, cogs: 0 });
  const atRisk = rows.reduce((acc, b) => {
    const v = atRiskFrom(b, countries);
    return { value: acc.value + v.value, count: acc.count + v.count };
  }, { value: 0, count: 0 });
  const skuCount = rows.reduce(
    (s, b) => s + cells(b, countries, tiers).reduce((n, x) => n + x.count, 0), 0);
  const received = rows.reduce((s, b) => s + (b.l12m_units_received || 0), 0);
  // Denominator spans all tiers, matching a numerator that likewise
  // can't be tier-attributed.
  const stockAllTiers = rows.reduce((s, b) => s + brandUnits(b, countries), 0);
  const valueAllTiers = rows.reduce((s, b) => s + brandValue(b, countries), 0);
  // Summed, not derived. This used to be
  //     sold.units * (valueAllTiers / stockAllTiers)
  // which applies the average cost of the whole shelf to every unit
  // that left it -- one blended rate across helmets and chain lube.
  // Measured at catalogue scope: AED 273.35/unit against a true
  // AED 319.65, understating COGS by AED 3.26m and putting gross
  // margin at 52.6% when it is 44.6%.
  const cogs = sold.cogs;

  return {
    value, units, tierCounts, tierStats, skuCount,
    // Unfiltered by tier -- the honest denominator for "what share of
    // this mix is at risk", since atRiskValue is itself tier-agnostic.
    valueAllTiers,
    atRiskValue: atRisk.value, atRiskCount: atRisk.count,
    soldUnits: sold.units, revenue: sold.revenue,
    turnover: stockAllTiers > 0 ? sold.units / stockAllTiers : null,
    // Imputed COGS: the year's sales at each item's CURRENT unit cost,
    // never cost at time of sale -- the sales table carries revenue but
    // no cost. Costing the right MIX (this) and costing at the right
    // TIME (not this) are separate problems; only the first is solved
    // here, and the ERP stock ledger is what solves the second.
    // Shown next to Revenue so margin reads off by subtraction.
    cogs,
    sellThrough: received > 0 ? (sold.units / received) * 100 : null,
    gmroi: valueAllTiers > 0 ? (sold.revenue - cogs) / valueAllTiers : null,
    // Country-scoped, so this card follows the country filter and keeps
    // agreeing with the list it opens.
    stockouts: rows.reduce((s, b) => s + brandStockouts(b, countries), 0),
  };
}

/** Same shape as catalogScope, from a selected brand's fetched item rows.
 * Sales-derived figures (turnover, sell-through, GMROI, stockouts) are
 * NOT recomputable here -- item rows carry stock and health, never sales
 * history -- so the caller carries them over from the brand summary
 * rather than letting them silently read as zero. */
export function itemRowsScope(rows, countryKeys, countries, tiers) {
  const keys = countries && countries.length ? countries : countryKeys;
  const tierSet = tiers && tiers.length ? new Set(tiers) : null;
  let value = 0;
  let units = 0;
  let skuCount = 0;
  let atRiskValue = 0;
  let atRiskCount = 0;
  const tierCounts = {};

  (rows || []).forEach((r) => {
    keys.forEach((c) => {
      const stock = r.stock[c] || 0;
      const tier = r.health[c];
      if (stock <= 0 || !tier) return;
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      const cellValue = stock * (r.valuation_rate || 0);
      if (AT_RISK_TIERS.includes(tier)) {
        atRiskValue += cellValue;
        atRiskCount += 1;
      }
      if (tierSet && !tierSet.has(tier)) return;
      value += cellValue;
      units += stock;
      skuCount += 1;
    });
  });

  return { value, units, tierCounts, skuCount, atRiskValue, atRiskCount };
}

/** Per-country totals for the country bars, narrowed by the tier filter
 * so the bars agree with the KPI tiles above them. */
export function countryValueTotals(summary, countryKeys, tiers) {
  const out = {};
  countryKeys.forEach((c) => {
    out[c] = (summary || []).reduce((s, b) => s + brandValue(b, [c], tiers), 0);
  });
  return out;
}

export function countryUnitTotals(summary, countryKeys, tiers) {
  const out = {};
  countryKeys.forEach((c) => {
    out[c] = (summary || []).reduce((s, b) => s + brandUnits(b, [c], tiers), 0);
  });
  return out;
}

export function itemRowsCountryValueTotals(rows, countryKeys, tiers) {
  const tierSet = tiers && tiers.length ? new Set(tiers) : null;
  const out = {};
  countryKeys.forEach((c) => { out[c] = 0; });
  (rows || []).forEach((r) => countryKeys.forEach((c) => {
    if (tierSet && !tierSet.has(r.health[c])) return;
    out[c] += (r.stock[c] || 0) * (r.valuation_rate || 0);
  }));
  return out;
}

export function itemRowsCountryUnitTotals(rows, countryKeys, tiers) {
  const tierSet = tiers && tiers.length ? new Set(tiers) : null;
  const out = {};
  countryKeys.forEach((c) => { out[c] = 0; });
  (rows || []).forEach((r) => countryKeys.forEach((c) => {
    if (tierSet && !tierSet.has(r.health[c])) return;
    out[c] += (r.stock[c] || 0);
  }));
  return out;
}

// --------------------------------------------------------------------
// Squarified treemap layout (Bruls/Huizing/van Wijk), simplified to a
// single fixed orientation for the whole area rather than recomputing
// orientation per remaining rect -- a faithful full squarify recurses on
// a shrinking rect that can flip between wide and tall; with at most 7
// tiers here that refinement isn't visible, and the simpler fixed-axis
// version is a lot less code to get right. `values` must already be
// sorted descending (squarify's aspect ratios degrade badly on
// unsorted input) and only contain positive numbers.
// --------------------------------------------------------------------

function rowWorstRatio(row, length) {
  const sum = row.reduce((s, v) => s + v, 0);
  const maxV = Math.max(...row);
  const minV = Math.min(...row);
  return Math.max((length * length * maxV) / (sum * sum), (sum * sum) / (length * length * minV));
}

// `length` is the FIXED dimension a row/column fully spans -- not a
// direction label. A row spanning the full current width has row
// thickness = sum(row)/width, and its items vary along x with that
// thickness as their fixed height; a column spanning the full current
// height is the mirror image. `length` must be whichever of those two
// the caller is actually spanning, or item extents and the running
// offset stop lining up with the row's real thickness -- which is
// exactly what produced overlapping rects before this was caught.
function layoutRow(row, length, x, y, spanWidth) {
  const sum = row.reduce((s, v) => s + v, 0);
  const thickness = sum / length;
  let offset = 0;
  return row.map((v) => {
    const extent = v / thickness;
    const rect = spanWidth
      ? { x: x + offset, y, w: extent, h: thickness }
      : { x, y: y + offset, w: thickness, h: extent };
    offset += extent;
    return rect;
  });
}

export function squarify(values, x, y, w, h) {
  if (!values.length) return [];
  // Span the shorter side fully (row thickness stays close to that
  // shorter dimension, which is what keeps cells square-ish); the
  // longer side is what gets consumed as rows/columns are placed.
  const spanWidth = w <= h;
  const length = spanWidth ? w : h;

  let rects = [];
  let remaining = values.slice();
  let row = [];
  let curX = x, curY = y;

  while (remaining.length) {
    const candidateRow = [...row, remaining[0]];
    if (row.length === 0 || rowWorstRatio(row, length) >= rowWorstRatio(candidateRow, length)) {
      row = candidateRow;
      remaining = remaining.slice(1);
    } else {
      rects = rects.concat(layoutRow(row, length, curX, curY, spanWidth));
      const thickness = row.reduce((s, v) => s + v, 0) / length;
      if (spanWidth) { curY += thickness; } else { curX += thickness; }
      row = [];
    }
  }
  if (row.length) {
    rects = rects.concat(layoutRow(row, length, curX, curY, spanWidth));
  }
  return rects;
}

/** Per-SKU turnover: units sold in 12 months against units on the shelf.
 * Above 1 means the item turned over more than once. null when there's no
 * stock to divide by -- an item that's out of stock has no turnover, which
 * is different from a turnover of zero. */
export function itemTurnover(row) {
  const stock = COUNTRIES.reduce((s, c) => s + (row.stock[c.key] || 0), 0);
  if (!stock) return null;
  return (row.l12m_sold || 0) / stock;
}

/** Per-SKU sell-through: units sold against units received, same window.
 * Unlike the brand-level tile, this one IS matched item to item -- which
 * is exactly the flaw the brand figure carries and this one doesn't.
 * null when nothing was received, since "sold 5 of the 0 we brought in"
 * has no meaningful percentage. */
export function itemSellThrough(row) {
  if (!row.l12m_received) return null;
  return ((row.l12m_sold || 0) / row.l12m_received) * 100;
}

/** Share of SKUs that sold nothing. Reported ALONGSIDE the median rather
 * than folded into it, because on brands with a long dead tail the median
 * is legitimately 0.00 -- measured: 3 of 5 sampled brands have more
 * than half their range selling nothing in 12 months. A card reading "0.00" alone is arithmetically right and
 * reads like a bug; "0.00 - 61% sold nothing" is the same fact stated so
 * a purchaser can act on it. */
function zeroShare(values) {
  if (!values.length) return null;
  return values.filter((v) => v === 0).length / values.length;
}

function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** MEDIAN of per-SKU ratios, which answers a different question from the
 * brand-total ratio beside it. Brand totals are volume-weighted: a handful
 * of fast SKUs can carry the number while most of the range sits still.
 * The median weights every SKU equally, so it describes the TYPICAL item.
 *
 * When the two disagree sharply, that gap is the finding -- healthy totals
 * with a poor median means a few winners are masking dead weight (real
 * example: Quad Lock's brand sell-through looks fine while one colourway
 * received 23 and sold 1).
 *
 * Computed from item rows rather than stored per brand, deliberately: a
 * median cannot be derived from per-brand medians, so a stored value would
 * be exact for one brand and quietly wrong for any other selection. From
 * rows it's exact for however many brands are selected. */
export function medianSkuTurnover(rows) {
  const ratios = (rows || []).map((r) => {
    const stock = COUNTRIES.reduce((s, c) => s + (r.stock[c.key] || 0), 0);
    return stock > 0 ? (r.l12m_sold || 0) / stock : null;
  }).filter((v) => v != null);
  return { value: median(ratios), zeroShare: zeroShare(ratios) };
}

export function medianSkuSellThrough(rows) {
  const ratios = (rows || []).map((r) => (
    r.l12m_received ? ((r.l12m_sold || 0) / r.l12m_received) * 100 : null
  )).filter((v) => v != null);
  return { value: median(ratios), zeroShare: zeroShare(ratios) };
}

/** Generic sort for the item table -- every column, including the derived
 * ratios, which aren't fields on the row and so can't be read by key. */
export function itemSortValue(row, key, countryKeys) {
  switch (key) {
    case 'brand': return row.brand || '';
    case 'item_code': return row.item_code || '';
    case 'item_name': return row.item_name || '';
    case 'l12m_sold': return row.l12m_sold || 0;
    case 'l12m_received': return row.l12m_received || 0;
    case 'turnover': return itemTurnover(row) ?? -Infinity;
    case 'sell_through': return itemSellThrough(row) ?? -Infinity;
    default: break;
  }
  const [kind, country] = key.split(':');
  if (kind === 'stock') return row.stock[country] || 0;
  // Health sorts by severity, not alphabetically -- "Aging" before
  // "Critical" is meaningless; worst-first is the useful order.
  if (kind === 'health') {
    const tier = row.health[country];
    return tier ? TIER_ORDER.indexOf(tier) : -1;
  }
  return 0;
}

export function sortStockouts(rows, sort) {
  if (!sort || !sort.key) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  const val = (r) => {
    switch (sort.key) {
      case 'units_sold_l3m': return r.units_sold_l3m || 0;
      case 'last_sold': return r.last_sold || '';
      // Sorts by how much cover exists elsewhere, not by the text --
      // "is this a transfer or a purchase" is the actual question, and
      // it is ordered by quantity available, not alphabetically.
      case 'held_elsewhere':
        return Object.values(r.stock_elsewhere || {}).reduce((a, b) => a + b, 0);
      default: return r[sort.key] || '';
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a); const y = val(b);
    return dir * (typeof x === 'string' ? x.localeCompare(y) : x - y);
  });
}

const STOCKOUT_HEADERS = ['brand', 'item_code', 'item_name', 'country',
                          'units_sold_l3m', 'last_sold', 'stock_elsewhere'];

export function stockoutCsv(rows) {
  const lines = rows.map((r) => [
    r.brand, r.item_code, r.item_name, r.country, r.units_sold_l3m, r.last_sold,
    Object.entries(r.stock_elsewhere || {}).filter(([, v]) => v > 0)
      .map(([c, v]) => `${c} ${v}`).join(' / '),
  ].map(csvCell).join(','));
  return [STOCKOUT_HEADERS.join(','), ...lines].join('\n');
}

export function sortItems(rows, sort, countryKeys) {
  if (!sort || !sort.key) return rows;
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = itemSortValue(a, sort.key, countryKeys);
    const y = itemSortValue(b, sort.key, countryKeys);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return dir * c;
  });
}

const CSV_HEADERS = ['item_code', 'item_name',
                     ...ALL_COUNTRIES.map((c) => `${c.toLowerCase()}_stock`),
                     ...ALL_COUNTRIES.map((c) => `${c.toLowerCase()}_health`),
                     'valuation_rate',
                     'l12m_sold', 'l12m_received', 'turnover', 'sell_through_pct'];

function csvCell(val) {
  const s = String(val ?? '').replace(/\r?\n|\r/g, ' ').trim();
  const esc = s.replace(/"/g, '""');
  return /[",]/.test(esc) ? `"${esc}"` : esc;
}

export function brandHealthCsv(rows) {
  const lines = rows.map((r) => [
    r.item_code, r.item_name,
    r.stock.UAE, r.stock.QAT, r.stock.KSA,
    r.health.UAE, r.health.QAT, r.health.KSA,
    r.valuation_rate, r.l12m_sold ?? '', r.l12m_received ?? '',
    itemTurnover(r)?.toFixed(2) ?? '', itemSellThrough(r)?.toFixed(1) ?? '',
  ].map(csvCell).join(','));
  return [CSV_HEADERS.join(','), ...lines].join('\n');
}

/** Same shape as brandHealthCsv plus a leading Brand column -- used when
 * the item table is showing catalog-wide rows (a country/tier filter
 * clicked with no brand selected), where which brand each row belongs to
 * is no longer implied by a page-level selection the way it is in the
 * brand-scoped export. */
export function catalogHealthCsv(rows) {
  const headers = ['brand', ...CSV_HEADERS];
  const lines = rows.map((r) => [
    r.brand, r.item_code, r.item_name,
    r.stock.UAE, r.stock.QAT, r.stock.KSA,
    r.health.UAE, r.health.QAT, r.health.KSA,
    r.valuation_rate, r.l12m_sold ?? '', r.l12m_received ?? '',
    itemTurnover(r)?.toFixed(2) ?? '', itemSellThrough(r)?.toFixed(1) ?? '',
  ].map(csvCell).join(','));
  return [headers.join(','), ...lines].join('\n');
}
