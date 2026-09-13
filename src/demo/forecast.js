// =========================================================
// THE FORECAST MODEL
//
// A port of shared/forecast.py's horizon-tiered model (ADR 0003), kept
// faithful in the one respect that matters for a demo: the METHOD a row
// was produced by is real, and reported. The tier names promise a trend
// model that is trusted far less often than they suggest, and Demand
// Forecast's method-mix row exists to say so -- which it can only do if
// the methods are genuinely chosen rather than labelled.
//
//   short (<=4mo)  Holt's exponential smoothing on 8 weeks,
//                  falling back to the 26-week WMA when the recent
//                  window is too thin to fit a slope to.
//   mid   (5-6mo)  26-week weighted moving average, 65/35 recent/older.
//   long  (>6mo)   Holt on a full year, falling back to a WMA over
//                  whatever history exists -- which is most of the time,
//                  because two of the three markets are younger than the
//                  year the trend model wants.
// =========================================================

import {
  COUNTRIES, CHANNELS, TOTAL_DAYS, invoices, items, marketDays,
  stockByItem,
} from './world.js';

const WEEKS_PER_MONTH = 52 / 12;
export const HORIZONS = [2, 3, 4, 5, 6, 10, 12, 18];

// ---- weekly buckets --------------------------------------------------
//
// Built once for the whole catalogue and reused: every horizon reads the
// same history, and rebuilding it per call was the slowest thing here.

const WINDOW_WEEKS = 52;
const bucketKey = (i, c) => i * 4 + COUNTRIES.indexOf(c);

/** units per week, oldest first, one array per (item, country). */
const weeklyByItem = new Map();
const weeklyByChannel = new Map();
/** Revenue per week, LIVE FEED ONLY. Separate from the units buckets
 *  above, and deliberately: units are complete over the whole record,
 *  prices are not -- the pre-cutover export left most Distribution lines
 *  unpriced. Summing those as revenue while costing every unit is what
 *  turns a profitable brand into a negative-margin one on screen. */
const weeklyRevByItem = new Map();
(function buildBuckets() {
  invoices.forEach((inv) => {
    if (inv.isReturn) return;
    const weeksAgo = Math.floor((TOTAL_DAYS - inv.day) / 7);
    if (weeksAgo < 0 || weeksAgo >= WINDOW_WEEKS) return;
    const slot = WINDOW_WEEKS - 1 - weeksAgo;   // oldest first
    inv.lines.forEach((ln) => {
      const k = bucketKey(ln.i, inv.country);
      let arr = weeklyByItem.get(k);
      if (!arr) { arr = new Float32Array(WINDOW_WEEKS); weeklyByItem.set(k, arr); }
      arr[slot] += ln.q;

      if (!inv.legacy) {
        let rev = weeklyRevByItem.get(k);
        if (!rev) { rev = new Float32Array(WINDOW_WEEKS); weeklyRevByItem.set(k, rev); }
        rev[slot] += ln.amt;
      }

      const ck = ln.i * 8 + CHANNELS.indexOf(inv.channel);
      let carr = weeklyByChannel.get(ck);
      if (!carr) { carr = new Float32Array(WINDOW_WEEKS); weeklyByChannel.set(ck, carr); }
      carr[slot] += ln.q;
    });
  });
}());

const bucketsFor = (i, c) => weeklyByItem.get(bucketKey(i, c));
const revFor = (i, c) => weeklyRevByItem.get(bucketKey(i, c));

// ---- the two estimators ---------------------------------------------

/** Weighted moving average: the recent half weighted 65, the older 35.
 *  No slope, which is the point -- it is what the model falls back to
 *  when there is not enough evidence to project a trend forward. */
function wma(weekly, weeks) {
  const win = weekly.slice(Math.max(0, weekly.length - weeks));
  if (!win.length) return 0;
  const half = Math.floor(win.length / 2) || 1;
  const older = win.slice(0, half);
  const recent = win.slice(half);
  const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  return 0.65 * mean(recent) + 0.35 * mean(older);
}

/** Holt's linear exponential smoothing. Returns a level and the slope it
 *  found; the slope is damped when projected (phi below), because an
 *  unchecked linear trend on a parts SKU compounds into nonsense. */
function holt(weekly, weeks, alpha = 0.3, beta = 0.1) {
  const win = Array.from(weekly.slice(Math.max(0, weekly.length - weeks)));
  if (win.length < 4) return null;
  let level = win[0];
  let trend = win[1] - win[0];
  for (let t = 1; t < win.length; t += 1) {
    const prev = level;
    level = alpha * win[t] + (1 - alpha) * (level + trend);
    trend = beta * (level - prev) + (1 - beta) * trend;
  }
  return { level, trend };
}

const PHI = 0.85;   // trend damping

/** How much record this market actually has, in days. A tier that needs
 *  a year of history cannot be trusted in a market eight months old --
 *  which is the usual case here, and why the WMA fallbacks dominate the
 *  method mix rather than decorating it. */
const recordDays = (country) => TOTAL_DAYS - marketDays[country].from;

function directionOf(trend, level) {
  if (!level) return 'flat';
  const rel = trend / Math.max(level, 0.05);
  if (rel > 0.04) return 'rising';
  if (rel < -0.04) return 'falling';
  return 'flat';
}

/** The tier choice, and the honest fallback when the tier's own method
 *  cannot be supported by the record. */
export function velocityFor(weekly, months, country) {
  if (!weekly) return null;
  const total = weekly.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const nonZero = weekly.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
  const days = recordDays(country);

  if (months <= 4) {
    // Eight weeks is a short window to fit a slope to; it needs to have
    // actually been busy, or the slope is fitted to noise.
    const recent = weekly.slice(weekly.length - 8);
    const recentNonZero = recent.reduce((s, v) => s + (v > 0 ? 1 : 0), 0);
    if (recentNonZero >= 4 && days >= 90) {
      const h = holt(weekly, 8);
      // A collapsed level is not a forecast of zero, it is the model
      // failing on an intermittent series: one quiet week at the end of
      // a sparse window drags the level under and the clamp finishes the
      // job, so an item that plainly keeps selling is told it stops.
      // Where that happens the tier's own method is not trustworthy and
      // the WMA below is, which is exactly what the fallback is for.
      if (h && Math.max(0, h.level) > 0.05) {
        return { level: h.level, trend: h.trend,
          direction: directionOf(h.trend, h.level), method: 'holt-short' };
      }
    }
    const lvl = wma(weekly, 26);
    return { level: lvl, trend: 0, direction: 'flat', method: 'wma-short-fallback' };
  }

  if (months <= 6) {
    const lvl = wma(weekly, 26);
    return { level: lvl, trend: 0, direction: 'flat', method: 'wma-mid' };
  }

  // Long tier: a real trend model, but only where a real year exists.
  if (days >= 350 && nonZero >= 20) {
    const h = holt(weekly, 52);
    // Same guard as the short tier -- see there.
    if (h && Math.max(0, h.level) > 0.05) {
      return { level: h.level, trend: h.trend,
        direction: directionOf(h.trend, h.level), method: 'holt-long' };
    }
  }
  const lvl = wma(weekly, Math.min(52, weekly.length));
  return { level: lvl, trend: 0, direction: 'flat', method: 'wma-long-fallback' };
}

/** Units expected to SELL over the horizon. Never negative -- a forecast
 *  is a claim about the market, and a market cannot sell backwards. */
export function forecastFor(v, months) {
  if (!v) return 0;
  const weeks = Math.round(months * WEEKS_PER_MONTH);
  let total = 0;
  for (let h = 1; h <= weeks; h += 1) {
    total += Math.max(0, v.level + v.trend * Math.pow(PHI, h));
  }
  return Math.ceil(total);
}

/** Forecast minus what is already on the shelf. Signed: negative is a
 *  surplus, and that is information rather than a zero. */
export const demandFor = (v, months, stock) => forecastFor(v, months) - stock;

/** UAE-hub redistribution. The asymmetry is the rule, not an artefact:
 *  a UAE surplus can cover Gulf need, a Gulf surplus never flows back. */
export function netOrder(demand, signed) {
  const uae = demand.UAE ?? 0;
  const gulfNeed = Math.max(0, demand.QAT ?? 0) + Math.max(0, demand.KSA ?? 0);
  if (signed) return uae + gulfNeed;
  if (uae >= 0) return uae + gulfNeed;
  return Math.max(0, gulfNeed + uae);      // UAE surplus absorbs Gulf need
}

// ---- assembling one item's row --------------------------------------

/** The row shape /brands/{brand}/forecast and /demand-glance both
 *  return. `withSales` adds the trailing-window blocks Forecast
 *  Analytics draws its charts from; Demand Glance stays lean without
 *  them, the same split ADR 0002 makes. */
export function assemble(i, months, { signed = false, weights = null, withSales = false } = {}) {
  const it = items[i];
  const stock = {}; const velocity = {}; const forecast = {};
  const demand = {}; const demandValue = {};
  const rate = it.valuation_rate;

  COUNTRIES.forEach((c) => {
    const s = stockByItem[i][c];
    stock[c] = s;
    let weekly = bucketsFor(i, c);
    if (weekly && weights) {
      // A channel weight scales that channel's contribution. Applied to
      // the velocity input only -- the sales blocks below stay factual.
      const scaled = new Float32Array(weekly.length);
      CHANNELS.forEach((ch) => {
        const w = weights[ch] ?? 1;
        const arr = weeklyByChannel.get(i * 8 + CHANNELS.indexOf(ch));
        if (!arr) return;
        for (let k = 0; k < scaled.length; k += 1) scaled[k] += arr[k] * w;
      });
      weekly = scaled;
    }
    const v = velocityFor(weekly, months, c);
    velocity[c] = v && {
      weekly_rate: Math.round(v.level * 100) / 100,
      direction: v.direction,
      method: v.method,
      weeks_of_stock: v.level > 0 ? Math.round((s / v.level) * 10) / 10 : null,
    };
    forecast[c] = forecastFor(v, months);
    demand[c] = demandFor(v, months, s);
    demandValue[c] = Math.round(demand[c] * rate * 100) / 100;
  });

  const net = netOrder(demand, signed);
  const row = {
    item_code: it.item_code,
    item_name: it.item_name,
    brand: it.brand,
    stock,
    velocity,
    forecast,
    demand,
    demand_value: demandValue,
    net_order: net,
    valuation_rate: rate,
    net_order_value: Math.round(net * rate * 100) / 100,
  };

  if (withSales) {
    // The TRAILING WINDOW matching the horizon, not all time: the card
    // above this table is labelled "sales 3mo", and answering it with a
    // lifetime total would make the figure disagree with its own label.
    const hw = Math.min(WINDOW_WEEKS, Math.max(8, Math.round(months * WEEKS_PER_MONTH)));
    const tail = (arr) => (arr ? Array.from(arr.slice(arr.length - hw)) : new Array(hw).fill(0));
    const sumTail = (arr) => tail(arr).reduce((s, v) => s + v, 0);

    row.sales = {};
    row.sales_value = {};
    COUNTRIES.forEach((c) => {
      row.sales[c] = Math.round(sumTail(bucketsFor(i, c)) * 100) / 100;
      row.sales_value[c] = Math.round(sumTail(revFor(i, c)) * 100) / 100;
    });
    const anySales = COUNTRIES.some((c) => row.sales[c] !== 0);
    if (anySales) {
      row.weekly_sales = {};
      COUNTRIES.forEach((c) => { row.weekly_sales[c] = tail(bucketsFor(i, c)); });
      row.weekly_sales_by_channel = {};
      CHANNELS.forEach((ch) => {
        row.weekly_sales_by_channel[ch] = tail(weeklyByChannel.get(i * 8 + CHANNELS.indexOf(ch)));
      });
    }
  }
  return row;
}

/** An item nobody has sold and nobody holds is not a decision waiting to
 *  be made -- it is catalogue. The real endpoint omits these by default
 *  for the same reason, and for a much larger payload saving. */
export function isInactive(row) {
  const noStock = COUNTRIES.every((c) => !row.stock[c]);
  const noVelocity = COUNTRIES.every((c) => !row.velocity[c]);
  return noStock && noVelocity;
}

export { WINDOW_WEEKS, bucketsFor };
