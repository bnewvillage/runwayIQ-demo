// Pure logic for the Overview page -- sibling to OverviewPage.jsx per
// CONTEXT.md's convention.
//
// Almost nothing is computed here. The pipeline already decided which
// month is complete, which quarter, and what a partial September
// disqualifies (pipeline/build_overview.py). Re-deriving any of that
// would be a second opinion nobody asked for, and the two would drift.
// What this module owns is presentation policy: how a change is
// described, and what the page says about a figure.

/** Percentage change, or null when there is nothing to compare against.
 *
 * Null rather than 0: "no prior period" and "flat" are different facts,
 * and rendering them identically invents a comparison never made. */
export function deltaPct(current, previous) {
  const p = Number(previous);
  if (previous == null || !Number.isFinite(p) || p === 0) return null;
  return (Number(current) / p - 1) * 100;
}

/** "+32.7%" / "-4.1%" / null. Signed always -- an unsigned percentage
 *  beside a figure reads as a share of it. */
export function fmtDelta(pct) {
  if (pct == null || !Number.isFinite(pct)) return null;
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
}

/** Days between an ISO date and now, floored at 0. Mirrors the Requests
 *  page's ageDays so the two cannot disagree about an age. */
export function ageDays(iso, now = new Date()) {
  if (!iso) return null;
  const days = Math.floor((now - new Date(`${iso}T00:00:00Z`)) / 86400000);
  return days < 0 ? 0 : days;
}

/** An SVG path through a series, scaled to its own min and max.
 *
 * Its own range, not a shared one: these lines carry no axes and no
 * labels, so they say "this is the shape of the month" and nothing
 * about magnitude. Two lines side by side are NOT comparable in height
 * and are not meant to be -- the figure beside each one carries the
 * size.
 *
 * A flat series draws through the middle rather than along the floor,
 * which is what a zero-range scale would otherwise produce.
 */
export function sparkPath(values, width = 100, height = 28) {
  const nums = (values || []).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return '';
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min;
  const step = width / (nums.length - 1);
  return nums.map((v, i) => {
    const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
    return `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

/** The eight tools, ordered by how much a decision is waiting in each.
 *
 * Demand Glance first because it holds the order decision; Baskets last
 * because it is exploratory. Baskets carries NO figure -- there is no
 * honest single number for co-purchase affinity without computing it,
 * and a number invented to fill a grid is what this page exists not to
 * do.
 */
// `value: null` when there is nothing yet, never undefined -- the page
// renders a placeholder at the size the real figure will take, and a
// clean contract is what lets that be asserted rather than assumed.
export function tools(d) {
  const q = d?.queue;
  const cov = d?.coverage;
  const pos = d?.position;
  const oldest = ageDays(q?.oldest_request);
  return [
    {
      to: '/demand-glance',
      name: 'Demand Glance',
      value: q ? { money: q.net_order_value } : null,
      note: q ? `to order · ${q.net_order_skus.toLocaleString()} SKUs` : 'what to order',
    },
    {
      to: '/stock-analysis',
      name: 'Stock Analysis',
      value: q ? { count: q.stockouts } : null,
      note: pos ? 'stock-outs · health by brand' : 'stock health',
    },
    {
      to: '/requests',
      name: 'Requests',
      value: q ? { count: q.request_lines } : null,
      // 90 days is the Requests page's own staleness rule, not a
      // threshold invented here.
      note: oldest != null ? `oldest unmet · ${oldest} days` : 'pending purchases',
      warn: oldest != null && oldest > 90,
    },
    {
      to: '/sales',
      name: 'Sales Analytics',
      value: d?.basis?.month ? { money: d.basis.month.current.revenue } : null,
      note: d?.basis?.month ? `${d.basis.month.label} · value & margin` : 'value & margin',
    },
    {
      to: '/sales-extended',
      name: 'Sales Extended',
      value: cov ? { plain: `${cov.extended_months} mo` } : null,
      note: 'unit history · full record',
    },
    {
      to: '/forecast-accuracy',
      name: 'Forecast Accuracy',
      value: q ? { count: q.snapshots } : null,
      note: q ? `snapshots · ${q.open_drafts} open drafts` : 'how the model scored',
      warn: !!q?.open_drafts,
    },
    {
      to: '/forecast',
      name: 'Forecast Analytics',
      value: cov ? { count: cov.brands } : null,
      note: 'brands · run a review',
    },
    { to: '/basket', name: 'Baskets', value: null, note: 'what sells together' },
  ];
}

/** Rows for the "what moved" band, newest period against the prior. */
export function movement(rows = []) {
  return rows.map((r) => ({
    key: r.key,
    current: Number(r.current),
    prior: Number(r.prior),
    pct: deltaPct(r.current, r.prior),
  }));
}

/** One sentence naming what the movement rows add up to.
 *
 * A summary that leaves the reader to derive the conclusion is not a
 * summary -- but the sentence has to be built from the data rather than
 * written once, or it becomes a caption that stops being true. */
export function movementNote(rows, noun = 'market') {
  const m = movement(rows).filter((r) => r.pct != null);
  if (!m.length) return null;
  const down = m.filter((r) => r.pct < 0);
  const up = [...m].sort((a, b) => b.pct - a.pct)[0];
  if (!down.length) return `Every ${noun} grew. ${up.key} led at ${fmtDelta(up.pct)}.`;
  if (down.length === 1) {
    return `${down[0].key} is the only ${noun} down, at ${fmtDelta(down[0].pct)}. `
      + `${up.key} grew fastest at ${fmtDelta(up.pct)}.`;
  }
  return `${down.length} ${noun}s fell. ${up.key} grew fastest at ${fmtDelta(up.pct)}.`;
}
