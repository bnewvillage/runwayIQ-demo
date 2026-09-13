import { fmtCurrency } from '../../lib/format.js';
import { BRAND_SLOTS, brandTierMix } from './brandData.js';

// Stock health as a composition, deliberately NOT as a time series.
//
// stock_snapshots_monthly now holds 12 month-ends, so a stock trend is
// finally drawable -- but nothing has decided what it should say, and a
// half-considered line chart beside a deliberate composition would be
// worse than the composition alone. The form differs from the revenue
// chart on purpose: a stacked bar next to a line reads as a different
// kind of answer, where an empty line chart reads as a broken one.
//
// Labels come from the server. HEALTH_TIERS in shared/stock_health.py is
// the one definition and /stock-health/tiers serves it, which is what
// StockAnalysisPage reads. This file used to keep its own copy, and the
// copy failed exactly as you would expect: `undetermined` had to be
// hand-added here when the tier shipped, or it rendered "undefined".

export default function BaStockMix({ rows, countries, currency, asOf, tiers }) {
  return (
    <div className="chart-card chart-card--fill">
      <div className="chart-title-row">
        <div className="chart-title">
          Stock position
          <span className="chart-title-note">
            {' · '}by value{asOf ? `, as at ${asOf}` : ''}, a snapshot rather than a trend
          </span>
        </div>
      </div>

      <div className="ba-mixes">
        {rows.map((r, i) => {
          const mix = brandTierMix(r._summary, countries);
          const total = mix.reduce((s, m) => s + m.value, 0);
          return (
            <div key={r.brand} className="ba-mix-row">
              <div className="ba-mix-head">
                <span className="ba-mix-name">
                  <span className={'dot dot-' + BRAND_SLOTS[i]} />{r.brand}
                </span>
                <span className="ba-mix-total">
                  {r.stockValue == null ? '—' : fmtCurrency(r.stockValue, currency)}
                </span>
              </div>
              {total > 0 ? (
                <>
                  <div className="mix-bar">
                    {mix.map((m) => (
                      <span
                        key={m.tier}
                        className={'mix-seg mix-seg--' + m.tone}
                        style={{ width: `${m.share * 100}%`, opacity: m.shade }}
                        title={`${tiers?.[m.tier]?.label || m.tier}: ${fmtCurrency(m.value, currency)} (${(m.share * 100).toFixed(1)}% of this brand)`}
                      />
                    ))}
                  </div>
                  <div className="ba-mix-foot small">
                    {r.atRiskValue > 0 ? (
                      <>
                        <b>{fmtCurrency(r.atRiskValue, currency)}</b> dead or critical
                        {' '}&mdash; {((r.atRiskPct || 0) * 100).toFixed(0)}% of this
                        brand&rsquo;s {fmtCurrency(r.stockValue, currency)}
                      </>
                    ) : 'nothing dead or critical'}
                  </div>
                </>
              ) : (
                <div className="chart-empty">No stock held in the selected markets.</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="small ba-foot">
        Tiers are assigned per item <i>per market</i>, so one SKU can be a fast
        mover in the UAE and dead in Qatar. That is a different population from
        the SKU count, which counts each item once &mdash; the two are never
        shown as a share of each other.
      </div>
    </div>
  );
}
