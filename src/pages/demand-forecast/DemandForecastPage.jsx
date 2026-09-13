import { Fragment, useMemo, useState } from 'react';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { getDemandForecast, getForecastHorizons } from '../../lib/api.js';
import { fmtNum, fmtCurrency } from '../../lib/format.js';
import { downloadCsv } from '../../lib/download.js';
import { COUNTRIES } from '../../lib/constants.js';
import ExcludeBrandsDropdown from '../../components/ExcludeBrandsDropdown.jsx';
import { loadExcludedBrands, toggleExcludedBrand } from '../../lib/excludedBrands.js';
import {
  EMPTY, METHOD_LABEL, filterRows, sortRows, methodMix, totals, forecastCsv,
} from './demandForecastData.js';

const NONE = [];
const FALLBACK_HORIZONS = [2, 3, 4, 5, 6, 10, 12, 18];

export default function DemandForecastPage() {
  // Horizon list from the server, never hardcoded -- same rule Forecast
  // Analytics follows. The constant above is a render fallback only.
  //
  // Cached: no parameters, one possible response, and it cannot change
  // between deploys -- exactly what dataCache is for. The forecast run
  // below deliberately is NOT cached: it is parameterised by horizon, and
  // a Run button that served a remembered answer would not be a run.
  const { data: horizonData } = useAsyncData(
    () => getForecastHorizons(), [], { cacheKey: 'forecast-horizons' });
  const horizons = horizonData?.horizons ?? FALLBACK_HORIZONS;

  const [months, setMonths] = useState(12);
  // `ran` is what makes this a run rather than a page load. Nothing is
  // fetched until it is asked for: this is seconds of whole-catalogue
  // computation, and paying it every time someone opens the page -- or
  // again on every nudge of the horizon -- is the cost this page exists
  // to keep optional.
  const [ran, setRan] = useState(null);
  const { data, loading, error } = useAsyncData(
    () => getDemandForecast(ran), [ran], { enabled: ran != null });

  const rows = data?.items ?? NONE;
  const [filter, setFilter] = useState(EMPTY);
  const [sort, setSort] = useState({ key: 'net_order_value', dir: 'desc' });
  const [excluded, setExcluded] = useState(loadExcludedBrands);

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));

  const owned = useMemo(
    () => (excluded.size ? rows.filter((r) => !excluded.has(r.brand)) : rows),
    [rows, excluded]);
  const allBrands = useMemo(
    () => [...new Set(rows.map((r) => r.brand).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [rows]);

  const filtered = useMemo(() => filterRows(owned, filter), [owned, filter]);
  const shown = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const t = useMemo(() => totals(filtered), [filtered]);
  const mix = useMemo(() => methodMix(filtered), [filtered]);

  const onSort = (key, country) => setSort((s) => (s.key === key && s.country === country
    ? { key, country, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, country, dir: ['item_code', 'item_name', 'brand'].includes(key) ? 'asc' : 'desc' }));
  const arrow = (key, country) =>
    (sort.key === key && sort.country === country ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  // `cls` carries col-code / col-name. .fa-table centres every cell by
  // default and those two classes are what make a column left-aligned --
  // on the HEADER as well as the cell, or a centred heading sits over
  // left-aligned data, which is what this looked like.
  const th = (key, label, country, title, cls = '') => (
    <th className={'sortable ' + cls} title={title} onClick={() => onSort(key, country)}>
      {label}{arrow(key, country)}
    </th>
  );

  // The horizon that produced what is on screen, which is not necessarily
  // the one selected above -- a reader who changes the selector and does
  // not re-run must not think the table moved with it.
  const shownMonths = data?.months;
  const stale = ran != null && !loading && shownMonths != null && shownMonths !== months;

  return (
    <>
      <div className="container page-head">
        <h1>Demand Forecast</h1>
        <p className="page-sub">
          The whole catalogue at a horizon you choose, computed on demand. Demand Glance
          is the nightly three-month view and stays the daily tool; this is for the
          occasional longer look. Services are excluded — workshop labour and shipping
          are billed in hours, not ordered.
        </p>
      </div>

      <div className="container">
        <div className="filterbar">
          <div className="filtergroup">
            <span className="filtergroup-label">Horizon</span>
            <div className="filtergroup-row">
              {horizons.map((h) => (
                <button key={h}
                        className={'btn-toggle' + (months === h ? ' active' : '')}
                        onClick={() => setMonths(h)}>
                  {h}mo
                </button>
              ))}
            </div>
          </div>

          <div className="filtergroup">
            <span className="filtergroup-label">Run</span>
            <div className="filtergroup-row">
              <button className="export-btn"
                      disabled={loading}
                      onClick={() => setRan(months)}
                      title="Recomputes the whole catalogue at this horizon. Takes a few seconds.">
                {loading ? 'Running…' : `Run ${months}mo forecast`}
              </button>
            </div>
          </div>

          {ran != null && !loading && !error && (
            <>
              <div className="filtergroup">
                <span className="filtergroup-label">Search</span>
                <div className="filtergroup-row">
                  <input className="bk-search" type="search" placeholder="Item, code or brand"
                         value={filter.search}
                         onChange={(e) => set({ search: e.target.value })} />
                </div>
              </div>
              <div className="filtergroup">
                <span className="filtergroup-label">Brands</span>
                <div className="filtergroup-row">
                  <ExcludeBrandsDropdown
                    all={allBrands} excluded={excluded}
                    onToggle={(b) => setExcluded((cur) => toggleExcludedBrand(cur, b))} />
                  <button className="export-btn"
                          onClick={() => downloadCsv(
                            `demand-forecast-${shownMonths}mo-${new Date().toISOString().slice(0, 10)}.csv`,
                            forecastCsv(shown))}
                          title="Every market's figures, flattened.">
                    CSV ({fmtNum(shown.length)})
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {ran == null && (
          <p className="page-sub">
            Pick a horizon and run it. A few seconds of whole-catalogue computation —
            nothing is fetched until you ask.
          </p>
        )}
        {loading && <p className="page-sub">Forecasting the whole catalogue at {ran} months…</p>}
        {error && (
          <p className="page-sub">Could not run the forecast: {String(error.message || error)}</p>
        )}
      </div>

      {ran != null && !loading && !error && (
        <>
          {/* .bk-stats carries no gutter of its own -- it relies on a
              .container, which the table below has and these did not, so
              they hung off the left edge while the table stayed inset.
              Same mistake, same fix, as the Stock Placement header. */}
          <div className="container">
          <div className="bk-stats">
            <span><strong>{fmtNum(t.items)}</strong> items to order</span>
            <span><strong>{fmtNum(t.netOrder)}</strong> units</span>
            <span><strong>{fmtCurrency(t.netOrderValue, 'AED')}</strong> at cost</span>
            <span><strong>{fmtNum(t.brands)}</strong> brands</span>
            <span className="bk-note">
              over {shownMonths} months
              {stale && ` — selector is on ${months}mo, re-run to move it`}
            </span>
          </div>

          {/* What actually ran, per market-slot. The tier names promise a
              trend model that is trusted far less often than they suggest,
              so the mix is stated rather than left to be assumed. */}
          <div className="bk-stats">
            {mix.map((m) => (
              <span key={m.method} className="bk-note">
                {m.label}: <strong>{fmtNum(m.count)}</strong>
              </span>
            ))}
          </div>
          </div>

          <div className="container">
            <div className="table-wrap table-wrap--clipped">
              <table className="fa-table single-header mr-table">
                {/* table-layout is fixed, so unsized columns split the width
                    equally -- which starves the two text columns and leaves
                    the numeric ones wider than a figure needs. */}
                <colgroup>
                  <col style={{ width: '190px' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '120px' }} />
                  {COUNTRIES.map((c) => (
                    <Fragment key={c.key}><col /><col /></Fragment>
                  ))}
                  <col style={{ width: '90px' }} />
                  {/* Money, and the widest cell in the table: "AED
                      338,094" clips to "AED 33..." on an equal share. */}
                  <col style={{ width: '120px' }} />
                </colgroup>
                <thead>
                  <tr className="sub-row">
                    {th('item_code', 'Code', undefined, undefined, 'col-code')}
                    {th('item_name', 'Item', undefined, undefined, 'col-name')}
                    {th('brand', 'Brand')}
                    {COUNTRIES.map((c) => (
                      <Fragment key={c.key}>
                        {th('stock', `${c.key} stk`, c.key, `Units on hand in ${c.key}`)}
                        {th('demand', `${c.key} dmd`, c.key, `Forecast demand over the horizon in ${c.key}`)}
                      </Fragment>
                    ))}
                    {th('net_order', 'Net order', undefined, 'One decision for the item, after UAE-hub redistribution')}
                    {th('net_order_value', 'At cost')}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.item_code} className="item-row">
                      <td className="col-code" title={r.item_code}>{r.item_code}</td>
                      <td className="col-name" title={r.item_name}>{r.item_name || ''}</td>
                      <td>{r.brand || ''}</td>
                      {COUNTRIES.map((c) => {
                        const v = r.velocity?.[c.key];
                        return (
                          <Fragment key={c.key}>
                            <td>{fmtNum(r.stock?.[c.key] ?? 0)}</td>
                            <td title={v?.method ? METHOD_LABEL[v.method] || v.method : undefined}
                                className={(r.demand?.[c.key] ?? 0) < 0 ? 'mr-none' : ''}>
                              {fmtNum(r.demand?.[c.key] ?? 0)}
                            </td>
                          </Fragment>
                        );
                      })}
                      <td className="mr-want">{fmtNum(r.net_order)}</td>
                      <td>{fmtCurrency(r.net_order_value, 'AED')}</td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={4 + COUNTRIES.length * 2} className="page-sub">
                        Nothing to order for the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
