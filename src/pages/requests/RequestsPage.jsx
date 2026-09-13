import { Fragment, useMemo, useState } from 'react';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { getMaterialRequests } from '../../lib/api.js';
import { fmtNum, fmtDateTimeLocal } from '../../lib/format.js';
import { COUNTRIES as MARKETS } from '../../lib/constants.js';
import ExcludeBrandsDropdown from '../../components/ExcludeBrandsDropdown.jsx';
import { loadExcludedBrands, toggleExcludedBrand } from '../../lib/excludedBrands.js';
import { downloadCsv } from '../../lib/download.js';
import {
  COUNTRIES, EMPTY, ageDays, filterRows, sectionByBrand, totals,
  brandSnapshot, shortDate, recentRows, requestsCsv, shapeRows, NEW_DAYS,
} from './requestsData.js';

const NONE = [];

/** Stock reads as a plain figure, but zero is the whole point of the
 *  column -- "nobody has any" is what makes a request urgent -- so it is
 *  marked rather than left to blend into the other numbers. */
function Stock({ n }) {
  const v = Number(n);
  return <td className={v > 0 ? '' : 'mr-none'}>{v > 0 ? fmtNum(v) : '0'}</td>;
}

export default function RequestsPage() {
  const { data, loading, error } = useAsyncData(() => getMaterialRequests(), []);
  const rows = data?.requests ?? NONE;
  // How old this is. ERPNext is read by the nightly job, never by a page
  // load, so these rows are a snapshot -- and on a page used to decide
  // what to order today, the reader has to be able to see that.
  const loadedAt = data?.loaded_at ? fmtDateTimeLocal(data.loaded_at) : null;

  const [filter, setFilter] = useState(EMPTY);
  const [agg, setAgg] = useState(false);
  const [byBrand, setByBrand] = useState(false);
  const [sort, setSort] = useState({ key: 'transaction_date', dir: 'asc' });
  // The same standing list Demand Glance and Sales Analytics use -- a
  // brand you do not buy is not your problem on any page.
  const [excluded, setExcluded] = useState(loadExcludedBrands);

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  // Exclusions come off BEFORE anything else, including the snapshot:
  // an excluded brand should not appear as a card, contribute to a
  // total, or sit in the brand picker. It is not filtered out, it is
  // not yours.
  const owned = useMemo(
    () => (excluded.size ? rows.filter((r) => !excluded.has(r.brand)) : rows),
    [rows, excluded]);

  const brands = useMemo(
    () => [...new Set(owned.map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [owned]);
  // Every brand the data has, excluded or not -- the dropdown must list
  // what you have hidden or there is no way to bring it back.
  const allBrands = useMemo(
    () => [...new Set(rows.map((r) => r.brand).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [rows]);

  const filtered = useMemo(() => filterRows(owned, filter), [owned, filter]);
  const sorted = useMemo(() => shapeRows(filtered, agg, sort), [filtered, agg, sort]);
  const sections = useMemo(() => (byBrand ? sectionByBrand(sorted) : null), [byBrand, sorted]);
  const t = useMemo(() => totals(filtered), [filtered]);

  // Built from `filtered`, so it honours every control including brand:
  // this is a slice of the table below, not a selector for it.
  const recent = useMemo(() => recentRows(filtered), [filtered]);

  // The snapshot is the opposite -- it honours market and search but is
  // BLIND TO THE BRAND FILTER, the same rule the sales donuts follow
  // (selectorView in salesData.js). A selector that filtered by its own
  // dimension would collapse to the single thing already chosen, leaving
  // no way to pick a different one or to see what you are choosing
  // between.
  const snapshot = useMemo(
    () => brandSnapshot(filterRows(owned, { ...filter, brands: [] })),
    [owned, filter]);

  // Two exports, differing in ONE thing: whether the excluded brands
  // come off. Everything else -- market, search, aggregate, sort -- is
  // the table as it stands, because a CSV that quietly dropped the other
  // controls could not be reconciled with the screen it came from.
  //
  // The first is literally the rows on screen. The second re-runs the
  // same pipeline from the unfiltered set, which is why shapeRows exists
  // rather than the steps being written out twice.
  const exportCsv = (respectExclusions) => {
    const rowsOut = respectExclusions
      ? sorted
      : shapeRows(filterRows(rows, filter), agg, sort);
    downloadCsv(
      respectExclusions ? 'requests.csv' : 'requests_all_brands.csv',
      requestsCsv(rowsOut, agg),
    );
  };

  // '(no brand)' is a display label, not a value -- the rows behind it
  // have no brand at all, so selecting it has to mean "brand is empty"
  // rather than "brand equals this string".
  const pickBrand = (label) => {
    const value = label === '(no brand)' ? '' : label;
    set({ brands: filter.brands.includes(value) ? [] : [value] });
  };
  const brandPicked = (label) =>
    filter.brands.includes(label === '(no brand)' ? '' : label);

  const onSort = (key) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['item_code', 'item_name', 'brand', 'request_id', 'transaction_date'].includes(key) ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  const th = (key, label, title) => (
    <th className="sortable" title={title} onClick={() => onSort(key)}>{label}{arrow(key)}</th>
  );

  // Raised, Age, Market, Raised by, Code, Item, Brand, To order, UAE,
  // QAT, KSA -- plus Request when rows are lines rather than items.
  const colCount = agg ? 11 : 12;

  const bodyRows = (list) => list.map((r) => (
    <tr key={agg ? r.item_code : r.line_id} className="item-row">
      {!agg && <td className="mr-doc">{r.request_id}</td>}
      <td>{r.transaction_date}</td>
      <td className={ageDays(r.transaction_date) > 90 ? 'mr-stale' : ''}>
        {fmtNum(ageDays(r.transaction_date))}d
      </td>
      <td>{r.country || ''}</td>
      <td className="mr-who" title={agg ? undefined : r.owner}>{r.requested_by || ''}</td>
      <td className="mr-doc">{r.item_code}</td>
      <td className="col-name" title={r.item_name}>{r.item_name || ''}</td>
      <td>{r.brand || ''}</td>
      <td className="mr-want">{fmtNum(Number(r.outstanding_qty))}{agg && r.requests > 1
        ? <span className="mr-reqs"> ×{r.requests}</span> : null}</td>
      {MARKETS.map((c) => <Stock key={c.key} n={r[`${c.dot}_stock`]} />)}
    </tr>
  ));

  return (
    <>
      <div className="container page-head">
        <h1>Requests</h1>
        <p className="page-sub">
          Purchase requests that are submitted but not yet on a purchase order, with what
          each item already has on the shelf in every market. Quantities are what is still
          to order, not what was asked for.
        </p>
      </div>

      <div className="container">
      <div className="filterbar">
        <div className="filtergroup">
          <span className="filtergroup-label">Market</span>
          <div className="filtergroup-row">
            {COUNTRIES.map((c) => (
              <button key={c} className={'btn-toggle' + (filter.countries.includes(c) ? ' active' : '')}
                      onClick={() => set({ countries: toggleIn(filter.countries, c) })}>
                <span className={'dot dot-' + c.toLowerCase()} />{c}
              </button>
            ))}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Brand</span>
          <select className="bk-select" value={filter.brands[0] || ''}
                  onChange={(e) => set({ brands: e.target.value ? [e.target.value] : [] })}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Search</span>
          <input className="bk-search" value={filter.search}
                 onChange={(e) => set({ search: e.target.value })}
                 placeholder="Item, name, request or person — ,,and //or --excl" />
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Not mine</span>
          <ExcludeBrandsDropdown
            all={allBrands} excluded={excluded}
            onToggle={(b) => setExcluded((cur) => toggleExcludedBrand(cur, b))} />
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Export</span>
          <div className="filtergroup-row">
            <button className="export-btn" onClick={() => exportCsv(true)}
                    title="The table exactly as it stands, excluded brands left out.">
              CSV ({fmtNum(sorted.length)})
            </button>
            {/* Only offered when it would differ. With nothing excluded
                the two buttons produce identical files, and a second
                button that does the same thing reads as a bug. */}
            {excluded.size > 0 && (
              <button className="export-btn" onClick={() => exportCsv(false)}
                      title="Same markets, search, shape and sort -- but puts the excluded brands back in.">
                CSV incl. not mine
              </button>
            )}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">View</span>
          <div className="filtergroup-row">
            <button className={'btn-toggle' + (agg ? ' active' : '')}
                    title="One row per item, summing what every request still wants"
                    onClick={() => setAgg((v) => !v)}>Aggregate</button>
            <button className={'btn-toggle' + (byBrand ? ' active' : '')}
                    title="Group the rows under brand headings"
                    onClick={() => setByBrand((v) => !v)}>By brand</button>
          </div>
        </div>
      </div>

      <div className="bk-stats">
        <span><strong>{fmtNum(t.units)}</strong> units still to order</span>
        <span><strong>{fmtNum(t.items)}</strong> items</span>
        <span><strong>{fmtNum(t.requests)}</strong> requests</span>
        <span>{fmtNum(t.lines)} request lines</span>
        {loadedAt && (
          <span className="bk-note" title="ERPNext is read by the nightly pipeline, not on page load. Use Refresh database in the menu to pull now.">
            snapshot · {loadedAt}
          </span>
        )}
      </div>

      {recent.length > 0 && (
        <div className="chart-card mr-new">
          <div className="chart-title-row">
            <div className="chart-title">
              New requests
              <span className="chart-title-note">
                {' · last '}{NEW_DAYS} days · {fmtNum(recent.length)}
                {recent.length === 1 ? ' line' : ' lines'}
              </span>
            </div>
          </div>
          <div className="tablewrap">
            <table className="fa-table single-header">
              <thead>
                <tr className="sub-row">
                  <th>Raised</th>
                  <th className="col-name">Request</th>
                  <th className="col-name">Raised by</th>
                  <th className="col-name">Item</th>
                  <th>To order</th>
                  {COUNTRIES.map((c) => <th key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <tr key={'n' + r.line_id} className="item-row">
                    <td>{shortDate(r.transaction_date)}</td>
                    <td className="mr-doc">{r.request_id}</td>
                    <td className="mr-who" title={r.owner}>{r.requested_by || ''}</td>
                    <td className="col-name" title={`${r.item_code} — ${r.item_name || ''}`}>
                      <span className="mr-doc">{r.item_code}</span>
                    </td>
                    <td className="mr-want">{fmtNum(Number(r.outstanding_qty))}</td>
                    {MARKETS.map((c) => `${c.dot}_stock`).map((k) => (
                      <Stock key={k} n={r[k]} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="chart-card mr-snapshot">
        <div className="chart-title-row">
          <div className="chart-title">
            Brands requested
            <span className="chart-title-note">
              {' · '}{fmtNum(snapshot.length)} brand{snapshot.length === 1 ? '' : 's'}
              {' · units still to order'}
            </span>
          </div>
        </div>
        {/* One card per brand rather than a table. Each brand carries
            four small numbers, most of them zero, so a grid gave five
            columns of blank cells and made the reader scan sideways for
            the one figure that matters. A card puts the total first and
            lets the markets that actually asked sit under it. */}
        <div className="mr-cards">
          {snapshot.map((b) => (
            <button key={b.brand} type="button"
                    className={'mr-card' + (brandPicked(b.brand) ? ' is-picked' : '')}
                    title={brandPicked(b.brand)
                      ? `Showing ${b.brand} only — click to clear`
                      : `Show only ${b.brand}`}
                    onClick={() => pickBrand(b.brand)}>
              <div className="mr-card-brand" title={b.brand}>{b.brand}</div>
              <div className="mr-card-total">{fmtNum(b.total)}</div>
              <div className="mr-card-split">
                {COUNTRIES.filter((c) => b[c] > 0).map((c) => (
                  <span key={c} className="mr-card-mkt">
                    <span className={'dot dot-' + c.toLowerCase()} />{fmtNum(b[c])}
                  </span>
                ))}
                {b.other > 0 && (
                  <span className="mr-card-mkt" title="Requested by a company that maps to no market">
                    <span className="dot" />{fmtNum(b.other)}
                  </span>
                )}
              </div>
              {/* The span of the requests behind the number. A brand
                  whose oldest and newest are eleven months apart has a
                  standing unmet need; one where they are the same day is
                  a single order someone raised this week. The total
                  alone cannot tell those apart. */}
              <div className="mr-card-span" title={b.oldest === b.newest
                ? `Requested ${shortDate(b.oldest)}`
                : `Oldest ${shortDate(b.oldest)}, latest ${shortDate(b.newest)}`}>
                {b.oldest === b.newest
                  ? shortDate(b.oldest)
                  : `${shortDate(b.oldest)} → ${shortDate(b.newest)}`}
              </div>
              <div className="mr-card-lines">
                {fmtNum(b.lines)}{b.lines === 1 ? ' line' : ' lines'}
              </div>
            </button>
          ))}
          {snapshot.length === 0 && (
            <div className="chart-empty">Nothing pending for these filters.</div>
          )}
        </div>
      </div>

      <div className="chart-card">
        <div className="chart-title-row">
          <div className="chart-title">
            Pending purchase requests
            {/* The quantity shown is what is NOT yet on a PO, which is
                not the same as what was asked for -- a partially ordered
                line shows only its remainder. Said here because the
                difference is invisible in the number itself. */}
            <span className="chart-title-note"> · outstanding quantity, not requested</span>
          </div>
        </div>

        {loading && <div className="chart-empty">Loading requests…</div>}
        {error && <div className="chart-empty">Error: {String(error)}</div>}
        {!loading && !error && (
          <div className="tablewrap">
            <table className="fa-table single-header mr-table">
              <thead>
                <tr className="sub-row">
                  {!agg && th('request_id', 'Request')}
                  {th('transaction_date', agg ? 'Oldest' : 'Raised')}
                  <th title="Days since the request was raised — sorts with Raised">Age</th>
                  {th('country', 'Market', 'The company that raised the request')}
                  {th('requested_by', 'Raised by',
                      'The person who created the request — hover a row for their account')}
                  {th('item_code', 'Code')}
                  {th('item_name', 'Item')}
                  {th('brand', 'Brand')}
                  {th('outstanding_qty', 'To order', 'Requested quantity not yet on a purchase order')}
                  {MARKETS.map((c) => (
                    <Fragment key={c.key}>
                      {th(`${c.dot}_stock`, c.label, 'Stock on hand now')}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr><td colSpan={colCount} className="chart-empty">
                    Nothing pending for these filters.
                  </td></tr>
                )}
                {sections
                  ? sections.map((s) => (
                    <Fragment key={s.brand}>
                      <tr className="mr-section">
                        <td colSpan={colCount}>
                          {s.brand}
                          <span className="mr-section-note">
                            {' · '}{fmtNum(s.outstanding)} units over {fmtNum(s.lines)}
                            {s.lines === 1 ? ' line' : ' lines'}
                          </span>
                        </td>
                      </tr>
                      {bodyRows(s.rows)}
                    </Fragment>
                  ))
                  : bodyRows(sorted)}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </>
  );
}
