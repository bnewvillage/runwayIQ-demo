import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { getOverview } from '../../lib/api.js';
import { fmtCurrency, fmtCurrencyCompact, fmtNum, fmtDateTimeLocal } from '../../lib/format.js';
import { tools, movement, movementNote, deltaPct, fmtDelta, sparkPath, ageDays } from './overviewData.js';

const MARKET_DOT = { UAE: 'uae', QAT: 'qat', KSA: 'ksa' };
const CHANNEL_DOT = { Showroom: 'showroom', Distribution: 'distribution', Ecommerce: 'ecommerce' };

/** A signed change, coloured by direction rather than by preference:
 *  falling stock is not automatically bad, so the colour says which way
 *  the number went and leaves the judgement to the reader. */
function Delta({ pct, suffix }) {
  const text = fmtDelta(pct);
  if (!text) return null;
  return (
    <span className={'ov-delta' + (pct >= 0 ? ' up' : ' down')}>
      {text}{suffix ? <span className="ov-delta-suffix"> {suffix}</span> : null}
    </span>
  );
}

/** Shape only -- no axes, no labels, no hover. Scaled to its own range,
 *  so it says how the period moved and nothing about magnitude; the
 *  figure beside it carries the size. */
function Spark({ values, colour, w = 108, h = 26 }) {
  const d = sparkPath(values, w, h);
  if (!d) return <span className="ov-spark ov-spark--empty" />;
  return (
    <svg className="ov-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={colour || 'var(--info)'} strokeWidth="1.5"
            strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** A figure that is not there yet. Rendered at the size the real one
 *  will occupy so nothing moves when the payload lands. */
function Skel({ w = 120, h = 30 }) {
  return <span className="ov-skel" style={{ width: w, height: h }} />;
}

export default function OverviewPage() {
  const { data, error } = useAsyncData(() => getOverview(), [],
    { cacheKey: 'overview' });
  const [basis, setBasis] = useState('month');

  // NOTE: no early return on `loading`. The page renders complete on the
  // first frame and figures fill in -- withholding the design until the
  // data arrives is what made this page blank on load.
  const b = data?.basis?.[basis];
  const series = data?.series?.[basis];
  const rail = useMemo(() => tools(data), [data]);
  const markets = useMemo(() => movement(b?.markets), [b]);
  const channels = useMemo(() => movement(b?.channels), [b]);
  const pos = data?.position;

  const marginPct = b && deltaPct(b.current.margin, b.prior.margin);
  const revPct = b && deltaPct(b.current.revenue, b.prior.revenue);
  const unitPct = b && deltaPct(b.current.units, b.prior.units);

  const BASES = [
    { key: 'month', label: 'Month' },
    { key: 'quarter', label: 'Quarter' },
  ];

  return (
    <div className="container ov-shell">
      <aside className="ov-rail">
        <div className="ov-rail-head">Tools</div>
        {rail.map((t) => (
          <Link key={t.to} to={t.to} className={'ov-tool' + (t.warn ? ' is-warn' : '')}>
            <span className="ov-tool-name">{t.name}</span>
            {/* The figure row is always present, even for Baskets which
                has none, so every card is the same shape and the rail
                reads as one object rather than eight ragged ones. */}
            <span className="ov-tool-value">
              {t.value ? (
                t.value.money != null ? fmtCurrencyCompact(t.value.money)
                  : t.value.count != null ? fmtNum(t.value.count)
                    : t.value.plain
              ) : data ? <span className="ov-tool-none">—</span> : <Skel w={64} h={19} />}
            </span>
            <span className="ov-tool-note">{t.note}</span>
            <span className="ov-tool-go" aria-hidden="true">→</span>
          </Link>
        ))}
      </aside>

      <main className="ov-main">
        <div className="ov-basis">
          <span className="ov-basis-label">Basis</span>
          {BASES.map((x) => (
            <button key={x.key} type="button"
                    className={'btn-toggle' + (basis === x.key ? ' active' : '')}
                    onClick={() => setBasis(x.key)}>{x.label}</button>
          ))}
          {/* Stated as a date, because "not enough history" tells a
              reader nothing about when to look again. */}
          <button type="button" className="btn-toggle ov-basis-off" disabled
                  title="Year-on-year needs a full priced year in every market. The ERP cutovers are staggered — UAE Oct 2025, QAT Feb 2026, KSA May 2026.">
            Year · from {data?.yoy_available_from
              ? new Date(`${data.yoy_available_from}-01T00:00:00Z`)
                .toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
              : '—'}
          </button>
        </div>

        {error && <div className="ov-error">Couldn&rsquo;t load the summary: {String(error)}</div>}

        <section className="chart-card ov-hero">
          <div className="ov-eyebrow">
            Gross margin · {b ? b.label : 'last complete period'}
          </div>
          <div className="ov-hero-row">
            <div className="ov-hero-metric">
              {b ? <div className="ov-hero-figure">{fmtCurrency(b.current.margin)}</div>
                : <Skel w={280} h={44} />}
              <div className="ov-hero-sub">
                {b ? (
                  <>{b.current.margin_pct.toFixed(1)}% margin · <Delta pct={marginPct} suffix={`vs ${b.prior_label}`} /></>
                ) : <Skel w={200} h={14} />}
              </div>
            </div>
            <div className="ov-hero-stats">
              <div className="ov-stat">
                {b ? <span className="ov-stat-num">{fmtCurrency(b.current.revenue)}</span> : <Skel w={110} h={22} />}
                <span className="ov-stat-label">Revenue <Delta pct={revPct} /></span>
              </div>
              <div className="ov-stat">
                {b ? <span className="ov-stat-num">{fmtNum(b.current.units)}</span> : <Skel w={70} h={22} />}
                <span className="ov-stat-label">Units <Delta pct={unitPct} /></span>
              </div>
              <div className="ov-stat">
                {b ? <span className="ov-stat-num">{fmtCurrency(b.current.per_unit)}</span> : <Skel w={70} h={22} />}
                {/* ASP, the name CONTEXT.md already gives revenue over
                    units sold. "Per unit" was a second name for a term
                    the glossary owns. */}
                <span className="ov-stat-label" title="Average selling price: revenue ÷ units sold">ASP</span>
              </div>
            </div>
          </div>
          <div className="ov-hero-spark">
            <Spark values={series?.total} w={520} h={44} colour="var(--info)" />
            <div className="ov-hero-note">
              {basis === 'month'
                ? 'Daily revenue through the month. Shape only — the figures above carry the size.'
                : 'Weekly revenue through the quarter. Shape only — the figures above carry the size.'}
            </div>
          </div>
        </section>

        <div className="ov-pair">
          <section className="chart-card">
            <div className="ov-eyebrow">Money tied up</div>
            {pos ? (
              <>
                <div className="ov-figure">{fmtCurrency(pos.stock_value)}</div>
                <div className="ov-warn-line">
                  {pos.months_on_hand.toFixed(1)} months on hand · {pos.turns.toFixed(2)} turns{pos.cost_months ? ` over ${pos.cost_months.toFixed(1)}mo of cost` : ''}
                </div>
                <div className="ov-note">
                  Against {fmtCurrency(pos.l12m_revenue)} sold in twelve months.
                </div>
              </>
            ) : <><Skel w={180} h={30} /><Skel w={200} h={14} /></>}
          </section>

          <section className="chart-card">
            <div className="ov-eyebrow">What it is costing</div>
            {pos && b ? (
              <>
                <div className="ov-cost-row">
                  <div><div className="ov-figure sm">{b.current.returns_pct.toFixed(1)}%</div>
                    <div className="ov-note">returns</div></div>
                  <div><div className="ov-figure sm crit">{fmtNum(pos.dead_stock_skus)}</div>
                    <div className="ov-note">dead SKUs</div></div>
                  <div><div className="ov-figure sm">{fmtNum(data.queue.stockouts)}</div>
                    <div className="ov-note">stock-outs</div></div>
                </div>
                {/* Tier counts and the stocked-SKU count are different
                    populations, so neither is shown as a share of the
                    other. */}
                {/* Both tiers have two paths into them and the never-sold
                    one is the majority -- 69% of Critical. Naming only the
                    selling path was false for most of what it counted, the
                    same defect the tier descriptions themselves carried. */}
                <div className="ov-note">
                  {fmtNum(pos.critical_skus)} more are Critical — sold six to twelve
                  months ago, or here that long and never sold.
                </div>
              </>
            ) : <><Skel w={220} h={30} /><Skel w={180} h={14} /></>}
          </section>
        </div>

        <section className="chart-card">
          <div className="ov-eyebrow">What moved · {b ? `${b.label} vs ${b.prior_label}` : '—'}</div>
          <div className="ov-moved">
            {/* Each band reads its OWN split. Channels were looking
                themselves up in by_market, where "Showroom" is not a
                key, so every channel row drew an empty placeholder
                instead of a line. */}
            {[['By market', markets, MARKET_DOT, 'market', series?.by_market],
              ['By channel', channels, CHANNEL_DOT, 'channel', series?.by_channel]]
              .map(([title, rows, dots, noun, split]) => (
              <div key={title}>
                <div className="ov-moved-title">{title}</div>
                {rows.length ? rows.map((r) => (
                  <div key={r.key} className="ov-moved-row">
                    <span className={'dot dot-' + (dots[r.key] || '')} />
                    <span className="ov-moved-name">{r.key}</span>
                    <Spark values={split?.[r.key]}
                           colour={`var(--mkt-${dots[r.key]})`} w={72} h={20} />
                    <span className="ov-moved-val">{fmtCurrencyCompact(r.current)}</span>
                    <Delta pct={r.pct} />
                  </div>
                )) : <Skel w={240} h={64} />}
                <div className="ov-note">{movementNote(
                  title === 'By market' ? b?.markets : b?.channels, noun)}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="chart-card">
          <div className="ov-eyebrow">Brands moving · gross margin contributed</div>
          <div className="ov-moved">
            {[['Gained', b?.movers?.up, 'up'], ['Lost', b?.movers?.down, 'down']].map(([title, rows, dir]) => (
              <div key={title}>
                <div className="ov-moved-title">{title}</div>
                {rows ? rows.map((r) => (
                  <div key={r.key} className="ov-brand-row">
                    <span className="ov-brand-name" title={r.key}>{r.key}</span>
                    <span className={'ov-delta ' + dir}>
                      {r.delta >= 0 ? '+' : '−'}{fmtCurrency(Math.abs(r.delta))}
                    </span>
                  </div>
                )) : <Skel w={240} h={80} />}
              </div>
            ))}
          </div>
          <div className="ov-note">
            Ranked by change in margin contributed, not growth rate — a brand going from two
            units to six would otherwise outrank one that moved six figures.
          </div>
        </section>

        <div className="ov-coverage">
          {data ? (
            <>
              <span>{fmtNum(data.coverage.sales_rows)} sales rows modelled</span>
              <span>{fmtNum(data.coverage.skus)} SKUs · {fmtNum(data.coverage.brands)} brands</span>
              <span className={ageDays(String(data.computed_at).slice(0, 10)) > 1 ? 'bk-note' : ''}
                    title="Built by the nightly pipeline. Use Refresh database in the menu to rebuild now.">
                snapshot · {fmtDateTimeLocal(data.computed_at)}
              </span>
            </>
          ) : <Skel w={320} h={12} />}
        </div>
      </main>
    </div>
  );
}
