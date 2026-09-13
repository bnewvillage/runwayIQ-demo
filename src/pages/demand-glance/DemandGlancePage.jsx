import { useEffect, useMemo, useState } from 'react';
import { getDemandGlance } from '../../lib/api.js';
import { cachedFetch } from '../../lib/dataCache.js';
import { fmtCurrency, fmtNum } from '../../lib/format.js';
import { CURRENCIES, COUNTRIES } from '../../lib/constants.js';
import { matchQuery } from '../../lib/searchMatch.js';
import ExcludeBrandsDropdown from '../../components/ExcludeBrandsDropdown.jsx';
import { loadExcludedBrands, saveExcludedBrands } from '../../lib/excludedBrands.js';
import CopyButton from '../../components/CopyButton.jsx';
import RunwayBar from '../../components/RunwayBar.jsx';
import { downloadCsv } from '../../lib/download.js';
import {
  normalizeRow, groupByBrand, sortBrandOrder, sortItems,
  brandCsv, allVisibleCsv,
} from './demandGlanceData.js';

// Exclusions live in lib/excludedBrands.js -- one standing list shared
// with Sales Analytics and Requests.
const MAX_PILLS = 14;

// Demand Glance is precomputed nightly at a fixed 3-month horizon
// (pipeline/build_demand_glance.py calls compute_demand_glance with
// months=3). It isn't selectable here, which is exactly why it has to be
// stated -- otherwise the figures read as horizon-less.
const HORIZON_MONTHS = 3;

const BRAND_SORTS = [
  { key: 'value', label: 'Net value' },
  { key: 'units', label: 'Net units' },
  { key: 'name', label: 'Name' },
];

export default function DemandGlancePage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);

  const [query, setQuery] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [brandSort, setBrandSort] = useState({ key: 'value', dir: 'desc' });
  const [itemSort, setItemSort] = useState({ key: 'net', mode: 'value', dir: -1 });
  const [excludedBrands, setExcludedBrands] = useState(loadExcludedBrands);
  const [openBrands, setOpenBrands] = useState(() => new Set());

  // Through the cache rather than calling getDemandGlance directly: this
  // page owns its own fetch effect instead of using useAsyncData, so it
  // opts in here. Same key either way, so the list is pulled once a session.
  useEffect(() => {
    cachedFetch('demand-glance', getDemandGlance)
      .then((data) => setRows(data.items.map(normalizeRow)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { saveExcludedBrands(excludedBrands); }, [excludedBrands]);

  const allBrands = useMemo(() => [...new Set(rows.map((r) => r.brand))].sort(), [rows]);
  const searching = query.trim().length > 0;

  const brandNameMatches = (brand) => matchQuery(brand, query);
  const itemMatches = (r) => matchQuery(r.item_code, query) || matchQuery(r.item_name || '', query);

  // Visible rows: exclusion always applies; search matches brand name OR
  // item text. A brand-name match keeps every item in that brand visible
  // (so opening it shows the whole brand, not just the matched rows).
  const visibleRows = useMemo(() => rows.filter((r) => {
    if (excludedBrands.has(r.brand)) return false;
    if (!searching) return true;
    return brandNameMatches(r.brand) || itemMatches(r);
  }), [rows, excludedBrands, query, searching]);

  const { byBrand, order } = useMemo(() => groupByBrand(visibleRows), [visibleRows]);
  const brandOrder = useMemo(() => sortBrandOrder(order, byBrand, brandSort), [order, byBrand, brandSort]);

  const totals = useMemo(() => {
    let value = 0, units = 0;
    visibleRows.forEach((r) => { value += r.net_order_value; units += r.net_order; });
    return { value, units, skus: visibleRows.length, brands: brandOrder.length };
  }, [visibleRows, brandOrder]);

  // Purchasing spend is heavily Pareto-distributed, so "how far down the
  // list do I have to read before I've covered most of the money" is a
  // real triage question. Computed from value regardless of the active
  // sort -- it describes the data, not the current ordering.
  const paretoCount = useMemo(() => {
    if (totals.value <= 0) return 0;
    const values = [...byBrand.values()]
      .map((rs) => rs.reduce((a, r) => a + r.net_order_value, 0))
      .sort((a, b) => b - a);
    let acc = 0;
    for (let i = 0; i < values.length; i++) {
      acc += values[i];
      if (acc >= totals.value * 0.8) return i + 1;
    }
    return values.length;
  }, [byBrand, totals.value]);

  // Rank only means something when the sort is by magnitude. Under an
  // alphabetical sort a number would look like a ranking while carrying
  // no ranking information, and the alphabet is already its own key.
  const showRank = brandSort.key !== 'name';

  function toggleBrandOpen(brand) {
    setOpenBrands((cur) => { const next = new Set(cur); next.has(brand) ? next.delete(brand) : next.add(brand); return next; });
  }
  function toggleExcluded(brand) {
    setExcludedBrands((cur) => { const next = new Set(cur); next.has(brand) ? next.delete(brand) : next.add(brand); return next; });
  }
  function onItemSort(key) {
    setItemSort((s) => (s.key === key ? { ...s, dir: -s.dir } : { key, mode: s.mode, dir: -1 }));
  }
  const sortArrow = (key) => (itemSort.key === key ? (itemSort.dir === -1 ? '▼' : '▲') : '');

  function exportBrand(brand) {
    downloadCsv(`${brand.replace(/\s+/g, '_')}_order.csv`, brandCsv(byBrand.get(brand)));
  }
  function exportAll() {
    downloadCsv('demand_glance_export.csv', allVisibleCsv(brandOrder, byBrand));
  }

  if (loading) return <div className="page-loading">Loading demand glance&hellip;</div>;
  if (error) return <div className="page-error">Error loading demand glance: {error}</div>;

  return (
    <>
      <div className="container page-head">
        <p className="page-eyebrow">Demand glance</p>
        <div className="hero-row">
          <div className="hero-metric">
            <p className="hero-figure accent">{fmtCurrency(totals.value, currency)}</p>
            <p className="hero-label">to order across {fmtNum(totals.skus)} SKUs</p>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-num">{fmtNum(totals.units)}</span>
              <span className="hero-stat-label">units</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-num">{totals.brands}</span>
              <span className="hero-stat-label">brands</span>
            </div>
            <div className="hero-stat">
              <span className="hero-stat-num">{HORIZON_MONTHS}<span className="hero-stat-unit">mo</span></span>
              <span className="hero-stat-label">horizon</span>
            </div>
          </div>
          {excludedBrands.size > 0 && (
            <div className="excluded">
              <div className="excluded-head">
                <span className="excluded-title">{excludedBrands.size} excluded</span>
                <button className="link-btn" onClick={() => setExcludedBrands(new Set())}>Clear all</button>
              </div>
              <div className="pill-row">
                {[...excludedBrands].sort().slice(0, MAX_PILLS).map((b) => (
                  <button key={b} className="pill" onClick={() => toggleExcluded(b)} title={`Stop excluding ${b}`}>
                    <span className="pill-text">{b}</span>
                    <span className="pill-x" aria-hidden="true">&times;</span>
                  </button>
                ))}
                {excludedBrands.size > MAX_PILLS && (
                  <span className="pill pill--more" title={[...excludedBrands].sort().slice(MAX_PILLS).join(', ')}>
                    +{excludedBrands.size - MAX_PILLS}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        {/* The basis is stated in full rather than abbreviated to "holt's":
            most rows are Holt fits, but a SKU that sold in fewer than 5 of
            the last 8 weeks falls back to a 26-week WMA, and a number's
            provenance shouldn't be guessable only from the code. */}
        <p className="hero-note">
          Covering the next {HORIZON_MONTHS} months. Holt&#39;s linear trend
          (&alpha;&thinsp;.4 &beta;&thinsp;.2, damped &phi;&thinsp;.9) on the trailing 8 weeks,
          falling back to a 26-week 65/35 WMA when fewer than 5 of those weeks had sales.
        </p>
      </div>

      <div className="container toolbar">
        <div className="field">
          <span className="field-label">Search</span>
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Brand, code, or name — ,,and //or --exclude" />
        </div>
        <div className="field">
          <span className="field-label">Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field-label">Sort brands by</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="btn-group">
              {BRAND_SORTS.map((s) => (
                <div key={s.key} className={'btn-toggle' + (brandSort.key === s.key ? ' active' : '')}
                     onClick={() => setBrandSort({ key: s.key, dir: s.key === 'name' ? 'asc' : 'desc' })}>
                  {s.label}
                </div>
              ))}
            </div>
            <button className="btn-icon" onClick={() => setBrandSort((s) => ({ ...s, dir: s.dir === 'desc' ? 'asc' : 'desc' }))}>
              {brandSort.dir === 'desc' ? '▼' : '▲'}
            </button>
          </div>
        </div>
        <div className="field">
          <span className="field-label">Exclude</span>
          <ExcludeBrandsDropdown all={allBrands} excluded={excludedBrands} onToggle={toggleExcluded} />
        </div>
        <button className="export-btn" style={{ float: 'none', alignSelf: 'flex-end', padding: '7px 10px' }} onClick={exportAll}>
          Export all CSV
        </button>
        <span className="count">
          <b>{fmtNum(totals.skus)}</b> rows shown
          {paretoCount > 0 && (
            <span className="count-aside">
              top <b>{paretoCount}</b> {paretoCount === 1 ? 'brand is' : 'brands are'} 80% of value
            </span>
          )}
        </span>
      </div>

      <div className="container brand-list">
        {brandOrder.length === 0 && (
          <div className="page-loading">No brands or SKUs match.</div>
        )}
        {brandOrder.map((brand, i) => {
          const brandRows = byBrand.get(brand);
          const brandMatched = searching && brandNameMatches(brand);
          const isOpen = openBrands.has(brand) || brandMatched;
          const sortedRows = sortItems(brandRows, itemSort);
          return (
            <BrandCard
              key={brand} brand={brand} rows={sortedRows} isOpen={isOpen}
              rank={showRank ? i + 1 : null}
              currency={currency} itemSort={itemSort} onItemSort={onItemSort} sortArrow={sortArrow}
              onToggle={() => toggleBrandOpen(brand)} onExport={() => exportBrand(brand)}
            />
          );
        })}
      </div>
    </>
  );
}

function BrandCard({ brand, rows, isOpen, rank, currency, itemSort, onItemSort, sortArrow, onToggle, onExport }) {
  const skus = rows.length;
  const netUnits = rows.reduce((s, r) => s + r.net_order, 0);
  const netValue = rows.reduce((s, r) => s + r.net_order_value, 0);

  return (
    <div className={'brand-card' + (isOpen ? ' expanded' : '')}>
      <div className="brand-header" onClick={onToggle}>
        {rank != null && <span className={'brand-rank' + (rank <= 3 ? ' top' : '')}>{rank}</span>}
        <span className={'brand-chevron' + (isOpen ? ' open' : '')}>&#9656;</span>
        <span className="brand-name">{brand}</span>
        <span className="brand-glance">
          <span className="glance-stat"><span className="glance-num">{skus}</span><span className="glance-label">skus</span></span>
          <span className="glance-stat"><span className="glance-num">{fmtNum(netUnits)}</span><span className="glance-label">units</span></span>
          <span className="glance-stat"><span className="glance-num accent">{fmtCurrency(netValue, currency)}</span><span className="glance-label">net value</span></span>
        </span>
        <button className="export-btn" onClick={(e) => { e.stopPropagation(); onExport(); }}>Export CSV</button>
      </div>
      {isOpen && (
        <div className="tablewrap tablewrap--card">
          <table className="dg-table">
            <thead>
              <tr>
                <th>Item</th>
                {COUNTRIES.map((c) => (
                  <th key={c.key} className={'gauge sortable' + (itemSort.key === c.key ? ' active' : '')} onClick={() => onItemSort(c.key)}>
                    {c.label}<span className="sort-arrow">{sortArrow(c.key)}</span>
                  </th>
                ))}
                <th className={'num sortable' + (itemSort.key === 'net' ? ' active' : '')} onClick={() => onItemSort('net')}>
                  Net order<span className="sort-arrow">{sortArrow('net')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => <ItemRow key={r.item_code} row={r} currency={currency} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ItemRow({ row, currency }) {
  return (
    <tr className="item-row">
      <td>
        <span className="item-name">{row.item_name}</span>
        <span className="item-code code-cell">{row.item_code}<CopyButton text={row.item_code} title="Copy item code" /></span>
      </td>
      {COUNTRIES.map((c) => <GaugeCell key={c.key} label={c.label} data={row.countries[c.key]} valuationRate={row.valuation_rate} currency={currency} />)}
      <td className="net" data-label="Net order">
        {fmtNum(row.net_order)}
        <span className="net-value">{fmtCurrency(row.net_order_value, currency)}</span>
      </td>
    </tr>
  );
}

function GaugeCell({ label, data, valuationRate, currency }) {
  const stock = data ? Math.round(data.stock || 0) : 0;
  const wos = data ? data.weeksOfStock : null;
  // Stock is shown regardless of whether there's a velocity/demand signal --
  // a country can be sitting on stock with no recent sales to forecast from,
  // and that's still worth seeing, not hidden behind a bare "--".
  // Cover is drawn rather than written: see RunwayBar for why.
  const stockLine = (
    <div className="qty-value-line stock-line">
      {fmtNum(stock)} in stock
    </div>
  );
  const runway = <div style={{ marginTop: 4 }}><RunwayBar weeks={wos} /></div>;

  if (!data || data.velocity == null) {
    return (
      <td data-label={label}>
        <div className="gauge-cell"><span className="rate none">&mdash;</span></div>
        {stockLine}{runway}
      </td>
    );
  }
  // Negative demand = a country surplus, not a shortfall -- shown as 0 here
  // (nothing to order here) rather than a confusing negative unit count.
  // The true signed figure still goes out in the per-brand CSV export.
  const displayQty = Math.max(0, data.demand ?? 0);
  return (
    <td data-label={label}>
      <div className="gauge-cell">
        <span className="dir-tag">
          <span className={'dir-arrow ' + data.direction}>{data.direction === 'up' ? '▲' : data.direction === 'down' ? '▼' : '—'}</span>
          <span className={'rate ' + data.direction}>{data.velocity.toFixed(1)}/wk</span>
        </span>
      </div>
      <div className="qty-value-line">{fmtNum(displayQty)} demand &middot; {fmtCurrency(displayQty * valuationRate, currency)}</div>
      {stockLine}{runway}
    </td>
  );
}
