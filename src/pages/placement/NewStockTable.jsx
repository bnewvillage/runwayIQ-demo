import { useMemo, useState } from 'react';
import { fmtNum, fmtCurrency } from '../../lib/format.js';
import { downloadCsv } from '../../lib/download.js';
import { sortRows, newStockRows, newStockCsv } from './placementData.js';

/** New stock: arrived recently, not sold yet.
 *
 *  Its own component and its own fetch, because it is not a tier of the
 *  table above. No move can be computed for it -- the new_stock tier is
 *  reached only by NOT selling, so every row has zero customer demand
 *  and there is nothing to size a recommendation from. A Move column
 *  here would be a permanent blank inviting the reader to wonder what
 *  was wrong with it.
 *
 *  What it can say is where the stock is, so it opens on what is
 *  stranded: nothing at Motor City first, then by the value sitting at
 *  Jebel Ali. Sortable from there like any other table on this page --
 *  it was not, when this markup lived inline, and a header that looks
 *  clickable and is not is worse than one that does not. */
export default function NewStockTable({ rows, loading, Here }) {
  const [sort, setSort] = useState(null);

  // The opening order is a deliberate ranking, not a sort on one column,
  // so it stays until the reader asks for something else.
  const ranked = useMemo(() => newStockRows(rows), [rows]);
  const shown = useMemo(
    () => (sort ? sortRows(ranked, sort) : ranked), [ranked, sort]);
  const stranded = useMemo(
    () => ranked.filter((r) => r.motor_city === 0).length, [ranked]);

  const onSort = (key) => setSort((s) => (s && s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: ['item_code', 'item_name', 'brand'].includes(key) ? 'asc' : 'desc' }));
  const arrow = (key) => (sort && sort.key === key ? (sort.dir === 'desc' ? ' ▼' : ' ▲') : '');
  const th = (key, label, title, cls = '') => (
    <th className={'sortable ' + cls} title={title} onClick={() => onSort(key)}>
      {label}{arrow(key)}
    </th>
  );

  return (
    <div className="container">
      <div className="page-head">
        <h2>New stock</h2>
        <p className="page-sub">
          Arrived recently and not sold yet, so there is no demand to size a move
          from — these are for a look rather than a list.{' '}
          {loading ? 'Loading…' : (
            <>
              <strong>{fmtNum(stranded)}</strong> of {fmtNum(ranked.length)} hold
              stock at Jebel Ali and none at Motor City.
            </>
          )}
        </p>
      </div>

      {!loading && (
        <>
          <div className="filterbar">
            <div className="filtergroup">
              <div className="filtergroup-row">
                <button className="export-btn"
                        onClick={() => downloadCsv(
                          `uae-new-stock-${new Date().toISOString().slice(0, 10)}.csv`,
                          newStockCsv(shown))}
                        title="The review list exactly as it stands.">
                  CSV ({fmtNum(shown.length)})
                </button>
              </div>
            </div>
          </div>

          <div className="table-wrap table-wrap--clipped">
            <table className="fa-table single-header mr-table">
              {/* table-layout is fixed, so unsized columns split the width
                  equally -- which starves the two text columns and leaves
                  the numeric ones wider than a figure needs. */}
              <colgroup>
                <col style={{ width: '190px' }} />
                <col style={{ width: '30%' }} />
                <col style={{ width: '140px' }} />
                <col /><col />
                {/* Money -- the widest cell here. */}
                <col style={{ width: '150px' }} />
              </colgroup>
              <thead>
                <tr className="sub-row">
                  {th('item_code', 'Code', undefined, 'col-code')}
                  {th('item_name', 'Item', undefined, 'col-name')}
                  {th('brand', 'Brand')}
                  {th('motor_city', 'Motor City', 'Units on hand at Motor City')}
                  {th('jebel_ali', 'Jebel Ali', 'Units on hand at Jebel Ali')}
                  {th('stranded', 'Value at Jebel Ali', 'What is sitting offsite')}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.item_code} className="item-row">
                    <td className="col-code" title={r.item_code}>{r.item_code}</td>
                    <td className="col-name" title={r.item_name}>{r.item_name || ''}</td>
                    <td>{r.brand || ''}</td>
                    <Here n={r.motor_city} />
                    <td>{fmtNum(r.jebel_ali)}</td>
                    <td>{fmtCurrency(r.stranded, 'AED')}</td>
                  </tr>
                ))}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan="6" className="page-sub">
                      No new stock holding anything at Jebel Ali.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
