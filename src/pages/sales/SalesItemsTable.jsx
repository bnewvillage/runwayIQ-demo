import CopyButton from '../../components/CopyButton.jsx';
import ExcludeBrandsDropdown from '../../components/ExcludeBrandsDropdown.jsx';
import { COUNTRIES } from '../../lib/constants.js';
import { fmtCurrency, fmtNum } from '../../lib/format.js';
import { downloadCsv } from '../../lib/download.js';
import { itemRunRate, salesItemsCsv, weeksIn } from './salesData.js';

/** The SKUs behind whatever is currently on screen.
 *
 * Every column sorts, per CONTEXT.md's interface conventions. Clicking a
 * row scopes the charts above to that item, so `selected`/`onSelect` and
 * the sort stay owned by the page -- holding them here would make this a
 * second source of truth for state the charts also read. */
export default function ItemsTable({
  items, itemData, loading, excluded, onToggleExcluded, allBrands,
  showAll, onShowAll, onSort, arrow, months, currency,
  selected, onSelect, className,
}) {
  return (
    <div className={className}>
      <div className="chart-title-row">
        <div className="chart-title">
          Items · {items ? fmtNum(items.length) : '…'}
          {itemData?.truncated && ' of top 500 by revenue'}
          {excluded.size > 0 && ` · ${excluded.size} brand${excluded.size === 1 ? '' : 's'} excluded`}
        </div>
        {/* The denominator is named because it changes the number:
            the same SKU reads differently over 3 months and 24, and
            the whole window counts even where the item had not
            launched yet. */}
        <span className="stock-kpi-sub">
          Run rate = units ÷ {Math.round(weeksIn(months))} weeks (the whole selected window)
        </span>
        <div className="seg-toggle" style={{ marginLeft: 'auto' }}>
          <ExcludeBrandsDropdown all={allBrands} excluded={excluded} onToggle={onToggleExcluded} />
          <button className={'btn-toggle' + (showAll ? ' active' : '')}
                  onClick={() => onShowAll((v) => !v)}
                  title={showAll ? 'Back to the top 500' : 'Fetch every item in scope (~11k)'}>
            {showAll ? 'Top 500' : 'Show all'}
          </button>
          <button className="btn-toggle" disabled={!items || !items.length}
                  onClick={() => downloadCsv('sales_items.csv', salesItemsCsv(items, months))}>
            Export CSV{items ? ` (${fmtNum(items.length)})` : ''}
          </button>
        </div>
      </div>
      <div className="tablewrap tablewrap-cap">
        <table className="fa-table single-header" style={{ width: '100%' }}>
          <thead>
            <tr className="sub-row">
              <th className="col-code sortable" onClick={() => onSort('item_code')}>Code{arrow('item_code')}</th>
              <th className="col-name sortable" onClick={() => onSort('item_name')}>Item{arrow('item_name')}</th>
              <th className="col-name sortable" onClick={() => onSort('brand')}>Brand{arrow('brand')}</th>
              <th className="sortable" onClick={() => onSort('units')}>Units{arrow('units')}</th>
              {COUNTRIES.map((c) => (
                <th key={c.key} className="sortable"
                    onClick={() => onSort(`${c.key.toLowerCase()}_units`)}>
                  <span className={'dot dot-' + c.dot} />{c.label}{arrow(`${c.key.toLowerCase()}_units`)}
                </th>
              ))}
              <th className="sortable" onClick={() => onSort('runRate')} title="Units per week across the selected horizon">Run rate{arrow('runRate')}</th>
              <th className="sortable" onClick={() => onSort('revenue')}>Revenue{arrow('revenue')}</th>
              <th className="sortable" onClick={() => onSort('margin')}>Margin{arrow('margin')}</th>
              <th className="sortable" onClick={() => onSort('asp')}>ASP{arrow('asp')}</th>
              <th className="sortable" onClick={() => onSort('orders')}>Orders{arrow('orders')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={12} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-faint)' }}>Loading…</td></tr>}
            {items && items.length === 0 && (
              <tr><td colSpan={12} style={{ textAlign: 'center', padding: 20, color: 'var(--ink-faint)' }}>No items in this scope.</td></tr>
            )}
            {items && items.map((r) => {
              const rr = itemRunRate(r, months);
              const u = Number(r.units);
              return (
                <tr key={r.item_code}
                    className={'item-row' + (selected === r.item_code ? ' selected' : '')}
                    style={{ cursor: 'pointer' }}
                    title="Show this item in the charts above"
                    onClick={() => onSelect((s) => (s === r.item_code ? null : r.item_code))}>
                  <td className="col-code"><span className="code-cell">{r.item_code}<CopyButton text={r.item_code} title="Copy item code" /></span></td>
                  <td className="col-name" title={r.item_name}>{r.item_name}</td>
                  <td className="col-name">{r.brand}</td>
                  <td>{fmtNum(u)}</td>
                  {COUNTRIES.map((c) => {
                    const v = Number(r[`${c.key.toLowerCase()}_units`]) || 0;
                    return <td key={c.key}>{v ? fmtNum(v) : <span className="no-data">&mdash;</span>}</td>;
                  })}
                  <td>{rr == null ? <span className="no-data">&mdash;</span> : rr.toFixed(2)}</td>
                  <td>{fmtCurrency(Number(r.revenue), currency)}</td>
                  <td>{fmtCurrency(Number(r.revenue) - Number(r.cogs), currency)}</td>
                  <td>{u > 0 ? fmtCurrency(Number(r.revenue) / u, currency) : <span className="no-data">&mdash;</span>}</td>
                  <td>{fmtNum(r.orders)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
