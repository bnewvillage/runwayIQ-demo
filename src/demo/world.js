// =========================================================
// THE SYNTHETIC WORLD
//
// One invented business, generated once, from which every endpoint in
// demo/api.js is derived. Nothing here is real: the brands, items,
// customers, warehouses and every figure are fabricated.
//
// Why one world rather than a fixture per page: the real app's pages
// agree with each other because they read the same database. Canned
// per-page fixtures would drift the moment anyone looked at two pages
// at once -- Demand Glance claiming an item needs 40 units while Sales
// shows it never sold. So this builds a catalogue and an INVOICE LEDGER,
// and every aggregate the API serves is summed back out of that ledger,
// exactly as the backend sums its own.
//
// Deterministic in shape: one seed drives every draw, so the catalogue,
// the customers and the pattern of trade are identical on every machine
// and every reload. The one thing that is not fixed is the CLOCK -- the
// record is anchored to the day the page opens (see TODAY below), so a
// demo left up for a year still reads as a live system rather than one
// whose newest data point is eighteen months old. Day counts shift by a
// day here and there as the window slides; the world does not.
// =========================================================

// ---- seeded PRNG -----------------------------------------------------
// mulberry32: small, fast, good enough for plausible data. Seeded so the
// demo is a fixed world rather than a new one per reload.
function mulberry32(a) {
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260913);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));
/** Positive, right-skewed. Real catalogues are long-tailed in every
 *  dimension -- price, velocity, stock -- and a uniform draw looks
 *  instantly synthetic because nothing is ever an outlier. */
const skewed = (median, spread) => median * Math.exp((rnd() + rnd() + rnd() - 1.5) * spread);

// ---- the shape of the business --------------------------------------

export const COUNTRIES = ['UAE', 'QAT', 'KSA'];
export const CHANNELS = ['Showroom', 'Distribution', 'Ecommerce'];

/** Mirrors shared/forecast.py's CUSTOMER_GROUP_TO_CHANNEL. Key Accounts
 *  is deliberately absent there and so absent here. */
export const CUSTOMER_GROUP_TO_CHANNEL = {
  Individual: 'Showroom', VIP: 'Showroom', Customers: 'Showroom', 'Walk-In Customers': 'Showroom',
  'Market Place': 'Ecommerce', Amazon: 'Ecommerce', 'ruroc.ae': 'Ecommerce', Noon: 'Ecommerce',
  'Dealers and Distribution': 'Distribution', B2B: 'Distribution',
};
const GROUPS_BY_CHANNEL = CHANNELS.reduce((acc, ch) => {
  acc[ch] = Object.keys(CUSTOMER_GROUP_TO_CHANNEL)
    .filter((g) => CUSTOMER_GROUP_TO_CHANNEL[g] === ch);
  return acc;
}, {});

/** The world's clock.
 *
 *  Anchored to the day the page is opened, not to a date written into
 *  the source. The SHAPE is fixed -- the record is always the same 773
 *  days long, every market joins it at the same offset, and the seeded
 *  draws are identical -- but the labels move with the calendar, so the
 *  demo reads as a live system a year from now instead of one whose
 *  freshness badge has gone red and whose newest chart point is
 *  eighteen months old.
 *
 *  Every tier boundary, trailing-12-month window and "last sale N days
 *  ago" is measured from TODAY, so the whole thing stays internally
 *  consistent however far the real calendar has moved. */
const DAY = 86400000;
const SPAN_DAYS = 773;
export const TODAY = new Date(Math.floor(Date.now() / DAY) * DAY);
const EPOCH = new Date(TODAY.getTime() - SPAN_DAYS * DAY);
const dayOf = (d) => Math.round((d - EPOCH) / DAY);
const TOTAL_DAYS = SPAN_DAYS;
const dateAt = (dayIdx) => new Date(EPOCH.getTime() + dayIdx * DAY);
const iso = (d) => d.toISOString().slice(0, 10);

/** Each market's record begins on its own day, and hands over from a
 *  manual export to the live ERP feed on another -- the two are NOT the
 *  same date, which is the distinction CONTEXT.md draws between a data
 *  floor and a cutover. Value figures only exist above the cutover.
 *
 *  Held as offsets from the epoch rather than as dates, so the staggered
 *  market rollout survives the clock above sliding. */
const MARKET_OFFSETS = {
  UAE: { salesFrom: 0, cutover: 420, stockFloor: 365, share: 0.63 },
  QAT: { salesFrom: 184, cutover: 530, stockFloor: 457, share: 0.22 },
  KSA: { salesFrom: 365, cutover: 630, stockFloor: 518, share: 0.15 },
};
export const MARKETS = {};
const marketDays = {};
COUNTRIES.forEach((c) => {
  const o = MARKET_OFFSETS[c];
  MARKETS[c] = {
    salesFrom: iso(dateAt(o.salesFrom)),
    cutover: iso(dateAt(o.cutover)),
    // Snapped to a month start: a stock floor is the earliest month-end
    // balance that can be believed, and month-end balances land on
    // months rather than on arbitrary days.
    stockFloor: `${iso(dateAt(o.stockFloor)).slice(0, 7)}-01`,
    share: o.share,
  };
  marketDays[c] = { from: o.salesFrom, cutover: o.cutover };
});

/** Month starts from the epoch to today, as ISO first-of-month -- the
 *  grain every cube in the API uses. */
export const MONTHS = (() => {
  const out = [];
  const d = new Date(EPOCH);
  while (d <= TODAY) {
    out.push(iso(d));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
})();
const monthKey = (dayIdx) => `${dateAt(dayIdx).toISOString().slice(0, 7)}-01`;

// ---- the catalogue ---------------------------------------------------

/** Invented brands. Deliberately none of them real: the point of this
 *  repo is to show the tool without showing anyone's trading position. */
const BRAND_SPECS = [
  ['Apexline', 'helmet', 1650], ['Torqbar', 'control', 240], ['Velocrest', 'apparel', 780],
  ['Ridgeback Moto', 'luggage', 620], ['Nordkapp', 'apparel', 1420], ['Ironclad Armour', 'protection', 460],
  ['Stromwerk', 'electrical', 310], ['Lumaflux', 'lighting', 280], ['Kestrel Racing', 'engine', 540],
  ['Dunemark', 'tyre', 690], ['Pivotal Gear', 'control', 195], ['Vantage Moto', 'luggage', 880],
  ['Halcyon Helmets', 'helmet', 1180], ['Caldera Exhaust', 'exhaust', 2350], ['Ternwing', 'apparel', 520],
  ['Basalt Works', 'protection', 390], ['Meridian Chain', 'drivetrain', 265], ['Oryx Offroad', 'protection', 610],
  ['Pallas Optics', 'helmet', 340], ['Quarrymen Tools', 'workshop', 175], ['Redshift Moto', 'electrical', 430],
  ['Silt & Stone', 'apparel', 340], ['Tanager Filters', 'engine', 145], ['Umbra Ride', 'luggage', 405],
  ['Vesper Electric', 'electrical', 1950], ['Windrose Nav', 'electrical', 1290],
];

const FAMILY_WORDS = {
  helmet: ['Full-Face Helmet', 'Modular Helmet', 'Open-Face Helmet', 'Visor', 'Pinlock Insert', 'Cheek Pad Set', 'Helmet Liner'],
  apparel: ['Riding Jacket', 'Textile Trousers', 'Leather Glove', 'Summer Glove', 'Riding Boot', 'Base Layer', 'Rain Oversuit'],
  protection: ['Back Protector', 'Knee Guard', 'Chest Protector', 'Elbow Guard', 'Kidney Belt', 'Neck Brace'],
  luggage: ['Tail Bag', 'Pannier Case', 'Top Box', 'Tank Bag', 'Dry Roll Bag', 'Pannier Rack', 'Mounting Plate'],
  control: ['Brake Lever', 'Clutch Lever', 'Bar End', 'Handlebar Grip', 'Foot Peg Set', 'Gear Shifter', 'Mirror'],
  electrical: ['Comms Unit', 'Heated Grip Set', 'USB Charger', 'Battery Tender', 'Wiring Harness', 'Relay Kit', 'Action Camera Mount'],
  lighting: ['LED Auxiliary Light', 'Indicator Set', 'Tail Light', 'Light Bar Bracket', 'Fog Lamp'],
  engine: ['Oil Filter', 'Air Filter', 'Spark Plug', 'Clutch Kit', 'Radiator Guard', 'Oil Cooler'],
  exhaust: ['Slip-On Silencer', 'Full System', 'Link Pipe', 'DB Killer', 'Header Set'],
  drivetrain: ['Chain 520', 'Chain 525', 'Front Sprocket', 'Rear Sprocket', 'Chain & Sprocket Kit'],
  tyre: ['Sport Tyre 120/70', 'Sport Tyre 180/55', 'Adventure Tyre 90/90', 'Tube 21"', 'Puncture Kit'],
  workshop: ['Paddock Stand', 'Torque Wrench', 'Chain Lube', 'Brake Cleaner', 'Tyre Warmer Set'],
};
const VARIANTS = ['XS', 'S', 'M', 'L', 'XL', '2XL', 'Black', 'Anthracite', 'Sand', 'Red', 'Titanium', 'OS'];

/** Services: billed on the same invoices, but they carry NO brand, which
 *  is exactly how companies.product_sale_clause tells them apart. They
 *  exist here because the Demand Forecast page's whole reason for
 *  excluding them is that at a long horizon they otherwise take over the
 *  top of the list -- a claim the demo should be able to demonstrate. */
const SERVICES = [
  'Workshop Labour (per hour)', 'Tyre Fitting', 'Paint & Refinish (per hour)',
  'Recovery Service', 'Shipping & Handling', 'Diagnostics', 'Annual Service', 'Wheel Balancing',
];

const brandNames = BRAND_SPECS.map((b) => b[0]);
export const BRANDS = brandNames;

function makeCode(prefix, n) {
  // A grammar rather than a counter: real codes carry a family block and
  // a variant tail, and the tables here are laid out to fit those.
  return `${prefix}-${1000 + n * 7}-${intBetween(100, 999)}-${pick(['M', 'OS', 'EU', 'X'])}`;
}

export const items = [];
BRAND_SPECS.forEach(([brand, family, baseCost], bi) => {
  const prefix = brand.replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  const n = intBetween(22, 46);
  // Brands differ in size, and that size must NOT track the order they
  // are declared in -- otherwise every "biggest brand" list on every
  // page is really just this array's index, which reads as synthetic the
  // moment anyone looks at two of them.
  const brandScale = skewed(1, 0.85);
  // And they differ in what they EARN. One markup for every brand makes
  // GMROI a restatement of stock turn, which defeats the one figure that
  // puts margin and capital in the same fraction -- the whole point of
  // it is catching a brand that turns quickly on goods that earn
  // nothing. Some of these are genuinely not worth their shelf.
  const brandMarkup = between(1.1, 2.35);
  for (let i = 0; i < n; i += 1) {
    const word = pick(FAMILY_WORDS[family]);
    const variant = pick(VARIANTS);
    items.push({
      item_code: makeCode(prefix, items.length + i),
      item_name: `${brand} ${word}, ${variant}`,
      brand,
      family,
      valuation_rate: Math.round(skewed(baseCost, 0.55) * 100) / 100,
      // Long-tailed demand weight: a handful of items carry most of the
      // movement and most of the catalogue barely moves at all. The
      // cube here is not decoration -- it is what puts roughly a third
      // of stocked item/country pairs through a whole year without a
      // sale, which is what a parts catalogue actually looks like and
      // what makes the tiers below Slow Mover mean anything. Drawn per
      // item, so rank is independent of position in the catalogue.
      pop: brandScale * (Math.pow(rnd(), 3) + 0.003),
      markup: brandMarkup,
      brandIdx: bi,
    });
  }
});
SERVICES.forEach((name, i) => {
  items.push({
    item_code: `SRV-${9000 + i * 3}-000-OS`,
    item_name: name,
    brand: null,               // <- what makes it a service
    family: 'service',
    valuation_rate: 0,
    pop: between(1.6, 4.5),    // services sell constantly
    brandIdx: -1,
  });
});

/** Which markets an item is even sold into. Not every SKU reaches every
 *  market, which is why a country column is blank rather than zero. */
items.forEach((it) => {
  it.markets = COUNTRIES.filter((c, i) => i === 0 || rnd() < (c === 'QAT' ? 0.62 : 0.48));
  if (!it.markets.length) it.markets = ['UAE'];
});

const itemIndex = new Map(items.map((it, i) => [it.item_code, i]));
export const itemByCode = (code) => items[itemIndex.get(code)];

// ---- customers -------------------------------------------------------

const FIRST = ['Rashid', 'Omar', 'Yusuf', 'Layla', 'Hana', 'Karim', 'Salim', 'Noor', 'Tariq', 'Zaid',
  'Amina', 'Faris', 'Dana', 'Imran', 'Sara', 'Bilal', 'Mona', 'Adel', 'Rana', 'Khalid'];
const LAST = ['Haddad', 'Nasser', 'Farouk', 'Rahman', 'Siddiq', 'Mansour', 'Darwish', 'Kanaan',
  'Zayed', 'Oueida', 'Bakri', 'Sharif', 'Halabi', 'Traboulsi', 'Qasimi'];
const DEALERS = ['Gulf Moto Spares', 'Desert Wheels Trading', 'Northline Motorcycles', 'Al Sahra Auto Parts',
  'Coastal Rider Supply', 'Pearl Motorsport', 'Dune Runner Trading', 'Highway Parts Co',
  'Summit Two Wheels', 'Anvil Garage Supply', 'Falcon Ride Trading', 'Redsand Distributors'];

export const customers = [];
const customerPool = { Showroom: [], Distribution: [], Ecommerce: [] };

// Showroom: many small named accounts, plus the one aggregate row.
for (let i = 0; i < 150; i += 1) {
  const name = `${pick(FIRST)} ${pick(LAST)}${rnd() < 0.35 ? ` ${intBetween(500, 599)}${intBetween(1000000, 9999999)}` : ''}`;
  customers.push({ name, group: pick(GROUPS_BY_CHANNEL.Showroom), weight: skewed(1, 0.8) });
  customerPool.Showroom.push(customers.length - 1);
}
// Walk-in: one row standing in for thousands of anonymous shop sales.
// NOT_ACCOUNTS in the real API excludes it from customer rankings, and
// the demo carries it so that exclusion has something to bite on.
customers.push({ name: 'Walk-in', group: 'Walk-In Customers', weight: 26 });
customerPool.Showroom.push(customers.length - 1);

DEALERS.forEach((name) => {
  customers.push({ name, group: pick(GROUPS_BY_CHANNEL.Distribution), weight: skewed(1, 0.7) });
  customerPool.Distribution.push(customers.length - 1);
});

// A marketplace that is also a real buyer -- most of the Ecommerce
// baseline sits on it, which is what makes the channel's average order
// worth reading separately from the showroom's.
customers.push({ name: 'souqmoto.ae', group: 'Market Place', weight: 38 });
customerPool.Ecommerce.push(customers.length - 1);
for (let i = 0; i < 22; i += 1) {
  customers.push({ name: `${pick(FIRST)} ${pick(LAST)}`, group: pick(GROUPS_BY_CHANNEL.Ecommerce), weight: skewed(1, 0.6) });
  customerPool.Ecommerce.push(customers.length - 1);
}
export const NOT_ACCOUNTS = ['Walk-in'];

// ---- the invoice ledger ---------------------------------------------
//
// The single source of truth. Every sales figure the API serves is
// summed back out of this, so the cube, the item table, the customer
// panel and the basket tuples cannot disagree about what happened.

/** Weighted sampling over a country's sellable items. Built once per
 *  country as a cumulative array, then binary-searched -- 20k lines
 *  against 600 items is otherwise the slowest thing in the build. */
function sampler(pool) {
  const cum = [];
  let total = 0;
  pool.forEach((idx) => { total += items[idx].pop; cum.push(total); });
  return () => {
    const target = rnd() * total;
    let lo = 0; let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1; else hi = mid;
    }
    return pool[lo];
  };
}
const poolByCountry = {};
COUNTRIES.forEach((c) => {
  poolByCountry[c] = sampler(items.map((it, i) => (it.markets.includes(c) ? i : -1)).filter((i) => i >= 0));
});

/** Seasonality plus a gentle growth trend, so the charts have a shape
 *  and the forecast models have something to actually find. */
function seasonality(dayIdx) {
  const month = dateAt(dayIdx).getUTCMonth();
  // Ramadan/Eid and the autumn riding season lift; deep summer sags.
  const wave = 1 + 0.22 * Math.sin((month / 12) * Math.PI * 2 + 1.1);
  const summerDip = (month === 6 || month === 7) ? 0.72 : 1;
  const growth = 1 + (dayIdx / TOTAL_DAYS) * 0.45;
  return wave * summerDip * growth;
}

/** Four promotional windows. They exist because shared/promo_days.py
 *  exists: a rule that trims promotional spikes has nothing to prove
 *  against data that never spikes. */
const PROMO_OFFSETS = [
  ['Annual Sale', null, 116, 121],
  ['Ramadan Offer', null, 225, 235],
  ['Annual Sale', null, 480, 486],
  ['Ramadan Offer', null, 579, 589],
  ['KSA Launch Promo', 'KSA', 638, 644],
];
export const PROMO_EVENTS = PROMO_OFFSETS.map(([name, country, s, e]) => ({
  // Named from the year it actually lands in, since the calendar slides.
  name: name === 'KSA Launch Promo' ? name
    : `${name} ${dateAt(s).getUTCFullYear()}`,
  country,
  start: iso(dateAt(s)),
  end: iso(dateAt(e)),
}));
const promoDays = new Set();
PROMO_OFFSETS.forEach(([, country, s, e]) => {
  for (let d = s; d <= e; d += 1) promoDays.add(`${country || '*'}|${d}`);
});
const isPromo = (country, dayIdx) =>
  promoDays.has(`*|${dayIdx}`) || promoDays.has(`${country}|${dayIdx}`);

export const invoices = [];
let invoiceSeq = 0;

COUNTRIES.forEach((country) => {
  const m = marketDays[country];
  const base = MARKETS[country].share;
  for (let d = m.from; d <= TOTAL_DAYS; d += 1) {
    const dow = dateAt(d).getUTCDay();
    // Friday is the quiet day in this market; Saturday is the busiest.
    const dowFactor = dow === 5 ? 0.45 : dow === 6 ? 1.35 : 1;
    const promo = isPromo(country, d) ? 3.4 : 1;
    const expected = 11.5 * base * seasonality(d) * dowFactor * promo;
    const count = Math.floor(expected + rnd());
    for (let k = 0; k < count; k += 1) {
      const r = rnd();
      const channel = r < 0.72 ? 'Showroom' : r < 0.88 ? 'Distribution' : 'Ecommerce';
      const pool = customerPool[channel];
      // Weighted by customer size, so concentration is real and the
      // top-customers panel has something to rank.
      let ci = pool[Math.floor(rnd() * pool.length)];
      if (rnd() < 0.45) {
        let bestW = -1;
        for (let t = 0; t < 3; t += 1) {
          const cand = pool[Math.floor(rnd() * pool.length)];
          if (customers[cand].weight > bestW) { bestW = customers[cand].weight; ci = cand; }
        }
      }
      const nLines = channel === 'Distribution'
        ? intBetween(2, 9)
        : (rnd() < 0.62 ? 1 : intBetween(2, 4));
      const lines = [];
      const seen = new Set();
      for (let l = 0; l < nLines; l += 1) {
        const ii = poolByCountry[country]();
        if (seen.has(ii)) continue;
        seen.add(ii);
        const it = items[ii];
        const qty = channel === 'Distribution'
          ? intBetween(2, 14)
          : (rnd() < 0.78 ? 1 : intBetween(2, 4));
        // The brand's own markup, discounted by channel: Distribution is
        // sold nearest cost, Ecommerce sits between. This is what makes
        // the two channels' margins genuinely different rather than
        // decoratively so -- Distribution's average order is several
        // times Showroom's and earns a fraction of the rate.
        const channelFactor = channel === 'Distribution' ? 0.66
          : channel === 'Ecommerce' ? 0.88 : 1;
        const markup = 1 + (it.markup - 1) * channelFactor * between(0.85, 1.15);
        const unitPrice = it.brand
          ? it.valuation_rate * markup
          : between(120, 480);            // services are priced, not stocked
        lines.push({ i: ii, q: qty, amt: Math.round(qty * unitPrice * 100) / 100 });
      }
      if (!lines.length) continue;
      // Returns: real negative rows in the ledger, already folded into
      // every revenue figure -- which is why Sales Analytics reports a
      // return rate at all.
      const isReturn = rnd() < 0.018;
      if (isReturn) lines.forEach((ln) => { ln.q = -ln.q; ln.amt = -ln.amt; });
      const legacy = d < m.cutover;
      if (legacy && channel === 'Distribution') {
        // The pre-cutover export priced Showroom and Ecommerce but
        // essentially not Distribution. This is the single fact that
        // forces Sales Analytics and Sales Extended to be two pages.
        lines.forEach((ln) => { if (rnd() < 0.914) ln.amt = 0; });
      }
      invoiceSeq += 1;
      invoices.push({
        id: legacy
          ? `ACC-SINV-${country}QB-${String(invoiceSeq).padStart(5, '0')}`
          : `ACC-SINV-2026-${String(invoiceSeq).padStart(5, '0')}`,
        day: d,
        country,
        channel,
        group: customers[ci].group,
        customer: ci,
        legacy,
        isReturn,
        lines,
      });
    }
  }
});

// ---- per-item sales facts -------------------------------------------
//
// Walked once out of the ledger rather than recomputed per endpoint:
// health tiers, placement peaks and the forecast all need the same
// per-item history, and three separate walks is three chances to
// disagree about when something last sold.

export const itemFacts = items.map(() => ({
  lastSale: null, firstSale: null, units12m: 0, saleDays: new Set(),
  byCountry: {}, peakDay: 0, dayUnits: new Map(),
}));

const CUST_DAY_CUTOFF = TOTAL_DAYS - 365;
invoices.forEach((inv) => {
  inv.lines.forEach((ln) => {
    const f = itemFacts[ln.i];
    const c = inv.country;
    if (!f.byCountry[c]) {
      f.byCountry[c] = {
        units: 0, revenue: 0, lastSale: null, saleDays: new Set(), months: new Set(),
        // Trailing twelve months, kept apart from the all-time figures
        // above and split again by source. Units are counted over every
        // source; VALUE only over the live feed, because the pre-cutover
        // export did not price every channel -- pairing its unpriced
        // lines with a real cost is what turns a profitable brand into a
        // negative-margin one on paper.
        u12: 0, u12live: 0, rev12: 0,
      };
    }
    const bc = f.byCountry[c];
    bc.units += ln.q;
    bc.revenue += ln.amt;
    if (inv.day >= CUST_DAY_CUTOFF) {
      bc.u12 += ln.q;
      if (!inv.legacy) { bc.u12live += ln.q; bc.rev12 += ln.amt; }
    }
    if (!inv.isReturn) {
      if (bc.lastSale == null || inv.day > bc.lastSale) bc.lastSale = inv.day;
      bc.saleDays.add(inv.day);
      bc.months.add(monthKey(inv.day));
      if (f.lastSale == null || inv.day > f.lastSale) f.lastSale = inv.day;
      if (f.firstSale == null || inv.day < f.firstSale) f.firstSale = inv.day;
      f.saleDays.add(inv.day);
      if (inv.day >= CUST_DAY_CUTOFF) f.units12m += ln.q;
      // Customer-channel daily peak for stock placement. Distribution is
      // excluded deliberately: its order sizes are an order of magnitude
      // larger and stocking the showroom floor against them is exactly
      // the mistake shared/stock_placement.py refuses to make.
      if (inv.channel !== 'Distribution' && c === 'UAE' && !isPromo(c, inv.day)) {
        const prev = f.dayUnits.get(inv.day) || 0;
        f.dayUnits.set(inv.day, prev + ln.q);
      }
    }
  });
});

// Peak day and peak three-day window -- the placement rule's input.
itemFacts.forEach((f) => {
  const days = [...f.dayUnits.entries()].sort((a, b) => a[0] - b[0]);
  let peak = 0;
  days.forEach(([, q]) => { if (q > peak) peak = q; });
  f.peakDay = peak;
  let best = 0;
  for (let i = 0; i < days.length; i += 1) {
    let sum = 0;
    for (let j = i; j < days.length && days[j][0] - days[i][0] <= 2; j += 1) sum += days[j][1];
    if (sum > best) best = sum;
  }
  f.peak3d = best;
});

// ---- stock -----------------------------------------------------------
//
// Stock is NOT derived from the ledger -- a shelf is a position, not a
// flow, and deriving it would make every item's stock a function of how
// much it sold, which is the one relationship the whole app exists to
// examine. So it is generated independently and then allowed to
// disagree: overstocked slow movers, stocked-out fast movers.

export const stockByItem = items.map((it, i) => {
  const f = itemFacts[i];
  const out = {};
  COUNTRIES.forEach((c) => {
    if (!it.markets.includes(c) || !it.brand) { out[c] = 0; return; }
    // Sized as WEEKS OF COVER against the trailing year's own rate,
    // rather than as a multiple of lifetime sales. The distinction is
    // what makes the derived ratios land in a believable range: cover
    // is the quantity a buyer actually reasons in, and turn and GMROI
    // are just it inverted.
    const sold12 = Math.max(0, f.byCountry[c]?.u12 || 0);
    const r = rnd();
    const cover = r < 0.12 ? 0                  // stocked out
      : r < 0.32 ? between(1, 5)                // thin -- reorder now
        : r < 0.82 ? between(8, 26)             // two to six months
          : between(35, 95);                    // badly overbought
    // A base holding independent of sales, so the never-sold tail has
    // real units and real value. Dead stock with no units would make
    // every tier below Slow Mover worth nothing, which is the opposite
    // of why anyone looks at it.
    const base = sold12 === 0 ? intBetween(0, 9) : intBetween(0, 3);
    out[c] = Math.round((sold12 * cover) / 52) + (r < 0.12 ? 0 : base);
  });
  return out;
});

/** Units received over the trailing year -- the denominator of
 *  sell-through. Independent of stock and of sales for the same reason
 *  as above: the gap between them is the finding. */
export const receivedByItem = items.map((it, i) => {
  if (!it.brand) return 0;
  const sold = Math.max(0, itemFacts[i].units12m);
  const held = COUNTRIES.reduce((s, c) => s + stockByItem[i][c], 0);
  return Math.round(Math.max(0, sold * between(0.55, 1.5) + held * between(0.1, 0.5)));
});

/** When the item is first known to have been in a market. Drives the
 *  never-sold half of the health ladder, which CONTEXT.md notes is the
 *  MAJORITY path into every tier below Slow Mover. */
export const arrivalByItem = items.map((it, i) => {
  const out = {};
  COUNTRIES.forEach((c) => {
    if (!it.markets.includes(c) || stockByItem[i][c] === 0) { out[c] = null; return; }
    const floor = dayOf(new Date(`${MARKETS[c].stockFloor}T00:00:00Z`));
    const first = itemFacts[i].byCountry[c]?.lastSale;
    out[c] = Math.max(floor, Math.min(first ?? TOTAL_DAYS, TOTAL_DAYS - intBetween(5, 700)));
  });
  return out;
});

// ---- health tiers ----------------------------------------------------
//
// A port of shared/stock_health.py's classify_health. Both halves of the
// ladder -- sold-and-stopped, and never-sold -- because grading only the
// selling path was false for 81.5% of Aging in the real data.

const L3M = 90; const L6M = 180; const L12M = 365;

function classifyHealth(country, i) {
  const it = items[i];
  if (!it.brand) return null;
  const stock = stockByItem[i][country];
  const bc = itemFacts[i].byCountry[country];
  const watchedFrom = marketDays[country].from;
  if (stock === 0 && !bc) return null;                 // never here, nothing to grade
  const last = bc?.lastSale ?? null;

  if (last != null) {
    const age = TOTAL_DAYS - last;
    if (age <= L3M) {
      // Rhythm, not volume: how regularly it sold, not how much.
      const recent = [...bc.saleDays].filter((d) => d > TOTAL_DAYS - L3M);
      const windows = new Set(recent.map((d) => Math.floor((TOTAL_DAYS - d) / 14)));
      const months = new Set(recent.map((d) => monthKey(d)));
      if (windows.size >= 5) return 'fast_mover';
      if (months.size >= 2) return 'active';
      return 'slow_mover';
    }
    if (age <= L6M) return 'aging';
    if (age <= L12M) return 'critical';
    // Fell through twelve months: graded on the never-sold ladder below.
  }

  const arrived = arrivalByItem[i][country];
  if (arrived == null) return stock > 0 ? 'undetermined' : null;
  // The watched window: a market's sales record starts when it starts,
  // and a tier resting on NOT having sold can only speak to the overlap.
  // This understates how long stock has sat, which is the safe direction.
  const here = TOTAL_DAYS - Math.max(arrived, watchedFrom);
  if (here < L3M) return 'new_stock';
  if (here < L6M) return 'aging';
  if (here < L12M) return 'critical';
  return 'dead_stock';
}

export const healthByItem = items.map((it, i) => {
  const out = {};
  COUNTRIES.forEach((c) => { out[c] = classifyHealth(c, i); });
  return out;
});

// ---- warehouses (UAE placement) -------------------------------------
//
// Motor City is the showroom and its stockroom -- one physical location,
// which is why both count as "here". Jebel Ali is the warehouse thirty
// minutes away, which is why its stock is not.

export const uaeSplit = items.map((it, i) => {
  const total = stockByItem[i].UAE;
  if (!total) return { motor_city: 0, jebel_ali: 0 };
  // The finding the page exists for: most of the movers' units sit
  // offsite. Skewed hard toward Jebel Ali on purpose.
  const share = rnd() < 0.2 ? between(0.5, 1) : between(0, 0.28);
  const mc = Math.round(total * share);
  return { motor_city: mc, jebel_ali: total - mc };
});

// ---- monthly stock snapshots ----------------------------------------
//
// Generated per item on demand -- 600 items x 3 markets x 26 months is
// 47k rows the demo would otherwise build to serve one chart at a time.

const snapshotCache = new Map();
export function stockMonths(code) {
  if (snapshotCache.has(code)) return snapshotCache.get(code);
  const i = itemIndex.get(code);
  const out = [];
  if (i != null) {
    COUNTRIES.forEach((c) => {
      const floor = MARKETS[c].stockFloor;
      const end = stockByItem[i][c];
      if (!items[i].markets.includes(c)) return;
      // A seeded walk that lands on today's actual figure, so the chart
      // and the table cannot disagree about what is on the shelf now.
      const r = mulberry32(i * 131 + c.charCodeAt(0));
      const months = MONTHS.filter((m) => m >= floor);
      let v = Math.max(0, end + Math.round((r() - 0.3) * end * 1.4));
      months.forEach((m, k) => {
        const t = k / Math.max(1, months.length - 1);
        const drift = v * (1 - t) + end * t;
        v = Math.max(0, Math.round(drift + (r() - 0.5) * Math.max(2, end * 0.25)));
        out.push({ year_month: m, country: c, units: k === months.length - 1 ? end : v,
          value: Math.round((k === months.length - 1 ? end : v) * items[i].valuation_rate * 100) / 100 });
      });
    });
  }
  out.sort((a, b) => (a.year_month < b.year_month ? -1 : a.year_month > b.year_month ? 1 : 0));
  const floors = {};
  COUNTRIES.forEach((c) => { floors[c] = MARKETS[c].stockFloor; });
  const res = { points: out, floors };
  snapshotCache.set(code, res);
  return res;
}

// ---- helpers the API layer needs ------------------------------------

export const dayToIso = (d) => iso(dateAt(d));
export const isoToDay = (s) => dayOf(new Date(`${s}T00:00:00Z`));
export const monthOf = monthKey;
export const productItems = () => items.filter((it) => it.brand);
export { marketDays, TOTAL_DAYS, GROUPS_BY_CHANNEL };
