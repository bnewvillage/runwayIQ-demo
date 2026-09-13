import { useCallback, useMemo, useState } from 'react';
import { getSalesExtended, getSalesExtendedItems } from '../../lib/api.js';
import { fmtCurrency, fmtCurrencyCompact, fmtNum } from '../../lib/format.js';
import { COUNTRIES } from '../../lib/constants.js';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { downloadCsv } from '../../lib/download.js';
import CopyButton from '../../components/CopyButton.jsx';
import SalesTrendChart from '../../components/SalesTrendChart.jsx';
import SalesFilterBar from './SalesFilterBar.jsx';
import {
  CHANNELS, EMPTY, scope, groupBy, monthlySeriesBy, allMonthsIn, endOfMonth,
  VIEWS, selectorView,
  matrix, monthLabels, extendedItemsCsv, dateSpan, pivotBySplit, sortPivoted,
} from './salesData.js';

const COUNTRY_ORDER = COUNTRIES.map((c) => c.key);

function toggleIn(list, v) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/**
 * Sales Extended -- the full recorded history.
 *
 * Separate from Sales Analytics rather than a toggle on it, because the
 * pre-cutover export priced Showroom and Ecommerce but not Distribution
 * (91.4% of its Distribution lines carry no amount, against 0.2% for
 * Showroom). One page covering both would need every value to carry
 * "...but only over the rows that had a price".
 *
 * The page is therefore organised around PROVENANCE, not around a date.
 * Two sources, shown side by side and never summed, with one visual
 * vocabulary throughout: solid = live ERP, hatched = manual export. A
 * reader learns it on the summary cards and then recognises it on the
 * tables without being told again.
 */
export default function SalesExtendedPage() {
  const [filter, setFilter] = useState(EMPTY);
  const [brandSearch, setBrandSearch] = useState('');
  const [itemSort, setItemSort] = useState({ key: 'units', dir: 'desc' });
  const [showAllItems, setShowAllItems] = useState(false);
  const [splitBy, setSplitBy] = useState('none');

  const { data, error, loading } = useAsyncData(() => getSalesExtended(), [],
    { cacheKey: 'sales-extended' });
  const cells = data?.cells ?? null;

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));
  const months = useMemo(() => (cells ? allMonthsIn(cells) : []), [cells]);
  const scoped = useMemo(() => (cells ? scope(cells, filter) : []), [cells, filter]);
  const chartScoped = useMemo(
    () => (cells ? scope(cells, filter, VIEWS.chart) : []),
    [cells, filter]);
  const visibleMonths = useMemo(
    () => (filter.months.length ? months.filter((m) => filter.months.includes(m)) : months),
    [months, filter.months]);
  const axisLabels = useMemo(() => monthLabels(visibleMonths), [visibleMonths]);
  // Shared crosshair -- see SalesAnalyticsPage on why this is not per chart.
  const [hoverIdx, setHoverIdx] = useState(null);

  // Clicking a point drills to that month. The chart itself ignores the
  // drill -- it is the selector, and honouring it would leave one point
  // with no way to step to another.
  const pickMonth = (i) => {
    const m = visibleMonths[i];
    if (m) set({ drill: filter.drill === m ? null : m });
  };
  const pickedIndex = filter.drill ? visibleMonths.indexOf(filter.drill) : -1;

  const byCountry = useMemo(
    () => groupBy(cells ? scope(cells, filter, selectorView('countries')) : [], 'country', 'units'),
    [cells, filter]);
  const byChannel = useMemo(
    () => groupBy(cells ? scope(cells, filter, selectorView('channels')) : [], 'channel', 'units'),
    [cells, filter]);
  const byBrand = useMemo(
    () => groupBy(cells ? scope(cells, filter, selectorView('brands')) : [], 'brand', 'units'),
    [cells, filter]);

  // Built per dimension so market and channel can be shown together.
  // They are two decompositions of the same total, and a toggle between
  // them only ever made the reader click twice to see both.
  const buildSeries = useCallback((dim) => {
    if (!cells) return { series: {}, keys: [] };
    const split = monthlySeriesBy(chartScoped, visibleMonths, dim, 'units');
    const dots = dim === 'country'
      ? Object.fromEntries(COUNTRIES.map((c) => [c.key, c.dot]))
      : { Showroom: 'showroom', Distribution: 'distribution', Ecommerce: 'ecommerce' };
    return {
      series: Object.fromEntries(split.map((x) => [x.key, x.points.map((p) => p.value)])),
      keys: split.map((x) => ({ key: x.key, label: x.key, dot: dots[x.key] || 'uae' })),
    };
  }, [cells, chartScoped, visibleMonths]);

  const rangeStart = filter.drill || visibleMonths[0] || null;
  const rangeEnd = filter.drill || visibleMonths[visibleMonths.length - 1] || null;
  const { data: itemData, loading: itemsLoading } = useAsyncData(
    () => getSalesExtendedItems(filter.countries, filter.channels, filter.brands,
      rangeStart, rangeEnd ? endOfMonth(rangeEnd) : null, showAllItems ? 0 : 500,
      splitBy === 'none' ? null : splitBy),
    [filter.countries, filter.channels, filter.brands, rangeStart, rangeEnd, showAllItems, splitBy],
    { enabled: !!cells });

  // Split values present in the response, in a stable order, so both
  // tables carry identical columns even when one has no rows for a value.
  const splitKeys = useMemo(() => {
    if (!itemData || splitBy === 'none') return [];
    const seen = new Set([...itemData.live, ...itemData.legacy].map((r) => r.split).filter(Boolean));
    const order = splitBy === 'country' ? COUNTRY_ORDER : CHANNELS;
    return [...order.filter((k) => seen.has(k)), ...[...seen].filter((k) => !order.includes(k))];
  }, [itemData, splitBy]);

  const liveItems = useMemo(() => (itemData
    ? sortPivoted(pivotBySplit(itemData.live, splitKeys), itemSort) : null),
  [itemData, itemSort, splitKeys]);
  const legacyItems = useMemo(() => (itemData
    ? sortPivoted(pivotBySplit(itemData.legacy, splitKeys), itemSort) : null),
  [itemData, itemSort, splitKeys]);

  const toggleItemSort = (key) => setItemSort((c) => (c.key === key
    ? { key, dir: c.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['item_code', 'item_name', 'brand'].includes(key) ? 'asc' : 'desc' }));

  const brandList = useMemo(() => {
    const q = brandSearch.trim().toLowerCase();
    return byBrand.filter((b) => !q || b.key.toLowerCase().includes(q)).slice(0, 60);
  }, [byBrand, brandSearch]);

  if (error) return <div className="page-error">Error loading extended sales: {error}</div>;
  if (loading || !cells) return <div className="container" style={{ padding: 'var(--s6)' }}>Loading…</div>;

  const m = matrix(scoped, (t) => t.units);
  const brandTotal = byBrand.reduce((s, x) => s + x.value, 0);
  const liveT = itemData?.live_totals;
  const legacyT = itemData?.legacy_totals;

  return (
    <>
      <div className="container page-head">
        <h1>Sales Extended</h1>
        <p className="page-sub">
          {months.length} months of volume history, including records the ERP does not hold.
          Two sources, never summed — Sales Analytics covers margin, ASP and returns from the
          live feed alone.
        </p>
      </div>

      {/* Filters, grouped and labelled. Twenty chips in one undivided row
          gave no way to tell a market from a period from a view mode. */}
      <div className="container">
        <SalesFilterBar
          filter={filter} onChange={setFilter} months={months}
          extraGroups={[{
            label: 'Item breakdown',
            node: [['none', 'None'], ['country', 'By market'], ['channel', 'By channel']].map(([k, l]) => (
              <button key={k} className={'btn-toggle' + (splitBy === k ? ' active' : '')}
                      onClick={() => setSplitBy(k)}>{l}</button>
            )),
          }]}
          />
      </div>

      {/* The two sources, side by side and explicitly labelled with what
          each figure does and does not cover. This is the page's thesis:
          a number is only meaningful next to its provenance. */}
      <div className="container chart-grid" style={{ marginTop: 'var(--s5)' }}>
        <SourceCard kind="live" title="Live ERP" totals={liveT}
                    span={dateSpan(liveItems)}
                    note="Every line carries a price." />
        <SourceCard kind="legacy" title="Pre-cutover export" totals={legacyT}
                    span={dateSpan(legacyItems)}
                    note="Quantities are complete; prices are not." />
      </div>

      <div className="container">
        <div className="chart-grid">
          {[['country', 'By market'], ['channel', 'By channel']].map(([dim, label]) => {
            const sr = buildSeries(dim);
            return (
              <div className="chart-card" key={dim}>
                <div className="chart-title">Units over time · {label}</div>
                <SalesTrendChart series={sr.series} keys={sr.keys} title="" mode="units"
                                 labels={axisLabels}
                                 hover={hoverIdx} onHover={setHoverIdx}
                                 onPick={pickMonth} picked={pickedIndex >= 0 ? pickedIndex : undefined}
                                 emptyMessage="No units in this window for the current filters." />
              </div>
            );
          })}
        </div>

        <div className="chart-grid">
          <div className="chart-card">
            <div className="chart-title">Units · market × channel</div>
            <table className="kpi-matrix">
              <thead>
                <tr>
                  <th />
                  {m.countries.map((c) => <th key={c}>{c}</th>)}
                  <th className="kpi-matrix-total">All</th>
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.channel}>
                    <th>{r.channel}</th>
                    {r.cells.map((v, i) => <td key={m.countries[i]}>{fmtNum(v)}</td>)}
                    <td className="kpi-matrix-total">{fmtNum(r.total)}</td>
                  </tr>
                ))}
                <tr className="kpi-matrix-foot">
                  <th>All</th>
                  {m.columnTotals.map((v, i) => <td key={m.countries[i]}>{fmtNum(v)}</td>)}
                  <td className="kpi-matrix-total">{fmtNum(m.grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="chart-card">
            <div className="chart-title">Units by market</div>
            <ValueRows rows={byCountry} selected={filter.countries}
                       onToggle={(k) => set({ countries: toggleIn(filter.countries, k) })} />
            <div className="chart-title" style={{ marginTop: 'var(--s4)' }}>Units by channel</div>
            <ValueRows rows={byChannel} selected={filter.channels}
                       onToggle={(k) => set({ channels: toggleIn(filter.channels, k) })} />
          </div>
        </div>

        <div className="chart-card">
          <div className="chart-title-row">
            <div className="chart-title">Units by brand</div>
            <input className="input" placeholder="Search brands" value={brandSearch}
                   onChange={(e) => setBrandSearch(e.target.value)} style={{ width: 200 }} />
          </div>
          <div className="tablewrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="fa-table single-header" style={{ width: '100%' }}>
              <thead><tr className="sub-row"><th className="col-name">Brand</th><th>Units</th><th>Share</th></tr></thead>
              <tbody>
                {brandList.map((b) => (
                  <tr key={b.key}
                      className={'item-row' + (filter.brands.includes(b.key) ? ' selected' : '')}
                      style={{ cursor: 'pointer' }}
                      onClick={() => set({ brands: toggleIn(filter.brands, b.key) })}>
                    <td className="col-name">{b.key}</td>
                    <td>{fmtNum(b.value)}</td>
                    <td>{brandTotal > 0 ? `${(b.value / brandTotal * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="filterbar" style={{ marginTop: 'var(--s5)' }}>
          <div className="filtergroup">
            <span className="filtergroup-label">Item rows</span>
            <div className="filtergroup-row">
              <button className={'btn-toggle' + (showAllItems ? ' active' : '')}
                      onClick={() => setShowAllItems((v) => !v)}>
                {showAllItems ? 'Showing all' : 'Top 500 per table'}
              </button>
            </div>
          </div>
        </div>

        <ItemSection kind="live" title="Live ERP" rows={liveItems} totals={liveT}
                     loading={itemsLoading} sort={itemSort} onSort={toggleItemSort}
                     splitKeys={splitKeys} showPriced={false}
                     onExport={() => downloadCsv('items_live.csv',
                       extendedItemsCsv(liveItems, 'live', splitKeys))} />

        <ItemSection kind="legacy" title="Pre-cutover export" rows={legacyItems} totals={legacyT}
                     loading={itemsLoading} sort={itemSort} onSort={toggleItemSort}
                     splitKeys={splitKeys} showPriced
                     onExport={() => downloadCsv('items_legacy.csv',
                       extendedItemsCsv(legacyItems, 'legacy', splitKeys))} />
      </div>
    </>
  );
}

/** Last day of a YYYY-MM-01 month, so a range end includes that month. */
/** One source, with what it covers stated rather than implied.
 *
 * Totals come from the server over the FULL filtered set, not from the
 * rows on screen -- the tables are capped at 500, and a summary that
 * silently described only the visible page would be worse than none.
 */
function SourceCard({ kind, title, totals, span, note }) {
  const units = Number(totals?.units) || 0;
  const priced = Number(totals?.priced_units) || 0;
  const share = units > 0 ? priced / units : null;
  const partial = share != null && share < 0.99;
  return (
    <div className="chart-card">
      <div className="prov-key" style={{ marginBottom: 'var(--s2)' }}>
        <span className="prov-key-item">
          <span className={`prov-swatch prov-swatch--${kind}`} />
          <span className="chart-title" style={{ marginBottom: 0 }}>{title}</span>
        </span>
      </div>

      <div className="src-figs">
        <div>
          <span className="stock-kpi-num">{fmtNum(units)}</span>
          <span className="stock-kpi-label">Units</span>
        </div>
        <div>
          <span className="stock-kpi-num">{fmtCurrencyCompact(Number(totals?.revenue) || 0, 'AED')}</span>
          <span className="stock-kpi-label">Revenue</span>
        </div>
      </div>

      <div className="src-meta">
        {fmtNum(totals?.items || 0)} items · {fmtNum(totals?.orders || 0)} orders
        {span && <> · {span.from} → {span.to}</>}
      </div>

      {/* The coverage bar is the point of this card. A revenue figure
          standing on 78% of the units is a floor, and saying so beside
          the number is the only way to stop it being read as a total. */}
      <div className="prov" style={{ marginTop: 'var(--s3)' }}>
        <div className="prov-bar">
          <div className="prov-seg prov-seg--live" style={{ width: `${(share ?? 1) * 100}%` }} />
          <div className="prov-seg prov-seg--legacy" style={{ width: `${(1 - (share ?? 1)) * 100}%` }} />
        </div>
        <div className="src-cover">
          <span className="prov-val" style={partial ? { color: 'var(--caution)' } : undefined}>
            {share == null ? '—' : `${Math.round(share * 100)}% of units priced`}
          </span>
          <span style={{ color: 'var(--ink-faint)', textAlign: 'right' }}>
            {partial ? 'revenue above is a floor, not a total' : note}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Label, value and share-as-fill. Replaces plain text that ran the two
 * together with nothing to compare across. */
function ValueRows({ rows, selected, onToggle }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="chart-empty">Nothing in scope.</div>;
  return (
    <div>
      {rows.map((r) => (
        <button key={r.key} type="button"
                className={'valrow' + (selected.includes(r.key) ? ' selected' : '')}
                style={{ width: '100%', border: 0, background: 'none' }}
                onClick={() => onToggle(r.key)}>
          <span className="valrow-fill" style={{ width: `${(r.value / max) * 100}%` }} />
          <span className="valrow-label">{r.key}</span>
          <span className="valrow-value">{fmtNum(r.value)}</span>
        </button>
      ))}
    </div>
  );
}

function ItemSection({ kind, title, rows, totals, loading, sort, onSort, splitKeys, showPriced, onExport }) {
  const arrow = (k) => (sort.key === k ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  const cols = 6 + (showPriced ? 1 : 0) + splitKeys.length;
  return (
    <div className="chart-card">
      <div className="chart-title-row">
        <span className="prov-key-item">
          <span className={`prov-swatch prov-swatch--${kind}`} />
          <span className="chart-title" style={{ marginBottom: 0 }}>Items · {title}</span>
        </span>
        <button className="btn-toggle" style={{ marginLeft: 'auto' }}
                disabled={!rows || !rows.length} onClick={onExport}>
          Export CSV ({rows ? fmtNum(rows.length) : 0})
        </button>
      </div>
      <div className="tablewrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
        <table className="fa-table single-header" style={{ width: '100%' }}>
          <thead>
            <tr className="sub-row">
              <th className="col-code sortable" onClick={() => onSort('item_code')}>Code{arrow('item_code')}</th>
              <th className="col-name sortable" onClick={() => onSort('item_name')}>Item{arrow('item_name')}</th>
              <th className="col-name sortable" onClick={() => onSort('brand')}>Brand{arrow('brand')}</th>
              {splitKeys.map((k) => (
                <th key={k} className="sortable" onClick={() => onSort(`split:${k}`)}>{k}{arrow(`split:${k}`)}</th>
              ))}
              <th className="sortable" onClick={() => onSort('units')}>
                {splitKeys.length ? 'Total' : 'Units'}{arrow('units')}
              </th>
              {showPriced && (
                <th className="sortable" onClick={() => onSort('priced_units')}
                    title="Units on lines that recorded a price. Below Units means the revenue beside it is a floor.">
                  Priced{arrow('priced_units')}
                </th>
              )}
              <th className="sortable" onClick={() => onSort('revenue')}>Revenue{arrow('revenue')}</th>
              <th className="sortable" onClick={() => onSort('orders')}>Orders{arrow('orders')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={cols} className="tbl-msg">Loading…</td></tr>}
            {rows && rows.length === 0 && <tr><td colSpan={cols} className="tbl-msg">Nothing in this scope.</td></tr>}
            {rows && rows.map((r) => (
              <tr key={r.item_code} className="item-row">
                <td className="col-code"><span className="code-cell">{r.item_code}<CopyButton text={r.item_code} title="Copy item code" /></span></td>
                <td className="col-name" title={r.item_name}>{r.item_name}</td>
                <td className="col-name">{r.brand}</td>
                {splitKeys.map((k) => (
                  <td key={k} className={r.bySplit?.[k] ? undefined : 'no-data'}>
                    {r.bySplit?.[k] ? fmtNum(r.bySplit[k]) : '—'}
                  </td>
                ))}
                <td>{fmtNum(r.units)}</td>
                {showPriced && <td>{fmtNum(r.priced_units)}</td>}
                <td>{Number(r.revenue) ? fmtCurrency(Number(r.revenue), 'AED') : <span className="no-data">&mdash;</span>}</td>
                <td>{fmtNum(r.orders)}</td>
              </tr>
            ))}
          </tbody>
          {/* Totals come from the server over the whole filtered set, so
              the footer stays right even when the list above is capped. */}
          {totals && (
            <tfoot>
              <tr className="tbl-foot">
                <th colSpan={3 + splitKeys.length}>
                  All {fmtNum(totals.items || 0)} items{rows && rows.length < (totals.items || 0) ? ' (list capped above)' : ''}
                </th>
                <td>{fmtNum(totals.units || 0)}</td>
                {showPriced && <td>{fmtNum(totals.priced_units || 0)}</td>}
                <td>{fmtCurrency(Number(totals.revenue) || 0, 'AED')}</td>
                <td>{fmtNum(totals.orders || 0)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
