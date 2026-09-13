import { Fragment } from 'react';
import {
  BRAND_SLOTS, formatMeasure, isRatio, vsMedian, versusRows,
} from './brandData.js';

// The versus matrix: measures down, brands across, benchmark last.
//
// One component covers both states. With a single brand picked it renders
// a deep dive -- the same rows, but the space four columns would have
// taken goes to the caveat each row carries. Those notes are the reason
// the page is allowed to put two sources in one table, so they are part
// of the model rather than something a reader is expected to remember.

function Chip({ row, value, med }) {
  if (!isRatio(row.key)) return null;
  const v = vsMedian(value, med, row.key);
  if (!v) return null;
  return (
    <span className={'ba-chip' + (v.tone ? ' ba-chip--' + v.tone : '')}
          title="against the portfolio median">
      {v.signed
        ? `${v.points > 0 ? '+' : ''}${v.points.toFixed(1)} pts`
        : (v.ratio >= 1 ? `${v.ratio.toFixed(1)}x` : `${(v.ratio * 100).toFixed(0)}%`)}
    </span>
  );
}

const BASIS_NOTE = {
  priced: 'priced ERP feed only',
  full: 'full recorded history, including pre-cutover',
};

export default function BaVersus({ rows, bench, currency, showBenchmark }) {
  const groups = versusRows();
  const deep = rows.length === 1;

  return (
    <div className="chart-card chart-card--fill ba-versus">
      <div className="chart-title-row">
        <div className="chart-title">
          {deep ? rows[0].brand : `${rows.length} brands compared`}
          <span className="chart-title-note">
            {' · '}
            {deep
              ? 'against the portfolio median'
              : 'ticked brands as columns, portfolio median last'}
          </span>
        </div>
      </div>

      <div className="tablewrap tablewrap-fill">
        <table className="fa-table ba-matrix">
          <thead>
            <tr className="sub-row">
              <th className="col-name">Measure</th>
              {rows.map((r, i) => (
                <th key={r.brand} className="n">
                  <span className={'dot dot-' + BRAND_SLOTS[i]} />{r.brand}
                </th>
              ))}
              {showBenchmark && (
                <th className="n blk-start" title={`median or total of ${bench.n} brands`}>
                  Portfolio
                  <div className="ba-th-sub">median &middot; total of {bench.n}</div>
                </th>
              )}
              {deep && <th className="ba-why">Basis</th>}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.group}>
                <tr className="group-row">
                  <td colSpan={rows.length + 1 + (showBenchmark ? 1 : 0) + (deep ? 1 : 0)}>
                    {g.group}
                    <span className="ba-group-note">{' · '}{g.note}</span>
                  </td>
                </tr>
                {g.rows.map((row) => {
                  const ratio = isRatio(row.key);
                  const med = bench.medians[row.key];
                  return (
                    <tr key={row.key} className="item-row">
                      <td className="col-name">
                        {row.label}
                        {row.basis === 'full' && <span className="ba-basis" title={BASIS_NOTE.full}>†</span>}
                      </td>
                      {rows.map((r) => (
                        <td key={r.brand} className={'n' + (r[row.key] == null ? ' zero' : '')}>
                          {formatMeasure(r[row.key], row.kind, currency)}
                          {showBenchmark && <Chip row={row} value={r[row.key]} med={med} />}
                        </td>
                      ))}
                      {showBenchmark && (
                        <td className="n blk-start">
                          {formatMeasure(
                            ratio ? med : bench.totals[row.key], row.kind, currency,
                          )}
                        </td>
                      )}
                      {deep && (
                        <td className="ba-why small">
                          {row.basis ? BASIS_NOTE[row.basis] : ''}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {deep && rows[0].inStock && rows[0].inCube && (
        <div className="note-inline ba-reconcile">
          <b>Trailing-year revenue, both ways.</b>{' '}
          Priced ERP feed <b>{formatMeasure(rows[0].revenue, 'money', currency)}</b>;
          full recorded history <b>{formatMeasure(rows[0].shsRevenue, 'money', currency)}</b>.
          The second includes trade from before this market&rsquo;s feed became
          authoritative, and is the basis of the two ratios marked &dagger;.
          Everything else on this page uses the first.
        </div>
      )}

      <div className="small ba-foot">
        &dagger; unit ratios come from the full record, where legacy quantities are
        reliable. Money ratios are recomputed on the priced feed, because legacy
        value is not &mdash; the precomputed GMROI it would otherwise use runs
        negative for at least one profitable brand.
      </div>
    </div>
  );
}
