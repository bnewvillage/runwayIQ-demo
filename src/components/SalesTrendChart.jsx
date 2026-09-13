import { useEffect, useRef, useState } from 'react';
import { fmtCurrency, fmtNum } from '../lib/format.js';

// Reusable line chart for weekly sales-shaped data -- one series per key
// (country or channel, anything with a {key, label, dot} shape), an
// optional dashed forward projection per key. Extracted out of Forecast
// Analytics specifically so a future Sales page can reuse it without
// duplicating the SVG geometry: this component only draws whatever
// series/projected values it's handed, with no opinion on whether
// they're raw sales or a smoothed trend -- that choice lives in the
// caller (see ForecastAnalyticsPage's raw/trend toggle).
export default function SalesTrendChart({
  series, keys, title, mode, currency, projected, emptyMessage, labels,
  // The OTHER measure for the same points. A reader looking at a units
  // line almost always wants to know what it was worth, and vice versa;
  // carrying both in the tooltip answers that without a second chart or
  // a mode switch.
  alt,
  // Clicking a point drills the page down to that period. Optional --
  // a chart that is not driving a filter simply does not pass it.
  onPick, picked,
  // Hover can be lifted to the caller so sibling charts move together:
  // market and channel plot the same months, and reading one against
  // the other means finding the same column twice by hand otherwise.
  // Uncontrolled when the caller passes nothing, which is how the
  // forecast pages still use it.
  hover: hoverProp, onHover,
  // Month-end stock for the same points, drawn as a second panel below
  // the sales one and growing DOWNWARD from a shared baseline. Shaped
  // {series, keys, mode} exactly like the props above it.
  //
  // Optional, and absent on most charts by design: stock has no channel
  // dimension (a shelf balance cannot be split between Showroom and
  // Ecommerce), and no grain finer than a month, so a channel cut or a
  // zoomed daily axis simply passes nothing and draws as it always did.
  mirror,
  // Draw to the height of the wrapper instead of a fixed 220px band.
  // Only ever set where the card HAS a definite height -- otherwise
  // the wrapper would size to the svg and the svg to the wrapper.
  fill,
}) {
  const [ownHover, setOwnHover] = useState(null);
  // Absolute or share-of-total, per chart. Local rather than lifted: the
  // market and channel charts sit side by side and are read against each
  // other, but they are different cuts, and there is no reason one has
  // to answer the same question as the other.
  const [share, setShare] = useState(false);
  // The viewBox tracks the measured width instead of being fixed at 900,
  // so one SVG unit is one CSS pixel and the drawing does NOT scale with
  // the container. A fixed viewBox plus width:100% meant a wider card
  // was a proportionally TALLER card -- widening the page added 65px of
  // scroll rather than removing any. Extra width now buys horizontal
  // room for the same 220px-tall plot, which is what it is for.
  const boxRef = useRef(null);
  const [boxW, setBoxW] = useState(900);
  const [boxH, setBoxH] = useState(220);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setBoxW(Math.max(320, w));
      const h = Math.round(entry.contentRect.height);
      if (h > 0) setBoxH(Math.max(160, h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const controlled = onHover != null;
  const hover = controlled ? (hoverProp ?? null) : ownHover;
  const setHover = controlled ? onHover : setOwnHover;
  const countries = keys;
  const weekCount = Math.max(0, ...countries.map((c) => (series[c.key] || []).length));
  // The sum of every series at each point. A point stays null only when
  // NO series has a value there -- a market that has not started yet
  // contributes nothing rather than voiding the whole column.
  const totalAt = Array.from({ length: weekCount }, (_, i) => {
    const vals = countries.map((c) => (series[c.key] || [])[i]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, v) => a + Number(v), 0) : null;
  });
  // A single series is already its own total, so drawing it again would
  // just trace the same line in grey.
  const showTotal = countries.length > 1
    && countries.filter((c) => (series[c.key] || []).some((v) => v > 0)).length > 1;
  const hasData = countries.some((c) => (series[c.key] || []).some((v) => v > 0));
  // The point the readout describes: whatever the mouse is over, else
  // the most recent one -- the value a reader wants by default anyway.
  const focus = hover != null ? hover : (weekCount > 0 ? weekCount - 1 : null);
  if (!weekCount || !hasData) {
    return (
      <div className="chart-card">
        <div className="chart-title">{title}</div>
        <div className="chart-empty">{emptyMessage || 'No sales in this window for the current filters.'}</div>
      </div>
    );
  }
  // weeksAhead is the same for every key (it's just the selected horizon
  // converted to weeks, or the trend's own extrapolation window) -- read
  // it off whichever entry exists.
  const weeksAhead = projected ? Object.values(projected)[0]?.weeksAhead || 0 : 0;
  const totalWeeks = weekCount - 1 + weeksAhead;
  const W = boxW, H = fill ? boxH : (mirror ? 310 : 220), padB = 20, padT = 10, padR = 10;
  const plotH = H - padT - padB;
  // Sales above, stock below, sharing the x axis and the crosshair but
  // never a scale. A flow (units sold in a month) and a level (units on
  // the shelf at month end) are not comparable in magnitude -- one axis
  // for both flattens whichever is smaller into the floor. The split
  // favours sales because stock is the context here, not the subject.
  const MIRROR_GAP = 16;
  const bandH = mirror ? plotH - MIRROR_GAP : plotH;
  const topH = mirror ? bandH * 0.62 : plotH;
  const botH = mirror ? bandH * 0.38 : 0;
  const baseY = padT + topH + MIRROR_GAP;

  // Share mode replots each series as its percentage of that point's
  // total. It answers a different question -- who is carrying the
  // business rather than how much there was -- and it is the only way
  // the smaller markets are legible at all: against one ten times their
  // size they are drawn, but pinned to the axis floor.
  //
  // It also HIDES absolute movement: a month where everything fell
  // together is flat here. That is why it is a toggle and not the
  // default, and why the readout below keeps showing the real figure.
  const projTotal = projected
    ? countries.reduce((a, c) => a + (projected[c.key]?.value || 0), 0) : 0;
  const asShare = (v, t) => (v == null || !t ? null : (v / t) * 100);
  const plot = share
    ? Object.fromEntries(countries.map((c) => [c.key,
      (series[c.key] || []).map((v, i) => asShare(v, totalAt[i]))]))
    : series;
  const plotProjected = share && projected
    ? Object.fromEntries(countries.map((c) => [c.key, projected[c.key] && {
      ...projected[c.key], value: asShare(projected[c.key].value, projTotal),
    }]))
    : projected;
  const maxV = share ? 100 : Math.max(
    1,
    ...countries.map((c) => Math.max(...(series[c.key] || [0]))),
    ...(showTotal ? totalAt.filter((v) => v != null) : []),
    ...(projected ? countries.map((c) => projected[c.key]?.value || 0) : []),
  );
  const yFor = (v) => padT + topH - (v / maxV) * topH;
  // The mirror's own scale, computed from its own values only. Its
  // series carry nulls below a market's stock floor (see
  // lib/stockHistory.js) and those are skipped rather than read as zero
  // -- a warehouse nobody had counted yet is unknown stock, and a zero
  // there would both drag this maximum and draw a restocking ramp that
  // never happened.
  const mKeys = mirror?.keys || [];
  const mVals = mKeys.flatMap((c) => (mirror.series[c.key] || []).filter((v) => v != null));
  // Unlike the sales total above, a partial sum here is NOT allowed. The
  // sales total treats a market that has not started yet as contributing
  // nothing, which is true. A stock total cannot: a market missing from
  // a month is a shelf nobody counted, not an empty one, so summing the
  // rest and plotting it beside months that include it draws a step up
  // when the missing market joins -- bookkeeping wearing the shape of
  // restocking. The total exists only where every market has a figure.
  const mTotalAt = mirror
    ? Array.from({ length: weekCount }, (_, i) => {
      const vals = mKeys.map((c) => (mirror.series[c.key] || [])[i]);
      return vals.some((v) => v == null)
        ? null
        : vals.reduce((a, v) => a + Number(v), 0);
    })
    : [];
  const showMTotal = mKeys.length > 1;
  const maxM = Math.max(1, ...mVals, ...(showMTotal ? mTotalAt.filter((v) => v != null) : []));
  // Downward from the shared baseline: the reader's eye reads depth
  // below the line as stock the same way height above it reads as sales.
  const yForM = (v) => baseY + (v / maxM) * botH;
  const fmtMirror = (v) => (mirror?.mode === 'value' ? fmtCurrency(v, currency) : fmtNum(v));
  // Currency ONLY when the caller explicitly says the series is money.
  // The test used to be `mode === 'qty'`, which meant any unrecognised
  // mode fell through to currency -- and both sales pages pass 'units',
  // so unit charts were drawing an AED axis over quantities. Defaulting
  // the other way is also just safer: mislabelling counts as money is a
  // worse failure than rendering money without its symbol.
  const fmtAxis = (v) => (mode === 'value' ? fmtCurrency(v, currency) : fmtNum(v));
  const fmtPlot = (v) => (share ? Math.round(v) + '%' : fmtAxis(v));
  // Sparse x labels for wide windows (mid/long tier can be 26-52 weeks
  // of history, plus however many projected weeks extend past "now").
  const labelEvery = Math.max(1, Math.ceil((totalWeeks + 1) / 8));

  // The gutter is sized to the widest label it has to hold, not fixed.
  // It was 52px, which fits "AED 9,417" and clips "AED 22,618" to
  // "D 22,618" -- a plausible-looking number that is wrong by an order
  // of magnitude, which is worse than an obviously broken one. The
  // mirror made it routine: a shelf holds many months of sales, so its
  // axis carries the larger figures of the two.
  //
  // 5.6px per character at 9px in the mono stack, plus the 8px the
  // labels are already inset by. Clamped so a pathological value cannot
  // eat the plot.
  const axisTexts = [fmtPlot(maxV), fmtPlot(maxV / 2), fmtPlot(0)]
    .concat(mirror ? [fmtMirror(maxM), fmtMirror(maxM / 2)] : []);
  const padL = Math.min(96, Math.max(52,
    Math.round(10 + 5.6 * Math.max(...axisTexts.map((t) => String(t).length)))));
  const plotW = W - padL - padR;
  const xFor = (i) => padL + (totalWeeks <= 0 ? 0 : (i / totalWeeks) * plotW);

  return (
    <div className="chart-card">
      <div className="chart-title">{title}</div>
      <div className="chart-legend">
        {countries.map((c) => <span key={c.key} className="chart-legend-item"><span className={'dot dot-' + c.dot} />{c.label}</span>)}
        {projected && weeksAhead > 0 && (
          <span className="chart-legend-item"><span className="dash-swatch" />Projected ({weeksAhead}w)</span>
        )}
        {showTotal && !share && (
          <span className="chart-legend-item"><span className="total-swatch" />Total</span>
        )}
        {/* The lower panel needs naming -- an unlabelled second line is
            a puzzle, not context. Same market colours as the panel
            above, so only the measure has to be stated. */}
        {mirror && (
          <span className="chart-legend-item chart-legend-item--mirror">
            <span className="mirror-swatch" />
            {mirror.label || 'Stock on hand'}
          </span>
        )}
        {showTotal && (
          <button type="button"
                  className={'btn-toggle btn-toggle--mini' + (share ? ' active' : '')}
                  onClick={() => setShare((v) => !v)}
                  title={share
                    ? 'Back to absolute values'
                    : 'Plot each series as its share of the total'}>
            {share ? 'Values' : 'Share'}
          </button>
        )}
      </div>
      {/* height:auto, not a fixed 220px. With a fixed height the viewBox
          aspect (900:220) no longer matched the container's, so the
          default preserveAspectRatio letterboxed the plot and left dead
          space either side. Scaling by width keeps it filling the card. */}
      <div ref={boxRef} className="chart-plot">
      <svg viewBox={`0 0 ${W} ${H}`}
           style={{ width: '100%', height: fill ? '100%' : 'auto', display: 'block' }}
           onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => {
          const y = padT + topH - f * topH;
          return (
            <g key={f}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--edge-soft)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)">{fmtPlot(f * maxV)}</text>
            </g>
          );
        })}
        {/* A ground for the lower panel. Without it the stock lines read
            as four more sales series that happen to sit lower down --
            same colours, same shapes, and a 16px gap is not enough to
            say "different measure, different scale". The tint does that
            work; the axis labels then confirm it. */}
        {mirror && (
          <rect x={padL} y={baseY} width={W - padL - padR} height={botH}
                fill="var(--ink)" opacity="0.035" />
        )}
        {/* The mirror's own axis. Its labels sit in the same gutter as
            the sales axis above, so the two scales are read the same
            way; only the direction differs. */}
        {mirror && [0.5, 1].map((f) => {
          const y = yForM(f * maxM);
          return (
            <g key={'m' + f}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="var(--edge-soft)" strokeWidth="1" />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)">{fmtMirror(f * maxM)}</text>
            </g>
          );
        })}
        {mirror && (
          <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--edge)" strokeWidth="1" />
        )}
        {/* `labels` lets a caller supply real dates for each point. Without
            it the axis falls back to offsets from now ("-12w"), which is
            right for the forecast page -- there the question is "how far
            back", not "which month". On a sales page the reader wants the
            month, and counting backwards from now to find it is work the
            chart should do. */}
        {Array.from({ length: totalWeeks + 1 }, (_, i) => i).filter((i) => i % labelEvery === 0).map((i) => (
          <text key={i} x={xFor(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--ink-faint)" fontFamily="var(--font-mono)">
            {labels
              ? (labels[i] ?? '')
              : (i === weekCount - 1 ? 'now' : i < weekCount - 1 ? `-${weekCount - 1 - i}w` : `+${i - (weekCount - 1)}w`)}
          </text>
        ))}
        {/* One full-height hit area per point, so hovering anywhere in a
            column selects it -- chasing a 2.5px circle with the mouse is
            a poor target and gets worse as the series lengthens. */}
        {Array.from({ length: weekCount }, (_, i) => i).map((i) => (
          <rect key={`hit${i}`} x={xFor(i) - (plotW / Math.max(1, totalWeeks)) / 2} y={padT}
                width={plotW / Math.max(1, totalWeeks)} height={plotH}
                fill="transparent" onMouseEnter={() => setHover(i)}
                style={onPick ? { cursor: 'pointer' } : undefined}
                onClick={onPick ? () => onPick(i) : undefined} />
        ))}
        {picked != null && picked !== hover && (
          <line x1={xFor(picked)} y1={padT} x2={xFor(picked)} y2={padT + plotH}
                stroke="var(--info)" strokeWidth="1" />
        )}
        {hover != null && (
          <line x1={xFor(hover)} y1={padT} x2={xFor(hover)} y2={padT + plotH}
                stroke="var(--edge)" strokeWidth="1" />
        )}
        {/* Behind the series, not in front: it is context for them, and
            it crosses above the tallest one. Dashed and faint so it
            reads as a backdrop rather than a fourth market. */}
        {showTotal && !share && (
          <polyline
            points={totalAt.map((v, i) => (v == null ? null : xFor(i) + ',' + yFor(v)))
              .filter(Boolean).join(' ')}
            fill="none" stroke="var(--ink-faint)" strokeWidth="1.5"
            strokeDasharray="5 4" opacity="0.7" />
        )}
        {countries.map((c) => {
          const vals = plot[c.key] || [];
          const pts = vals.map((v, i) => `${xFor(i)},${yFor(v)}`).join(' ');
          const color = `var(--mkt-${c.dot})`;
          const proj = plotProjected?.[c.key];
          return (
            <g key={c.key}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
              {vals.map((v, i) => <circle key={i} cx={xFor(i)} cy={yFor(v)} r="2.5" fill={color} />)}
              {proj && proj.weeksAhead > 0 && vals.length > 0 && (
                <line
                  x1={xFor(weekCount - 1)} y1={yFor(vals[weekCount - 1] || 0)}
                  x2={xFor(weekCount - 1 + proj.weeksAhead)} y2={yFor(proj.value)}
                  stroke={color} strokeWidth="2" strokeDasharray="5 4" opacity="0.75"
                />
              )}
            </g>
          );
        })}
        {/* Drawn last so the crosshair and hit areas sit behind it, and
            at a lighter weight than the sales lines above: this panel
            answers "did we replace it", which is the follow-up question,
            not the one the card is titled with. */}
        {mirror && showMTotal && (
          <polyline
            points={mTotalAt.map((v, i) => (v == null ? null : xFor(i) + ',' + yForM(v)))
              .filter(Boolean).join(' ')}
            fill="none" stroke="var(--ink-faint)" strokeWidth="1.5"
            strokeDasharray="5 4" opacity="0.7" />
        )}
        {mKeys.map((c) => {
          const vals = mirror.series[c.key] || [];
          const color = `var(--mkt-${c.dot})`;
          // Split into runs of consecutive non-null points. One
          // polyline over the whole series would bridge a floor gap with
          // a straight line, which is exactly the invented history the
          // nulls exist to prevent.
          const runs = [];
          let run = [];
          vals.forEach((v, i) => {
            if (v == null) { if (run.length) runs.push(run); run = []; return; }
            run.push(`${xFor(i)},${yForM(v)}`);
          });
          if (run.length) runs.push(run);
          return (
            <g key={'m' + c.key} opacity="0.85">
              {runs.map((r, i) => (
                <polyline key={i} points={r.join(' ')} fill="none"
                          stroke={color} strokeWidth="1.5" strokeDasharray="1 0" />
              ))}
              {vals.map((v, i) => (v == null ? null
                : <circle key={i} cx={xFor(i)} cy={yForM(v)} r="2" fill={color} />))}
            </g>
          );
        })}
      </svg>
      </div>
      {/* Always rendered, reading the last point until the mouse picks
          another. Appearing on hover made the card grow and everything
          below it jump -- a lot of motion to pay for a readout the
          chart has room for permanently. */}
      {focus != null && (
        <div className="trend-tip">
          <span className="trend-tip-when">
            {labels ? labels[focus] : `${weekCount - 1 - focus}w ago`}
          </span>
          {showTotal && !share && totalAt[focus] != null && (
            <span className="trend-tip-row trend-tip-row--total">
              <span className="total-swatch" />
              <span className="trend-tip-key">Total</span>
              <span className="trend-tip-val">{fmtAxis(totalAt[focus])}</span>
            </span>
          )}
          {mirror && mKeys.length > 0 && (
            <span className="trend-tip-row trend-tip-row--mirror">
              <span className="mirror-swatch" />
              <span className="trend-tip-key">{mirror.label || 'Stock on hand'}</span>
              <span className="trend-tip-val">
                {mTotalAt[focus] == null ? '—' : fmtMirror(mTotalAt[focus])}
              </span>
            </span>
          )}
          {countries.map((c) => {
            const v = (series[c.key] || [])[focus];
            if (v == null) return null;
            // In share mode the percentage leads and the absolute rides
            // along -- the figure the mode hides is the one a reader is
            // most likely to want back.
            const a = share ? v : alt?.series?.[c.key]?.[focus];
            const shareV = share ? asShare(v, totalAt[focus]) : null;
            return (
              <span key={c.key} className="trend-tip-row">
                <span className={'dot dot-' + c.dot} />
                <span className="trend-tip-key">{c.label}</span>
                <span className="trend-tip-val">
                  {share ? (shareV == null ? '\u2014' : shareV.toFixed(1) + '%') : fmtAxis(v)}
                </span>
                {a != null && (
                  <span className="trend-tip-alt">
                    {share
                      ? fmtAxis(a)
                      : (alt.mode === 'value' ? fmtCurrency(a, currency) : `${fmtNum(a)} u`)}
                  </span>
                )}
                {/* This key's own stock at the same point, where the
                    mirror is cut the same way the sales lines are. A
                    market's sales beside a different market's shelf
                    would be worse than showing nothing. */}
                {mirror?.series?.[c.key]?.[focus] != null && (
                  <span className="trend-tip-alt trend-tip-alt--mirror">
                    {/* Named, unlike the alt beside it. Three bare
                        figures in a row -- revenue, units, stock -- are
                        a puzzle; the first two are the same measure in
                        two denominations, the third is a different
                        thing entirely and has to say so. */}
                    <span className="trend-tip-alt-tag">stock</span>
                    {fmtMirror(mirror.series[c.key][focus])}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
