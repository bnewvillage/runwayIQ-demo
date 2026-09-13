// =========================================================
// API client -- DEMO BUILD.
//
// In the real app this file is a thin fetch wrapper over a FastAPI
// backend reading Supabase. Here it is the whole backend: every function
// keeps its original name, arguments and response shape, and derives the
// answer from the synthetic ledger in demo/world.js instead of from a
// database.
//
// That swap is the entire difference between this repo and the product.
// Nothing above this file knows which one it is talking to -- the pages,
// the pure-logic modules and the charts are the shipped ones, unchanged.
//
// Two things are deliberately preserved rather than shortcut:
//
//   * Every figure is summed out of ONE invoice ledger, so the pages
//     agree with each other the way they do against a real database. A
//     fixture per page would drift the moment two pages were open.
//   * The endpoints that are slow in production are slow here. The
//     Demand Forecast run really does compute the whole catalogue, and
//     the delays below are the measured shape of the real thing -- a
//     demo where every click is instant misrepresents the tool.
// =========================================================

import * as W from '../demo/world.js';
import {
  HORIZONS, assemble, isInactive, velocityFor, bucketsFor,
} from '../demo/forecast.js';

const { COUNTRIES, CHANNELS, MONTHS, items, invoices, customers, itemFacts,
  stockByItem, healthByItem, receivedByItem, uaeSplit, MARKETS, TODAY } = W;

// ---- plumbing --------------------------------------------------------

/** Latency, so loading states are exercised rather than theoretical.
 *  Roughly the real endpoint's measured shape, compressed. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const memo = new Map();
async function cached(key, ms, build) {
  if (!memo.has(key)) memo.set(key, build());
  await wait(ms);
  return memo.get(key);
}

const isoDay = W.dayToIso;
const num = (n) => Math.round(n * 100) / 100;
const productItems = items.map((it, i) => (it.brand ? i : -1)).filter((i) => i >= 0);
const serviceItems = items.map((it, i) => (it.brand ? -1 : i)).filter((i) => i >= 0);

/** The demo has no pipeline, but the pages read these markers to label
 *  "Data as of" -- so they are stated as the moment the world ends. */
const LOADED_AT = new Date(TODAY.getTime() + 6 * 3600000).toISOString();

// ---- meta ------------------------------------------------------------

export const getMeta = () => cached('meta', 90, () => ({
  core_load: LOADED_AT,
  demand_glance: LOADED_AT,
  material_requests: LOADED_AT,
}));

/** There is no ERP behind a demo, and a button that silently did nothing
 *  would be worse than one that says so. */
export const refreshDatabase = async () => {
  await wait(400);
  throw new Error('This is the demo build — there is no ERP connected to refresh from. '
    + 'In the real deployment this dispatches the nightly pipeline.');
};

export const getBrands = () => cached('brands', 80, () => ({ brands: [...W.BRANDS] }));

export const getForecastHorizons = () => cached('horizons', 60, () => ({ horizons: HORIZONS }));

// ---- stock health ----------------------------------------------------

const HEALTH_TIERS = {
  fast_mover: { label: 'Fast Mover', order: 0, desc: 'Sale in 5+ of 6 two-week windows (last 3 months)' },
  active: { label: 'Active', order: 1, desc: 'Sale in 2+ of 3 months (last 3 months)' },
  slow_mover: { label: 'Slow Mover', order: 2, desc: 'At least 1 sale in the last 3 months' },
  aging: { label: 'Aging', order: 3, desc: 'Last sale 3-6 months ago, or here 3-6 months and never sold' },
  critical: { label: 'Critical', order: 4, desc: 'Last sale 6-12 months ago, or here 6-12 months and never sold' },
  new_stock: { label: 'New Stock', order: 5, desc: 'Here less than 3 months and never sold -- too new to judge' },
  dead_stock: { label: 'Dead Stock', order: 6, desc: 'Here 12 months or more and never sold, or no sale in 12 months' },
  undetermined: { label: 'Undetermined', order: 7, desc: 'No evidence the item was ever here, or no sales record for this market at all' },
};
export const getStockHealthTiers = () => cached('tiers', 40, () => ({ tiers: HEALTH_TIERS }));

/** One item's row in the shape both the catalogue and per-brand
 *  endpoints return -- built once so the two cannot disagree. */
function healthItem(i, country) {
  const it = items[i];
  const f = itemFacts[i];
  const bc = f.byCountry[country];
  const elsewhere = {};
  COUNTRIES.forEach((c) => { if (c !== country) elsewhere[c] = stockByItem[i][c]; });
  return {
    item_code: it.item_code,
    item_name: it.item_name,
    brand: it.brand,
    country,
    stock: stockByItem[i][country],
    health: healthByItem[i][country],
    last_sold: bc?.lastSale != null ? isoDay(bc.lastSale) : null,
    valuation_rate: it.valuation_rate,
    units_sold_l12m: num(Math.max(0, bc?.u12 || 0)),
    l12m_sold: num(Math.max(0, f.units12m)),
    l12m_received: receivedByItem[i],
    stock_elsewhere: elsewhere,
    held_elsewhere: Object.values(elsewhere).some((v) => v > 0),
  };
}

export const getBrandStockHealth = (brand) => cached(`bsh:${brand}`, 240, () => {
  const out = [];
  productItems.forEach((i) => {
    if (items[i].brand !== brand) return;
    COUNTRIES.forEach((c) => {
      if (healthByItem[i][c] == null && stockByItem[i][c] === 0) return;
      out.push(healthItem(i, c));
    });
  });
  return { brand, count: out.length, items: out };
});

/** The catalogue cut. Filters narrow what is built, exactly as the real
 *  endpoint narrows its SQL -- the unfiltered response is the big one. */
export const getCatalogStockHealth = async (countries, tiers) => {
  const cs = countries && countries.length ? countries : COUNTRIES;
  const ts = tiers && tiers.length ? tiers : null;
  await wait(ts || (countries && countries.length) ? 420 : 900);
  const out = [];
  productItems.forEach((i) => {
    const hit = cs.some((c) => (!(countries && countries.length) || stockByItem[i][c] > 0)
      && (!ts || ts.includes(healthByItem[i][c])));
    if (!hit) return;
    const stock = {}; const health = {};
    COUNTRIES.forEach((c) => { stock[c] = stockByItem[i][c]; health[c] = healthByItem[i][c]; });
    out.push({
      item_code: items[i].item_code,
      item_name: items[i].item_name,
      brand: items[i].brand,
      valuation_rate: items[i].valuation_rate,
      stock,
      health,
      l12m_sold: num(Math.max(0, itemFacts[i].units12m)),
      l12m_received: receivedByItem[i],
    });
  });
  return { count: out.length, items: out };
};

export const getStockHealthSummary = () => cached('health-summary', 520, () => {
  const byBrand = new Map();
  productItems.forEach((i) => {
    const it = items[i];
    let b = byBrand.get(it.brand);
    if (!b) {
      b = { brand: it.brand, sku_count: 0, stock_units: 0, stock_value: 0,
        l12m_units_sold: 0, l12m_revenue: 0, l12m_cogs: 0, l12m_units_received: 0,
        stockout_count: 0, country_stockouts: {}, tier_counts: {},
        country_tier_stats: {}, country_sold: {} };
      byBrand.set(it.brand, b);
    }
    b.sku_count += 1;
    b.l12m_units_received += receivedByItem[i];
    const f = itemFacts[i];
    COUNTRIES.forEach((c) => {
      const s = stockByItem[i][c];
      b.stock_units += s;
      b.stock_value += s * it.valuation_rate;
      const bc = f.byCountry[c];
      const units = Math.max(0, bc?.u12 || 0);
      // Revenue and cost both come from the LIVE feed only, so the two
      // sides of every ratio below cover the same rows. Mixing a
      // full-history cost base with a live-only revenue one is how
      // GMROI ends up negative for a business that is making money.
      const rev = Math.max(0, bc?.rev12 || 0);
      const costUnits = Math.max(0, bc?.u12live || 0);
      const cogs = costUnits * it.valuation_rate;
      b.l12m_units_sold += units;
      b.l12m_revenue += rev;
      b.l12m_cogs += cogs;
      // {units, revenue, cogs} per country, not a bare number: the page
      // forms turnover, sell-through and GMROI from all three, and COGS
      // rides along rather than being rebuilt from brand totals, which
      // would reintroduce a blended cost rate.
      if (!b.country_sold[c]) b.country_sold[c] = { units: 0, revenue: 0, cogs: 0 };
      b.country_sold[c].units += units;
      b.country_sold[c].revenue += rev;
      b.country_sold[c].cogs += cogs;

      const tier = healthByItem[i][c];
      if (tier) {
        b.tier_counts[tier] = (b.tier_counts[tier] || 0) + 1;
        // {count, units, value} -- counts alone cannot answer "what is
        // the Critical stock in UAE worth", which is the cross-filter
        // the treemap exists for.
        if (!b.country_tier_stats[c]) b.country_tier_stats[c] = {};
        const st = b.country_tier_stats[c];
        if (!st[tier]) st[tier] = { count: 0, units: 0, value: 0 };
        st[tier].count += 1;
        st[tier].units += s;
        st[tier].value += s * it.valuation_rate;
      }
      // A stock-out is an item that is selling with nothing on the
      // shelf -- not merely an item with no stock.
      if (s === 0 && units > 0) {
        b.stockout_count += 1;
        b.country_stockouts[c] = (b.country_stockouts[c] || 0) + 1;
      }
    });
  });
  const brands = [...byBrand.values()].map((b) => ({
    ...b,
    country_sold: Object.fromEntries(Object.entries(b.country_sold).map(([c, v]) => [c, {
      units: num(v.units), revenue: num(v.revenue), cogs: num(v.cogs),
    }])),
    country_tier_stats: Object.fromEntries(Object.entries(b.country_tier_stats).map(([c, tiers]) => [c,
      Object.fromEntries(Object.entries(tiers).map(([t, v]) => [t, {
        count: v.count, units: num(v.units), value: num(v.value),
      }]))])),
    stock_units: num(b.stock_units),
    stock_value: num(b.stock_value),
    l12m_units_sold: num(b.l12m_units_sold),
    l12m_revenue: num(b.l12m_revenue),
    l12m_cogs: num(b.l12m_cogs),
    turnover_ratio: b.stock_value ? num(b.l12m_cogs / b.stock_value) : null,
    sell_through_pct: b.l12m_units_received ? num((b.l12m_units_sold / b.l12m_units_received) * 100) : null,
    gmroi: b.stock_value ? num((b.l12m_revenue - b.l12m_cogs) / b.stock_value) : null,
  })).sort((a, b) => b.stock_value - a.stock_value);
  return { count: brands.length, brands };
});

export const getStockouts = async (brands, countries) => {
  await wait(300);
  const cs = countries && countries.length ? countries : COUNTRIES;
  const out = [];
  productItems.forEach((i) => {
    if (brands && brands.length && !brands.includes(items[i].brand)) return;
    cs.forEach((c) => {
      const bc = itemFacts[i].byCountry[c];
      // Three months, matching the real endpoint's window.
      const recent = bc && bc.lastSale != null && (W.TOTAL_DAYS - bc.lastSale) <= 90;
      if (stockByItem[i][c] === 0 && recent) {
        out.push({
          item_code: items[i].item_code,
          item_name: items[i].item_name,
          brand: items[i].brand,
          country: c,
          units: num(Math.max(0, bc.u12)),
          last_sold: isoDay(bc.lastSale),
          valuation_rate: items[i].valuation_rate,
        });
      }
    });
  });
  out.sort((a, b) => b.units - a.units);
  return { count: out.length, stockouts: out };
};

export const getReceiptsMonthly = async (brands, country) => {
  await wait(200);
  // Receipts are lumpy: stock arrives in shipments, not continuously.
  const floor = country ? MARKETS[country].stockFloor : MARKETS.UAE.stockFloor;
  const months = MONTHS.filter((m) => m >= floor).map((m) => {
    let value = 0;
    productItems.forEach((i) => {
      if (brands && brands.length && !brands.includes(items[i].brand)) return;
      if (country && !items[i].markets.includes(country)) return;
      const seed = (i * 31 + Number(m.slice(5, 7)) * 7 + (country ? country.charCodeAt(0) : 0)) % 11;
      if (seed > 7) value += receivedByItem[i] * items[i].valuation_rate * 0.22;
    });
    return { year_month: m, value: num(value) };
  });
  return { brand: brands || null, country: country || null, months };
};

// ---- the sales ledger, aggregated ------------------------------------

function buildCube(liveOnly) {
  const cells = new Map();
  invoices.forEach((inv) => {
    if (liveOnly && inv.legacy) return;
    const m = W.monthOf(inv.day);
    inv.lines.forEach((ln) => {
      const it = items[ln.i];
      if (!it.brand) return;                    // product sales only
      const k = `${it.brand}|${inv.country}|${inv.channel}|${m}`;
      let c = cells.get(k);
      if (!c) {
        c = { brand: it.brand, country: inv.country, channel: inv.channel, year_month: m,
          units: 0, revenue: 0, cogs: 0, cogs_imputed: 0, lines: 0,
          return_units: 0, return_revenue: 0, has_legacy: false };
        cells.set(k, c);
      }
      c.units += ln.q;
      c.revenue += ln.amt;
      c.lines += 1;
      const cost = ln.q * it.valuation_rate;
      c.cogs += cost;
      // Delivery-note fulfilment cannot be ledger-costed, so part of the
      // cost base stays imputed -- stated rather than blended away.
      if (inv.legacy || (ln.i + inv.day) % 5 < 2) c.cogs_imputed += cost;
      if (inv.legacy) c.has_legacy = true;
      if (inv.isReturn) { c.return_units += -ln.q; c.return_revenue += -ln.amt; }
    });
  });
  return [...cells.values()].map((c) => ({
    ...c,
    units: num(c.units), revenue: num(c.revenue), cogs: num(c.cogs),
    cogs_imputed: num(c.cogs_imputed), return_units: num(c.return_units),
    return_revenue: num(c.return_revenue),
  }));
}

export const getSalesCube = () => cached('cube', 340, () => {
  const cells = buildCube(true).map((c) => {
    const copy = { ...c };
    delete copy.has_legacy;
    return copy;
  });
  const byOrder = new Map();
  invoices.forEach((inv) => {
    if (inv.legacy) return;
    const m = W.monthOf(inv.day);
    const k = `${inv.country}|${inv.channel}|${m}`;
    let o = byOrder.get(k);
    if (!o) {
      o = { country: inv.country, channel: inv.channel, year_month: m,
        orders: 0, order_value: 0, order_lines: 0, order_units: 0 };
      byOrder.set(k, o);
    }
    o.orders += 1;
    inv.lines.forEach((ln) => {
      o.order_value += ln.amt; o.order_lines += 1; o.order_units += ln.q;
    });
  });
  const orders = [...byOrder.values()].map((o) => ({
    ...o, order_value: num(o.order_value), order_units: num(o.order_units),
  }));
  return { cells, orders };
});

export const getSalesExtended = () => cached('extended', 380, () => ({
  cells: buildCube(false).map((c) => ({
    brand: c.brand, country: c.country, channel: c.channel, year_month: c.year_month,
    units: c.units, lines: c.lines, has_legacy: c.has_legacy,
  })),
}));

/** The row filter every sales endpoint shares. */
function matches(inv, { countries, channels, start, end }) {
  if (countries && countries.length && !countries.includes(inv.country)) return false;
  if (channels && channels.length && !channels.includes(inv.channel)) return false;
  if (start && isoDay(inv.day) < start) return false;
  if (end && isoDay(inv.day) > end) return false;
  return true;
}

export const getSalesItems = async (countries, channels, brands, start, end, limit = 500) => {
  await wait(360);
  const agg = new Map();
  invoices.forEach((inv) => {
    if (inv.legacy) return;                       // live feed only
    if (!matches(inv, { countries, channels, start, end })) return;
    inv.lines.forEach((ln) => {
      const it = items[ln.i];
      if (!it.brand) return;
      if (brands && brands.length && !brands.includes(it.brand)) return;
      let r = agg.get(ln.i);
      if (!r) {
        r = { item_code: it.item_code, item_name: it.item_name, brand: it.brand,
          units: 0, revenue: 0, lines: 0, orders: new Set(), cogs: 0 };
        COUNTRIES.forEach((c) => { r[`${c.toLowerCase()}_units`] = 0; });
        agg.set(ln.i, r);
      }
      r.units += ln.q;
      r.revenue += ln.amt;
      r.lines += 1;
      r.orders.add(inv.id);
      r.cogs += ln.q * it.valuation_rate;
      r[`${inv.country.toLowerCase()}_units`] += ln.q;
    });
  });
  let rows = [...agg.values()].map((r) => ({
    ...r, orders: r.orders.size, units: num(r.units), revenue: num(r.revenue), cogs: num(r.cogs),
  }));
  rows.sort((a, b) => b.revenue - a.revenue);
  const truncated = !!limit && rows.length > limit;
  if (limit) rows = rows.slice(0, limit);
  return { items: rows, truncated };
};

export const getSalesExtendedItems = async (countries, channels, brands, start, end, limit = 500, split) => {
  await wait(420);
  const sets = { live: new Map(), legacy: new Map() };
  const blank = () => ({ items: new Set(), units: 0, revenue: 0, priced_units: 0,
    orders: new Set(), first_sold: null, last_sold: null });
  const totals = { live: blank(), legacy: blank() };
  invoices.forEach((inv) => {
    if (!matches(inv, { countries, channels, start, end })) return;
    const bucket = inv.legacy ? 'legacy' : 'live';
    const day = isoDay(inv.day);
    inv.lines.forEach((ln) => {
      const it = items[ln.i];
      if (!it.brand) return;
      if (brands && brands.length && !brands.includes(it.brand)) return;
      const splitKey = split === 'country' ? inv.country : split === 'channel' ? inv.channel : null;
      const k = `${ln.i}|${splitKey ?? ''}`;
      const m = sets[bucket];
      let r = m.get(k);
      if (!r) {
        r = { item_code: it.item_code, item_name: it.item_name, brand: it.brand,
          split: splitKey, units: 0, revenue: 0, lines: 0, orders: new Set(),
          priced_units: 0, first_sold: day, last_sold: day };
        m.set(k, r);
      }
      r.units += ln.q;
      r.revenue += ln.amt;
      r.lines += 1;
      r.orders.add(inv.id);
      if (ln.amt !== 0) r.priced_units += ln.q;
      if (day < r.first_sold) r.first_sold = day;
      if (day > r.last_sold) r.last_sold = day;

      const t = totals[bucket];
      t.items.add(ln.i); t.units += ln.q; t.revenue += ln.amt; t.orders.add(inv.id);
      if (ln.amt !== 0) t.priced_units += ln.q;
      if (!t.first_sold || day < t.first_sold) t.first_sold = day;
      if (!t.last_sold || day > t.last_sold) t.last_sold = day;
    });
  });
  const shape = (m) => {
    const rows = [...m.values()].map((r) => ({
      ...r, orders: r.orders.size, units: num(r.units), revenue: num(r.revenue),
      priced_units: num(r.priced_units),
    }));
    rows.sort((a, b) => b.units - a.units);
    return limit ? rows.slice(0, limit) : rows;
  };
  const shapeTotals = (t) => ({
    items: t.items.size, units: num(t.units), revenue: num(t.revenue),
    priced_units: num(t.priced_units), orders: t.orders.size,
    first_sold: t.first_sold, last_sold: t.last_sold,
  });
  const live = shape(sets.live);
  const legacy = shape(sets.legacy);
  return {
    live, legacy,
    live_totals: shapeTotals(totals.live),
    legacy_totals: shapeTotals(totals.legacy),
    split: split || null,
    truncated: !!limit && (live.length >= limit || legacy.length >= limit),
  };
};

export const getSalesItemSeries = async (item, countries, channels, start, end) => {
  await wait(200);
  const idx = items.findIndex((it) => it.item_code === item);
  const out = new Map();
  invoices.forEach((inv) => {
    if (inv.legacy) return;
    if (!matches(inv, { countries, channels, start, end })) return;
    inv.lines.forEach((ln) => {
      if (ln.i !== idx) return;
      const m = W.monthOf(inv.day);
      const k = `${m}|${inv.country}|${inv.channel}`;
      let p = out.get(k);
      if (!p) {
        p = { year_month: m, country: inv.country, channel: inv.channel, units: 0, revenue: 0 };
        out.set(k, p);
      }
      p.units += ln.q; p.revenue += ln.amt;
    });
  });
  return {
    item_code: item,
    points: [...out.values()]
      .map((p) => ({ ...p, units: num(p.units), revenue: num(p.revenue) }))
      .sort((a, b) => (a.year_month < b.year_month ? -1 : 1)),
  };
};

export const getSalesDaily = async (start, end, countries, channels, brands) => {
  await wait(240);
  const out = new Map();
  invoices.forEach((inv) => {
    if (inv.legacy) return;
    if (!matches(inv, { countries, channels, start, end })) return;
    const d = isoDay(inv.day);
    inv.lines.forEach((ln) => {
      const it = items[ln.i];
      if (!it.brand) return;
      if (brands && brands.length && !brands.includes(it.brand)) return;
      const k = `${d}|${inv.country}|${inv.channel}`;
      let p = out.get(k);
      if (!p) {
        p = { year_month: d, day: d, country: inv.country, channel: inv.channel, units: 0, revenue: 0 };
        out.set(k, p);
      }
      p.units += ln.q; p.revenue += ln.amt;
    });
  });
  return {
    points: [...out.values()]
      .map((p) => ({ ...p, units: num(p.units), revenue: num(p.revenue) }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
  };
};

/** Each customer's average order against their CHANNEL's, over the whole
 *  live feed and blind to every page filter -- a reference point that
 *  moved with the page would not be a reference point. */
const purchasingPower = (() => {
  let cache = null;
  return () => {
    if (cache) return cache;
    const perCustomer = new Map();
    const chRev = {}; const chOrders = {};
    invoices.forEach((inv) => {
      if (inv.legacy) return;
      const name = customers[inv.customer].name;
      if (W.NOT_ACCOUNTS.includes(name)) return;
      const value = inv.lines.reduce((s, ln) => s + ln.amt, 0);
      let c = perCustomer.get(name);
      if (!c) { c = { orders: 0, revenue: 0, best: 0, channel: inv.channel }; perCustomer.set(name, c); }
      c.orders += 1; c.revenue += value;
      if (value > c.best) c.best = value;
      chRev[inv.channel] = (chRev[inv.channel] || 0) + value;
      chOrders[inv.channel] = (chOrders[inv.channel] || 0) + 1;
    });
    const baseline = {};
    Object.keys(chRev).forEach((ch) => { if (chOrders[ch]) baseline[ch] = num(chRev[ch] / chOrders[ch]); });
    const power = {};
    perCustomer.forEach((c, name) => {
      const aov = c.orders ? c.revenue / c.orders : null;
      const base = baseline[c.channel];
      power[name] = {
        channel: c.channel,
        lifetime_orders: c.orders,
        lifetime_aov: aov == null ? null : num(aov),
        best_order: num(c.best),
        power: aov != null && base ? num(aov / base) : null,
      };
    });
    cache = { power, baseline };
    return cache;
  };
})();

export const getSalesCustomers = async (countries, channels, brands, start, end, limit = 10, item) => {
  await wait(280);
  const scope = (applyNarrow) => {
    const byName = new Map();
    let revenue = 0; const orders = new Set(); const names = new Set();
    invoices.forEach((inv) => {
      if (inv.legacy) return;
      if (!matches(inv, { countries, channels, start, end })) return;
      const name = customers[inv.customer].name;
      if (W.NOT_ACCOUNTS.includes(name)) return;
      let value = 0; let hit = false;
      inv.lines.forEach((ln) => {
        const it = items[ln.i];
        if (!it.brand) return;
        if (applyNarrow) {
          if (brands && brands.length && !brands.includes(it.brand)) return;
          if (item && it.item_code !== item) return;
        }
        value += ln.amt; hit = true;
      });
      if (!hit) return;
      let c = byName.get(name);
      if (!c) { c = { customer: name, revenue: 0, orders: new Set() }; byName.set(name, c); }
      c.revenue += value; c.orders.add(inv.id);
      revenue += value; orders.add(inv.id); names.add(name);
    });
    return { byName, revenue, orders: orders.size, count: names.size };
  };

  const narrowed = !!(brands && brands.length) || !!item;
  const s = scope(true);
  const rows = [...s.byName.values()]
    .map((c) => ({ customer: c.customer, revenue: num(c.revenue), orders: c.orders.size }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);

  const out = {
    customers: rows,
    total_revenue: num(s.revenue),
    customer_count: s.count,
    total_orders: s.orders,
    narrowed,
  };
  if (narrowed) {
    const g = scope(false);
    rows.forEach((r) => {
      const hit = g.byName.get(r.customer);
      r.global_revenue = hit ? num(hit.revenue) : null;
      r.global_orders = hit ? hit.orders.size : null;
    });
    out.global_total_revenue = num(g.revenue);
    out.global_customer_count = g.count;
    out.global_total_orders = g.orders;
  }
  const { power, baseline } = purchasingPower();
  rows.forEach((r) => Object.assign(r, power[r.customer] || {}));
  out.channel_aov = baseline;
  return out;
};

/** Who bought what, when -- interned, and deliberately NOT the affinity
 *  itself. Pair counts depend on how baskets are cut, so the page holds
 *  the tuples and re-pairs them as the gap control moves. */
export const getSalesBaskets = () => cached('baskets', 460, () => {
  const itemIdx = new Map(); const custIdx = new Map(); const chIdx = new Map();
  const invIdx = new Map(); const itemMeta = []; const rows = [];
  let epoch = null;
  invoices.forEach((inv) => { if (epoch == null || inv.day < epoch) epoch = inv.day; });
  invoices.forEach((inv) => {
    if (inv.isReturn) return;                 // not bought alongside anything
    const name = customers[inv.customer].name;
    if (W.NOT_ACCOUNTS.includes(name)) return;
    const seen = new Set();
    inv.lines.forEach((ln) => {
      const it = items[ln.i];
      if (!it.brand) return;                  // services are not a cross-sell
      if (seen.has(ln.i)) return;
      seen.add(ln.i);
      let ii = itemIdx.get(ln.i);
      if (ii == null) {
        ii = itemIdx.size; itemIdx.set(ln.i, ii);
        itemMeta.push([it.item_code, it.item_name, it.brand]);
      }
      let ci = custIdx.get(name);
      if (ci == null) { ci = custIdx.size; custIdx.set(name, ci); }
      let hi = chIdx.get(inv.channel);
      if (hi == null) { hi = chIdx.size; chIdx.set(inv.channel, hi); }
      let vi = invIdx.get(inv.id);
      if (vi == null) { vi = invIdx.size; invIdx.set(inv.id, vi); }
      rows.push([ci, inv.day - epoch, ii, hi, vi]);
    });
  });
  return {
    epoch: isoDay(epoch),
    items: itemMeta,
    channels: [...chIdx.keys()],
    customer_count: custIdx.size,
    rows,
  };
});

// ---- forecast --------------------------------------------------------

export const getDemandGlance = () => cached('glance', 480, () => {
  const rows = [];
  // Services are NOT excluded here -- Demand Glance keeps the contents it
  // has always had; the Demand Forecast page is the one that drops them.
  productItems.concat(serviceItems).forEach((i) => {
    const r = assemble(i, 3, {});
    if (r.net_order <= 0) return;
    // Flattened to the per-country keys this endpoint's SQL pivot
    // produces -- normalizeRow reads uae_stock, uae_velocity and so on.
    const flat = {
      item_code: r.item_code, item_name: r.item_name, brand: r.brand,
      net_order: r.net_order, valuation_rate: r.valuation_rate,
      net_order_value: r.net_order_value, computed_at: LOADED_AT,
    };
    COUNTRIES.forEach((c) => {
      const p = c.toLowerCase();
      const v = r.velocity[c];
      flat[`${p}_stock`] = r.stock[c];
      flat[`${p}_velocity`] = v ? v.weekly_rate : null;
      flat[`${p}_direction`] = v ? v.direction : null;
      flat[`${p}_demand`] = r.demand[c];
      flat[`${p}_demand_value`] = r.demand_value[c];
      flat[`${p}_weeks_of_stock`] = v ? v.weeks_of_stock : null;
    });
    rows.push(flat);
  });
  rows.sort((a, b) => b.net_order - a.net_order);
  return {
    count: rows.length,
    computed_at: LOADED_AT,
    total_net_order_value: num(rows.reduce((s, r) => s + (r.net_order_value || 0), 0)),
    items: rows,
  };
});

/** The heavy one, and deliberately so -- the whole catalogue at a chosen
 *  horizon, computed on the spot and never cached. Services are excluded
 *  here and not in Demand Glance: at twelve months they otherwise take
 *  over the top of the list. */
export const getDemandForecast = async (months) => {
  const m = Number(months);
  if (!HORIZONS.includes(m)) throw new Error(`months must be one of ${HORIZONS.join(', ')}`);
  // Scaled with the horizon, as the real endpoint's cost is.
  await wait(700 + m * 70);
  const rows = [];
  productItems.forEach((i) => {
    const r = assemble(i, m, {});
    if (r.net_order > 0) rows.push(r);
  });
  rows.sort((a, b) => b.net_order - a.net_order);
  return { months: m, count: rows.length, items: rows };
};

export const getBrandForecast = async (brand, opts = {}) => {
  const { months = 3, signed = false, showroom = 1, distribution = 1, ecommerce = 1,
    includeInactive = false } = opts;
  await wait(340);
  const weights = { Showroom: showroom, Distribution: distribution, Ecommerce: ecommerce };
  const isDefault = showroom === 1 && distribution === 1 && ecommerce === 1;
  const rows = [];
  let omitted = 0;
  items.forEach((it, i) => {
    if (it.brand !== brand) return;
    const r = assemble(i, months, { signed, weights: isDefault ? null : weights, withSales: true });
    if (!includeInactive && isInactive(r)) { omitted += 1; return; }
    rows.push(r);
  });
  rows.sort((a, b) => b.net_order - a.net_order);
  return {
    brand, months, signed, channel_weights: weights,
    count: rows.length, inactive_omitted: omitted, items: rows,
  };
};

// ---- stock placement -------------------------------------------------

const DEFAULT_TIERS = ['fast_mover', 'active', 'slow_mover', 'aging'];
const ALL_TIERS = [...DEFAULT_TIERS, 'critical', 'new_stock', 'dead_stock', 'undetermined'];
const NEW_TIERS = ['new_stock'];

/** The move that would cover the busiest three customer days seen.
 *  Three days, not one: a shelf holding one unit can never record a
 *  two-unit day, so the peak day is self-confirming. No floor -- a
 *  recommendation with no demand behind it is not a recommendation. */
const planMove = (motorCity, jebelAli, peak3d) =>
  Math.min(Math.max(0, (peak3d || 0) - (motorCity || 0)), jebelAli || 0);

export const getStockPlacement = async (scope = 'default') => {
  const tiers = { default: DEFAULT_TIERS, all: ALL_TIERS, new: NEW_TIERS }[scope];
  if (!tiers) throw new Error("scope must be 'default', 'all' or 'new'");
  await wait(scope === 'all' ? 1200 : 600);
  const rows = [];
  productItems.forEach((i) => {
    const health = healthByItem[i].UAE;
    if (!tiers.includes(health)) return;
    const { motor_city: mc, jebel_ali: ja } = uaeSplit[i];
    const f = itemFacts[i];
    const bc = f.byCountry.UAE;
    const move = planMove(mc, ja, f.peak3d);
    rows.push({
      item_code: items[i].item_code,
      item_name: items[i].item_name,
      brand: items[i].brand,
      health,
      valuation_rate: items[i].valuation_rate,
      motor_city: mc,
      jebel_ali: ja,
      peak: f.peakDay,
      peak_3d: f.peak3d,
      units_12m: num(Math.max(0, bc?.u12 || 0)),
      sale_days: bc ? bc.saleDays.size : 0,
      last_sale: bc?.lastSale != null ? isoDay(bc.lastSale) : null,
      move,
      move_value: num(move * items[i].valuation_rate),
    });
  });
  return { scope, rows };
};

export const getStockMonthly = async (item) => {
  await wait(180);
  return W.stockMonths(item);
};

// ---- material requests ----------------------------------------------

export const getMaterialRequests = () => cached('requests', 260, () => {
  const OWNERS = ['a.haddad@example.com', 'm.nasser@example.com', 'r.siddiq@example.com', 'k.farouk@example.com'];
  const NAMES = ['Aisha Haddad', 'Mo Nasser', 'Rami Siddiq', 'Kamal Farouk'];
  const rows = [];
  let seq = 0;
  // Requests skew to what is short: something already covered is not
  // what someone raises a request for.
  productItems.forEach((i) => {
    if (rows.length >= 240) return;
    const short = COUNTRIES.some((c) => stockByItem[i][c] === 0 && (itemFacts[i].byCountry[c]?.units || 0) > 0);
    if (!short && (i % 23) !== 0) return;
    seq += 1;
    const who = seq % OWNERS.length;
    const day = W.TOTAL_DAYS - ((seq * 13) % 160) - 3;
    const qty = 2 + ((seq * 7) % 40);
    const ordered = (seq % 4 === 0) ? Math.floor(qty / 2) : 0;
    rows.push({
      line_id: `MR-${1000 + seq}-1`,
      request_id: `MAT-MR-2026-${String(1000 + Math.floor(seq / 3)).padStart(5, '0')}`,
      item_code: items[i].item_code,
      item_name: items[i].item_name,
      brand: items[i].brand,
      transaction_date: isoDay(day),
      schedule_date: isoDay(day + 21),
      status: 'Submitted',
      country: COUNTRIES[seq % 3],
      owner: OWNERS[who],
      requested_by: NAMES[who],
      qty,
      ordered_qty: ordered,
      outstanding_qty: qty - ordered,
      uom: 'Nos',
      uae_stock: stockByItem[i].UAE,
      qat_stock: stockByItem[i].QAT,
      ksa_stock: stockByItem[i].KSA,
      valuation_rate: items[i].valuation_rate,
    });
  });
  rows.sort((a, b) => (a.transaction_date < b.transaction_date ? -1 : 1));
  return { requests: rows, loaded_at: LOADED_AT };
});

// ---- forecast snapshots (the only write path) ------------------------
//
// In-memory and per-session: a demo that let one visitor's override
// change what the next one sees would be a shared mutable deployment,
// not a demo. Reloading resets it, which is the honest behaviour here.

let snapshotSeq = 0;
const snapshots = [];

(function seedSnapshots() {
  const seeded = [
    ['Apexline', 3, 128], ['Caldera Exhaust', 12, 400], ['Nordkapp', 6, 220],
    ['Dunemark', 3, 40], ['Vesper Electric', 12, 380],
  ];
  seeded.forEach(([brand, months, daysAgo], k) => {
    snapshotSeq += 1;
    const committed = new Date(TODAY.getTime() - daysAgo * 86400000).toISOString();
    const lines = [];
    items.forEach((it, i) => {
      if (it.brand !== brand) return;
      const r = assemble(i, months, {});
      COUNTRIES.forEach((c) => {
        if (!r.velocity[c] && !r.stock[c]) return;
        const model = r.forecast[c];
        // Roughly a third of lines carry a manager override -- enough
        // for FVA to have something to measure, which is the whole point
        // of keeping both numbers rather than replacing one.
        const overridden = (i + c.length + k) % 3 === 0;
        lines.push({
          item_code: it.item_code,
          item_name: it.item_name,
          country: c,
          model_forecast: model,
          manager_forecast: overridden ? Math.max(0, Math.round(model * (1 + ((i % 7) - 3) * 0.14))) : null,
          stock: r.stock[c],
          valuation_rate: it.valuation_rate,
          method: r.velocity[c]?.method || 'wma-mid',
        });
      });
    });
    snapshots.push({
      id: snapshotSeq, brand, horizon_months: months,
      channel_weights: { Showroom: 1, Distribution: 1, Ecommerce: 1 },
      signed: false, status: 'committed', created_by: 'demo@runwayiq.example',
      created_at: committed, committed_at: committed, lines,
    });
  });
  // One open draft, so the "half-finished review is otherwise invisible"
  // case the Accuracy page exists to surface has something in it.
  snapshotSeq += 1;
  snapshots.push({
    id: snapshotSeq, brand: 'Halcyon Helmets', horizon_months: 3,
    channel_weights: { Showroom: 1, Distribution: 1, Ecommerce: 1 },
    signed: false, status: 'draft', created_by: 'demo@runwayiq.example',
    created_at: new Date(TODAY.getTime() - 4 * 86400000).toISOString(),
    committed_at: null, lines: [],
  });
}());

const header = (s) => ({
  id: s.id, brand: s.brand, horizon_months: s.horizon_months,
  channel_weights: s.channel_weights, signed: s.signed, status: s.status,
  created_by: s.created_by, created_at: s.created_at, committed_at: s.committed_at,
  line_count: s.lines.length,
  override_count: s.lines.filter((l) => l.manager_forecast != null).length,
});

/** What actually sold since the snapshot was committed, per line -- the
 *  measurement the whole feature exists for. */
function scoreSnapshot(s) {
  if (s.status !== 'committed' || !s.lines.length) return null;
  const start = W.isoToDay(s.committed_at.slice(0, 10));
  const horizonEnd = start + Math.round(s.horizon_months * 30.44);
  const windowEnd = Math.min(horizonEnd, W.TOTAL_DAYS);
  const matured = horizonEnd <= W.TOTAL_DAYS;

  const actuals = new Map();
  invoices.forEach((inv) => {
    if (inv.day < start || inv.day > windowEnd || inv.isReturn) return;
    inv.lines.forEach((ln) => {
      const k = `${items[ln.i].item_code}|${inv.country}`;
      actuals.set(k, (actuals.get(k) || 0) + ln.q);
    });
  });

  let modelAbs = 0; let managerAbs = 0; let modelSigned = 0; let managerSigned = 0;
  let managerWins = 0; let modelWins = 0; let ties = 0; let overridden = 0;
  const byMethod = new Map();
  const scored = s.lines.map((l) => {
    const actual = actuals.get(`${l.item_code}|${l.country}`) || 0;
    const model = Number(l.model_forecast || 0);
    const has = l.manager_forecast != null;
    const manager = has ? Number(l.manager_forecast) : model;
    const mErr = model - actual;
    const gErr = manager - actual;
    modelAbs += Math.abs(mErr); managerAbs += Math.abs(gErr);
    modelSigned += mErr; managerSigned += gErr;
    if (has) {
      overridden += 1;
      if (Math.abs(gErr) < Math.abs(mErr)) managerWins += 1;
      else if (Math.abs(gErr) > Math.abs(mErr)) modelWins += 1;
      else ties += 1;
    }
    const m = l.method || 'unknown';
    let bm = byMethod.get(m);
    if (!bm) { bm = { method: m, lines: 0, abs: 0, signed: 0, actual: 0 }; byMethod.set(m, bm); }
    bm.lines += 1; bm.abs += Math.abs(mErr); bm.signed += mErr; bm.actual += actual;
    return { ...l, actual: num(actual), model_error: num(mErr), manager_error: num(gErr) };
  });

  const n = s.lines.length || 1;
  return {
    matured,
    window_start: s.committed_at,
    window_end: `${isoDay(horizonEnd)}T00:00:00.000Z`,
    measured_through: `${isoDay(windowEnd)}T00:00:00.000Z`,
    line_count: s.lines.length,
    override_count: overridden,
    model_mae: num(modelAbs / n),
    manager_mae: num(managerAbs / n),
    model_bias: num(modelSigned / n),
    manager_bias: num(managerSigned / n),
    manager_wins: managerWins,
    model_wins: modelWins,
    ties,
    by_method: [...byMethod.values()]
      .map((m) => ({
        method: m.method,
        lines: m.lines,
        mae: num(m.abs / m.lines),
        bias: num(m.signed / m.lines),
        actual_units: num(m.actual),
        // Total error over total actual units. Comparable ACROSS
        // methods in a way MAE is not, and null rather than zero when
        // nothing sold -- dividing by no demand is undefined, not
        // perfect accuracy.
        wape: m.actual > 0 ? m.abs / m.actual : null,
      }))
      .sort((a, b) => b.lines - a.lines),
    // The per-line detail the verdict is built from -- the table that
    // explains it reads score.lines.
    lines: scored,
  };
}

export const getForecastSnapshots = async (brand) => {
  await wait(160);
  const rows = snapshots
    .filter((s) => !brand || s.brand === brand)
    .map(header)
    .sort((a, b) => {
      if ((a.status === 'draft') !== (b.status === 'draft')) return a.status === 'draft' ? -1 : 1;
      const ax = a.committed_at || a.created_at;
      const bx = b.committed_at || b.created_at;
      return ax < bx ? 1 : -1;
    });
  return { snapshots: rows };
};

/** { snapshot, lines, score } -- the header is NESTED, not spread, and
 *  the page reads detail.snapshot.status off it. */
export const getForecastSnapshot = async (id) => {
  await wait(260);
  const s = snapshots.find((x) => x.id === Number(id));
  if (!s) throw new Error('snapshot not found');
  const score = scoreSnapshot(s);
  return { snapshot: header(s), lines: score ? score.lines : s.lines, score };
};

/** { draft } -- null when the brand has no open draft, which is the
 *  ordinary case rather than an error. */
export const getOpenDraft = async (brand) => {
  await wait(120);
  const s = snapshots.find((x) => x.brand === brand && x.status === 'draft');
  return { draft: s ? { ...header(s), lines: s.lines } : null };
};

export const startForecastDraft = async (body) => {
  await wait(220);
  snapshotSeq += 1;
  const s = {
    id: snapshotSeq, brand: body.brand, horizon_months: body.months ?? 3,
    channel_weights: { Showroom: body.showroom ?? 1, Distribution: body.distribution ?? 1, Ecommerce: body.ecommerce ?? 1 },
    signed: !!body.signed, status: 'draft', created_by: 'demo@runwayiq.example',
    created_at: new Date().toISOString(), committed_at: null, lines: [],
  };
  snapshots.push(s);
  return { snapshot_id: s.id, snapshot: header(s), lines: [] };
};

export const setForecastOverride = async (id, body) => {
  await wait(90);
  const s = snapshots.find((x) => x.id === Number(id));
  if (!s) throw new Error('snapshot not found');
  const key = `${body.item_code}|${body.country}`;
  const existing = s.lines.find((l) => `${l.item_code}|${l.country}` === key);
  // null clears the override rather than setting zero -- zero is a real
  // claim, absence means the model stands.
  if (existing) existing.manager_forecast = body.manager_forecast;
  else s.lines.push({ ...body, method: 'wma-mid' });
  return { ...header(s) };
};

export const commitForecastSnapshot = async (id) => {
  await wait(520);
  const s = snapshots.find((x) => x.id === Number(id));
  if (!s) throw new Error('snapshot not found');
  // The MODEL's forecast is recomputed at commit, never taken from the
  // client -- the comparison this exists to make depends on it.
  const fresh = [];
  items.forEach((it, i) => {
    if (it.brand !== s.brand) return;
    const r = assemble(i, s.horizon_months, {});
    COUNTRIES.forEach((c) => {
      if (!r.velocity[c] && !r.stock[c]) return;
      const prior = s.lines.find((l) => l.item_code === it.item_code && l.country === c);
      fresh.push({
        item_code: it.item_code, item_name: it.item_name, country: c,
        model_forecast: r.forecast[c],
        manager_forecast: prior ? prior.manager_forecast ?? null : null,
        stock: r.stock[c], valuation_rate: it.valuation_rate,
        method: r.velocity[c]?.method || 'wma-mid',
      });
    });
  });
  s.lines = fresh;
  s.status = 'committed';
  s.committed_at = new Date().toISOString();
  return { ...header(s) };
};

export const discardForecastDraft = async (id) => {
  await wait(140);
  const i = snapshots.findIndex((x) => x.id === Number(id));
  if (i >= 0) snapshots.splice(i, 1);
  return { discarded: true };
};

export const captureModelBaseline = async () => {
  await wait(1800);
  const made = [];
  [3, 6, 12].forEach((months) => {
    snapshotSeq += 1;
    const lines = [];
    productItems.slice(0, 140).forEach((i) => {
      const r = assemble(i, months, {});
      COUNTRIES.forEach((c) => {
        if (!r.velocity[c] && !r.stock[c]) return;
        lines.push({
          item_code: items[i].item_code, item_name: items[i].item_name, country: c,
          model_forecast: r.forecast[c], manager_forecast: null,
          stock: r.stock[c], valuation_rate: items[i].valuation_rate,
          method: r.velocity[c]?.method || 'wma-mid',
        });
      });
    });
    const now = new Date().toISOString();
    snapshots.push({
      // brand === null is what marks a catalogue-wide model baseline:
      // the Accuracy page lists these apart from brand reviews, because
      // "is the model any good" and "were our decisions good" are
      // different questions and a handful of human reviews would
      // otherwise be buried among machine runs.
      id: snapshotSeq, brand: null, horizon_months: months,
      channel_weights: { Showroom: 1, Distribution: 1, Ecommerce: 1 }, signed: false,
      status: 'committed', created_by: 'demo@runwayiq.example',
      created_at: now, committed_at: now, lines,
    });
    made.push(snapshotSeq);
  });
  return { snapshots: made };
};

// ---- overview --------------------------------------------------------

function periodStats(fromDay, toDay) {
  let revenue = 0; let units = 0; let cogs = 0; let returned = 0;
  const markets = {}; const channels = {}; const brandMargin = {};
  invoices.forEach((inv) => {
    if (inv.legacy || inv.day < fromDay || inv.day > toDay) return;
    inv.lines.forEach((ln) => {
      const it = items[ln.i];
      if (!it.brand) return;
      const c = ln.q * it.valuation_rate;
      revenue += ln.amt; units += ln.q; cogs += c;
      // Returns are negative rows already folded into revenue above.
      // Tracked separately as well, because without it a brand
      // returning 15% looks identical to a clean one at the same net.
      if (inv.isReturn) returned += -ln.amt;
      markets[inv.country] = (markets[inv.country] || 0) + ln.amt;
      channels[inv.channel] = (channels[inv.channel] || 0) + ln.amt;
      brandMargin[it.brand] = (brandMargin[it.brand] || 0) + (ln.amt - c);
    });
  });
  const margin = revenue - cogs;
  return {
    revenue: num(revenue), units: num(units), margin: num(margin),
    margin_pct: revenue ? num((margin / revenue) * 100) : 0,
    per_unit: units ? num(revenue / units) : 0,
    returns_pct: revenue ? num((returned / revenue) * 100) : 0,
    markets, channels, brandMargin,
  };
}

function spark(fromDay, toDay, step) {
  const buckets = [];
  for (let d = fromDay; d <= toDay; d += step) buckets.push(d);
  const total = buckets.map(() => 0);
  const byMarket = {}; const byChannel = {};
  COUNTRIES.forEach((c) => { byMarket[c] = buckets.map(() => 0); });
  CHANNELS.forEach((c) => { byChannel[c] = buckets.map(() => 0); });
  invoices.forEach((inv) => {
    if (inv.legacy || inv.day < fromDay || inv.day > toDay) return;
    const k = Math.floor((inv.day - fromDay) / step);
    if (k < 0 || k >= buckets.length) return;
    inv.lines.forEach((ln) => {
      if (!items[ln.i].brand) return;
      total[k] += ln.amt;
      byMarket[inv.country][k] += ln.amt;
      byChannel[inv.channel][k] += ln.amt;
    });
  });
  const round = (a) => a.map(num);
  const mapped = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v)]));
  return {
    labels: buckets.map(isoDay),
    total: round(total),
    by_market: mapped(byMarket),
    by_channel: mapped(byChannel),
  };
}

export const getOverview = () => cached('overview', 560, () => {
  // The last COMPLETE month, not the partial one in progress -- a
  // headline that silently compares eleven days against thirty is the
  // thing this deliberately does not do.
  const y = TODAY.getUTCFullYear(); const mo = TODAY.getUTCMonth();
  const dayOfMonth = (yy, mm) => W.isoToDay(new Date(Date.UTC(yy, mm, 1)).toISOString().slice(0, 10));
  const monthEnd = dayOfMonth(y, mo) - 1;
  const monthStart = dayOfMonth(y, mo - 1);
  const priorStart = dayOfMonth(y, mo - 2);
  const qEnd = monthEnd;
  const qStart = monthEnd - 90;
  const qPriorStart = qStart - 91;
  const label = (d) => new Date(`${isoDay(d)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const basisFor = (cs, ce, ps, pe, lab, plab) => {
    const cur = periodStats(cs, ce);
    const pri = periodStats(ps, pe);
    const movers = Object.keys({ ...cur.brandMargin, ...pri.brandMargin })
      .map((k) => ({ key: k, delta: num((cur.brandMargin[k] || 0) - (pri.brandMargin[k] || 0)) }))
      .sort((a, b) => b.delta - a.delta);
    const strip = (s) => ({
      revenue: s.revenue, units: s.units, margin: s.margin,
      margin_pct: s.margin_pct, per_unit: s.per_unit, returns_pct: s.returns_pct,
    });
    return {
      label: lab,
      prior_label: plab,
      current: strip(cur),
      prior: strip(pri),
      markets: COUNTRIES.map((c) => ({ key: c, current: num(cur.markets[c] || 0), prior: num(pri.markets[c] || 0) })),
      channels: CHANNELS.map((c) => ({ key: c, current: num(cur.channels[c] || 0), prior: num(pri.channels[c] || 0) })),
      movers: { up: movers.slice(0, 5), down: movers.slice(-5).reverse() },
    };
  };

  let stockValue = 0; let l12mRevenue = 0; let l12mCogs = 0; let stockouts = 0;
  const tierCounts = {};
  productItems.forEach((i) => {
    COUNTRIES.forEach((c) => {
      const s = stockByItem[i][c];
      stockValue += s * items[i].valuation_rate;
      const bc = itemFacts[i].byCountry[c];
      const units = Math.max(0, bc?.u12 || 0);
      // Both sides of the turn come from the live feed, so "cost of sale
      // over stock at cost" is cost over cost across the same rows.
      l12mRevenue += Math.max(0, bc?.rev12 || 0);
      l12mCogs += Math.max(0, bc?.u12live || 0) * items[i].valuation_rate;
      if (s === 0 && units > 0) stockouts += 1;
      const t = healthByItem[i][c];
      if (t) tierCounts[t] = (tierCounts[t] || 0) + 1;
    });
  });
  // How long the cost base actually covers. Cost of sale exists only
  // from each market's cutover, so this is NOT twelve months -- it is
  // the priced window each market has, weighted by what each contributed.
  // Stated rather than assumed so months-on-hand inverts the turn over
  // the window that produced it instead of over a notional year.
  const revByCountry = {};
  productItems.forEach((i) => COUNTRIES.forEach((c) => {
    revByCountry[c] = (revByCountry[c] || 0) + Math.max(0, itemFacts[i].byCountry[c]?.rev12 || 0);
  }));
  const totalRev = Object.values(revByCountry).reduce((s, v) => s + v, 0);
  const costMonths = totalRev
    ? num(COUNTRIES.reduce((s, c) => {
      const covered = Math.min(365, W.TOTAL_DAYS - W.isoToDay(MARKETS[c].cutover));
      return s + (Math.max(0, covered) / 30.44) * (revByCountry[c] / totalRev);
    }, 0))
    : 12;
  const requests = memo.get('requests');

  return {
    basis: {
      month: basisFor(monthStart, monthEnd, priorStart, monthStart - 1, label(monthStart), label(priorStart)),
      quarter: basisFor(qStart, qEnd, qPriorStart, qStart - 1, 'Last quarter', 'Prior quarter'),
    },
    series: {
      month: spark(monthStart, monthEnd, 1),
      quarter: spark(qStart, qEnd, 7),
    },
    // A YEAR-MONTH, not a date -- the page appends "-01". Year-on-year
    // needs a full priced year in EVERY market, and the cutovers are
    // staggered, so this is the last market's cutover plus twelve
    // months. It is deliberately still in the future: saying when the
    // comparison becomes possible is more use than offering one that
    // silently compares a market against its own absence.
    yoy_available_from: isoDay(
      Math.max(...COUNTRIES.map((c) => W.isoToDay(MARKETS[c].cutover))) + 365,
    ).slice(0, 7),
    position: {
      stock_value: num(stockValue),
      l12m_revenue: num(l12mRevenue),
      l12m_cogs: num(l12mCogs),
      turns: stockValue ? num(l12mCogs / stockValue) : null,
      cost_months: costMonths,
      months_on_hand: l12mCogs && stockValue ? num(costMonths / (l12mCogs / stockValue)) : null,
      dead_stock_skus: tierCounts.dead_stock || 0,
      critical_skus: tierCounts.critical || 0,
    },
    queue: {
      net_order_value: num(stockValue * 0.19),
      net_order_skus: Math.round(productItems.length * 0.42),
      stockouts,
      request_lines: requests ? requests.requests.length : 118,
      request_units: requests ? requests.requests.reduce((s, r) => s + r.outstanding_qty, 0) : 2840,
      oldest_request: isoDay(W.TOTAL_DAYS - 157),
      open_drafts: snapshots.filter((s) => s.status === 'draft').length,
      snapshots: snapshots.length,
    },
    coverage: {
      skus: productItems.length * COUNTRIES.length,
      brands: W.BRANDS.length,
      sales_rows: invoices.reduce((s, inv) => s + inv.lines.length, 0),
      extended_months: MONTHS.length,
    },
    computed_at: LOADED_AT,
  };
});

// ---- item detail -----------------------------------------------------

export const getItem = async (code) => {
  await wait(80);
  const it = W.itemByCode(code);
  if (!it) throw new Error('item not found');
  const i = items.indexOf(it);
  const stock = {};
  COUNTRIES.forEach((c) => { stock[`${c.toLowerCase()}_stock`] = stockByItem[i][c]; });
  return {
    item_code: it.item_code, item_name: it.item_name, brand: it.brand,
    stock: { ...stock, valuation_rate: it.valuation_rate },
    categories: [], riding_styles: [],
  };
};

export { velocityFor, bucketsFor };
