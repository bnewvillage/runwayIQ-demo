import { BRAND_SLOTS, formatMeasure, isRatio } from './brandData.js';

// The ranked table. Presentational: every figure arrives already derived
// and already sorted, so this file decides nothing about the numbers.
//
// The last row is the benchmark, pinned. It is what gives every share in
// the table above a visible denominator -- a column of percentages whose
// base is somewhere off screen is the thing this page exists to stop.

const GROUPS = ['Sales', 'Stock', 'Efficiency'];

export default function BaLeaderboard({
  rows, columns, sort, onSort, picked, onToggle, search, onSearch,
  bench, currency, maxPicked, collapsed,
}) {
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  const full = picked.length >= maxPicked;

  return (
    <div className={'chart-card chart-card--fill' + (collapsed ? ' ba-board--collapsed' : '')}>
      <div className="chart-title-row">
        <div className="chart-title">
          Brands
          <span className="chart-title-note">
            {' · '}{rows.length} in view, tick up to {maxPicked} to compare
          </span>
        </div>
        <input
          className="input ba-search"
          placeholder="Find a brand"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      <div className="tablewrap tablewrap-cap">
        <table className="fa-table ba-table">
          <thead>
            <tr className="group-row">
              <th /><th />
              {GROUPS.map((g) => (
                <th key={g} className="blk-start"
                    colSpan={columns.filter((c) => c.group === g).length}>{g}</th>
              ))}
            </tr>
            <tr className="sub-row">
              <th className="ba-tick" />
              <th className="col-name sortable" onClick={() => onSort('brand')}>
                Brand<span className="sort-arrow">{arrow('brand')}</span>
              </th>
              {columns.map((c, i) => (
                <th key={c.key}
                    className={'n sortable' + (columns[i - 1]?.group !== c.group ? ' blk-start' : '')}
                    onClick={() => onSort(c.key)}>
                  {c.label}<span className="sort-arrow">{arrow(c.key)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const slot = picked.indexOf(r.brand);
              const on = slot >= 0;
              return (
                <tr key={r.brand}
                    className={'item-row' + (on ? ' selected' : '')}
                    onClick={() => onToggle(r.brand)}>
                  <td className="ba-tick">
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && full}
                      title={!on && full ? `Four brands is the most that compares legibly` : undefined}
                      onChange={() => onToggle(r.brand)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
                  <td className="col-name">
                    <span className="ba-brand-name">
                      {on && <span className={'dot dot-' + BRAND_SLOTS[slot]} />}
                      {r.brand}
                    </span>
                    <span className="share-track">
                      <span className="share-fill"
                            style={{ width: `${Math.min(100, (r.revShare || 0) * 100)}%` }} />
                    </span>
                    {!r.inStock && <span className="ba-flag">no stock</span>}
                    {!r.inCube && <span className="ba-flag">no priced sales</span>}
                  </td>
                  {columns.map((c, i) => (
                    <td key={c.key}
                        className={'n' + (columns[i - 1]?.group !== c.group ? ' blk-start' : '')
                          + (r[c.key] == null ? ' zero' : '')}>
                      {formatMeasure(r[c.key], c.kind, currency)}
                      {c.key === 'lflPct' && r.lflPct != null && r.lflExcluded?.length > 0 && (
                        <span className="ba-mark"
                              title={`${r.lflExcluded.join(', ')} excluded: no priced revenue in the prior quarter to compare against`}>
                          &middot;
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="total">
              <td className="ba-tick" />
              <td className="col-name">Portfolio &middot; {bench.n} brands</td>
              {columns.map((c, i) => {
                const ratio = isRatio(c.key);
                const v = ratio ? bench.medians[c.key] : bench.totals[c.key];
                return (
                  <td key={c.key}
                      className={'n' + (columns[i - 1]?.group !== c.group ? ' blk-start' : '')}
                      title={ratio ? 'median of the brands in view' : 'total of the brands in view'}>
                    {c.key === 'revShare' || c.key === 'valueShare'
                      ? '100%'
                      : formatMeasure(v, c.kind, currency)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="small ba-foot">
        Ratios in the last row are the <b>median</b> of the {bench.n} brands in view;
        totals are their <b>sum</b>. A median of a total would just be the
        middle-sized brand, which the ranking above already shows.
      </div>
    </div>
  );
}
