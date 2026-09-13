import { fmtCurrency } from '../../lib/format.js';
import { BRAND_SLOTS, brandSplit } from './brandData.js';

// Where each brand's revenue comes from, by market and by channel.
//
// Stacked bars rather than a donut per brand: four donuts at column width
// are unreadable, and bars share a baseline, which is what makes two
// brands comparable at a glance.
//
// Both cuts are of PRICED revenue, so Saudi is understated for anything
// that traded before April 2026. Said once, under the markets bar, rather
// than on every segment.

const DOT = {
  UAE: 'uae', QAT: 'qat', KSA: 'ksa',
  Showroom: 'showroom', Distribution: 'distribution', Ecommerce: 'ecommerce',
};

function SplitBar({ rows, cells, dim, months, filters, currency, title, note }) {
  return (
    <div className="ba-split">
      <div className="ba-split-title">
        {title}
        {note && <span className="chart-title-note">{' · '}{note}</span>}
      </div>
      {rows.map((r, i) => {
        const parts = brandSplit(cells, r.brand, dim, months, filters);
        const total = parts.reduce((s, p) => s + p.value, 0);
        return (
          <div key={r.brand} className="ba-split-row">
            <span className="ba-split-name">
              <span className={'dot dot-' + BRAND_SLOTS[i]} />{r.brand}
            </span>
            {total > 0 ? (
              <span className="mix-bar ba-split-bar">
                {parts.map((p) => (
                  <span
                    key={p.key}
                    className="mix-seg"
                    style={{
                      width: `${p.share * 100}%`,
                      background: `var(--mkt-${DOT[p.key] || 'uae'})`,
                    }}
                    title={`${p.key}: ${fmtCurrency(p.value, currency)} (${(p.share * 100).toFixed(1)}% of this brand)`}
                  />
                ))}
              </span>
            ) : <span className="ba-split-bar no-data">no priced sales</span>}
          </div>
        );
      })}
      <div className="chart-legend">
        {Object.keys(DOT)
          .filter((k) => (dim === 'country') === ['UAE', 'QAT', 'KSA'].includes(k))
          .map((k) => (
            <span key={k} className="chart-legend-item">
              <span className={'dot dot-' + DOT[k]} />{k}
            </span>
          ))}
      </div>
    </div>
  );
}

export default function BaSplits({ rows, cells, months, filters, currency }) {
  return (
    <div className="chart-card chart-card--fill">
      <div className="chart-title-row">
        <div className="chart-title">
          Where the revenue comes from
          <span className="chart-title-note">
            {' · '}share of each brand&rsquo;s priced revenue
          </span>
        </div>
      </div>
      <div className="ba-splits">
        <SplitBar
          rows={rows} cells={cells} dim="country" months={months}
          filters={filters} currency={currency} title="By market"
          note="Saudi understates trade before April 2026"
        />
        <SplitBar
          rows={rows} cells={cells} dim="channel" months={months}
          filters={filters} currency={currency} title="By channel"
          note="Distribution earns a structurally lower margin than Showroom"
        />
      </div>
    </div>
  );
}
