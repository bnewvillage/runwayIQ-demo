/** One share card per dimension, carrying a figure per active measure.
 *
 * Two figures rather than a card each: revenue share and unit share are
 * the same split of the same sales, and reading them beside each other
 * inside one frame is the comparison worth making.
 *
 * `bars` picks the form. A donut is fine in the standard layout, where
 * the card sizes to its contents. In the wide layout every card lives in
 * a fixed grid cell, and a ring can only use height it also has width
 * for -- so a taller cell just padded the circle. Bars use whatever shape
 * the cell is, and put the labels and figures on a common baseline.
 *
 * Either way, clicking a segment filters the page by it, and the card
 * keeps showing every category (it ignores its own dimension) so it stays
 * usable as a selector. */
export default function ShareCard({
  dimLabel, rows, selected, onToggle, measures, fmtFor, fmtShortFor, className, bars,
}) {
  const keys = [...measures].sort();
  const Figure = bars ? ShareBars : DonutFigure;
  return (
    <div className={'chart-card' + (className ? ' ' + className : '')}>
      <div className="chart-title">Share · {dimLabel}</div>
      <div className={bars ? 'share-figs' : 'donut-figs'}>
        {keys.map((mkey) => (
          <Figure key={mkey} label={mkey === 'revenue' ? 'Revenue' : 'Units'}
                  rows={rows[mkey]} selected={selected} onToggle={onToggle}
                  fmt={fmtFor(mkey)}
                  fmtShort={fmtShortFor ? fmtShortFor(mkey) : fmtFor(mkey)}
                  compact={keys.length > 1} />
        ))}
      </div>
    </div>
  );
}

/** A category's colour comes from the category, not from its position in
 *  the list: --mkt-uae, --mkt-showroom and so on. Using a rotating tone
 *  palette meant the first market and the first channel were both green,
 *  so the same colour meant two different things one card apart. */
const colourOf = (key) => `var(--mkt-${String(key).toLowerCase()}, var(--ink-dim))`;

function ShareBars({ label, rows, selected, onToggle, fmt, fmtShort }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) {
    return (
      <div className="share-fig">
        <div className="share-fig-label">{label}</div>
        <div className="chart-empty">No sales in scope.</div>
      </div>
    );
  }
  // Columns scale against the LARGEST category, not the total: at a
  // 3/22/75 split, scaling by total leaves the two smaller columns as
  // stubs with no readable difference between them. The share of the
  // total is printed under every column, so nothing is lost.
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="share-fig">
      <div className="share-fig-label">{label}</div>
      <div className="share-bars">
        {rows.map((r) => (
          <button key={r.key}
                  className={'share-bar' + (selected.includes(r.key) ? ' active' : '')}
                  style={{ opacity: selected.length && !selected.includes(r.key) ? 0.45 : 1 }}
                  title={`${r.key} · ${fmt(r.value)}`}
                  onClick={() => onToggle(r.key)}>
            {/* Compact above the column -- a column is ~120px wide and
                "AED 29,269,293" was being cut to "AED …". The exact
                figure is on the hover title, and in the table beside. */}
            <span className="share-bar-value">{fmtShort(r.value)}</span>
            <span className="share-bar-col">
              <span className="share-bar-fill"
                    style={{ height: `${(r.value / max) * 100}%`,
                             background: colourOf(r.key) }} />
            </span>
            <span className="share-bar-key">{r.key}</span>
            <span className="share-bar-pct">{(r.value / total * 100).toFixed(1)}%</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function DonutFigure({ label, rows, selected, onToggle, fmt, compact }) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (!total) {
    return (
      <div className="donut-fig">
        <div className="donut-fig-label">{label}</div>
        <div className="chart-empty">No sales in scope.</div>
      </div>
    );
  }
  const R = 60, C = 2 * Math.PI * R;
  // Cumulative arc offsets via a scan rather than a running variable --
  // no reassignment during render, which the linter rightly rejects
  // because it breaks under a re-render nobody expected.
  const fracs = rows.map((r) => r.value / total);
  const arcs = rows.map((r, i) => ({
    ...r,
    frac: fracs[i],
    offset: fracs.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  return (
    <div className="donut-fig">
      <div className="donut-fig-label">{label}</div>
      <div className={'donut-wrap' + (compact ? ' donut-wrap--compact' : '')}>
        <div className="donut-ring">
          <svg viewBox="0 0 160 160" className="donut">
            {arcs.map((r) => (
              <circle key={r.key} cx="80" cy="80" r={R} fill="none"
                      stroke={colourOf(r.key)} strokeWidth="22"
                      strokeDasharray={`${r.frac * C} ${C - r.frac * C}`}
                      strokeDashoffset={-r.offset * C}
                      opacity={selected.length && !selected.includes(r.key) ? 0.3 : 1}
                      style={{ cursor: 'pointer' }}
                      onClick={() => onToggle(r.key)} />
            ))}
          </svg>
        </div>
        <div className="donut-legend">
          {rows.map((r) => (
            <button key={r.key}
                    className={'donut-legend-item' + (selected.includes(r.key) ? ' active' : '')}
                    onClick={() => onToggle(r.key)}>
              <span className="tier-dot" style={{ background: colourOf(r.key) }} />
              {r.key} <strong>{fmt(r.value)}</strong>
              <span className="donut-pct">{(r.value / total * 100).toFixed(1)}%</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
