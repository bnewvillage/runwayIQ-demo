import { useMemo, useState } from 'react';
import { useAsyncData } from '../../lib/useAsyncData.js';
import { getStockPlacement } from '../../lib/api.js';
import { fmtNum, fmtCurrency } from '../../lib/format.js';
import { downloadCsv } from '../../lib/download.js';
import ExcludeBrandsDropdown from '../../components/ExcludeBrandsDropdown.jsx';
import { loadExcludedBrands, toggleExcludedBrand } from '../../lib/excludedBrands.js';
import NewStockTable from './NewStockTable.jsx';
import {
  EMPTY, TIER_LABEL, filterRows, sortRows, tiersIn, totals, placementCsv,
} from './placementData.js';

const NONE = [];

/** Nothing at Motor City is the finding, not a small number: an item a
 *  customer cannot be handed at all reads differently from one there is
 *  merely too little of. Same treatment Requests gives a zero stock
 *  column, for the same reason. */
function Here({ n }) {
  const v = Number(n);
  return <td className={v > 0 ? 'mr-want' : 'mr-none'}>{v > 0 ? fmtNum(v) : '0'}</td>;
}

export default function StockPlacementPage() {
  // Opt-in, and a refetch rather than a filter: "all" is a different set
  // of rows, three times the payload, to surface 17 more moves. Not
  // something to pay for on every load.
  const [scope, setScope] = useState('default');
  const { data, loading, error } = useAsyncData(() => getStockPlacement(scope), [scope]);
  const rows = data?.rows ?? NONE;

  // New stock is a second fetch and a second table, not a tier of the
  // first. No move can be computed for it -- the tier is reached only by
  // NOT selling -- so it cannot share a table whose last column is a
  // recommendation. Off by default; 1,693 rows nobody asked for.
  const [showNew, setShowNew] = useState(false);
  const { data: newData, loading: newLoading } = useAsyncData(
    () => getStockPlacement('new'), [showNew], { enabled: showNew });

  const [filter, setFilter] = useState(EMPTY);
  const [sort, setSort] = useState({ key: 'move', dir: 'desc' });
  // The same standing list every other page uses -- a brand you do not
  // buy is not your problem here either.
  const [excluded, setExcluded] = useState(loadExcludedBrands);

  const set = (patch) => setFilter((f) => ({ ...f, ...patch }));
  const toggleIn = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const owned = useMemo(
    () => (excluded.size ? rows.filter((r) => !excluded.has(r.brand)) : rows),
    [rows, excluded]);
  // Every brand the data has, excluded or not -- the dropdown must list
  // what you have hidden or there is no way to bring it back.
  const allBrands = useMemo(
    () => [...new Set(rows.map((r) => r.brand).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b)),
    [rows]);

  // Drawn from the payload, so widening the scope grows the chips and
  // narrowing it cannot leave a chip selected for a tier no longer here.
  const tiers = useMemo(() => tiersIn(owned), [owned]);
  const filtered = useMemo(
    () => filterRows(owned, { ...filter, tiers: filter.tiers.filter((t) => tiers.includes(t)) }),
    [owned, filter, tiers]);
  const shown = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const t = useMemo(() => totals(filtered), [filtered]);

  const onSort = (key) => setSort((s) => (s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['item_code', 'item_name', 'brand', 'health'].includes(key) ? 'asc' : 'desc' }));
  const arrow = (key) => (sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  // col-code / col-name left-align a column; everything else in
  // .fa-table centres. The header needs the class too, or it sits
  // centred over left-aligned data.
  const th = (key, label, title, cls = '') => (
    <th className={'sortable ' + cls} title={title} onClick={() => onSort(key)}>
      {label}{arrow(key)}
    </th>
  );

  if (loading) return <div className="container"><p className="page-sub">Loading…</p></div>;
  if (error) {
    return (
      <div className="container">
        <p className="page-sub">Could not load placement: {String(error.message || error)}</p>
      </div>
    );
  }

  return (
    <>
      <div className="container page-head">
        <h1>UAE Stock Placement</h1>
        <p className="page-sub">
          Movers sitting at Jebel Ali that should be at Motor City, where customers are
          served. Move quantities cover the busiest three days each item has had.
        </p>
      </div>

      {/* .container, like every other block on the page: .bk-stats and
          .filterbar carry no gutter of their own, so as direct children
          of the fragment they ran full-bleed and clipped at the viewport
          edge while the title and table stayed inset. */}
      <div className="container">
      {/* Only figures that stay true under the filters. The holding
          totals were here and were wrong: `filtered` defaults to the
          shortfalls, so "units at Motor City" read 40 against a real
          3,272 -- a number that looks like context and is actually the
          filter talking. The per-row columns carry the split where it
          means something. */}
      <div className="bk-stats">
        <span><strong>{fmtNum(t.itemsShort)}</strong> items to move</span>
        <span><strong>{fmtNum(t.unitsToMove)}</strong> units</span>
        <span><strong>{fmtCurrency(t.valueToMove, 'AED')}</strong> to move</span>
        <span className="bk-note">of {fmtNum(owned.length)} in scope</span>
      </div>

      <div className="filterbar">
        <div className="filtergroup">
          <span className="filtergroup-label">Tier</span>
          <div className="filtergroup-row">
            {tiers.map((tier) => (
              <button key={tier}
                      className={'btn-toggle' + (filter.tiers.includes(tier) ? ' active' : '')}
                      onClick={() => set({ tiers: toggleIn(filter.tiers, tier) })}>
                {TIER_LABEL[tier]}
              </button>
            ))}
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Scope</span>
          <div className="filtergroup-row">
            <button className={'btn-toggle' + (scope === 'default' ? ' active' : '')}
                    onClick={() => setScope('default')}
                    title="Fast movers down to aging">
              Fast → aging
            </button>
            <button className={'btn-toggle' + (scope === 'all' ? ' active' : '')}
                    onClick={() => setScope('all')}
                    title="Adds critical, new and dead stock. Slower to load.">
              All tiers
            </button>
          </div>
        </div>

        {/* Its own group, not part of Scope. Scope chooses which tiers
            this table shows; this opens a second table underneath. Two
            different questions do not belong under one label. */}
        <div className="filtergroup">
          <span className="filtergroup-label">Also</span>
          <div className="filtergroup-row">
            <button className={'btn-toggle' + (showNew ? ' active' : '')}
                    onClick={() => setShowNew((v) => !v)}
                    title="Arrived recently and not sold yet. Shown as its own table below.">
              New stock
            </button>
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Show</span>
          <div className="filtergroup-row">
            <button className={'btn-toggle' + (filter.shortOnly ? ' active' : '')}
                    onClick={() => set({ shortOnly: true })}
                    title="Only the items that need moving">
              Needs moving
            </button>
            <button className={'btn-toggle' + (!filter.shortOnly ? ' active' : '')}
                    onClick={() => set({ shortOnly: false })}
                    title="Every mover, including the ones already covered">
              All movers
            </button>
          </div>
        </div>

        <div className="filtergroup">
          <span className="filtergroup-label">Search</span>
          <div className="filtergroup-row">
            <input className="bk-search" type="search"
                   placeholder="Item, code or brand"
                   value={filter.search} onChange={(e) => set({ search: e.target.value })} />
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
                      `uae-stock-placement-${new Date().toISOString().slice(0, 10)}.csv`,
                      placementCsv(shown))}
                    title="The table exactly as it stands -- a picking list.">
              CSV ({fmtNum(shown.length)})
            </button>
          </div>
        </div>
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
              <col style={{ width: '24%' }} />
              <col style={{ width: '130px' }} />
            </colgroup>
            <thead>
              <tr className="sub-row">
                {th('item_code', 'Code', undefined, 'col-code')}
                {th('item_name', 'Item', undefined, 'col-name')}
                {th('brand', 'Brand')}
                {th('health', 'Tier')}
                {th('motor_city', 'Motor City', 'Units on hand at Motor City')}
                {th('jebel_ali', 'Jebel Ali', 'Units on hand at Jebel Ali')}
                {th('units_12m', 'Sold 12m', 'Units sold to customers in the last year')}
                {th('last_sale', 'Last sale')}
                {th('peak', 'Peak day', 'Most units a customer has taken in one day. Context only — the move covers the three-day figure.')}
                {th('peak_3d', 'Peak 3d', 'Most units taken in any three days — what the move covers')}
                {th('move', 'Move', 'Units to bring over from Jebel Ali')}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.item_code} className="item-row">
                  <td className="col-code" title={r.item_code}>{r.item_code}</td>
                  <td className="col-name" title={r.item_name}>{r.item_name || ''}</td>
                  <td>{r.brand || ''}</td>
                  <td>{TIER_LABEL[r.health] || r.health}</td>
                  <Here n={r.motor_city} />
                  <td>{fmtNum(r.jebel_ali)}</td>
                  <td>{fmtNum(r.units_12m)}</td>
                  <td>{r.last_sale || '—'}</td>
                  {/* Sits beside Move so the row explains itself: needs
                      this many, holds that many, bring the difference.
                      Zero means no customer has bought it in the year --
                      an em dash rather than a 0, because the move beside
                      it comes from the floor of one, not from this. */}
                  <td>{r.peak > 0 ? fmtNum(r.peak) : '—'}</td>
                  {/* The three-day figure is what the move covers. The
                      day beside it is context, not a rival: it says
                      whether that demand was one busy day or three
                      ordinary ones, which changes how much a reader
                      trusts it. */}
                  <td>{r.peak_3d > 0 ? fmtNum(r.peak_3d) : '—'}</td>
                  <td className="mr-want">{r.move > 0 ? fmtNum(r.move) : '—'}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan="11" className="page-sub">
                    Nothing to move for the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewStockTable rows={newData?.rows ?? NONE} loading={newLoading} Here={Here} />
      )}
    </>
  );
}
