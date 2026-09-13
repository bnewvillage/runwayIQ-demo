import { useState } from 'react';
import { matrix, totals } from './salesData.js';

/** A KPI that expands into its own market x channel matrix.
 *
 * The headline honours brand and horizon but not country/channel -- the
 * matrix IS the country/channel view, so filtering the number by them
 * first would leave one populated column. Collapsed by default: the
 * default reading of this page is an executive snapshot, and three
 * matrices open at once is a different page.
 *
 * `compute` runs per cell rather than the cell values being summed, so a
 * ratio like ASP is correct in every cell and in the totals. Summing a
 * ratio, or averaging averages, would be wrong in both.
 */

export default /** `view` is what the PAGE is currently showing -- the same object for
 *  every card in a group, because none of it describes this card. It was
 *  eight separate props repeated verbatim across six call sites, so
 *  adding a ninth meant editing seven places. */
function Kpi({ n, l, s, tone, cells, compute, fmt, matrixFmt, view = {} }) {
  const {
    narrowed, context, basis, scope,
    defaultOpen, fullMatrix, pickedCountries, pickedChannels,
  } = view;
  // Open by default where there is room for it: the breakdown is the
  // reason these cards are clickable at all, and on a wide screen hiding
  // it behind a click only asks for the click.
  //
  // State holds the OVERRIDE, not the state itself. A card the reader has
  // not touched follows the layout; one they have opened or closed keeps
  // their choice. Deriving it this way also avoids syncing defaultOpen in
  // an effect, which is a cascading render for something that is just a
  // fallback value.
  const [override, setOverride] = useState(null);
  const open = override ?? !!defaultOpen;
  const setOpen = (v) => setOverride(typeof v === 'function' ? v(open) : v);
  const expandable = !!(cells && compute && fmt);
  const m = open && expandable
    ? matrix(cells, compute, { full: fullMatrix, pickedCountries, pickedChannels })
    : null;
  // The matrix formats compactly even though the headline above it does
  // not: a KPI is read for its exact value, a grid cell for its shape.
  const cellFmt = matrixFmt || fmt;
  // The headline ignores country and channel by design, so the moment
  // either is selected it stops agreeing with the charts below it. The
  // narrowed figure sits beside it, named, rather than hiding one level
  // down behind a click -- a card the reader has to expand to find out
  // whether it moved is a card they have to expand every time.
  const narrow = narrowed && expandable
    ? { value: fmt(compute(totals(cells))), context }
    : null;

  return (
    <div className={'stock-kpi-tile' + (expandable ? ' stock-kpi-tile--action' : '') + (override && open ? ' selected' : '')
                    + (narrow ? ' stock-kpi-tile--narrowed' : '')}
         onClick={expandable ? () => setOpen((v) => !v) : undefined}
         role={expandable ? 'button' : undefined}
         tabIndex={expandable ? 0 : undefined}
         onKeyDown={expandable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } } : undefined}>
      {/* Every card names its own scope, split or not. The rules differ
          per card -- these ignore market and channel, order metrics have
          no brand dimension -- and a reader should not have to hold that
          in their head to know what a number in front of them covers.
          On a split card the brand and period ride on the measure name
          because they qualify both halves; only the market/channel
          difference goes under each figure. */}
      {narrow ? (
        <>
          <span className="stock-kpi-label stock-kpi-label--head">
            {l}{expandable ? (open ? ' \u25b2' : ' \u25bc') : ''}
            {basis && <span className="stock-kpi-basis"> · {basis}</span>}
          </span>
          <div className="stock-kpi-split">
            <div className="stock-kpi-half">
              <span className="stock-kpi-num" style={tone ? { color: `var(--${tone})` } : undefined}>{n}</span>
              <span className="stock-kpi-scope">on all markets and channels</span>
            </div>
            <div className="stock-kpi-half stock-kpi-half--narrow">
              <span className="stock-kpi-num">{narrow.value}</span>
              <span className="stock-kpi-scope">on {narrow.context}</span>
            </div>
          </div>
        </>
      ) : (
        <>
          <span className="stock-kpi-num" style={tone ? { color: `var(--${tone})` } : undefined}>{n}</span>
          <span className="stock-kpi-label">
            {l}{expandable ? (open ? ' \u25b2' : ' \u25bc') : ''}
          </span>
          {scope && <span className="stock-kpi-scope">on {scope}</span>}
        </>
      )}
      {s && <span className="stock-kpi-sub">{s}</span>}
      {m && (
        m.rows.length === 0
          ? <div className="kpi-matrix-empty">Nothing in the current filter.</div>
          : (
            <table className="kpi-matrix" onClick={(e) => e.stopPropagation()}>
              <thead>
                <tr>
                  <th />
                  {m.countries.map((c, i) => <th key={c}>{m.countryOn[i] ? c : ''}</th>)}
                  <th className="kpi-matrix-total">All</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.channel}>
                    <th>{r.on ? r.channel : ''}</th>
                    {r.cells.map((v, i) => (
                      <td key={m.countries[i]}>
                        {r.on && m.countryOn[i] ? cellFmt(v) : ''}
                      </td>
                    ))}
                    <td className="kpi-matrix-total">{r.on ? cellFmt(r.total) : ''}</td>
                  </tr>
                ))}
                <tr className="kpi-matrix-foot">
                  <th>All</th>
                  {m.columnTotals.map((v, i) => (
                    <td key={m.countries[i]}>{m.countryOn[i] ? cellFmt(v) : ''}</td>
                  ))}
                  <td className="kpi-matrix-total">{cellFmt(m.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          )
      )}
    </div>
  );
}
