import { RATES } from './constants.js';

/** Formats an AED value in the active currency (whole units). Real currency
 * codes via Intl.NumberFormat, matching the sibling app's fmtCurrency --
 * not a manual symbol prefix. */
export function fmtCurrency(valueAED, currency = 'AED') {
  const converted = (valueAED || 0) * (RATES[currency] ?? 1);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(converted);
}

/** Same value, clipped to a magnitude suffix: 34,146,818 -> AED 34M.
 *
 * For dense grids, where the full figure is what actually breaks the
 * layout. AED is the worst case -- Intl has no narrow form for it, so
 * every currencyDisplay option returns the three-letter code (29.3px
 * against 8.1px for the euro sign) -- but seven- and eight-digit numbers
 * overflow a narrow column in any currency, so this clips regardless of
 * which one is selected rather than special-casing one.
 *
 * Deliberately NOT used for headline figures: a KPI is read for its exact
 * value and has the room for it. This is for cells that must fit a
 * column, where a reader wants the shape of the number, not its last
 * four digits.
 */
export function fmtCurrencyCompact(valueAED, currency = 'AED') {
  const converted = (valueAED || 0) * (RATES[currency] ?? 1);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: Math.abs(converted) >= 1e6 ? 1 : 0,
  }).format(converted);
}

export function fmtNum(val) {
  return Math.round(val || 0).toLocaleString('en-US');
}

/** Demand quantity with a leading + for positives, plain 0 for zero. */
export function fmtQty(val) {
  const n = Math.round(val || 0);
  if (n > 0) return `+${n}`;
  if (n < 0) return `${n}`;
  return '0';
}

export function fmtWeeks(w) {
  if (w == null) return null;
  if (w > 99) return '99+';
  if (w < 1) return '<1';
  return w.toFixed(1);
}

/** Pipeline timestamps come back as UTC (TIMESTAMPTZ). Rendered in the
 * viewer's own timezone rather than raw UTC -- readers are spread across
 * UAE/QAT/KSA and shouldn't have to do the offset arithmetic to work out
 * whether the data in front of them is this morning's or yesterday's. */
export function fmtDateTimeLocal(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  });
}
