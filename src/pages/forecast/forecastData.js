// Pure logic for the Forecast Analytics page -- sibling to
// ForecastAnalyticsPage.jsx per CONTEXT.md's convention.
import { COUNTRIES } from '../../lib/constants.js';

export const BLOCKS = [
  { key: 'stock', label: 'Stock on hand' },
  { key: 'sales', label: 'Sales (trailing)' },
  { key: 'velocity', label: 'Velocity' },
  // Sits before Demand deliberately -- that's the ladder's order
  // (forecast -> demand -> net order, see CONTEXT.md), and this is the
  // only rung a human edits. Off by default like Value: the table is
  // wide enough without it, and it switches on automatically when a
  // forecast review is started.
  { key: 'forecast', label: 'Forecast' },
  { key: 'demand', label: 'Demand' },
  { key: 'value', label: 'Value' },
];
export const VALUE_COLS = [
  { key: 'stockVal', label: 'Stock val' },
  { key: 'salesVal', label: 'Sales val' },
  { key: 'netVal', label: 'Net val' },
];

/** One /brands/{brand}/forecast item -> the flat per-block shape the table
 * and cards work with. `signed` decides whether net_order is already
 * signed (server computes both based on the query param, so this just
 * reads whichever the server sent). */
/** Short labels for the in-cell channel mix. The cell is a few characters
 * wide; "Distribution" is not. */
export const CHANNEL_ABBR = { Showroom: 'SR', Distribution: 'DS', Ecommerce: 'EC' };

export function normalizeForecastRow(r) {
  const salesByChannel = r.sales_by_channel || {};
  const velocityByChannel = r.velocity_by_channel || {};
  const stockGlobal = COUNTRIES.reduce((s, c) => s + (r.stock[c.key] || 0), 0);
  const salesGlobal = COUNTRIES.reduce((s, c) => s + (r.sales[c.key] || 0), 0);
  const salesValGlobal = COUNTRIES.reduce((s, c) => s + (r.sales_value[c.key] || 0), 0);

  // Global velocity = total units/week across all markets. Direction and
  // method are deliberately absent: they're per-country properties (each
  // country can be fit by a different tier/method and trending opposite
  // ways), and averaging them would invent a fact the model never
  // produced. The rate itself sums honestly.
  const rates = COUNTRIES.map((c) => r.velocity[c.key]).filter(Boolean);
  const globalRate = rates.reduce((s, v) => s + v.weekly_rate, 0);
  const velocity = {
    ...r.velocity,
    global: rates.length === 0 ? null : {
      weekly_rate: Math.round(globalRate * 100) / 100,
      weeks_of_stock: globalRate > 0 ? Math.round((stockGlobal / globalRate) * 10) / 10 : null,
    },
  };

  const forecast = r.forecast || {};
  const forecastGlobal = COUNTRIES.reduce((s, c) => s + (forecast[c.key] || 0), 0);

  return {
    item_code: r.item_code,
    item_name: r.item_name,
    valuation_rate: r.valuation_rate,
    stock: { ...r.stock, global: stockGlobal },
    sales: { ...r.sales, global: salesGlobal },
    // The channel mix behind each country's sales and velocity number.
    // Absent countries mean single-channel or no sales -- the backend
    // omits rather than zero-fills, since 9 of 10 (item, country) pairs
    // sell through exactly one channel.
    salesByChannel,
    velocityByChannel,
    velocity,
    forecast: { ...forecast, global: forecastGlobal },
    demand: { ...r.demand, global: r.net_order },
    stockVal: stockGlobal * r.valuation_rate,
    salesVal: salesValGlobal,
    netVal: r.net_order_value,
  };
}

/** Port of shared/forecast.py's net_order(). Duplicated across languages
 * deliberately and reluctantly: overriding a forecast has to show its
 * downstream consequence immediately, and round-tripping every keystroke
 * to the server to learn it would be absurd. CLAUDE.md's warning about
 * exactly this kind of drift applies -- if the Python changes, this must
 * change with it, and the two are verified against each other numerically
 * rather than by eye.
 *
 * Simplified in one way: the server always passes all three countries
 * (api/main.py hardcodes on_countries=COUNTRIES), so the "country toggled
 * off" branch has no client-side equivalent to reproduce. */
export function netOrderFrom(demandByCountry, signed) {
  const gulfNeed = ['QAT', 'KSA'].reduce((s, c) => s + Math.max(0, demandByCountry[c] || 0), 0);
  const uae = demandByCountry.UAE || 0;
  if (signed) return uae + gulfNeed;
  const surplus = Math.max(0, -uae);
  return Math.max(0, uae) + Math.max(0, gulfNeed - surplus);
}

/** Re-derives the ladder below an overridden forecast. Editing a forecast
 * in isolation and leaving you to do the stock subtraction in your head is
 * how forecast and demand got conflated in the first place -- so an
 * override flows all the way through to net order and its value, live.
 *
 * `overrides` is a partial {UAE, QAT, KSA} of manager forecasts for this
 * item. Returns the row untouched when there's nothing overridden, so
 * unedited rows keep object identity and don't churn React. */
export function withOverrides(row, overrides, signed) {
  if (!overrides) return row;
  const touched = COUNTRIES.filter((c) => overrides[c.key] != null);
  if (!touched.length) return row;

  const forecast = { ...row.forecast };
  const demand = { ...row.demand };
  touched.forEach(({ key }) => {
    forecast[key] = overrides[key];
    demand[key] = overrides[key] - (row.stock[key] || 0);
  });
  forecast.global = COUNTRIES.reduce((s, c) => s + (forecast[c.key] || 0), 0);
  const net = netOrderFrom(demand, signed);
  demand.global = net;

  return {
    ...row,
    forecast,
    demand,
    netVal: net * row.valuation_rate,
    overridden: touched.map((c) => c.key),
  };
}

export function sortVal(row, block, key) {
  if (block === 'meta') return row[key];
  if (block === 'value') return row[key] || 0;
  if (block === 'velocity') return row.velocity[key] ? row.velocity[key].weekly_rate : -Infinity;
  return row[block] ? (row[block][key] ?? 0) : 0;
}

// Per market, in the app's canonical order. The measure order is the
// reading order of the table this exports, and the country names come
// from COUNTRIES so the file never has to learn about a new one.
const per = (measure) => COUNTRIES.map((c) => `${c.dot}_${measure}`);

const CSV_HEADERS = [
  'item_code', 'item_name',
  ...per('stock'), 'total_stock',
  ...per('sales'), 'total_sales',
  ...per('velocity'),
  ...per('forecast'),
  ...per('demand'),
  'net_order', 'valuation_rate', 'net_order_value',
];

function csvCell(val) {
  const s = String(val ?? '').replace(/\r?\n|\r/g, ' ').trim();
  const esc = s.replace(/"/g, '""');
  return /[",]/.test(esc) ? `"${esc}"` : esc;
}

/** Exports exactly what the table is showing: the same rows (inactive
 * ones already filtered out upstream), in the same sort order, and with
 * demand/net figures matching the signed toggle -- signed when negatives
 * are on screen, clamped to 0 when they aren't. The export should never
 * disagree with what you were looking at when you hit the button. */
export function forecastCsv(rows, signed) {
  const num = (v) => (v == null ? '' : signed ? v : Math.max(0, v));
  const lines = rows.map((r) => [
    r.item_code, r.item_name,
    r.stock.UAE, r.stock.QAT, r.stock.KSA, r.stock.global,
    r.sales.UAE, r.sales.QAT, r.sales.KSA, r.sales.global,
    r.velocity.UAE ? r.velocity.UAE.weekly_rate : '',
    r.velocity.QAT ? r.velocity.QAT.weekly_rate : '',
    r.velocity.KSA ? r.velocity.KSA.weekly_rate : '',
    // Forecast is never clamped by `signed` -- that toggle exists to let
    // DEMAND show surplus as negative, and a forecast can't be negative
    // in the first place (see forecast_for).
    r.forecast?.UAE ?? '', r.forecast?.QAT ?? '', r.forecast?.KSA ?? '',
    num(r.demand.UAE), num(r.demand.QAT), num(r.demand.KSA),
    num(r.demand.global), r.valuation_rate, num(r.netVal),
  ].map(csvCell).join(','));
  return [CSV_HEADERS.join(','), ...lines].join('\n');
}
